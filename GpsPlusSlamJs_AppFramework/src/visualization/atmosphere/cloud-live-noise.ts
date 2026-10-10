/**
 * The clouds' noise evaluated live, per octave (round-3 plan 2026-10-08-2345,
 * N1, DEC-R3-4): the value-noise fBm the baked 24 km tile holds, but each
 * octave with its own rotation, a slightly irrational lacunarity and its own
 * anchor, its lattice values from a 1,024^2 byte texture. Nothing repeats
 * within thousands of kilometres, so the owner's "carpet tiles" cannot show.
 *
 * WHAT LIVES HERE: the constants, the lattice, the per-octave basis (the
 * anchoring, in float64), the CPU twin of the shader (`cloudLiveSample`), the
 * cover's threshold table measured from that twin, the lattice texture and
 * the GLSL chunk.
 *
 * THE ANCHORING. The caller carries, in float64 on the CPU, where its frame's
 * origin lies on the noise plane (`originKm`, unwrapped) and the frame's
 * rotation on it (`rotationRad`). A local point p (km) lies on the plane at
 * P = originKm + R(rotation) p. Octave k reads its lattice at
 * q = R(angle_k) P / cell_k + seed_k = M_k p + o_k, with M_k the octave's
 * rotation and scale composed with the frame's, and o_k its offset, reduced
 * modulo the lattice's size: each octave alone repeats there exactly, so the
 * reduction never moves the field, and the shader only ever sees small
 * local numbers (centimetres of precision).
 *
 * @see cloud-live-noise.ts.md
 */

import * as THREE from 'three';

import { glslFloat } from '../../utils/glsl-float.js';
import { smoothstep } from '../../utils/smoothstep.js';
import { CLOUD_LAYER } from './cloud-layer.js';
import { coverTableThreshold, quantileThresholds } from './cloud-hex.js';

/** Which noise the clouds read: the baked tile, its hex-tiled form, or live. */
export type CloudNoiseMode = 'tile' | 'hex' | 'live';

/** Every `CloudNoiseMode`, for validating a caller's string. */
export const CLOUD_NOISE_MODES: readonly CloudNoiseMode[] = [
  'tile',
  'hex',
  'live',
];

/**
 * The live noise's constants. The GLSL receives every one from here.
 * `fieldMean` and `contrast` match the drawn tile field's mean and spread
 * (held by a test), so the slab's columns rise as high at the same cover.
 */
export const CLOUD_LIVE_NOISE = {
  /** Octaves (the tile's five plus two that replace its detail read). */
  octaves: 7,
  /** Each octave's amplitude over the one before (octave 1 over octave 0). */
  gain: 0.5,
  /**
   * The amplitude ratio from octave 2 on (the fine detail's knob, the N1
   * milestone review item 2); `gain` by default, today's look. The spread
   * is kept: the amplitudes are scaled so their root sum of squares stays.
   */
  fineGain: 0.5,
  /** The base octave's cells, km: the tile's 4 cells a 24 km tile. */
  baseCellKm: CLOUD_LAYER.tileKm / 4,
  /** The ratio of each octave's cell to the next one's (slightly irrational). */
  lacunarities: [2.07, 1.97, 2.13, 2.03, 1.93, 2.11, 2.05],
  /** Octave k turns by this times (k + 1), radians. */
  rotationStepRad: 1.1,
  /** The lattice's edge, texels (a power of two). */
  latticeSize: 1024,
  /** The lattice's hash seed. */
  latticeSeed: 11,
  /** The default lattice's mean (0-1), held by a test. */
  latticeMean: 0.4999904295977424,
  /**
   * The anti-aliasing fade: an octave is whole while the footprint is at most
   * `aaStartRatio` of its cell and gone (its mean) from `aaEndRatio`
   * cells. 4, not 1 (the N1 milestone review, round-3 plan §19 item 1):
   * swept 1 / 2 / 3 / 4 with the spread kept, the cover drawn holds to a
   * footprint of `aaEndRatio` base cells (6 / 12 / 18 / 24 km, at most
   * 0.02 off to 16 km at 4) and 4 has the least difference from the
   * box-filtered density at every footprint to 8 km
   * (`cloud-live-noise.sweep.test.ts`, SWEEP_AA).
   */
  aaStartRatio: 0.5,
  aaEndRatio: 4,
  /**
   * Whether the field keeps its spread as octaves fade (the faded sum's
   * deviation scaled back by the spread at footprint 0 over the spread
   * left), so the cover drawn with the footprint-0 threshold does not drift
   * with the footprint: with the fade alone, a 6 km footprint drew asked
   * covers 0.3 / 0.7 as 0.00 / 1.00. Never by more than `maxSpreadGain`
   * (4; swept 2 / 4 / 8: 2 lets the cover go from 16 km, 8 changes nothing
   * further), so the field still goes to its mean continuously once even
   * the base octave fades.
   */
  restoreSpread: true,
  maxSpreadGain: 4,
  /**
   * The octaves the slab's march reads at most (round-3 plan §19 item 5):
   * the two finest (cells of 176 and 84 m) carry 0.09 % of the variance
   * but cost 7 % of the live volume pass (measured on SwiftShader, one page
   * load, the pass alone: the tile 722 ms, live with 7 octaves 802, with 5
   * in the march 743). The sheet, the dome and the shadow read all 7; the
   * spread the fade keeps covers the two the march leaves out.
   */
  marchOctaves: 5,
  /** The field's mean and its contrast on the octaves' normalised sum. */
  fieldMean: 0.38008,
  contrast: 1.431,
} as const;

