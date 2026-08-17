# app-open-water

上水道（配水池 → 配水管 → 給水点）の設計と運用 —— 配水管の諸元、漏水報告とその
重大度、水質サンプルとその警報 —— を扱う repo。**ただしこの repo には同じ主題の
実装が 2 つ入っていて、片方にしか無い能力が 1 つある**（§2-A）。そして
**デプロイされるのはそのどちらでもない。**

| サブツリー | 何か | 動くか | デプロイされるか |
|---|---|---|---|
| **`kotoba/`** | TypeScript。`@etzhayyim/sdk` の AT PDS レコードの上の**レジストリ 12 関数**（reservoir / main / leak / qualitySample / coverage） | **動く**（typecheck exit 0、vitest **6 passed**） | **されない**（HTTP 入口が無いライブラリ） |
| **`worker/svelte/`** | SvelteKit + `adapter-cloudflare`。**route は 2 本だけ** —— `/`（雛形ページ）と `POST /xrpc/[...path]`（`mcp.etzhayyim.com` への転送） | **ビルドは通る**（`vite build` exit 0、`svelte-check` 0 errors） | **これがデプロイされる**（`wrangler.jsonc` の `main`） |
| **`worker/src/app.ts`** | D1 を張った本体。**9 つの XRPC + `/health` + DMN 漏水重大度 + BPMN/DoDAF/Form の配布** | **ビルドされない**（`package.json` も `tsconfig` も無い） | **されない** |

**この repo の機能は `worker/src/app.ts`（24,069 B、468 行）に書いてあるが、それは
何からも読まれていない。** デプロイされるのは 2 route の薄い proxy で、その転送先
`mcp.etzhayyim.com` は**現在 DNS を解決しない**（§3-D）。

[`CLAUDE.md`](CLAUDE.md) が列挙する 9 つの XRPC は `app.ts` の実装と**正確に一致する**
——設計文書としては正しい。**この repo の現状の説明として読むと必ず間違える** ——
そこに書かれた `Local Dev / Deploy` の 3 行は、いま 1 行も実行できない（§3-I）。

この README が書くのは設計ではなく、**2026-08-18 に実際に測った現状**である。
手順は [`docs/operator-quickstart.md`](docs/operator-quickstart.md)。

## 1. この repo に在るもの（33 ファイル / 97,462 バイト）

`etzhayyim/root` の `60-apps/etzhayyim-project-open-water`（rev `7a08afb4`、
31 ファイル / 96,995 バイト）から切り出した standalone artifact
（[`migration.edn`](migration.edn)）。追加の 2 件が `README.edn` と `migration.edn`。
**この `README.md` と `docs/operator-quickstart.md` はさらに後から足している** ——
`migration.edn` の `:allowed-additions` はまだこの 2 件を列挙していないので、そこは
切り出し契約の更新漏れである（fleet の他の repo と同じ扱い。同じ
`:allowed-additions ["README.edn" "migration.edn"]` を持つ `app-open-swift` /
`app-open-power` も既に `README.md` + `docs/operator-quickstart.md` を持っている）。

### `kotoba/` — AT PDS 上のレジストリ（TypeScript、唯一テストが在る面）

| ファイル | 中身 |
|---|---|
| `src/types.ts`（10,043 B） | レコード型 4 種（reservoir / main / leak / qualitySample）、分類器 2 種、DID・rkey 生成 |
| `src/registry.ts`（15,765 B、334 行） | 本体 12 関数。コレクションは `…openWater.reservoir` / `.main` / `.leak` / `.qualitySample` の 4 本 |
| `src/index.ts`（916 B） | barrel |
| `test/open-water.test.ts`（6,236 B、99 行） | `MockEtzhayyim` に対する 6 ケース |

外部キーは実際に検査される: `defineMain` は **reservoir が存在すること**を確認して
無ければ `reservoirNotFound` を返し、`reportLeak` / `recordQualitySample` は
**main が存在すること**を確認して無ければ `mainNotFound` を返す。
**この FK 検査を含む 6 箇所を 1 つずつ外すとテストが 1 対 1 で赤くなることを実測した**
（§4）。

**AT-Lexicon に浮動小数が無いため、測定値は全て整数化されている**
（`src/types.ts` 冒頭が変換式を持つ）:

