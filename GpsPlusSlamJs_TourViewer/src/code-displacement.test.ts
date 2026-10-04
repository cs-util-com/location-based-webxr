/**
 * The moved-code displacement estimators and their decision rule (authoring
 * plan 2026-09-28-0953 §3.6, decision D20, milestone M5a).
 *
 * Why these tests matter: a `moved` verdict makes the viewer ignore a
 * printed code for the rest of the session, so a false one strands every
 * visitor of a correctly placed code on GPS alone. The cold review (§7j)
 * named the three ways an estimator gets this wrong, and each has a test
 * here: (#1) a heading error in the SAVED code reads as a move once the
 * visitor walks away from the code - the residual estimator only looks
 * near the code, the rigid fit removes the turn; (#3) the viewer's own
 * votes pollute the inputs - only device fixes are read; (#7) evidence is
 * counted in time and spread, never in fixes, because GPS error is
 * autocorrelated and 60 fixes from one spot are one observation.
 */
import { describe, expect, it } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";
import {
  calcGpsCoords,
  GPS_POINT_SOURCE_SYNTHETIC_QR,
} from "gps-plus-slam-app-framework/core";

import {
  addDisplacementSample,
  CODE_MOVE_ESTIMATOR,
  CODE_MOVE_RULE,
  displacementEstimate,
  displacementSamples,
  EMPTY_DISPLACEMENT_STATS,
  estimateCodeDisplacement,
  judgeCodeDisplacement,
  MOVED_CODE_FLOOR_M,
  pinCode,
  type CodeMoveRule,
  type DisplacementSample,
} from "./code-displacement.js";
import { createTourViewerStore } from "./tour-viewer-session.js";
import type { NuePose } from "./visit-anchoring.js";

// The geodesy is licence-gated; building a store activates it.
createTourViewerStore();

const rad = (d: number): number => (d * Math.PI) / 180;

/** A yaw-only pose in a NUE frame: [north, up, east], turned `yawDeg`
 *  about Up. */
function pose(n: number, e: number, yawDeg: number, up = 0): NuePose {
  const h = rad(yawDeg) / 2;
  return {
    position: [n, up, e],
    rotation: [0, Math.sin(h), 0, Math.cos(h)],
  };
}

const matrixOf = (p: NuePose): Matrix4 =>
  new Matrix4().compose(
    new Vector3(...p.position),
    new Quaternion(...p.rotation),
    new Vector3(1, 1, 1),
  );

/** The TRUE odometry-to-world transform of the tests: a 40 degree yaw and a
 *  translation, so no estimate can pass by an identity frame. */
const ODOM_TO_WORLD = matrixOf(pose(120, -60, 40, 3));
const WORLD_TO_ODOM = ODOM_TO_WORLD.clone().invert();

/** A world (GPS-world NUE) pose as the odometry sees it. */
function inOdom(world: NuePose): NuePose {
  const m = WORLD_TO_ODOM.clone().multiply(matrixOf(world));
  const position = new Vector3();
  const rotation = new Quaternion();
  m.decompose(position, rotation, new Vector3());
  return {
    position: [position.x, position.y, position.z],
    rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
  };
}

/** One device fix taken at world [n, e]: the odometry is exact, the GPS
 *  reads the truth plus `gpsOffset`. */
function sampleAt(
  tS: number,
  n: number,
  e: number,
  gpsOffset: readonly [number, number] = [0, 0],
): DisplacementSample {
  const odom = new Vector3(n, 1.4, e).applyMatrix4(WORLD_TO_ODOM);
  return {
    tMs: tS * 1000,
    gps: [n + gpsOffset[0], e + gpsOffset[1]],
    odom: [odom.x, odom.z],
  };
}

/** The saved code: at world (10, 20), heading 30 degrees. */
const STORED = pose(10, 20, 30, 1.5);

/**
 * The code as the visitor's odometry sees it today: moved by `move`
 * (north, east) from the saved spot, turned by `turnDeg`, and saved with a
 * heading error of `headingErrDeg` (the saved heading is the truth plus the
 * error, so the physical code is the saved one minus it).
 */
