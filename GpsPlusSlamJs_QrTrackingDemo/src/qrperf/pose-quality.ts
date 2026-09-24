/**
 * Pose-quality numbers for the `?qrperf` report: how much the solved code
 * orientation jumps between consecutive detections, how much the corners
 * jitter while the phone is still, the reprojection error, and the code
 * normal's elevation against gravity. Pure. See pose-quality.ts.md.
 */

import { nearestRankPercentile } from "./pipeline-timings.js";
import type { Point } from "./corner-compare.js";

type Quat = readonly [number, number, number, number];
type Vec3 = readonly [number, number, number];

/** One solved detection, as the demo's solve sees it. */
export interface PoseQualitySample {
  /** The decoded payload: consecutive samples pair only within one code. */
  text: string;
  /** The code's world orientation, xyzw; its +z is the printed face's normal. */
  qrRotationWorld: Quat;
  corners: readonly Point[];
  /** The camera pose the corners were solved against (world, metres). */
  cameraPosition: Vec3;
  cameraRotation: Quat;
  reprojectionErrorPx: number;
}

interface Percentiles {
  n: number;
  p50: number;
  p95: number;
}

export interface PoseQualitySummary {
  /** Consecutive same-code pairs in the window. */
  pairs: number;
  jumpDeg: { p50: number; p95: number; max: number };
  /** Fraction of pairs whose orientation jumped by more than 3 / 5 / 10 deg. */
  jumpShare: { over3: number; over5: number; over10: number };
  /** Pairs over 60 deg: corner-order snaps, not pose noise. */
  jumpsOver60: number;
  /** Largest corner displacement between consecutive same-code frames while
   *  the camera stayed within the gate (strict: 2 mm / 0.1 deg; loose: 5 mm /
   *  0.3 deg). A lower bound on per-frame corner error: a static bias does
   *  not move. */
  stillJitterPx: { strict: Percentiles; loose: Percentiles };
  reprojectionPx: Percentiles;
  /** Elevation of the code normal above the horizon. Meaningful for a code
   *  on a vertical wall, where the truth is 0. */
  wallElevationDeg: {
    n: number;
    p50Abs: number;
    p95Abs: number;
    meanSigned: number;
  };
}

export interface PoseQualityOptions {
  /** Values kept per series. Default 240 (~30 s at 8 Hz). */
  window?: number;
}

/** Camera-motion gates for "still", as [metres, degrees]. */
const STILL_GATES = {
  strict: [0.002, 0.1],
  loose: [0.005, 0.3],
} as const;

const RAD_TO_DEG = 180 / Math.PI;

/** Angle between two unit quaternions, degrees. */
function quatAngleDeg(a: Quat, b: Quat): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, dot)) * RAD_TO_DEG;
}

/** Elevation of the rotated +z axis above the horizontal plane (y up), degrees. */
function normalElevationDeg(q: Quat): number {
  const [x, y, z, w] = q;
  const ny = 2 * (y * z - w * x);
  return Math.asin(Math.max(-1, Math.min(1, ny))) * RAD_TO_DEG;
}

function maxCornerShift(a: readonly Point[], b: readonly Point[]): number {
  let max = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    max = Math.max(max, Math.hypot(a[i]!.x - b[i]!.x, a[i]!.y - b[i]!.y));
  }
  return max;
}

function percentiles(values: readonly number[]): Percentiles {
  return {
    n: values.length,
    p50: nearestRankPercentile(values, 0.5),
    p95: nearestRankPercentile(values, 0.95),
  };
}

function share(values: readonly number[], over: number): number {
  return values.length === 0
    ? 0
    : values.filter((v) => v > over).length / values.length;
}

export function createPoseQuality(options: PoseQualityOptions = {}): {
  add(sample: PoseQualitySample): void;
  summary(): PoseQualitySummary;
} {
  const window = Math.max(1, Math.floor(options.window ?? 240));
  const series = {
    jump: [] as number[],
    strict: [] as number[],
    loose: [] as number[],
    reprojection: [] as number[],
    elevation: [] as number[],
  };
  let previous: PoseQualitySample | null = null;

  function push(values: number[], v: number): void {
    values.push(v);
    if (values.length > window) values.shift();
  }

  function addPair(prev: PoseQualitySample, cur: PoseQualitySample): void {
    push(series.jump, quatAngleDeg(prev.qrRotationWorld, cur.qrRotationWorld));
    const movedM = Math.hypot(
      cur.cameraPosition[0] - prev.cameraPosition[0],
      cur.cameraPosition[1] - prev.cameraPosition[1],
      cur.cameraPosition[2] - prev.cameraPosition[2],
    );
    const turnedDeg = quatAngleDeg(prev.cameraRotation, cur.cameraRotation);
    const jitter = maxCornerShift(prev.corners, cur.corners);
    for (const gate of ["strict", "loose"] as const) {
      const [m, deg] = STILL_GATES[gate];
      if (movedM <= m && turnedDeg <= deg) push(series[gate], jitter);
    }
  }

  return {
    add(sample) {
      push(series.reprojection, sample.reprojectionErrorPx);
      push(series.elevation, normalElevationDeg(sample.qrRotationWorld));
      if (previous && previous.text === sample.text) addPair(previous, sample);
      previous = sample;
    },
    summary() {
      const jumps = series.jump;
      const absElevation = series.elevation.map(Math.abs);
      const meanSigned =
        series.elevation.length === 0
          ? Number.NaN
          : series.elevation.reduce((a, b) => a + b, 0) /
            series.elevation.length;
      return {
        pairs: jumps.length,
        jumpDeg: {
          p50: nearestRankPercentile(jumps, 0.5),
          p95: nearestRankPercentile(jumps, 0.95),
          max: jumps.length === 0 ? Number.NaN : Math.max(...jumps),
        },
        jumpShare: {
          over3: share(jumps, 3),
          over5: share(jumps, 5),
          over10: share(jumps, 10),
        },
        jumpsOver60: jumps.filter((v) => v > 60).length,
        stillJitterPx: {
          strict: percentiles(series.strict),
          loose: percentiles(series.loose),
        },
        reprojectionPx: percentiles(series.reprojection),
        wallElevationDeg: {
          n: series.elevation.length,
          p50Abs: nearestRankPercentile(absElevation, 0.5),
          p95Abs: nearestRankPercentile(absElevation, 0.95),
          meanSigned,
        },
      };
    },
  };
}
