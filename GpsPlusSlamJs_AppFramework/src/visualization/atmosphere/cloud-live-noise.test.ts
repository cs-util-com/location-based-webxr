/**
 * Why this file matters: the owner saw the volumetric clouds as "carpet
 * tiles that are all identical" (2026-10-08) and asked that a repeating
 * pattern must never be recognisable. The live noise (round-3 plan
 * 2026-10-08-2345, N1, DEC-R3-4) evaluates the clouds' value-noise fBm per
 * octave, each octave with its own rotation, lacunarity and anchor, from a
 * 1,024^2 lattice. These tests hold the parts a later change could quietly
 * break: the lattice, the octaves' periods, the anchoring that keeps the
 * shader's numbers small, the anti-aliasing fade, the cover's threshold
 * table and the shader text that mirrors the CPU twin.
 */
import { describe, expect, it } from 'vitest';

import { CLOUD_LAYER, cloudNoise, cloudNoiseSample } from './cloud-layer.js';
import {
  CLOUD_LIVE_COVER_LOW_TAIL,
  CLOUD_LIVE_COVER_THRESHOLDS,
  CLOUD_LIVE_NOISE,
  CLOUD_LIVE_NOISE_GLSL,
  cloudLiveBasis,
  cloudLiveCoverThresholds,
  cloudLiveLattice,
  cloudLiveOctaves,
  cloudLiveSample,
  createCloudLiveLatticeTexture,
  liveCloudThreshold,
} from './cloud-live-noise.js';

