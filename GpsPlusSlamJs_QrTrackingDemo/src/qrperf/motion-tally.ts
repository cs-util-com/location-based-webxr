/**
 * The `?qrperf` tally of the motion detector's readings (QR near-frontal
 * pose plan §26, §30): the modes shown and their switches, the still
 * signals' distribution, the candidate runs that began while still, and a
 * log of each confirmed switch with the size state at that moment - what
 * the owner's phone repeat of tests A and E must answer. Fed by
 * `fused-tally.ts`. See motion-tally.ts.md.
 */

import type { QrFusedPose } from "gps-plus-slam-app-framework/ar/qr";
import { nearestRankPercentile } from "./pipeline-timings.js";

type Motion = NonNullable<QrFusedPose["motion"]>;

/** The size lifecycle and estimate at a reading, when the demo knows it. */
export interface SizeState {
  status: string;
  estimateM: number | null;
}

/** Runs of consecutive candidates that began while still, by length. */
export interface RunLengths {
  r1: number;
  r2: number;
  r3: number;
  r4plus: number;
}

export interface MotionSwitch {
  from: string;
  to: string;
  /** Since the tally's first reading / the first reading of this frame epoch. */
  sinceFirstMs: number;
  sinceEpochMs: number;
  sizeStatus: string | null;
  sizeCm: number | null;
  offsetCm: number | null;
  turnSignalPx: number | null;
  speedCmS: number | null;
  turnRateDegS: number | null;
}

export interface MotionTallySummary {
  n: number;
  still: number;
  moving: number;
  turning: number;
  movingTurning: number;
  /** Mode switches within a frame epoch. */
  switches: number;
  /** The still readings' signals: what the thresholds must sit above. */
  turnSignalP50Px: number | null;
  turnSignalP95Px: number | null;
  turnSignalP99Px: number | null;
  turnSignalMaxPx: number | null;
  moveSignalP50Cm: number | null;
  moveSignalP95Cm: number | null;
  moveSignalP99Cm: number | null;
  moveSignalMaxCm: number | null;
  /**
   * Runs of consecutive moving / turning candidates that BEGAN while the
   * mode was still. A run of 2 would have flipped a 2-detection rule; one
   * of 4+ is what the current rule confirms.
   */
  candidateRuns: { moving: RunLengths; turning: RunLengths };
  /** The first LOG_CAP confirmed switches, and how many more there were. */
  switchLog: { log: MotionSwitch[]; dropped: number };
}

const LOG_CAP = 60;

const MODE_KEYS = {
  still: "still",
  moving: "moving",
  turning: "turning",
  "moving+turning": "movingTurning",
} as const;

const pct = (xs: readonly number[], p: number): number | null =>
  xs.length ? nearestRankPercentile(xs, p) : null;

const max = (xs: readonly number[]): number | null =>
  xs.length ? Math.max(...xs) : null;

const finite = (v: number | null): v is number =>
  v !== null && Number.isFinite(v);

/** `v x k`, rounded to 0.01 so the log reads 21 cm, not 21.000000000000004. */
const scaled = (v: number | null, k: number): number | null =>
  finite(v) ? Math.round(v * k * 100) / 100 : null;

/** One flag's candidate runs: counts a run when it ends. */
function createRunCounter(): {
  add(candidate: boolean, startsRun: boolean): void;
  close(): void;
  lengths(): RunLengths;
} {
  const hist: RunLengths = { r1: 0, r2: 0, r3: 0, r4plus: 0 };
  let run = 0;
  const bucket = (n: number): keyof RunLengths =>
    n >= 4 ? "r4plus" : n === 3 ? "r3" : n === 2 ? "r2" : "r1";
  return {
    add(candidate, startsRun) {
      if (candidate && (run > 0 || startsRun)) {
        run += 1;
        return;
      }
      this.close();
    },
    close() {
      if (run > 0) hist[bucket(run)] += 1;
      run = 0;
    },
    lengths() {
      // An open run counts as it stands, without ending it.
      const out = { ...hist };
      if (run > 0) out[bucket(run)] += 1;
      return out;
    },
  };
}

function signalsOf(still: { turn: number[]; move: number[] }) {
  return {
    turnSignalP50Px: pct(still.turn, 0.5),
    turnSignalP95Px: pct(still.turn, 0.95),
    turnSignalP99Px: pct(still.turn, 0.99),
    turnSignalMaxPx: max(still.turn),
    moveSignalP50Cm: pct(still.move, 0.5),
    moveSignalP95Cm: pct(still.move, 0.95),
    moveSignalP99Cm: pct(still.move, 0.99),
    moveSignalMaxCm: max(still.move),
  };
}

export function createMotionTally(): {
  /** One result at `atMs`; `size` is the latest size state, when known. */
  add(result: QrFusedPose, atMs: number, size?: SizeState): void;
  summary(): MotionTallySummary;
} {
  const counts = { n: 0, still: 0, moving: 0, turning: 0, movingTurning: 0 };
  let switches = 0;
  let last: { state: string; epoch: number } | null = null;
  let firstMs: number | null = null;
  let epochStartMs: number | null = null;
  let size: SizeState | null = null;
  const still = { turn: [] as number[], move: [] as number[] };
  const runs = { moving: createRunCounter(), turning: createRunCounter() };
  const log: MotionSwitch[] = [];
  let dropped = 0;

  function logSwitch(from: string, m: Motion, atMs: number): void {
    switches += 1;
    if (log.length >= LOG_CAP) {
      dropped += 1;
      return;
    }
    log.push({
      from,
      to: m.state,
      sinceFirstMs: atMs - (firstMs ?? atMs),
      sinceEpochMs: atMs - (epochStartMs ?? atMs),
      sizeStatus: size ? size.status : null,
      sizeCm: size ? scaled(size.estimateM, 100) : null,
      offsetCm: scaled(m.offsetM, 100),
      turnSignalPx: m.newestFitPx,
      speedCmS: scaled(m.speedMps, 100),
      turnRateDegS: m.turnRateDegPerS,
    });
  }

  function addStillSignals(m: Motion): void {
    if (finite(m.newestFitPx)) still.turn.push(m.newestFitPx);
    if (finite(m.offsetM)) still.move.push(m.offsetM * 100);
  }

  return {
    add(result, atMs, sizeNow) {
      if (sizeNow) size = sizeNow;
      const m = result.motion;
      if (!m) return;
      firstMs ??= atMs;
      const newEpoch = last === null || last.epoch !== result.frameEpoch;
      if (newEpoch) {
        epochStartMs = atMs;
        runs.moving.close();
        runs.turning.close();
      } else if (last && last.state !== m.state) logSwitch(last.state, m, atMs);
      last = { state: m.state, epoch: result.frameEpoch };
      counts.n += 1;
      counts[MODE_KEYS[m.state]] += 1;
      const isStill = m.state === "still";
      runs.moving.add(m.movingCandidate, isStill);
      runs.turning.add(m.turningCandidate, isStill);
      if (isStill) addStillSignals(m);
    },
    summary() {
      return {
        ...counts,
        switches,
        ...signalsOf(still),
        candidateRuns: {
          moving: runs.moving.lengths(),
          turning: runs.turning.lengths(),
        },
        switchLog: { log: [...log], dropped },
      };
    },
  };
}
