/**
 * Hex-tiling for the clouds' big-shape octave (hex-tiling plan
 * 2026-10-07-0919, H1; Mikkelsen 2022, "Practical Real-Time Hex-Tiling",
 * JCGT 11(2)): the plane is split into near-hexagonal cells, each reads the
 * texture at its own random offset, and the three cells around a point are
 * blended, so the 24 km tile no longer repeats and no seam shows.
 *
 * The CPU twin of the shader chunk: the same lattice, the same hash, the
 * same blend. The field still repeats, at N tiles (`hexPeriodTiles`), so
 * the wind's drift can wrap there without a jump.
 *
 * @see cloud-hex.ts.md
 */

// A leaf: `cloud-layer.ts` (the CPU twin's two octaves) imports this.
import { glslFloat } from '../../utils/glsl-float.js';

export const CLOUD_HEX = {
  /** Cells along a tile's width (a cell is 1 / this tile wide). */
  cellsPerTile: 2,
  /**
   * The rows' step over the cell width, 13 / 15: a hexagon's sqrt(3) / 2
   * within 0.08 %, and rational, so the lattice repeats on the tile grid.
   */
  aspectNum: 13,
  aspectDen: 15,
  /** The blend's sharpness: weights are barycentric shares to this power. */
  sharpness: 4,
  /** The hash's seed for the cells' offsets. */
  seed: 7,
  /** The default cloud texture's mean (size 256, seed 1), held by a test. */
  textureMean: 0.38056030273436114,
} as const;

function requireCells(cellsPerTile: number): void {
  if (!(Number.isInteger(cellsPerTile) && cellsPerTile > 0)) {
    throw new RangeError(
      `cells per tile must be a positive integer, got ${cellsPerTile}`
    );
  }
}

/**
 * The tiles after which the hex-tiled field repeats, in both axes: the
 * smallest N with N x cellsPerTile x aspectDen / aspectNum an even integer
 * (the period's second lattice vector is m a2 - (m / 2) a1, m that
 * quotient). RangeError for a cell count that is not a positive integer.
 */
export function hexPeriodTiles(cellsPerTile: number): number {
  requireCells(cellsPerTile);
  const { aspectNum, aspectDen } = CLOUD_HEX;
  for (let n = 1; ; n++) {
    const rows = n * cellsPerTile * aspectDen;
    if (rows % aspectNum === 0 && (rows / aspectNum) % 2 === 0) return n;
  }
}

/** The three cells around a point and their barycentric shares. */
export interface HexCorners {
  readonly cells: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ];
  readonly weights: readonly [number, number, number];
}

/**
 * The three cell centres around (u, v) (tiles) on the lattice a1 = (s, 0),
 * a2 = (s / 2, s q), s = 1 / cellsPerTile, as cell indices, with the
 * point's barycentric shares in their triangle.
 */
export function hexCorners(
  u: number,
  v: number,
  cellsPerTile: number = CLOUD_HEX.cellsPerTile
): HexCorners {
  const { aspectNum, aspectDen } = CLOUD_HEX;
  const jf = (v * cellsPerTile * aspectDen) / aspectNum;
  const if_ = u * cellsPerTile - jf / 2;
  const i0 = Math.floor(if_);
  const j0 = Math.floor(jf);
  const fi = if_ - i0;
  const fj = jf - j0;
  if (fi + fj < 1) {
    return {
      cells: [
        [i0, j0],
        [i0 + 1, j0],
        [i0, j0 + 1],
      ],
      weights: [1 - fi - fj, fi, fj],
    };
  }
  return {
    cells: [
      [i0 + 1, j0 + 1],
      [i0, j0 + 1],
      [i0 + 1, j0],
    ],
    weights: [fi + fj - 1, 1 - fi, 1 - fj],
  };
}

/**
 * A uint32 hash of a cell, in [0, 1): integer multiplications that wrap at
 * 2^32 (`Math.imul`), so the shader's uint arithmetic gives the same bits.
 */
