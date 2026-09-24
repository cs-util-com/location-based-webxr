/**
 * Tests for the exposure maths: sky irradiance from the sky-view LUT, the
 * horizon average, and the partially-adapting auto-exposure.
 *
 * Why this file matters: the first look-dev screenshots (2026-09-23) showed
 * that no fixed exposure works for a physical sky. Daylight spans six orders
 * of magnitude between noon and blue hour, so every preset came out murky or
 * blown out. The auto-exposure fixes that, and it rests on one integral that
 * is easy to get wrong silently: the solid angle of a texel in a non-linear
 * LUT mapping. A uniform sky has a known irradiance (π · L), and that is the
 * anchor this file holds it to.
 */
import { describe, expect, it } from 'vitest';

import {
  AUTO_EXPOSURE,
  autoExposure,
  horizonAverage,
  skyIrradiance,
} from './atmosphere-exposure.js';
import {
  SKY_VIEW_LUT_SIZE,
  skyViewUvToParams,
  texelToUnit,
} from './atmosphere-lut-mapping.js';
import { EARTH_ATMOSPHERE } from './atmosphere-model.js';

const { width, height } = SKY_VIEW_LUT_SIZE;
const R = EARTH_ATMOSPHERE.groundRadiusKm + 0.2;

function uniformSky(value: number): Float32Array {
  return new Float32Array(width * height * 4).fill(value);
}

describe('skyIrradiance', () => {
  // A sky of uniform radiance L over the upper hemisphere delivers π · L to a
  // horizontal surface. If the texel solid angles were wrong (the mapping is
  // quadratic in both axes), this is where it would show.
  it('integrates a uniform sky to π · L', () => {
    const e = skyIrradiance(uniformSky(2), width, height, R);
    for (const c of e) expect(c).toBeCloseTo(2 * Math.PI, 1);
  });

  // Light from below the horizon cannot reach the top of a horizontal
  // surface.
  it('ignores the rows below the horizon', () => {
    const rgba = uniformSky(0);
    for (let y = height / 2; y < height; y++) {
      for (let x = 0; x < width; x++)
        rgba.fill(5, (y * width + x) * 4, (y * width + x) * 4 + 3);
    }
    expect(skyIrradiance(rgba, width, height, R)[0]).toBeCloseTo(0, 6);
  });
});

describe('horizonAverage', () => {
  // A constant row averages to itself, whatever the azimuth weighting.
  it('returns a constant row unchanged', () => {
    for (const c of horizonAverage(uniformSky(3), width, height, R))
      expect(c).toBeCloseTo(3, 12);
  });

  // WHERE it samples (M3, found by the fallback's GPU parity smoke): the
  // colour `scene.fog` gets must be the horizon the screen SHOWS, and since
  // M2 the visible sky and the haze are clamped to dir.y >= horizonClampDirY.
  // The first version read the LUT row nearest the geometric horizon
  // (~0.005 deg), which at dawn and blue hour is 2...2.8x off the drawn
  // horizon. A sky whose texels hold their own view elevation (dir.y, from
  // the FORWARD mapping) must average to the clamp height.
  it('samples at the clamp height the sky and the haze use', () => {
    const rgba = new Float32Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const v = texelToUnit((y + 0.5) / height, height);
      const dirY = Math.cos(skyViewUvToParams(R, 0, v).viewZenithRad);
      for (let x = 0; x < width; x++)
        rgba.fill(dirY, (y * width + x) * 4, (y * width + x) * 4 + 3);
    }
    const [value] = horizonAverage(rgba, width, height, R);
    expect(value).toBeCloseTo(EARTH_ATMOSPHERE.horizonClampDirY, 3);
  });
});

describe('autoExposure', () => {
  // At the reference illuminance, a mid-grey horizontal surface renders at
  // mid grey: that anchor is what makes "exposure 1" mean something.
  it('exposes a reference-lit mid-grey surface to mid grey', () => {
    const e = AUTO_EXPOSURE.referenceIlluminance;
    const exposure = autoExposure(e);
    const midGrey = (0.18 / Math.PI) * e * exposure;
    expect(midGrey).toBeCloseTo(0.18 * AUTO_EXPOSURE.key, 10);
  });

  // PARTIAL adaptation: halving the light raises the exposure by 2^α, not
  // 2. A full-adaptation camera would render blue hour as bright as noon,
  // and it would no longer read as twilight.
  it('adapts partially: half the light gives 2^α more exposure', () => {
    const e = AUTO_EXPOSURE.referenceIlluminance / 8;
    expect(autoExposure(e / 2) / autoExposure(e)).toBeCloseTo(
      2 ** AUTO_EXPOSURE.adaptation,
      10
    );
  });

  // The light dialog (OsmDemo, plan 2026-09-24-2140) tunes the adaptation.
  // WHY: the default must be the shipped curve, and a lower adaptation must
  // do what the dialog promises: brighten where the light is above the
  // reference (noon) and darken where it is below (twilight), crossing at
  // the reference itself.
  it('takes the adaptation as a parameter, the default unchanged', () => {
    const ref = AUTO_EXPOSURE.referenceIlluminance;
    for (const e of [ref / 50, ref / 3, ref, ref * 4]) {
      expect(autoExposure(e, AUTO_EXPOSURE.adaptation)).toBe(autoExposure(e));
    }
    const bright = ref * 4;
    const dim = ref / 4;
    expect(autoExposure(bright, 0.5)).toBeGreaterThan(autoExposure(bright));
    expect(autoExposure(dim, 0.5)).toBeLessThan(autoExposure(dim));
    expect(autoExposure(ref, 0.5)).toBeCloseTo(autoExposure(ref), 12);
    expect(autoExposure(bright, 0)).toBeCloseTo(autoExposure(dim, 0), 12);
    for (const bad of [-0.1, 1.1, Number.NaN]) {
      expect(() => autoExposure(ref, bad)).toThrow(RangeError);
    }
  });

  // No light at all must still give a finite exposure (a black scene), not
  // Infinity in a uniform.
  it('stays finite in the dark', () => {
    expect(Number.isFinite(autoExposure(0))).toBe(true);
    expect(autoExposure(0)).toBeGreaterThan(0);
  });
});