/** Options for the sweeps; every field defaults to `CLOUD_LIVE_NOISE`'s. */
export interface CloudLiveOptions {
  readonly octaves?: number;
  readonly gain?: number;
  readonly baseCellKm?: number;
  readonly lacunarities?: readonly number[];
  readonly rotationStepRad?: number;
  readonly latticeSize?: number;
  readonly latticeSeed?: number;
  readonly contrast?: number;
  readonly fieldMean?: number;
  readonly fineGain?: number;
  readonly aaStartRatio?: number;
  readonly aaEndRatio?: number;
  readonly restoreSpread?: boolean;
  readonly maxSpreadGain?: number;
  /** Octaves read at most (a march's cost knob); the rest count as faded. */
  readonly octaveLimit?: number;
}

/** Where a frame's origin lies on the noise plane, carried by the caller. */
export interface CloudNoiseAnchor {
  /** The origin's noise-plane position, km, unwrapped, float64. */
  readonly originKm: readonly [number, number];
  /** The frame's rotation on the noise plane, radians. */
  readonly rotationRad: number;
}

/** One octave: its cell (km), amplitude, rotation and seed offset (cells). */
export interface CloudLiveOctave {
  readonly cellKm: number;
  readonly amplitude: number;
  readonly angleRad: number;
  readonly seedCells: readonly [number, number];
}

const MAX_OCTAVES = 8;

/** A uint32 hash in [0, 2^32), `Math.imul` arithmetic (as `cloud-hex.ts`). */
function hash(i: number, j: number, salt: number): number {
  let h =
    (Math.imul(i, 374761393) +
      Math.imul(j, 668265263) +
      Math.imul(salt, 2246822519 | 0)) |
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

function requireLatticeSize(size: number): void {
  if (!(Number.isInteger(size) && size >= 16 && size <= 4096)) {
    throw new RangeError(
      `the lattice size must be a power of two from 16 to 4096, got ${size}`
    );
  }
  if ((size & (size - 1)) !== 0) {
    throw new RangeError(
      `the lattice size must be a power of two from 16 to 4096, got ${size}`
    );
  }
}

const latticeCache = new Map<string, Uint8Array>();

/**
 * The lattice: `size` x `size` bytes, row-major, one hashed value a cell.
 * Cached per (size, seed): treat it as read-only. RangeError for a size that
 * is not a power of two from 16 to 4,096.
 */
export function cloudLiveLattice(
  size: number = CLOUD_LIVE_NOISE.latticeSize,
  seed: number = CLOUD_LIVE_NOISE.latticeSeed
): Uint8Array {
  requireLatticeSize(size);
  const key = `${size}:${seed}`;
  const cached = latticeCache.get(key);
  if (cached !== undefined) return cached;
  const data = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) data[j * size + i] = hash(i, j, seed) >>> 24;
  }
  latticeCache.set(key, data);
  return data;
}

