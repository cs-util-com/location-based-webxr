/**
 * Speed dust (round-3 plan 2026-10-08-2345, D1; the owner, 2026-10-08:
 * "dust that streaks past the camera very fast, tied to the speed in metres
 * per second, so the user sees how incredibly fast they rush at the
 * Earth"). It replaces a world-fixed dust that clumped over the city when
 * he zoomed back out and carried no sense of speed (its screen motion was
 * speed over altitude, nearly constant on a logarithmic descent).
 *
 * A field of particles in a fixed box around the camera (box units,
 * [-1, 1)^3, in ECEF axes), moved by minus the camera's velocity and
 * wrapped: a torus moved by translation alone stays exactly as even as it
 * started, so it can never clump. The drift and the streaks grow with the
 * speed on a log scale (people judge speed by the edges passing per
 * second: Larish and Flach 1990), not physically: 5,000 km/s must feel
 * faster than 50. A stopped camera draws nothing. Pure: positions, times
 * and speeds in, offsets, streaks and an opacity out.
 *
 * @see globe-speed-dust.ts.md
 */

import { smoothstep } from "./globe-ease.js";

export const GLOBE_SPEED_DUST = {
  /** How many particles. */
  count: 1_500,
  /** No dust at or below this speed, m/s. */
  loMps: 1_000,
  /** Full dust from this speed, m/s (measured: about 4,800 km/s at 44,000 km). */
  hiMps: 5_000_000,
  /** The field's drift, box units per second, at the share 0 and 1. */
  driftMin: 0.2,
  driftMax: 6,
  /** The velocity's smoothing time constant, ms. */
  tauMs: 200,
  /** Full above this altitude, m. */
  fullM: 2_000_000,
  /** Gone below this altitude, m. */
  goneM: 300_000,
  /** The share of the speed range over which the dust fades in. */
  fadeInShare: 0.15,
  /** Streaks fade out between these distances from the camera (box units). */
  nearFade: [0.05, 0.15] as const,
  /** And towards the box's rim, from this radius (box units). */
  rimFrom: 0.85,
  rimTo: 0.95,
  /**
   * A camera step of this share of its altitude or more in one frame is a
   * gross teleport the lab did not announce. The lab resets the speed
   * itself where it places the camera (a view, a link's start); a wheel
   * zoom or a slow frame near the gate (about half the altitude a frame at
   * 1.4 frames a second, headless) is real motion (the milestone review).
   */
  jumpShare: 1,
  /** One frame never moves the field more than this share of the box. */
  maxStepShare: 0.3,
} as const;

type Vec3 = readonly [number, number, number];

/** The camera's smoothed velocity, m/s in ECEF, and its last sample. */
export interface SpeedState {
  readonly position: Vec3 | null;
  readonly tMs: number;
  readonly velocity: Vec3;
}

/** A state with no sample yet (velocity 0). */
export function startVelocity(): SpeedState {
  return { position: null, tMs: 0, velocity: [0, 0, 0] };
}

/**
 * The state after a camera sample at `position` (ECEF, m) and `tMs`: the
 * velocity a finite difference, smoothed with alpha = 1 - exp(-dt / tau)
 * (the same over a second at any frame rate). A step of `jumpShare` of
 * the camera's altitude or more in one frame is a teleport (a link, a held
 * view, the flight's start placement): the velocity resets to 0 rather
 * than spiking.
 * A sample that is not finite or not later is ignored (the same state).
 */
export function stepVelocity(
  state: SpeedState,
  position: Vec3,
  tMs: number,
  altitudeM: number,
): SpeedState {
  if (!position.every((c) => Number.isFinite(c)) || !Number.isFinite(tMs)) {
    return state;
  }
  if (state.position === null) {
    return { position: [...position], tMs, velocity: [0, 0, 0] };
  }
  const dtMs = tMs - state.tMs;
  if (!(dtMs > 0)) return state;
  const d: Vec3 = [
    position[0] - state.position[0],
    position[1] - state.position[1],
    position[2] - state.position[2],
  ];
  if (Math.hypot(...d) > GLOBE_SPEED_DUST.jumpShare * Math.max(altitudeM, 1)) {
    return { position: [...position], tMs, velocity: [0, 0, 0] };
  }
  const a = 1 - Math.exp(-dtMs / GLOBE_SPEED_DUST.tauMs);
  const v = state.velocity;
  const s = 1000 / dtMs;
  return {
    position: [...position],
    tMs,
    velocity: [
      v[0] + (d[0] * s - v[0]) * a,
      v[1] + (d[1] * s - v[1]) * a,
      v[2] + (d[2] * s - v[2]) * a,
    ],
  };
}

/**
 * The speed's share of `range` (the defaults unless given: a lab knob, D1b),
 * 0 at `loMps`, 1 at `hiMps`, log-linear.
 */
export function speedShare(
  mps: number,
  range: { readonly loMps: number; readonly hiMps: number } = GLOBE_SPEED_DUST,
): number {
  const { loMps, hiMps } = range;
  requireRising("the speed range", loMps, hiMps);
  if (!(mps > 0)) return 0;
  const x = Math.log(mps / loMps) / Math.log(hiMps / loMps);
  return Math.min(Math.max(x, 0), 1);
}

