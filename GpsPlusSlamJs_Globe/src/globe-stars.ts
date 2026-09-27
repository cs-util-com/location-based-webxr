/**
 * The globe's stars (round-2 plan 2026-09-26-2055 M3d, owner decision
 * 2026-09-27 on Q2: "procedural stars for now"). PROCEDURAL, not a
 * catalogue: no star catalogue with a clearly public-domain or
 * attribution-only licence was found, so the field is generated in code
 * from a seed (nothing is added to the committed assets). It is a
 * plausible sky, not the real one: counts rise about 10^(0.5 m) to the
 * magnitude limit, directions are uniform, colours spread slightly around
 * white, and the Milky Way's plane is tilted as the real galactic plane is.
 * The field turns with Greenwich sidereal time, as real stars would.
 *
 * @see globe-stars.ts.md
 */
import * as THREE from "three";

export const GLOBE_STARS = {
  /** The field's seed: one fixed sky. */
  seed: 20260927,
  /** Stars down to magnitude 6.5, the naked-eye limit: a few thousand. */
  countAt6_5: 5000,
  /** The brightest star generated (the real sky's brightest is -1.46). */
  brightestMag: -1.5,
  /** The faintest limit a field can be generated to (the lab's slider). */
  maxMagLimit: 7.5,
} as const;

/**
 * Unit vectors, in the celestial (equatorial) frame, towards the galactic
 * north pole (RA 192.859°, Dec +27.128°) and the galactic centre (RA
 * 266.405°, Dec -28.936°), J2000. The plane is tilted 62.87° to the
 * celestial equator.
 */
const DEG = Math.PI / 180;
const radec = (raDeg: number, decDeg: number): [number, number, number] => [
  Math.cos(decDeg * DEG) * Math.cos(raDeg * DEG),
  Math.cos(decDeg * DEG) * Math.sin(raDeg * DEG),
  Math.sin(decDeg * DEG),
];
export const GALACTIC_NORTH_POLE = radec(192.85948, 27.12825);
export const GALACTIC_CENTRE = radec(266.40499, -28.93617);

/** A generated field, in the celestial frame. */
export interface StarField {
  readonly count: number;
  /** x, y, z per star: unit vectors (x to RA 0h, z to the north pole). */
  readonly directions: Float32Array;
  /** Visual magnitude per star, brightest first is not implied. */
  readonly magnitudes: Float32Array;
  /** r, g, b per star, each in [0.6, 1]. */
  readonly colors: Float32Array;
}

/** A small seeded generator (32-bit state), uniform in [0, 1). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A star field down to `magLimit` (0.5-7.5), from an integer `seed`. The
 * cumulative count is N(<m) = countAt6_5 * 10^(0.5 (m - 6.5)), so the same
 * seed at a fainter limit gives more stars, not the same ones. RangeError
 * for a non-integer seed or a limit out of range.
 */
export function generateStarField({
  seed,
  magLimit,
}: {
  seed: number;
  magLimit: number;
}): StarField {
  if (!Number.isInteger(seed)) {
    throw new RangeError(`seed must be an integer, got ${seed}`);
  }
  if (!(magLimit >= 0.5 && magLimit <= GLOBE_STARS.maxMagLimit)) {
    throw new RangeError(
      `magnitude limit must be within 0.5-${GLOBE_STARS.maxMagLimit}, got ${magLimit}`,
    );
  }
  const count = Math.round(
    GLOBE_STARS.countAt6_5 * 10 ** (0.5 * (magLimit - 6.5)),
  );
  const random = seeded(seed);
  // Inverse of the cumulative law, over [brightestMag, magLimit].
  const uMin = 10 ** (0.5 * (GLOBE_STARS.brightestMag - magLimit));
  const directions = new Float32Array(count * 3);
  const magnitudes = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Uniform on the sphere: z uniform in [-1, 1], longitude uniform.
    const z = 2 * random() - 1;
    const phi = 2 * Math.PI * random();
    const r = Math.sqrt(1 - z * z);
    directions.set([r * Math.cos(phi), r * Math.sin(phi), z], 3 * i);
    const u = uMin + (1 - uMin) * random();
    magnitudes[i] = Math.min(magLimit, magLimit + 2 * Math.log10(u));
    // A slight colour: t in [-0.5, 0.5], bluish below 0, reddish above.
    const t = (random() + random() + random()) / 3 - 0.5;
    colors.set(
      t < 0 ? [1 + 0.6 * t, 1 + 0.3 * t, 1] : [1, 1 - 0.3 * t, 1 - 0.6 * t],
      3 * i,
    );
  }
  return { count, directions, magnitudes, colors };
}

/**
 * Greenwich mean sidereal time at an instant (epoch ms, UT), as an angle in
 * [0, 2π): the right ascension on the Greenwich meridian (the standard
 * 1982 expression in days and centuries from J2000.0). RangeError for a
 * non-finite instant.
 */
export function greenwichSiderealAngleRad(ms: number): number {
  if (!Number.isFinite(ms)) {
    throw new RangeError(`instant must be finite, got ${ms}`);
  }
  const d = ms / 86_400_000 - 10_957.5; // days from J2000.0 (JD 2451545.0)
  const t = d / 36_525;
  const deg =
    280.46061837 +
    360.98564736629 * d +
    0.000387933 * t * t -
    (t * t * t) / 38_710_000;
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped >= 360 ? 0 : wrapped * DEG;
}

/**
 * The rotation from the celestial frame into ECEF at a sidereal angle: about
 * the pole by -θ, so a star whose right ascension is θ lies on the Greenwich
 * meridian. Precession and nutation (under half a degree since J2000) are
 * left out: the field is procedural.
 */
export function celestialToEcefQuaternion(
  siderealAngleRad: number,
  target = new THREE.Quaternion(),
): THREE.Quaternion {
  return target.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -siderealAngleRad);
}