/** The defaults every option falls back to. */
const DEFAULT_OPTIONS: Required<CloudLiveOptions> = {
  octaves: CLOUD_LIVE_NOISE.octaves,
  gain: CLOUD_LIVE_NOISE.gain,
  baseCellKm: CLOUD_LIVE_NOISE.baseCellKm,
  lacunarities: CLOUD_LIVE_NOISE.lacunarities,
  rotationStepRad: CLOUD_LIVE_NOISE.rotationStepRad,
  latticeSize: CLOUD_LIVE_NOISE.latticeSize,
  latticeSeed: CLOUD_LIVE_NOISE.latticeSeed,
  contrast: CLOUD_LIVE_NOISE.contrast,
  fieldMean: CLOUD_LIVE_NOISE.fieldMean,
  fineGain: CLOUD_LIVE_NOISE.fineGain,
  aaStartRatio: CLOUD_LIVE_NOISE.aaStartRatio,
  aaEndRatio: CLOUD_LIVE_NOISE.aaEndRatio,
  restoreSpread: CLOUD_LIVE_NOISE.restoreSpread,
  maxSpreadGain: CLOUD_LIVE_NOISE.maxSpreadGain,
  octaveLimit: MAX_OCTAVES,
};

function requireOctaves({
  octaves,
  gain,
  fineGain,
}: Required<CloudLiveOptions>): void {
  if (!(fineGain > 0 && fineGain < 1)) {
    throw new RangeError(`the fine gain must be in (0, 1), got ${fineGain}`);
  }
  if (!(Number.isInteger(octaves) && octaves >= 1 && octaves <= MAX_OCTAVES)) {
    throw new RangeError(
      `the octaves must be a whole number from 1 to ${MAX_OCTAVES}, got ${octaves}`
    );
  }
  if (!(gain > 0 && gain < 1)) {
    throw new RangeError(`the gain must be in (0, 1), got ${gain}`);
  }
}

function requireCells({
  octaves,
  lacunarities,
  baseCellKm,
}: Required<CloudLiveOptions>): void {
  const ratios = lacunarities.slice(0, octaves - 1);
  if (ratios.length < octaves - 1 || !ratios.every((l) => l > 1 && l < 4)) {
    throw new RangeError(
      `the lacunarities must give ${octaves - 1} ratios in (1, 4), got ${lacunarities.join(', ')}`
    );
  }
  if (!(baseCellKm > 0 && Number.isFinite(baseCellKm))) {
    throw new RangeError(`the base cell must be positive, got ${baseCellKm}`);
  }
}

function requireFade({
  aaStartRatio,
  aaEndRatio,
  maxSpreadGain,
  octaveLimit,
}: Required<CloudLiveOptions>): void {
  if (!(
    aaStartRatio >= 0 &&
    aaEndRatio > aaStartRatio &&
    Number.isFinite(aaEndRatio)
  )) {
    throw new RangeError(
      `the fade must run from a ratio >= 0 to a larger finite one, got ${aaStartRatio}, ${aaEndRatio}`
    );
  }
  if (!(maxSpreadGain >= 1)) {
    throw new RangeError(
      `the spread gain cap must be >= 1, got ${maxSpreadGain}`
    );
  }
  if (!(Number.isInteger(octaveLimit) && octaveLimit >= 1)) {
    throw new RangeError(
      `the octave limit must be a whole number >= 1, got ${octaveLimit}`
    );
  }
}

/** The options over the defaults, validated. */
function resolve(options: CloudLiveOptions): Required<CloudLiveOptions> {
  const resolved: Record<string, unknown> = { ...DEFAULT_OPTIONS };
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) resolved[key] = value;
  }
  const o = resolved as unknown as Required<CloudLiveOptions>;
  requireOctaves(o);
  requireCells(o);
  requireFade(o);
  requireLatticeSize(o.latticeSize);
  return o;
}

/**
 * The octaves: cells from `baseCellKm` divided by the lacunarities, the
 * amplitudes falling by the gain and normalised to sum to `contrast`, each
 * turned by `rotationStepRad` x (k + 1), each reading its own part of the
 * lattice (a hashed offset in cells). RangeError for options out of range.
 */
