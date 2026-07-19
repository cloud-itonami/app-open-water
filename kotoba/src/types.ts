/**
 * open-water kotoba — record types.
 *
 * Per ADR-2605203000 Option B. Public water-utility infrastructure open-data:
 * reservoirs + distribution mains (FK→reservoir) + leak reports (FK→main,
 * severity-classified) + quality samples (FK→main, alarm-classified). Registry
 * on AT PDS records (replaces D1 nodes/leaks/quality_samples). ADR-2605172000
 * kotoba.
 *
 * AXIS NOTE (ADR-2605172400): axis-clean public open-data — no PII (operator
 * DIDs + asset codes only), no settlement, no operating liability. etzhayyim
 * front.
 *
 * AT-Lexicon has no float, so all measurements are integerized:
 *   lengthM / capacityM3 / diameterMm / estLpm   — whole units
 *   residualChlorineUgL  = mg/L × 1000  (µg/L)
 *   turbidityMilliNtu    = NTU × 1000
 *   pHCenti              = pH × 100
 *
 * Identity hierarchy:
 *   did:web:open-water.etzhayyim.com                         — controller
 *   did:web:open-water.etzhayyim.com:reservoir:{nodeCode}    — a reservoir
 *   did:web:open-water.etzhayyim.com:main:{mainCode}         — a distribution main
 *   did:web:open-water.etzhayyim.com:leak:{leakId}           — a leak report
 *   did:web:open-water.etzhayyim.com:sample:{sampleId}       — a quality sample
 */

export const OWATER_DID_PREFIX = "did:web:open-water.etzhayyim.com:" as const;

export const RESERVOIR_COLLECTION = "com.etzhayyim.apps.openWater.reservoir";
export const MAIN_COLLECTION = "com.etzhayyim.apps.openWater.main";
export const LEAK_COLLECTION = "com.etzhayyim.apps.openWater.leak";
export const SAMPLE_COLLECTION = "com.etzhayyim.apps.openWater.qualitySample";

// ─── Reservoir ──────────────────────────────────────────────────────

export interface ReservoirRecord {
  did: string;
  nodeCode: string;
  name: string;
  operatorDid: string;
  /** Capacity, whole cubic metres (optional). */
  capacityM3?: number;
  createdAt: string;
}

export interface ReservoirView extends ReservoirRecord {
  reservoirUri: string;
}

export interface DefineReservoirInput {
  nodeCode: string;
  name: string;
  operatorDid: string;
  capacityM3?: number;
}

export interface DefineReservoirOutput {
  status: "defined" | "alreadyExists" | "rejected";
  reservoirUri?: string;
  did?: string;
  nodeCode?: string;
  error?: string;
}

export interface GetReservoirInput {
  nodeCode: string;
}
export interface GetReservoirOutput {
  reservoir?: ReservoirView;
  error?: string;
}
export interface ListReservoirsInput {
  operatorDid?: string;
  limit?: number;
  cursor?: string;
}
export interface ListReservoirsOutput {
  items: ReservoirView[];
  cursor?: string;
  total: number;
}

// ─── Main ───────────────────────────────────────────────────────────

export type PipeMaterial = "DI" | "ST" | "PVC" | "HDPE" | "AC";

export interface ServicePoint {
  code: string;
  name: string;
}

export interface MainRecord {
  did: string;
  mainCode: string;
  /** FK → reservoir nodeCode (origin). */
  reservoirCode: string;
  /** Nominal diameter DN, mm (25..3000). */
  diameterMm: number;
  material: PipeMaterial;
  /** Length, whole metres. */
  lengthM: number;
  servicePoints: ServicePoint[];
  createdAt: string;
}

export interface MainView extends MainRecord {
  mainUri: string;
}

export interface DefineMainInput {
  mainCode: string;
  reservoirCode: string;
  diameterMm: number;
  material: PipeMaterial;
  lengthM: number;
  servicePoints: ServicePoint[];
}

export interface DefineMainOutput {
  status: "defined" | "alreadyExists" | "rejected" | "reservoirNotFound";
  mainUri?: string;
  did?: string;
  mainCode?: string;
  error?: string;
}

export interface GetMainInput {
  mainCode: string;
}
export interface GetMainOutput {
  main?: MainView;
  error?: string;
}
export interface ListMainsInput {
  reservoirCode?: string;
  material?: PipeMaterial;
  limit?: number;
  cursor?: string;
}
export interface ListMainsOutput {
  items: MainView[];
  cursor?: string;
  total: number;
}

// ─── Leak report ────────────────────────────────────────────────────

export type LeakSeverity = "minor" | "moderate" | "major" | "critical";

export interface LeakRecord {
  did: string;
  leakId: string;
  /** FK → main mainCode. */
  mainCode: string;
  detectedAt: string;
  /** Estimated flow, whole litres/min. */
  estLpm: number;
  contaminationRisk: boolean;
  pressureLoss: boolean;
  locationDescription?: string;
  description?: string;
  /** Derived. */
  severity: LeakSeverity;
  requirePublicNotice: boolean;
  createdAt: string;
}

export interface LeakView extends LeakRecord {
  leakUri: string;
}

