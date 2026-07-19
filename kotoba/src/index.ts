/**
 * open-water kotoba — barrel.
 *
 * Per ADR-2605203000 Option B. Public water-utility infrastructure open-data on
 * the etzhayyim substrate (AT PDS records; no RW/D1).
 *
 *   reservoir : defineReservoir / getReservoir / listReservoirs
 *   main      : defineMain (FK→reservoir) / getMain / listMains
 *   leak      : reportLeak (FK→main, severity-classified) / getLeak / listLeaks
 *   sample    : recordQualitySample (FK→main, alarm-classified) / listQualitySamples
 *   coverage
 *
 * Axis-clean public open-data (ADR-2605172400): no PII, settlement, or operating
 * liability. etzhayyim front. Measurements integerized per AT-Lexicon (no float).
 */

export * from "./types.js";
export {
  defineReservoir,
  getReservoir,
  listReservoirs,
  defineMain,
  getMain,
  listMains,
  reportLeak,
  getLeak,
  listLeaks,
  recordQualitySample,
  listQualitySamples,
  coverage,
} from "./registry.js";
