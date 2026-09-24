/**
 * The `?qrperf` fused tally's pose-quality part (QR near-frontal pose plan
 * §25).
 *
 * Why these tests matter: field test A could not say whether the fused pose
 * the overlay shows is steadier, or closer to vertical on a wall, than the
 * single-frame poses - the report's pose section measures the RAW solves.
 * These two numbers, taken over the STABLE fused results (what the overlay
 * shows), answer that; the wall elevation is the one absolute check, since
 * a wall code's normal has elevation 0.
 */
import { describe, expect, it } from "vitest";
import type { QrFusedPose } from "gps-plus-slam-app-framework/ar/qr";
import { createFusedTally } from "./fused-tally.js";

/** A stable joint result whose code normal is tilted `elevDeg` up (about x). */
function tilted(elevDeg: number, over: Partial<QrFusedPose> = {}): QrFusedPose {
  const h = (-elevDeg * Math.PI) / 360;
  return {
    status: "stable",
    pose: { position: [0, 0, 0], rotation: [Math.sin(h), 0, 0, Math.cos(h)] },
    method: "joint",
    views: 7,
    droppedViews: 0,
    fitPx: 0.6,
    windowEntries: 7,
    averagedRotationDeltaDeg: 1,
    frameEpoch: 0,
    oldestTimestamp: 0,
    newestTimestamp: 0,
    motion: null,
    ...over,
  };
}

describe("createFusedTally pose quality", () => {
  it("measures the stable fused pose's wall elevation", () => {
    const t = createFusedTally();
    t.add(tilted(2), 0);
    t.add(tilted(4), 100);
    t.add(tilted(-1), 200);
    const s = t.summary();
    expect(s.wallElevationDeg.n).toBe(3);
    expect(s.wallElevationDeg.meanSigned).toBeCloseTo(5 / 3, 6);
    expect(s.wallElevationDeg.p50Abs).toBeCloseTo(2, 6);
  });

  // Jumps pair consecutive STABLE results within 1 s, like the raw measure;
  // a measuring result (the overlay shows the raw pose then) is left out.
  it("measures jumps between consecutive stable fused poses within 1 s", () => {
    const t = createFusedTally();
    t.add(tilted(0), 0);
    t.add(tilted(3), 100);
    t.add(tilted(9, { status: "measuring" }), 150);
    t.add(tilted(5), 200);
    t.add(tilted(40), 5000); // after a gap: no pair
    const s = t.summary();
    expect(s.jumpDeg.n).toBe(2);
    expect(s.jumpDeg.p50).toBeCloseTo(2, 6);
    expect(s.jumpDeg.max).toBeCloseTo(3, 6);
  });
});

describe("createFusedTally frame changes", () => {
  // Why this test matters (field test C, plan §25): whether the demo saw a
  // restart could not be read from the JSON. Counting the fused results'
  // epoch moving on answers it; a jump never pairs across a frame change.
  it("counts frame changes and does not pair jumps across them", () => {
    const t = createFusedTally();
    t.add(tilted(0), 0);
    t.add(tilted(1), 100);
    t.add(tilted(30, { frameEpoch: 1 }), 200);
    t.add(tilted(31, { frameEpoch: 1 }), 300);
    const s = t.summary();
    expect(s.frameChanges).toBe(1);
    expect(s.jumpDeg.n).toBe(2);
    expect(s.jumpDeg.max).toBeCloseTo(1, 6);
  });
});
