/**
 * The globe's fly-in: from far out on the sun side to the user, by distance
 * alone (the field of view stays the page's throughout). Pure: directions
 * are unit [x, y, z] vectors (ECEF), distances km from the Earth's centre,
 * angles degrees.
 *
 * @see globe-intro.ts.md
 */

import { smoothstep } from "./globe-ease.js";

/** A direction or point as [x, y, z]. */
export type Vec3 = readonly [number, number, number];

/**
 * The fly-in's numbers:
 * - `maxKm`: the farthest the camera may be from the centre, where the
 *   intro starts (DEC-GL5-1: about 3 times the fitted distance);
 * - `turnCapDeg`: the most the view turns from the sun side to the user
 *   (DEC-GL5-3);
 * - `lateFixBlendMs`: how long a position that arrives during the intro
 *   takes to become the target (no jump).
 */
export const GLOBE_INTRO = Object.freeze({
  maxKm: 50_000,
  turnCapDeg: 90,
  lateFixBlendMs: 1500,
});

const DEG = Math.PI / 180;

const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** `v` as a unit vector; RangeError for a zero or non-finite one. */
function unit(v: Vec3, what: string): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]);
  if (!(n > 0 && Number.isFinite(n))) {
    throw new RangeError(`${what} must be a non-zero finite vector`);
  }
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** Below this length, `b` minus its part along `a` counts as zero. */
const PARALLEL_EPSILON = 1e-9;

/**
 * Spherical interpolation between unit vectors, `s` in [0, 1]. The great
 * circle's direction is `b` without its part along `a`; when that is (or
 * rounds to) zero the two are parallel: equal ones give `a`, opposite ones
 * take a great circle through a fixed perpendicular, as any is as good.
 * Never throws for unit inputs (r764's gate found pairs 3e-16 apart whose
 * perpendicular rounded to the zero vector).
 */
function slerp(a: Vec3, b: Vec3, s: number): Vec3 {
  const cos = Math.min(1, Math.max(-1, dot(a, b)));
  const theta = Math.acos(cos);
  const rest: Vec3 = [b[0] - cos * a[0], b[1] - cos * a[1], b[2] - cos * a[2]];
  const restLength = Math.hypot(rest[0], rest[1], rest[2]);
  let ortho: Vec3;
  if (restLength < PARALLEL_EPSILON || theta < 1e-12) {
    if (cos > 0) return a;
    const helper: Vec3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const d = dot(helper, a);
    ortho = unit(
      [helper[0] - d * a[0], helper[1] - d * a[1], helper[2] - d * a[2]],
      "a perpendicular",
    );
  } else {
    // Once more without its part along `a`: for nearly opposite pairs
    // `rest` is a difference of nearly equal numbers, and its rounding
    // left it off perpendicular, the result off unit length.
    const r: Vec3 = [
      rest[0] / restLength,
      rest[1] / restLength,
      rest[2] / restLength,
    ];
    const d = dot(r, a);
    ortho = unit(
      [r[0] - d * a[0], r[1] - d * a[1], r[2] - d * a[2]],
      "a perpendicular",
    );
  }
  const phi = theta * s;
  const c = Math.cos(phi);
  const sn = Math.sin(phi);
  return [
    c * a[0] + sn * ortho[0],
    c * a[1] + sn * ortho[1],
    c * a[2] + sn * ortho[2],
  ];
}

/**
 * Where the intro starts looking from: the target turned towards the
 * sub-solar point along their great circle, by the angle between them but
 * at most `capDeg` (DEC-GL5-3). A user in the daylight within the cap of
 * the sun is thus approached from right over the sub-solar point; a
 * night-side user from the lit side, as far as the cap allows. RangeError
 * for a zero vector or a cap that is not a finite angle of 0 or more.
 */
export function introStartDirection(
  target: Vec3,
  sun: Vec3,
  capDeg: number,
): Vec3 {
  if (!(Number.isFinite(capDeg) && capDeg >= 0)) {
    throw new RangeError(
      `the turn cap must be 0 or more degrees, got ${capDeg}`,
    );
  }
  const t = unit(target, "the target");
  const s = unit(sun, "the sun");
  const angle = Math.acos(Math.min(1, Math.max(-1, dot(t, s))));
  if (angle < 1e-12) return t;
  const turn = Math.min(angle, capDeg * DEG);
  return slerp(t, s, turn / angle);
}

/** The camera on the intro at one moment. */
export interface IntroPose {
  /** From the centre towards the camera (the view looks back at it). */
  readonly direction: Vec3;
  /** The camera's distance from the centre. */
  readonly distanceKm: number;
}

