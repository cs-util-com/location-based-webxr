/**
 * The `?qrperf` tally of the demo's fused QR pose (QR near-frontal pose plan
 * M3b b5, §25): per lock, whether the fused pose was stable, which rotation
 * it carried (joint or the averaged fallback), how well the views fit, how
 * far the joint rotation sat from today's averaged one - and the STABLE fused
 * pose's own jumps and wall elevation (what the overlay shows), plus the
 * frame changes the demo saw. See fused-tally.ts.md.
 */

import type { QrFusedPose } from "gps-plus-slam-app-framework/ar/qr";
import { nearestRankPercentile } from "./pipeline-timings.js";
import {
  MAX_PAIR_GAP_MS,
  normalElevationDeg,
  quatAngleDeg,
} from "./pose-quality.js";

type Rotation = NonNullable<QrFusedPose["pose"]>["rotation"];

export interface FusedTallySummary {
  locks: number;
  stable: number;
  joint: number;
  averaged: number;
  /** Tracking-frame changes seen (the fused results' epoch moving on). */
  frameChanges: number;
  /** Median / 95th percentile of the median per-view fit, px (finite only). */
  fitP50Px: number | null;
  fitP95Px: number | null;
  /** Median / 95th percentile angle between joint and averaged, deg. */
  deltaP50Deg: number | null;
  deltaP95Deg: number | null;
  /**
   * The STABLE fused pose's own quality (what the overlay shows; plan §25):
   * jumps between consecutive stable results within 1 s of each other and in
   * one frame epoch, and the code normal's elevation - 0 for a code on a
   * vertical wall.
   */
  jumpDeg: {
    n: number;
    p50: number | null;
    p95: number | null;
    max: number | null;
  };
  wallElevationDeg: {
    n: number;
    p50Abs: number | null;
    p95Abs: number | null;
    meanSigned: number | null;
  };
}

const pct = (xs: readonly number[], p: number): number | null =>
  xs.length ? nearestRankPercentile(xs, p) : null;

const mean = (xs: readonly number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

export function createFusedTally(): {
  /** One lock's fused result, at `atMs` (any monotonic clock). */
  add(result: QrFusedPose, atMs: number): void;
  summary(): FusedTallySummary;
} {
  const counts = {
    locks: 0,
    stable: 0,
    joint: 0,
    averaged: 0,
    frameChanges: 0,
  };
  const fits: number[] = [];
  const deltas: number[] = [];
  const jumps: number[] = [];
  const elevations: number[] = [];
  let lastEpoch: number | null = null;
  let previous: { rotation: Rotation; atMs: number; epoch: number } | null =
    null;

  function addStablePose(result: QrFusedPose, atMs: number): void {
    const pose = result.pose;
    if (result.status !== "stable" || !pose) return;
    elevations.push(normalElevationDeg(pose.rotation));
    if (
      previous &&
      previous.epoch === result.frameEpoch &&
      atMs - previous.atMs <= MAX_PAIR_GAP_MS
    ) {
      jumps.push(quatAngleDeg(previous.rotation, pose.rotation));
    }
    previous = { rotation: pose.rotation, atMs, epoch: result.frameEpoch };
  }

  return {
    add(result, atMs) {
      counts.locks += 1;
      if (result.status === "stable") counts.stable += 1;
      if (result.method === "joint") counts.joint += 1;
      if (result.method === "averaged") counts.averaged += 1;
      if (lastEpoch !== null && result.frameEpoch > lastEpoch)
        counts.frameChanges += 1;
      lastEpoch = Math.max(lastEpoch ?? 0, result.frameEpoch);
      if (Number.isFinite(result.fitPx)) fits.push(result.fitPx);
      if (Number.isFinite(result.averagedRotationDeltaDeg))
        deltas.push(result.averagedRotationDeltaDeg);
      addStablePose(result, atMs);
    },
    summary() {
      const abs = elevations.map(Math.abs);
      return {
        ...counts,
        fitP50Px: pct(fits, 0.5),
        fitP95Px: pct(fits, 0.95),
        deltaP50Deg: pct(deltas, 0.5),
        deltaP95Deg: pct(deltas, 0.95),
        jumpDeg: {
          n: jumps.length,
          p50: pct(jumps, 0.5),
          p95: pct(jumps, 0.95),
          max: jumps.length ? Math.max(...jumps) : null,
        },
        wallElevationDeg: {
          n: elevations.length,
          p50Abs: pct(abs, 0.5),
          p95Abs: pct(abs, 0.95),
          meanSigned: mean(elevations),
        },
      };
    },
  };
}

const f = (v: number | null, d = 1): string =>
  v === null ? "-" : v.toFixed(d);

/** The report lines: the tally, then the stable fused pose's own quality. */
export function fusedLines(s: FusedTallySummary): string[] {
  return [
    `fused: ${s.locks} locks | stable ${s.stable} | joint ${s.joint} / averaged ${s.averaged} | frame changes ${s.frameChanges} | fit p50/p95 ${f(s.fitP50Px)}/${f(s.fitP95Px)} px | vs averaged p50/p95 ${f(s.deltaP50Deg)}/${f(s.deltaP95Deg)} deg`,
    `fused pose (stable): jump p50/p95/max ${f(s.jumpDeg.p50)}/${f(s.jumpDeg.p95)}/${f(s.jumpDeg.max)} deg (n ${s.jumpDeg.n}) | wall elevation |p50|/|p95| ${f(s.wallElevationDeg.p50Abs)}/${f(s.wallElevationDeg.p95Abs)} deg, mean ${f(s.wallElevationDeg.meanSigned)} deg`,
  ];
}
