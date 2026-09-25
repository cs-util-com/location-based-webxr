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
    edgePx: null,
    notStableReason: null,
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
        newestEdgePx: null,
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
    expect(lines.some((l) => l.startsWith("motion still signals:"))).toBe(true);
  });
});

describe("createFusedTally for the phone repeat (plan §30)", () => {
  // Why these tests matter: the owner's repeat of tests A and E must answer
  // two open decisions from the pasted JSON alone - may the demo switch
  // into "moving" after 2 detections instead of 4, and does the converging
  // size estimate read as motion - and show the overlay's position
  // steadiness. Each field below is what one of those needs.
  const reading = (
    over: Partial<NonNullable<QrFusedPose["motion"]>>,
    frameEpoch = 0,
    pose?: QrFusedPose["pose"],
  ): QrFusedPose =>
    tilted(0, {
      frameEpoch,
      ...(pose ? { pose } : {}),
      motion: {
        state: "still",
        moving: false,
        turning: false,
        stillSinceMs: null,
        movingCandidate: false,
        turningCandidate: false,
        offsetM: 0.01,
        speedMps: 0.1,
        newestFitPx: 1,
        turnRateDegPerS: 5,
        newestEdgePx: null,
        ...over,
      },
    });

  it("reports the still signals' p99 and max", () => {
    const t = createFusedTally();
    for (let i = 1; i <= 100; i++)
      t.add(reading({ newestFitPx: i / 10, offsetM: i / 1000 }), i * 100);
    const m = t.summary().motion;
    expect(m.turnSignalP99Px).toBeCloseTo(9.9, 6);
    expect(m.turnSignalMaxPx).toBeCloseTo(10, 6);
    expect(m.moveSignalP99Cm).toBeCloseTo(9.9, 6);
    expect(m.moveSignalMaxCm).toBeCloseTo(10, 6);
  });

  // A run of candidates that began while the mode was still: its length
  // says whether a shorter persistence would have flipped the mode.
  it("counts candidate runs that began while still, by length", () => {
    const t = createFusedTally();
    const seq: Array<Partial<NonNullable<QrFusedPose["motion"]>>> = [
      { movingCandidate: true },
      {},
      { movingCandidate: true },
      { movingCandidate: true },
      {},
      { movingCandidate: true, turningCandidate: true },
      { movingCandidate: true },
      { movingCandidate: true },
      { movingCandidate: true, state: "moving", moving: true },
      { movingCandidate: true, state: "moving", moving: true },
      { state: "moving", moving: true },
      // Candidates during a confirmed motion start no run.
      { turningCandidate: true, state: "moving", moving: true },
      { state: "still" },
    ];
    seq.forEach((over, i) => t.add(reading(over), i * 100));
    const runs = t.summary().motion.candidateRuns;
    expect(runs.moving).toEqual({ r1: 1, r2: 1, r3: 0, r4plus: 1 });
    expect(runs.turning).toEqual({ r1: 1, r2: 0, r3: 0, r4plus: 0 });
  });

  it("closes an open run at a frame change and at the summary", () => {
    const t = createFusedTally();
    t.add(reading({ movingCandidate: true }), 0);
    t.add(reading({ movingCandidate: true }, 1), 100);
    t.add(reading({ movingCandidate: true }, 1), 200);
    expect(t.summary().motion.candidateRuns.moving).toEqual({
      r1: 1,
      r2: 1,
      r3: 0,
      r4plus: 0,
    });
  });

  // Milestone review 2026-09-25 #8: the detector takes no step on a
  // reading without a signal (`offsetM` null), so a run of 4 candidates
  // with one such reading inside still confirms; ending the run there made
  // the tally report two short runs the rule never saw.
  it("skips a no-signal reading inside a run, as the detector does", () => {
    const t = createFusedTally();
    t.add(reading({ movingCandidate: true }), 0);
    t.add(reading({ movingCandidate: true }), 100);
    t.add(reading({ offsetM: null, newestFitPx: null }), 200);
    t.add(reading({ movingCandidate: true }), 300);
    t.add(reading({ movingCandidate: true }), 400);
    t.add(reading({}), 500);
    expect(t.summary().motion.candidateRuns.moving).toEqual({
      r1: 0,
      r2: 0,
      r3: 0,
      r4plus: 1,
    });
  });

  // Each confirmed switch, with when it happened and the size state then:
  // a "moving" right after the code is first seen, while the size is
  // still being measured, is the size-convergence risk (plan §28 #4).
  it("logs each confirmed switch with its timing and the size state", () => {
    const t = createFusedTally();
    t.add(reading({}), 1000, { status: "measuring", estimateM: 0.2 });
    t.add(reading({}), 1100);
    t.add(
      reading({
        state: "moving",
        moving: true,
        offsetM: 0.05,
        speedMps: 0.2,
      }),
      1500,
      { status: "measuring", estimateM: 0.21 },
    );
    t.add(reading({}, 1), 2000, { status: "estimated", estimateM: 0.2 });
    t.add(reading({}, 1), 2300);
    t.add(
      reading({ state: "turning", turning: true, newestFitPx: 6 }, 1),
      2600,
    );
    const m = t.summary().motion;
    const log = m.switchLog;
    expect(m.switches).toBe(2);
    expect(log.dropped).toBe(0);
    expect(log.log[0]).toEqual({
      from: "still",
      to: "moving",
      sinceFirstMs: 500,
      sinceEpochMs: 500,
      sizeStatus: "measuring",
      sizeCm: 21,
      offsetCm: 5,
      turnSignalPx: 1,
      speedCmS: 20,
      turnRateDegS: 5,
    });
    expect(log.log[1]).toMatchObject({
      from: "still",
      to: "turning",
      sinceFirstMs: 1600,
      sinceEpochMs: 600,
      sizeStatus: "estimated",
      sizeCm: 20,
    });
  });

  it("caps the switch log and counts what it dropped", () => {
    const t = createFusedTally();
    for (let i = 0; i < 130; i++) {
      const moving = i % 2 === 1;
      t.add(reading(moving ? { state: "moving", moving: true } : {}), i * 100);
    }
    const m = t.summary().motion;
    const log = m.switchLog;
    expect(m.switches).toBe(129);
    expect(log.log).toHaveLength(60);
    expect(log.dropped).toBe(69);
  });

  // The overlay's POSITION steadiness: jumps between consecutive stable
  // fused poses (within 1 s, one epoch), like the rotation jumps.
  it("measures position jumps between consecutive stable fused poses", () => {
    const t = createFusedTally();
    const at = (x: number, over: Partial<QrFusedPose> = {}) =>
      tilted(0, {
        pose: { position: [x, 0, 0], rotation: [0, 0, 0, 1] },
        ...over,
      });
    t.add(at(0), 0);
    t.add(at(0.01), 100);
    t.add(at(0.5, { status: "measuring" }), 150);
    t.add(at(0.04), 200);
    t.add(at(2), 5000); // after a gap: no pair
    const s = t.summary().positionJumpCm;
    expect(s.n).toBe(2);
    expect(s.p50).toBeCloseTo(1, 6);
    expect(s.max).toBeCloseTo(3, 6);
  });

  it("puts the new fields in the report lines", () => {
    const t = createFusedTally();
    t.add(reading({ movingCandidate: true }), 0);
    const text = fusedLines(t.summary()).join("\n");
    expect(text).toContain("position jump");
    expect(text).toContain("candidate runs");
    expect(text).toContain("p99/max");
  });
});