/** What one intro flies between. */
export interface IntroPath {
  readonly start: Vec3;
  readonly target: Vec3;
  readonly startKm: number;
  readonly endKm: number;
}

/**
 * The camera at `t` (0 to 1, clamped) of the intro: the direction turns
 * from `start` to `target` (eased), and the distance falls from
 * `startKm` to `endKm` evenly in its logarithm (so each halving takes as
 * long), eased. Exactly at (`target`, `endKm`) at t = 1. RangeError for
 * a non-finite `t` or distances that are not positive and finite.
 */
export function introCameraPose(t: number, path: IntroPath): IntroPose {
  checkPath(t, path);
  const { startKm, endKm } = path;
  const u = Math.min(1, Math.max(0, t));
  const target = unit(path.target, "the target");
  if (u >= 1) return { direction: target, distanceKm: endKm };
  const direction = slerp(unit(path.start, "the start"), target, smoothstep(u));
  const distanceKm = Math.exp(
    Math.log(startKm) + (Math.log(endKm) - Math.log(startKm)) * smoothstep(u),
  );
  return { direction, distanceKm };
}

/** introCameraPose's refusals (see there). */
function checkPath(t: number, path: IntroPath): void {
  if (!Number.isFinite(t)) throw new RangeError(`t must be finite, got ${t}`);
  for (const km of [path.startKm, path.endKm]) {
    if (!(km > 0 && Number.isFinite(km))) {
      throw new RangeError(`distances must be positive, got ${km}`);
    }
  }
}

/**
 * A late position becoming the target (round-5 plan §3.1): the target
 * moves from `from` to `to` along their great circle over `blendMs`,
 * eased, `elapsedMs` after the position arrived; `to` once it is over.
 */
export function blendTarget(
  from: Vec3,
  to: Vec3,
  elapsedMs: number,
  blendMs: number,
): Vec3 {
  const a = unit(from, "the old target");
  const b = unit(to, "the new target");
  if (!(blendMs > 0) || elapsedMs >= blendMs) return b;
  return slerp(a, b, smoothstep(Math.max(0, elapsedMs) / blendMs));
}

/**
 * Where the intro spins while it waits for a target (review 2026-10-01-2124
 * Major 2): over the sub-solar point at first, turning about the polar
 * axis at `degPerS` (negative: westwards), so the wait is on the day side
 * the fly-in starts from. RangeError for a zero sun or a time or rate that
 * is not finite.
 */
export function spinDirection(
  sun: Vec3,
  elapsedMs: number,
  degPerS: number,
): Vec3 {
  const s = unit(sun, "the sun");
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(degPerS)) {
    throw new RangeError(
      `the spin's time and rate must be finite, got ${elapsedMs} ms at ${degPerS} deg/s`,
    );
  }
  const a = ((degPerS * elapsedMs) / 1000) * DEG;
  const c = Math.cos(a);
  const n = Math.sin(a);
  return [s[0] * c - s[1] * n, s[0] * n + s[1] * c, s[2]];
}

/**
 * The fly-in's start, `sinceArrivalMs` after its target arrived (review
 * 2026-10-01-2124 Major 2): from the spin's direction `spin` to the
 * sun-side start of `target` (`introStartDirection`, at most `capDeg` from
 * it), eased over `blendMs`. Recomputed every frame from the target as it
 * is then, so a position that replaces the target keeps the cap too.
 * RangeError for a negative or non-finite time or blend.
 */
export function flyInStart(input: {
  spin: Vec3;
  target: Vec3;
  sun: Vec3;
  capDeg: number;
  sinceArrivalMs: number;
  blendMs: number;
}): Vec3 {
  const { spin, target, sun, capDeg, sinceArrivalMs, blendMs } = input;
  if (!(sinceArrivalMs >= 0 && Number.isFinite(sinceArrivalMs))) {
    throw new RangeError(
      `the time since the target arrived must be 0 or more, got ${sinceArrivalMs}`,
    );
  }
  if (!(blendMs >= 0 && Number.isFinite(blendMs))) {
    throw new RangeError(`the blend must be 0 ms or more, got ${blendMs}`);
  }
  const start = introStartDirection(target, sun, capDeg);
  if (blendMs === 0 || sinceArrivalMs >= blendMs) return start;
  return slerp(
    unit(spin, "the spin"),
    start,
    smoothstep(sinceArrivalMs / blendMs),
  );
}
