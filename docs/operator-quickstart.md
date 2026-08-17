# operator quickstart — app-open-water

**この手順は 2026-08-18 に clean-room で上から下まで実走して書いた。** clean-room =
`kotoba/node_modules` `kotoba/package-lock.json` `worker/svelte/node_modules`
`worker/svelte/package-lock.json` `worker/svelte/.svelte-kit` `worker/.wrangler` を
全部消した状態。載っている数値は全部そのときの実測値である。

背景と、この repo の現状（実装が 2 つ在ってデプロイされるのはどちらでもない、という
話）は [`../README.md`](../README.md)。

---

## 0. 前提 —— この端末固有の罠が 2 つある

どちらも repo の欠陥ではない。**ここで詰まったら repo を疑わないこと。**

### 0-1. `npm install` が `EALLOWSCRIPTS` で落ちる

```
npm error code EALLOWSCRIPTS
npm error --allow-scripts is not allowed in project-scoped installs.
```

`~/.npmrc` の `allow-scripts[]=…` が **git 依存の準備 install に漏れる**（npm 11.16.0）。
`@etzhayyim/sdk` は git 依存なので必ず踏む。空の userconfig で隔離すれば通る:

```bash
: > /tmp/empty-npmrc
npm install --userconfig /tmp/empty-npmrc
```

以降このドキュメントの `npm` は全てこの `--userconfig` を付ける前提で書く
（あるいは `export npm_config_userconfig=/tmp/empty-npmrc`）。

### 0-2. `resource-guard.mjs` に `VAR=… cmd` を渡すと ENOENT

superproject の resource governor は `spawnSync` で第 1 引数をコマンド名にするので、
`VAR=x npm run build` を渡すと `VAR=x` というコマンドを探して落ちる。**先に export する。**

### 実測した版

```
node 26.3.0 / npm 11.16.0 / wrangler 4.123.0（worker/svelte/node_modules/.bin）
```

---

## 1. `kotoba/` —— 唯一テストが在る面

```bash
cd kotoba
npm install --userconfig /tmp/empty-npmrc     # exit 0 / 195 秒 / node_modules 75 entries
npm run typecheck                             # exit 0（tsc --noEmit、出力なし）
npm test                                      # exit 0
```

`npm test` の実測:

```
 RUN  v4.1.10
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Duration  316ms
```

**195 秒の大半は `@etzhayyim/sdk` とその依存の準備ビルドである** —— `sdk` /
`atproto-client` / `base-l2` / `checkpointer` / `ipfs` / `pqh` / `witness-quorum` の
**7 パッケージが `prepare: tsc`** を走らせる（加えて `@signalapp/libsignal-client` が
install script を持つ）。2 回目以降はキャッシュが効く。

---

## 2. `worker/svelte/` —— デプロイされる面

```bash
cd worker/svelte
npm install --userconfig /tmp/empty-npmrc     # exit 0 / 9 秒 / node_modules 71 entries

export npm_config_userconfig=/tmp/empty-npmrc
node <superproject>/scripts/resource-guard.mjs run build -- npm run build
                                              # exit 0 / built in 4.00s
npm run check                                 # exit 0
```

`npm run check` の実測:

```
COMPLETED 163 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

ビルド成果物:

```
.svelte-kit/cloudflare/_worker.js        4,335 B
.svelte-kit/cloudflare/client/           _app/ と _headers
```

**`_worker.js` が 4 KB 台であることが、この repo の中心的な事実である** ——
`worker/src/app.ts`（24,069 B）はここに入っていない。`wrangler.jsonc` の `main` は
`svelte/.svelte-kit/cloudflare/_worker.js` を指していて、`src/` を指していない。

> ビルド中に `PLUGIN_TIMINGS` の警告と、assets ディレクトリの watch 数に関する
> 警告が出るが、どちらも exit 0 を妨げない。

---

## 3. ローカルで起動して route を測る

`wrangler.jsonc` は `worker/` に在るので、そこから起動する。**ポートは他のセッションと
衝突しないものを選ぶ**（この端末では並行して複数の agent が走る）。

```bash
cd worker
./svelte/node_modules/.bin/wrangler dev --local --port 8814 --ip 127.0.0.1
```

`[wrangler:info] Ready on http://127.0.0.1:8814` が出たら、別の shell から:

| リクエスト | 実測 | 中身 |
|---|---|---|
| `GET /` | **200** | 雛形ページ。`<title>` は `worker` |
| `GET /health` | **404** | SvelteKit の 404 ページ（HTML） |
| `GET /_worker/health` | **404** | |
| `GET /_app/meta` | **404** | `Not found`（テキスト） |
| `GET /dodaf` | **404** | |
| `GET /forms` | **404** | |
| `GET /xrpc/<nsid>` | **405** | `GET method not allowed` |
| `OPTIONS /xrpc/anything` | **204** | CORS preflight。ボディ無し |
| `POST /xrpc/<nsid>` | **500** | `{"message":"Internal Error"}` |

```bash
B=http://127.0.0.1:8814
curl -s -o /dev/null -w '%{http_code}\n' "$B/"
curl -s -o /dev/null -w '%{http_code}\n' "$B/health"
curl -s -w '\n%{http_code}\n' -X POST "$B/xrpc/com.etzhayyim.apps.openWater.listMains" \
  -H 'content-type: application/json' -d '{}'
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS "$B/xrpc/anything"
```

**500 の原因は repo の外に在る。** wrangler のログにスタックが出る:

```
[500] POST /xrpc/com.etzhayyim.apps.openWater.listMains
Error: internal error; reference = …
    at async POST (…/entries/endpoints/xrpc/_...path_/_server.ts.js:27:19)
```