function codeSeen(
  move: readonly [number, number],
  turnDeg = 0,
  headingErrDeg = 0,
): NuePose {
  return inOdom(
    pose(
      STORED.position[0] + move[0],
      STORED.position[2] + move[1],
      30 - headingErrDeg + turnDeg,
      1.5,
    ),
  );
}

/** Fixes on a circle of `radiusM` around world [n, e], one per second. */
function circleWalk(
  centre: readonly [number, number],
  radiusM: number,
  count: number,
  gpsOffset: readonly [number, number] = [0, 0],
): DisplacementSample[] {
  return Array.from({ length: count }, (_, i) => {
    const a = (2 * Math.PI * i) / count;
    return sampleAt(
      i,
      centre[0] + radiusM * Math.cos(a),
      centre[1] + radiusM * Math.sin(a),
      gpsOffset,
    );
  });
}

describe("pinCode", () => {
  it("maps the code's odometry pose onto its saved position, rigidly", () => {
    const seen = codeSeen([0, 0]);
    const pin = pinCode(seen, STORED);
    expect(pin).not.toBeNull();
    // An unmoved, truly saved code: the pin IS the true odometry-to-world
    // transform, so a point 15 m away maps to where it truly is.
    const far = sampleAt(0, 25, 20);
    const est = estimateCodeDisplacement([far], pin!, { kind: "rigid" });
    expect(est?.magnitudeM).toBeLessThan(1e-9);
  });

  it("returns null for a pose with no readable yaw", () => {
    const bad: NuePose = { position: [0, 0, 0], rotation: [0, 0, 0, 0] };
    expect(pinCode(bad, STORED)).toBeNull();
    expect(pinCode(codeSeen([0, 0]), bad)).toBeNull();
  });
});

describe("the residual estimator (device fixes within R of the code)", () => {
  it("reads a translated code's move, from the fixes near it only", () => {
    // The code was moved 20 m east; GPS is exact. A far fix with a wild
    // error lies beyond R and changes nothing.
    const pin = pinCode(codeSeen([0, 20]), STORED)!;
    const near = circleWalk([10, 40], 3, 30);
    const far = sampleAt(31, 10, 140, [500, 500]);
    const est = estimateCodeDisplacement([...near, far], pin, {
      kind: "residual",
      radiusM: 20,
    });
    expect(est?.displacementM[0]).toBeCloseTo(0, 6);
    expect(est?.displacementM[1]).toBeCloseTo(20, 6);
    expect(est?.samples).toBe(30);
  });

  // §7j #1: under a heading error theta, a fix at distance d from the code
  // has a residual of about 2 sin(theta/2) d. Near the code that is small;
  // the residual mean over a walk 40 m away is not.
  it("keeps a saved heading error small near the code, and reads it as a move far away", () => {
    const pin = pinCode(codeSeen([0, 0], 0, 12), STORED)!;
    const estimator = { kind: "residual", radiusM: 10 } as const;
    const near = circleWalk([10, 22], 2, 40);
    const nearEst = estimateCodeDisplacement(near, pin, estimator);
    // Centroid 2 m from the code, 12 deg: 2 * sin(6 deg) * 2 m.
    expect(nearEst?.magnitudeM).toBeCloseTo(2 * Math.sin(rad(6)) * 2, 6);
    const farPin = { ...estimator, radiusM: 100 };
    const farWalk = circleWalk([10, 60], 2, 40);
    const farEst = estimateCodeDisplacement(farWalk, pin, farPin);
    expect(farEst?.magnitudeM).toBeCloseTo(2 * Math.sin(rad(6)) * 40, 1);
  });

  it("has no estimate without a fix inside R", () => {
    const pin = pinCode(codeSeen([0, 0]), STORED)!;
    expect(
      estimateCodeDisplacement(circleWalk([10, 80], 2, 10), pin, {
        kind: "residual",
        radiusM: 10,
      }),
    ).toBeNull();
  });

  it("refuses a radius that is not a positive number", () => {
    const pin = pinCode(codeSeen([0, 0]), STORED)!;
    for (const radiusM of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        estimateCodeDisplacement([], pin, { kind: "residual", radiusM }),
      ).toThrow(RangeError);
    }
  });
});

