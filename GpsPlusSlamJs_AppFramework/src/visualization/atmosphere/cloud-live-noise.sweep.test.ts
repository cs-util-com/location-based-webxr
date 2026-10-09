/**
 * Why this test matters: "you must never be able to recognise a repeating
 * pattern" (the owner, 2026-10-08). This is the measure behind the claim
 * that the live noise does not repeat (round-3 plan 2026-10-08-2345, N1):
 * the largest normalised correlation between a window of the thresholded
 * cloud density and the same field shifted by any amount from `minShiftKm`
 * up to `maxShiftKm` in every direction (a half plane suffices: the measure
 * is symmetric), against a NULL field that never repeats (the same octaves
 * with hashed lattice values, no texture). The baked tile repeats exactly
 * at 24 km and the hex-tiled field at 312 km: both read about 1. The live
 * field must read at the null's level.
 *
 * The fast form runs in every gate (shifts to 340 km on a 2.4 km grid, a 72 km window). The full sweep
 * (shifts to 3,000 km, the lattice 256 / 1,024 / 2,048, 3-7 octaves, gain
 * 0.45-0.65, windows 48-192 km, covers 0.3-1.0) runs with `SWEEP=1` and
 * writes its table to `SWEEP_OUT` (a JSON file), because it takes
 * about 2.5 hours on a loaded laptop (measured 2026-10-09: 9,400 s):
 *   SWEEP=1 SWEEP_OUT=<file> pnpm run test:unit src/visualization/atmosphere/cloud-live-noise.sweep.test.ts
 *
 * The parameters every verdict rests on are declared (the owner's rule,
 * 2026-09-13): the grid spacing 1.6 km (24 and 312 km are whole samples),
 * the window, the shift range, the cover and the field's own options.
 */
import { writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

import { cloudDensity, cloudNoise, cloudNoiseSample } from './cloud-layer.js';
import {
  type CloudLiveOptions,
  cloudLiveBasis,
  cloudLiveOctaves,
  cloudLiveSample,
} from './cloud-live-noise.js';

/** The FFT's bit-reversed reordering of the first n values, in place. */
function bitReverse(re: Float64Array, im: Float64Array, n: number): void {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
}

/** In-place radix-2 complex FFT of `n` values at `stride` from `offset`. */
function fft1(
  re: Float64Array,
  im: Float64Array,
  offset: number,
  stride: number,
  n: number,
  inverse: boolean,
  bufRe: Float64Array,
  bufIm: Float64Array
): void {
  for (let i = 0; i < n; i++) {
    bufRe[i] = re[offset + i * stride]!;
    bufIm[i] = im[offset + i * stride]!;
  }
  bitReverse(bufRe, bufIm, n);
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = bufRe[b]! * cr - bufIm[b]! * ci;
        const xi = bufRe[b]! * ci + bufIm[b]! * cr;
        bufRe[b] = bufRe[a]! - xr;
        bufIm[b] = bufIm[a]! - xi;
        bufRe[a] = bufRe[a]! + xr;
        bufIm[a] = bufIm[a]! + xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  const scale = inverse ? 1 / n : 1;
  for (let i = 0; i < n; i++) {
    re[offset + i * stride] = bufRe[i]! * scale;
    im[offset + i * stride] = bufIm[i]! * scale;
  }
}

/** 2D FFT of a `w` x `h` row-major complex array (both powers of two). */
function fft2(
  re: Float64Array,
  im: Float64Array,
  w: number,
  h: number,
  inverse: boolean
): void {
  const n = Math.max(w, h);
  const bufRe = new Float64Array(n);
  const bufIm = new Float64Array(n);
  for (let y = 0; y < h; y++) fft1(re, im, y * w, 1, w, inverse, bufRe, bufIm);
  for (let x = 0; x < w; x++) fft1(re, im, x, w, h, inverse, bufRe, bufIm);
}

const pow2 = (n: number) => 2 ** Math.ceil(Math.log2(n));

/** A field on the plane, km in, a noise value out. */
type Field = (xKm: number, yKm: number) => number;

interface Measure {
  /** The largest correlation over the shifts allowed. */
  readonly max: number;
  /** Where it was, km. */
  readonly atKm: readonly [number, number];
}

/**
 * The largest normalised cross-correlation between the window of
 * `windowKm` at the region's left edge, middle row, and every shift of it
 * by `minShiftKm`-`maxShiftKm` with a non-negative x (the half plane), for
 * each transform of the field (`views`: a density at a cover, or the raw
 * field). One field evaluation, one FFT of the region a view.
 */
function largestCorrelations(
  field: Field,
  views: readonly ((values: Float64Array) => Float64Array)[],
  {
    gridKm,
    windowKm,
    maxShiftKm,
    minShiftKm,
  }: {
    gridKm: number;
    windowKm: number;
    maxShiftKm: number;
    minShiftKm: number;
  }
): Measure[] {
  const win = Math.round(windowKm / gridKm);
  const reach = Math.round(maxShiftKm / gridKm);
  const w = pow2(reach + win);
  const h = pow2(2 * reach + win);
  const y0 = Math.floor((h - win) / 2);
  const raw = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) raw[y * w + x] = field(x * gridKm, y * gridKm);
  }
  const region: Region = {
    w,
    h,
    win,
    y0,
    minShift: minShiftKm / gridKm,
    reach,
    gridKm,
  };
  return views.map((view) => bestShift(view(raw), region));
}

