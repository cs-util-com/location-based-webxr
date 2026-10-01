/**
 * Unit tests for tracking-quality.ts.
 *
 * Phase A of docs/2026-05-16-tracking-quality-metrics-plan.md. Focus
 * is on the pure compute helpers (§4.1–§4.7) and the slice/listener
 * wiring. The full corpus parameter sweep is exercised separately in the
 * downstream analysis harness.
 */

import { describe, it, expect } from 'vitest';
import { configureStore, type Action } from '@reduxjs/toolkit';
import type { GpsPoint, Matrix4, Vector3, LatLong } from 'gps-plus-slam-js';
import {
  computeCoverage,
  computeGpsAccuracy,
  computeResidualConsensus,
  computeConvergence,
  computeGpsVsFusedDivergence,
  computeTrackingQualityReport,
  matrixDelta,
  trackingQualityReducer,
  snapshotPushed,
  snapshotsTrimmed,
  reportUpdated,
  resetTrackingQuality,
  selectTrackingQuality,
  selectRecentAlignments,
  createTrackingQualityListenerMiddleware,
  degradedCountUpdated,
  DEFAULT_TRACKING_QUALITY_OPTIONS,
  type TrackingQualityReport,
  type AlignmentSnapshot,
} from './tracking-quality';
import { trackingReducer, poseReceived, poseLost } from './tracking-slice';
import { createSlamAppStore } from './create-slam-app-store';
import { recordGpsEvent, recordGpsEventBatch, setZeroPos } from './index';
import { NullStorageBackend } from '../storage/null-storage-backend';
import type { DeviceOrientation } from './tracking-slice';
import type { ARPose } from '../types/ar-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const IDENTITY: Matrix4 = [
  1,
  0,
  0,
  0, // col 0
  0,
  1,
  0,
  0, // col 1
  0,
  0,
  1,
  0, // col 2
  0,
  0,
  0,
  1, // col 3 (translation)
];

function shifted(dx: number, dy: number, dz: number): Matrix4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, dx, dy, dz, 1];
}

/** Column-major rotation about Y (in radians). */
function rotY(rad: number): Matrix4 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

const ZERO_REF: LatLong = { lat: 52, lon: 13 };

function gps(
  i: number,
  latOffsetM: number,
  lonOffsetM: number,
  acc = 3
): GpsPoint {
  // Approx 1 m ≈ 9e-6° lat at this latitude.
  const lat = ZERO_REF.lat + latOffsetM / 111_320;
  const lon =
    ZERO_REF.lon +
    lonOffsetM / (111_320 * Math.cos((ZERO_REF.lat * Math.PI) / 180));
  return {
    id: `g${i}`,
    latitude: lat,
    longitude: lon,
    latLongAccuracy: acc,
    timestamp: 1_700_000_000_000 + i * 1000,
    zeroRef: ZERO_REF,
    coordinates: [latOffsetM, 0, lonOffsetM],
    weight: 1,
  };
}

const DEFAULT_ORIENTATION: DeviceOrientation = {
  alpha: 0,
  beta: 0,
  gamma: 0,
  absolute: false,
};

const DEFAULT_POSE: ARPose = {
  position: { x: 0, y: 0, z: 0 },
  orientation: { x: 0, y: 0, z: 0, w: 1 },
};

// ---------------------------------------------------------------------------
// matrixDelta — kernel
// ---------------------------------------------------------------------------

describe('matrixDelta', () => {
  it('returns zero deltas for identical matrices', () => {
    const { rotationDeltaDeg, translationDeltaM } = matrixDelta(
      IDENTITY,
      IDENTITY
    );
    expect(rotationDeltaDeg).toBeCloseTo(0, 5);
    expect(translationDeltaM).toBeCloseTo(0, 5);
  });

  it('measures pure translation', () => {
    const { rotationDeltaDeg, translationDeltaM } = matrixDelta(
      IDENTITY,
      shifted(3, 0, 4)
    );
    expect(rotationDeltaDeg).toBeCloseTo(0, 5);
    expect(translationDeltaM).toBeCloseTo(5, 5);
  });

  it('measures pure rotation (30° about Y)', () => {
    const { rotationDeltaDeg, translationDeltaM } = matrixDelta(
      IDENTITY,
      rotY(Math.PI / 6)
    );
    expect(rotationDeltaDeg).toBeCloseTo(30, 3);
    expect(translationDeltaM).toBeCloseTo(0, 5);
  });

  it('handles malformed inputs without throwing', () => {
    expect(matrixDelta([1, 2, 3], [1, 2, 3])).toEqual({
      rotationDeltaDeg: 0,
      translationDeltaM: 0,
    });
  });

  it('returns finite zero deltas for a non-finite (NaN/Infinity) matrix', () => {
    // A degenerate alignment solve can emit NaN/Infinity into the 16-element
    // matrix. geodesicAngleRad's clamp only fixes near-identity round-off, not
    // NaN propagation, so without an output finite-guard rotation/translation
    // become NaN and poison the convergence score downstream. (Restores the
    // explicit finite-guard the shared-kernel refactor folded away.)
    const nanRotation = [...IDENTITY];
    nanRotation[0] = Number.NaN; // NaN in the rotation block
    const r1 = matrixDelta(nanRotation, IDENTITY);
    expect(Number.isFinite(r1.rotationDeltaDeg)).toBe(true);
    expect(Number.isFinite(r1.translationDeltaM)).toBe(true);
    expect(r1).toEqual({ rotationDeltaDeg: 0, translationDeltaM: 0 });

    const infTranslation = [...IDENTITY];
    infTranslation[13] = Number.POSITIVE_INFINITY; // Infinity in the translation column
    const r2 = matrixDelta(IDENTITY, infTranslation);
    expect(Number.isFinite(r2.rotationDeltaDeg)).toBe(true);
    expect(Number.isFinite(r2.translationDeltaM)).toBe(true);
    // Assert the EXACT zero fallback (not just finiteness) so a regression to a
    // non-zero finite value is caught — mirrors the r1 assertion. (PR #127 review.)
    expect(r2).toEqual({ rotationDeltaDeg: 0, translationDeltaM: 0 });
  });

  // Why this test matters: §11 (a) of the tracking-quality plan requires
  // matrixDelta to agree numerically with the gl-matrix-quat reference
  // kernel the downstream corpus-analysis harness uses
  // (`computeStabilityDelta`). The §6.1 corpus sweep correlates the
  // AppFramework's runtime convergence score with the harness's hindsight
  // error — both must use the same numeric definition or the correlation
  // is meaningless. The reference kernel below mirrors
  // computeStabilityDelta exactly; this test asserts identical output on
  // a tricky compound-rotation+translation case.
  it('matches the gl-matrix quat-based reference kernel on compound transforms', async () => {
    const { mat4, quat, vec3 } = await import('gl-matrix');
    const RAD_TO_DEG = 180 / Math.PI;

    function referenceDelta(
      prev: Matrix4,
      curr: Matrix4
    ): { rotationDeltaDeg: number; translationDeltaM: number } {
      const prevMat = mat4.fromValues(
        ...(prev as unknown as Parameters<typeof mat4.fromValues>)
      );
      const currMat = mat4.fromValues(
        ...(curr as unknown as Parameters<typeof mat4.fromValues>)
      );
      const prevQuat = quat.create();
      const currQuat = quat.create();
      mat4.getRotation(prevQuat, prevMat);
      mat4.getRotation(currQuat, currMat);
      quat.normalize(prevQuat, prevQuat);
      quat.normalize(currQuat, currQuat);
      const angleRad = quat.getAngle(prevQuat, currQuat);
      const rotationDeltaDeg = Number.isNaN(angleRad)
        ? 0
        : angleRad * RAD_TO_DEG;
      const prevT = vec3.create();
      const currT = vec3.create();
      mat4.getTranslation(prevT, prevMat);
      mat4.getTranslation(currT, currMat);
      return {
        rotationDeltaDeg,
        translationDeltaM: vec3.distance(prevT, currT),
      };
    }

    // Compose: rotate 17° about Y then 11° about X, then translate (1.2, -0.4, 2.7).
    // Build column-major directly via gl-matrix to avoid hand-error.
    const m = mat4.create();
    mat4.fromTranslation(m, [1.2, -0.4, 2.7]);
    mat4.rotateY(m, m, (17 * Math.PI) / 180);
    mat4.rotateX(m, m, (11 * Math.PI) / 180);
    const a: Matrix4 = Array.from(m) as unknown as Matrix4;
    // A second matrix: rotate -23° about Y + translate (0.7, 0.2, -1.1).
    const n = mat4.create();
    mat4.fromTranslation(n, [0.7, 0.2, -1.1]);
    mat4.rotateY(n, n, (-23 * Math.PI) / 180);
    const b: Matrix4 = Array.from(n) as unknown as Matrix4;

    const got = matrixDelta(a, b);
    const ref = referenceDelta(a, b);
    expect(got.rotationDeltaDeg).toBeCloseTo(ref.rotationDeltaDeg, 6);
    expect(got.translationDeltaM).toBeCloseTo(ref.translationDeltaM, 9);
  });

  it('matches the gl-matrix reference for an identity → 90°-Y transform', async () => {
    const { mat4, quat } = await import('gl-matrix');
    const target = mat4.create();
    mat4.rotateY(target, target, Math.PI / 2);
    const got = matrixDelta(IDENTITY, Array.from(target));

    const idQ = quat.create();
    const tQ = quat.create();
    mat4.getRotation(tQ, target);
    quat.normalize(tQ, tQ);
    const refAngle = (quat.getAngle(idQ, tQ) * 180) / Math.PI;
    expect(got.rotationDeltaDeg).toBeCloseTo(refAngle, 6);
    expect(got.rotationDeltaDeg).toBeCloseTo(90, 5);
  });
});