describe("the rigid estimator (translation plus yaw, evaluated at the code)", () => {
  // §7j #1, the reason this estimator exists: it fits the turn as well as
  // the shift, so a saved heading error leaves NO displacement at the code,
  // however far from the code the visitor walked.
  it("reads no move for a heading error alone, on a walk 40 m away", () => {
    const pin = pinCode(codeSeen([0, 0], 0, 18), STORED)!;
    const est = estimateCodeDisplacement(circleWalk([10, 60], 8, 60), pin, {
      kind: "rigid",
    });
    expect(est?.magnitudeM).toBeLessThan(1e-6);
    expect(Math.abs(est?.yawDeg ?? 0)).toBeCloseTo(18, 6);
  });

  it("reads a moved and turned code's move at the code, with any heading error", () => {
    const pin = pinCode(codeSeen([-12, 9], 90, 12), STORED)!;
    const est = estimateCodeDisplacement(circleWalk([0, 30], 10, 60), pin, {
      kind: "rigid",
    });
    expect(est?.displacementM[0]).toBeCloseTo(-12, 6);
    expect(est?.displacementM[1]).toBeCloseTo(9, 6);
  });

  it("adds a constant GPS bias to the move exactly - a bias and a move look the same", () => {
    const pin = pinCode(codeSeen([0, 20]), STORED)!;
    const est = estimateCodeDisplacement(
      circleWalk([10, 40], 5, 60, [6, -8]),
      pin,
      { kind: "rigid" },
    );
    expect(est?.displacementM[0]).toBeCloseTo(6, 6);
    expect(est?.displacementM[1]).toBeCloseTo(12, 6);
  });
});

