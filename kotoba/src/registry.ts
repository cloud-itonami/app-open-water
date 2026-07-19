/**
 * open-water kotoba — reservoir + main + leak + quality-sample registries
 * + coverage. AT PDS records (no RW/D1). A main references an existing
 * reservoir; a leak / quality sample references an existing main. Leak severity
 * and sample alarm are derived on write (mirrors the original DMN).
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  LEAK_COLLECTION,
  MAIN_COLLECTION,
  MATERIALS,
  RESERVOIR_COLLECTION,
  SAMPLE_COLLECTION,
  SEVERITY_RANK,
  classifyLeak,
  classifyQuality,
  leakDidFor,
  leakRkey,
  mainDidFor,
  mainRkey,
  reservoirDidFor,
  reservoirRkey,
  sampleDidFor,
  sampleRkey,
  type CoverageInput,
  type CoverageOutput,
  type DefineMainInput,
  type DefineMainOutput,
  type DefineReservoirInput,
  type DefineReservoirOutput,
  type GetLeakInput,
  type GetLeakOutput,
  type GetMainInput,
  type GetMainOutput,
  type GetReservoirInput,
  type GetReservoirOutput,
  type LeakRecord,
  type LeakSeverity,
  type LeakView,
  type ListLeaksInput,
  type ListLeaksOutput,
  type ListMainsInput,
  type ListMainsOutput,
  type ListQualitySamplesInput,
  type ListQualitySamplesOutput,
  type ListReservoirsInput,
  type ListReservoirsOutput,
  type MainRecord,
  type MainView,
  type QualitySampleRecord,
  type QualitySampleView,
  type RecordQualitySampleInput,
  type RecordQualitySampleOutput,
  type ReportLeakInput,
  type ReportLeakOutput,
  type ReservoirRecord,
  type ReservoirView,
} from "./types.js";

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

async function exists(e: Etzhayyim, collection: string, rkey: string): Promise<boolean> {
  const resp = await e.read({ collection, rkey }).catch(() => ({ records: [] }));
  return Boolean(resp.records[0]?.value);
}

function isPosInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}
function isNonNegInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

// ─── Reservoir ──────────────────────────────────────────────────────

export async function defineReservoir(e: Etzhayyim, input: DefineReservoirInput): Promise<DefineReservoirOutput> {
  if (!input.nodeCode || !/^[A-Z0-9-]{2,32}$/.test(input.nodeCode)) return { status: "rejected", error: "invalidNodeCode" };
  if (!input.name) return { status: "rejected", error: "missingName" };
  if (!input.operatorDid || !input.operatorDid.startsWith("did:")) return { status: "rejected", error: "invalidOperatorDid" };
  if (input.capacityM3 != null && !isNonNegInt(input.capacityM3)) return { status: "rejected", error: "capacityM3MustBeNonNegInt" };
  const rkey = reservoirRkey(input.nodeCode);
  const existing = await e.read<ReservoirRecord>({ collection: RESERVOIR_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", reservoirUri: existing.records[0].uri, did: existing.records[0].value.did, nodeCode: input.nodeCode };
  }
  const did = reservoirDidFor(input.nodeCode);
  const record: ReservoirRecord = {
    did,
    nodeCode: input.nodeCode,
    name: input.name,
    operatorDid: input.operatorDid,
    capacityM3: input.capacityM3,
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({ collection: RESERVOIR_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "defined", reservoirUri: receipt.uri, did, nodeCode: input.nodeCode };
}

export async function getReservoir(e: Etzhayyim, input: GetReservoirInput): Promise<GetReservoirOutput> {
  if (!input.nodeCode) return { error: "invalidNodeCode" };
  const resp = await e.read<ReservoirRecord>({ collection: RESERVOIR_COLLECTION, rkey: reservoirRkey(input.nodeCode) }).catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r) return { error: "notFound" };
  return { reservoir: { ...r.value, reservoirUri: r.uri } };
}

export async function listReservoirs(e: Etzhayyim, input: ListReservoirsInput = {}): Promise<ListReservoirsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<ReservoirRecord>({ collection: RESERVOIR_COLLECTION, cursor: input.cursor, limit });
  const items: ReservoirView[] = resp.records
    .filter((r) => (input.operatorDid ? r.value.operatorDid === input.operatorDid : true))
    .map((r) => ({ ...r.value, reservoirUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Main ───────────────────────────────────────────────────────────

export async function defineMain(e: Etzhayyim, input: DefineMainInput): Promise<DefineMainOutput> {
  if (!input.mainCode || !/^[A-Z0-9-]{2,16}$/.test(input.mainCode)) return { status: "rejected", error: "invalidMainCode" };
  if (!input.reservoirCode) return { status: "rejected", error: "missingReservoirCode" };
  if (!Number.isInteger(input.diameterMm) || input.diameterMm < 25 || input.diameterMm > 3000) {
    return { status: "rejected", error: "diameterMmMustBe25to3000" };
  }
  if (!input.material || !MATERIALS.has(input.material)) return { status: "rejected", error: "invalidMaterial" };
  if (!isPosInt(input.lengthM)) return { status: "rejected", error: "lengthMMustBePosInt" };
  if (!Array.isArray(input.servicePoints) || input.servicePoints.length < 1) {
    return { status: "rejected", error: "servicePointsRequired" };
  }
  for (const sp of input.servicePoints) {
    if (!sp || !sp.code || !sp.name) return { status: "rejected", error: "invalidServicePoint" };
  }
  if (!(await exists(e, RESERVOIR_COLLECTION, reservoirRkey(input.reservoirCode)))) {
    return { status: "reservoirNotFound", error: `reservoirNotFound:${input.reservoirCode}` };
  }
  const rkey = mainRkey(input.mainCode);
  const existing = await e.read<MainRecord>({ collection: MAIN_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", mainUri: existing.records[0].uri, did: existing.records[0].value.did, mainCode: input.mainCode };
  }
  const did = mainDidFor(input.mainCode);
  const record: MainRecord = {
    did,
    mainCode: input.mainCode,
    reservoirCode: input.reservoirCode,
    diameterMm: input.diameterMm,
    material: input.material,
    lengthM: input.lengthM,
    servicePoints: input.servicePoints.map((s) => ({ code: s.code, name: s.name })),
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({ collection: MAIN_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "defined", mainUri: receipt.uri, did, mainCode: input.mainCode };
}

export async function getMain(e: Etzhayyim, input: GetMainInput): Promise<GetMainOutput> {
  if (!input.mainCode) return { error: "invalidMainCode" };
  const resp = await e.read<MainRecord>({ collection: MAIN_COLLECTION, rkey: mainRkey(input.mainCode) }).catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r) return { error: "notFound" };
  return { main: { ...r.value, mainUri: r.uri } };
}

export async function listMains(e: Etzhayyim, input: ListMainsInput = {}): Promise<ListMainsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<MainRecord>({ collection: MAIN_COLLECTION, cursor: input.cursor, limit });
  const items: MainView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.reservoirCode && v.reservoirCode !== input.reservoirCode) return false;
      if (input.material && v.material !== input.material) return false;
      return true;
    })
    .map((r) => ({ ...r.value, mainUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Leak report ────────────────────────────────────────────────────

export async function reportLeak(e: Etzhayyim, input: ReportLeakInput): Promise<ReportLeakOutput> {
  if (!input.leakId) return { status: "rejected", error: "missingLeakId" };
  if (!input.mainCode) return { status: "rejected", error: "missingMainCode" };
  if (!input.detectedAt) return { status: "rejected", error: "missingDetectedAt" };
  if (!isNonNegInt(input.estLpm)) return { status: "rejected", error: "estLpmMustBeNonNegInt" };
  if (!(await exists(e, MAIN_COLLECTION, mainRkey(input.mainCode)))) {
    return { status: "mainNotFound", error: `mainNotFound:${input.mainCode}` };
  }
  const rkey = leakRkey(input.leakId);
  const existing = await e.read<LeakRecord>({ collection: LEAK_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", leakUri: existing.records[0].uri, did: existing.records[0].value.did, leakId: input.leakId };
  }
  const contaminationRisk = Boolean(input.contaminationRisk);
  const pressureLoss = Boolean(input.pressureLoss);
  const { severity, requirePublicNotice } = classifyLeak({ estLpm: input.estLpm, contaminationRisk, pressureLoss });
  const did = leakDidFor(input.leakId);
  const record: LeakRecord = {
    did,
    leakId: input.leakId,
    mainCode: input.mainCode,
    detectedAt: input.detectedAt,
    estLpm: input.estLpm,
    contaminationRisk,
    pressureLoss,
    locationDescription: input.locationDescription,
    description: input.description,
    severity,
    requirePublicNotice,
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({ collection: LEAK_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "reported", leakUri: receipt.uri, did, leakId: input.leakId, severity, requirePublicNotice };
}

export async function getLeak(e: Etzhayyim, input: GetLeakInput): Promise<GetLeakOutput> {
  if (!input.leakId) return { error: "invalidLeakId" };
  const resp = await e.read<LeakRecord>({ collection: LEAK_COLLECTION, rkey: leakRkey(input.leakId) }).catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r) return { error: "notFound" };
  return { leak: { ...r.value, leakUri: r.uri } };
}

export async function listLeaks(e: Etzhayyim, input: ListLeaksInput = {}): Promise<ListLeaksOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const minRank = input.minSeverity ? SEVERITY_RANK[input.minSeverity] : 0;
  const resp = await e.read<LeakRecord>({ collection: LEAK_COLLECTION, cursor: input.cursor, limit });
  const items: LeakView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.mainCode && v.mainCode !== input.mainCode) return false;
      if (input.minSeverity && SEVERITY_RANK[v.severity as LeakSeverity] < minRank) return false;
      if (input.since && v.detectedAt < input.since) return false;
      return true;
    })
    .map((r) => ({ ...r.value, leakUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Quality sample ─────────────────────────────────────────────────

export async function recordQualitySample(e: Etzhayyim, input: RecordQualitySampleInput): Promise<RecordQualitySampleOutput> {
  if (!input.sampleId) return { status: "rejected", error: "missingSampleId" };
  if (!input.mainCode) return { status: "rejected", error: "missingMainCode" };
  if (!input.sampledAt) return { status: "rejected", error: "missingSampledAt" };
  if (!isNonNegInt(input.residualChlorineUgL)) return { status: "rejected", error: "residualChlorineUgLMustBeNonNegInt" };
  if (!isNonNegInt(input.turbidityMilliNtu)) return { status: "rejected", error: "turbidityMilliNtuMustBeNonNegInt" };
  if (!isNonNegInt(input.pHCenti)) return { status: "rejected", error: "pHCentiMustBeNonNegInt" };
  if (!(await exists(e, MAIN_COLLECTION, mainRkey(input.mainCode)))) {
    return { status: "mainNotFound", error: `mainNotFound:${input.mainCode}` };
  }
  const rkey = sampleRkey(input.sampleId);
  const existing = await e.read<QualitySampleRecord>({ collection: SAMPLE_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", sampleUri: existing.records[0].uri, did: existing.records[0].value.did, sampleId: input.sampleId };
  }
  const { alarm, requirePublicNotice } = classifyQuality({
    residualChlorineUgL: input.residualChlorineUgL,
    turbidityMilliNtu: input.turbidityMilliNtu,
    pHCenti: input.pHCenti,
  });
  const did = sampleDidFor(input.sampleId);
  const record: QualitySampleRecord = {
    did,
    sampleId: input.sampleId,
    mainCode: input.mainCode,
    sampledAt: input.sampledAt,
    residualChlorineUgL: input.residualChlorineUgL,
    turbidityMilliNtu: input.turbidityMilliNtu,
    pHCenti: input.pHCenti,
    alarm,
    requirePublicNotice,
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({ collection: SAMPLE_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "recorded", sampleUri: receipt.uri, did, sampleId: input.sampleId, alarm, requirePublicNotice };
}

export async function listQualitySamples(e: Etzhayyim, input: ListQualitySamplesInput = {}): Promise<ListQualitySamplesOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<QualitySampleRecord>({ collection: SAMPLE_COLLECTION, cursor: input.cursor, limit });
  const items: QualitySampleView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.mainCode && v.mainCode !== input.mainCode) return false;
      if (input.alarmOnly && !v.alarm) return false;
      if (input.since && v.sampledAt < input.since) return false;
      return true;
    })
    .map((r) => ({ ...r.value, sampleUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Coverage ───────────────────────────────────────────────────────

async function countAll<T>(e: Etzhayyim, collection: string, maxScan: number, onRow: (v: T) => void): Promise<number> {
  let cursor: string | undefined;
  let scanned = 0;
  while (scanned < maxScan) {
    const page = await e.read<T>({ collection, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      if (scanned >= maxScan) break;
      onRow(r.value);
      scanned += 1;
    }
    if (scanned >= maxScan || !page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  return scanned;
}

export async function coverage(e: Etzhayyim, input: CoverageInput = {}): Promise<CoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);
  const reservoirCount = await countAll<ReservoirRecord>(e, RESERVOIR_COLLECTION, maxScan, () => {});
  const mainCount = await countAll<MainRecord>(e, MAIN_COLLECTION, maxScan, () => {});
  const leaksBySeverity: Record<string, number> = {};
  const leakCount = await countAll<LeakRecord>(e, LEAK_COLLECTION, maxScan, (v) => {
    leaksBySeverity[v.severity] = (leaksBySeverity[v.severity] ?? 0) + 1;
  });
  let alarmSamples = 0;
  const sampleCount = await countAll<QualitySampleRecord>(e, SAMPLE_COLLECTION, maxScan, (v) => {
    if (v.alarm) alarmSamples += 1;
  });
  return {
    reservoirCount,
    mainCount,
    leakCount,
    sampleCount,
    leaksBySeverity,
    alarmSamples,
    truncated:
      reservoirCount >= maxScan || mainCount >= maxScan || leakCount >= maxScan || sampleCount >= maxScan,
  };
}