| 論理量 | 整数表現 | 変換 |
|---|---|---|
| 残留塩素 | `residualChlorineUgL` | mg/L × 1000（µg/L） |
| 濁度 | `turbidityMilliNtu` | NTU × 1000 |
| pH | `pHCenti` | pH × 100 |
| 延長 / 容量 / 口径 / 流量 | `lengthM` `capacityM3` `diameterMm` `estLpm` | 整数（`isPosInt` / `isNonNegInt` が小数を弾く） |

`coverage()` は 4 コレクションを最大 10,000 件まで走査して
`{reservoirCount, mainCount, leakCount, sampleCount, leaksBySeverity, alarmSamples, truncated}`
を返す。**打ち切りを黙って起こさない** —— `truncated` を必ず返す。

### `worker/` — デプロイされる面（2 route）と、されない面（9 XRPC）

| ファイル | 中身 | 到達可能か |
|---|---|---|
| `svelte/src/routes/+page.svelte`（3,081 B） | 生成された雛形ページ | **到達する**（`GET /` → 200） |
| `svelte/src/routes/xrpc/[...path]/+server.ts`（2,803 B） | 任意の nsid を MCP router へ転送 | **到達する**（`POST /xrpc/…`） |
| `src/app.ts`（24,069 B） | 9 XRPC + `/health` + `/_worker/health` + `/_app/meta` + `/dodaf` + `/forms` | **到達しない** |
| `src/defence-handlers.ts`（3,447 B） | defence イベント 1 件を Hyperdrive へ書く handler | **到達しない**（§3-F） |
| `src/dodaf-bootstrap.ts`（1,702 B） | DoDAF ビューの bootstrap | `app.ts` からのみ |

`wrangler.jsonc` の `main` は `svelte/.svelte-kit/cloudflare/_worker.js` である。
**`src/` を指してはいない。**

### 宣言ファイル（BPMN / DMN / DoDAF / Form）

`bpmn/`（2: `defineMain` / `reportLeak`）・`dmn/`（1）・`dodaf/`（6）・`forms/`（2）。
**DoDAF と Form は `app.ts` が `import` して配信する。BPMN と DMN は誰も parse しない**
—— `app.ts:422` が名前を文字列として列挙するだけである
（`bpmn: ["defineMain", "reportLeak"], dmn: ["openWater.leakSeverity"]`）。

DMN（`openWater.leakSeverity`、hitPolicy FIRST）は 5 ルールの決定表で、
**`app.ts:131-135` と `kotoba/src/types.ts` の `classifyLeak` の両方に 1 ルールずつ
突き合わせて一致することを確認した**:

| # | 条件 | severity / requirePublicNotice |
|---|---|---|
| r1 | `contaminationRisk = true` | `critical` / `true` |
| r2 | `estLpm >= 500` | `major` / `true` |
| r3 | `pressureLoss = true` | `major` / `true` |
| r4 | `estLpm >= 50` | `moderate` / `false` |
| r5 | それ以外 | `minor` / `false` |

**3 者に乖離は無い。** `bpmn/report-leak.bpmn` の
`decisionRef="openWater.leakSeverity"` も、この決定の id と一致している
（ただし誰も parse しないので、一致は偶然壊れうる）。

水質警報の閾値も**両実装で数値的に一致する** —— 残留塩素 < 0.1 mg/L、濁度 > 2.0 NTU、
pH < 5.8 または > 8.6。`app.ts` は float で、`kotoba` は整数化した形（100 µg/L /
2000 mNTU / 580・860）で同じ線を引いている。

## 2. 2 つの実装が食い違う点

漏水の**判定**は一致している（§1）。食い違うのは**何を保管するか**と**何を identity と
するか**である。

### 2-A. `recordReading`（検針）は `kotoba/` に存在しない

`app.ts` の 9 XRPC のうち `com.etzhayyim.apps.openWater.recordReading` —— 給水点ごとの
積算メーター値（m³）—— には、**`kotoba/` 側に対応する関数が 1 つも無い**
（`grep -i reading kotoba/src` は 0 件）。D1 側は `meter_readings` テーブルと
`idx_readings_sp_time` を持ち、**積算値の単調性を強制する**:

```ts
// worker/src/app.ts, recordReading
if (last && cubicM < last.cubic_m) return err("Conflict", "reading not monotonic", 409);
```

メーターの積算値は減らない、という**ドメイン不変条件がこの 1 行にしか無い**。そして
その 1 行は、ビルドされない側にある。