describe("the evidence: time span and spatial spread, never a fix count", () => {
  it("measures the span from the fixes' times and the spread from the odometry, not the GPS", () => {
    const pin = pinCode(codeSeen([0, 0]), STORED)!;
    // Standing still 60 s while GPS wanders by metres: a long span, no
    // spread - GPS noise is not the visitor walking.
    const standing = Array.from({ length: 61 }, (_, i) =>
      sampleAt(100 + i, 12, 20, [3 * Math.sin(i / 5), 3 * Math.cos(i / 7)]),
    );
    const est = estimateCodeDisplacement(standing, pin, { kind: "rigid" });
    expect(est?.spanS).toBeCloseTo(60, 9);
    expect(est?.spreadM).toBeLessThan(1e-6);
    expect(est?.samples).toBe(61);
    // No spread, no turn to fit: the rigid fit is the residual mean, not a
    // yaw drawn from rounding noise (which, through the 2 m lever of the
    // standing spot, moved the estimate by up to 4 m in the M5a sweep).
    const mean = estimateCodeDisplacement(standing, pin, {
      kind: "residual",
      radiusM: 40,
    });
    expect(est?.yawDeg).toBe(0);
    expect(est?.displacementM[0]).toBeCloseTo(mean!.displacementM[0], 9);
    expect(est?.displacementM[1]).toBeCloseTo(mean!.displacementM[1], 9);
    // A 5 m circle: the RMS distance from its centre.
    const walk = estimateCodeDisplacement(circleWalk([10, 25], 5, 40), pin, {
      kind: "rigid",
    });
    expect(walk?.spreadM).toBeCloseTo(5, 6);
  });

  // Why this test matters (M5a review §7l G2): a visitor standing at the
  // code sways by centimetres, which is spread enough to pass the numerical
  // guard but not enough to fit a turn - the fitted yaw is then noise, and
  // through the lever of the standing spot it swings the logged offset.
  // The rule calls such evidence `undecided` anyway; the estimator the rule
  // ships with must not report a turn it cannot see either.
  it("fits no turn below the rule's minimum spread, so a swaying visitor's offset is the residual mean", () => {
    const pin = pinCode(codeSeen([0, 0]), STORED)!;
    const swaying = Array.from({ length: 61 }, (_, i) =>
      sampleAt(
        100 + i,
        12 + 0.05 * Math.sin(i / 3),
        20 + 0.05 * Math.cos(i / 4),
        [3 * Math.sin(i / 5), 3 * Math.cos(i / 7)],
      ),
    );
    const bare = estimateCodeDisplacement(swaying, pin, { kind: "rigid" })!;
    expect(bare.spreadM).toBeGreaterThan(0.01);
    expect(bare.spreadM).toBeLessThan(CODE_MOVE_RULE.minSpreadM);
    // Without the guard the fit draws a turn from the GPS wander.
    expect(Math.abs(bare.yawDeg)).toBeGreaterThan(1);
    const guarded = estimateCodeDisplacement(
      swaying,
      pin,
      CODE_MOVE_ESTIMATOR,
    )!;
    const mean = estimateCodeDisplacement(swaying, pin, {
      kind: "residual",
      radiusM: 40,
    })!;
    expect(guarded.yawDeg).toBe(0);
    expect(guarded.displacementM[0]).toBeCloseTo(mean.displacementM[0], 9);
    expect(guarded.displacementM[1]).toBeCloseTo(mean.displacementM[1], 9);
    // Above the minimum spread the same estimator fits the turn as before.
    const turned = pinCode(codeSeen([0, 0], 0, 18), STORED)!;
    const walk = estimateCodeDisplacement(
      circleWalk([10, 60], 8, 60),
      turned,
      CODE_MOVE_ESTIMATOR,
    );
    expect(Math.abs(walk?.yawDeg ?? 0)).toBeCloseTo(18, 6);
    expect(walk?.magnitudeM).toBeLessThan(1e-6);
  });

  it("refuses a minimum yaw spread that is not a non-negative number", () => {
    const pin = pinCode(codeSeen([0, 0]), STORED)!;
    for (const minYawSpreadM of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        estimateCodeDisplacement(circleWalk([10, 25], 5, 10), pin, {
          kind: "rigid",
          minYawSpreadM,
        }),
      ).toThrow(RangeError);
    }
  });

  it("skips a sample that is not finite and keeps the rest", () => {
    const pin = pinCode(codeSeen([0, 20]), STORED)!;
    const good = circleWalk([10, 40], 3, 10);
    const bad: DisplacementSample = {
      tMs: Number.NaN,
      gps: [0, 0],
      odom: [0, 0],
    };
    const worse: DisplacementSample = {
      tMs: 5,
      gps: [Number.POSITIVE_INFINITY, 0],
      odom: [0, 0],
    };
    const est = estimateCodeDisplacement([bad, ...good, worse], pin, {
      kind: "rigid",
    });
    expect(est?.samples).toBe(10);
    expect(est?.displacementM[1]).toBeCloseTo(20, 6);
  });

  it("folds one sample at a time to the same estimate as the whole list", () => {
    const pin = pinCode(codeSeen([3, 4], 0, 3), STORED)!;
    const samples = circleWalk([10, 25], 6, 25, [1, -2]);
    for (const estimator of [
      { kind: "rigid" } as const,
      { kind: "residual", radiusM: 20 } as const,
    ]) {
      let stats = EMPTY_DISPLACEMENT_STATS;
      for (const s of samples)
        stats = addDisplacementSample(stats, pin, estimator, s);
      expect(displacementEstimate(stats, estimator)).toEqual(
        estimateCodeDisplacement(samples, pin, estimator),
      );
    }
  });
});

describe("displacementSamples (the viewer's history as the estimators read it)", () => {
  // §7j #3: the viewer's history holds its own votes (5 m accuracy, at the
  // code); they must never count as evidence about the code.
  it("reads device fixes only, in GPS-world metres from the zero, with their times", () => {
    const zero = { lat: 48.137, lon: 11.575 };
    const at = (n: number, e: number) => calcGpsCoords(zero, [n, 0, e]);
    const device = (n: number, e: number, t: number) => ({
      latitude: at(n, e).lat,
      longitude: at(n, e).lon,
      latLongAccuracy: 3,
      timestamp: t,
    });
    const samples = displacementSamples({
      zero,
      gpsPositions: [
        device(5, 6, 1_000),
        {
          ...device(50, 60, 1_100),
          source: GPS_POINT_SOURCE_SYNTHETIC_QR,
        },
        device(7, 8, 2_000),
        // No time: no evidence in time, so no sample.
        { ...device(9, 9, 0), timestamp: undefined },
      ],
      odometryPositions: [
        [1, 0, 2],
        [50, 0, 60],
        [3, 0, 4],
        [5, 0, 5],
      ],
    });
    expect(samples).toHaveLength(2);
    expect(samples[0]!.tMs).toBe(1_000);
    expect(samples[0]!.gps[0]).toBeCloseTo(5, 3);
    expect(samples[0]!.gps[1]).toBeCloseTo(6, 3);
    expect(samples[0]!.odom).toEqual([1, 2]);
    expect(samples[0]!.accuracyM).toBe(3);
    expect(samples[1]!.odom).toEqual([3, 4]);
  });

  it("is empty without a zero", () => {
    expect(
      displacementSamples({
        zero: null,
        gpsPositions: [{ latitude: 1, longitude: 2, timestamp: 1 }],
        odometryPositions: [[0, 0, 0]],
      }),
    ).toEqual([]);
  });
});

