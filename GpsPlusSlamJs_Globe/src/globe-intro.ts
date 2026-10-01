/**
 * The globe's fly-in (round-5 plan 2026-10-01-0945 §3.1, decisions
 * DEC-GL5-1..3): from far out on the sun side to the user, in one of four
 * ways of trading distance against field of view, all ending at one pose.
 * Pure: directions are unit [x, y, z] vectors (ECEF), distances km from
 * the Earth's centre, angles degrees.
 *
 * @see globe-intro.ts.md
 */

/** A direction or point as [x, y, z]. */
export type Vec3 = readonly [number, number, number];

/** The four ways in (the lab's `intro=` select). */
export const INTRO_VARIANTS = ["distance", "narrow", "fov", "dolly"] as const;
type IntroVariant = (typeof INTRO_VARIANTS)[number];

/**
 * The fly-in's numbers:
 * - `maxKm`: the farthest the camera may be from the centre, where the
 *   intro starts (DEC-GL5-1: about 3 times the fitted distance);
 * - `endFovDeg`: the field of view every variant ends at (DEC-GL5-2);
 * - `turnCapDeg`: the most the view turns from the sun side to the user
 *   (DEC-GL5-3);
 * - `wideFovDeg`: where `narrow` and `fov` start; `dollyStartFovDeg`
 *   where `dolly` starts (it widens to the end; with an end of 50 it
 *   barely changes, as the preview says);
 * - `fovPhase`: the share of the `fov` variant spent narrowing the field
 *   of view while still far out, before the short fly in;
 * - `lateFixBlendMs`: how long a position that arrives during the intro
 *   takes to become the target (no jump).
 */
export const GLOBE_INTRO = Object.freeze({
  maxKm: 50_000,
  endFovDeg: 50,
  turnCapDeg: 90,
  wideFovDeg: 80,
  dollyStartFovDeg: 50,
  fovPhase: 0.6,
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

/** The smooth ease used throughout: 0 to 1 with zero slope at both ends. */
const ease = (t: number): number => t * t * (3 - 2 * t);

/**
 * Spherical interpolation between unit vectors, `s` in [0, 1]; for
 * opposite vectors any great circle is as good, so one through a fixed
 * perpendicular is taken.
 */
function slerp(a: Vec3, b: Vec3, s: number): Vec3 {
  const cos = Math.min(1, Math.max(-1, dot(a, b)));
  const theta = Math.acos(cos);
  if (theta < 1e-12) return a;
  let ortho: Vec3;
  if (Math.PI - theta < 1e-9) {
    const helper: Vec3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const d = dot(helper, a);
    ortho = unit(
      [helper[0] - d * a[0], helper[1] - d * a[1], helper[2] - d * a[2]],
      "a perpendicular",
    );
  } else {
    ortho = unit(
      [b[0] - cos * a[0], b[1] - cos * a[1], b[2] - cos * a[2]],
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
  /** The vertical field of view. */
  readonly fovDeg: number;
}

/** What one intro flies between. */
export interface IntroPath {
  readonly variant: IntroVariant;
  readonly start: Vec3;
  readonly target: Vec3;
  readonly startKm: number;
  readonly endKm: number;
  readonly endFovDeg: number;
}

/**
 * The camera at `t` (0 to 1, clamped) of the intro:
 * - the direction turns from `start` to `target` (eased) over the whole
 *   intro, in every variant;
 * - `distance`: the distance falls from `startKm` to `endKm` evenly in its
 *   logarithm (so each halving takes as long), eased; the field of view
 *   stays at the end's;
 * - `narrow`: the same flight while the field of view narrows from 80
 *   degrees to the end's;
 * - `fov`: the camera holds `startKm` while the field of view narrows
 *   from 80 degrees over the first `fovPhase`, then flies in at the end's;
 * - `dolly`: the flight while the field of view widens from 50 degrees to
 *   the end's.
 * Every variant is at exactly (`target`, `endKm`, `endFovDeg`) at t = 1.
 * RangeError for an unknown variant, a non-finite `t`, distances that
 * are not positive and finite, or a field of view outside (0, 180).
 */
export function introCameraPose(t: number, path: IntroPath): IntroPose {
  checkPath(t, path);
  const { variant, startKm, endKm, endFovDeg } = path;
  const u = Math.min(1, Math.max(0, t));
  const target = unit(path.target, "the target");
  if (u >= 1)
    return { direction: target, distanceKm: endKm, fovDeg: endFovDeg };
  const direction = slerp(unit(path.start, "the start"), target, ease(u));
  const logDistance = (s: number): number =>
    Math.exp(
      Math.log(startKm) + (Math.log(endKm) - Math.log(startKm)) * ease(s),
    );
  const lerp = (a: number, b: number, s: number): number =>
    a + (b - a) * ease(s);
  if (variant === "fov") {
    const p = GLOBE_INTRO.fovPhase;
    return {
      direction,
      distanceKm: logDistance(Math.max(0, (u - p) / (1 - p))),
      fovDeg: lerp(GLOBE_INTRO.wideFovDeg, endFovDeg, Math.min(1, u / p)),
    };
  }
  return {
    direction,
    distanceKm: logDistance(u),
    fovDeg: lerp(START_FOV[variant] ?? endFovDeg, endFovDeg, u),
  };
}

/** Where the flying variants' field of view starts (`distance`: the end's). */
const START_FOV: Partial<Record<IntroVariant, number>> = {
  narrow: GLOBE_INTRO.wideFovDeg,
  dolly: GLOBE_INTRO.dollyStartFovDeg,
};

/** introCameraPose's refusals (see there). */
function checkPath(t: number, path: IntroPath): void {
  if (!Number.isFinite(t)) throw new RangeError(`t must be finite, got ${t}`);
  if (!INTRO_VARIANTS.includes(path.variant)) {
    throw new RangeError(`unknown intro variant ${String(path.variant)}`);
  }
  for (const km of [path.startKm, path.endKm]) {
    if (!(km > 0 && Number.isFinite(km))) {
      throw new RangeError(`distances must be positive, got ${km}`);
    }
  }
  if (!(path.endFovDeg > 0 && path.endFovDeg < 180)) {
    throw new RangeError(
      `the end field of view must be in (0, 180), got ${path.endFovDeg}`,
    );
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
  return slerp(a, b, ease(Math.max(0, elapsedMs) / blendMs));
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
  return slerp(unit(spin, "the spin"), start, ease(sinceArrivalMs / blendMs));
}
