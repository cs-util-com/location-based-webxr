/**
 * Pose-quality numbers for the `?qrperf` report: how much the solved code
 * orientation jumps between consecutive detections, how much the corners
 * jitter while the phone is still, the reprojection error, and the code
 * normal's elevation against gravity. Pure. See pose-quality.ts.md.
 */

import {
  meanEdgePx,
  type CornerOrderSource,
} from "gps-plus-slam-app-framework/ar/qr";
import {
  createBandedPercentiles,
  type BandPercentiles,
  type Banded,
} from "./edge-bands.js";
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
  /** Where the detection's corner order came from, when the detector said (plan §39 F0b). */
  orderSource?: CornerOrderSource;
  /** When the solve happened, ms (any monotonic clock). */
  atMs: number;
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
  /**
   * Where each solve's corner order came from, since start (plan §39 F0b):
   * the finder patterns, the canonicaliser's memory, the detector's own
   * order, or not said.
   */
  orderSources: Record<CornerOrderSource | "unknown", number>;
  /**
   * The jumps over 60 deg since start, split by whether the code's normal
   * survived: `relabel` (a roll about the normal - a corner-order flip)
   * or `normalChange` (the planar solve's two-fold ambiguity or a real
   * turn); `sources` counts the order sources on both sides of each, as
   * "before>after". A flip episode that returns is two jumps.
   */
  bigJumps: {
    relabel: number;
    normalChange: number;
    sources: Record<string, number>;
  };
  /**
   * The same reprojection error per code-size band (the corners' mean edge
   * length; plan §34 R2) - the 4 px single-frame gate is absolute too.
   */
  reprojectionByEdgePx: Banded<BandPercentiles>;
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
/** Detections further apart than this are not a pair (the code was lost). */
export const MAX_PAIR_GAP_MS = 1000;
/** A jump this large is a corner-order change, not motion or noise. */
const ORDER_CHANGE_DEG = 60;

/** Angle between two unit quaternions, degrees. */
export function quatAngleDeg(a: Quat, b: Quat): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, dot)) * RAD_TO_DEG;
}

/** Elevation of the rotated +z axis above the horizontal plane (y up), degrees. */
export function normalElevationDeg(q: Quat): number {
  const [x, y, z, w] = q;
  const ny = 2 * (y * z - w * x);
  return Math.asin(Math.max(-1, Math.min(1, ny))) * RAD_TO_DEG;
}

/**
 * A corner relabel rolls the code about its own normal, so the normal stays
 * put; the planar solve's ambiguity or a real turn moves it. Normals closer
 * than this count as "survived".
 */
const NORMAL_SURVIVES_DEG = 30;

/** The code's printed-face normal (its +z) in the world. */
function faceNormal(q: Quat): Vec3 {
  const [x, y, z, w] = q;
  return [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
}

function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.max(-1, Math.min(1, dot))) * RAD_TO_DEG;
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
  const reprojectionBands = createBandedPercentiles(window);
  const orderSources = { finder: 0, memory: 0, native: 0, unknown: 0 };
  const bigJumps = {
    relabel: 0,
    normalChange: 0,
    sources: {} as Record<string, number>,
  };
  let previous: PoseQualitySample | null = null;

  function push(values: number[], v: number): void {
    values.push(v);
    if (values.length > window) values.shift();
  }

  function addPair(prev: PoseQualitySample, cur: PoseQualitySample): void {
    const jump = quatAngleDeg(prev.qrRotationWorld, cur.qrRotationWorld);
    push(series.jump, jump);
    // A relabelled corner is not a moved corner: keep order changes out of
    // the jitter.
    if (jump > ORDER_CHANGE_DEG) {
      addBigJump(prev, cur);
      return;
    }
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

  function addBigJump(prev: PoseQualitySample, cur: PoseQualitySample): void {
    const normalDeg = angleBetweenDeg(
      faceNormal(prev.qrRotationWorld),
      faceNormal(cur.qrRotationWorld),
    );
    if (normalDeg < NORMAL_SURVIVES_DEG) bigJumps.relabel += 1;
    else bigJumps.normalChange += 1;
    const key = `${prev.orderSource ?? "unknown"}>${cur.orderSource ?? "unknown"}`;
    bigJumps.sources[key] = (bigJumps.sources[key] ?? 0) + 1;
  }

  return {
    add(sample) {
      orderSources[sample.orderSource ?? "unknown"] += 1;
      push(series.reprojection, sample.reprojectionErrorPx);
      reprojectionBands.add(
        meanEdgePx(sample.corners),
        sample.reprojectionErrorPx,
      );
      push(series.elevation, normalElevationDeg(sample.qrRotationWorld));
      if (
        previous &&
        previous.text === sample.text &&
        sample.atMs - previous.atMs <= MAX_PAIR_GAP_MS
      ) {
        addPair(previous, sample);
      }
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
        orderSources: { ...orderSources },
        bigJumps: { ...bigJumps, sources: { ...bigJumps.sources } },
        reprojectionByEdgePx: reprojectionBands.summary(),
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
