# operator-quickstart

**この repo で今日実際にできることを、踏める形で上から書く。** 所要 5 分。
Cloudflare のアカウントは要らない（deploy だけが要る。§8）。

出力はすべて 2026-08-19 に実際に walk した結果である。

## 0. 前提

| 要るもの | 確認 | この walk で使った版 |
|---|---|---|
| git | `git --version` | 2.51.0 |
| nbb | `npx --yes nbb --version` | v1.4.210 |
| node | `node --version` | v26.3.0 |
| clojure | `clojure --version` | ビルド時のみ |

## 1. 取得して、書いてあることが本当か検査する

```bash
git clone git@github.com:cloud-itonami/app-open-water.git
cd app-open-water
REPO=$PWD
npx --yes nbb scripts/verify-docs-claims.cljk .
```

実際の出力（末尾）:

```
SCANNED	35
PASS	tracked-files	expected=35	actual=35
PASS	preserved-files-unchanged	expected=[]	actual=[]
PASS	removed-by-migration-absent	expected=[]	actual=[]
PASS	appview-svelte-artifacts	expected=0	actual=0
PASS	appview-ts-files	expected=0	actual=0
PASS	appview-canonical-files	expected=4	actual=4
PASS	kotoba-files	expected=7	actual=7
PASS	kotoba-ts-files	expected=5	actual=5
PASS	declaration-files	expected=11	actual=11
PASS	claude-md-describes-cljs	expected=true	actual=true
PASS	wrangler-main	expected="../dist/worker.js"	actual="../dist/worker.js"
PASS	declared-vars	expected=4	actual=4
PASS	declared-routes	expected=1	actual=1
PASS	no-stale-assets-binding	expected=true	actual=true
PASS	sveltekit-compat-flags	expected=0	actual=0
PASS	app-framework-not-sveltekit	expected=true	actual=true
PASS	shadow-builds-that-main	expected=true	actual=true
PASS	warnings-as-errors-in-compiler-options	expected=true	actual=true
PASS	warnings-as-errors-not-misplaced	expected=true	actual=true
PASS	page-renders-route-table	expected=true	actual=true
PASS	adr-is-tx-data	expected=true	actual=true
OK	every claim in README.md and docs/operator-quickstart.md holds
```

末尾が `OK` なら README の数値・存在・不在は tree と一致している。
**exit 2（UNDETERMINED）は 0 ではない** —— tree を読み切れなかったという別の
答えで、「検査して問題なし」と混ぜない。

この検査には移行の不変条件が入っている: appview に TypeScript / Svelte が戻って
いないこと（撤去した 10 パスの不在 + 拡張子の総数）、`worker/wrangler.jsonc` の
`main` が shadow の出力先を指していること、ページが route 表から描かれていること、
`kotoba/` を触っていないこと（7 ファイルの sha256）、そして
**`:warnings-as-errors` が `:compiler-options` に在って `:build-options` に無い
こと**（grep ではなく EDN として parse して見る。§7 M2）。

## 2. テストを走らせる（ビルド不要・ブラウザ不要）

判断（`route.cljc`）と描画（`view.cljc`）は純 `.cljc` なので、nbb だけで回る。

```bash
K=~/github/com-junkawasaki/orgs/kotoba-lang
CP="src:test:$K/jp-go-digital-design-system/src:$K/html/src:$K/css/src"
cat > /tmp/run.cljs <<'EOF'
(require '[cljs.test :refer [run-tests]] 'open-water.route-test)
(run-tests 'open-water.route-test)
EOF
npx --yes nbb --classpath "$CP" /tmp/run.cljs
```

実際の出力:

```
Testing open-water.route-test

Ran 6 tests containing 30 assertions.
0 failures, 0 errors.
```

何を固定しているか: `/xrpc/` は**空の nsid だけ** 400 にする（`/xrpc/a/b` は
移行前の rest parameter `[...path]` と同じく転送する。1 セグメントに絞るのは
移行ではなく方針変更）、MCP router の URL 解決（空白だけの設定は未設定として
扱う）、`result` / `structuredContent` の剥がし方、移していない面
（`/_app/meta` `/dodaf` `/forms`）が 404 のままであること、そして
**ページが route 表から描かれること**（固定値を焼いていたら落ちる）。

## 3. ページを描画して採点する

