/**
 * Why this file matters: the hex-tiled cloud octave (hex-tiling plan
 * 2026-10-07-0919, H1) must break the 24 km repeat the owner saw, without a
 * seam and without breaking the wind's drift. The drift can still wrap only
 * because the field repeats at N tiles: the period rule, the lattice's
 * skewed reduction and the blend are each held here, on the real noise
 * where it matters.
 */
import { describe, expect, it } from 'vitest';

import {
  CLOUD_HEX,
  CLOUD_HEX_GLSL,
  HEX_COVER_LOW_TAIL,
  HEX_COVER_THRESHOLDS,
  hexCellOffset,
  hexCloudThreshold,
  hexCoverThresholds,
  hexCorners,
  hexPeriodTiles,
  hexTiledSample,
} from './cloud-hex.js';
import { CLOUD_LAYER, cloudNoise, cloudNoiseSample } from './cloud-layer.js';

const SIZE = 256;
const data = cloudNoise(SIZE, 1);
/** The texture once (one octave), bilinear between texel centres, wrapped. */
const texture = (u: number, v: number) => {
  const x = u * SIZE - 0.5;
  const y = v * SIZE - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const wrap = (i: number) => ((i % SIZE) + SIZE) % SIZE;
  const at = (i: number, j: number) =>
    (data[wrap(j) * SIZE + wrap(i)] ?? 0) / 255;
  const fx = x - x0;
  const fy = y - y0;
  const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
  const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
  return a + (b - a) * fy;
};
let sum = 0;
for (const value of data) sum += value / 255;
const MEAN = sum / data.length;

function correlation(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    const da = (a[i] ?? 0) - ma;
    const db = (b[i] ?? 0) - mb;
    ab += da * db;
    aa += da * da;
    bb += db * db;
  }
  return ab / Math.sqrt(aa * bb);
}

/** A grid of points over a few tiles, off the texel centres. */
function grid(n: number, span: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      points.push([((x + 0.37) / n) * span, ((y + 0.61) / n) * span]);
    }
  }
  return points;
}

describe('hexPeriodTiles', () => {
  // The lattice rows step by s x q, q = 13/15 (a hexagon's sqrt(3)/2 within
  // 0.08 %): the field repeats where both N/s and N/(s q) are whole, the
  // latter even (the period's second vector is m a2 - (m/2) a1).
  it('finds the smallest period for each cell size', () => {
    expect(hexPeriodTiles(2)).toBe(13);
    expect(hexPeriodTiles(1)).toBe(26);
    expect(hexPeriodTiles(3)).toBe(26);
    expect(hexPeriodTiles(CLOUD_HEX.cellsPerTile)).toBe(13);
  });

  it('rejects a cell count that is not a positive integer', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => hexPeriodTiles(bad), String(bad)).toThrow(RangeError);
    }
  });
});

describe('hexCorners', () => {
  it('gives three corners whose weights are non-negative and sum to 1', () => {
    for (const [u, v] of grid(40, 3.3)) {
      const { weights } = hexCorners(u, v, CLOUD_HEX.cellsPerTile);
      const total = weights.reduce((s, w) => s + w, 0);
      expect(total).toBeCloseTo(1, 12);
      for (const w of weights) expect(w).toBeGreaterThanOrEqual(-1e-12);
    }
  });
});

describe('hexCellOffset', () => {
  // WHY (cold review finding 2): in cell indices the period is spanned by
  // (N k, 0) and (-m/2, m), (26, 0) and (-15, 30) for k = 2; an independent
  // "i mod 26, j mod 30" is not periodic in y.
  it('repeats along both lattice vectors of the period', () => {
    for (const k of [1, 2, 3]) {
      const n = hexPeriodTiles(k);
      const m = (n * k * CLOUD_HEX.aspectDen) / CLOUD_HEX.aspectNum;
      for (let i = -40; i < 40; i += 7) {
        for (let j = -40; j < 40; j += 5) {
          const at = hexCellOffset(i, j, k);
          expect(hexCellOffset(i + n * k, j, k), `${k}: ${i},${j} x`).toEqual(
            at
          );
          expect(
            hexCellOffset(i - m / 2, j + m, k),
            `${k}: ${i},${j} y`
          ).toEqual(at);
        }
      }
    }
  });

  it('spreads its offsets over the tile', () => {
    let low = 0;
    for (let i = 0; i < 26; i++) {
      for (let j = 0; j < 30; j++) {
        const [ou, ov] = hexCellOffset(i, j, 2);
        expect(ou).toBeGreaterThanOrEqual(0);
        expect(ou).toBeLessThan(1);
        expect(ov).toBeGreaterThanOrEqual(0);
        expect(ov).toBeLessThan(1);
        if (ou < 0.5) low += 1;
      }
    }
    expect(low / (26 * 30)).toBeGreaterThan(0.4);
    expect(low / (26 * 30)).toBeLessThan(0.6);
  });
});

