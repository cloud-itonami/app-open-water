(ns open-water.route-test
  (:require [clojure.test :refer [deftest is testing]]
            [kotoba.lang.text :as str]
            [open-water.route :as route]
            [open-water.view :as view]))

(deftest dispatch-page-and-health
  (is (= :page (:action (route/dispatch "GET" "/"))))
  (is (= :health (:action (route/dispatch "GET" "/health"))))
  (is (= :method-not-allowed (:action (route/dispatch "POST" "/health"))))
  (is (= :not-found (:action (route/dispatch "GET" "/nope"))))
  (testing "移行前に 404 だったパスは 404 のまま（app.ts の面は移していない）"
    (is (= :not-found (:action (route/dispatch "GET" "/_app/meta"))))
    (is (= :not-found (:action (route/dispatch "GET" "/dodaf"))))
    (is (= :not-found (:action (route/dispatch "GET" "/forms"))))))

(deftest dispatch-xrpc
  (testing "単一セグメントの nsid"
    (is (= {:action :xrpc :nsid "com.etzhayyim.apps.openWater.listMains"}
           (route/dispatch "POST" "/xrpc/com.etzhayyim.apps.openWater.listMains"))))
  (testing "空だけが 400。多段は移行前の [...path] と同じく転送する（絞るのは方針変更）"
    (is (= :bad-request (:action (route/dispatch "POST" "/xrpc/"))))
    (is (= "Missing XRPC method" (:reason (route/dispatch "POST" "/xrpc/"))))
    (is (= {:action :xrpc :nsid "a/b"} (route/dispatch "POST" "/xrpc/a/b"))))
  (testing "preflight と method"
    (is (= :cors-preflight (:action (route/dispatch "OPTIONS" "/xrpc/x"))))
    (is (= :method-not-allowed (:action (route/dispatch "GET" "/xrpc/x"))))))

(deftest mcp-url-resolution
  (is (= "https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message"
         (route/mcp-router-url {})))
  (is (= "https://a.example/x"
         (route/mcp-router-url {:AGENTGATEWAY_MCP_ROUTER_URL "https://a.example/x/"})))
  (testing "空白だけの設定は未設定として扱う（移行前の .trim() と同じ）"
    (is (= "https://b.example"
           (route/mcp-router-url {:AGENTGATEWAY_MCP_ROUTER_URL "   "
                                  :MCP_ROUTER_URL "https://b.example"})))))

(deftest unwrap
  (is (= {:ok? true :value {:a 1}} (route/unwrap-mcp {:result {:structuredContent {:a 1}}})))
  (is (= {:ok? true :value {:a 1}} (route/unwrap-mcp {:result {:a 1}})))
  (is (false? (:ok? (route/unwrap-mcp {:error {:message "boom"}}))))
  (is (= "boom" (:error (route/unwrap-mcp {:error {:message "boom"}})))))

(deftest page-shows-the-real-routes
  (testing "ページは route 表から描く。0 を焼かない（docs/adr/0001 の欠陥）"
    (let [html (view/render {:css "/*x*/" :routes route/routes
                             :vars [:APP_HANDLE :PRIMARY_DID]
                             :mcp-url "https://mcp.example/x"})]
      (doseq [r route/routes]
        (is (str/includes? html (:route/path r))
            (str (:route/path r) " がページに出ていない")))
      (is (str/includes? html "APP_HANDLE"))
      (is (str/includes? html "https://mcp.example/x"))
      (testing "移行前の雛形が出していた文言は残っていない"
        (is (not (str/includes? html "No public route is declared")))
        (is (not (str/includes? html "60-apps/etzhayyim-project-open-water")))))))

(deftest page-renders-what-it-is-handed
  (testing "route 表を差し替えると描画も変わる（固定値なら変わらない）"
    (let [html (view/render {:css "" :routes [{:route/path "/only" :route/method :get
                                               :route/kind :page :route/doc "ただ一つ"}]
                             :vars [] :mcp-url "https://z.example"})]
      (is (str/includes? html "/only"))
      (is (not (str/includes? html "/health"))))))