export function cloudLiveOctaves(
  options: CloudLiveOptions = {}
): CloudLiveOctave[] {
  const o = resolve(options);
  // The pure gain schedule sums to `total`; the knob's schedule keeps its
  // root sum of squares, so the spread is the same at every fine gain.
  const plain = Array.from({ length: o.octaves }, (_, k) => o.gain ** k);
  const schedule = plain.map((a, k) =>
    k < 2 ? a : o.gain * o.fineGain ** (k - 1)
  );
  const total = plain.reduce((sum, a) => sum + a, 0);
  const rss = (list: number[]) =>
    Math.sqrt(list.reduce((t, a) => t + a * a, 0));
  const scale = (o.contrast / total) * (rss(plain) / rss(schedule));
  const out: CloudLiveOctave[] = [];
  let cell = o.baseCellKm;
  for (let k = 0; k < o.octaves; k++) {
    if (k > 0) cell /= o.lacunarities[k - 1]!;
    out.push({
      cellKm: cell,
      amplitude: scale * schedule[k]!,
      angleRad: o.rotationStepRad * (k + 1),
      seedCells: [
        (hash(k, 0, o.latticeSeed + 101) / 4294967296) * o.latticeSize,
        (hash(k, 1, o.latticeSeed + 101) / 4294967296) * o.latticeSize,
      ],
    });
  }
  return out;
}

/**
 * The octaves' amplitudes for `options` (the shader's amplitude uniform):
 * `cloudLiveOctaves`'s, in order. The fine gain moves variance between the
 * octaves but keeps their root sum of squares, so the field's spread, the
 * spread the fade keeps, and the cover's table hold at every fine gain.
 */
export function cloudLiveAmplitudes(options: CloudLiveOptions = {}): number[] {
  return cloudLiveOctaves(options).map((o) => o.amplitude);
}

/** x reduced into [0, size), never `size` itself from a rounding. */
function reduce(x: number, size: number): number {
  const r = x - size * Math.floor(x / size);
  return r < size ? r : 0;
}

/**
 * The per-octave basis for `anchor`: four numbers an octave, (a, b, ox, oy),
 * so that octave k reads its lattice at
 * q = (a x - b y + ox, b x + a y + oy) for the local point (x, y) km. (a, b)
 * is the octave's rotation composed with the frame's, over its cell; (ox,
 * oy) its rotation of the origin over its cell plus its seed, reduced modulo
 * the lattice. All in float64: the reduction is where the float64 anchor
 * becomes the shader's small numbers, written into `out` (a new array by
 * default). RangeError for a non-finite anchor.
 */
export function cloudLiveBasis(
  anchor: CloudNoiseAnchor,
  options: CloudLiveOptions = NO_OPTIONS,
  out: number[] = []
): number[] {
  const [px, py] = anchor.originKm;
  const rot = anchor.rotationRad;
  if (!(Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(rot))) {
    throw new RangeError(
      `the noise anchor must be finite, got ${px}, ${py}, ${rot}`
    );
  }
  // The cached octaves, written into `out`: no allocation a frame (§19
  // item 8; a caller writes the anchor every frame).
  const { o, octaves } = resolvedField(options);
  const size = o.latticeSize;
  out.length = 4 * octaves.length;
  octaves.forEach((octave, k) => {
    const c = Math.cos(octave.angleRad) / octave.cellKm;
    const s = Math.sin(octave.angleRad) / octave.cellKm;
    out[4 * k] = Math.cos(octave.angleRad + rot) / octave.cellKm;
    out[4 * k + 1] = Math.sin(octave.angleRad + rot) / octave.cellKm;
    out[4 * k + 2] = reduce(c * px - s * py + octave.seedCells[0], size);
    out[4 * k + 3] = reduce(s * px + c * py + octave.seedCells[1], size);
  });
  return out;
}

/** The default options: one object, so the field cache below hits. */
const NO_OPTIONS: CloudLiveOptions = {};

interface ResolvedField {
  readonly o: Required<CloudLiveOptions>;
  readonly octaves: CloudLiveOctave[];
  readonly data: Uint8Array;
  /** The amplitudes' sum of squares: the spread at footprint 0, squared. */
  readonly spread0: number;
}

/** A field's options, octaves and lattice, cached per options object. */
const fieldCache = new WeakMap<CloudLiveOptions, ResolvedField>();

