(ns open-water.worker
  "Cloudflare Worker の入口。**この repo で唯一 Request/Response に触る層。**

  ここには判断を置かない —— どのハンドラが答えるかは `open-water.route/dispatch`
  が決め、ページの中身は `open-water.view` が組む。どちらも `.cljc` なので、
  ブラウザもビルドも無しにテストできる。

  worker/wrangler.jsonc の `main` は `../dist/worker.js` を指し、それはこの
  名前空間をコンパイルしたものである。移行前は SvelteKit のビルド出力
  （`svelte/.svelte-kit/cloudflare/_worker.js`、tree に無い）を指していて、
  読み手が開く TypeScript はどの bundle にも入っていなかった（docs/adr/0001）。

  `aget` を使うのは `:advanced-optimization` 下で env のキーが潰れないため
  （先例 `listingops.edge.worker` と同じ約束）。"
  (:require [open-water.route :as route]
            [open-water.view :as view]
            [shadow.resource :as rc]
            [kotoba.lang.text :as str]))

(def ^:private dds-css
  "DADS の CSS はビルド時に bundle へ焼く。外部リクエストゼロが design system
  の方針で、Worker から resource を読む経路も無い。"
  (rc/inline "jp_go_dds/dds.css"))

(defn- ->response [body {:keys [status content-type cache extra]}]
  (js/Response.
   body
   #js {:status status
        :headers (clj->js (merge {"content-type" content-type
                                  "cache-control" (or cache "no-store")}
                                 extra))}))

(defn- json [body status]
  (->response (js/JSON.stringify (clj->js body))
              {:status status :content-type "application/json; charset=utf-8"}))

(defn- env->map
  "env の **キーだけ** を keyword で拾う。値はページにも応答にも出さない。"
  [env]
  (if env
    (into {} (map (fn [k] [(keyword k) (aget env k)])) (js/Object.keys env))
    {}))

(defn- cors-headers []
  {"access-control-allow-origin" "*"
   "access-control-allow-methods" "POST,OPTIONS"
   "access-control-allow-headers" "content-type,authorization"
   "access-control-max-age" "86400"})

(defn- forward-headers
  "呼び手の header をそのまま上流へ持っていく。移行前の `+server.ts` が
  `new Headers(event.request.headers)` してから `host` を消し、content-type と
  2 つの印を付けていたのと同じ形。

  `authorization` を落とさないのが要点 —— preflight が
  `access-control-allow-headers: content-type,authorization` を返している以上、
  それを捨てると宣言と実装が食い違う。

  `content-length` だけは移行前と違って**落とす**。body を作り直しているので
  元の長さは嘘であり、Workers 側で再計算されるべき値だからである。
  これがこの中継で唯一意図的に変えた点である。"
  [req nsid]
  (let [h (js/Headers. (.-headers req))]
    (.delete h "host")
    (.delete h "content-length")
    (.set h "content-type" "application/json")
    (.set h "x-etzhayyim-bff" "cljs-worker")
    (.set h "x-etzhayyim-xrpc-method" nsid)
    h))

(defn- proxy-xrpc
  "XRPC を MCP router へ中継する。移行前に deploy されていた SvelteKit の
  route と同じ形（jsonrpc の封筒に包み、result/structuredContent を剥がす）。"
  [req env nsid]
  (let [url (route/mcp-router-url (env->map env))]
    (-> (.json req)
        (.catch (fn [_] #js {}))
        (.then
         (fn [input]
           (js/fetch url
                     #js {:method "POST"
                          :headers (forward-headers req nsid)
                          :body (js/JSON.stringify
                                 #js {:jsonrpc "2.0"
                                      :id (.randomUUID js/crypto)
                                      :method "tools/call"
                                      :params #js {:name nsid :arguments input}})})))
        (.then (fn [resp]
                 (-> (.text resp)
                     (.then (fn [text]
                              (let [payload (try (when (seq text) (js/JSON.parse text))
                                                 (catch :default _ text))
                                    clj-payload (js->clj payload :keywordize-keys true)]
                                (if-not (.-ok resp)
                                  (json {:error "MCP router request failed"
                                         :upstream clj-payload}
                                        (.-status resp))
                                  (let [{:keys [ok? value error upstream]} (route/unwrap-mcp clj-payload)]
                                    (if ok?
                                      (json (or value {}) 200)
                                      (json {:error error :upstream upstream} 502))))))))))
        (.catch (fn [e]
                  ;; 到達できなかったことを 200 で隠さない。移行時点で
                  ;; mcp.etzhayyim.com は A レコードを返さないので、これは
                  ;; 想像上の経路ではなく今日の既定の結末である。
                  ;; 移行前はここが SvelteKit の 500 `{"message":"Internal Error"}`
                  ;; になり、どこへ行こうとして失敗したのかは応答に出なかった。
                  (json {:error "MCP router unreachable"
                         :detail (str (.-message e))
                         :url url}
                        502))))))

(defn- page-response [env]
  (->response
   (view/render {:css dds-css
                 :routes route/routes
                 :vars (sort (keys (env->map env)))
                 :mcp-url (route/mcp-router-url (env->map env))
                 :built-at nil})
   {:status 200
    :content-type "text/html; charset=utf-8"
    :cache "public, max-age=60"}))

(defn fetch-handler [req env _ctx]
  (let [url (js/URL. (.-url req))
        path (.-pathname url)
        {:keys [action nsid allow reason]} (route/dispatch (.-method req) path)]
    (case action
      :page   (page-response env)
      :health (json {:ok true :app "open-water" :runtime "cljs"
                     :routes (mapv :route/path route/routes)}
                    200)
      :xrpc   (proxy-xrpc req env nsid)
      :cors-preflight (->response nil {:status 204 :content-type "text/plain"
                                       :extra (cors-headers)})
      :bad-request (json {:error reason} 400)
      :method-not-allowed (->response (js/JSON.stringify #js {:error "Method Not Allowed"})
                                      {:status 405
                                       :content-type "application/json; charset=utf-8"
                                       :extra {"allow" allow}})
      (json {:error "Not Found"
             :routes (mapv (fn [r] (str (str/upper (name (:route/method r)))
                                        " " (:route/path r)))
                           route/routes)}
            404))))

(def handler #js {:fetch fetch-handler})
