/**
 * The cold review's "never stops in between" criterion for a flight
 * (continuous-flight plan 2026-10-07-0941, finding 3), shared by the
 * flight path's example and property tests. Test-only (excluded from the
 * app build with the rest of `src/test-utils`).
 *
 * The speed is v = sqrt((d ln h/dt)^2 + (ground speed / h)^2), per second,
 * between consecutive samples of a point (the CAMERA, CF1 milestone review
 * finding 2: the view's centre moves at a constant speed by construction,
 * so measuring it was close to circular). The flight's criterion is judged
 * over its cruise (`windowBetween`, from the ramp's end to the settle's
 * start); `criterionWindow` (0.5 s after the press to the final descent
 * through 3 x the landing) serves a flight that has no declared phases,
 * today's dive in the positive control.
 */

import type * as THREE from "three";

export interface SpeedSample {
  /** Time since the press, ms. */
  readonly t: number;
  /** Altitude at the sample, metres. */
  readonly h: number;
  /** The speed since the previous sample, per second. */
  readonly v: number;
}

/** A sampled point: its altitude and its direction from the centre. */
interface Point {
  readonly altitudeM: number;
  readonly direction: THREE.Vector3;
}

/**
 * Samples `at` every 1/`hz` s over `durationMs`; the ground speed is the
 * angle between consecutive directions on a sphere of `radiusM`.
 */
export function speedSamples(
  at: (tMs: number) => Point,
  durationMs: number,
  hz: number,
  radiusM: number,
): SpeedSample[] {
  const dt = 1000 / hz;
  const out: SpeedSample[] = [];
  let prev = at(0);
  for (let t = dt; t <= durationMs; t += dt) {
    const now = at(t);
    const dLog = Math.log(now.altitudeM / prev.altitudeM);
    const ground =
      // The chord form: acos loses the small angles of one frame near the
      // ground (0.1 m resolution); 2 asin(|a - b| / 2) keeps them.
      2 *
      Math.asin(
        Math.min(
          1,
          prev.direction
            .clone()
            .normalize()
            .distanceTo(now.direction.clone().normalize()) / 2,
        ),
      ) *
      radiusM;
    const h = (now.altitudeM + prev.altitudeM) / 2;
    out.push({
      t,
      h: now.altitudeM,
      v: Math.hypot(dLog, ground / h) / (dt / 1000),
    });
    prev = now;
  }
  return out;
}

/** The samples from `fromMs` to `toMs` (the flight's cruise). */
export function windowBetween(
  samples: readonly SpeedSample[],
  fromMs: number,
  toMs: number,
): SpeedSample[] {
  return samples.filter((s) => s.t >= fromMs && s.t <= toMs);
}

/** The positive control's window (see the file's comment). */
export function criterionWindow(
  samples: readonly SpeedSample[],
  landingM: number,
): SpeedSample[] {
  let end = samples.length;
  while (end > 0 && (samples[end - 1]?.h ?? 0) <= 3 * landingM) end -= 1;
  return samples.slice(0, end).filter((s) => s.t >= 500);
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/** (a) No stall: no speed below `share` of the median. */
export const noStall = (vs: readonly number[], share: number): boolean =>
  Math.min(...vs) >= share * median(vs);

/**
 * (b) No stop-and-go: v_j >= (1 - tol) x min(v_i, v_k) for every
 * i < j < k, i.e. no speed below (1 - tol) x the lesser of the peaks on
 * either side of it.
 */
export function noStopAndGo(vs: readonly number[], tol: number): boolean {
  const before: number[] = [];
  let peak = 0;
  for (const v of vs) {
    before.push(peak);
    peak = Math.max(peak, v);
  }
  peak = 0;
  for (let j = vs.length - 1; j >= 0; j--) {
    const v = vs[j] ?? 0;
    const inside = j > 0 && j < vs.length - 1;
    if (inside && v < (1 - tol) * Math.min(before[j] ?? 0, peak)) return false;
    peak = Math.max(peak, v);
  }
  return true;
}

/** (c) No late surge: no speed below 100 km above `ceiling` x the largest above. */
export function noLateSurge(
  samples: readonly SpeedSample[],
  ceiling: number,
): boolean {
  const high = samples.filter((s) => s.h > 100_000).map((s) => s.v);
  const low = samples.filter((s) => s.h <= 100_000).map((s) => s.v);
  if (high.length === 0 || low.length === 0) return true;
  return Math.max(...low) <= ceiling * Math.max(...high);
}
