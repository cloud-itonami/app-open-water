# app-open-water

上水道（配水池 → 配水管 → 給水点）の設計と運用 —— 配水管の諸元、検針、漏水報告と
その重大度、水質サンプルとその警報 —— を主題とする repo。

**2026-08-19 に appview を TypeScript/Svelte から ClojureScript へ移した**
（[`docs/adr/0001`](docs/adr/0001-migrate-the-appview-from-typescript-to-clojurescript.edn)）。
この README の数字はすべて [`scripts/verify-docs-claims.cljs`](scripts/verify-docs-claims.cljs)
が tree から再計算して検査する。

**主題は広いが、deploy される面は狭い。** いま deploy される Worker がやるのは
XRPC の中継だけで、上に書いた業務そのものはこの面には無い。何がどこに在るかは §2。

## 1. deploy されるものは、いま読んでいるソースである

```
src/open_water/route.cljc    判断（どの handler が答えるか）  ← 純 .cljc、テスト対象
src/open_water/view.cljc     ページ（jp-go-dds の hiccup）    ← 純 .cljc、テスト対象
src/open_water/worker.cljs   Request/Response に触る唯一の層
        ↓ shadow-cljs :target :esm
dist/worker.js               ← worker/wrangler.jsonc の "main" が指すもの
```

移行前は `main` が `svelte/.svelte-kit/cloudflare/_worker.js`（**tree に存在しない**
SvelteKit のビルド出力）を指し、読み手がこの repo の機能だと思って開く
`worker/src/app.ts`（468 行）は**どの bundle にも入っていなかった**。いまは
`main` が指す bundle が上のソースからコンパイルされたものなので、その形は構造的に
起こり得ない。検証器が **shadow の出力先と wrangler の `main` と export の ns 名の
3 つが噛み合っていること**を検査し、噛み合わなくなれば落ちる。

判断を `.cljc` に置いてあるのは、ブラウザもビルドも無しにテストするためであり、
ingress capability が qualify した時に **最初に `.kotoba` へ移る部分**だからで
ある（入口を当面 cljs に置くのは ADR-2606290000 の判断）。

### 公開ルート

| METHOD | PATH | 何をするか |
|---|---|---|
| GET | `/` | この appview の説明ページ |
| GET | `/health` | 生存確認。deploy された面が答えることを外から確かめられる |
| POST | `/xrpc/:nsid` | XRPC を MCP router へ中継する |
| OPTIONS | `/xrpc/*` | CORS preflight |

**この表の出所は `open-water.route/routes` で、ページもそこから描く。** 移行前の
ページ（`+page.svelte`）は `routeCount: 0` / `routes: []` / `vars: []` を literal で
持っており、隣の `worker/wrangler.jsonc` が **route 1・var 4** を宣言している
ことに気づけなかった。`relativePath` も切り出し前の
`60-apps/etzhayyim-project-open-water/…` を指したままだった。いまは route 表を
渡す側が持ち、ページは描くだけなので、両者がずれる余地が無い。

**`GET /health` は移植ではなく追加である。** 移行前は 404 だった。deploy された面が
答えることを外から確かめる手段が `GET /`（雛形ページ）しか無かったので足した。
404 → 200 は挙動の変更なので、移植と区別してここに書く。

## 2. この repo に在る 3 つの面（移行が触ったのは 1 つだけ）

| 面 | 何か | ビルドされるか | deploy されるか | 移行が触ったか |
|---|---|---|---|---|
| **appview** `src/` + `worker/wrangler.jsonc` | 4 route。XRPC を MCP router へ中継 | **される**（shadow-cljs） | **される** | **これを移した** |
| **`kotoba/`** | `@etzhayyim/sdk` の AT PDS レコードの上のレジストリ 12 関数。独自 package.json / tsconfig / vitest | 別パッケージとして独立にビルドされる | されない（HTTP 入口が無いライブラリ） | **触っていない** |
| **宣言物** `bpmn/`(2) `dmn/`(1) `dodaf/`(6) `forms/`(2) | BPMN / DMN / DoDAF / Form の記述 | されない | されない | 触っていない |

### `kotoba/` を消さなかった理由（測定値）

`kotoba/` は TypeScript だが **appview ではない**。実測:

- **どの bundle にも入らない** —— 独自の `package.json`（`@etzhayyim/open-water-kotoba`）
  と `tsconfig.json` と `vitest.config.ts` を持つ独立パッケージ
- **移行が置き換えた何物からも参照されていない** —— `worker/` 配下から `kotoba` への
  参照は `kotodama.jsonld`（別物の名前）以外 **0 件**
