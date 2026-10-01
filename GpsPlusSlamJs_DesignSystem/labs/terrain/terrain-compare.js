/**
 * The terrain lab's comparison of the relief colour approaches (globe
 * round-5 plan 2026-10-01-0945 §3.3 "Judged end to end"): the variants, the
 * capture plan along the lab's fly-in onto the Alps, and the metrics the
 * comparison page logs per variant. The numbers are LOGGED, not asserted,
 * until the owner picks; `globe-albedo` is the provisional default.
 *
 * - The variants are rows; another agent's styles join by appending to
 *   `COMPARE_VARIANTS` (one line each).
 * - The captures are the fly-in's poses at fixed altitudes (300, 100, 30
 *   and 10 km), at a day and a low sun.
 * - The metrics: the colour difference to the globe's pixel at the
 *   hand-over altitude, the local contrast at 1-10 km on the ground, and
 *   the frame cost as a ratio to style A within one page load.
 *
 * Dependency-free (pure data and arithmetic), so it runs under `node --test`.
 *
 * @see terrain-compare.js.md
 */

/**
 * The rows: a label and the hash keys that make the variant (on top of the
 * capture's place, pose, light and time).
 */
export const COMPARE_VARIANTS = [
  { id: "A", label: "A: Pastel atlas", hash: { style: "pastel" } },
  { id: "B", label: "B: Natural colour", hash: { style: "natural" } },
  { id: "C", label: "C: Globe blend", hash: { style: "globe" } },
  {
    id: "C1-d0",
    label: "C1: globe-albedo, detail 0",
    hash: { style: "globe-albedo", detail: 0 },
  },
  {
    id: "C1-d0.5",
    label: "C1: globe-albedo, detail 0.5",
    hash: { style: "globe-albedo", detail: 0.5 },
  },
  { id: "C3", label: "C3: globe-bands", hash: { style: "globe-bands" } },
];

/** The capture plan (plan §3.3) and the hand-over (the globe's `handOverKm`). */
export const COMPARE_PLAN = Object.freeze({
  place: "alps",
  altitudesKm: Object.freeze([300, 100, 30, 10]),
  handOverKm: 150,
  suns: Object.freeze([
    Object.freeze({ id: "day", label: "Day", time: "2026-06-21T11:00:00Z" }),
    Object.freeze({
      id: "low",
      label: "Low sun",
      time: "2026-06-21T18:00:00Z",
    }),
  ]),
  /** The ground grid the local contrast is read on: 11 x 11 posts 1 km apart. */
  contrastStepM: 1000,
  contrastPosts: 11,
  /** The ground grid the hand-over difference is read on: 21 x 21, 4 km apart. */
  handOverStepM: 4000,
  handOverPosts: 21,
  /** Frames timed per variant for the cost. */
  costFrames: 5,
  /**
   * The keys every capture shares: a still camera, the sun, and the far
   * field on, so every row loads the globe's imagery for its hand-over
   * reference. At and below 300 km (`farLow`) the far field's weight is 0,
   * so it changes no capture.
   */
  shared: Object.freeze({ light: 1, tau: 0, svf: 8, far: 1 }),
});

/**
 * A square ground grid of `posts` x `posts` ENU points `stepM` apart,
 * centred on the origin (the place's centre, where the fly-in looks).
 */
export function groundGrid(posts, stepM) {
  if (!(Number.isInteger(posts) && posts >= 1) || !(stepM > 0)) {
    throw new RangeError(
      `need posts >= 1 and stepM > 0, got ${posts}, ${stepM}`,
    );
  }
  const half = ((posts - 1) * stepM) / 2;
  const out = [];
  for (let j = 0; j < posts; j++) {
    for (let i = 0; i < posts; i++) {
      out.push({ x: -half + i * stepM, y: -half + j * stepM });
    }
  }
  return out;
}

/** The hash for one capture: the plan's shared keys, the variant's, the pose. */
export function captureHash(variant, sun, pose, plan = COMPARE_PLAN) {
  const params = new URLSearchParams();
  params.set("place", plan.place);
  for (const [k, v] of Object.entries(plan.shared)) params.set(k, String(v));
  for (const [k, v] of Object.entries(variant.hash)) params.set(k, String(v));
  params.set("time", sun.time);
  params.set("alt", String(Math.round(pose.altitudeM)));
  params.set("tilt", pose.tiltDeg.toFixed(2));
  params.set("head", pose.headingDeg.toFixed(2));
  return params.toString();
}

/** Mean, standard deviation and count of the finite values. */
export function stats(values) {
  const v = values.filter(Number.isFinite);
  if (v.length === 0) return { mean: Number.NaN, std: Number.NaN, n: 0 };
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const variance = v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length;
  return { mean, std: Math.sqrt(variance), n: v.length };
}

/** The p-th quantile (0-1) of the finite values, nearest rank; NaN if none. */
export function quantile(values, p) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return Number.NaN;
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil(p * v.length) - 1))];
}

/** True for a projected point on the canvas (normalised 0-1, both axes). */
export const onCanvas = ([u, v]) => u >= 0 && u <= 1 && v >= 0 && v <= 1;