`+server.ts` の `fetch(mcpRouterUrl(...))` が `https://mcp.etzhayyim.com/…` を叩き、
そのホストが解決しない（§4）。**`/health` の 404 と合わせて、この Worker には
「上流が死んでいる」ことを外から確かめる手段が無い。**

終了したら `Ctrl-C`。ポートが解放されたことを `lsof -ti:8814` で確認する
（起動時に `EMFILE`（fd 上限）警告が出ることがあるが、サーバは起動する）。

---

## 4. DNS —— デプロイの前提が 2 つとも欠けている

```bash
for h in open-water.etzhayyim.com mcp.etzhayyim.com etzhayyim.com; do
  printf '%-30s ' "$h"; dig +short "$h" A | tr '\n' ' '; echo
done
```

実測（2026-08-18）:

```
open-water.etzhayyim.com       (空)
mcp.etzhayyim.com              (空)
etzhayyim.com                  104.21.51.111 172.67.179.128
```

対照の `etzhayyim.com` は `GET /` が 200 を返す。**つまり zone は生きていて、
この 2 つのホストだけが未作成である。**

- `open-water.etzhayyim.com` —— `wrangler.jsonc` の `routes[0].pattern`。無いと
  デプロイしても誰も到達できない。
- `mcp.etzhayyim.com` —— `vars.AGENTGATEWAY_MCP_ROUTER_URL` の転送先。無いと
  `POST /xrpc/…` は 500 のまま。

---

## 5. デプロイ —— **できない**

`wrangler deploy` は打たないこと。前提が 3 つ欠けている:

1. §4 の DNS 2 件
2. `wrangler.jsonc` に `d1_databases` が **0 件**（`app.ts` は `WATER_DB` を要求する）
3. そもそも `app.ts` は `main` の指す先に入っていない —— デプロイしても
   9 XRPC は 1 本も生えない

なお superproject の PreToolUse フック（`wrangler-deploy-main-sync-guard`）は、
`origin/main` より遅れた checkout からの `wrangler deploy` を deny する。
`--dry-run` と `--env <name>` はブロックされない。

---

## 6. テストがまだ discriminate することを確かめる

**「6 passed」は、それ自体では何も証明しない。** 不変条件を 1 つ壊して、対応する
テストだけが赤くなることを見る。README §4 の 6 件を再現するには、下の変更を
1 つずつ当てて `npm test` し、**毎回 `git checkout` で戻す**:

| # | ファイル | 消す（または変える）行 | 赤くなるべきテスト |
|---|---|---|---|
| A | `kotoba/src/types.ts` | `if (input.contaminationRisk) return { severity: "critical", …};` | `classifies severity …` |
| B | `kotoba/src/registry.ts` | `defineMain` の `if (!(await exists(e, RESERVOIR_COLLECTION, …)))` ブロック | `rejects bad diameter/material/length …` |
| C | `kotoba/src/types.ts` | `input.pHCenti > 860;` を落として `input.pHCenti < 580;` で終える | `alarms on low chlorine …` |
| D | `kotoba/src/registry.ts` | `if (input.since && v.detectedAt < input.since) return false;` | `rejects missing main + filters …` |
| E | `kotoba/src/registry.ts` | `leaksBySeverity[v.severity] = …` | `coverage rolls up all four registries` |
| F | `kotoba/src/registry.ts` | `if (input.material && v.material !== input.material) return false;` | `defines reservoir + a main over it` |

期待する形は毎回:

```
Tests  1 failed | 5 passed (6)
 × <上の表の 1 つだけ>
```

**2 つ以上赤くなったら、壊した場所と報告が一致していない**（変異が別の不変条件を
巻き込んでいる）。**1 つも赤くならなかったら、そのテストは何も守っていない。**

復元の確認は 2 段階でやる:

```bash
git checkout -- kotoba/src/registry.ts       # または types.ts
git diff --exit-code                          # exit 0 = バイト一致
npm test                                      # 6 passed に戻る
```

`D` と同じ形の行が `listQualitySamples` にも在る（`v.sampledAt` の方）。**消すのは
`v.detectedAt` の方**——間違えると赤くなるテストが変わり、「実演できた」と誤読する。

---

## 7. 生成物と `.gitignore`

この手順を踏むと `git status` に 6 種類の生成物が出る。`.gitignore` はその 6 種だけを
対象にしている（`node_modules/` / `.svelte-kit/` / `.wrangler/` / `package-lock.json`）。

**`package-lock.json` を無視しているのは決めた結果ではなく、まだ決めていないという
意味である。** 現状この repo の依存の固定は `kotoba/package.json` の git SHA
（`@etzhayyim/sdk#12314a0c…` / `@etzhayyim/sdk-mock#c857ff9b…`）だけが担っていて、
npm registry 側（`typescript ^5.6.0` / `vitest ^4.1.0` / `svelte ^5.56.0` / `vite ^8.0.15`
など）は範囲指定のままである。**上の実測値は今日の解決結果であって、明日
同じになる保証は無い。**

## 8. 触っていない面

- `worker/src/app.ts` の 9 XRPC —— ビルド経路が無いので実行して測っていない。
  読んで `kotoba/` と突き合わせた結果は README §2。
- `bpmn/` `dmn/` `dodaf/` `forms/` —— **`app.ts` 以外の誰も読まない**。DMN の 5 ルールを
  両実装と手で突き合わせた（README §1 末尾）が、その照合を機械で守るものは無い。
- `worker/src/defence-handlers.ts` —— 未配線。依存（`@etzhayyim/kotodama-host-sdk`）が
  どの `package.json` にも宣言されていないので install もできない。