- **依存が実在する** —— `com-etzhayyim-sdk#12314a0cc5ac2feb…` と
  `com-etzhayyim-sdk-mock#c857ff9be5310bf4…` は `git fetch` + `git cat-file -t` で
  どちらも `commit` として取得できる（2026-08-19 実測。**GitHub API ではなく git に
  訊いた** —— API は実在する commit に 404 を返すことがある）

**appview でないものを「TypeScript だから」という理由で消すのは移行ではなく破壊
である。** そのまま残し、検証器に**ファイル数 7 と各ファイルの sha256** を固定した
ので、黙って増えることも、私が触ったことになることもない。cljs へ移すのは、依存
する SDK の cljs face を要する**別の決定**である。

## 3. 移行前後（検証器が固定している数）

| | 移行前 | 移行後 |
|---|---|---|
| appview の `.ts` | **5**（`app.ts` / `defence-handlers.ts` / `dodaf-bootstrap.ts` / `+server.ts` / `vite.config.ts`） | **0** |
| appview の `.svelte` | **1**（`+page.svelte`） | **0** |
| appview の `.cljs` / `.cljc` | **0** | **4** |
| `kotoba/` のファイル | 7（うち `.ts` 5） | **7（うち `.ts` 5、1 バイトも変わらず）** |
| tracked files | 36 | **35** |

TS が戻れば落ちる。撤去した **10 パスに戻る**場合（`removed-by-migration-absent`）
と、**別名で入る**場合（`appview-ts-files` / `appview-svelte-artifacts`）を、
別々の claim が捕まえる。

## 4. 移していないもの（黙って消していない）

### `worker/src/app.ts` の 9 XRPC

**deploy されたことが一度も無く、かつ binding が宣言されていない。** 実測:

| 測ったこと | 結果 |
|---|---|
| `wrangler.jsonc` の `main` が `src/` を指すか | 指さない（`svelte/…/_worker.js`） |
| `worker/` に `package.json` / `tsconfig.json` があるか | **どちらも無い**（型検査もビルドも受けていない） |
| `wrangler.jsonc` の `d1_databases` | **0 件**（`app.ts` の `Env` は `WATER_DB: D1Database` を要求） |
| `services` binding（`PDS` / `AUTH_SERVICE`） | **0 件** |

deploy されていない上に、deploy しても binding が無くて動かない。**動かない経路を
移植して「移行済み」と言わないため**に移していない。必要になった時点で
`route.cljc` に足し、テストと binding を伴って戻す。

`defence-handlers.ts` も同じ（誰も import せず、`@etzhayyim/kotodama-host-sdk` の
依存を宣言する package.json が無く、`HYPERDRIVE` binding も無い）。
`dodaf-bootstrap.ts` は `app.ts` からのみ import されていた。

移行前も移行後も `/dodaf` `/forms` `/_app/meta` は **404** である。smoke がこれを
検査に持っている。

### `dodaf/` と `forms/` は読み手を失った（ただし到達可能性は変わっていない）

移行前、`dodaf/`(6) と `forms/`(2) を読んでいたのは `app.ts` だけだった。`bpmn/`(2)
と `dmn/`(1) は**移行前から誰も parse していない**（`app.ts` が名前を文字列として
列挙するだけ）。`app.ts` を移さなかったので `dodaf/` と `forms/` も読み手を失った ——
**ただし `app.ts` はどこにも deploy されていなかったので、到達可能だったものが
到達不能になったわけではない。** 宣言物として残し、検証器に件数 11 を固定した
（内容は固定していない。人が正当に編集しうる設計物を、編集イコール改竄にしない
ため）。

## 5. 中継はそのまま移した（中継先が解決しなくても）

| ホスト | 役割 | DNS（2026-08-19 実測） |
|---|---|---|
| `open-water.etzhayyim.com` | 公開ホスト（wrangler の route） | **NXDOMAIN** |
| `mcp.etzhayyim.com` | `/xrpc/:nsid` の中継先 | **NXDOMAIN** |
| `etzhayyim.com`（対照） | — | A 2 件 |

**それでもこの経路は移した。** 到達しないことと「動かない経路」は別である ——
これは deploy されていた実際の挙動で、失敗したことが応答に出る。workerd での実測:

```
POST /xrpc/com.etzhayyim.apps.openWater.listMains
→ 502 {"error":"MCP router unreachable","detail":"…","url":"https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message"}
```

**どの URL へ行こうとしたかを応答に載せる。** 移行前はここが SvelteKit の 500
`{"message":"Internal Error"}` になり、行き先は応答に出なかった。