describe("judgeCodeDisplacement (the decision rule)", () => {
  const RULE: CodeMoveRule = {
    floorM: 20,
    agreementM: 10,
    minSpanS: 60,
    minSpreadM: 2,
  };
  const est = (magnitudeM: number, spanS = 120, spreadM = 4) => ({
    displacementM: [magnitudeM, 0] as const,
    magnitudeM,
    spanS,
    spreadM,
    samples: 120,
    yawDeg: 0,
  });

  // Why this test matters (owner decision 2026-10-02, results doc "Recalibrated
  // on real recordings"): the viewer's bound is the floor ALONE. Coupled to
  // the authoring correction's accuracy bound it was 23-27 m on real walks
  // (reported accuracy is not bias) and caught 9.6 % of 20 m moves instead
  // of 66 %; nothing about the visitor's reported accuracy may raise it.
  it("judges against the floor alone: the bound is the floor", () => {
    expect(judgeCodeDisplacement(est(5), RULE)).toEqual({
      verdict: "consistent",
      boundM: 20,
    });
    expect(judgeCodeDisplacement(est(5), { ...RULE, floorM: 30 }).boundM).toBe(
      30,
    );
  });

  it("says moved beyond the bound, consistent within the agreement, undecided between", () => {
    expect(judgeCodeDisplacement(est(20.01), RULE).verdict).toBe("moved");
    expect(judgeCodeDisplacement(est(20), RULE).verdict).toBe("undecided");
    expect(judgeCodeDisplacement(est(10), RULE).verdict).toBe("consistent");
    expect(judgeCodeDisplacement(est(15), RULE).verdict).toBe("undecided");
  });

  // Why this test matters: the owner approved these values on 2026-10-02
  // from the real-walk recalibration (cross-day pairs of 42 reference
  // points: 3 of 2380 unmoved pairs past 20 m within 120 s, 66 % of 20 m
  // moves caught). A change here moves the veto's false-alarm and detection
  // limits and must be re-read against the results doc.
  it("records the owner-approved rule: rigid-fit evidence of 60 s and 2 m, a 20 m floor alone", () => {
    expect(CODE_MOVE_RULE).toEqual({
      floorM: 20,
      agreementM: 10,
      minSpanS: 60,
      minSpreadM: 2,
    });
    expect(CODE_MOVE_RULE.floorM).toBe(MOVED_CODE_FLOOR_M);
    expect(CODE_MOVE_ESTIMATOR).toEqual({
      kind: "rigid",
      minYawSpreadM: CODE_MOVE_RULE.minSpreadM,
    });
    expect(judgeCodeDisplacement(est(20.5), CODE_MOVE_RULE)).toEqual({
      verdict: "moved",
      boundM: 20,
    });
  });

  it("is undecided without enough time or spread, whatever the size", () => {
    expect(judgeCodeDisplacement(null, RULE).verdict).toBe("undecided");
    expect(judgeCodeDisplacement(est(80, 59), RULE).verdict).toBe("undecided");
    expect(judgeCodeDisplacement(est(80, 600, 1.9), RULE).verdict).toBe(
      "undecided",
    );
    expect(judgeCodeDisplacement(est(1, 59), RULE).verdict).toBe("undecided");
  });
});
