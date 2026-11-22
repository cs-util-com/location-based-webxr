/**
 * Whether the phone has come to rest, from `devicemotion` rotation rates:
 * the rule behind the cockpit's hands-off photo B. Pure, so the slice
 * keeps its state and every threshold is unit- and property-tested.
 *
 * @see still-detector.ts.md
 */
import { rateSum, STEADY_THRESHOLD, type RotationRate } from "./guided-model";

export interface StillConfig {
  /** At or below this smoothed level (deg/s) the phone counts as still. */
  readonly threshold: number;
  /** How long it has to stay still before the photo is taken (ms). */
  readonly dwellMs: number;
  /** A longer gap between readings starts the dwell again (ms). */
  readonly maxGapMs: number;
  /** This long without a reading, the sensor counts as lost (ms). */
  readonly lostMs: number;
  /** Above this smoothed level the phone counts as being moved (deg/s). */
  readonly moveLevel: number;
  /** How long the move has to last to count (ms). */
  readonly moveMs: number;
}

/**
 * The values the page uses. The threshold is the steady readout's, so
 * "steady" and "still" never disagree, and it is the lowest at which a
 * shaky hand comes to rest; the dwell is the shortest that a pause while
 * the phone is carried does not pass (swept in the tests: 2 to 16 deg/s,
 * 0.8 to 2.5 s).
 */
export const STILL_CONFIG: StillConfig = {
  threshold: STEADY_THRESHOLD,
  dwellMs: 1500,
  maxGapMs: 500,
  lostMs: 2000,
  moveLevel: 30,
  moveMs: 300,
};

export interface StillState {
  /** The smoothed motion level (deg/s), as `motionStep` gives it. */
  readonly level: number;
  /** A usable reading arrived since the start. */
  readonly seen: boolean;
  /** The time of the last usable reading, or of the start. */
  readonly lastT: number;
  /** Since when the level stayed at or below the threshold; null while not. */
  readonly stillSince: number | null;
  /** Since when the level stayed above the move level; null while not. */
  readonly moveSince: number | null;
  /** The move the pair needs was seen (true when it needs none). */
  readonly moved: boolean;
}

/** One `devicemotion` reading on the page clock. */
export interface MotionSample {
  readonly t: number;
  readonly rate: RotationRate;
}

/** The state at time `t`; with `needMove` the phone has to move first. */
export const stillStart = (t: number, needMove: boolean): StillState => ({
  level: 0,
  seen: false,
  lastT: Number.isFinite(t) ? t : 0,
  stillSince: null,
  moveSince: null,
  moved: !needMove,
});

/**
 * The state after one reading. A time that is not finite or runs
 * backwards changes nothing. A reading without a finite rate, or whose
 * sum overflows, is missing: it moves no level, but a gap past
 * `maxGapMs` since the last usable one ends the stillness run.
 */
export function stillStep(
  st: StillState,
  sample: MotionSample,
  cfg: StillConfig = STILL_CONFIG,
): StillState {
  const t = sample.t;
  if (!Number.isFinite(t) || t < st.lastT) {
    return st;
  }
  const gap = t - st.lastT > cfg.maxGapMs;
  const m = rateSum(sample.rate);
  if (m === null) {
    return gap && st.stillSince !== null ? { ...st, stillSince: null } : st;
  }
  const level = st.seen ? st.level * 0.8 + m * 0.2 : m;
  let { moved, moveSince } = st;
  if (!moved) {
    // A move, like stillness, has to be seen without a gap to count.
    moveSince = level > cfg.moveLevel ? (gap ? t : (moveSince ?? t)) : null;
    moved = moveSince !== null && t - moveSince >= cfg.moveMs;
  }
  const still = moved && level <= cfg.threshold;
  const since = gap ? null : st.stillSince;
  return {
    level,
    seen: true,
    lastT: t,
    stillSince: still ? (since ?? t) : null,
    moveSince: moved ? null : moveSince,
    moved,
  };
}

/** How long the phone has been still, up to the last reading (ms). */
export const stillFor = (st: StillState): number =>
  st.stillSince === null ? 0 : st.lastT - st.stillSince;

/** Still for the whole dwell, after the move the pair needs. */
export const isStill = (
  st: StillState,
  cfg: StillConfig = STILL_CONFIG,
): boolean => st.moved && stillFor(st) >= cfg.dwellMs;

/** The dwell's progress from 0 to 1, for the meter ring. */
export const stillProgress = (
  st: StillState,
  cfg: StillConfig = STILL_CONFIG,
): number => Math.min(1, Math.max(0, stillFor(st) / cfg.dwellMs));

/** No usable reading for longer than `lostMs` at time `now`. */
export const readingsLost = (
  st: StillState,
  now: number,
  cfg: StillConfig = STILL_CONFIG,
): boolean => Number.isFinite(now) && now - st.lastT > cfg.lostMs;