function resolvedField(options: CloudLiveOptions): ResolvedField {
  let field = fieldCache.get(options);
  if (field === undefined) {
    const o = resolve(options);
    const octaves = cloudLiveOctaves(options);
    field = {
      o,
      octaves,
      data: cloudLiveLattice(o.latticeSize, o.latticeSeed),
      spread0: octaves.reduce((t, x) => t + x.amplitude * x.amplitude, 0),
    };
    fieldCache.set(options, field);
  }
  return field;
}

/** The octave's anti-aliasing weight: 1 whole, 0 faded to its mean. */
function fadeWeight(
  footprintKm: number,
  cellKm: number,
  o: Required<CloudLiveOptions>
): number {
  return 1 - smoothstep(o.aaStartRatio, o.aaEndRatio, footprintKm / cellKm);
}

function requireSample(xKm: number, yKm: number, footprintKm: number): void {
  if (!(Number.isFinite(xKm) && Number.isFinite(yKm))) {
    throw new RangeError(`the point must be finite, got ${xKm}, ${yKm}`);
  }
  if (!(footprintKm >= 0)) {
    throw new RangeError(`the footprint must be >= 0, got ${footprintKm}`);
  }
}

/**
 * Octave `k`'s value noise (0-1) at the local point: its lattice read at
 * the basis's q through the Hermite fade, as the shader's bilinear read at
 * i + fade(f) + 0.5 texels.
 */
function octaveValue(
  data: Uint8Array,
  size: number,
  basis: ArrayLike<number>,
  k: number,
  xKm: number,
  yKm: number
): number {
  const mask = size - 1;
  const at = (i: number, j: number) => data[(j & mask) * size + (i & mask)]!;
  const a = basis[4 * k]!;
  const b = basis[4 * k + 1]!;
  const qx = a * xKm - b * yKm + basis[4 * k + 2]!;
  const qy = b * xKm + a * yKm + basis[4 * k + 3]!;
  const ix = Math.floor(qx);
  const iy = Math.floor(qy);
  // The Hermite fade, the shader's f * f * (3 - 2 f) on [0, 1).
  const fx = smoothstep(0, 1, qx - ix);
  const fy = smoothstep(0, 1, qy - iy);
  const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * fx;
  const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * fx;
  return (top + (bottom - top) * fy) / 255;
}

/**
 * The live noise at the local point (`xKm`, `yKm`) for `basis`
 * (`cloudLiveBasis`), each octave faded to its mean as `footprintKm` (a
 * pixel's or a step's ground footprint) outgrows its cells. The CPU twin of
 * `atmCloudLiveNoise`: the same lattice, the same smooth remap, in float64
 * (the GPU's bilinear weights are 8-bit: they agree within about 1/256 of a
 * lattice step). RangeError for non-finite coordinates, a negative or NaN
 * footprint, or a basis that is not four numbers an octave.
 */
export function cloudLiveSample(
  basis: ArrayLike<number>,
  xKm: number,
  yKm: number,
  footprintKm = 0,
  options: CloudLiveOptions = NO_OPTIONS
): number {
  requireSample(xKm, yKm, footprintKm);
  const { o, octaves, data, spread0 } = resolvedField(options);
  const size = o.latticeSize;
  if (basis.length !== 4 * octaves.length) {
    throw new RangeError(
      `the basis must hold ${4 * octaves.length} numbers, got ${basis.length}`
    );
  }
  let sum = 0;
  let spread = 0;
  const limit = Math.min(octaves.length, o.octaveLimit);
  for (let k = 0; k < limit; k++) {
    const octave = octaves[k]!;
    const w = fadeWeight(footprintKm, octave.cellKm, o);
    if (w <= 0) break;
    const value = octaveValue(data, size, basis, k, xKm, yKm);
    sum += octave.amplitude * w * (value - CLOUD_LIVE_NOISE.latticeMean);
    spread += (octave.amplitude * w) ** 2;
  }
  if (o.restoreSpread && spread > 0) {
    sum *= Math.min(Math.sqrt(spread0 / spread), o.maxSpreadGain);
  }
  return o.fieldMean + sum;
}

/**
 * The live field's cover thresholds, the (1 - cover) quantiles of
 * `samples` points spread uniformly (a seeded generator) over a square far
 * larger than the base octave's period, at footprint 0 and the origin's
 * anchor. Covers default to k / 32 (+Infinity at 0).
 */