```bash
K=~/github/com-junkawasaki/orgs/kotoba-lang
CP="src:$K/jp-go-digital-design-system/src:$K/html/src:$K/css/src"
cat > /tmp/render.cljs <<'EOF'
(require '["node:fs" :as fs] '[open-water.view :as view] '[open-water.route :as route])
(let [css (.readFileSync fs (str (.-DDS js/process.env) "/resources/jp_go_dds/dds.css") "utf8")]
  (.writeFileSync fs "/tmp/ow-page.html"
    (view/render {:css css :routes route/routes
                  :vars [:AGENTGATEWAY_MCP_ROUTER_URL :APP_FRAMEWORK :APP_HANDLE :PRIMARY_DID]
                  :mcp-url "https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message"}))
  (println "ok"))
EOF
DDS="$K/jp-go-digital-design-system" npx --yes nbb --classpath "$CP" /tmp/render.cljs

cd $K/design-quality && npx --yes nbb -m design-quality.cli score /tmp/ow-page.html --min 95
```

実際の出力（末尾）:

```
  100.00  /tmp/ow-page.html
aggregate: 100.00

axes scored: 10 (viewport, safe-area, dynamic-viewport, tap-targets, focus-visible, reduced-motion, overflow-guard, color-scheme, responsive, semantics)
NOT scored: input-zoom, contrast — pass --extra-axes to include the optional ones
A pass says nothing about an axis that was not applied.

gate: aggregate 100.00 >= min 95.00 -> PASS
```

**CLI が自分で「10 軸しか当てていない」と言っている。読むこと。** 12 軸すべてで
測るなら `--extra-axes` を付ける（このページはそれでも `100.00`、
`axes scored: 12`）。

**このスコアはデザインシステムが実際に入っているかを見ていない。** 同型の repo
での実測では、デザインシステムを完全に外したページも **96.63 で `--min 95` を
通る**。「CSS が入っている」と言えるのは §5 の smoke の 2 本目だけである。

## 4. bundle をビルドする

**高負荷ビルドは同時 1 本に制限されている**（superproject `CLAUDE.md` の
resource governor）。直接叩かず、必ず guard 経由で:

```bash
cd "$REPO"
node ~/github/com-junkawasaki/scripts/resource-guard.mjs run build -- \
  npx --yes shadow-cljs release worker
ls -la dist/worker.js
```

lock を他セッションが持っていると exit 2 で拒否される。**迂回しない** ——
`resource-guard: build is already running (pid=…)` はエラーではなく順番待ちで
ある（この walk でも 2 回待った）。

実際の出力（末尾）:

```
[:worker] Build completed. (55 files, 12 compiled, 0 warnings, 5.57s)
```

`dist/worker.js` = **246,372 バイト**、
sha256 `ffa5259a04a59627414e7642f69f7059e31cb280193238f643f8665a67bddb8b`。

> **⚠ sha256 を比べるなら `rm -rf .shadow-cljs` してから。** shadow-cljs の
> `:esm` 出力がバイト再現するのは**冷えたキャッシュからだけ**で、バイト同一の
> ソースからの差分ビルドは安定して**違うバイト**を出す。この walk では 5 回の
> cold rebuild すべてが上の sha に一致した。

### 壊れた var はビルドを **落とす**

`shadow-cljs.edn` の `:compiler-options` に `:warnings-as-errors true` が入って
いる。入れなければ、存在しない var を参照しても shadow は **WARNING** を出して
**exit 0** し、壊れた bundle を書く ——「ビルドが通った」は検査ではない
（**落ちようがない**）。この repo で実際に落として確かめた（§7 M8）。

キーは `:build-options` ではなく **`:compiler-options`** に置く。shadow が読むのは
`[:compiler-options :warnings-as-errors]` で、置き場所を間違えると**黙って無視
される** —— この option が防ぐはずの失敗そのものになる。検証器はこれを
**EDN として parse して**見る（§7 M2 が理由）。

## 5. ビルドした成果物を実際に叩く

ここが deploy されるものに触る唯一の検査である。

```bash
cd "$REPO" && npx --yes nbb scripts/smoke-worker.cljk dist/worker.js
```

実際の出力:

```
PASS	default export has fetch	expected=true	actual=true
PASS	GET / status	expected=200	actual=200
PASS	GET / is html	expected=true	actual=true
PASS	page advertises /health	expected=true	actual=true
PASS	page advertises /xrpc/:nsid	expected=true	actual=true
PASS	page advertises /xrpc/*	expected=true	actual=true
PASS	page is not the SvelteKit scaffold	expected=false	actual=false
PASS	page shows a var key	expected=true	actual=true
PASS	page hides other var values	expected=false	actual=false
PASS	page shows the relay target it uses	expected=true	actual=true
PASS	page uses the design system components	expected=true	actual=true
PASS	page carries the stylesheet itself	expected=true	actual=true
PASS	GET /health status	expected=200	actual=200
PASS	health names its routes	expected=true	actual=true
PASS	POST /xrpc/ status	expected=400	actual=400
PASS	POST /xrpc/ keeps the old message	expected=true	actual=true
PASS	OPTIONS preflight	expected=204	actual=204
PASS	unknown path	expected=404	actual=404
PASS	wrong method	expected=405	actual=405
PASS	unported app.ts surface stays 404	expected=404	actual=404
OK	the built bundle answers as the route table says
```