**構造的な理由がある**（2-B）ので、これは「移植し忘れ」より深い。にもかかわらず
`worker/kotodama.jsonld` の `convoSystemPrompt` は、いまも
*"You manage … meter ingest … Apply … monotonic m³ readings"* と名乗っている。

### 2-B. 給水点（service point）は片方でしか identity を持たない

| | `app.ts`（D1） | `kotoba/` |
|---|---|---|
| 給水点の在り方 | `nodes` テーブルの行。`node_type='service_point'`、**固有 DID を持つ** | `MainRecord.servicePoints[]` に埋め込まれた `{code, name}`。**DID を持たない** |
| 参照できるか | `recordReading` が `servicePointDid` で参照する | 参照する術が無い |

`kotoba/src/types.ts` の identity 階層は reservoir / main / leak / sample の 4 種を
挙げ、**給水点を挙げていない**。検針を substrate 側へ持ってくるには、まず給水点に
identity を与える必要がある —— 順序として、そちらが先である。

### 2-C. DID の形が違う（同じ配水池が実装ごとに別の DID になる）

| | `app.ts` | `kotoba/` |
|---|---|---|
| 配水池 | `did:web:{handle}:node:{nanoid(10)}` —— **乱数** | `did:web:…:reservoir:{nodeCode の小文字}` —— **導出** |
| 配水管 | `did:web:{handle}:main:{nanoid(10)}` | `did:web:…:main:{mainCode の小文字}` |

`CLAUDE.md` の `did:web:open-water.etzhayyim.com:{node|main|leak|sample}:{id}` は
**`app.ts` の形**（`node:`）であって、`kotoba/` の形（`reservoir:`）ではない。

**冪等性がここに乗っている。** `kotoba` は rkey を code から導出するので、同じ
`nodeCode` の 2 回目の `defineReservoir` は **`alreadyExists` という型付きの status** を
返す。`app.ts` は毎回新しい nanoid を作るので、2 回目は
`node_code TEXT NOT NULL UNIQUE` の制約違反に当たり、`fetch` 末尾の catch
（`app.ts:464-466`）が拾って **HTTP 500 `InternalError` + D1 のエラーメッセージ**に
なる。落ちはしないが、**「既に在る」が「サーバ内部エラー」として返る** ——
呼び出し側は再送してよいのかを応答から判断できない。

### 2-D. 検証の強さが違う

| 入力 | `app.ts` | `kotoba/` | 差がもたらすもの |
|---|---|---|---|
| `material` | `typeof material === "string"` のみ | `MATERIALS`（DI/ST/PVC/HDPE/AC）への所属 | **D1 側は `"XYZ"` を受ける** |
| `lengthM` | `Number.isFinite && > 0` | `isPosInt`（整数） | D1 側は `1.5 m` を受ける |
| `capacityM3` | `Number.isFinite && >= 0`（列は `REAL`） | 非負整数 | 同上 |
| 原点の指定 | `reservoirDid`（DID） | `reservoirCode`（コード） | 呼び出し側の語彙が違う |

`forms/defineMain.form.json` の `material` は select で 5 値を列挙している ——
**D1 経路で材質を縛っているのは、誰も配信していないこの form だけ**である
（form のキーは `reservoirDid` / `mainDid` なので、form は `app.ts` の側に属している）。

### 2-E. `listMains` の絞り込み軸が違う

`app.ts` は `status`（`mains.status`、既定 `'in-service'`）で絞る。`kotoba` は
`material` で絞り、**`MainRecord` に `status` が無い**。`CLAUDE.md` の
「`listMains` — mains by reservoir / status」は `app.ts` の側である。

## 3. 測って見つけた欠陥（2026-08-18、1 件も修正していない）

この反復の目的は文書化なので、以下は**記録だけしている**。

- **A. 実装がビルドされない。** `worker/` に `package.json` も `tsconfig.json` も
  無いので、`app.ts`（468 行）は型検査もビルドも受けていない。
- **B. D1 binding が宣言されていない。** `app.ts` の `Env` は `WATER_DB: D1Database`
  を要求するが、`wrangler.jsonc` に `d1_databases` は **0 件**。
- **C. `dmn/quality-alarm.dmn` が存在しない。** `CLAUDE.md` は
  「Quality alarm by DMN (`openWater.qualityAlarm`)」と書くが、`dmn/` に在るのは
  `leak-severity.dmn` 1 本だけで、`app.ts:422` の `/_app/meta` も
  `dmn: ["openWater.leakSeverity"]` しか列挙しない。**水質警報は決定表を持たず、
  コード（`classifyQuality`）にしか無い。**