export function cloudLiveCoverThresholds(
  options: {
    readonly samples?: number;
    readonly seed?: number;
    readonly covers?: readonly number[];
    readonly spanKm?: number;
  } = {}
): number[] {
  const samples = options.samples ?? 1_000_000;
  const spanKm = options.spanKm ?? 20_000;
  let state = (options.seed ?? 1) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const basis = cloudLiveBasis({ originKm: [0, 0], rotationRad: 0 });
  const values = new Float64Array(samples);
  for (let i = 0; i < samples; i++) {
    values[i] = cloudLiveSample(basis, next() * spanKm, next() * spanKm);
  }
  const covers = options.covers ?? Array.from({ length: 33 }, (_, k) => k / 32);
  return quantileThresholds(values, covers);
}

/**
 * `cloudLiveCoverThresholds()` for the default field, precomputed from
 * 1,000,000 points (a live switch must not pay the sort on a phone) and held
 * to a fresh computation on other points by a test.
 */
export const CLOUD_LIVE_COVER_THRESHOLDS: readonly number[] = [
  Number.POSITIVE_INFINITY,
  0.707075,
  0.65723446,
  0.62226171,
  0.59439803,
  0.57001116,
  0.54808737,
  0.5279891,
  0.50934219,
  0.4915506,
  0.47428745,
  0.45777119,
  0.44158948,
  0.42586503,
  0.41028345,
  0.3949529,
  0.37967251,
  0.36436568,
  0.34914819,
  0.33363664,
  0.31795719,
  0.30187917,
  0.28525868,
  0.26827599,
  0.25055373,
  0.23182443,
  0.21168923,
  0.19005965,
  0.16552766,
  0.13744153,
  0.10288669,
  0.05315809,
  -0.22624996,
];

/**
 * The low tail: covers k / 512, k = 1..16 (the last is the table's 1 / 32),
 * so a thin cover is not drawn at the 1 / 32 entry's share (as the hex
 * table's low tail, H1/H2 milestone review, finding 1).
 */
export const CLOUD_LIVE_COVER_LOW_TAIL: readonly number[] = [
  0.83691246, 0.81101865, 0.79393759, 0.78178461, 0.77138017, 0.7626196,
  0.75488853, 0.74786803, 0.74139277, 0.73552755, 0.72992758, 0.72496364,
  0.7201188, 0.71550197, 0.71111424, 0.707075,
];

/**
 * The live field's threshold for `cover` (0-1): linear between the table's
 * covers, and below 1 / 32 between the low tail's; +Infinity at 0 (a clear
 * sky). RangeError for a cover outside [0, 1].
 */
export function liveCloudThreshold(cover: number): number {
  return coverTableThreshold(
    CLOUD_LIVE_COVER_THRESHOLDS,
    CLOUD_LIVE_COVER_LOW_TAIL,
    cover
  );
}

/**
 * The default lattice as a texture: one red byte a texel, repeating, linear
 * and without mipmaps (the shader reads it at level 0 and anti-aliases by
 * fading its octaves, plan §10 item 5).
 */