export interface ReportLeakInput {
  leakId: string;
  mainCode: string;
  detectedAt: string;
  estLpm: number;
  contaminationRisk?: boolean;
  pressureLoss?: boolean;
  locationDescription?: string;
  description?: string;
}

export interface ReportLeakOutput {
  status: "reported" | "alreadyExists" | "rejected" | "mainNotFound";
  leakUri?: string;
  did?: string;
  leakId?: string;
  severity?: LeakSeverity;
  requirePublicNotice?: boolean;
  error?: string;
}

export interface GetLeakInput {
  leakId: string;
}
export interface GetLeakOutput {
  leak?: LeakView;
  error?: string;
}
export interface ListLeaksInput {
  mainCode?: string;
  minSeverity?: LeakSeverity;
  since?: string;
  limit?: number;
  cursor?: string;
}
export interface ListLeaksOutput {
  items: LeakView[];
  cursor?: string;
  total: number;
}

// ─── Quality sample ─────────────────────────────────────────────────

export interface QualitySampleRecord {
  did: string;
  sampleId: string;
  /** FK → main mainCode. */
  mainCode: string;
  sampledAt: string;
  /** Residual chlorine, µg/L (= mg/L × 1000). */
  residualChlorineUgL: number;
  /** Turbidity, milli-NTU (= NTU × 1000). */
  turbidityMilliNtu: number;
  /** pH × 100. */
  pHCenti: number;
  /** Derived. */
  alarm: boolean;
  requirePublicNotice: boolean;
  createdAt: string;
}

export interface QualitySampleView extends QualitySampleRecord {
  sampleUri: string;
}

export interface RecordQualitySampleInput {
  sampleId: string;
  mainCode: string;
  sampledAt: string;
  residualChlorineUgL: number;
  turbidityMilliNtu: number;
  pHCenti: number;
}

export interface RecordQualitySampleOutput {
  status: "recorded" | "alreadyExists" | "rejected" | "mainNotFound";
  sampleUri?: string;
  did?: string;
  sampleId?: string;
  alarm?: boolean;
  requirePublicNotice?: boolean;
  error?: string;
}

export interface ListQualitySamplesInput {
  mainCode?: string;
  alarmOnly?: boolean;
  since?: string;
  limit?: number;
  cursor?: string;
}
export interface ListQualitySamplesOutput {
  items: QualitySampleView[];
  cursor?: string;
  total: number;
}

// ─── Coverage ───────────────────────────────────────────────────────

export interface CoverageInput {
  maxScan?: number;
}
export interface CoverageOutput {
  reservoirCount?: number;
  mainCount?: number;
  leakCount?: number;
  sampleCount?: number;
  leaksBySeverity?: Record<string, number>;
  alarmSamples?: number;
  truncated?: boolean;
  error?: string;
}

// ─── Classifiers (mirror the original DMN thresholds) ───────────────

export const SEVERITY_RANK: Record<LeakSeverity, number> = {
  minor: 0,
  moderate: 1,
  major: 2,
  critical: 3,
};

export function classifyLeak(input: {
  estLpm: number;
  contaminationRisk: boolean;
  pressureLoss: boolean;
}): { severity: LeakSeverity; requirePublicNotice: boolean } {
  if (input.contaminationRisk) return { severity: "critical", requirePublicNotice: true };
  if (input.estLpm >= 500) return { severity: "major", requirePublicNotice: true };
  if (input.pressureLoss) return { severity: "major", requirePublicNotice: true };
  if (input.estLpm >= 50) return { severity: "moderate", requirePublicNotice: false };
  return { severity: "minor", requirePublicNotice: false };
}

/** Thresholds: chlorine < 0.1 mg/L (100 µg/L), turbidity > 2.0 NTU (2000 mNTU), pH < 5.8 (580) or > 8.6 (860). */
export function classifyQuality(input: {
  residualChlorineUgL: number;
  turbidityMilliNtu: number;
  pHCenti: number;
}): { alarm: boolean; requirePublicNotice: boolean } {
  const alarm =
    input.residualChlorineUgL < 100 ||
    input.turbidityMilliNtu > 2000 ||
    input.pHCenti < 580 ||
    input.pHCenti > 860;
  return { alarm, requirePublicNotice: alarm };
}

// ─── Helpers ────────────────────────────────────────────────────────

export const MATERIALS: ReadonlySet<string> = new Set(["DI", "ST", "PVC", "HDPE", "AC"]);

export function reservoirDidFor(code: string): string {
  return `${OWATER_DID_PREFIX}reservoir:${code.toLowerCase()}`;
}
export function reservoirRkey(code: string): string {
  return `reservoir-${code.toLowerCase()}`;
}
export function mainDidFor(code: string): string {
  return `${OWATER_DID_PREFIX}main:${code.toLowerCase()}`;
}
export function mainRkey(code: string): string {
  return `main-${code.toLowerCase()}`;
}
export function leakDidFor(id: string): string {
  return `${OWATER_DID_PREFIX}leak:${id.toLowerCase()}`;
}
export function leakRkey(id: string): string {
  return `leak-${id.toLowerCase()}`;
}
export function sampleDidFor(id: string): string {
  return `${OWATER_DID_PREFIX}sample:${id.toLowerCase()}`;
}
export function sampleRkey(id: string): string {
  return `sample-${id.toLowerCase()}`;
}
