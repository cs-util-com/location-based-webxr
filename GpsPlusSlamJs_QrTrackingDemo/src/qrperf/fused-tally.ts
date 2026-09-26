/**
 * The `?qrperf` tally of the demo's fused QR pose (QR near-frontal pose plan
 * M3b b5, §25): per lock, whether the fused pose was stable, which rotation
 * it carried (joint or the averaged fallback), how well the views fit, how
 * far the joint rotation sat from today's averaged one - and the STABLE fused
 * pose's own jumps and wall elevation (what the overlay shows), the frame
 * changes the demo saw, and the motion detector's readings (plan §26, §30;
 * `motion-tally.ts`). See fused-tally.ts.md.
 */

import {
  createFusedPoseTally,
  type QrFusedPose,
} from "gps-plus-slam-app-framework/ar/qr";
import { nearestRankPercentile } from "./pipeline-timings.js";
import {
  bandsLine,
  createBandedPercentiles,
  edgeBand,
  perBand,
  type BandPercentiles,
  type Banded,
} from "./edge-bands.js";
import {
  createMotionTally,
  type MotionTallySummary,
  type SizeState,
} from "./motion-tally.js";
import {
  MAX_PAIR_GAP_MS,
  normalElevationDeg,
  quatAngleDeg,
} from "./pose-quality.js";

type Pose = NonNullable<QrFusedPose["pose"]>;

export interface FusedTallySummary {
  /** Locks tallied (re-reads excluded). */
  locks: number;
  /**
   * Locks whose result's newest detection did not advance: the fused window
   * did not read the new detection (since plan §54, a native frame of a
   * code whose order is known). Counted apart and nothing else - they would
   * add 0 deg jumps and duplicate motion readings.
   */
  reReads: number;
  /**
   * Locks (re-reads excluded) whose run had native entries ignored
   * (`QrFusedPose.nativeIgnored` > 0, plan §57 #2): the rule at work inside
   * a window, which `reReads` cannot see.
   */
  nativeIgnoredLocks: number;
  stable: number;
  joint: number;
  averaged: number;
  /** Tracking-frame changes seen (the fused results' epoch moving on). */
  frameChanges: number;
  /**
   * Median / 95th percentile of the median per-view fit, px (finite only,
   * over windows of at least 5 views - the ones the gate can open on).
   */
  fitP50Px: number | null;
  fitP95Px: number | null;
  /** Median / 95th percentile angle between joint and averaged, deg (same windows). */
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
  /** The same pairs' position jumps, cm: the overlay's position steadiness. */
  positionJumpCm: {
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
  /** The motion detector's readings (`motion-tally.ts`). */
  motion: MotionTallySummary;
  /** Why locks were not stable (plan §34 R1/R2), per `notStableReason`. */
  notStable: {
    views: number;
    fit: number;
    fallback: number;
    motion: number;
    order: number;
  };
  /** The fit (same windows as `fitP50Px`) per code-size band. */
  fitByEdgePx: Banded<BandPercentiles>;
  /** Locks and stable locks per code-size band (the window's median edge). */
  stableByEdgePx: Banded<{ locks: number; stable: number }>;
}

const pct = (xs: readonly number[], p: number): number | null =>
  xs.length ? nearestRankPercentile(xs, p) : null;

const mean = (xs: readonly number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

export function createFusedTally(): {
  /**
   * One lock's fused result, at `atMs` (any monotonic clock); `size` is
   * the code's size state then, when the demo knows it.
   */
  add(result: QrFusedPose, atMs: number, size?: SizeState): void;
  summary(): FusedTallySummary;
} {
  // Locks, re-reads, stable and the not-stable reasons: the framework's
  // counting rule, shared with the TourViewer's readout (plan §66).
  const lockCounts = createFusedPoseTally();
  const counts = {
    joint: 0,
    averaged: 0,
    frameChanges: 0,
  };
  const fits: number[] = [];
  const deltas: number[] = [];
  const jumps: number[] = [];
  const positionJumps: number[] = [];
  const fitBands = createBandedPercentiles();
  const stableBands = perBand(() => ({ locks: 0, stable: 0 }));
  const elevations: number[] = [];
  let lastEpoch: number | null = null;
  let previous: { pose: Pose; atMs: number; epoch: number } | null = null;
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
      jumps.push(quatAngleDeg(previous.pose.rotation, pose.rotation));
      positionJumps.push(distanceCm(previous.pose.position, pose.position));
    }
    previous = { pose, atMs, epoch: result.frameEpoch };
  }

  function addCounts(result: QrFusedPose): void {
    if (result.method === "joint") counts.joint += 1;
    if (result.method === "averaged") counts.averaged += 1;
    if (lastEpoch !== null && result.frameEpoch > lastEpoch)
      counts.frameChanges += 1;
    lastEpoch = Math.max(lastEpoch ?? 0, result.frameEpoch);
  }

  /** Fit, delta and the size bands (the gate's own windows for the fit). */
  function addFitAndBands(result: QrFusedPose): void {
    const band = edgeBand(result.edgePx);
    if (band) {
      stableBands[band].locks += 1;
      if (result.status === "stable") stableBands[band].stable += 1;
    }
    if (result.views < GATE_MIN_VIEWS) return;
    fitBands.add(result.edgePx, result.fitPx);
    if (Number.isFinite(result.fitPx)) fits.push(result.fitPx);
    if (Number.isFinite(result.averagedRotationDeltaDeg))
      deltas.push(result.averagedRotationDeltaDeg);
  }