/** A seeded uniform PRNG (mulberry32): the samples are reproducible. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function correlation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    ab += da * db;
    aa += da * da;
    bb += db * db;
  }
  return ab / Math.sqrt(aa * bb);
}

const ORIGIN = { originKm: [0, 0] as const, rotationRad: 0 };

describe('cloudLiveLattice', () => {
  it('is size^2 bytes, deterministic and cached', () => {
    const a = cloudLiveLattice(64, 3);
    expect(a.length).toBe(64 * 64);
    expect(cloudLiveLattice(64, 3)).toBe(a);
    expect(Array.from(cloudLiveLattice(64, 4))).not.toEqual(Array.from(a));
  });

  it('spreads its values over the whole byte range, mean near the middle', () => {
    const data = cloudLiveLattice();
    let sum = 0;
    let min = 255;
    let max = 0;
    for (const v of data) {
      sum += v;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBe(0);
    expect(max).toBe(255);
    expect(sum / data.length / 255).toBeCloseTo(0.5, 2);
    // The shader's constant is the default lattice's own mean.
    expect(sum / data.length / 255).toBeCloseTo(
      CLOUD_LIVE_NOISE.latticeMean,
      9
    );
  });

  it('refuses a size that is not a power of two from 16 to 4,096', () => {
    expect(() => cloudLiveLattice(100)).toThrow(RangeError);
    expect(() => cloudLiveLattice(8)).toThrow(RangeError);
    expect(() => cloudLiveLattice(8192)).toThrow(RangeError);
  });
});

describe('cloudLiveOctaves', () => {
  it('starts at the baked tile’s 6 km cells and divides by the lacunarities', () => {
    const o = cloudLiveOctaves();
    expect(o).toHaveLength(7);
    expect(o[0]!.cellKm).toBe(CLOUD_LAYER.tileKm / 4);
    for (let k = 1; k < o.length; k++) {
      expect(o[k]!.cellKm).toBeCloseTo(
        o[k - 1]!.cellKm / CLOUD_LIVE_NOISE.lacunarities[k - 1]!,
        12
      );
    }
  });

  // The plan's periods (§6): each octave alone repeats at the lattice size
  // times its cell, and the largest shapes only every 6,144 km.
  it('repeats each octave alone at 6,144, 2,968, 1,507, 707 and 348 km', () => {
    const periods = cloudLiveOctaves().map((o) => o.cellKm * 1024);
    expect(periods.slice(0, 5).map(Math.round)).toEqual([
      6144, 2968, 1507, 707, 348,
    ]);
  });

  it('gives each octave its own rotation and amplitudes falling by the gain', () => {
    const o = cloudLiveOctaves();
    const angles = o.map(
      (x) => ((x.angleRad % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    );
    for (let i = 0; i < angles.length; i++) {
      for (let j = i + 1; j < angles.length; j++) {
        expect(Math.abs(angles[i]! - angles[j]!)).toBeGreaterThan(0.05);
      }
    }
    for (let k = 1; k < o.length; k++) {
      expect(o[k]!.amplitude / o[k - 1]!.amplitude).toBeCloseTo(0.5, 12);
    }
  });

  it('refuses octaves, gains and lacunarities out of range', () => {
    expect(() => cloudLiveOctaves({ octaves: 0 })).toThrow(RangeError);
    expect(() => cloudLiveOctaves({ octaves: 9 })).toThrow(RangeError);
    expect(() => cloudLiveOctaves({ gain: 1 })).toThrow(RangeError);
    expect(() => cloudLiveOctaves({ gain: 0 })).toThrow(RangeError);
    expect(() =>
      cloudLiveOctaves({ lacunarities: [1, 2, 2, 2, 2, 2, 2] })
    ).toThrow(RangeError);
    expect(() => cloudLiveOctaves({ lacunarities: [2] })).toThrow(RangeError);
  });
});

describe('cloudLiveBasis', () => {
  it('holds four numbers an octave, the offsets reduced into the lattice', () => {
    const basis = cloudLiveBasis({
      originKm: [12_345.6, -9_876.5],
      rotationRad: 0.7,
    });
    expect(basis).toHaveLength(4 * 7);
    for (let k = 0; k < 7; k++) {
      expect(basis[4 * k + 2]).toBeGreaterThanOrEqual(0);
      expect(basis[4 * k + 2]).toBeLessThan(1024);
      expect(basis[4 * k + 3]).toBeGreaterThanOrEqual(0);
      expect(basis[4 * k + 3]).toBeLessThan(1024);
    }
  });

  it('refuses an anchor that is not finite', () => {
    expect(() =>
      cloudLiveBasis({ originKm: [Number.NaN, 0], rotationRad: 0 })
    ).toThrow(RangeError);
    expect(() =>
      cloudLiveBasis({
        originKm: [0, 0],
        rotationRad: Number.POSITIVE_INFINITY,
      })
    ).toThrow(RangeError);
  });
});

describe('cloudLiveSample', () => {
  const basis = cloudLiveBasis(ORIGIN);

  it('is the lattice’s own value noise: one octave at a lattice point reads that byte', () => {
    const options = { octaves: 1 } as const;
    const one = cloudLiveBasis(ORIGIN, options);
    const [a, b, ox, oy] = one;
    const data = cloudLiveLattice();
    // A local point whose octave coordinate is a whole lattice point.
    const qx = Math.ceil(ox!) + 3;
    const qy = Math.ceil(oy!) + 5;
    const det = a! * a! + b! * b!;
    const dx = qx - ox!;
    const dy = qy - oy!;
    const x = (a! * dx + b! * dy) / det;
    const y = (-b! * dx + a! * dy) / det;
    const value = cloudLiveSample(one, x, y, 0, options);
    const byte = data[(qy % 1024) * 1024 + (qx % 1024)]! / 255;
    const [octave] = cloudLiveOctaves(options);
    expect(value).toBeCloseTo(
      CLOUD_LIVE_NOISE.fieldMean +
        octave!.amplitude * (byte - CLOUD_LIVE_NOISE.latticeMean),
      6
    );
  });

  it('is continuous: neighbours 1 m apart differ by little', () => {
    const next = random(5);
    for (let i = 0; i < 200; i++) {
      const x = (next() - 0.5) * 400;
      const y = (next() - 0.5) * 400;
      const d = Math.abs(
        cloudLiveSample(basis, x, y) - cloudLiveSample(basis, x + 0.001, y)
      );
      expect(d).toBeLessThan(0.01);
    }
  });

  // The anti-aliasing (plan §10 item 5): an octave whose cells shrink below
  // a pixel's footprint fades to its mean, so a far or coarsely marched
  // sample never aliases; a footprint larger than every cell is the mean.
  // Without the spread kept, the sum's spread falls with the footprint.
  it('fades each octave to its mean as the footprint outgrows its cells', () => {
    const plain = { restoreSpread: false };
    const variance = (footprintKm: number, options = plain) => {
      // The same points at every footprint: a paired comparison.
      const next = random(6);
      let s = 0;
      let s2 = 0;
      const n = 4000;
      for (let i = 0; i < n; i++) {
        const v = cloudLiveSample(
          basis,
          next() * 3000,
          next() * 3000,
          footprintKm,
          options
        );
        s += v;
        s2 += v * v;
      }
      return s2 / n - (s / n) ** 2;
    };
    const v0 = variance(0);
    const v1 = variance(1);
    const v5 = variance(5);
    expect(v1).toBeLessThan(v0);
    expect(v5).toBeLessThan(v1);
    expect(cloudLiveSample(basis, 17.3, -4.2, 100)).toBe(
      CLOUD_LIVE_NOISE.fieldMean
    );
  });

  // WHY (the N1 milestone review, round-3 plan §19 item 1): with the fade
  // alone the field went to its mean at one base cell, so the cover drawn
  // with the footprint-0 threshold flipped to clear (asked 0.3: 0.00 at a
  // 6 km footprint) or overcast (0.7: 1.00); the tile's mipmaps do the same
  // from about 4 km (0.19 / 0.84), measured in cloud-live-noise.sweep.test.ts
  // (SWEEP_AA). The fade keeps the field's spread (its deviation scaled by
  // the spread at footprint 0 over the spread left, at most x4) and ends
  // at 4 cells, so the cover drawn holds to a 16 km footprint.
  it('keeps the drawn cover as the footprint grows, to 16 km', () => {
    const next = random(17);
    const points = Array.from({ length: 4000 }, () => [
      next() * 3000,
      next() * 3000,
    ]);
    for (const footprintKm of [0, 1, 3, 6, 9, 12, 16]) {
      for (const cover of [0.3, 0.5, 0.7]) {
        const t = liveCloudThreshold(cover);
        let above = 0;
        for (const [x, y] of points) {
          if (cloudLiveSample(basis, x!, y!, footprintKm) > t) above++;
        }
        expect(Math.abs(above / points.length - cover)).toBeLessThan(0.025);
      }
    }
  });

  it('keeps the spread, but goes to the mean once even the base octave has faded', () => {
    const base = cloudLiveOctaves()[0]!.cellKm;
    const end = base * CLOUD_LIVE_NOISE.aaEndRatio;
    expect(cloudLiveSample(basis, 3.3, 7.7, end)).toBe(
      CLOUD_LIVE_NOISE.fieldMean
    );
    // Continuous into the mean: just short of the end the deviation is
    // small (the gain cap), never a jump from full contrast.
    const before = cloudLiveSample(basis, 3.3, 7.7, end * 0.999);
    expect(Math.abs(before - CLOUD_LIVE_NOISE.fieldMean)).toBeLessThan(0.01);
  });

  it('keeps every octave at a footprint of half its cell or less', () => {
    const octaves = cloudLiveOctaves();
    const finest = octaves.at(-1)!.cellKm;
    const next = random(8);
    for (let i = 0; i < 100; i++) {
      const x = next() * 100;
      const y = next() * 100;
      expect(
        cloudLiveSample(basis, x, y, finest * CLOUD_LIVE_NOISE.aaStartRatio)
      ).toBe(cloudLiveSample(basis, x, y, 0));
    }
  });

  it('refuses non-finite coordinates and a negative footprint', () => {
    expect(() => cloudLiveSample(basis, Number.NaN, 0)).toThrow(RangeError);
    expect(() => cloudLiveSample(basis, 0, 0, -1)).toThrow(RangeError);
    expect(() => cloudLiveSample([1, 2, 3], 0, 0)).toThrow(RangeError);
  });
});

describe('the live field against the baked tile', () => {
  // Matched on purpose (mean and spread): the slab's column height is
  // linear in the noise above its threshold, so a field with another
  // spread would draw taller or flatter clouds at the same cover.
  it('has the drawn tile field’s mean and spread', () => {
    const data = cloudNoise(256, 1);
    const live = cloudLiveBasis(ORIGIN);
    const next = random(9);
    const stats = (f: () => number) => {
      let s = 0;
      let s2 = 0;
      const n = 60_000;
      for (let i = 0; i < n; i++) {
        const v = f();
        s += v;
        s2 += v * v;
      }
      const m = s / n;
      return { mean: m, std: Math.sqrt(s2 / n - m * m) };
    };
    const tile = stats(() =>
      cloudNoiseSample(data, 256, next() * 13, next() * 13)
    );
    const field = stats(() =>
      cloudLiveSample(live, next() * 20_000, next() * 20_000)
    );
    expect(Math.abs(field.mean - tile.mean)).toBeLessThan(0.005);
    expect(Math.abs(field.std - tile.std) / tile.std).toBeLessThan(0.03);
  });

  // The quick form of the repetition measure (the full sweep is
  // `cloud-live-noise.sweep.test.ts`): a window shifted by the periods the
  // smaller lattices and the baked tile repeat at. The tile repeats exactly
  // at 24 km; a 256^2 lattice repeated the base octave at 1,536 km (0.754,
  // plan §6); the live field does not, along either axis.
  it('does not repeat where the tile and a 256^2 lattice did', () => {
    const live = cloudLiveBasis({ originKm: [321.5, -77.25], rotationRad: 0 });
    const grid = (shiftX: number, shiftY: number) => {
      const out = new Float64Array(48 * 48);
      for (let j = 0; j < 48; j++) {
        for (let i = 0; i < 48; i++) {
          out[j * 48 + i] = cloudLiveSample(live, i + shiftX, j + shiftY);
        }
      }
      return out;
    };
    const base = grid(0, 0);
    for (const [sx, sy] of [
      [24, 0],
      [0, 24],
      [1536, 0],
      [0, 1536],
      [6144, 0],
      [0, 6144],
    ] as const) {
      expect(Math.abs(correlation(base, grid(sx, sy)))).toBeLessThan(0.45);
    }
  });
});

describe('the cover’s thresholds (CLOUD_LIVE_COVER_THRESHOLDS)', () => {
  // The table is precomputed from 1,000,000 points (a phone must not pay
  // the sort at a switch). Recomputed here on OTHER points, every cover is
  // met within 0.004 and every entry within 0.005.
  it('is the field’s quantiles: held to a fresh computation on other points', () => {
    const fresh = cloudLiveCoverThresholds({ samples: 200_000, seed: 77 });
    expect(fresh).toHaveLength(33);
    expect(CLOUD_LIVE_COVER_THRESHOLDS).toHaveLength(33);
    expect(fresh[0]).toBe(Number.POSITIVE_INFINITY);
    // Cover 1 is the sample's minimum, an extreme that depends on the
    // sample's size: only the covers below it are quantiles to compare.
    expect(CLOUD_LIVE_COVER_THRESHOLDS[32]).toBeLessThanOrEqual(
      CLOUD_LIVE_COVER_THRESHOLDS[31]!
    );
    for (let k = 1; k <= 31; k++) {
      expect(
        Math.abs(fresh[k]! - CLOUD_LIVE_COVER_THRESHOLDS[k]!)
      ).toBeLessThan(0.005);
    }
    const tail = cloudLiveCoverThresholds({
      samples: 200_000,
      seed: 78,
      covers: Array.from({ length: 16 }, (_, k) => (k + 1) / 512),
    });
    for (let k = 0; k < 16; k++) {
      expect(Math.abs(tail[k]! - CLOUD_LIVE_COVER_LOW_TAIL[k]!)).toBeLessThan(
        0.01
      );
    }
    // The tail ends at the table's own 1 / 32 entry: no step at 1 / 32.
    expect(CLOUD_LIVE_COVER_LOW_TAIL[15]).toBe(CLOUD_LIVE_COVER_THRESHOLDS[1]);
  });

  it('draws the asked cover on points it was not computed from', () => {
    const basis = cloudLiveBasis({
      originKm: [5_000, 9_000],
      rotationRad: 0.3,
    });
    const next = random(123);
    const n = 100_000;
    const values = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      values[i] = cloudLiveSample(basis, next() * 30_000, next() * 30_000);
    }
    for (const cover of [1 / 64, 0.1, 0.3, 0.5, 0.7, 0.9]) {
      const t = liveCloudThreshold(cover);
      let above = 0;
      for (const v of values) if (v > t) above++;
      expect(Math.abs(above / n - cover)).toBeLessThan(0.004);
    }
  });

  it('interpolates the table, is clear at cover 0 and refuses a cover outside [0, 1]', () => {
    expect(liveCloudThreshold(0)).toBe(Number.POSITIVE_INFINITY);
    expect(liveCloudThreshold(0.5)).toBe(CLOUD_LIVE_COVER_THRESHOLDS[16]);
    const mid = liveCloudThreshold(0.5 + 1 / 64);
    expect(mid).toBeCloseTo(
      (CLOUD_LIVE_COVER_THRESHOLDS[16]! + CLOUD_LIVE_COVER_THRESHOLDS[17]!) / 2,
      12
    );
    expect(liveCloudThreshold(1 / 512)).toBe(CLOUD_LIVE_COVER_LOW_TAIL[0]);
    expect(() => liveCloudThreshold(-0.1)).toThrow(RangeError);
    expect(() => liveCloudThreshold(1.1)).toThrow(RangeError);
    expect(() => liveCloudThreshold(Number.NaN)).toThrow(RangeError);
    // Falling with the cover: more cover, a lower threshold.
    let previous = Number.POSITIVE_INFINITY;
    for (let k = 1; k <= 64; k++) {
      const t = liveCloudThreshold(k / 64);
      expect(t).toBeLessThanOrEqual(previous);
      previous = t;
    }
  });
});

describe('createCloudLiveLatticeTexture', () => {
  it('is the default lattice as one red byte channel, repeating, unfiltered by mips', () => {
    const texture = createCloudLiveLatticeTexture();
    expect(texture.image.width).toBe(1024);
    expect(texture.image.height).toBe(1024);
    expect(texture.image.data).toBe(cloudLiveLattice());
    expect(texture.generateMipmaps).toBe(false);
    // three's constants: RedFormat 1028, RepeatWrapping 1000, LinearFilter 1006.
    expect(texture.format).toBe(1028);
    expect(texture.wrapS).toBe(1000);
    expect(texture.wrapT).toBe(1000);
    expect(texture.minFilter).toBe(1006);
    expect(texture.magFilter).toBe(1006);
    texture.dispose();
  });
});

describe('CLOUD_LIVE_NOISE_GLSL', () => {
  const glsl = CLOUD_LIVE_NOISE_GLSL;

  it('is include-guarded and defines the twin’s three entry points', () => {
    expect(glsl).toContain('#ifndef ATM_CLOUD_LIVE_GLSL');
    expect(glsl).toMatch(
      /float atmCloudLiveNoise\(sampler2D \w+, vec4 \w+\[ATM_LIVE_OCTAVES\], vec2 \w+, float \w+\)/
    );
    expect(glsl).toMatch(/float atmCloudLiveAt\(/);
    expect(glsl).toMatch(/float atmCloudLiveGrad\(/);
  });

  it('carries every octave’s cell and amplitude from the TS constants', () => {
    const octaves = cloudLiveOctaves();
    expect(glsl).toContain(`const int ATM_LIVE_OCTAVES = ${octaves.length};`);
    for (const o of octaves) {
      expect(glsl).toContain(o.cellKm.toPrecision(9));
      expect(glsl).toContain(o.amplitude.toPrecision(9));
    }
    expect(glsl).toContain(CLOUD_LIVE_NOISE.latticeMean.toPrecision(9));
    expect(glsl).toContain(CLOUD_LIVE_NOISE.fieldMean.toPrecision(9));
  });

  it('reads the lattice once an octave at level 0, through the smooth remap, and stops at the first faded octave', () => {
    const reads = glsl.match(/textureLod\(/g) ?? [];
    expect(reads).toHaveLength(1);
    expect(glsl).toContain('f * f * (3.0 - 2.0 * f)');
    expect(glsl).toContain('(i + f + 0.5) / ATM_LIVE_SIZE');
    expect(glsl).toMatch(/if \(w <= 0\.0\) break;/);
    // The spread kept as octaves fade, capped (§19 item 1), as the twin.
    expect(glsl).toContain(
      'if (spread > 0.0) sum *= min(sqrt(ATM_LIVE_SPREAD0 / spread), ATM_LIVE_MAX_GAIN);'
    );
    const spread0 = cloudLiveOctaves().reduce(
      (t, o) => t + o.amplitude * o.amplitude,
      0
    );
    expect(glsl).toContain(spread0.toPrecision(9));
    // No backtick inside the template (it would end the string).
    expect(glsl).not.toContain('`');
  });
});
