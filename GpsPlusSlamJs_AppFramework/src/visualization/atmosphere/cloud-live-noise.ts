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
  /** Each octave's amplitude over the one before. */
  gain: 0.5,
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
   * `aaStartRatio` of its cell and gone (its mean) from `aaEndRatio`.
   */
  aaStartRatio: 0.5,
  aaEndRatio: 1,
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

/** The options resolved and validated. */
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
};

function requireOctaves({ octaves, gain }: Required<CloudLiveOptions>): void {
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

/** The options over the defaults, validated. */
function resolve(options: CloudLiveOptions): Required<CloudLiveOptions> {
  const resolved: Record<string, unknown> = { ...DEFAULT_OPTIONS };
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) resolved[key] = value;
  }
  const o = resolved as unknown as Required<CloudLiveOptions>;
  requireOctaves(o);
  requireCells(o);
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
  let total = 0;
  for (let k = 0; k < o.octaves; k++) total += o.gain ** k;
  const out: CloudLiveOctave[] = [];
  let cell = o.baseCellKm;
  for (let k = 0; k < o.octaves; k++) {
    if (k > 0) cell /= o.lacunarities[k - 1]!;
    out.push({
      cellKm: cell,
      amplitude: (o.contrast * o.gain ** k) / total,
      angleRad: o.rotationStepRad * (k + 1),
      seedCells: [
        (hash(k, 0, o.latticeSeed + 101) / 4294967296) * o.latticeSize,
        (hash(k, 1, o.latticeSeed + 101) / 4294967296) * o.latticeSize,
      ],
    });
  }
  return out;
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
 * becomes the shader's small numbers. RangeError for a non-finite anchor.
 */
export function cloudLiveBasis(
  anchor: CloudNoiseAnchor,
  options: CloudLiveOptions = {}
): number[] {
  const [px, py] = anchor.originKm;
  const rot = anchor.rotationRad;
  if (!(Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(rot))) {
    throw new RangeError(
      `the noise anchor must be finite, got ${px}, ${py}, ${rot}`
    );
  }
  const size = options.latticeSize ?? CLOUD_LIVE_NOISE.latticeSize;
  const basis: number[] = [];
  for (const octave of cloudLiveOctaves(options)) {
    const c = Math.cos(octave.angleRad) / octave.cellKm;
    const s = Math.sin(octave.angleRad) / octave.cellKm;
    basis.push(
      Math.cos(octave.angleRad + rot) / octave.cellKm,
      Math.sin(octave.angleRad + rot) / octave.cellKm,
      reduce(c * px - s * py + octave.seedCells[0], size),
      reduce(s * px + c * py + octave.seedCells[1], size)
    );
  }
  return basis;
}

/** The default options: one object, so the field cache below hits. */
const NO_OPTIONS: CloudLiveOptions = {};

/** A field's octaves and lattice, cached per options object. */
const fieldCache = new WeakMap<
  CloudLiveOptions,
  { octaves: CloudLiveOctave[]; data: Uint8Array; size: number }
>();

function resolvedField(options: CloudLiveOptions) {
  let field = fieldCache.get(options);
  if (field === undefined) {
    const size = options.latticeSize ?? CLOUD_LIVE_NOISE.latticeSize;
    field = {
      octaves: cloudLiveOctaves(options),
      data: cloudLiveLattice(
        size,
        options.latticeSeed ?? CLOUD_LIVE_NOISE.latticeSeed
      ),
      size,
    };
    fieldCache.set(options, field);
  }
  return field;
}