/** The region's geometry in samples: its size, the window and the shifts. */
interface Region {
  readonly w: number;
  readonly h: number;
  readonly win: number;
  readonly y0: number;
  readonly minShift: number;
  readonly reach: number;
  readonly gridKm: number;
}

/**
 * The window sums of `image` (or of its square) at every place, from a
 * summed-area table.
 */
function windowSums(
  image: Float64Array,
  { w, h, win }: Region,
  square: boolean
) {
  const t = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      const v = image[y * w + x]!;
      row += square ? v * v : v;
      t[(y + 1) * (w + 1) + x + 1] = t[y * (w + 1) + x + 1]! + row;
    }
  }
  return (x: number, y: number) =>
    t[(y + win) * (w + 1) + x + win]! -
    t[y * (w + 1) + x + win]! -
    t[(y + win) * (w + 1) + x]! +
    t[y * (w + 1) + x]!;
}

/**
 * The window (zero-mean) correlated with the image at every shift, by FFT:
 * corr[s] = sum K[x] I[x + s] = IFFT(conj(F_K) F_I). Returns the
 * correlations and the window's squared norm.
 */
function windowCorrelation(
  image: Float64Array,
  { w, h, win, y0 }: Region,
  windowMean: number
) {
  const kRe = new Float64Array(w * h);
  const kIm = new Float64Array(w * h);
  let norm = 0;
  for (let y = 0; y < win; y++) {
    for (let x = 0; x < win; x++) {
      const d = image[(y0 + y) * w + x]! - windowMean;
      kRe[y * w + x] = d;
      norm += d * d;
    }
  }
  const iRe = Float64Array.from(image);
  const iIm = new Float64Array(w * h);
  fft2(iRe, iIm, w, h, false);
  fft2(kRe, kIm, w, h, false);
  for (let i = 0; i < w * h; i++) {
    const ar = kRe[i]!;
    const ai = -kIm[i]!;
    kRe[i] = ar * iRe[i]! - ai * iIm[i]!;
    kIm[i] = ar * iIm[i]! + ai * iRe[i]!;
  }
  fft2(kRe, kIm, w, h, true);
  return { corr: kRe, norm };
}

/** The largest normalised correlation over the allowed shifts, and where. */
function bestShift(image: Float64Array, region: Region): Measure {
  const { w, h, win, y0, minShift, reach, gridKm } = region;
  const sum = windowSums(image, region, false);
  const sumSq = windowSums(image, region, true);
  const n = win * win;
  const { corr, norm } = windowCorrelation(image, region, sum(0, y0) / n);
  let best: Measure = { max: -1, atKm: [0, 0] };
  if (!(norm > 1e-9)) return best;
  for (let sy = 0; sy + win <= h; sy++) {
    for (let sx = 0; sx + win <= w; sx++) {
      const shift = Math.hypot(sx, sy - y0);
      if (shift < minShift || shift > reach) continue;
      const variance = sumSq(sx, sy) - sum(sx, sy) ** 2 / n;
      if (!(variance > 1e-9 * n)) continue;
      const r = corr[sy * w + sx]! / Math.sqrt(norm * variance);
      if (r > best.max) {
        best = { max: r, atKm: [sx * gridKm, (sy - y0) * gridKm] };
      }
    }
  }
  return best;
}

/** The field's own (1 - cover) quantile over `values`. */
function quantile(values: Float64Array, cover: number): number {
  const sorted = Float64Array.from(values).sort();
  return sorted[
    Math.min(sorted.length - 1, Math.floor((1 - cover) * sorted.length))
  ]!;
}

/** Views: the thresholded density at each cover (the field's own quantile), then the raw field. */
function densityViews(covers: readonly number[]) {
  return [
    ...covers.map((cover) => (values: Float64Array) => {
      const t = quantile(values, cover);
      return values.map((v) => cloudDensity(v, t));
    }),
    (values: Float64Array) => values,
  ];
}

const TILE_KM = 24;
const tileData = cloudNoise(256, 1);
const tileField: Field = (x, y) =>
  cloudNoiseSample(tileData, 256, x / TILE_KM, y / TILE_KM);
const hexField: Field = (x, y) =>
  cloudNoiseSample(tileData, 256, x / TILE_KM, y / TILE_KM, { hex: true });

/** The anchor every sweep reads from (a place away from 0, 0). */
const ANCHOR = { originKm: [2_345.6, -7_123.4] as const, rotationRad: 0.4 };

function liveField(options: CloudLiveOptions = {}): Field {
  const basis = cloudLiveBasis(ANCHOR, options);
  return (x, y) => cloudLiveSample(basis, x, y, 0, options);
}

