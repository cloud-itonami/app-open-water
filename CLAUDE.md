# open-water.etzhayyim.com — Water Utility Operations & Network Design (OSS)

**Status**: MVP scaffold (2026-04-20). Reference implementation for water
distribution network design (reservoirs / mains / service points) and
operations (meter readings, leak reports, water quality samples). Apache-2.0.

## Scope (MVP)

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

- **Runtime**: Single CF Worker (`src/app.ts`)
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

```bash
cd 60-apps/etzhayyim-project-open-water/worker
wrangler d1 create etzhayyim-open-water
e7m actor deploy .
```