/** The octave's anti-aliasing weight: 1 whole, 0 faded to its mean. */
function fadeWeight(footprintKm: number, cellKm: number): number {
  return (
    1 -
    smoothstep(
      CLOUD_LIVE_NOISE.aaStartRatio,
      CLOUD_LIVE_NOISE.aaEndRatio,
      footprintKm / cellKm
    )
  );
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
  if (!(Number.isFinite(xKm) && Number.isFinite(yKm))) {
    throw new RangeError(`the point must be finite, got ${xKm}, ${yKm}`);
  }
  if (!(footprintKm >= 0)) {
    throw new RangeError(`the footprint must be >= 0, got ${footprintKm}`);
  }
  const { octaves, data, size } = resolvedField(options);
  if (basis.length !== 4 * octaves.length) {
    throw new RangeError(
      `the basis must hold ${4 * octaves.length} numbers, got ${basis.length}`
    );
  }
  const mask = size - 1;
  const at = (i: number, j: number) => data[(j & mask) * size + (i & mask)]!;
  let sum = 0;
  for (let k = 0; k < octaves.length; k++) {
    const octave = octaves[k]!;
    const w = fadeWeight(footprintKm, octave.cellKm);
    if (w <= 0) break;
    const a = basis[4 * k]!;
    const b = basis[4 * k + 1]!;
    const qx = a * xKm - b * yKm + basis[4 * k + 2]!;
    const qy = b * xKm + a * yKm + basis[4 * k + 3]!;
    const ix = Math.floor(qx);
    const iy = Math.floor(qy);
    // The Hermite fade, the shader's f * f * (3 - 2 f) on [0, 1).
    const fx = smoothstep(0, 1, qx - ix);
    const fy = smoothstep(0, 1, qy - iy);
    const v00 = at(ix, iy);
    const v10 = at(ix + 1, iy);
    const v01 = at(ix, iy + 1);
    const v11 = at(ix + 1, iy + 1);
    const top = v00 + (v10 - v00) * fx;
    const bottom = v01 + (v11 - v01) * fx;
    const value = (top + (bottom - top) * fy) / 255;
    sum += octave.amplitude * w * (value - CLOUD_LIVE_NOISE.latticeMean);
  }
  return (options.fieldMean ?? CLOUD_LIVE_NOISE.fieldMean) + sum;
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
 * - `atmCloudLiveNoise(lattice, basis, p, footprintKm)`: the field at the
 *   local point p (km), one lattice read an octave at level 0 through the
 *   smooth remap (the hardware's bilinear read at i + fade(f) + 0.5), each
 *   octave faded to its mean by the footprint, the loop ending at the first
 *   faded octave (they only get finer).
 * - `atmCloudLiveAt(lattice, basis, uv, offset, footprintKm)`: the same from
 *   a reader's noise coordinate (tiles, `atmCloudOffset` included), which is
 *   how every reader already addresses the tile: the local point is
 *   (uv - offset) x the tile.
 * - `atmCloudLiveGrad(lattice, basis, uv, offset)`: the footprint from the
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
const float ATM_LIVE_AMP[ATM_LIVE_OCTAVES] = ${glslArray(DEFAULT_OCTAVES.map((o) => o.amplitude))};

// Twin of cloud-live-noise.ts cloudLiveSample.
float atmCloudLiveNoise(sampler2D lattice, vec4 basis[ATM_LIVE_OCTAVES], vec2 p, float footprint) {
  float sum = 0.0;
  for (int k = 0; k < ATM_LIVE_OCTAVES; k++) {
    float w = 1.0 - smoothstep(ATM_LIVE_AA_START, ATM_LIVE_AA_END, footprint / ATM_LIVE_CELL[k]);
    if (w <= 0.0) break;
    vec4 b = basis[k];
    vec2 q = vec2(b.x * p.x - b.y * p.y, b.y * p.x + b.x * p.y) + b.zw;
    vec2 i = floor(q);
    vec2 f = q - i;
    f = f * f * (3.0 - 2.0 * f);
    float v = textureLod(lattice, (i + f + 0.5) / ATM_LIVE_SIZE, 0.0).r;
    sum += ATM_LIVE_AMP[k] * w * (v - ATM_LIVE_LATTICE_MEAN);
  }
  return ATM_LIVE_FIELD_MEAN + sum;
}

float atmCloudLiveAt(sampler2D lattice, vec4 basis[ATM_LIVE_OCTAVES], vec2 uv, vec2 offset, float footprint) {
  return atmCloudLiveNoise(lattice, basis, (uv - offset) * ATM_LIVE_TILE_KM, footprint);
}

float atmCloudLiveGrad(sampler2D lattice, vec4 basis[ATM_LIVE_OCTAVES], vec2 uv, vec2 offset) {
  float footprint = max(length(dFdx(uv)), length(dFdy(uv))) * ATM_LIVE_TILE_KM;
  return atmCloudLiveAt(lattice, basis, uv, offset, footprint);
}
#endif
`;
