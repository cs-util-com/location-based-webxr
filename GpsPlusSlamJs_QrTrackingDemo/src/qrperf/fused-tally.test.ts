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
import { createFusedTally, fusedLines } from "./fused-tally.js";

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

describe("createFusedTally motion (plan §26)", () => {
  // Why this test matters: the motion thresholds are provisional until a
  // phone measures them. Tests A (still wall code) and E (hand-held) must
  // report how often each mode was shown, how often it switched, and the
  // raw motion signals' distribution - the corner noise the turning
  // threshold (3 px) depends on, and the position jitter the moving one
  // (3 cm) does.
  const withMotion = (
    state: "still" | "moving" | "turning" | "moving+turning",
    newestFitPx: number,
    offsetM: number,
    frameEpoch = 0,
  ): QrFusedPose =>
    tilted(0, {
      frameEpoch,
      motion: {
        state,
        moving: state.startsWith("moving"),
        turning: state.endsWith("turning"),
        stillSinceMs: null,
        movingCandidate: false,
        turningCandidate: false,
        offsetM,
        speedMps: null,
        newestFitPx,
        turnRateDegPerS: null,
      },
    });

  it("counts the modes, the switches and the signals", () => {
    const t = createFusedTally();
    t.add(withMotion("still", 1, 0.01), 0);
    t.add(withMotion("still", 2, 0.02), 100);
    t.add(withMotion("moving", 3, 0.05), 200);
    t.add(withMotion("moving+turning", 9, 0.06), 300);
    t.add(withMotion("turning", 8, 0.0), 400);
    t.add(withMotion("still", 1, 0.0, 1), 500); // a new epoch: no switch
    t.add(tilted(0), 600); // no motion reading: not counted
    const m = t.summary().motion;
    expect(m).toMatchObject({
      n: 6,
      still: 3,
      moving: 1,
      turning: 1,
      movingTurning: 1,
      switches: 3,
    });
    // The signals are tallied over STILL readings only: they are what the
    // thresholds must sit above, and a hand-held run's motion would
    // otherwise read as noise (milestone review 2026-09-25).
    expect(m.turnSignalP50Px).toBe(1);
    expect(m.turnSignalP95Px).toBe(2);
    expect(m.moveSignalP95Cm).toBeCloseTo(2, 6);
  });

  it("puts the motion line in the report", () => {
    const t = createFusedTally();
    t.add(withMotion("still", 1, 0.01), 0);
    const lines = fusedLines(t.summary());
    expect(lines.some((l) => l.startsWith("motion: still 1"))).toBe(true);
    expect(lines.some((l) => l.includes("still turn signal"))).toBe(true);
  });
});