describe("createFusedTally fit population (b5 review #5)", () => {
  // While a code moves, the fused window is cut to ONE view, whose fit is
  // its own reprojection error and whose joint-vs-averaged angle is ~0;
  // early windows have 1-4 views. Pooling them would make test E's fit
  // numbers drop for a reason that has nothing to do with the views
  // agreeing. Only windows the gate could open on (>= 5 views) count.
  it("tallies fit and delta only over windows of at least 5 views", () => {
    const t = createFusedTally();
    t.add(tilted(0, { views: 7, fitPx: 2, averagedRotationDeltaDeg: 4 }), 0);
    t.add(
      tilted(0, { views: 1, fitPx: 0.1, averagedRotationDeltaDeg: 0 }),
      100,
    );
    t.add(
      tilted(0, { views: 4, fitPx: 0.2, averagedRotationDeltaDeg: 0 }),
      200,
    );
    t.add(tilted(0, { views: 5, fitPx: 3, averagedRotationDeltaDeg: 6 }), 300);
    const s = t.summary();
    expect(s.fitP50Px).toBe(2);
    expect(s.fitP95Px).toBe(3);
    expect(s.deltaP50Deg).toBe(4);
  });
});

describe("createFusedTally why not stable, by size (plan §34 R2)", () => {
  // Test A on r731 was stable on 68 % of locks and the JSON could not say
  // why, nor how large the code was on screen.
  it("counts the not-stable reasons", () => {
    const t = createFusedTally();
    t.add(tilted(0, { notStableReason: null }), 0);
    t.add(tilted(0, { status: "measuring", notStableReason: "views" }), 100);
    t.add(tilted(0, { status: "measuring", notStableReason: "fit" }), 200);
    t.add(tilted(0, { status: "measuring", notStableReason: "fit" }), 300);
    t.add(tilted(0, { status: "measuring", notStableReason: "motion" }), 400);
    t.add(tilted(0, { status: "measuring", notStableReason: "fallback" }), 500);
    expect(t.summary().notStable).toEqual({
      views: 1,
      fit: 2,
      fallback: 1,
      motion: 1,
    });
  });

  it("reports the fit and the stable share per code-size band", () => {
    const t = createFusedTally();
    t.add(tilted(0, { edgePx: 100, fitPx: 1 }), 0);
    t.add(
      tilted(0, {
        edgePx: 400,
        fitPx: 2,
        status: "measuring",
        notStableReason: "fit",
      }),
      100,
    );
    t.add(tilted(0, { edgePx: 400, fitPx: 1.2 }), 200);
    t.add(tilted(0, { edgePx: null, fitPx: 9 }), 300);
    const s = t.summary();
    expect(s.fitByEdgePx.small).toEqual({ n: 1, p50: 1, p95: 1 });
    expect(s.fitByEdgePx.large).toEqual({ n: 2, p50: 1.2, p95: 2 });
    expect(s.stableByEdgePx).toEqual({
      small: { locks: 1, stable: 1 },
      medium: { locks: 0, stable: 0 },
      large: { locks: 2, stable: 1 },
    });
    expect(fusedLines(s).join(" ")).toContain("not stable");
  });
});