describe('hexTiledSample', () => {
  // The drift can wrap at N only if the whole field repeats there, in both
  // axes (the cold review's sim: 0 error with the skewed reduction).
  it('repeats at N tiles in both axes', () => {
    for (const k of [1, 2, 3]) {
      const n = hexPeriodTiles(k);
      for (const [u, v] of grid(12, 2.7)) {
        const at = hexTiledSample(texture, u, v, MEAN, { cellsPerTile: k });
        expect(
          hexTiledSample(texture, u + n, v, MEAN, { cellsPerTile: k })
        ).toBeCloseTo(at, 9);
        expect(
          hexTiledSample(texture, u, v + n, MEAN, { cellsPerTile: k })
        ).toBeCloseTo(at, 9);
      }
    }
  });

  // The repeat the owner saw: today's field equals itself one tile on
  // (correlation 1). Swept over the cell sizes the plan allows.
  it('no longer repeats at one tile', () => {
    for (const k of [1, 2, 3]) {
      const points = grid(48, 4);
      const here = points.map(([u, v]) =>
        hexTiledSample(texture, u, v, MEAN, { cellsPerTile: k })
      );
      const right = points.map(([u, v]) =>
        hexTiledSample(texture, u + 1, v, MEAN, { cellsPerTile: k })
      );
      const up = points.map(([u, v]) =>
        hexTiledSample(texture, u, v + 1, MEAN, { cellsPerTile: k })
      );
      expect(correlation(here, right), `${k} x`).toBeLessThan(0.4);
      expect(correlation(here, up), `${k} y`).toBeLessThan(0.4);
    }
    const plain = grid(48, 4).map(([u, v]) => texture(u, v));
    const shifted = grid(48, 4).map(([u, v]) => texture(u + 1, v));
    expect(correlation(plain, shifted)).toBeCloseTo(1, 9);
  });

  // The cover's threshold reads the field's distribution: the blend keeps
  // its mean and its contrast (variance-preserving, DEC-HX-5).
  it('keeps the mean and the contrast of the texture', () => {
    const points = grid(120, 6);
    const plain = points.map(([u, v]) => texture(u, v));
    const hex = points.map(([u, v]) => hexTiledSample(texture, u, v, MEAN));
    const stats = (xs: number[]) => {
      const m = xs.reduce((s, x) => s + x, 0) / xs.length;
      const sd = Math.sqrt(
        xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length
      );
      return { m, sd };
    };
    const a = stats(plain);
    const b = stats(hex);
    expect(Math.abs(b.m - a.m)).toBeLessThan(0.02);
    expect(Math.abs(b.sd / a.sd - 1)).toBeLessThan(0.08);
  });

  it('keeps a constant texture constant, whatever the offsets', () => {
    for (const [u, v] of grid(10, 2)) {
      expect(hexTiledSample(() => 0.42, u, v, 0.42)).toBeCloseTo(0.42, 12);
    }
  });

  it('rejects coordinates that are not finite', () => {
    expect(() => hexTiledSample(texture, Number.NaN, 0, MEAN)).toThrow(
      RangeError
    );
    expect(() => hexTiledSample(texture, 0, Infinity, MEAN)).toThrow(
      RangeError
    );
  });
});

