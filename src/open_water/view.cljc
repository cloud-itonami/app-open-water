(ns open-water.view
  "この appview の説明ページ。純 hiccup。

  基盤は `jp-go-dds`(デジタル庁デザインシステム) —— superproject の
  skill `kotoba-uiux` が定める新規 UI の base。色・寸法は `--hig-*` トークン
  契約で書き、raw hex も px フォントサイズも置かない。

  **表示する事実は引数で受け取る。ページの中に焼かない。**
  これは装飾の都合ではなく、docs/adr/0001 が記録した欠陥そのものへの答えで
  ある —— 移行前の `+page.svelte` は `routeCount: 0` と `routes: []` と
  `vars: []` を literal で持っていて、隣の `worker/wrangler.jsonc` が route 1・
  var 4 を宣言していることに気づけなかった。しかも `relativePath` は切り出し
  前の `60-apps/etzhayyim-project-open-water/…` を指したままだった。
  ここでは route 表と設定を渡す側が持ち、ページは描くだけなので、両者がずれる
  余地が無い。"
  (:require [jp-go-dds.core :as dds]
            [jp-go-dds.page :as page]
            [jp-go-dds.tokens :as tokens]
            [kotoba.lang.text :as str]))

(def app-css
  "app 固有の最小 CSS。`--hig-*` 契約だけを使う(bridge が DADS の上に再定義する)。
  DADS を base にした app の下には `shitsuke.hig` が居ないので、bridge が運んで
  いないトークンは何にも解決しない —— 使うのは運ばれている 71 個の中だけ。"
  (str/join
   "\n"
   [".ow-lede { color: var(--hig-color-secondary-label); max-width: 42rem; }"
    ".ow-note { color: var(--hig-color-secondary-label); font-size: var(--hig-text-footnote-font-size); }"
    ".ow-mono { font-family: var(--hig-font-mono); }"]))

(defn- route-rows [routes]
  (mapv (fn [r]
          [(str/upper (name (:route/method r)))
           [:span {:class "ow-mono"} (:route/path r)]
           (:route/doc r)])
        routes))

(defn body
  "opts:
   :routes    open-water.route/routes（この Worker が実際に答えるもの）
   :vars      wrangler が渡した env のキー（**キー名だけ**。値は出さない）
   :mcp-url   XRPC の中継先（route/mcp-router-url の戻り値）
   :built-at  bundle のビルド時刻（不明なら nil）"
  [{:keys [routes vars mcp-url built-at]}]
  (dds/container
   (dds/section
    {}
    (dds/heading 1 "Open Water — 上水道ネットワークの設計と運用")
    [:p {:class "ow-lede"}
     "配水池 → 配水管 → 給水点の設計、検針、漏水報告とその重大度、"
     "水質サンプルとその警報を扱う repo の公開面。"
     "**この面が今日やっているのは XRPC の中継だけ**で、"
     "上の業務そのものはここには無い。"])

   (dds/section
    {:title "この面が答えるもの"}
    (dds/table {:caption "公開ルート"
                :headers ["METHOD" "PATH" "何をするか"]
                :rows (route-rows routes)})
    [:p {:class "ow-note"}
     "この表は Worker の route 表そのものから描いている。ページに焼いた値では"
     "ないので、実際に答えるものと表示がずれない。"])

   (dds/section
    {:title "実行時の設定"}
    (if (seq vars)
      [:div (into [:p] (interpose " "
                                  (map (fn [k] (dds/chip-label (name k))) vars)))
       [:p {:class "ow-note"}
        "キー名のみ。**ただし下の中継先だけは値そのもの**（"
        [:span {:class "ow-mono"} "AGENTGATEWAY_MCP_ROUTER_URL"]
        "）—— どこへ中継するかは運用者が見る必要があるので意図的に出している。"
        "それ以外の値は出さない。"]]
      [:p {:class "ow-note"} "env が渡されていない（ローカル描画）。"])
    [:p {:class "ow-note"} "XRPC の中継先: "
     [:span {:class "ow-mono"} mcp-url]])

   (dds/section
    {:title "現在地"}
    [:p {:class "ow-lede"}
     "この appview は TypeScript/Svelte から ClojureScript へ移行済み。"
     "deploy される bundle は、いま読んでいるソースからコンパイルされたもので"
     "ある（docs/adr/0001）。"]
    [:p {:class "ow-note"}
     "9 つの XRPC を持つ D1 実装（移行前の "
     [:span {:class "ow-mono"} "worker/src/app.ts"]
     "）は、どの bundle にも入っておらず binding も宣言されていなかったので"
     "移していない。AT PDS 上のレジストリ（"
     [:span {:class "ow-mono"} "kotoba/"]
     "）は HTTP の入口を持たないライブラリで、この面とは別物である。"]
    (when built-at
      [:p {:class "ow-note"} "bundle build: " built-at]))))

(defn render
  "完全な HTML 文書。`css` は呼び出し側が渡す(ライブラリは I/O を持たない)。"
  [{:keys [css] :as opts}]
  (page/->page
   {:title "Open Water — 上水道ネットワークの設計と運用"
    :description "配水池・配水管・給水点の設計と、検針・漏水・水質の運用を扱う appview の公開面。"
    :lang "ja"
    :css css
    :app-css (str tokens/bridge-css "\n" app-css)}
   (body opts)))
