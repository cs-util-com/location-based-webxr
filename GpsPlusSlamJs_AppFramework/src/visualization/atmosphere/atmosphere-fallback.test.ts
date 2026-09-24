/**
 * Tests for the CPU fallback sky: the colours a device WITHOUT float render
 * targets gets instead of `SkyAtmosphere` (plan M3).
 *
 * Why this file matters: the fallback runs exactly where nothing else can be
 * checked on a GPU (old phones), so its only evidence is here. A fallback that
 * returns NaN at night, a scale that disagrees with `SkyAtmosphere`'s, or an
 * exposure that ignores the light would all ship silently.
 */
import { describe, expect, it } from 'vitest';

import {
  fallbackSky,
  skyIlluminanceCpu,
  type FallbackSky,
  psiLookupFor,
} from './atmosphere-fallback.js';
import { autoExposure } from './atmosphere-exposure.js';
import { luminance, sunLight } from './atmosphere-model.js';

const DEG = Math.PI / 180;
const sunAt = (elevationDeg: number) => ({
  x: Math.cos(elevationDeg * DEG),
  y: Math.sin(elevationDeg * DEG),
  z: 0,
});
const blueness = (c: readonly number[]) => c[2]! / c[0]!;

describe('fallbackSky', () => {
  const noon = fallbackSky(sunAt(58), { visibilityKm: 60 });
  const golden = fallbackSky(sunAt(5), { visibilityKm: 45 });

  // The two cues a flat-colour sky still has to get right: a blue zenith, and
  // a horizon paler than it (more air, more Mie).
  it('gives a blue zenith and a paler horizon at noon', () => {
    expect(blueness(noon.zenith)).toBeGreaterThan(1.3);
    expect(blueness(noon.horizon)).toBeLessThan(blueness(noon.zenith));
  });

  // Direction-free colours would give the same horizon at every time of day.
  it('warms the horizon at golden hour', () => {
    expect(blueness(golden.horizon)).toBeLessThan(blueness(noon.horizon));
  });

  // Exposure follows the light the same way SkyAtmosphere's does: its input
  // is the sun-relative horizontal illuminance, sky plus direct sun.
  it('exposes from the horizontal illuminance, like SkyAtmosphere', () => {
    const params = { visibilityKm: 60 };
    const s = sunLight(Math.sin(58 * DEG), params);
    const direct = luminance(s.colour) * s.intensity * Math.sin(58 * DEG);
    const expected = autoExposure(
      skyIlluminanceCpu(Math.sin(58 * DEG), params) + direct
    );
    expect(noon.exposure).toBeCloseTo(expected, 9);
    expect(golden.exposure).toBeGreaterThan(noon.exposure);
  });

  // THE SCALE CONTRACT: colours are scene-linear, i.e. relative radiance ×
  // sunIntensity × exposure × 2^EV. Doubling either input doubles every colour.
  it('scales linearly with sunIntensity and exposure compensation', () => {
    const base = fallbackSky(sunAt(30), { visibilityKm: 60 });
    const brighter = fallbackSky(sunAt(30), {
      visibilityKm: 60,
      sunIntensity: 2,
    });
    const plusOne = fallbackSky(sunAt(30), {
      visibilityKm: 60,
      exposureCompensationEv: 1,
    });
    for (const key of ['zenith', 'horizon', 'ground'] as const) {
      for (let c = 0; c < 3; c++) {
        expect(brighter[key][c]).toBeCloseTo(2 * base[key][c]!, 9);
        expect(plusOne[key][c]).toBeCloseTo(2 * base[key][c]!, 9);
      }
    }
    expect(plusOne.exposure).toBeCloseTo(2 * base.exposure, 9);
  });

  // Deep night: the model's radiance underflows toward zero, and the
  // auto-exposure's floor must keep everything finite rather than NaN/∞.
  it('stays finite with the sun far below the horizon', () => {
    const night: FallbackSky = fallbackSky(sunAt(-15), { visibilityKm: 60 });
    for (const c of [...night.zenith, ...night.horizon, ...night.ground]) {
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
    }
    expect(Number.isFinite(night.exposure)).toBe(true);
    expect(night.sun.intensity).toBe(0);
  });

  it('rejects a zero or non-finite sun direction and bad options', () => {
    expect(() =>
      fallbackSky({ x: 0, y: 0, z: 0 }, { visibilityKm: 60 })
    ).toThrow(RangeError);
    expect(() =>
      fallbackSky({ x: Number.NaN, y: 1, z: 0 }, { visibilityKm: 60 })
    ).toThrow(RangeError);
    expect(() => fallbackSky(sunAt(30), { visibilityKm: -1 })).toThrow(
      RangeError
    );
    expect(() =>
      fallbackSky(sunAt(30), { visibilityKm: 60, sunIntensity: 0 })
    ).toThrow(RangeError);
    expect(() =>
      fallbackSky(sunAt(30), {
        visibilityKm: 60,
        exposureCompensationEv: Number.NaN,
      })
    ).toThrow(RangeError);
  });
});

describe('skyIlluminanceCpu', () => {
  // The cheap quadrature against a much DENSER one over the same sky: the
  // oracle varies the axis under test (directions), so it can see the
  // quadrature's own error. Swept over the times of day the demo shows.
  it.each([58, 20, 5, -4])(
    'is within 10 per cent of a dense quadrature at %s°',
    (elevation) => {
      const params = { visibilityKm: 45 };
      const mu = Math.sin(elevation * DEG);
      const cheap = skyIlluminanceCpu(mu, params);
      const dense = skyIlluminanceCpu(mu, params, {
        elevations: 24,
        azimuths: 24,
      });
      expect(Math.abs(cheap / dense - 1)).toBeLessThan(0.1);
    }
  );
});

describe('psiLookupFor', () => {
  // The CPU sky's multiple-scattering grid is the expensive part (~19 of
  // ~23 ms per skyIlluminanceCpu call; M3 review finding 6). SkyAtmosphere
  // calls the estimate on every sun change while a phone refuses the
  // readback, so the grid must be built once per air, not per call.
  it('returns the same lookup for the same air, a new one for different air', () => {
    const a = psiLookupFor({ visibilityKm: 45 });
    expect(psiLookupFor({ visibilityKm: 45 })).toBe(a);
    expect(psiLookupFor({ visibilityKm: 45, observerAltitudeKm: 0.2 })).toBe(a);
    expect(psiLookupFor({ visibilityKm: 60 })).not.toBe(a);
    expect(psiLookupFor({ visibilityKm: 45, observerAltitudeKm: 1 })).not.toBe(
      a
    );
  });
});
