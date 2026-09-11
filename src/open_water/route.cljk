(ns open-water.route
  "Which handler answers a request — as data, decided by a pure function.

  This is `.cljc` and not `.cljs` on purpose. Routing is the part of an edge
  worker that is worth testing, and it is testable here without a browser, a
  build, or a network. `open-water.worker` is the only namespace that touches
  Request/Response, and it does nothing this file has not already decided.

  It is also the first thing that should move to `.kotoba` once the ingress
  capability qualifies (`:native-aot`/`:wasm-aot` are pending today —
  ADR-2606290000): a route table is a decision over scalars and strings,
  which is exactly the shape that survives that move."
  (:require [kotoba.lang.text :as str]))

(def routes
  "The public surface, as data. The landing page renders THIS, so a route that
  exists and a route the page advertises cannot drift apart — the defect
  docs/adr/0001 recorded was a page that baked `routeCount: 0` and `vars: []`
  beside a wrangler.jsonc declaring 1 route and 4 vars."
  [{:route/path "/"           :route/method :get     :route/kind :page
    :route/doc "この appview の説明ページ"}
   {:route/path "/health"     :route/method :get     :route/kind :json
    :route/doc "生存確認。deploy された面が答えることを外から確かめられる"}
   {:route/path "/xrpc/:nsid" :route/method :post    :route/kind :proxy
    :route/doc "XRPC を MCP router へ中継する"}
   {:route/path "/xrpc/*"     :route/method :options :route/kind :cors
    :route/doc "CORS preflight"}])

(defn- xrpc-nsid
  "`/xrpc/<nsid>` の nsid。**空文字だけが nil**。

  多段パス（`/xrpc/a/b`）も通す。移行前の SvelteKit route は rest parameter
  `[...path]` で受けており、`event.params.path` が `a/b` になるものを
  そのまま tool 名として転送していた（400 になるのは `!nsid`、つまり空文字の
  ときだけ）。ここで 1 セグメントに絞ると挙動が変わる —— NSID に `/` は
  現れないので上流で失敗するだけだが、**それは移行ではなく方針変更**であり、
  移行の commit に紛れ込ませるべきものではない。絞るなら別の決定として記録する。

  同型の移行（cloud-itonami/app-lo, app-ongakuka）が先に同じ結論に達しており、
  こちらを合わせた。"
  [path]
  (when (str/starts-with? path "/xrpc/")
    (let [rest' (subs path (count "/xrpc/"))]
      (when (seq rest') rest'))))

(defn dispatch
  "method + path → 何をするか。Request も Response も知らない。

  返すのは `{:action …}` で、`:action` は
  `:page` / `:health` / `:xrpc` / `:cors-preflight` / `:not-found` /
  `:method-not-allowed` / `:bad-request` のいずれか。"
  [method path]
  (let [m (keyword (str/lower (or method "get")))
        p (or path "")]
    (cond
      (and (= m :options) (str/starts-with? p "/xrpc/"))
      {:action :cors-preflight}

      (str/starts-with? p "/xrpc/")
      (if (= m :post)
        (if-let [nsid (xrpc-nsid p)]
          {:action :xrpc :nsid nsid}
          {:action :bad-request :reason "Missing XRPC method"})
        {:action :method-not-allowed :allow "POST, OPTIONS"})

      (= p "/health") (if (= m :get)
                        {:action :health}
                        {:action :method-not-allowed :allow "GET"})
      (= p "/")       (if (= m :get)
                        {:action :page}
                        {:action :method-not-allowed :allow "GET"})
      :else {:action :not-found})))

(defn mcp-router-url
  "env の設定 → MCP router の URL。末尾スラッシュは落とす。

  解決順は移行前の `+server.ts` の `mcpRouterUrl()` と同じ:
  `AGENTGATEWAY_MCP_ROUTER_URL` →`MCP_ROUTER_URL` → 焼いた既定値。
  既定値をここに置くのは、設定が無いときに黙って何処かへ POST しないためでは
  なく、**どこへ行くのかを 1 箇所で読めるようにする**ため。"
  [{:keys [AGENTGATEWAY_MCP_ROUTER_URL MCP_ROUTER_URL]}]
  (let [pick (fn [s] (when (and (string? s) (seq (str/trim s))) (str/trim s)))]
    (-> (or (pick AGENTGATEWAY_MCP_ROUTER_URL)
            (pick MCP_ROUTER_URL)
            "https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message")
        (str/replace #"/+$" ""))))

(defn unwrap-mcp
  "MCP router の応答から、呼び手に返す値を取り出す。

  `{:result {:structuredContent X}}` → X、`{:result X}` → X、それ以外は素通し。
  `{:error …}` は呼び出し側が 502 にするので、ここでは判定だけ返す。
  移行前の `+server.ts` と同じ剥がし方である。"
  [payload]
  (cond
    (and (map? payload) (contains? payload :error))
    {:ok? false :error (get-in payload [:error :message] "MCP router returned an error")
     :upstream payload}

    (and (map? payload) (contains? payload :result))
    (let [r (:result payload)]
      {:ok? true :value (if (and (map? r) (contains? r :structuredContent))
                          (:structuredContent r)
                          r)})

    :else {:ok? true :value payload}))