- **D. 転送先が解決しない。** `dig open-water.etzhayyim.com` / `dig mcp.etzhayyim.com`
  はどちらも**空**（対照の `etzhayyim.com` は A レコード 2 件 + `GET /` 200）。
  そのため `POST /xrpc/…` は **500 `{"message":"Internal Error"}`** になる
  —— wrangler のスタックはビルド後の endpoint（`_server.ts.js:27`）を指しており、
  そこは `+server.ts` の `POST` が MCP router を `fetch` する箇所である。
- **E. `/health` が無い。** ローカル実測で `/health` `/_worker/health` `/_app/meta`
  `/dodaf` `/forms` は**全て 404**（`app.ts` にしか無いため）。監視を張るなら
  `GET /`（200）以外に手が無い。
- **F. `defence-handlers.ts` が未配線。** 誰も import していない。しかも
  `@etzhayyim/kotodama-host-sdk` を import するのに、その依存を宣言する
  `package.json` が `worker/` に無く、`HYPERDRIVE` binding も `wrangler.jsonc` に無い。
- **G. トップページが雛形のまま。** `+page.svelte` は `routeCount: 0`、
  `relativePath` は切り出し前の `60-apps/etzhayyim-project-open-water/…`。
  `GET /` の `<title>` は `worker`。
- **H. `LICENSE` ファイルが無い。** `app.ts` / `defence-handlers.ts` の冒頭は
  *"see LICENSE at repo root"* と書き、`kotoba/package.json` は `"license":
  "Apache-2.0"` と宣言している。参照先が実在しない。
- **I. `CLAUDE.md` の Local Dev / Deploy が全行実行不能。**
  `cd 60-apps/etzhayyim-project-open-water/worker` は切り出し前のパスで存在せず、
  `wrangler d1 create` は B のとおり binding に繋がらず、`e7m` はこの repo に無い。
- **J. `list*` の `total` はページ内の件数である。** `listReservoirs` /
  `listMains` / `listLeaks` / `listQualitySamples` は 1 ページ読んでから絞り込み、
  `total: items.length` を返す（既定 limit 50、上限 200）。**コレクション全体の
  件数ではない。** 全数が要るのは `coverage()` の方で、そちらは `cursor` を辿る。
  テストのレコード数は最大 3 件なので、この差はテストでは決して現れない。

## 4. テストが本当に discriminate することの実測

`kotoba/` の 6 ケースが「通る」ことは、それ自体では何も証明しない。**不変条件を
1 つずつ壊して、対応するテストだけが赤くなることを確かめた**（2026-08-18）。

| # | 壊した不変条件 | 場所 | 赤くなったテスト |
|---|---|---|---|
| A | `classifyLeak` の「汚染リスク → critical」（DMN r1） | `types.ts` | `classifies severity + requires public notice on contamination` |
| B | `defineMain` の reservoir 存在検査（FK） | `registry.ts` | `rejects bad diameter/material/length + missing reservoir + non-int length` |
| C | `classifyQuality` の pH 上限（> 8.6） | `types.ts` | `alarms on low chlorine / high turbidity / out-of-range pH (integerized)` |
| D | `listLeaks` の `since` フィルタ | `registry.ts` | `rejects missing main + filters by minSeverity/since` |
| E | `coverage` の severity 別集計 | `registry.ts` | `coverage rolls up all four registries` |
| F | `listMains` の `material` フィルタ | `registry.ts` | `defines reservoir + a main over it` |

**6 件とも `Tests 1 failed | 5 passed (6)`** —— 道連れで赤くなったテストは 1 つも無い。
6 つの変異が 6 つの異なるテストに写っているので、**この 6 ケースはどれも冗長ではない**。
各変異のあと `git checkout` で復元し、**バイト一致（`git diff --exit-code` exit 0）**と
`6 passed` への復帰を毎回確認した。

再現手順は [`docs/operator-quickstart.md`](docs/operator-quickstart.md) §6。

## 5. 動かし方

[`docs/operator-quickstart.md`](docs/operator-quickstart.md) —— clean-room（`node_modules`
と lockfile と `.svelte-kit` を全部消した状態）から上から下まで実走して書いた。
所要は `kotoba/` の `npm install` が 195 秒、それ以外は各数秒。

**デプロイはできない。** §3-D の DNS 2 件と §3-B の D1 binding が前提として欠けている。