function cellHash(i: number, j: number, salt: number): number {
  let h =
    (Math.imul(i, 374761393) +
      Math.imul(j, 668265263) +
      Math.imul(salt, 2246822519 | 0)) |
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * A cell's texture offset, in [0, 1)^2, the same for every cell one period
 * apart: the cell is reduced along the period's skewed second vector first
 * (k = floor(j / m), j -= m k, i += (m / 2) k), then modulo N x cells in i.
 */
export function hexCellOffset(
  i: number,
  j: number,
  cellsPerTile: number = CLOUD_HEX.cellsPerTile,
  seed: number = CLOUD_HEX.seed
): [number, number] {
  const n = hexPeriodTiles(cellsPerTile);
  const m = (n * cellsPerTile * CLOUD_HEX.aspectDen) / CLOUD_HEX.aspectNum;
  const p = n * cellsPerTile;
  const k = Math.floor(j / m);
  const jr = j - m * k;
  const ir = (((i + (m / 2) * k) % p) + p) % p;
  return [cellHash(ir, jr, seed), cellHash(ir, jr, seed + 1)];
}

/**
 * The hex-tiled texture at (u, v) (tiles): the three cells around the
 * point, each read at its own offset, blended with sharpened barycentric
 * weights so that the mean and the contrast stay the texture's
 * (variance-preserving, Heitz and Neyret 2018): mean + sum(w (x - mean)) /
 * sqrt(sum(w^2)). `mean` is the texture's mean. RangeError for coordinates
 * that are not finite.
 */
export function hexTiledSample(
  sample: (u: number, v: number) => number,
  u: number,
  v: number,
  mean: number,
  options: {
    readonly cellsPerTile?: number;
    readonly sharpness?: number;
    readonly seed?: number;
  } = {}
): number {
  if (!(Number.isFinite(u) && Number.isFinite(v))) {
    throw new RangeError(`hex coordinates must be finite, got ${u}, ${v}`);
  }
  const cellsPerTile = options.cellsPerTile ?? CLOUD_HEX.cellsPerTile;
  const sharpness = options.sharpness ?? CLOUD_HEX.sharpness;
  const seed = options.seed ?? CLOUD_HEX.seed;
  const { cells, weights } = hexCorners(u, v, cellsPerTile);
  let total = 0;
  const w = weights.map((b) => {
    const x = Math.max(0, b) ** sharpness;
    total += x;
    return x;
  });
  let blend = 0;
  let squares = 0;
  for (let c = 0; c < 3; c++) {
    const [i, j] = cells[c] ?? [0, 0];
    const share = (w[c] ?? 0) / total;
    const [ou, ov] = hexCellOffset(i, j, cellsPerTile, seed);
    blend += share * (sample(u + ou, v + ov) - mean);
    squares += share * share;
  }
  return mean + blend / Math.sqrt(squares);
}

/**
 * The cover thresholds of a hex-tiled field, for `covers` (default k / 32,
 * k = 0..32; +Infinity at cover 0, as `cloudThresholdForCover`): the
 * (1 - cover) quantiles of `field` (the whole two-octave noise,
 * `cloudNoiseSample` with `hex`) sampled on a `grid` x `grid` lattice
 * over one period.
 */
export function hexCoverThresholds(
  field: (u: number, v: number) => number,
  options: {
    readonly cellsPerTile?: number;
    readonly grid?: number;
    readonly covers?: readonly number[];
  } = {}
): number[] {
  const cellsPerTile = options.cellsPerTile ?? CLOUD_HEX.cellsPerTile;
  const grid = options.grid ?? 384;
  const span = hexPeriodTiles(cellsPerTile);
  const values = new Float64Array(grid * grid);
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      values[y * grid + x] = field(
        ((x + 0.5) / grid) * span,
        ((y + 0.5) / grid) * span
      );
    }
  }
  values.sort();
  const n = values.length;
  const covers = options.covers ?? Array.from({ length: 33 }, (_, k) => k / 32);
  return covers.map((cover) =>
    cover === 0
      ? Number.POSITIVE_INFINITY
      : (values[Math.min(n - 1, Math.floor((1 - cover) * n))] ?? 0)
  );
}

/**
 * `hexCoverThresholds` for the default texture and lattice, precomputed
 * (1.8 s on a desktop under load: a live switch must not pay it on a
 * phone). Held to the computation by a test.
 */
export const HEX_COVER_THRESHOLDS: readonly number[] = [
  Number.POSITIVE_INFINITY,
  0.70488909,
  0.655234,
  0.62136329,
  0.59441875,
  0.57076282,
  0.54924401,
  0.52941242,
  0.51081341,
  0.4931875,
  0.47627174,
  0.4602472,
  0.4443601,
  0.4291393,
  0.41374947,
  0.39843332,
  0.38334305,
  0.36789507,
  0.35221581,
  0.3360697,
  0.31984787,
  0.30328881,
  0.28592546,
  0.26796592,
  0.24912249,
  0.23024805,
  0.21035123,
  0.18875592,
  0.16442637,
  0.13658938,
  0.10444068,
  0.0594675,
  -0.14282819,
];

