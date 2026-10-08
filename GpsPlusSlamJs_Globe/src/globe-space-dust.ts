/**
 * Space dust (round-2 plan 2026-10-07-2350 DEC-FR2-7): faint points that
 * give a sense of speed on the way in from 65,000 km, an experiment behind
 * the lab's `dust=1` for the owner to judge ("try whether it looks good";
 * it may also hold the eye while the map data loads).
 *
 * The points are STILL in the world, in a box around the camera whose size
 * follows its altitude, wrapping at the box's faces: their motion on screen
 * is the camera's own, its perceived speed included (a box in altitude units
 * is the measure the flight is judged by), and as the camera descends the
 * box shrinks, so they stream outward from the view's centre. They fade out
 * as the atmosphere begins. Pure: positions and altitudes in, positions and
 * an opacity out.
 *
 * @see globe-space-dust.ts.md
 */

import { smoothstep } from "./globe-ease.js";

export const GLOBE_SPACE_DUST = {
  /** How many points (about a twentieth of them are in view). */
  count: 4_000,
  /**
   * The box's half size, as a share of the camera's altitude: well past the
   * camera's near plane (GLOBE_CLIP.nearFraction, 0.3), which clips every
   * point nearer than that.
   */
  boxShare: 1,
  /** Full above this altitude, m. */
  fullM: 2_000_000,
  /** Gone below this altitude, m (where the sky begins to show). */
  goneM: 300_000,
} as const;

/** A small deterministic generator (mulberry32), so a field is repeatable. */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * A field of `count` points, xyz in metres, spread evenly through the box
 * around `camera` at `altitudeM`. RangeError for a count that is not a
 * positive integer or an altitude that is not a positive number.
 */
export function createDustField(
  camera: readonly [number, number, number],
  altitudeM: number,
  count: number = GLOBE_SPACE_DUST.count,
  seed = 1,
): Float32Array {
  if (!(Number.isInteger(count) && count > 0)) {
    throw new RangeError(`the count must be a positive integer, got ${count}`);
  }
  if (!(altitudeM > 0 && Number.isFinite(altitudeM))) {
    throw new RangeError(`the altitude must be positive, got ${altitudeM}`);
  }
  const half = GLOBE_SPACE_DUST.boxShare * altitudeM;
  const random = generator(seed);
  const points = new Float32Array(count * 3);
  for (let i = 0; i < points.length; i++) {
    points[i] = (camera[i % 3] ?? 0) + (random() * 2 - 1) * half;
  }
  return points;
}

/**
 * Keeps every point within the box around `camera` at `altitudeM`: a point
 * that left it through a face comes back through the opposite one (its
 * offset wrapped into [-half, half) on each axis); a point inside stays
 * where it is. In place. A non-finite camera or an altitude that is not a
 * positive number leaves the points as they are.
 */
export function wrapDust(
  points: Float32Array,
  camera: readonly [number, number, number],
  altitudeM: number,
): void {
  if (!(altitudeM > 0 && Number.isFinite(altitudeM))) return;
  if (!camera.every((c) => Number.isFinite(c))) return;
  const half = GLOBE_SPACE_DUST.boxShare * altitudeM;
  const size = 2 * half;
  for (let i = 0; i < points.length; i++) {
    const c = camera[i % 3] ?? 0;
    const offset = (points[i] ?? 0) - c;
    if (offset >= -half && offset < half) continue;
    points[i] = c + offset - size * Math.floor((offset + half) / size);
  }
}

/** The dust's opacity at `altitudeM`, 0-1: full high up, gone low down. */
export function dustShare(altitudeM: number): number {
  if (!Number.isFinite(altitudeM)) return 0;
  const { fullM, goneM } = GLOBE_SPACE_DUST;
  const h = Math.max(altitudeM, 1);
  return smoothstep(Math.log(h / goneM) / Math.log(fullM / goneM));
}
