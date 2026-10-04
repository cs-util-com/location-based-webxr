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
  /**
   * The faintest limit a field can be generated to (the lab's slider): 9,
   * the owner's wish (round-4 plan 2026-09-28-2105 DEC-GL4-2; 7.5 before).
   * About 89,000 stars on this count law.
   */
  maxMagLimit: 9,
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

/**
 * A field packed for the GPU (round-4 plan DEC-GL4-2): 6 bytes a star
 * instead of 28, sorted brightest first, so a draw range can stop at the
 * magnitude limit.
 * - `octahedral`: the direction as two signed, normalised 16-bit values
 *   (octahedral mapping: the unit sphere folded onto a square), about
 *   0.005° at worst;
 * - `magTint`: the magnitude over [brightestMag, maxMagLimit] and the
 *   colour's tint t (see `generateStarField`) over [-0.5, 0.5], one
 *   unsigned normalised byte each, clamped to its range (never wrapped);
 * - `magnitudes`: the magnitudes as the GPU decodes them (ascending), for
 *   counting what a limit draws.
 */
export interface PackedStars {
  readonly count: number;
  readonly octahedral: Int16Array;
  readonly magTint: Uint8Array;
  readonly magnitudes: Float32Array;
}

/** The magnitude a packed byte stands for (the shader's decode, in JS). */
export function unpackMagnitude(byte: number): number {
  const { brightestMag, maxMagLimit } = GLOBE_STARS;
  return brightestMag + (byte / 255) * (maxMagLimit - brightestMag);
}

const signNotZero = (v: number): number => (v >= 0 ? 1 : -1);

/**
 * A unit vector folded onto the octahedron and unfolded onto [-1, 1]^2.
 * The inverse is `octahedralDecode` (and the star shader's `octDecode`).
 */
export function octahedralEncode(
  x: number,
  y: number,
  z: number,
): [number, number] {
  const l1 = Math.abs(x) + Math.abs(y) + Math.abs(z);
  const u = x / l1;
  const v = y / l1;
  return z >= 0
    ? [u, v]
    : [(1 - Math.abs(v)) * signNotZero(u), (1 - Math.abs(u)) * signNotZero(v)];
}

/** The unit vector an octahedral pair stands for. */
export function octahedralDecode(
  u: number,
  v: number,
): [number, number, number] {
  let x = u;
  let y = v;
  const z = 1 - Math.abs(u) - Math.abs(v);
  if (z < 0) {
    x = (1 - Math.abs(v)) * signNotZero(u);
    y = (1 - Math.abs(u)) * signNotZero(v);
  }
  const n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n];
}

/** A value in [0, 1] as an unsigned byte, clamped (a Uint8Array wraps). */
const toUnorm8 = (v: number): number =>
  Math.round(Math.min(1, Math.max(0, v)) * 255);

/** A float in [-1, 1] as a signed normalised 16-bit value, and back. */
const toSnorm16 = (v: number): number =>
  Math.round(Math.min(1, Math.max(-1, v)) * 32767);
export const fromSnorm16 = (s: number): number => Math.max(s / 32767, -1);

/** A field packed for the GPU, brightest first (see `PackedStars`). */
export function packStarField(field: StarField): PackedStars {
  const { count } = field;
  const order = Array.from({ length: count }, (_, i) => i).sort(
    (a, b) => (field.magnitudes[a] ?? 0) - (field.magnitudes[b] ?? 0),
  );
  const { brightestMag, maxMagLimit } = GLOBE_STARS;
  const octahedral = new Int16Array(2 * count);
  const magTint = new Uint8Array(2 * count);
  const magnitudes = new Float32Array(count);
  order.forEach((from, to) => {
    const d = field.directions;
    const [u, v] = octahedralEncode(
      d[3 * from] ?? 0,
      d[3 * from + 1] ?? 0,
      d[3 * from + 2] ?? 1,
    );
    octahedral[2 * to] = toSnorm16(u);
    octahedral[2 * to + 1] = toSnorm16(v);
    const m = field.magnitudes[from] ?? maxMagLimit;
    const magByte = toUnorm8((m - brightestMag) / (maxMagLimit - brightestMag));
    // The colour's tint: red minus blue is 0.6 t on both sides of white.
    const c = field.colors;
    const t = ((c[3 * from] ?? 1) - (c[3 * from + 2] ?? 1)) / 0.6;
    magTint[2 * to] = magByte;
    magTint[2 * to + 1] = toUnorm8(t + 0.5);
    magnitudes[to] = unpackMagnitude(magByte);
  });
  // Rounding is monotonic, so the packed magnitudes stay in order.
  return { count, octahedral, magTint, magnitudes };
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
 * A star field down to `magLimit` (0.5-9), from an integer `seed`. The
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
