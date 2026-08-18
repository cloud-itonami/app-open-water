# open-water.etzhayyim.com — Water Utility Operations & Network Design (OSS)

**Status**: MVP scaffold (2026-04-20). Reference implementation for water
distribution network design (reservoirs / mains / service points) and
operations (meter readings, leak reports, water quality samples). Apache-2.0.

## ⚠ この表は設計であって、いま deploy される面ではない

**2026-08-19 に appview を TypeScript/Svelte から ClojureScript へ移した**
（`docs/adr/0001`）。deploy される Worker は `src/open_water/worker.cljs` を
shadow-cljs でコンパイルした `dist/worker.js` で、その公開ルートは
`/` `/health` `POST /xrpc/:nsid` `OPTIONS /xrpc/*` の 4 本だけである。

下の 9 XRPC を実装していた `worker/src/app.ts` は、**どの bundle にも入って
おらず D1 binding も宣言されていなかった**ので移していない（理由と測定値は
`docs/adr/0001`、現状は `README.md`）。この節は「いつか実装するもの」の設計
であって、現状の説明ではない。

## Scope (MVP — 未実装。上の警告を読むこと)

| NSID | Type | Description |
|---|---|---|
| `com.etzhayyim.apps.openWater.defineReservoir` | procedure | reservoir / pumping station node |
| `com.etzhayyim.apps.openWater.defineMain` | procedure | main pipe (reservoir → service points), DN + material |
| `com.etzhayyim.apps.openWater.getNode` | query | node detail + downstream mains |
| `com.etzhayyim.apps.openWater.listMains` | query | mains by reservoir / status |
| `com.etzhayyim.apps.openWater.recordReading` | procedure | meter reading (m³) |
| `com.etzhayyim.apps.openWater.reportLeak` | procedure | leak with severity + location |
| `com.etzhayyim.apps.openWater.listLeaks` | query | leaks by main / since |
| `com.etzhayyim.apps.openWater.recordQualitySample` | procedure | residual chlorine / turbidity / pH |
| `com.etzhayyim.apps.openWater.listQualitySamples` | query | quality samples by main / since |

## Architecture

### いま在るもの（deploy される面）

- **Runtime**: Cloudflare Worker、ClojureScript。`src/open_water/{route.cljc,
  view.cljc, worker.cljs}` → shadow-cljs `:target :esm` → `dist/worker.js`
  （`worker/wrangler.jsonc` の `main` が指す先）
- **Storage**: 無し。この面は XRPC を MCP router へ中継するだけである
- **UI**: `kotoba-lang/jp-go-digital-design-system`（`--hig-*` トークン契約）

### 設計（未実装）

- **Storage**: D1. Tables: `nodes`, `mains`, `meter_readings`, `leaks`, `quality_samples`
- **Identity**: reservoir/service-point/main/leak = path-based DIDs
  `did:web:open-water.etzhayyim.com:{node|main|leak|sample}:{id}`
- **Topology**: directed reservoir → service points via mains
- **Leak severity** by DMN (`openWater.leakSeverity`): estimated flow l/min +
  contamination risk → `{severity, requirePublicNotice}`
- **Quality alarm** by DMN (`openWater.qualityAlarm`): residual chlorine +
  turbidity → `{alarm, requirePublicNotice}` (drinking-water safety)
- **Audit**: severity ≥ "major" or qualityAlarm=true → `app.bsky.feed.post`

## Not in MVP

- Hydraulic modeling (EPANET integration)
- DMA / pressure zones, automated valve control
- Tariff billing, leakage NRW analytics

## Local Dev / Deploy

正本は [`docs/operator-quickstart.md`](docs/operator-quickstart.md)（実走した
出力つき）。要約:

```bash
npx --yes nbb scripts/verify-docs-claims.cljs .                 # 文書と tree の一致
node ~/github/com-junkawasaki/scripts/resource-guard.mjs run build -- \
  npx --yes shadow-cljs release worker                          # dist/worker.js
npx --yes nbb scripts/smoke-worker.cljs dist/worker.js          # 成果物を叩く
cd worker && npx --yes wrangler@latest dev --local --port 8811  # workerd で起こす
```

移行前ここに書かれていた 3 行（`cd 60-apps/…` / `wrangler d1 create` /
`e7m actor deploy .`）は**1 行も実行できなかった** —— パスは切り出し前のもので
存在せず、D1 は binding が宣言されておらず、`e7m` はこの repo に無い。

**deploy しても誰も到達しない**: `open-water.etzhayyim.com` は NXDOMAIN
（実測 2026-08-19）。中継先 `mcp.etzhayyim.com` も同様なので `/xrpc/` は 502 を
返す（成功と同じ形で隠さない）。