  return {
    add(result, atMs, size) {
      // A re-read counts there and nothing else here.
      if (!lockCounts.add(result)) return;
      addCounts(result);
      addFitAndBands(result);
      addStablePose(result, atMs);
      motion.add(result, atMs, size);
    },
    summary() {
      const abs = elevations.map(Math.abs);
      const locks = lockCounts.summary();
      return {
        ...counts,
        locks: locks.locks,
        stable: locks.stable,
        reReads: locks.reReads,
        nativeIgnoredLocks: locks.nativeIgnoredLocks,
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
        positionJumpCm: {
          n: positionJumps.length,
          p50: pct(positionJumps, 0.5),
          p95: pct(positionJumps, 0.95),
          max: positionJumps.length ? Math.max(...positionJumps) : null,
        },
        wallElevationDeg: {
          n: elevations.length,
          p50Abs: pct(abs, 0.5),
          p95Abs: pct(abs, 0.95),
          meanSigned: mean(elevations),
        },
        motion: motion.summary(),
        notStable: locks.notStable,
        fitByEdgePx: fitBands.summary(),
        stableByEdgePx: {
          small: { ...stableBands.small },
          medium: { ...stableBands.medium },
          large: { ...stableBands.large },
        },
      };
    },
  };
}

/**
 * The fused window's gate needs this many views (the framework's default
 * `minViews`, which the demo uses). Fit and joint-vs-averaged are tallied
 * over such windows only: a motion-cut 1-view window or an early small one
 * fits trivially and would pull the percentiles down (b5 review #5).
 */
const GATE_MIN_VIEWS = 5;

function distanceCm(a: Pose["position"], b: Pose["position"]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100;
}

const f = (v: number | null, d = 1): string =>
  v === null ? "-" : v.toFixed(d);

const runs = (r: MotionTallySummary["candidateRuns"]["moving"]): string =>
  `${r.r1}/${r.r2}/${r.r3}/${r.r4plus}`;

/** The motion lines: modes and switches, the still signals, candidate runs. */
function motionLines(m: MotionTallySummary): string[] {
  return [
    `motion: still ${m.still} | moving ${m.moving} | turning ${m.turning} | both ${m.movingTurning} | switches ${m.switches} (n ${m.n}, log ${m.switchLog.log.length}, dropped ${m.switchLog.dropped})`,
    `motion still signals: turn p50/p95/p99/max ${f(m.turnSignalP50Px)}/${f(m.turnSignalP95Px)}/${f(m.turnSignalP99Px)}/${f(m.turnSignalMaxPx)} px | move p50/p95/p99/max ${f(m.moveSignalP50Cm)}/${f(m.moveSignalP95Cm)}/${f(m.moveSignalP99Cm)}/${f(m.moveSignalMaxCm)} cm`,
    `motion candidate runs from still (1/2/3/4+): moving ${runs(m.candidateRuns.moving)} | turning ${runs(m.candidateRuns.turning)}`,
    `motion still turn signal by code size p50/p95: ${bandsLine(m.stillTurnSignalByEdgePx)}`,
    `motion during motion: n ${m.duringMotion.n}, no signal ${m.duringMotion.noSignal} | turn p50/p95 ${f(m.duringMotion.turnSignalP50Px)}/${f(m.duringMotion.turnSignalP95Px)} px | move p50/p95 ${f(m.duringMotion.moveSignalP50Cm)}/${f(m.duringMotion.moveSignalP95Cm)} cm`,
  ];
}

/** The report lines: the tally, the stable fused pose's own quality, the motion. */
export function fusedLines(s: FusedTallySummary): string[] {
  return [
    `fused: ${s.locks} locks (+${s.reReads} re-reads of an ignored native frame; natives ignored in ${s.nativeIgnoredLocks}) | stable ${s.stable} | joint ${s.joint} / averaged ${s.averaged} | frame changes ${s.frameChanges} | fit p50/p95 ${f(s.fitP50Px)}/${f(s.fitP95Px)} px | vs averaged p50/p95 ${f(s.deltaP50Deg)}/${f(s.deltaP95Deg)} deg`,
    `fused pose (stable): jump p50/p95/max ${f(s.jumpDeg.p50)}/${f(s.jumpDeg.p95)}/${f(s.jumpDeg.max)} deg, position jump p50/p95/max ${f(s.positionJumpCm.p50)}/${f(s.positionJumpCm.p95)}/${f(s.positionJumpCm.max)} cm (n ${s.jumpDeg.n}) | wall elevation |p50|/|p95| ${f(s.wallElevationDeg.p50Abs)}/${f(s.wallElevationDeg.p95Abs)} deg, mean ${f(s.wallElevationDeg.meanSigned)} deg`,
    `fused not stable: views ${s.notStable.views} | fit ${s.notStable.fit} | fallback ${s.notStable.fallback} | motion ${s.notStable.motion} | order ${s.notStable.order}`,
    `fused by code size (<150/150-300/>=300 px): stable ${s.stableByEdgePx.small.stable}/${s.stableByEdgePx.small.locks}, ${s.stableByEdgePx.medium.stable}/${s.stableByEdgePx.medium.locks}, ${s.stableByEdgePx.large.stable}/${s.stableByEdgePx.large.locks} | fit p50/p95 ${bandsLine(s.fitByEdgePx)}`,
    ...motionLines(s.motion),
  ];
}