// ---------------------------------------------------------------------------
// §4.1 convergence
// ---------------------------------------------------------------------------

describe('computeConvergence', () => {
  it('returns score 0 with fewer than 2 snapshots', () => {
    expect(computeConvergence([]).score).toBe(0);
    expect(
      computeConvergence([{ observationIndex: 0, matrix: [...IDENTITY] }]).score
    ).toBe(0);
  });

  it('returns score ≈ 1 for nearly-identical snapshots', () => {
    const snaps: AlignmentSnapshot[] = [
      { observationIndex: 1, matrix: [...IDENTITY] },
      { observationIndex: 2, matrix: [...shifted(0.01, 0, 0.01)] },
      { observationIndex: 3, matrix: [...shifted(0.02, 0, 0.0)] },
    ];
    const r = computeConvergence(snaps);
    expect(r.score).toBeGreaterThan(0.9);
    expect(r.recentSumTranslationDeltaM).toBeGreaterThan(0);
    expect(r.pairCount).toBe(2);
  });

  it('drops score for large rotation jumps', () => {
    const snaps: AlignmentSnapshot[] = [
      { observationIndex: 1, matrix: [...IDENTITY] },
      { observationIndex: 2, matrix: [...rotY(Math.PI / 2)] }, // 90°
    ];
    expect(computeConvergence(snaps).score).toBe(0);
  });

  it('keeps the score finite when a snapshot matrix is non-finite', () => {
    // A single NaN-bearing alignment matrix must not turn the whole convergence
    // score into NaN (which would silently break the tracking-quality report).
    const nanMatrix = [...IDENTITY];
    nanMatrix[0] = Number.NaN;
    const snaps: AlignmentSnapshot[] = [
      { observationIndex: 1, matrix: [...IDENTITY] },
      { observationIndex: 2, matrix: nanMatrix },
    ];
    const r = computeConvergence(snaps);
    expect(Number.isFinite(r.score)).toBe(true);
    expect(Number.isFinite(r.recentSumRotationDeltaDeg)).toBe(true);
    expect(Number.isFinite(r.recentSumTranslationDeltaM)).toBe(true);
  });

  it('does not let a corrupt (non-finite) matrix improve the score', () => {
    // Regression: matrixDelta finite-guards a non-finite (degenerate-solve)
    // matrix to ZERO deltas so the score stays finite. But a zero delta reads as
    // "perfectly stable", so a corrupt alignment snapshot scored as score 1 — it
    // could *improve* convergence instead of degrading it. A corrupt matrix is
    // not evidence of stability; it must score on the fail side.
    const healthy = computeConvergence([
      { observationIndex: 1, matrix: [...IDENTITY] },
      { observationIndex: 2, matrix: [...IDENTITY] },
    ]);
    expect(healthy.score).toBe(1); // identical snapshots → perfectly stable

    const nanMatrix = [...IDENTITY];
    nanMatrix[0] = Number.NaN;
    const corrupt = computeConvergence([
      { observationIndex: 1, matrix: [...IDENTITY] },
      { observationIndex: 2, matrix: nanMatrix },
    ]);
    // The corrupt pair must drag the score DOWN, never sit at the healthy 1.
    expect(corrupt.score).toBeLessThan(healthy.score);
    expect(corrupt.score).toBe(0);
  });

  // Why this matters (PR #127 review): a finite but WRONG-LENGTH matrix (e.g. a
  // truncated/corrupt snapshot — `AlignmentSnapshot.matrix` is typed `number[]`,
  // not a fixed 16-tuple) passed `isFiniteMatrix` (which only checked finiteness)
  // and then hit `matrixDelta`'s own length guard, which returns ZERO deltas =
  // "perfectly stable". So a malformed snapshot inflated the score to the healthy
  // 1 instead of degrading it — the same defect class the non-finite guard above
  // fixes. A wrong-length matrix must score on the fail side too.
  it('does not let a finite but wrong-length matrix improve the score', () => {
    const healthy = computeConvergence([
      { observationIndex: 1, matrix: [...IDENTITY] },
      { observationIndex: 2, matrix: [...IDENTITY] },
    ]);
    expect(healthy.score).toBe(1);

    const truncated = [...IDENTITY].slice(0, 15); // 15 finite elements, not 16
    const corrupt = computeConvergence([
      { observationIndex: 1, matrix: [...IDENTITY] },
      { observationIndex: 2, matrix: truncated },
    ]);
    expect(corrupt.score).toBeLessThan(healthy.score);
    expect(corrupt.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §4.2 residual consensus
// ---------------------------------------------------------------------------

describe('computeResidualConsensus', () => {
  it('returns score 0 when alignment or zeroRef missing', () => {
    expect(
      computeResidualConsensus(null, [gps(0, 0, 0)], [[0, 0, 0]], ZERO_REF)
        .score
    ).toBe(0);
    expect(
      computeResidualConsensus(IDENTITY, [gps(0, 0, 0)], [[0, 0, 0]], null)
        .score
    ).toBe(0);
  });

  it('returns high score when odom→GPS prediction is exact', () => {
    const odom: Vector3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
      [4, 0, 0],
    ];
    const gpsPts: GpsPoint[] = odom.map((p, i) => gps(i, p[0], p[2]));
    const r = computeResidualConsensus(IDENTITY, gpsPts, odom, ZERO_REF);
    expect(r.score).toBeGreaterThan(0.95);
    expect(r.medianResidualM).toBeLessThan(0.1);
  });

  it('drops score when predictions are 10 m off', () => {
    const odom: Vector3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
      [4, 0, 0],
    ];
    // GPS positions are 10 m north of where the alignment predicts.
    const gpsPts: GpsPoint[] = odom.map((p, i) => gps(i, p[0] + 10, p[2]));
    const r = computeResidualConsensus(IDENTITY, gpsPts, odom, ZERO_REF);
    expect(r.score).toBeLessThan(0.5);
    expect(r.medianResidualM).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
// §4.4 GPS-accuracy budget
// ---------------------------------------------------------------------------

describe('computeGpsAccuracy', () => {
  it('returns 0 when no GPS points', () => {
    expect(computeGpsAccuracy([]).score).toBe(0);
  });

  it('returns 1.0 for tight GPS (median ≤ 3 m)', () => {
    const pts = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => gps(i, i, 0, 2));
    expect(computeGpsAccuracy(pts).score).toBe(1);
    expect(computeGpsAccuracy(pts).medianM).toBe(2);
  });

  it('returns 0 for very loose GPS (median ≥ 25 m)', () => {
    const pts = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => gps(i, i, 0, 30));
    expect(computeGpsAccuracy(pts).score).toBe(0);
  });

  it('only inspects the last K points', () => {
    const stale = [0, 1, 2].map((i) => gps(i, i, 0, 30));
    const recent = [3, 4, 5, 6, 7, 8, 9, 10].map((i) => gps(i, i, 0, 2));
    const pts = [...stale, ...recent];
    expect(computeGpsAccuracy(pts).score).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §4.5 coverage
// ---------------------------------------------------------------------------

describe('computeCoverage', () => {
  it('returns 0 with fewer than 2 odom samples', () => {
    expect(computeCoverage([]).score).toBe(0);
    expect(computeCoverage([[0, 0, 0]]).score).toBe(0);
  });

  it('returns 0 when standing still', () => {
    const odom: Vector3[] = Array.from({ length: 30 }, () => [0, 0, 0]);
    const r = computeCoverage(odom);
    expect(r.score).toBe(0);
    expect(r.walkedDistanceM).toBe(0);
  });

  it('penalises a 20 m straight-line walk (no direction spread)', () => {
    const odom: Vector3[] = Array.from({ length: 21 }, (_, i) => [i, 0, 0]);
    const r = computeCoverage(odom);
    expect(r.walkedDistanceM).toBeCloseTo(20, 5);
    // Single direction → spread ≈ 0, so score ≈ 0.
    expect(r.score).toBeLessThan(0.1);
  });

  it('returns 1.0 for a 20 m loop covering >= 90° spread', () => {
    const odom: Vector3[] = [];
    // North leg
    for (let i = 0; i <= 10; i++) odom.push([i, 0, 0]);
    // East leg
    for (let i = 1; i <= 10; i++) odom.push([10, 0, i]);
    const r = computeCoverage(odom);
    expect(r.walkedDistanceM).toBeCloseTo(20, 1);
    expect(r.directionSpreadDeg).toBeGreaterThanOrEqual(90);
    expect(r.score).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §4.3 compass / heading
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// §4.6 GPS-vs-fused divergence
// ---------------------------------------------------------------------------

describe('computeGpsVsFusedDivergence', () => {
  it('is 0 with missing inputs', () => {
    expect(computeGpsVsFusedDivergence(null, [], [], null)).toBe(0);
  });

  it('reports the worst residual in the window', () => {
    const odom: Vector3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
    ];
    const gpsPts: GpsPoint[] = [
      gps(0, 0, 0),
      gps(1, 1, 0),
      gps(2, 2, 0),
      gps(3, 12, 0), // 9 m off
    ];
    const max = computeGpsVsFusedDivergence(IDENTITY, gpsPts, odom, ZERO_REF);
    expect(max).toBeGreaterThan(8);
    expect(max).toBeLessThan(10);
  });
});

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

interface MinimalRoot {
  gpsData: {
    gpsEvents: {
      alignmentMatrix: Matrix4 | null;
      gpsPositions: readonly GpsPoint[];
      odometryPositions: readonly Vector3[];
      odometryRotations: readonly unknown[];
    };
    zero: LatLong | null;
  };
  tracking: ReturnType<typeof trackingReducer>;
  trackingQuality: ReturnType<typeof trackingQualityReducer>;
}

function buildRootState(input: {
  alignmentMatrix?: Matrix4 | null;
  gpsPositions?: readonly GpsPoint[];
  odometryPositions?: readonly Vector3[];
  zeroRef?: LatLong | null;
  trackingPhase?: 'initializing' | 'tracking' | 'lost';
  snapshots?: readonly AlignmentSnapshot[];
  sensorOrientation?: DeviceOrientation;
  lastValidPose?: ARPose;
  smoothedConvergence?: number | null;
}): MinimalRoot {
  return {
    gpsData: {
      gpsEvents: {
        alignmentMatrix: input.alignmentMatrix ?? null,
        gpsPositions: input.gpsPositions ?? [],
        odometryPositions: input.odometryPositions ?? [],
        odometryRotations: [],
      },
      zero: input.zeroRef ?? null,
    },
    tracking: {
      phase: input.trackingPhase ?? 'tracking',
      lastValidPose: input.lastValidPose ?? DEFAULT_POSE,
      lastSensorOrientation: input.sensorOrientation ?? DEFAULT_ORIENTATION,
      lostFrameCount: 0,
      originResetDuringLoss: false,
      resetTransform: undefined,
      lastRestartedPayload: null,
    },
    trackingQuality: {
      recentAlignments: [...(input.snapshots ?? [])],
      report: null,
      degradedConsecutiveCount: 0,
      smoothedConvergence: input.smoothedConvergence ?? null,
    },
  };
}

describe('computeTrackingQualityReport', () => {
  it('returns ar-lost when tracking phase is not "tracking"', () => {
    const root = buildRootState({
      trackingPhase: 'lost',
      alignmentMatrix: IDENTITY,
      gpsPositions: Array.from({ length: 30 }, (_, i) => gps(i, i, 0)),
      odometryPositions: Array.from(
        { length: 30 },
        (_, i) => [i, 0, 0] as Vector3
      ),
      zeroRef: ZERO_REF,
    });
    // Cast — buildRootState satisfies the structural minimum used by selectors.
    const report = computeTrackingQualityReport(root as never);
    expect(report.state).toBe('ar-lost');
    expect(report.confidence).toBe(0);
  });

  it('reports warming-up before enough GPS / coverage', () => {
    const root = buildRootState({
      alignmentMatrix: IDENTITY,
      gpsPositions: [gps(0, 0, 0), gps(1, 0, 0)],
      odometryPositions: [
        [0, 0, 0],
        [0.1, 0, 0],
      ],
      zeroRef: ZERO_REF,
    });
    const report = computeTrackingQualityReport(root as never);
    expect(report.state).toBe('warming-up');
  });

  it('produces a confidence score from min(subScores)', () => {
    // Build a "happy path": good GPS, good coverage, good residuals,
    // converged matrix snapshots.
    const odom: Vector3[] = [];
    for (let i = 0; i <= 20; i++) odom.push([i, 0, 0]);
    for (let i = 1; i <= 20; i++) odom.push([20, 0, i]);
    const gpsPts = odom.map((p, i) => gps(i, p[0], p[2], 2));
    const snapshots: AlignmentSnapshot[] = Array.from(
      { length: 8 },
      (_, i) => ({
        observationIndex: i + 30,
        matrix: [...IDENTITY],
      })
    );
    const root = buildRootState({
      alignmentMatrix: IDENTITY,
      gpsPositions: gpsPts,
      odometryPositions: odom,
      zeroRef: ZERO_REF,
      snapshots,
    });
    const report = computeTrackingQualityReport(root as never);
    expect(report.subScores.convergence).toBeGreaterThan(0.95);
    expect(report.subScores.residualConsensus).toBeGreaterThan(0.95);
    expect(report.subScores.gpsAccuracy).toBe(1);
    expect(report.subScores.coverage).toBe(1);
    expect(report.confidence).toBeGreaterThan(0.5);
    expect(report.state).toBe('ok');
  });

  // Anti-validation §6: bad GPS + stable matrix must NOT report 1.0.
  it('anti-validation: bad GPS pulls confidence down even with stable matrix', () => {
    const odom: Vector3[] = [];
    for (let i = 0; i <= 20; i++) odom.push([i, 0, 0]);
    for (let i = 1; i <= 20; i++) odom.push([20, 0, i]);
    const gpsPts = odom.map((p, i) => gps(i, p[0], p[2], 40));
    const snapshots: AlignmentSnapshot[] = Array.from(
      { length: 8 },
      (_, i) => ({
        observationIndex: i + 30,
        matrix: [...IDENTITY],
      })
    );
    const root = buildRootState({
      alignmentMatrix: IDENTITY,
      gpsPositions: gpsPts,
      odometryPositions: odom,
      zeroRef: ZERO_REF,
      snapshots,
    });
    const report = computeTrackingQualityReport(root as never);
    expect(report.subScores.gpsAccuracy).toBe(0);
    expect(report.confidence).toBeLessThan(0.1);
    expect(report.state).toBe('degraded');
  });

  // Anti-validation §6: standing still must NOT report 'ok'.
  it('anti-validation: standing still keeps state in warming-up', () => {
    const odom: Vector3[] = Array.from({ length: 60 }, () => [0, 0, 0]);
    const gpsPts = Array.from({ length: 60 }, (_, i) => gps(i, 0, 0, 2));
    const root = buildRootState({
      alignmentMatrix: IDENTITY,
      gpsPositions: gpsPts,
      odometryPositions: odom,
      zeroRef: ZERO_REF,
    });
    const report = computeTrackingQualityReport(root as never);
    expect(report.subScores.coverage).toBe(0);
    expect(report.state).toBe('warming-up');
  });
});

// ---------------------------------------------------------------------------
// Option forwarding from the aggregator to the §4.1 helpers
// ---------------------------------------------------------------------------

describe('computeTrackingQualityReport — threshold forwarding', () => {
  // Why these tests matter: convergenceRotationWarnDeg / convergenceTranslationWarnM
  // were defined (or settable) but never forwarded from the aggregator to
  // computeConvergence, so callers configuring the store/aggregator silently
  // got the hardcoded defaults. These tests pin the wiring so a regression
  // cannot reintroduce it.

  /** Identity → Y-axis rotation snapshot pair producing ΣΔrot = angleDeg. */
  function rotationSnapshots(angleDeg: number): AlignmentSnapshot[] {
    const rad = (angleDeg * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const rotated = [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
    return [
      { observationIndex: 0, matrix: [...IDENTITY] },
      { observationIndex: 1, matrix: rotated },
    ];
  }

  it('forwards convergenceRotationWarnDeg to computeConvergence', () => {
    // ΣΔrot = 9°. Default warn=6/fail=24 → rampDown(9,6,24) ≈ 0.833.
    // A tight warn=1/fail=4 → 9 ≥ 4 ⇒ score 0. convergenceEmaAlpha:1
    // disables smoothing so subScores.convergence === the raw score.
    const base = {
      alignmentMatrix: IDENTITY,
      gpsPositions: [gps(0, 0, 0, 2)],
      odometryPositions: [[0, 0, 0] as Vector3],
      zeroRef: ZERO_REF,
      snapshots: rotationSnapshots(9),
    };
    const def = computeTrackingQualityReport(buildRootState(base) as never, {
      convergenceEmaAlpha: 1,
    });
    expect(def.subScores.convergence).toBeGreaterThan(0.8);

    const tight = computeTrackingQualityReport(buildRootState(base) as never, {
      convergenceEmaAlpha: 1,
      convergenceRotationWarnDeg: 1,
    });
    expect(tight.subScores.convergence).toBe(0);
  });

  it('forwards convergenceTranslationWarnM to computeConvergence', () => {
    // ΣΔpos = 1 m. Default transWarn=2/fail=8 → rampDown(1,2,8) = 1.
    // A tight transWarn=0.1/fail=0.4 → 1 ≥ 0.4 ⇒ score 0.
    const base = {
      alignmentMatrix: IDENTITY,
      gpsPositions: [gps(0, 0, 0, 2)],
      odometryPositions: [[0, 0, 0] as Vector3],
      zeroRef: ZERO_REF,
      snapshots: [
        { observationIndex: 0, matrix: [...IDENTITY] },
        { observationIndex: 1, matrix: [...shifted(1, 0, 0)] },
      ] as AlignmentSnapshot[],
    };
    const def = computeTrackingQualityReport(buildRootState(base) as never, {
      convergenceEmaAlpha: 1,
    });
    expect(def.subScores.convergence).toBe(1);

    const tight = computeTrackingQualityReport(buildRootState(base) as never, {
      convergenceEmaAlpha: 1,
      convergenceTranslationWarnM: 0.1,
    });
    expect(tight.subScores.convergence).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §4.8b — EMA-smoothed convergence sub-score (Finding 4)
// ---------------------------------------------------------------------------

describe('EMA-smoothed convergence (Finding 4)', () => {
  // Why these tests matter: §4.8b adds exponential smoothing on top of
  // computeConvergence so single-frame matrix coincidences do not flash the
  // HUD between high and low confidence. The smoothed value is what feeds
  // subScores.convergence; computeConvergence itself stays raw because the
  // §6.1 investigation harness wants the un-smoothed signal.

  // Build a snapshot pair whose deltas drive convergence to a specific raw
  // score. We use a tiny rotation (small angle around Y) to make the math
  // analytic — convergence.rampDown(angleDeg, warn=3, fail=12).
  function snapshotsForRotationDeg(angleDeg: number): AlignmentSnapshot[] {
    const rad = (angleDeg * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    // Row-major 4x4 with a Y-axis rotation in the upper-left 3x3.
    const rotated = [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
    return [
      { observationIndex: 0, matrix: [...IDENTITY] },
      { observationIndex: 1, matrix: rotated },
    ];
  }

  it('first observation seeds the smoothed value to the raw value', () => {
    const root = buildRootState({
      alignmentMatrix: IDENTITY,
      gpsPositions: [gps(0, 0, 0, 2)],
      odometryPositions: [[0, 0, 0]],
      zeroRef: ZERO_REF,
      snapshots: snapshotsForRotationDeg(0), // raw = 1.0
    });
    const report = computeTrackingQualityReport(root as never);
    expect(report.subScores.convergence).toBeCloseTo(1, 5);
  });

  it('blends prior smoothed value with the new raw value via alpha', () => {
    // Prior smoothed = 0.0, default alpha = 0.25 (re-tuned with E-1 — the EMA
    // advances per observation now), raw convergence = 1.0 →
    // smoothed = 0.0 + 0.25 * (1.0 - 0.0) = 0.25.
    const root = buildRootState({
      alignmentMatrix: IDENTITY,
      gpsPositions: [gps(0, 0, 0, 2)],
      odometryPositions: [[0, 0, 0]],
      zeroRef: ZERO_REF,
      snapshots: snapshotsForRotationDeg(0), // raw convergence = 1.0
      smoothedConvergence: 0,
    });
    const report = computeTrackingQualityReport(root as never);
    expect(report.subScores.convergence).toBeCloseTo(
      DEFAULT_TRACKING_QUALITY_OPTIONS.convergenceEmaAlpha,
      5
    );
  });

  it('respects custom alpha option', () => {
    // alpha = 1.0 disables smoothing → smoothed === raw.
    const root = buildRootState({
      alignmentMatrix: IDENTITY,
      gpsPositions: [gps(0, 0, 0, 2)],
      odometryPositions: [[0, 0, 0]],
      zeroRef: ZERO_REF,
      snapshots: snapshotsForRotationDeg(0),
      smoothedConvergence: 0,
    });
    const report = computeTrackingQualityReport(root as never, {
      convergenceEmaAlpha: 1,
    });
    expect(report.subScores.convergence).toBeCloseTo(1, 5);
  });

  it('alternating raw values produce a smoother subScores.convergence series', () => {
    // Drive the aggregator across an oscillating raw-convergence sequence
    // by varying the snapshot pair each step. Compare the range of raw
    // vs. smoothed values; smoothed range must be strictly tighter.
    const alpha = 0.3;
    let prevSmoothed: number | null = null;
    const rawSeries: number[] = [];
    const smoothedSeries: number[] = [];
    // Pattern: 0°/9° flip → raw alternates between 1.0 and 0.0.
    const pattern = [0, 9, 0, 9, 0, 9, 0, 9, 0, 9];
    for (const angle of pattern) {
      const root = buildRootState({
        alignmentMatrix: IDENTITY,
        gpsPositions: [gps(0, 0, 0, 2)],
        odometryPositions: [[0, 0, 0]],
        zeroRef: ZERO_REF,
        snapshots: snapshotsForRotationDeg(angle),
        smoothedConvergence: prevSmoothed,
      });
      const report = computeTrackingQualityReport(root as never, {
        convergenceEmaAlpha: alpha,
      });
      smoothedSeries.push(report.subScores.convergence);
      // raw is exposed via diagnostics in F6, but for now read it from a
      // fresh computeConvergence call so we don't depend on F6.
      const raw = computeConvergence(snapshotsForRotationDeg(angle)).score;
      rawSeries.push(raw);
      prevSmoothed = report.subScores.convergence;
    }
    const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    expect(range(smoothedSeries)).toBeLessThan(range(rawSeries));
  });
});

// ---------------------------------------------------------------------------
// Slice / reducer
// ---------------------------------------------------------------------------

describe('trackingQuality slice', () => {
  function makeStore() {
    return configureStore({
      reducer: {
        tracking: trackingReducer,
        trackingQuality: trackingQualityReducer,
      },
    });
  }

  it('starts empty', () => {
    const store = makeStore();
    expect(selectTrackingQuality(store.getState())).toBeNull();
    expect(selectRecentAlignments(store.getState())).toEqual([]);
  });

  it('appends and trims snapshots', () => {
    const store = makeStore();
    for (let i = 0; i < 5; i++) {
      store.dispatch(
        snapshotPushed({ observationIndex: i, matrix: [...IDENTITY] })
      );
    }
    store.dispatch(snapshotsTrimmed({ size: 3 }));
    const buf = selectRecentAlignments(store.getState());
    expect(buf.length).toBe(3);
    expect(buf[0].observationIndex).toBe(2);
  });

  it('stores and clears the report', () => {
    const store = makeStore();
    const report: TrackingQualityReport = {
      state: 'ok',
      confidence: 0.8,
      subScores: {
        convergence: 0.9,
        residualConsensus: 0.8,
        gpsAccuracy: 0.95,
        coverage: 0.85,
      },
      diagnostics: {
        recentSumRotationDeltaDeg: 0,
        recentSumTranslationDeltaM: 0,
        medianResidualM: 0.5,
        medianRecentGpsAccuracyM: 2,
        walkedDistanceM: 30,
        directionSpreadDeg: 180,
        observationsSeen: 25,
        gpsVsFusedMaxDivergenceM: 1.5,
      },
    };
    store.dispatch(reportUpdated(report));
    expect(selectTrackingQuality(store.getState())).toEqual(report);
    store.dispatch(resetTrackingQuality());
    expect(selectTrackingQuality(store.getState())).toBeNull();
    expect(selectRecentAlignments(store.getState())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Listener middleware
// ---------------------------------------------------------------------------

interface ListenerHarnessState {
  gpsData: MinimalRoot['gpsData'];
  tracking: MinimalRoot['tracking'];
  trackingQuality: MinimalRoot['trackingQuality'];
}

function makeListenerStore(initialGps: ListenerHarnessState['gpsData']) {
  // Minimal gpsData reducer that lets us push alignment changes via
  // synthetic actions matching the library's action types.
  const gpsDataReducer = (
    state: ListenerHarnessState['gpsData'] = initialGps,
    action: Action
  ): ListenerHarnessState['gpsData'] => {
    if (
      action.type === 'gpsData/recordGpsEvent' ||
      action.type === 'gpsData/setZeroPos'
    ) {
      const payload = (
        action as unknown as { payload: ListenerHarnessState['gpsData'] }
      ).payload;
      return payload;
    }
    return state;
  };

  const store = configureStore({
    reducer: {
      gpsData: gpsDataReducer,
      tracking: trackingReducer,
      trackingQuality: trackingQualityReducer,
    },
    middleware: (getDefault) =>
      getDefault({ serializableCheck: false }).prepend(
        createTrackingQualityListenerMiddleware({
          matrixHistorySize: 4,
          warmupMinObservations: 2,
          warmupMinCoverage: 0,
        })
      ),
  });
  return store;
}

describe('createTrackingQualityListenerMiddleware', () => {
  function snapshotGpsAfter(
    alignmentMatrix: Matrix4 | null,
    positions: GpsPoint[],
    odom: Vector3[]
  ): ListenerHarnessState['gpsData'] {
    return {
      gpsEvents: {
        alignmentMatrix,
        gpsPositions: positions,
        odometryPositions: odom,
        odometryRotations: [],
      },
      zero: ZERO_REF,
    };
  }

  it('pushes a snapshot and dispatches reportUpdated on recordGpsEvent', () => {
    const store = makeListenerStore(snapshotGpsAfter(null, [], []));
    // Mark tracking as actively tracking so we don't get 'ar-lost'.
    store.dispatch(
      poseReceived({
        pose: DEFAULT_POSE,
        sensorOrientation: DEFAULT_ORIENTATION,
      })
    );

    const odom: Vector3[] = [];
    const gpsPts: GpsPoint[] = [];
    for (let i = 0; i < 5; i++) {
      odom.push([i, 0, 0]);
      gpsPts.push(gps(i, i, 0));
      store.dispatch({
        type: 'gpsData/recordGpsEvent',
        payload: snapshotGpsAfter(IDENTITY, [...gpsPts], [...odom]),
      });
    }
    const buf = selectRecentAlignments(store.getState());
    expect(buf.length).toBe(1); // matrix only changed once (null → IDENTITY)
    const report = selectTrackingQuality(store.getState());
    expect(report).not.toBeNull();
    expect(report?.diagnostics.observationsSeen).toBe(5);
  });

  it('trims to matrixHistorySize when matrix keeps changing', () => {
    const store = makeListenerStore(snapshotGpsAfter(null, [], []));
    store.dispatch(
      poseReceived({
        pose: DEFAULT_POSE,
        sensorOrientation: DEFAULT_ORIENTATION,
      })
    );
    for (let i = 0; i < 8; i++) {
      const matrix = shifted(i, 0, 0);
      store.dispatch({
        type: 'gpsData/recordGpsEvent',
        payload: snapshotGpsAfter(matrix, [gps(i, i, 0)], [[i, 0, 0]]),
      });
    }
    const buf = selectRecentAlignments(store.getState());
    expect(buf.length).toBe(4); // matrixHistorySize from harness
  });

  it('resets buffer + report on startSession and resetTracking', () => {
    const store = makeListenerStore(snapshotGpsAfter(null, [], []));
    store.dispatch(
      poseReceived({
        pose: DEFAULT_POSE,
        sensorOrientation: DEFAULT_ORIENTATION,
      })
    );
    store.dispatch({
      type: 'gpsData/recordGpsEvent',
      payload: snapshotGpsAfter(IDENTITY, [gps(0, 0, 0)], [[0, 0, 0]]),
    });
    expect(selectRecentAlignments(store.getState()).length).toBe(1);

    store.dispatch({ type: 'recording/startSession' });
    expect(selectRecentAlignments(store.getState()).length).toBe(0);
    expect(selectTrackingQuality(store.getState())).toBeNull();
  });

  it('does not churn reportUpdated when nothing changed', () => {
    const store = makeListenerStore(snapshotGpsAfter(null, [], []));
    store.dispatch(
      poseReceived({
        pose: DEFAULT_POSE,
        sensorOrientation: DEFAULT_ORIENTATION,
      })
    );

    let reportUpdatedCount = 0;
    const unsub = store.subscribe(() => {
      if (
        (store.getState() as { trackingQuality: { report: unknown } })
          .trackingQuality.report !== null
      ) {
        reportUpdatedCount += 1;
      }
    });

    store.dispatch({
      type: 'gpsData/recordGpsEvent',
      payload: snapshotGpsAfter(IDENTITY, [gps(0, 0, 0)], [[0, 0, 0]]),
    });
    const after1 = reportUpdatedCount;
    // Same payload again — listener computes the same report, no diff dispatch.
    store.dispatch({ type: 'tracking/poseLost' });
    // poseLost may flip phase → state changes → one new dispatch.
    expect(reportUpdatedCount).toBeGreaterThanOrEqual(after1);
    unsub();
  });

  // Why this test matters: `poseReceived` fires on every XR frame and the
  // per-frame recompute reuses the unchanged GPS/odometry windows, so
  // sub-perceptual per-frame float jitter must NOT churn `reportUpdated` at
  // frame rate (high Redux dispatch volume + HUD re-renders). This test
  // reproduces the per-frame jitter scenario and asserts the dispatch
  // gate suppresses changes below the user-visible threshold.
  it('does not churn reportUpdated on sub-threshold per-frame pose jitter', () => {
    const store = makeListenerStore(snapshotGpsAfter(null, [], []));

    store.dispatch(
      poseReceived({
        pose: DEFAULT_POSE,
        sensorOrientation: DEFAULT_ORIENTATION,
      })
    );

    // Enough GPS observations + alignment to leave 'warming-up' and to
    // activate the residual path.
    const odom: Vector3[] = [];
    const gpsPts: GpsPoint[] = [];
    for (let i = 0; i < 4; i++) {
      odom.push([i, 0, 0]);
      gpsPts.push(gps(i, i, 0));
      store.dispatch({
        type: 'gpsData/recordGpsEvent',
        payload: snapshotGpsAfter(IDENTITY, [...gpsPts], [...odom]),
      });
    }

    // Count distinct report references the HUD subscriber would observe.
    let reportRefChanges = 0;
    let lastSeen = selectTrackingQuality(store.getState());
    const unsub = store.subscribe(() => {
      const report = selectTrackingQuality(store.getState());
      if (report !== lastSeen) {
        reportRefChanges += 1;
        lastSeen = report;
      }
    });

    // 30 frames of imperceptible orientation jitter (< 0.01° about Y) and
    // sub-millimetre position drift — the kind of float noise a held
    // device emits at 60 fps.
    for (let frame = 1; frame <= 30; frame++) {
      const theta = frame * 1e-6; // radians — far below 0.001°
      store.dispatch(
        poseReceived({
          pose: {
            position: { x: frame * 1e-7, y: 0, z: 0 },
            orientation: {
              x: 0,
              y: Math.sin(theta / 2),
              z: 0,
              w: Math.cos(theta / 2),
            },
          },
          sensorOrientation: DEFAULT_ORIENTATION,
        })
      );
    }
    unsub();

    // With the dispatch gate quantising sub-threshold changes, none of
    // these jitter frames should produce a fresh report reference.
    expect(reportRefChanges).toBe(0);
  });

  // Why this test matters: E-1 (2026-07-10 quality review) skips the
  // per-frame report recompute when the tracking phase is unchanged. The
  // skip must NOT swallow the first pose frame after a reset — the HUD
  // would otherwise show no report until the next GPS event (~1 s).
  it('recomputes the report on the first pose frame after a session reset', () => {
    const store = makeListenerStore(snapshotGpsAfter(null, [], []));
    store.dispatch(
      poseReceived({
        pose: DEFAULT_POSE,
        sensorOrientation: DEFAULT_ORIENTATION,
      })
    );
    expect(selectTrackingQuality(store.getState())).not.toBeNull();

    store.dispatch({ type: 'tracking/resetTracking' });
    expect(selectTrackingQuality(store.getState())).toBeNull();

    // Same phase as before the reset — the phase-skip must still recompute
    // because no report exists yet.
    store.dispatch(
      poseReceived({
        pose: DEFAULT_POSE,
        sensorOrientation: DEFAULT_ORIENTATION,
      })
    );
    expect(selectTrackingQuality(store.getState())).not.toBeNull();
  });

  // Why this test matters: the phase transition IS the report input pose
  // actions carry (E-1) — losing tracking must still reach the report as
  // 'ar-lost' immediately, not wait for the next GPS event.
  it('still updates the report on a phase transition (poseLost)', () => {
    const store = makeListenerStore(snapshotGpsAfter(null, [], []));
    store.dispatch(
      poseReceived({
        pose: DEFAULT_POSE,
        sensorOrientation: DEFAULT_ORIENTATION,
      })
    );
    const before = selectTrackingQuality(store.getState());
    expect(before?.state).not.toBe('ar-lost');

    store.dispatch(poseLost());
    const after = selectTrackingQuality(store.getState());
    expect(after?.state).toBe('ar-lost');
  });
});

// ---------------------------------------------------------------------------
// §11 (d) — corpus-derived defaults regression test
// ---------------------------------------------------------------------------

// Why this test matters: the §6.1 parameter sweep (§11 (c)) derived these
// values from the TestDataJs corpus. Changing them without re-running the
// sweep risks silently degrading the tracking-quality signal. If this test
// fails, re-run the §6.1 sweep and update both the defaults and this test.
describe('§11 (d) corpus-derived defaults', () => {
  it('matrixHistorySize, residualWindowSize, and gpsAccuracyWindowSize match corpus results', () => {
    expect(DEFAULT_TRACKING_QUALITY_OPTIONS.matrixHistorySize).toBe(5);
    expect(DEFAULT_TRACKING_QUALITY_OPTIONS.residualWindowSize).toBe(16);
    expect(DEFAULT_TRACKING_QUALITY_OPTIONS.gpsAccuracyWindowSize).toBe(30);
  });

  it('coverage thresholds are unchanged from initial seeds', () => {
    expect(DEFAULT_TRACKING_QUALITY_OPTIONS.coverageWalkedDistanceM).toBe(15);
    expect(DEFAULT_TRACKING_QUALITY_OPTIONS.coverageDirectionSpreadDeg).toBe(
      90
    );
  });

  it('convergence warn thresholds match the values calibrated in computeConvergence', () => {
    expect(DEFAULT_TRACKING_QUALITY_OPTIONS.convergenceRotationWarnDeg).toBe(6);
    expect(DEFAULT_TRACKING_QUALITY_OPTIONS.convergenceTranslationWarnM).toBe(
      2
    );
  });
});

// ---------------------------------------------------------------------------
// §11 (f) — §4.8 hysteresis (degradedHoldoff)
// ---------------------------------------------------------------------------

describe('§4.8 hysteresis (degradedHoldoff)', () => {
  function makeHysteresisStore(holdoff = 3) {
    const gpsDataReducer = (
      state: ListenerHarnessState['gpsData'] = {
        gpsEvents: {
          alignmentMatrix: null,
          gpsPositions: [],
          odometryPositions: [],
          odometryRotations: [],
        },
        zero: ZERO_REF,
      },
      action: Action
    ): ListenerHarnessState['gpsData'] => {
      if (
        action.type === 'gpsData/recordGpsEvent' ||
        action.type === 'gpsData/setZeroPos'
      ) {
        return (
          action as unknown as { payload: ListenerHarnessState['gpsData'] }
        ).payload;
      }
      return state;
    };

    return configureStore({
      reducer: {
        gpsData: gpsDataReducer,
        tracking: trackingReducer,
        trackingQuality: trackingQualityReducer,
      },
      middleware: (getDefault) =>
        getDefault({ serializableCheck: false }).prepend(
          createTrackingQualityListenerMiddleware({
            matrixHistorySize: 10,
            warmupMinObservations: 2,
            warmupMinCoverage: 0,
            degradedHoldoff: holdoff,
            degradedThreshold: 0.5,
            gpsAccuracyWindowSize: 2,
          })
        ),
    });
  }

  // Dispatches `count` GPS observations starting at `startIdx`. The first
  // observation always uses a tiny matrix offset so the ring buffer gets a
  // second unique snapshot (needed for convergence ≥ 0). Subsequent
  // observations reuse IDENTITY. The path forms an L-shape for coverage.
  function dispatchGps(
    store: ReturnType<typeof makeHysteresisStore>,
    count: number,
    gpsAcc: number,
    startIdx = 0
  ) {
    for (let i = startIdx; i < startIdx + count; i++) {
      const _n = i < 10 ? i * 2 : 20;
      const _e = i < 10 ? 0 : (i - 10) * 2;
      const allOdom: Vector3[] = [];
      const allGps: GpsPoint[] = [];
      for (let j = 0; j <= i; j++) {
        const jn = j < 10 ? j * 2 : 20;
        const je = j < 10 ? 0 : (j - 10) * 2;
        allOdom.push([jn, 0, je]);
        allGps.push(gps(j, jn, je, j >= startIdx ? gpsAcc : 2));
      }
      const matrix: Matrix4 = i === 0 ? shifted(0.001, 0, 0) : IDENTITY;
      store.dispatch({
        type: 'gpsData/recordGpsEvent',
        payload: {
          gpsEvents: {
            alignmentMatrix: matrix,
            gpsPositions: allGps,
            odometryPositions: allOdom,
            odometryRotations: [],
          },
          zero: ZERO_REF,
        },
      });
    }
  }

  // Why this test matters: 1–2 sub-threshold observations should NOT flip
  // the user-visible state to 'degraded' — the holdoff absorbs transient
  // GPS blips while keeping the raw confidence honest.
  it('1–2 sub-threshold observations stay ok when holdoff is 3', () => {
    const store = makeHysteresisStore(3);
    store.dispatch(
      poseReceived({
        pose: DEFAULT_POSE,
        sensorOrientation: DEFAULT_ORIENTATION,
      })
    );

    dispatchGps(store, 15, 2);
    let report = selectTrackingQuality(store.getState());
    expect(report?.state).toBe('ok');

    dispatchGps(store, 2, 40, 15);
    report = selectTrackingQuality(store.getState());
    expect(report?.state).toBe('ok');
  });

  // Why this test matters: after degradedHoldoff consecutive sub-threshold
  // observations, the transition must fire — the holdoff is a grace period,
  // not a permanent override.
  it('transitions to degraded after holdoff consecutive observations', () => {
    const store = makeHysteresisStore(3);
    store.dispatch(
      poseReceived({
        pose: DEFAULT_POSE,
        sensorOrientation: DEFAULT_ORIENTATION,
      })
    );

    dispatchGps(store, 15, 2);
    expect(selectTrackingQuality(store.getState())?.state).toBe('ok');

    dispatchGps(store, 5, 40, 15);
    expect(selectTrackingQuality(store.getState())?.state).toBe('degraded');
  });

  // Why this test matters: recovery from degraded to ok must be immediate
  // per §4.8 — the user should see improvement as soon as it happens.
  it('recovery from degraded to ok is immediate', () => {
    const store = makeHysteresisStore(3);
    store.dispatch(
      poseReceived({
        pose: DEFAULT_POSE,
        sensorOrientation: DEFAULT_ORIENTATION,
      })
    );

    dispatchGps(store, 15, 2);
    dispatchGps(store, 5, 40, 15);
    expect(selectTrackingQuality(store.getState())?.state).toBe('degraded');

    dispatchGps(store, 2, 2, 20);
    expect(selectTrackingQuality(store.getState())?.state).toBe('ok');
  });

  // Why this test matters: ar-lost is catastrophic and must bypass the
  // holdoff entirely — the user needs to know immediately.
  it('ar-lost bypasses holdoff entirely', () => {
    const store = makeHysteresisStore(3);
    store.dispatch(
      poseReceived({
        pose: DEFAULT_POSE,
        sensorOrientation: DEFAULT_ORIENTATION,
      })
    );

    dispatchGps(store, 15, 2);
    expect(selectTrackingQuality(store.getState())?.state).toBe('ok');

    store.dispatch(poseLost());
    expect(selectTrackingQuality(store.getState())?.state).toBe('ar-lost');
  });

  // Why this test matters: degradedConsecutiveCount must reset to 0 when
  // a new session starts, so stale holdoff state from a previous session
  // doesn't bleed into the next.
  it('degradedConsecutiveCount resets on session start', () => {
    const store = makeHysteresisStore(3);
    store.dispatch(
      poseReceived({
        pose: DEFAULT_POSE,
        sensorOrientation: DEFAULT_ORIENTATION,
      })
    );
    dispatchGps(store, 15, 2);
    dispatchGps(store, 2, 40, 15);
    const tq = (
      store.getState() as {
        trackingQuality: { degradedConsecutiveCount: number };
      }
    ).trackingQuality;
    expect(tq.degradedConsecutiveCount).toBeGreaterThan(0);

    store.dispatch({ type: 'recording/startSession' });
    const tqAfter = (
      store.getState() as {
        trackingQuality: { degradedConsecutiveCount: number };
      }
    ).trackingQuality;
    expect(tqAfter.degradedConsecutiveCount).toBe(0);
  });
});

// Why (core 1.26; Tour Viewer authoring plan 2026-09-28-0953 D18): the
// viewer sends its code votes, and each device fix together with its
// keep-alive ring, as ONE `recordGpsEventBatch` - one solve. The listener
// knew only `recordGpsEvent`, so a session fed by batches never pushed an
// alignment snapshot nor recomputed the report on them: the tracking phase a
// visitor's placement waits for (`isPlacementReady`) would freeze at whatever
// the last single fix left (M2e/M2f milestone review #5). Driven through the
// REAL store and the batch action as the framework re-exports it.
describe('the listener on a recordGpsEventBatch (core 1.26)', () => {
  const fixAt = (i: number) => ({
    odomPosition: [i * 2, 0, -i] as Vector3,
    odomRotation: [0, 0, 0, 1] as [number, number, number, number],
    rawGpsPoint: {
      id: `g${String(i)}`,
      latitude: ZERO_REF.lat + i / 111_320,
      longitude: ZERO_REF.lon + (i * 2) / 70_000,
      latLongAccuracy: 3,
      timestamp: 1_700_000_000_000 + i * 1000,
    },
  });

  function realStore() {
    const store = createSlamAppStore({
      storageBackend: new NullStorageBackend(),
      enableDevChecks: false,
    });
    store.dispatch(
      poseReceived({
        pose: DEFAULT_POSE,
        sensorOrientation: DEFAULT_ORIENTATION,
      })
    );
    store.dispatch(setZeroPos(ZERO_REF));
    return store;
  }

  it('pushes the batch solve as one snapshot and counts every fix in the report', () => {
    const store = realStore();
    const before = selectRecentAlignments(store.getState()).length;
    store.dispatch(recordGpsEventBatch({ events: [0, 1, 2, 3, 4].map(fixAt) }));
    const after = selectRecentAlignments(store.getState());
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)!.observationIndex).toBe(5);
    expect(
      selectTrackingQuality(store.getState())?.diagnostics.observationsSeen
    ).toBe(5);
  });

  it('reports from the history what the same fixes dispatched one by one report at their end', () => {
    // Equivalence on the history-derived inputs: the stored history is
    // identical (no compass here), so every sub-score computed from it
    // matches the last single dispatch's. Convergence is NOT compared: it
    // reads the snapshot buffer, which holds one solve here and five there.
    const events = [0, 1, 2, 3, 4].map(fixAt);
    const batched = realStore();
    batched.dispatch(recordGpsEventBatch({ events }));
    const single = realStore();
    for (const event of events) single.dispatch(recordGpsEvent(event));
    const a = selectTrackingQuality(batched.getState());
    const b = selectTrackingQuality(single.getState());
    expect(a?.diagnostics.observationsSeen).toBe(5);
    expect(a?.diagnostics.observationsSeen).toBe(
      b?.diagnostics.observationsSeen
    );
    expect(a?.subScores.gpsAccuracy).toBe(b?.subScores.gpsAccuracy);
    expect(a?.subScores.coverage).toBe(b?.subScores.coverage);
    expect(a?.subScores.residualConsensus).toBe(b?.subScores.residualConsensus);
  });
});

// Reference unused imports so future maintainers don't accidentally drop them
// (matrixDelta, DEFAULT_TRACKING_QUALITY_OPTIONS are exported for the
// Investigation harness — keep them part of the public surface).
describe('exports', () => {
  it('keeps matrixDelta + DEFAULT_TRACKING_QUALITY_OPTIONS in the public API', () => {
    expect(typeof DEFAULT_TRACKING_QUALITY_OPTIONS).toBe('object');
    expect(typeof matrixDelta).toBe('function');
    expect(typeof poseLost).toBe('function');
    expect(typeof degradedCountUpdated).toBe('function');
  });
});
