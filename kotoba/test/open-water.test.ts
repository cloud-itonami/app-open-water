import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
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
} from "../src/index.js";

const OP = "did:web:city-water.example.com";

describe("open-water kotoba", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: "did:web:open-water.etzhayyim.com" });
  });

  describe("reservoir + main", () => {
    beforeEach(async () => {
      await defineReservoir(e, { nodeCode: "RES-1", name: "Highland Reservoir", operatorDid: OP, capacityM3: 50000 });
    });
    it("defines reservoir + a main over it", async () => {
      expect((await getReservoir(e, { nodeCode: "RES-1" })).reservoir?.name).toBe("Highland Reservoir");
      expect((await listReservoirs(e, { operatorDid: OP })).total).toBe(1);
      const r = await defineMain(e, { mainCode: "M-100", reservoirCode: "RES-1", diameterMm: 300, material: "DI", lengthM: 1200, servicePoints: [{ code: "SP1", name: "Block A" }] });
      expect(r.status).toBe("defined");
      expect((await getMain(e, { mainCode: "M-100" })).main?.material).toBe("DI");
      expect((await listMains(e, { reservoirCode: "RES-1" })).total).toBe(1);
      expect((await listMains(e, { material: "PVC" })).total).toBe(0);
    });
    it("rejects bad diameter/material/length + missing reservoir + non-int length", async () => {
      expect((await defineMain(e, { mainCode: "M-X", reservoirCode: "RES-1", diameterMm: 10, material: "DI", lengthM: 1, servicePoints: [{ code: "a", name: "b" }] })).status).toBe("rejected");
      expect((await defineMain(e, { mainCode: "M-X", reservoirCode: "RES-1", diameterMm: 100, material: "XYZ" as any, lengthM: 1, servicePoints: [{ code: "a", name: "b" }] })).status).toBe("rejected");
      expect((await defineMain(e, { mainCode: "M-X", reservoirCode: "RES-1", diameterMm: 100, material: "DI", lengthM: 1.5, servicePoints: [{ code: "a", name: "b" }] })).status).toBe("rejected");
      expect((await defineMain(e, { mainCode: "M-X", reservoirCode: "GHOST", diameterMm: 100, material: "DI", lengthM: 1, servicePoints: [{ code: "a", name: "b" }] })).status).toBe("reservoirNotFound");
    });
  });

  describe("leak report + severity", () => {
    beforeEach(async () => {
      await defineReservoir(e, { nodeCode: "RES-1", name: "R", operatorDid: OP });
      await defineMain(e, { mainCode: "M-100", reservoirCode: "RES-1", diameterMm: 300, material: "DI", lengthM: 1200, servicePoints: [{ code: "SP1", name: "A" }] });
    });
    it("classifies severity + requires public notice on contamination", async () => {
      const minor = await reportLeak(e, { leakId: "L-1", mainCode: "M-100", detectedAt: "2026-06-01T00:00:00Z", estLpm: 10 });
      expect(minor.severity).toBe("minor");
      expect(minor.requirePublicNotice).toBe(false);
      const crit = await reportLeak(e, { leakId: "L-2", mainCode: "M-100", detectedAt: "2026-06-02T00:00:00Z", estLpm: 5, contaminationRisk: true });
      expect(crit.severity).toBe("critical");
      expect(crit.requirePublicNotice).toBe(true);
      const major = await reportLeak(e, { leakId: "L-3", mainCode: "M-100", detectedAt: "2026-06-03T00:00:00Z", estLpm: 600 });
      expect(major.severity).toBe("major");
      expect((await getLeak(e, { leakId: "L-2" })).leak?.severity).toBe("critical");
    });
    it("rejects missing main + filters by minSeverity/since", async () => {
      expect((await reportLeak(e, { leakId: "L-X", mainCode: "GHOST", detectedAt: "2026-06-01T00:00:00Z", estLpm: 1 })).status).toBe("mainNotFound");
      await reportLeak(e, { leakId: "L-1", mainCode: "M-100", detectedAt: "2026-06-01T00:00:00Z", estLpm: 10 }); // minor
      await reportLeak(e, { leakId: "L-2", mainCode: "M-100", detectedAt: "2026-06-05T00:00:00Z", estLpm: 600 }); // major
      expect((await listLeaks(e, { mainCode: "M-100", minSeverity: "major" })).total).toBe(1);
      expect((await listLeaks(e, { since: "2026-06-03T00:00:00Z" })).total).toBe(1);
    });
  });

  describe("quality sample + alarm + coverage", () => {
    beforeEach(async () => {
      await defineReservoir(e, { nodeCode: "RES-1", name: "R", operatorDid: OP });
      await defineMain(e, { mainCode: "M-100", reservoirCode: "RES-1", diameterMm: 300, material: "DI", lengthM: 1200, servicePoints: [{ code: "SP1", name: "A" }] });
    });
    it("alarms on low chlorine / high turbidity / out-of-range pH (integerized)", async () => {
      const ok = await recordQualitySample(e, { sampleId: "Q-1", mainCode: "M-100", sampledAt: "2026-06-01T00:00:00Z", residualChlorineUgL: 500, turbidityMilliNtu: 300, pHCenti: 720 });
      expect(ok.alarm).toBe(false);
      const lowCl = await recordQualitySample(e, { sampleId: "Q-2", mainCode: "M-100", sampledAt: "2026-06-02T00:00:00Z", residualChlorineUgL: 50, turbidityMilliNtu: 300, pHCenti: 720 });
      expect(lowCl.alarm).toBe(true);
      const badPh = await recordQualitySample(e, { sampleId: "Q-3", mainCode: "M-100", sampledAt: "2026-06-03T00:00:00Z", residualChlorineUgL: 500, turbidityMilliNtu: 300, pHCenti: 900 });
      expect(badPh.alarm).toBe(true);
      expect((await listQualitySamples(e, { mainCode: "M-100", alarmOnly: true })).total).toBe(2);
      expect((await recordQualitySample(e, { sampleId: "Q-X", mainCode: "GHOST", sampledAt: "x", residualChlorineUgL: 1, turbidityMilliNtu: 1, pHCenti: 700 })).status).toBe("mainNotFound");
    });
    it("coverage rolls up all four registries", async () => {
      await reportLeak(e, { leakId: "L-1", mainCode: "M-100", detectedAt: "2026-06-01T00:00:00Z", estLpm: 600 }); // major
      await recordQualitySample(e, { sampleId: "Q-1", mainCode: "M-100", sampledAt: "2026-06-01T00:00:00Z", residualChlorineUgL: 50, turbidityMilliNtu: 300, pHCenti: 720 }); // alarm
      const cov = await coverage(e);
      expect(cov.reservoirCount).toBe(1);
      expect(cov.mainCount).toBe(1);
      expect(cov.leakCount).toBe(1);
      expect(cov.leaksBySeverity?.major).toBe(1);
      expect(cov.sampleCount).toBe(1);
      expect(cov.alarmSamples).toBe(1);
    });
  });
});