/**
 * The low tail of `HEX_COVER_THRESHOLDS`: covers k / 512, k = 1..16 (the
 * last is the table's 1 / 32), precomputed the same way. Without it every
 * cover below 1 / 32 drew 3.1 % cloud (H1/H2 milestone review, finding 1).
 */
export const HEX_COVER_LOW_TAIL: readonly number[] = [
  0.84599852, 0.81442589, 0.79500617, 0.78004449, 0.76973467, 0.75980875,
  0.75216521, 0.74518773, 0.73857591, 0.73348456, 0.72811758, 0.72266471,
  0.71743595, 0.71265426, 0.70871594, 0.70488909,
];

/** The table's finite entries: covers 1/32, 2/32 .. 1. */
const HEX_COVER_FINITE = HEX_COVER_THRESHOLDS.slice(1);

/**
 * `table` read linearly at index `x`, held at its first and last entry
 * outside them.
 */
function heldLerp(table: readonly number[], x: number): number {
  const i = Math.min(Math.max(Math.floor(x), 0), table.length - 2);
  const f = Math.min(Math.max(x - i, 0), 1);
  const a = table[i] ?? 0;
  return a + ((table[i + 1] ?? a) - a) * f;
}

/**
 * The hex field's threshold for `cover` (0-1), linear between the table's
 * covers, and below 1 / 32 between the low tail's (a cover under 1 / 512
 * takes the tail's first); +Infinity at 0 (a clear sky). RangeError for a
 * cover outside [0, 1].
 */
export function hexCloudThreshold(cover: number): number {
  if (!(Number.isFinite(cover) && cover >= 0 && cover <= 1)) {
    throw new RangeError(`cloud cover must be in [0, 1], got ${cover}`);
  }
  if (cover === 0) return Number.POSITIVE_INFINITY;
  return cover < 1 / 32
    ? heldLerp(HEX_COVER_LOW_TAIL, cover * 512 - 1)
    : heldLerp(HEX_COVER_FINITE, cover * 32 - 1);
}

/**
 * Where the clouds' noise repeats, in tiles: the hex-tiled field's period
 * (a multiple of the plain texture's one tile, so right for both). Every
 * wrap of the drift offset is at this, never at one tile.
 */
export const CLOUD_NOISE_PERIOD_TILES = hexPeriodTiles(CLOUD_HEX.cellsPerTile);
const HEX_ROWS =
  (CLOUD_NOISE_PERIOD_TILES * CLOUD_HEX.cellsPerTile * CLOUD_HEX.aspectDen) /
  CLOUD_HEX.aspectNum;

/**
 * The shader twin of `hexTiledSample` (GLSL ES 3.00: uint arithmetic and
 * `textureGrad`), self-contained and include-guarded, so every cloud
 * consumer (the sky, the slab, the shadow's patch in three's lit
 * materials) takes the same one:
 * - `atmCloudHexGrad(tex, uv, dx, dy, mean)`: three reads with the
 *   gradients of the CONTINUOUS uv. The cells' offsets jump at their edges,
 *   so implicit derivatives there picked the coarsest level and drew the
 *   lattice as a line (cold review finding 1). The consumers take the
 *   gradients where they read, as their implicit reads did: the shadow
 *   inside its coverage branch, the sheet after its discard; where those
 *   are non-uniform the cloud's density is about 0, so no visible effect
 *   (the H1/H2 milestone review, finding 6).
 * - `atmCloudHexLod(tex, uv, lod, mean)`: three reads at an explicit level,
 *   for a march (implicit derivatives are undefined in its loop).
 */
