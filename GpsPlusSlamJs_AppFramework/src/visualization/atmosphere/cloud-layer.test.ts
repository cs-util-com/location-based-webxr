/**
 * Tests for the cloud layer's pure parts: the tileable noise and the mapping
 * from cover to density.
 *
 * Why this file matters: the noise is a repeating texture on a plane that
 * reaches the horizon, so a seam at the tile edge would be drawn thousands of
 * times across the sky; and a cover mapping that is not 0 at cover 0 puts
 * clouds into a sky the owner asked to be clear. Both are visible, neither
 * throws.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  CLOUD_LAYER,
  CLOUD_TEXTURE_SIZE,
  cloudDensity,
  cloudHorizonFade,
  cloudLitRadiance,
  cloudNoise,
  cloudNoiseAt,
  cloudNoiseSample,
  cloudTextureSample,
  cloudThresholdForCover,
  combinedCloudNoise,
} from './cloud-layer.js';
import { CLOUD_HEX, hexPeriodTiles } from './cloud-hex.js';
import {
  EARTH_ATMOSPHERE,
  luminance,
  transmittanceToTop,
} from './atmosphere-model.js';
import { multiScattering, skyRadiance } from './atmosphere-scattering.js';

describe('cloudNoiseAt', () => {
  // Periodic with the texture size in both axes: that is what "tileable"
  // means, and it is what makes the repeat seamless.
  it('is periodic with the tile size', () => {
    const size = 64;
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 64, noNaN: true }),
        fc.double({ min: 0, max: 64, noNaN: true }),
        (x, y) => {
          const a = cloudNoiseAt(x, y, size, 7);
          expect(cloudNoiseAt(x + size, y, size, 7)).toBeCloseTo(a, 9);
          expect(cloudNoiseAt(x, y + size, size, 7)).toBeCloseTo(a, 9);
        }
      ),
      { numRuns: 60 }
    );
  });

  it('stays within [0, 1]', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -100, max: 100, noNaN: true }),
        fc.double({ min: -100, max: 100, noNaN: true }),
        (x, y) => {
          const v = cloudNoiseAt(x, y, 64, 3);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      )
    );
  });
});

describe('cloudNoise (the texture data)', () => {
  // Same seed, same sky: screenshots of a preset are comparable.
  it('is deterministic for a seed and differs between seeds', () => {
    expect(cloudNoise(32, 1)).toEqual(cloudNoise(32, 1));
    expect(cloudNoise(32, 1)).not.toEqual(cloudNoise(32, 2));
  });

  // A flat texture would be a uniform grey veil, not clouds.
  it('has real contrast', () => {
    const data = cloudNoise(CLOUD_TEXTURE_SIZE, 1);
    const values = Array.from(data);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(
      values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
    );
    expect(sd).toBeGreaterThan(20);
  });
});

describe('cloudDensity', () => {
  // Density is a soft step around a THRESHOLD (a noise value, from
  // cloudThresholdForCover): exactly 0.5 at the threshold, so the share of
  // sky with density > 0.5 is the share of noise above it.
  it('is 0.5 at the threshold, 0 well below, 1 well above', () => {
    expect(cloudDensity(0.6, 0.6)).toBeCloseTo(0.5, 12);
    expect(cloudDensity(0.3, 0.6)).toBe(0);
    expect(cloudDensity(0.9, 0.6)).toBe(1);
  });

  // A lower threshold (more cover) never removes cloud.
  it('never decreases as the threshold falls', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (n, a, b) => {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          expect(cloudDensity(n, lo)).toBeGreaterThanOrEqual(
            cloudDensity(n, hi) - 1e-12
          );
        }
      )
    );
  });

  // An infinite threshold (cover 0) is a clear sky whatever the noise.
  it('is zero everywhere for an infinite threshold', () => {
    for (let n = 0; n <= 1; n += 0.05)
      expect(cloudDensity(n, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('cloudHorizonFade', () => {
  // The plane is infinitely far at the horizon, where its texture would
  // alias into noise: the layer fades out there, and is absent below it.
  it('is 0 at and below the horizon and 1 well above it', () => {
    expect(cloudHorizonFade(-0.1)).toBe(0);
    expect(cloudHorizonFade(0)).toBe(0);
    expect(cloudHorizonFade(0.5)).toBe(1);
  });
});

describe('cover means share of sky (M2 review, finding 1)', () => {
  // The first mapping (threshold = 1 − cover) drew 0.1 % of the sky at
  // cover 0.2 and 1.2 % at 0.3, because the two-octave combination narrows
  // the noise's spread: four of five presets had a clear sky. Cover now maps
  // to a QUANTILE of the combined noise the shader actually samples, so the
  // clouded share equals the cover by construction.
  it.each([0.2, 0.5, 0.8])(
    'cover %s clouds that share of the tile (±0.05)',
    (cover) => {
      const field = combinedCloudNoise(
        cloudNoise(CLOUD_TEXTURE_SIZE, 1),
        CLOUD_TEXTURE_SIZE
      );
      const threshold = cloudThresholdForCover(field, cover);
      const share =
        field.filter((n) => cloudDensity(n, threshold) > 0.5).length /
        field.length;
      expect(share).toBeGreaterThan(cover - 0.05);
      expect(share).toBeLessThan(cover + 0.05);
    }
  );

  it('gives no cloud at cover 0 and near-overcast at cover 1', () => {
    const field = combinedCloudNoise(cloudNoise(64, 1), 64);
    expect(
      field.every(
        (n) => cloudDensity(n, cloudThresholdForCover(field, 0)) === 0
      )
    ).toBe(true);
    const full = cloudThresholdForCover(field, 1);
    expect(
      field.filter((n) => cloudDensity(n, full) > 0.5).length / field.length
    ).toBeGreaterThan(0.95);
  });

  it('rejects a cover outside [0, 1]', () => {
    expect(() => cloudThresholdForCover(new Float32Array([0.5]), 1.5)).toThrow(
      RangeError
    );
  });

  // The second octave's frequency is an INTEGER, so the combined noise stays
  // periodic with the tile and the drift offset can wrap without a jump (the
  // first version used 2.7, which shifted that octave by 0.7 of a tile at
  // every wrap; review finding 10).
  it('uses an integer second-octave frequency', () => {
    expect(Number.isInteger(CLOUD_LAYER.secondOctaveFrequency)).toBe(true);
  });
});

describe('cloudLitRadiance (TS twin of the shader lighting, M2 review finding 5)', () => {
  // Plausibility against the atmosphere model: a sunlit cloud at noon, seen
  // at 90° from the sun, is several times brighter than the blue zenith sky
  // (real cumulus: ~3–6×), and brighter still toward the sun. The constants
  // were bare GLSL literals with no check at all.
  it('makes a noon cloud a few times brighter than the zenith sky', () => {
    const params = { visibilityKm: 45 };
    const r = EARTH_ATMOSPHERE.groundRadiusKm + 0.2;
    const sunCos = Math.sin((58 * Math.PI) / 180);
    const psi = (radius: number, mu: number) =>
      multiScattering(radius, mu, params, 8, 20).psi;
    const zenith = skyRadiance(r, 0, 0, sunCos, params, psi, 16);
    const sunT = transmittanceToTop(r + CLOUD_LAYER.altitudeKm, sunCos, params);
    const side = cloudLitRadiance(sunT, 0, 0.5, zenith);
    const toward = cloudLitRadiance(sunT, 0.95, 0.5, zenith);
    const ratio = luminance(side) / luminance(zenith);
    expect(ratio).toBeGreaterThan(2);
    expect(ratio).toBeLessThan(8);
    expect(luminance(toward)).toBeGreaterThan(luminance(side));
  });

  // Thicker cloud is darker on its lit side, never brighter.
  it('darkens with density', () => {
    const sunT = [0.8, 0.8, 0.8] as const;
    const sky = [0.01, 0.01, 0.02] as const;
    expect(luminance(cloudLitRadiance(sunT, 0, 1, sky))).toBeLessThan(
      luminance(cloudLitRadiance(sunT, 0, 0.2, sky))
    );
  });
});

describe("cloudNoiseSample (the CPU twin of the shader's finest read)", () => {
  const size = CLOUD_TEXTURE_SIZE;
  const data = cloudNoise(size, 1);
  const c = CLOUD_LAYER;
  const wrap = (i: number) => ((i % size) + size) % size;

  // At a texel centre bilinear filtering returns that texel: the combined
  // noise there is the two octaves' texels, weighted (independent of the
  // interpolation code).
  it('returns the texels at texel centres', () => {
    for (const [i, j] of [
      [0, 0],
      [17, 200],
      [255, 3],
    ] as const) {
      const u = (i + 0.5) / size;
      const v = (j + 0.5) / size;
      const u2 = u * c.secondOctaveFrequency + c.secondOctaveOffset;
      const v2 = v * c.secondOctaveFrequency + c.secondOctaveOffset;
      // The second read lands between texels; only check it is bracketed.
      const x2 = u2 * size - 0.5;
      const y2 = v2 * size - 0.5;
      const around = [
        [Math.floor(x2), Math.floor(y2)],
        [Math.floor(x2) + 1, Math.floor(y2)],
        [Math.floor(x2), Math.floor(y2) + 1],
        [Math.floor(x2) + 1, Math.floor(y2) + 1],
      ].map(([a, b]) => data[wrap(b!) * size + wrap(a!)]! / 255);
      const first = data[j * size + i]! / 255;
      const n = cloudNoiseSample(data, size, u, v);
      const second =
        (n - c.firstOctaveWeight * first) / (1 - c.firstOctaveWeight);
      expect(second).toBeGreaterThanOrEqual(Math.min(...around) - 1e-9);
      expect(second).toBeLessThanOrEqual(Math.max(...around) + 1e-9);
    }
  });

  // The texture repeats (the drift offset wraps): so must the twin.
  it('is periodic in whole tiles', () => {
    for (const [u, v] of [
      [0.123, 0.456],
      [0.9, 0.01],
    ] as const) {
      expect(cloudNoiseSample(data, size, u + 3, v - 2)).toBeCloseTo(
        cloudNoiseSample(data, size, u, v),
        9
      );
    }
  });

  // A uniform texture reads uniform everywhere, in both octaves.
  it('reads a uniform texture as its value', () => {
    const flat = new Uint8Array(16).fill(51);
    for (const u of [0, 0.3, 0.77]) {
      expect(cloudNoiseSample(flat, 4, u, 1 - u)).toBeCloseTo(0.2, 12);
    }
  });

  it('throws for non-finite coordinates', () => {
    expect(() => cloudNoiseSample(data, size, Number.NaN, 0)).toThrow(
      RangeError
    );
  });
});

describe('cloudNoiseSample with the hex-tiled octave (hex-tiling plan H1)', () => {
  // WHY: the CPU twin feeds the cover's thresholds, the sun's and the
  // shadows' columns and the look-dev probes; with hex on it must read the
  // same field the shader draws: the big-shape octave hex-tiled, repeating
  // at N tiles and not at one.
  const size = 64;
  const data = cloudNoise(size, 3);
  const n = hexPeriodTiles(CLOUD_HEX.cellsPerTile);

  it('is unchanged without the switch, and differs with it', () => {
    let differ = 0;
    for (let i = 0; i < 200; i++) {
      const u = (i * 0.137) % 5;
      const v = (i * 0.291) % 5;
      const plain = cloudNoiseSample(data, size, u, v);
      expect(cloudNoiseSample(data, size, u, v, { hex: false })).toBe(plain);
      if (
        Math.abs(cloudNoiseSample(data, size, u, v, { hex: true }) - plain) >
        0.01
      ) {
        differ += 1;
      }
    }
    expect(differ).toBeGreaterThan(150);
  });

  it('repeats at N tiles with the switch, not at one', () => {
    let same = 0;
    for (let i = 0; i < 200; i++) {
      const u = (i * 0.137) % 5;
      const v = (i * 0.291) % 5;
      const at = cloudNoiseSample(data, size, u, v, { hex: true });
      expect(
        cloudNoiseSample(data, size, u + n, v - n, { hex: true })
      ).toBeCloseTo(at, 9);
      if (
        Math.abs(cloudNoiseSample(data, size, u + 1, v, { hex: true }) - at) <
        1e-6
      ) {
        same += 1;
      }
    }
    expect(same).toBeLessThan(10);
  });
});

describe('cloudTextureSample (one read of the texture, as the GPU takes it)', () => {
  // WHY: the hex twin's GPU check (the look-dev page's hexProbe) compares
  // the shader's read against this one; it must be the texture exactly at
  // texel centres, wrapped, and the plain field's first octave.
  const size = 16;
  const data = new Uint8Array(size * size);
  for (let i = 0; i < data.length; i++) data[i] = (i * 37) % 256;

  it('returns the texel at its centre, wrapped in both axes', () => {
    for (const [i, j] of [
      [0, 0],
      [5, 11],
      [15, 15],
    ] as const) {
      const u = (i + 0.5) / size;
      const v = (j + 0.5) / size;
      const texel = (data[j * size + i] ?? 0) / 255;
      expect(cloudTextureSample(data, size, u, v)).toBeCloseTo(texel, 12);
      expect(cloudTextureSample(data, size, u + 2, v - 3)).toBeCloseTo(
        texel,
        9
      );
    }
  });

  it('is the plain field’s first octave', () => {
    const real = cloudNoise(64, 2);
    const c = CLOUD_LAYER;
    for (const [u, v] of [
      [0.13, 0.71],
      [2.4, -1.3],
    ] as const) {
      const second = cloudTextureSample(
        real,
        64,
        u * c.secondOctaveFrequency + c.secondOctaveOffset,
        v * c.secondOctaveFrequency + c.secondOctaveOffset
      );
      expect(cloudNoiseSample(real, 64, u, v)).toBeCloseTo(
        c.firstOctaveWeight * cloudTextureSample(real, 64, u, v) +
          (1 - c.firstOctaveWeight) * second,
        12
      );
    }
  });
});