**bundle が無ければ exit 2**（「判定できなかった」であって合格ではない）:

```
$ npx --yes nbb scripts/smoke-worker.cljk dist/nonexistent.js ; echo $?
UNDETERMINED	no bundle at /…/dist/nonexistent.js
Refusing to report a pass: build it first (see docs/operator-quickstart.md S4).
2
```

## 6. Workers ランタイム（workerd）で動かす

Node で import する smoke より強い検査。実際の workerd で起こす。

```bash
cd "$REPO/worker"
npx --yes wrangler@latest dev --local --port 8811 --ip 127.0.0.1
# 別シェルで
B=http://127.0.0.1:8811
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' $B/
curl -s $B/health; echo
curl -s -X POST $B/xrpc/; echo
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS $B/xrpc/x
curl -s -o /dev/null -w '%{http_code}\n' $B/nope
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/health
curl -s -o /dev/null -w '%{http_code}\n' $B/dodaf
curl -s -X POST -H 'content-type: application/json' -d '{}' \
  $B/xrpc/com.etzhayyim.apps.openWater.listMains; echo
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -d '{}' $B/xrpc/a/b
```

実際の出力:

```
200 text/html; charset=utf-8
{"ok":true,"app":"open-water","runtime":"cljs","routes":["/","/health","/xrpc/:nsid","/xrpc/*"]}
{"error":"Missing XRPC method"}
204
404
405
404
{"error":"MCP router unreachable","detail":"internal error; reference = lrv2vur9obk8fm43js6f5p19","url":"https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message"}
502
```

読み方:

- `GET /` の本文には `dads-table` と `--color-primitive-blue` と `/xrpc/:nsid` が
  在る（grep で確認済み）
- `GET /dodaf` は **404**。`app.ts` の面は移していないので、移行前と同じ
- `/xrpc/…` は **502 で、行こうとした URL を応答に載せる**。`mcp.etzhayyim.com` が
  NXDOMAIN だからで、これは今日の既定の結末である
- **`/xrpc/a/b` も 502** —— 多段パスは単一セグメントと同一に扱われる（移行前と同じ）

`compatibility_flags`（`nodejs_compat`）は SvelteKit の adapter-cloudflare 由来で、
この bundle には要らない。**撤去は憶測ではなくこの実測で確かめてから行った。**

## 7. gate が本当に落ちることの実測（11 の mutation）

**緑を受け取る前に、対応する検査が赤くなるところを見た。** 1 つずつ当てて、
観察して、戻した（2 つ同時に当てると互いを隠しうる）。

| # | 壊したもの | 赤くなったもの | 巻き添え |
|---|---|---|---|
| M1 | 撤去した `worker/src/app.ts` が戻る | `tracked-files` / `removed-by-migration-absent` / `appview-ts-files` | なし |
| M1b | **撤去リストに無い名前**の `.ts`（`worker/lib/helper.ts`）が入る | `tracked-files` / `appview-ts-files` | なし |
| M2 | `:warnings-as-errors` を `:build-options` へ移す | `warnings-as-errors-in-compiler-options` / `warnings-as-errors-not-misplaced` | なし |
| M3 | `wrangler.jsonc` の `main` を SvelteKit 出力に戻す | `wrangler-main` / `shadow-builds-that-main` | なし |
| M4 | `kotoba/src/index.ts` に 1 行足す | `preserved-files-unchanged` | なし |
| M5 | `compatibility_flags: ["nodejs_compat"]` が戻る | `sveltekit-compat-flags` | なし |
| M6 | view が route 表でなく固定値を描く | test 4 assertion + `page-renders-route-table` | なし |
| M7 | `/xrpc/a/b` を 400 に絞る（＝方針変更） | test `dispatch-xrpc` 1 件 | なし |
| M8 | `route/dispatch` を存在しない var に改名 | **ビルドが exit 1** | なし |
| M9 | `(rc/inline "jp_go_dds/dds.css")` → `""` | smoke `page carries the stylesheet itself` のみ | なし |
| M10 | worker が env のキーでなく**値**を渡す | smoke `page hides other var values` のみ | なし |
| M11 | ページが中継先を出さなくなる | smoke `page shows the relay target it uses` のみ | なし |

