// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 etzhayyim Japan株式会社 / etzhayyim. All rights reserved.
// Licensed under the Apache License, Version 2.0 — see LICENSE at repo root.

// etzhayyim-project-open-water — water utility operations + network design
//
// 9 XRPC under com.etzhayyim.apps.openWater.*:
//   defineReservoir       (proc)   reservoir / pumping station node
//   defineMain            (proc)   main pipe + downstream service points
//   getNode               (query)  node detail + downstream mains
//   listMains             (query)  mains by reservoir / status
//   recordReading         (proc)   meter m³ reading
//   reportLeak            (proc)   leak with severity DMN
//   listLeaks             (query)  leaks by main / since / minSeverity
//   recordQualitySample   (proc)   residual Cl + turbidity + pH
//   listQualitySamples    (query)  samples by main / since
//
// Storage: D1. Topology = nodes (reservoir / service_point) + mains (edges).
// Leak severity via openWater.leakSeverity DMN (mirrored). Quality alarm
// uses WHO drinking-water guideline thresholds.

import AV1 from "../../dodaf/AV-1.json";
import OV1 from "../../dodaf/OV-1.json";
import OV5b from "../../dodaf/OV-5b.json";
import OV6a from "../../dodaf/OV-6a.json";
import CV2 from "../../dodaf/CV-2.json";
import SV1 from "../../dodaf/SV-1.json";
import defineMainForm from "../../forms/defineMain.form.json";
import reportLeakForm from "../../forms/reportLeak.form.json";
import { bootstrapDodaf } from "./dodaf-bootstrap";

const DODAF_VIEWS: Record<string, any> = {
  "open-water.AV-1": AV1, "open-water.OV-1": OV1, "open-water.OV-5b": OV5b,
  "open-water.OV-6a": OV6a, "open-water.CV-2": CV2, "open-water.SV-1": SV1,
};
const FORMS: Record<string, any> = {
  "openWater.defineMain.v1": defineMainForm,
  "openWater.reportLeak.v1": reportLeakForm,
};