export function createCloudLiveLatticeTexture(): THREE.DataTexture {
  const size = CLOUD_LIVE_NOISE.latticeSize;
  const texture = new THREE.DataTexture(
    cloudLiveLattice(),
    size,
    size,
    THREE.RedFormat
  );
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

const DEFAULT_OCTAVES = cloudLiveOctaves();
const glslArray = (values: readonly number[]) =>
  `float[ATM_LIVE_OCTAVES](${values.map(glslFloat).join(', ')})`;

/**
 * The shader twin of `cloudLiveSample` (GLSL ES 3.00), self-contained and
 * include-guarded, so every cloud reader (the sky, the sheet, the slab, the
 * shadow's patch) takes the same one:
 * - `atmCloudLiveNoise(lattice, basis, amp, p, footprintKm, octaves)`: the field at the
 *   local point p (km), one lattice read an octave at level 0 through the
 *   smooth remap (the hardware's bilinear read at i + fade(f) + 0.5), each
 *   octave faded to its mean by the footprint, the loop ending at the first
 *   faded octave (they only get finer).
 * - `atmCloudLiveAt(lattice, basis, amp, uv, offset, footprintKm, octaves)`: the same from
 *   a reader's noise coordinate (tiles, `atmCloudOffset` included), which is
 *   how every reader already addresses the tile: the local point is
 *   (uv - offset) x the tile.
 * - `atmCloudLiveGrad(lattice, basis, amp, uv, offset)`: the footprint from the
 *   coordinate's screen derivatives, for readers outside a loop.
 */
export const CLOUD_LIVE_NOISE_GLSL = /* glsl */ `
#ifndef ATM_CLOUD_LIVE_GLSL
#define ATM_CLOUD_LIVE_GLSL
const int ATM_LIVE_OCTAVES = ${DEFAULT_OCTAVES.length};
const float ATM_LIVE_SIZE = ${glslFloat(CLOUD_LIVE_NOISE.latticeSize)};
const float ATM_LIVE_TILE_KM = ${glslFloat(CLOUD_LAYER.tileKm)};
const float ATM_LIVE_LATTICE_MEAN = ${glslFloat(CLOUD_LIVE_NOISE.latticeMean)};
const float ATM_LIVE_FIELD_MEAN = ${glslFloat(CLOUD_LIVE_NOISE.fieldMean)};
const float ATM_LIVE_AA_START = ${glslFloat(CLOUD_LIVE_NOISE.aaStartRatio)};
const float ATM_LIVE_AA_END = ${glslFloat(CLOUD_LIVE_NOISE.aaEndRatio)};
const float ATM_LIVE_CELL[ATM_LIVE_OCTAVES] = ${glslArray(DEFAULT_OCTAVES.map((o) => o.cellKm))};
// The amplitudes' sum of squares (the spread at footprint 0, squared) and
// the cap on the spread kept (CLOUD_LIVE_NOISE.restoreSpread).
const float ATM_LIVE_SPREAD0 = ${glslFloat(DEFAULT_OCTAVES.reduce((t, o) => t + o.amplitude * o.amplitude, 0))};
const float ATM_LIVE_MAX_GAIN = ${glslFloat(CLOUD_LIVE_NOISE.maxSpreadGain)};

// Twin of cloud-live-noise.ts cloudLiveSample.
float atmCloudLiveNoise(sampler2D lattice, vec4 basis[ATM_LIVE_OCTAVES], float amp[ATM_LIVE_OCTAVES], vec2 p, float footprint, float octaves) {
  float sum = 0.0;
  float spread = 0.0;
  for (int k = 0; k < ATM_LIVE_OCTAVES; k++) {
    // At most the octaves asked (a march cost knob); the rest count as faded.
    if (float(k) >= octaves) break;
    float w = 1.0 - smoothstep(ATM_LIVE_AA_START, ATM_LIVE_AA_END, footprint / ATM_LIVE_CELL[k]);
    if (w <= 0.0) break;
    vec4 b = basis[k];
    vec2 q = vec2(b.x * p.x - b.y * p.y, b.y * p.x + b.x * p.y) + b.zw;
    vec2 i = floor(q);
    vec2 f = q - i;
    f = f * f * (3.0 - 2.0 * f);
    float v = textureLod(lattice, (i + f + 0.5) / ATM_LIVE_SIZE, 0.0).r;
    sum += amp[k] * w * (v - ATM_LIVE_LATTICE_MEAN);
    spread += amp[k] * w * amp[k] * w;
  }
  // The spread kept as octaves fade, so the cover drawn holds.
  if (spread > 0.0) sum *= min(sqrt(ATM_LIVE_SPREAD0 / spread), ATM_LIVE_MAX_GAIN);
  return ATM_LIVE_FIELD_MEAN + sum;
}

float atmCloudLiveAt(sampler2D lattice, vec4 basis[ATM_LIVE_OCTAVES], float amp[ATM_LIVE_OCTAVES], vec2 uv, vec2 offset, float footprint, float octaves) {
  return atmCloudLiveNoise(lattice, basis, amp, (uv - offset) * ATM_LIVE_TILE_KM, footprint, octaves);
}

float atmCloudLiveGrad(sampler2D lattice, vec4 basis[ATM_LIVE_OCTAVES], float amp[ATM_LIVE_OCTAVES], vec2 uv, vec2 offset) {
  float footprint = max(length(dFdx(uv)), length(dFdy(uv))) * ATM_LIVE_TILE_KM;
  return atmCloudLiveAt(lattice, basis, amp, uv, offset, footprint, float(ATM_LIVE_OCTAVES));
}
#endif
`;