/** A uint32 hash of an integer cell, never wrapped: a lattice with no period. */
function cellHash(i: number, j: number, salt: number): number {
  let h =
    (Math.imul(i, 374761393) +
      Math.imul(j, 668265263) +
      Math.imul(salt, 2246822519 | 0)) |
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 24) / 255;
}

/**
 * The null: the live field's octaves (cells, rotations, amplitudes) with
 * each lattice value hashed from its cell, so nothing ever repeats. Its
 * largest correlation is the level a window reaches by chance over this
 * many shifts.
 */
function nullField(options: CloudLiveOptions = {}): Field {
  const octaves = cloudLiveOctaves(options);
  const basis = cloudLiveBasis(ANCHOR, options);
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    let sum = 0;
    for (let k = 0; k < octaves.length; k++) {
      const a = basis[4 * k]!;
      const b = basis[4 * k + 1]!;
      const qx = a * x - b * y + basis[4 * k + 2]!;
      const qy = b * x + a * y + basis[4 * k + 3]!;
      const ix = Math.floor(qx);
      const iy = Math.floor(qy);
      const fx = fade(qx - ix);
      const fy = fade(qy - iy);
      const top =
        cellHash(ix, iy, k) +
        (cellHash(ix + 1, iy, k) - cellHash(ix, iy, k)) * fx;
      const bottom =
        cellHash(ix, iy + 1, k) +
        (cellHash(ix + 1, iy + 1, k) - cellHash(ix, iy + 1, k)) * fx;
      sum += octaves[k]!.amplitude * (top + (bottom - top) * fy - 0.5);
    }
    return sum;
  };
}

describe('the largest window correlation over shifts (fast form)', () => {
  const setting = {
    gridKm: 2.4,
    windowKm: 72,
    maxShiftKm: 340,
    minShiftKm: 18,
  };
  const covers = [0.3, 0.7];
  const views = densityViews(covers);
  const measure = (field: Field) => largestCorrelations(field, views, setting);
  let tile: Measure[] = [];
  let hex: Measure[] = [];
  let live: Measure[] = [];
  let none: Measure[] = [];
  beforeAll(() => {
    tile = measure(tileField);
    hex = measure(hexField);
    live = measure(liveField());
    none = measure(nullField());
    // About 4 s alone; a deadlock guard, not a performance bound.
  }, 120_000);

  // The tile repeats at 24 km, the hex field at 312 km: the measure finds
  // both (it is no measure if it cannot).
  it('finds the tile’s and the hex field’s repeats', () => {
    for (const m of tile) expect(m.max).toBeGreaterThan(0.95);
    for (const m of hex) expect(m.max).toBeGreaterThan(0.95);
    const [dx, dy] = hex[0]!.atKm;
    expect(Math.hypot(dx, dy)).toBeGreaterThan(290);
  });

  it('reads the live field at the level of a field that never repeats', () => {
    for (let i = 0; i < live.length; i++) {
      expect(live[i]!.max).toBeLessThan(none[i]!.max + 0.1);
      expect(live[i]!.max).toBeLessThan(0.8);
    }
  });
});

const SWEEP = process.env['SWEEP'] === '1';

describe.skipIf(!SWEEP)('the full repetition sweep (SWEEP=1)', () => {
  it('measures every mode and the live field across its parameters', () => {
    const setting = {
      gridKm: 1.6,
      windowKm: 96,
      maxShiftKm: 3_000,
      minShiftKm: 18,
    };
    const covers = [0.3, 0.5, 0.7, 1.0];
    const views = densityViews(covers);
    const labels = [...covers.map((c) => `cover ${c}`), 'raw'];
    const rows: Record<string, unknown>[] = [];
    const record = (name: string, measures: Measure[], extra = {}) => {
      rows.push({
        name,
        ...extra,
        ...Object.fromEntries(
          measures.map((m, i) => [
            labels[i]!,
            { max: +m.max.toFixed(3), atKm: m.atKm.map((v) => +v.toFixed(1)) },
          ])
        ),
      });
      writeFileSync(
        process.env['SWEEP_OUT'] ?? 'sweep.json',
        JSON.stringify(rows, null, 1)
      );
    };
    const run = (field: Field, s = setting) =>
      largestCorrelations(field, views, s);
    record('tile', run(tileField));
    record('hex', run(hexField));
    record('live', run(liveField()));
    record('null', run(nullField()));
    for (const windowKm of [48, 192]) {
      const s = { ...setting, windowKm };
      record('live', run(liveField(), s), { windowKm });
      record('null', run(nullField(), s), { windowKm });
    }
    for (const latticeSize of [256, 1024, 2048]) {
      for (const octaves of [3, 4, 5, 6, 7]) {
        for (const gain of [0.45, 0.5, 0.55, 0.65]) {
          const options = { latticeSize, octaves, gain };
          record('live', run(liveField(options)), options);
        }
      }
    }
    for (const octaves of [3, 5, 7]) {
      for (const gain of [0.45, 0.65]) {
        const options = { octaves, gain };
        record('null', run(nullField(options)), options);
      }
    }
    expect(rows.length).toBeGreaterThan(0);
  }, 14_400_000);
});