/**
 * The field's drift at a speed share, box units per second (geometric
 * across `range`, the defaults unless given: a lab knob, D1b).
 */
export function driftRate(
  share: number,
  range: {
    readonly driftMin: number;
    readonly driftMax: number;
  } = GLOBE_SPEED_DUST,
): number {
  const { driftMin, driftMax } = range;
  requireRising("the drift range", driftMin, driftMax);
  const s = Math.min(Math.max(Number.isFinite(share) ? share : 0, 0), 1);
  return driftMin * (driftMax / driftMin) ** s;
}

/** The dust's opacity: faded in over the low speeds, and by the altitude. */
export function speedDustOpacity(share: number, altitudeM: number): number {
  if (!Number.isFinite(share) || !Number.isFinite(altitudeM)) return 0;
  const { fullM, goneM, fadeInShare } = GLOBE_SPEED_DUST;
  const bySpeed = smoothstep(share / fadeInShare);
  const h = Math.max(altitudeM, 1);
  const byAltitude = smoothstep(Math.log(h / goneM) / Math.log(fullM / goneM));
  return bySpeed * byAltitude;
}

/** RangeError unless 0 < lo < hi (finite). */
function requireRising(name: string, lo: number, hi: number): void {
  if (!(lo > 0 && hi > lo && Number.isFinite(hi))) {
    throw new RangeError(`${name} must be 0 < lo < hi, got ${lo}, ${hi}`);
  }
}

/** A small deterministic generator (mulberry32). */
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
 * `count` particle seeds spread evenly through the box [-1, 1)^3,
 * deterministic for a seed. RangeError for a count that is not a positive
 * integer.
 */
export function createSpeedField(
  count: number = GLOBE_SPEED_DUST.count,
  seed = 1,
): Float32Array {
  if (!(Number.isInteger(count) && count > 0)) {
    throw new RangeError(`the count must be a positive integer, got ${count}`);
  }
  const random = generator(seed);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < out.length; i++) out[i] = random() * 2 - 1;
  return out;
}

/** `x` wrapped into [-1, 1). */
function wrapBox(x: number): number {
  return x - 2 * Math.floor((x + 1) / 2);
}

/**
 * The field's offset after `dtS` seconds of drift at `rate` box units per
 * second along `dir` (a unit ECEF vector, the camera's motion): the
 * particles stream against it. Kept wrapped (exact for a periodic field,
 * no float drift); one step never moves more than `maxStepShare` of the
 * box, so the wrap never aliases.
 */
export function advanceField(
  offset: Vec3,
  dir: Vec3,
  rate: number,
  dtS: number,
): [number, number, number] {
  if (!(dtS > 0) || !Number.isFinite(rate) || !dir.every(Number.isFinite)) {
    return [...offset];
  }
  const cap = 2 * GLOBE_SPEED_DUST.maxStepShare;
  const step = Math.min(Math.abs(rate) * dtS, cap) * Math.sign(rate);
  return [
    wrapBox(offset[0] + dir[0] * step),
    wrapBox(offset[1] + dir[1] * step),
    wrapBox(offset[2] + dir[2] * step),
  ];
}

/** The streaks to draw: heads and tails in box units, an alpha per particle. */
export interface Streaks {
  readonly heads: Float32Array;
  readonly tails: Float32Array;
  readonly alpha: Float32Array;
}

/**
 * The streaks of the field `seeds` at `offset`: each head the seed minus
 * the offset, wrapped; each tail the head plus the motion's direction times
 * the drift over the exposure (where the particle was: it streams past
 * against the motion); each alpha `opacity` faded at the box's rim and
 * right at the camera.
 */
export function streaks(
  seeds: Float32Array,
  offset: Vec3,
  dir: Vec3,
  rate: number,
  exposureS: number,
  opacity: number,
): Streaks {
  const n = Math.floor(seeds.length / 3);
  const heads = new Float32Array(n * 3);
  const tails = new Float32Array(n * 3);
  const alpha = new Float32Array(n);
  const length = Math.max(rate, 0) * Math.max(exposureS, 0);
  const { nearFade, rimFrom, rimTo } = GLOBE_SPEED_DUST;
  for (let i = 0; i < n; i++) {
    let r2 = 0;
    for (let k = 0; k < 3; k++) {
      const h = wrapBox((seeds[3 * i + k] ?? 0) - (offset[k] ?? 0));
      heads[3 * i + k] = h;
      tails[3 * i + k] = h + (dir[k] ?? 0) * length;
      r2 += h * h;
    }
    const r = Math.sqrt(r2);
    const near = smoothstep((r - nearFade[0]) / (nearFade[1] - nearFade[0]));
    const rim = 1 - smoothstep((r - rimFrom) / (rimTo - rimFrom));
    alpha[i] = opacity * near * rim;
  }
  return { heads, tails, alpha };
}