describe("createFusedTally motion signals by size and during motion (plan §34 R2)", () => {
  // Test E1 could not show why the mode held for 20 s: nothing was
  // tallied while moving. And the turn signal is judged against a pixel
  // threshold, so it is shown per size band.
  const reading = (
    over: Partial<NonNullable<QrFusedPose["motion"]>>,
  ): QrFusedPose =>
    tilted(0, {
      motion: {
        state: "still",
        moving: false,
        turning: false,
        stillSinceMs: null,
        movingCandidate: false,
        turningCandidate: false,
        offsetM: 0.01,
        speedMps: null,
        newestFitPx: 1,
        turnRateDegPerS: null,
        newestEdgePx: 100,
        ...over,
      },
    });

  it("reports the still turn signal per size band", () => {
    const t = createFusedTally();
    t.add(reading({ newestFitPx: 1, newestEdgePx: 100 }), 0);
    t.add(reading({ newestFitPx: 4, newestEdgePx: 350 }), 100);
    t.add(reading({ newestFitPx: 6, newestEdgePx: 360 }), 200);
    const bands = t.summary().motion.stillTurnSignalByEdgePx;
    expect(bands.small).toEqual({ n: 1, p50: 1, p95: 1 });
    expect(bands.large).toEqual({ n: 2, p50: 4, p95: 6 });
  });

  it("tallies the signals and the no-signal readings during motion", () => {
    const t = createFusedTally();
    const moving = { state: "moving" as const, moving: true };
    t.add(reading({ ...moving, newestFitPx: 2, offsetM: 0.05 }), 0);
    t.add(reading({ ...moving, newestFitPx: 8, offsetM: 0.07 }), 100);
    t.add(reading({ ...moving, newestFitPx: null, offsetM: null }), 200);
    t.add(reading({}), 300);
    const d = t.summary().motion.duringMotion;
    expect(d).toMatchObject({
      n: 3,
      noSignal: 1,
      turnSignalP50Px: 2,
      turnSignalP95Px: 8,
    });
    expect(d.moveSignalP95Cm).toBeCloseTo(7, 6);
  });
});