describe('the cover of the hex field', () => {
  // WHY (cold review finding 5, measured 2026-10-08): today's thresholds on
  // the hex field gave 2.2-3.4 % too much cloud, worst near 0.69 cover. With
  // hex on, the field's own thresholds are used: a constant, so a live flip
  // costs no sort on a phone, held here to the computation.
  it('holds the texture mean and its constant table to the computation', () => {
    expect(CLOUD_HEX.textureMean).toBeCloseTo(MEAN, 6);
    const computed = hexCoverThresholds((u, v) =>
      cloudNoiseSample(data, SIZE, u, v, { hex: true })
    );
    expect(computed.length).toBe(33);
    expect(HEX_COVER_THRESHOLDS.length).toBe(33);
    expect(HEX_COVER_THRESHOLDS[0]).toBe(Number.POSITIVE_INFINITY);
    for (let k = 1; k <= 32; k++) {
      expect(HEX_COVER_THRESHOLDS[k], String(k)).toBeCloseTo(
        computed[k] ?? 0,
        6
      );
    }
  });

  // Measured on points the table was not computed from (another grid,
  // another stretch of the field), tails included (the coverage table
  // spans k / 32 for k = 0..32).
  it('gives the hex field the cover asked for, all the way along', () => {
    const c = CLOUD_LAYER;
    const field = grid(220, 13).map(([u, v]) => {
      const a = u + 0.123;
      const b = v + 0.457;
      return (
        c.firstOctaveWeight * hexTiledSample(texture, a, b, MEAN) +
        (1 - c.firstOctaveWeight) *
          texture(
            a * c.secondOctaveFrequency + c.secondOctaveOffset,
            b * c.secondOctaveFrequency + c.secondOctaveOffset
          )
      );
    });
    const worst: string[] = [];
    for (let k = 1; k < 32; k++) {
      const cover = k / 32;
      const t = hexCloudThreshold(cover);
      const share = field.filter((x) => x > t).length / field.length;
      if (Math.abs(share - cover) > 0.006) {
        worst.push(`${cover.toFixed(3)}: ${share.toFixed(4)}`);
      }
    }
    expect(worst).toEqual([]);
    expect(hexCloudThreshold(0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('interpolates between the covers of its table, falling as the cover rises', () => {
    let last = Number.POSITIVE_INFINITY;
    for (let i = 1; i <= 200; i++) {
      const t = hexCloudThreshold(i / 200);
      expect(t).toBeLessThanOrEqual(last);
      last = t;
    }
    expect(hexCloudThreshold(0.5)).toBeCloseTo(
      HEX_COVER_THRESHOLDS[16] ?? 0,
      12
    );
    expect(() => hexCloudThreshold(1.5)).toThrow(RangeError);
    expect(() => hexCloudThreshold(Number.NaN)).toThrow(RangeError);
  });
});

describe('the hex field’s small covers', () => {
  // WHY (H1/H2 milestone review, finding 1): the table steps by 1/32, and
  // below its first finite entry every cover drew 3.1 % cloud (a 1 % sky
  // drew three times that). A tail at 1/512 steps holds small covers,
  // precomputed like the table and held to the computation.
  const field = (u: number, v: number) =>
    cloudNoiseSample(data, SIZE, u, v, { hex: true });

  it('holds its low tail to the computation', () => {
    const covers = Array.from({ length: 16 }, (_, k) => (k + 1) / 512);
    const computed = hexCoverThresholds(field, { covers });
    expect(HEX_COVER_LOW_TAIL).toHaveLength(16);
    for (let k = 0; k < 16; k++) {
      expect(HEX_COVER_LOW_TAIL[k], String(k)).toBeCloseTo(computed[k] ?? 0, 6);
    }
    expect(HEX_COVER_LOW_TAIL[15]).toBeCloseTo(HEX_COVER_THRESHOLDS[1] ?? 0, 6);
  });

  it('draws small covers as asked, on points the tail was not computed from', () => {
    const values = grid(220, 13).map(([u, v]) => field(u + 0.123, v + 0.457));
    const worst: string[] = [];
    for (const cover of [0.002, 0.005, 0.01, 0.015, 0.02, 0.025, 0.03]) {
      const t = hexCloudThreshold(cover);
      const share = values.filter((x) => x > t).length / values.length;
      if (Math.abs(share - cover) > 0.002) {
        worst.push(`${cover}: ${share.toFixed(4)}`);
      }
    }
    expect(worst).toEqual([]);
  });
});

describe('CLOUD_HEX_GLSL', () => {
  // The shader twin cannot run here (no WebGL): its readback against
  // hexTiledSample is the browser check (plan H2). What a string can hold:
  // one guarded copy, the TS twin's constants, three reads per variant
  // (with explicit gradients or levels, never implicit: cold review
  // finding 1), and the uint hash (never fract(sin), which differs by GPU).
  it('carries the lattice of the twin and reads explicitly', () => {
    expect(CLOUD_HEX_GLSL).toContain('#ifndef ATM_CLOUD_HEX_GLSL');
    expect(CLOUD_HEX_GLSL).toContain('const int ATM_HEX_ROWS = 30;');
    expect(CLOUD_HEX_GLSL).toContain('const int ATM_HEX_COLUMNS = 26;');
    expect(CLOUD_HEX_GLSL).toContain(
      `const uint ATM_HEX_SEED = ${CLOUD_HEX.seed}u;`
    );
    expect(CLOUD_HEX_GLSL.match(/textureGrad\(/g)?.length).toBe(3);
    expect(CLOUD_HEX_GLSL.match(/textureLod\(/g)?.length).toBe(3);
    expect(CLOUD_HEX_GLSL).not.toMatch(/texture2D\(|texture\(/);
    expect(CLOUD_HEX_GLSL).not.toMatch(/fract\(\s*sin/);
    // Floor division robust to the GPU's division error (H1/H2 milestone
    // review, finding 3: a reciprocal 1 ulp off floors every multiple of
    // the period wrongly, and a cell pops at the wrap).
    expect(CLOUD_HEX_GLSL).toContain('(float(j) + 0.5) / float(ATM_HEX_ROWS)');
    expect(CLOUD_HEX_GLSL).toContain(
      '(float(ii) + 0.5) / float(ATM_HEX_COLUMNS)'
    );
  });
});