export interface Env {
  WATER_DB: D1Database;
  PDS?: Fetcher;
  AUTH_SERVICE?: Fetcher;
  APP_HANDLE: string;
  PRIMARY_DID: string;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS nodes (
    node_did TEXT PRIMARY KEY,
    node_type TEXT NOT NULL CHECK (node_type IN ('reservoir','service_point')),
    node_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    operator_did TEXT NOT NULL,
    parent_main_did TEXT,
    capacity_m3 REAL,
    defined_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(node_type)`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_main_did)`,
  `CREATE TABLE IF NOT EXISTS mains (
    main_did TEXT PRIMARY KEY,
    main_code TEXT NOT NULL UNIQUE,
    reservoir_did TEXT NOT NULL,
    diameter_mm INTEGER NOT NULL,
    material TEXT NOT NULL,
    length_m REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'in-service',
    defined_at TEXT NOT NULL,
    FOREIGN KEY (reservoir_did) REFERENCES nodes(node_did)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mains_reservoir ON mains(reservoir_did)`,
  `CREATE TABLE IF NOT EXISTS meter_readings (
    reading_id TEXT PRIMARY KEY,
    service_point_did TEXT NOT NULL,
    main_did TEXT NOT NULL,
    read_at TEXT NOT NULL,
    cubic_m REAL NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_readings_sp_time ON meter_readings(service_point_did, read_at DESC)`,
  `CREATE TABLE IF NOT EXISTS leaks (
    leak_did TEXT PRIMARY KEY,
    main_did TEXT NOT NULL,
    detected_at TEXT NOT NULL,
    restored_at TEXT,
    est_lpm REAL NOT NULL,
    contamination_risk INTEGER NOT NULL,
    pressure_loss INTEGER NOT NULL,
    severity TEXT NOT NULL,
    require_public_notice INTEGER NOT NULL,
    location_description TEXT,
    description TEXT,
    reported_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_leaks_main_time ON leaks(main_did, detected_at DESC)`,
  `CREATE TABLE IF NOT EXISTS quality_samples (
    sample_did TEXT PRIMARY KEY,
    main_did TEXT NOT NULL,
    sampled_at TEXT NOT NULL,
    residual_chlorine_mgl REAL NOT NULL,
    turbidity_ntu REAL NOT NULL,
    ph REAL NOT NULL,
    alarm INTEGER NOT NULL,
    require_public_notice INTEGER NOT NULL,
    note TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_samples_main_time ON quality_samples(main_did, sampled_at DESC)`,
];

let schemaReady = false;
async function ensureSchema(db: D1Database) {
  if (schemaReady) return;
  for (const s of SCHEMA) await db.exec(s.replace(/\s+/g, " "));
  schemaReady = true;
}

function nanoid(len = 12): string {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  const b = crypto.getRandomValues(new Uint8Array(len));
  let o = ""; for (let i = 0; i < len; i++) o += a[b[i] % a.length]; return o;
}
const now = () => new Date().toISOString();

type XrpcError = "InvalidRequest" | "NodeNotFound" | "MainNotFound" | "Conflict" | "Unauthorized" | "InternalError";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const err = (e: XrpcError, m: string, s = 400) => json({ error: e, message: m }, s);

function classifyLeak(input: { estLpm: number; contaminationRisk: boolean; pressureLoss: boolean })
  : { severity: "minor" | "moderate" | "major" | "critical"; requirePublicNotice: boolean } {
  if (input.contaminationRisk) return { severity: "critical", requirePublicNotice: true };
  if (input.estLpm >= 500)     return { severity: "major", requirePublicNotice: true };
  if (input.pressureLoss)      return { severity: "major", requirePublicNotice: true };
  if (input.estLpm >= 50)      return { severity: "moderate", requirePublicNotice: false };
  return { severity: "minor", requirePublicNotice: false };
}

function classifyQuality(input: { residualChlorineMgL: number; turbidityNtu: number; pH: number })
  : { alarm: boolean; requirePublicNotice: boolean } {
  const alarm = input.residualChlorineMgL < 0.1
    || input.turbidityNtu > 2.0
    || input.pH < 5.8 || input.pH > 8.6;
  return { alarm, requirePublicNotice: alarm };
}

async function defineReservoir(env: Env, input: any): Promise<Response> {
  const { nodeCode, name, operatorDid, capacityM3 } = input ?? {};
  if (typeof nodeCode !== "string" || !/^[A-Z0-9-]{2,32}$/.test(nodeCode))
    return err("InvalidRequest", "nodeCode required");
  if (typeof name !== "string" || !name.length) return err("InvalidRequest", "name required");
  if (typeof operatorDid !== "string" || !operatorDid.startsWith("did:"))
    return err("InvalidRequest", "operatorDid must be a DID");
  if (capacityM3 != null && (!Number.isFinite(capacityM3) || capacityM3 < 0))
    return err("InvalidRequest", "capacityM3 must be ≥ 0");
  const id = nanoid(10);
  const nodeDid = `did:web:${env.APP_HANDLE}:node:${id}`;
  const definedAt = now();
  await env.WATER_DB.prepare(
    `INSERT INTO nodes (node_did, node_type, node_code, name, operator_did, parent_main_did, capacity_m3, defined_at)
     VALUES (?, 'reservoir', ?, ?, ?, NULL, ?, ?)`
  ).bind(nodeDid, nodeCode, name, operatorDid, capacityM3 ?? null, definedAt).run();
  return json({ nodeDid, nodeType: "reservoir", nodeCode, name, operatorDid, capacityM3: capacityM3 ?? null, definedAt });
}

async function defineMain(env: Env, input: any): Promise<Response> {
  const { reservoirDid, mainCode, diameterMm, material, lengthM, servicePoints } = input ?? {};
  if (typeof reservoirDid !== "string") return err("InvalidRequest", "reservoirDid required");
  if (typeof mainCode !== "string" || !/^[A-Z0-9-]{2,16}$/.test(mainCode))
    return err("InvalidRequest", "mainCode required");
  if (!Number.isInteger(diameterMm) || diameterMm < 25 || diameterMm > 3000)
    return err("InvalidRequest", "diameterMm must be 25..3000");
  if (typeof material !== "string") return err("InvalidRequest", "material required");
  if (!Number.isFinite(lengthM) || lengthM <= 0)
    return err("InvalidRequest", "lengthM > 0 required");
  if (!Array.isArray(servicePoints) || servicePoints.length < 1)
    return err("InvalidRequest", "servicePoints[] requires ≥ 1 entry");
  const r = await env.WATER_DB.prepare(`SELECT * FROM nodes WHERE node_did = ?`).bind(reservoirDid).first<any>();
  if (!r) return err("NodeNotFound", "reservoir not found", 404);
  if (r.node_type !== "reservoir") return err("InvalidRequest", "origin must be reservoir");

  const mid = nanoid(10);
  const mainDid = `did:web:${env.APP_HANDLE}:main:${mid}`;
  const definedAt = now();
  const stmts: D1PreparedStatement[] = [
    env.WATER_DB.prepare(
      `INSERT INTO mains (main_did, main_code, reservoir_did, diameter_mm, material, length_m, status, defined_at)
       VALUES (?, ?, ?, ?, ?, ?, 'in-service', ?)`
    ).bind(mainDid, mainCode, reservoirDid, diameterMm, material, lengthM, definedAt),
  ];
  const servicePointDids: string[] = [];
  for (const sp of servicePoints) {
    if (typeof sp?.code !== "string" || typeof sp?.name !== "string")
      return err("InvalidRequest", "service point requires {code,name}");
    const sid = nanoid(10);
    const spDid = `did:web:${env.APP_HANDLE}:node:${sid}`;
    servicePointDids.push(spDid);
    stmts.push(env.WATER_DB.prepare(
      `INSERT INTO nodes (node_did, node_type, node_code, name, operator_did, parent_main_did, capacity_m3, defined_at)
       VALUES (?, 'service_point', ?, ?, ?, ?, NULL, ?)`
    ).bind(spDid, sp.code, sp.name, r.operator_did, mainDid, definedAt));
  }
  await env.WATER_DB.batch(stmts);
  return json({ mainDid, mainCode, reservoirDid, diameterMm, material, lengthM, servicePointDids, definedAt });
}

async function getNode(env: Env, params: URLSearchParams): Promise<Response> {
  const nodeDid = params.get("nodeDid");
  if (!nodeDid) return err("InvalidRequest", "nodeDid required");
  const n = await env.WATER_DB.prepare(`SELECT * FROM nodes WHERE node_did = ?`).bind(nodeDid).first<any>();
  if (!n) return err("NodeNotFound", "no such node", 404);
  let downstream: any[] = [];
  if (n.node_type === "reservoir") {
    const m = await env.WATER_DB.prepare(`SELECT * FROM mains WHERE reservoir_did = ?`).bind(nodeDid).all<any>();
    downstream = (m.results ?? []).map((r) => ({
      mainDid: r.main_did, mainCode: r.main_code, diameterMm: r.diameter_mm,
      material: r.material, lengthM: r.length_m, status: r.status,
    }));
  }
  return json({
    nodeDid: n.node_did, nodeType: n.node_type, nodeCode: n.node_code, name: n.name,
    operatorDid: n.operator_did, parentMainDid: n.parent_main_did ?? undefined,
    capacityM3: n.capacity_m3 ?? undefined, definedAt: n.defined_at,
    downstreamMains: downstream,
  });
}

async function listMains(env: Env, params: URLSearchParams): Promise<Response> {
  const reservoirDid = params.get("reservoirDid");
  const status = params.get("status");
  const limit = Math.min(500, Math.max(1, Number(params.get("limit") ?? 100)));
  const offset = Math.max(0, Number(params.get("offset") ?? 0));
  const clauses: string[] = []; const binds: any[] = [];
  if (reservoirDid) { clauses.push(`reservoir_did = ?`); binds.push(reservoirDid); }
  if (status) { clauses.push(`status = ?`); binds.push(status); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = await env.WATER_DB.prepare(`SELECT COUNT(*) AS c FROM mains ${where}`)
    .bind(...binds).first<{ c: number }>();
  const rows = await env.WATER_DB.prepare(
    `SELECT * FROM mains ${where} ORDER BY defined_at DESC LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all<any>();
  return json({
    mains: (rows.results ?? []).map((r) => ({
      mainDid: r.main_did, mainCode: r.main_code, reservoirDid: r.reservoir_did,
      diameterMm: r.diameter_mm, material: r.material, lengthM: r.length_m,
      status: r.status, definedAt: r.defined_at,
    })),
    total: Number(total?.c ?? 0), offset, limit,
  });
}

async function recordReading(env: Env, input: any): Promise<Response> {
  const { servicePointDid, readAt, cubicM } = input ?? {};
  if (typeof servicePointDid !== "string") return err("InvalidRequest", "servicePointDid required");
  if (typeof readAt !== "string") return err("InvalidRequest", "readAt required");
  if (!Number.isFinite(cubicM) || cubicM < 0) return err("InvalidRequest", "cubicM ≥ 0");
  const sp = await env.WATER_DB.prepare(`SELECT * FROM nodes WHERE node_did = ? AND node_type = 'service_point'`)
    .bind(servicePointDid).first<any>();
  if (!sp) return err("NodeNotFound", "service point not found", 404);
  if (!sp.parent_main_did) return err("Conflict", "service point not connected to a main", 409);
  const last = await env.WATER_DB.prepare(
    `SELECT cubic_m FROM meter_readings WHERE service_point_did = ? ORDER BY read_at DESC LIMIT 1`
  ).bind(servicePointDid).first<{ cubic_m: number }>();
  if (last && cubicM < last.cubic_m) return err("Conflict", "reading not monotonic", 409);
  const id = `r_${nanoid(14)}`;
  await env.WATER_DB.prepare(
    `INSERT INTO meter_readings (reading_id, service_point_did, main_did, read_at, cubic_m) VALUES (?, ?, ?, ?, ?)`
  ).bind(id, servicePointDid, sp.parent_main_did, readAt, cubicM).run();
  return json({ readingId: id, servicePointDid, mainDid: sp.parent_main_did, readAt, cubicM });
}

async function reportLeak(env: Env, input: any): Promise<Response> {
  const { mainDid, detectedAt, restoredAt, estLpm, contaminationRisk, pressureLoss, locationDescription, description } = input ?? {};
  if (typeof mainDid !== "string") return err("InvalidRequest", "mainDid required");
  if (typeof detectedAt !== "string") return err("InvalidRequest", "detectedAt required");
  if (!Number.isFinite(estLpm) || estLpm < 0) return err("InvalidRequest", "estLpm ≥ 0");
  const m = await env.WATER_DB.prepare(`SELECT main_did FROM mains WHERE main_did = ?`).bind(mainDid).first<any>();
  if (!m) return err("MainNotFound", "no such main", 404);
  const { severity, requirePublicNotice } = classifyLeak({
    estLpm: Number(estLpm), contaminationRisk: !!contaminationRisk, pressureLoss: !!pressureLoss,
  });
  const id = nanoid(12);
  const leakDid = `did:web:${env.APP_HANDLE}:leak:${id}`;
  const reportedAt = now();
  await env.WATER_DB.prepare(
    `INSERT INTO leaks (leak_did, main_did, detected_at, restored_at, est_lpm, contamination_risk, pressure_loss, severity, require_public_notice, location_description, description, reported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(leakDid, mainDid, detectedAt, restoredAt ?? null, estLpm,
         contaminationRisk ? 1 : 0, pressureLoss ? 1 : 0, severity,
         requirePublicNotice ? 1 : 0, locationDescription ?? null, description ?? null, reportedAt).run();
  if (requirePublicNotice && env.PDS) {
    try {
      await env.PDS.fetch(`https://atproto.etzhayyim.com/xrpc/com.atproto.repo.createRecord`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repo: env.PRIMARY_DID, collection: "app.bsky.feed.post",
          record: {
            $type: "app.bsky.feed.post",
            text: `[${severity.toUpperCase()}] water leak on ${mainDid} (~${estLpm} L/min${contaminationRisk ? ", contamination risk" : ""})`,
            createdAt: reportedAt,
          },
        }),
      });
    } catch {}
  }
  return json({ leakDid, mainDid, severity, requirePublicNotice, reportedAt });
}

async function listLeaks(env: Env, params: URLSearchParams): Promise<Response> {
  const mainDid = params.get("mainDid");
  const since = params.get("since");
  const minSeverity = params.get("minSeverity");
  const limit = Math.min(500, Math.max(1, Number(params.get("limit") ?? 100)));
  const offset = Math.max(0, Number(params.get("offset") ?? 0));
  const rank = (s: string) => ({ minor: 0, moderate: 1, major: 2, critical: 3 } as any)[s] ?? -1;
  const clauses: string[] = []; const binds: any[] = [];
  if (mainDid) { clauses.push(`main_did = ?`); binds.push(mainDid); }
  if (since)   { clauses.push(`detected_at >= ?`); binds.push(since); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = await env.WATER_DB.prepare(`SELECT COUNT(*) AS c FROM leaks ${where}`)
    .bind(...binds).first<{ c: number }>();
  const rows = await env.WATER_DB.prepare(
    `SELECT * FROM leaks ${where} ORDER BY detected_at DESC LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all<any>();
  let leaks = (rows.results ?? []).map((r) => ({
    leakDid: r.leak_did, mainDid: r.main_did, detectedAt: r.detected_at,
    restoredAt: r.restored_at ?? undefined, estLpm: r.est_lpm,
    contaminationRisk: !!r.contamination_risk, pressureLoss: !!r.pressure_loss,
    severity: r.severity, requirePublicNotice: !!r.require_public_notice,
    locationDescription: r.location_description ?? undefined,
    description: r.description ?? undefined, reportedAt: r.reported_at,
  }));
  if (minSeverity) leaks = leaks.filter((l) => rank(l.severity) >= rank(minSeverity));
  return json({ leaks, total: Number(total?.c ?? 0), offset, limit });
}

async function recordQualitySample(env: Env, input: any): Promise<Response> {
  const { mainDid, sampledAt, residualChlorineMgL, turbidityNtu, pH, note } = input ?? {};
  if (typeof mainDid !== "string") return err("InvalidRequest", "mainDid required");
  if (typeof sampledAt !== "string") return err("InvalidRequest", "sampledAt required");
  if (!Number.isFinite(residualChlorineMgL) || residualChlorineMgL < 0)
    return err("InvalidRequest", "residualChlorineMgL ≥ 0 required");
  if (!Number.isFinite(turbidityNtu) || turbidityNtu < 0)
    return err("InvalidRequest", "turbidityNtu ≥ 0 required");
  if (!Number.isFinite(pH) || pH < 0 || pH > 14)
    return err("InvalidRequest", "pH must be 0..14");
  const m = await env.WATER_DB.prepare(`SELECT main_did FROM mains WHERE main_did = ?`).bind(mainDid).first<any>();
  if (!m) return err("MainNotFound", "no such main", 404);
  const { alarm, requirePublicNotice } = classifyQuality({ residualChlorineMgL, turbidityNtu, pH });
  const id = nanoid(12);
  const sampleDid = `did:web:${env.APP_HANDLE}:sample:${id}`;
  await env.WATER_DB.prepare(
    `INSERT INTO quality_samples (sample_did, main_did, sampled_at, residual_chlorine_mgl, turbidity_ntu, ph, alarm, require_public_notice, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(sampleDid, mainDid, sampledAt, residualChlorineMgL, turbidityNtu, pH,
         alarm ? 1 : 0, requirePublicNotice ? 1 : 0, note ?? null).run();
  if (alarm && env.PDS) {
    try {
      await env.PDS.fetch(`https://atproto.etzhayyim.com/xrpc/com.atproto.repo.createRecord`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repo: env.PRIMARY_DID, collection: "app.bsky.feed.post",
          record: {
            $type: "app.bsky.feed.post",
            text: `[QUALITY ALARM] water sample on ${mainDid} (Cl ${residualChlorineMgL} mg/L, turbidity ${turbidityNtu} NTU, pH ${pH})`,
            createdAt: now(),
          },
        }),
      });
    } catch {}
  }
  return json({ sampleDid, mainDid, alarm, requirePublicNotice, sampledAt });
}

async function listQualitySamples(env: Env, params: URLSearchParams): Promise<Response> {
  const mainDid = params.get("mainDid");
  if (!mainDid) return err("InvalidRequest", "mainDid required");
  const since = params.get("since");
  const limit = Math.min(500, Math.max(1, Number(params.get("limit") ?? 100)));
  const offset = Math.max(0, Number(params.get("offset") ?? 0));
  const clauses = [`main_did = ?`]; const binds: any[] = [mainDid];
  if (since) { clauses.push(`sampled_at >= ?`); binds.push(since); }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const total = await env.WATER_DB.prepare(`SELECT COUNT(*) AS c FROM quality_samples ${where}`)
    .bind(...binds).first<{ c: number }>();
  const rows = await env.WATER_DB.prepare(
    `SELECT * FROM quality_samples ${where} ORDER BY sampled_at DESC LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all<any>();
  return json({
    samples: (rows.results ?? []).map((r) => ({
      sampleDid: r.sample_did, mainDid: r.main_did, sampledAt: r.sampled_at,
      residualChlorineMgL: r.residual_chlorine_mgl, turbidityNtu: r.turbidity_ntu,
      pH: r.ph, alarm: !!r.alarm, requirePublicNotice: !!r.require_public_notice,
      note: r.note ?? undefined,
    })),
    total: Number(total?.c ?? 0), offset, limit,
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      await ensureSchema(env.WATER_DB);
      const url = new URL(req.url);
      if (url.pathname === "/health" || url.pathname === "/_worker/health")
        return json({ ok: true, did: env.PRIMARY_DID, ts: now() });
      if (url.pathname === "/_app/meta") {
        if (env.PDS) { try { await bootstrapDodaf(env as any); } catch {} }
        return json({
          did: env.PRIMARY_DID, handle: env.APP_HANDLE,
          xrpc: [
            "com.etzhayyim.apps.openWater.defineReservoir",
            "com.etzhayyim.apps.openWater.defineMain",
            "com.etzhayyim.apps.openWater.getNode",
            "com.etzhayyim.apps.openWater.listMains",
            "com.etzhayyim.apps.openWater.recordReading",
            "com.etzhayyim.apps.openWater.reportLeak",
            "com.etzhayyim.apps.openWater.listLeaks",
            "com.etzhayyim.apps.openWater.recordQualitySample",
            "com.etzhayyim.apps.openWater.listQualitySamples",
          ],
          dodaf: Object.keys(DODAF_VIEWS), forms: Object.keys(FORMS),
          bpmn: ["defineMain", "reportLeak"], dmn: ["openWater.leakSeverity"],
        });
      }
      if (url.pathname === "/dodaf")
        return json({ views: Object.entries(DODAF_VIEWS).map(([id, v]: any) => ({
          viewId: id, viewType: v.viewType, title: v.title, version: v.version })) });
      if (url.pathname.startsWith("/dodaf/")) {
        const id = decodeURIComponent(url.pathname.slice("/dodaf/".length));
        const v = DODAF_VIEWS[id];
        return v ? json(v) : err("InvalidRequest", `no such view: ${id}`, 404);
      }
      if (url.pathname === "/forms")
        return json({ forms: Object.values(FORMS).map((f: any) => ({ formKey: f.formKey, name: f.name, version: f.version })) });
      if (url.pathname.startsWith("/forms/")) {
        const k = decodeURIComponent(url.pathname.slice("/forms/".length));
        const f = FORMS[k];
        return f ? json(f) : err("InvalidRequest", `no such form: ${k}`, 404);
      }
      if (!url.pathname.startsWith("/xrpc/"))
        return err("InvalidRequest", "only /xrpc/* is served", 404);
      const nsid = url.pathname.slice("/xrpc/".length);
      if (req.method === "GET") {
        switch (nsid) {
          case "com.etzhayyim.apps.openWater.getNode":             return await getNode(env, url.searchParams);
          case "com.etzhayyim.apps.openWater.listMains":           return await listMains(env, url.searchParams);
          case "com.etzhayyim.apps.openWater.listLeaks":           return await listLeaks(env, url.searchParams);
          case "com.etzhayyim.apps.openWater.listQualitySamples":  return await listQualitySamples(env, url.searchParams);
          default: return err("InvalidRequest", `unknown query NSID: ${nsid}`, 404);
        }
      }
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        switch (nsid) {
          case "com.etzhayyim.apps.openWater.defineReservoir":      return await defineReservoir(env, body);
          case "com.etzhayyim.apps.openWater.defineMain":           return await defineMain(env, body);
          case "com.etzhayyim.apps.openWater.recordReading":        return await recordReading(env, body);
          case "com.etzhayyim.apps.openWater.reportLeak":           return await reportLeak(env, body);
          case "com.etzhayyim.apps.openWater.recordQualitySample":  return await recordQualitySample(env, body);
          default: return err("InvalidRequest", `unknown procedure NSID: ${nsid}`, 404);
        }
      }
      return err("InvalidRequest", "method not allowed", 405);
    } catch (e: any) {
      return err("InternalError", e?.message ?? String(e), 500);
    }
  },
};