export const CLOUD_HEX_GLSL = /* glsl */ `
#ifndef ATM_CLOUD_HEX_GLSL
#define ATM_CLOUD_HEX_GLSL
const float ATM_HEX_CELLS = ${glslFloat(CLOUD_HEX.cellsPerTile)};
const float ATM_HEX_ROW_SCALE = ${glslFloat((CLOUD_HEX.cellsPerTile * CLOUD_HEX.aspectDen) / CLOUD_HEX.aspectNum)};
const int ATM_HEX_ROWS = ${HEX_ROWS};
const int ATM_HEX_COLUMNS = ${CLOUD_NOISE_PERIOD_TILES * CLOUD_HEX.cellsPerTile};
const float ATM_HEX_SHARPNESS = ${glslFloat(CLOUD_HEX.sharpness)};
const uint ATM_HEX_SEED = ${CLOUD_HEX.seed}u;

// Twin of cloud-hex.ts cellHash: uint32 arithmetic, the same bits.
float atmCloudHexHash(int i, int j, uint salt) {
  uint h = uint(i) * 374761393u + uint(j) * 668265263u + salt * 2246822519u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h ^= h >> 16u;
  return float(h) / 4294967296.0;
}

// Twin of hexCellOffset: reduced along the period's skewed second vector,
// then modulo the period's columns (floor division: GLSL's % on a negative
// int is undefined). The +0.5 keeps the floor exact for whole numbers under
// the GPU's division error (up to 2.5 ulp, often a reciprocal multiply): at
// a multiple of the period a 1 ulp low quotient floored one row or column
// down, and a cell popped at the drift's wrap.
vec2 atmCloudHexOffset(int i, int j) {
  int k = int(floor((float(j) + 0.5) / float(ATM_HEX_ROWS)));
  int jr = j - ATM_HEX_ROWS * k;
  int ii = i + (ATM_HEX_ROWS / 2) * k;
  int ir = ii - ATM_HEX_COLUMNS * int(floor((float(ii) + 0.5) / float(ATM_HEX_COLUMNS)));
  return vec2(atmCloudHexHash(ir, jr, ATM_HEX_SEED), atmCloudHexHash(ir, jr, ATM_HEX_SEED + 1u));
}

// Twin of hexCorners: the triangle's three cells and the point's shares.
void atmCloudHexCorners(vec2 uv, out ivec2 c0, out ivec2 c1, out ivec2 c2, out vec3 w) {
  float jf = uv.y * ATM_HEX_ROW_SCALE;
  vec2 g = vec2(uv.x * ATM_HEX_CELLS - 0.5 * jf, jf);
  vec2 base = floor(g);
  vec2 f = g - base;
  ivec2 b = ivec2(base);
  if (f.x + f.y < 1.0) {
    c0 = b; c1 = b + ivec2(1, 0); c2 = b + ivec2(0, 1);
    w = vec3(1.0 - f.x - f.y, f.x, f.y);
  } else {
    c0 = b + ivec2(1, 1); c1 = b + ivec2(0, 1); c2 = b + ivec2(1, 0);
    w = vec3(f.x + f.y - 1.0, 1.0 - f.x, 1.0 - f.y);
  }
}

// The variance-preserving blend of hexTiledSample.
float atmCloudHexBlend(vec3 x, vec3 w, float mean) {
  w = pow(max(w, vec3(0.0)), vec3(ATM_HEX_SHARPNESS));
  w /= w.x + w.y + w.z;
  return mean + dot(w, x - mean) / sqrt(dot(w, w));
}

float atmCloudHexGrad(sampler2D tex, vec2 uv, vec2 dx, vec2 dy, float mean) {
  ivec2 c0; ivec2 c1; ivec2 c2; vec3 w;
  atmCloudHexCorners(uv, c0, c1, c2, w);
  vec3 x = vec3(
    textureGrad(tex, uv + atmCloudHexOffset(c0.x, c0.y), dx, dy).r,
    textureGrad(tex, uv + atmCloudHexOffset(c1.x, c1.y), dx, dy).r,
    textureGrad(tex, uv + atmCloudHexOffset(c2.x, c2.y), dx, dy).r);
  return atmCloudHexBlend(x, w, mean);
}

float atmCloudHexLod(sampler2D tex, vec2 uv, float lod, float mean) {
  ivec2 c0; ivec2 c1; ivec2 c2; vec3 w;
  atmCloudHexCorners(uv, c0, c1, c2, w);
  vec3 x = vec3(
    textureLod(tex, uv + atmCloudHexOffset(c0.x, c0.y), lod).r,
    textureLod(tex, uv + atmCloudHexOffset(c1.x, c1.y), lod).r,
    textureLod(tex, uv + atmCloudHexOffset(c2.x, c2.y), lod).r);
  return atmCloudHexBlend(x, w, mean);
}
#endif
`;
