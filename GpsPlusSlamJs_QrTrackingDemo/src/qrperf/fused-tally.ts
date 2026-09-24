/**
 * The `?qrperf` tally of the demo's fused QR pose (QR near-frontal pose plan
 * M3b b5, §25): per lock, whether the fused pose was stable, which rotation
 * it carried (joint or the averaged fallback), how well the views fit, how
 * far the joint rotation sat from today's averaged one - and the STABLE fused
 * pose's own jumps and wall elevation (what the overlay shows), the frame
 * changes the demo saw, and the motion detector's modes and raw signals
 * (plan §26). See fused-tally.ts.md.
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
  /**
   * The motion detector (plan §26), over results that carry a reading: how
   * many showed each mode, how often the mode switched within a frame epoch,
   * and the raw signals' distribution over STILL readings only - the newest
   * view's corner error at the others' rotation (what the 3 px turning
   * threshold must sit above) and its position offset (the 3 cm moving
   * threshold). During motion the signals measure the motion, not the noise.
   */
  motion: {
    n: number;
    still: number;
    moving: number;
    turning: number;
    movingTurning: number;
    switches: number;
    turnSignalP50Px: number | null;
    turnSignalP95Px: number | null;
    moveSignalP95Cm: number | null;
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
  const motion = createMotionTally();

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
      motion.add(result);
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
        motion: motion.summary(),
      };
    },
  };
}

const MODE_KEYS = {
  still: "still",
  moving: "moving",
  turning: "turning",
  "moving+turning": "movingTurning",
} as const;

function createMotionTally(): {
  add(result: QrFusedPose): void;
  summary(): FusedTallySummary["motion"];
} {
  const counts = { n: 0, still: 0, moving: 0, turning: 0, movingTurning: 0 };
  let switches = 0;
  let last: { state: string; epoch: number } | null = null;
  const turnSignals: number[] = [];
  const moveSignals: number[] = [];
  return {
    add(result) {
      const m = result.motion;
      if (!m) return;
      counts.n += 1;
      counts[MODE_KEYS[m.state]] += 1;
      if (last && last.epoch === result.frameEpoch && last.state !== m.state)
        switches += 1;
      last = { state: m.state, epoch: result.frameEpoch };
      if (m.state !== "still") return;
      if (m.newestFitPx !== null && Number.isFinite(m.newestFitPx))
        turnSignals.push(m.newestFitPx);
      if (m.offsetM !== null && Number.isFinite(m.offsetM))
        moveSignals.push(m.offsetM * 100);
    },
    summary() {
      return {
        ...counts,
        switches,
        turnSignalP50Px: pct(turnSignals, 0.5),
        turnSignalP95Px: pct(turnSignals, 0.95),
        moveSignalP95Cm: pct(moveSignals, 0.95),
      };
    },
  };
}

const f = (v: number | null, d = 1): string =>
  v === null ? "-" : v.toFixed(d);

/** The report lines: the tally, the stable fused pose's own quality, the motion modes. */
export function fusedLines(s: FusedTallySummary): string[] {
  return [
    `fused: ${s.locks} locks | stable ${s.stable} | joint ${s.joint} / averaged ${s.averaged} | frame changes ${s.frameChanges} | fit p50/p95 ${f(s.fitP50Px)}/${f(s.fitP95Px)} px | vs averaged p50/p95 ${f(s.deltaP50Deg)}/${f(s.deltaP95Deg)} deg`,
    `fused pose (stable): jump p50/p95/max ${f(s.jumpDeg.p50)}/${f(s.jumpDeg.p95)}/${f(s.jumpDeg.max)} deg (n ${s.jumpDeg.n}) | wall elevation |p50|/|p95| ${f(s.wallElevationDeg.p50Abs)}/${f(s.wallElevationDeg.p95Abs)} deg, mean ${f(s.wallElevationDeg.meanSigned)} deg`,
    `motion: still ${s.motion.still} | moving ${s.motion.moving} | turning ${s.motion.turning} | both ${s.motion.movingTurning} | switches ${s.motion.switches} (n ${s.motion.n}) | still turn signal p50/p95 ${f(s.motion.turnSignalP50Px)}/${f(s.motion.turnSignalP95Px)} px | still move signal p95 ${f(s.motion.moveSignalP95Cm)} cm`,
  ];
}