### M2 が一番重要（grep なら緑のままだった）

`:warnings-as-errors true` という**文字列は依然としてファイルに在る** ——
`:build-options` の下に。grep ベースの検査はこれを緑と答える。検証器は EDN として
parse して `[:builds :worker :compiler-options :warnings-as-errors]` を見るので
赤くなり、加えて `[:builds :worker :build-options :warnings-as-errors]` が
**在ること**も別の claim で赤くなる。

### M8 — 落ちたビルドは bundle を出荷しない

```
------ ERROR -------------------------------------------------------------------
Use of undeclared Var open-water.route/dispatch-nonexistent
{:warning :undeclared-var, :line 127, :column 45, …, :shadow.build.compiler/warning-as-error true}
```

| | exit | `dist/worker.js` sha256 | bytes |
|---|---|---|---|
| 改名前 | **0** | `ffa5259a…67bddb8b` | 246372 |
| 改名後 | **1** | `ffa5259a…67bddb8b`（**不変**） | 246372 |
| 戻して cold rebuild | **0** | `ffa5259a…67bddb8b` | 246372 |

sha256 が 1 バイトも動いていないことが「出荷しなかった」を言っている。

### M9 — デザインシステムの検査を 2 本に割った理由

`dads-table` が在ることは**落ちない検査**である。実測（この repo のページ）:

| 探す文字列 | CSS 込み | CSS 無し |
|---|---|---|
| `dads-table`（素の部分文字列） | 74 | **6** |
| `class="dads-table"` | 1 | **1** |
| `--color-primitive-blue` | 45 | **0** |
| ページ全体 | 80,844 B | 8,746 B |

**どちらの `dads-table` も 0 にならない。** ビルドは両方 `0 warnings` で通る。
だから「component を呼んだ」と「stylesheet が実際に入った」を別の検査にした。

### M10 / M11 — 値の露出は 2 つの印で見る

M10（値が漏れる）では `page hides other var values` だけが赤く、
`page shows the relay target it uses` は**緑のまま**。M11（中継先を隠す）では
その逆。**片方だけの検査だと「全部隠す」実装も「全部出す」実装も通ってしまう。**

### 外した mutation を実演と数えない

最初の M10 は view 側で `(:env opts)` を読ませようとしたが、`body` は
`{:keys [routes vars mcp-url built-at]}` で分配束縛しており `opts` が**束縛されて
いない**。これはビルドが undeclared var で落ちるだけで、「値が漏れる」ことの
実演にはならない。**外した mutation の赤は実演ではない**ので、worker 側が
キーの代わりに値を渡す形に**狙い直した**。

### 復元の確認

各 mutation のあと `diff -q` でバイト一致を確認し、**`rm -rf .shadow-cljs` して
から** cold rebuild して sha256 が `ffa5259a…67bddb8b` に戻ることを確認した
（5 回とも一致）。並行して他の agent が同じマシンで作業しているので、
scratch は `mktemp -d` の下にだけ置いた。

## 8. deploy

```bash
cd "$REPO/worker"
npx wrangler deploy
```

**ただし route が指すホストは解決しない**（`open-water.etzhayyim.com` は
NXDOMAIN、2026-08-19 実測）。deploy が成功しても誰も到達できない。`/xrpc/` の
中継先 `mcp.etzhayyim.com` も同様なので、到達できたとしても中継は **502 を返す**
（成功と同じ形で隠さない）。

superproject の deploy guard は `origin/main` を含む checkout からの deploy しか
許さない点も併せて注意。**この walk では deploy していない。**

## 9. ここに無いもの

- **`worker/src/app.ts` の 9 XRPC** —— 移行前の `worker/src/` にあり、どこにも
  deploy されておらず（`main` が指さない、`worker/` に package.json も tsconfig も
  無い）、`d1_databases` binding も 0 件だった。**持ち越していない**
  （README §4）。`/dodaf` `/forms` `/_app/meta` は移行前も移行後も 404。
- **`worker/src/defence-handlers.ts`** —— 誰も import せず、
  `@etzhayyim/kotodama-host-sdk` の依存宣言も `HYPERDRIVE` binding も無かった。
- **`kotoba/` の 12 関数** —— **これは撤去ではない。** appview ではない別パッケージ
  として**そのまま在る**（7 ファイル、1 バイトも変えていない）。HTTP の入口を持た
  ないので deploy もされない。cljs へ移すのは別の決定（README §2）。
- **`LICENSE`** —— 移行前から実在しない。