**多段パス `/xrpc/a/b` も転送する。** 移行前の `[...path]` は空文字だけを 400 に
して `a/b` はそのまま tool 名として転送していた。1 セグメントに絞るのは**移行では
なく方針変更**なのでしない。workerd 実測で `a/b` も `com.x.y` も同じ 502。

## 6. ページが出す値・出さない値

env の**キー名**は出すが、値は出さない —— **中継先を除いて**。
`AGENTGATEWAY_MCP_ROUTER_URL` の値だけは、どこへ中継するかを運用者が見る必要が
あるので意図的に表示する。

smoke はこれを**2 つの独立した印**で見る: 別の var に置いた sentinel が出ていない
こと、そして中継先の値が出ていること。**片方だけだと「全部隠す」実装も「全部出す」
実装も通ってしまう。** 中継先の印には `.invalid`（RFC 2606 で必ず解決しない TLD）
を使うので、この検査は実 DNS に依存しない。

## 7. UI

基盤は `kotoba-lang/jp-go-digital-design-system`（デジタル庁デザインシステム）。
色・寸法は `--hig-*` トークン契約だけで書き、raw hex も px フォントサイズも置か
ない。app 固有 CSS は 3 行。CSS は外部リクエストゼロの方針どおり
`shadow.resource/inline` で bundle に焼く。

決定論的 audit（`kotoba-lang/design-quality`）で **100.00 / 100（gate 95）**。
`--extra-axes` を付けた 12 軸でも **100.00**。

### デザインシステムの検査は 2 本ある

`dads-table` が在ることを 1 本で見る形は**落ちない検査**である —— それは view が
出力する markup であって、CSS が 1 バイトも入っていないページにも現れる。実測
（このページ、2026-08-19、`(rc/inline …)` を `""` に置き換えて再ビルド）:

| 探す文字列 | CSS 込み | CSS 無し |
|---|---|---|
| `dads-table`（素の部分文字列） | 74 | **6**（0 にならない） |
| `class="dads-table"` | 1 | **1**（0 にならない） |
| `--color-primitive-blue` | 45 | **0** |

ページ全体は 80,844 → 8,746 バイトに縮むが、**どちらの `dads-table` も 0 に
ならない**。ビルドは両方 `0 warnings` で通る —— **緑のビルドはこの違いについて
何も言わない。**

だから 2 本に割った。**component を使ったか**（`class="dads-table"`）と、
**stylesheet が実際に入ったか**（`--color-primitive-blue`）は別の主張である。

design-quality のスコアはこの区別をしない —— **デザインシステムを完全に外しても
96.63 で PASS する**（同型の repo で測定済み）。「CSS が実際に入っている」と言える
のはこの smoke の 2 本目だけである。

## 8. 検証

```bash
npx --yes nbb scripts/verify-docs-claims.cljs .          # <dir> は先頭に置く
```

exit 0 = 全一致 / 1 = 食い違い / **2 = 判定できなかった**（0 と区別する）。
テスト・ビルド・smoke・workerd 実走・8 通りの mutation は
[`docs/operator-quickstart.md`](docs/operator-quickstart.md)。

## 9. 残っている欠陥（移行では直っていない）

1. **`open-water.etzhayyim.com` も `mcp.etzhayyim.com` も NXDOMAIN**（§5）。
   deploy しても誰も到達せず、到達できても中継は 502 になる。deploy するか
   retire するかは別の決定。
2. **`worker/kotodama.jsonld` の `convoSystemPrompt` が実態より広い。** いまも
   *"meter ingest … monotonic m³ readings"* を名乗るが、その能力を持っていた
   `app.ts` は移していない。**移行前から deploy されていなかった**ので新しい嘘では
   ないが、嘘であることは変わらない。custody ファイルなので触っていない。
3. **`LICENSE` ファイルが無い。** `kotoba/package.json` は `"license": "Apache-2.0"`
   と宣言し、撤去した `.ts` の冒頭は *"see LICENSE at repo root"* と書いていた。
   参照先は移行前から実在しない。
4. **`migration.edn` の `:allowed-additions` が `["README.edn" "migration.edn"]` の
   まま。** この `README.md` / `docs/` / `src/` / `test/` / `scripts/` は列挙されて
   いない。切り出し契約の更新漏れであり、custody ファイルを勝手に書き換えない方針
   なのでここに記録するに留める（fleet の他 repo と同じ扱い）。
5. **`dmn/quality-alarm.dmn` が存在しない。** `CLAUDE.md` は
   「Quality alarm by DMN」と書くが `dmn/` に在るのは `leak-severity.dmn` 1 本
   だけである。移行前からの状態。
