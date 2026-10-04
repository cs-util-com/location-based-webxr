/**
 * Tests for the look-up-table parameterisations.
 *
 * Why this file matters: every LUT is written by one mapping (texel → physical
 * parameters) and read by its inverse (physical parameters → texture
 * coordinate), and the GLSL mirrors both. A mapping and an inverse that
 * disagree do not crash. They shift the sky by a fraction of a texel, or fold
 * the horizon, and the result looks like "a slightly odd sunset". Round trips,
 * plus the anchors each mapping must hit exactly, are what make that visible.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { EARTH_ATMOSPHERE, horizonCosZenith } from './atmosphere-model.js';
import {
  multiScatteringParamsToUv,
  multiScatteringUvToParams,
  skyViewParamsToUv,
  skyViewUvToParams,
  texelToUnit,
  transmittanceParamsToUv,
  transmittanceUvToParams,
  unitToTexel,
} from './atmosphere-lut-mapping.js';

const GROUND = EARTH_ATMOSPHERE.groundRadiusKm;
const TOP = EARTH_ATMOSPHERE.topRadiusKm;

describe('texel-centre remapping', () => {
  // A LUT texel's centre sits half a texel in from the edge. Without this
  // remap the parameter range's endpoints (the zenith, the horizon) would be
  // sampled half a texel off, and the horizon is exactly where the sky changes
  // fastest.
  it('maps the first and last texel centres to exactly 0 and 1', () => {
    expect(texelToUnit(0.5 / 64, 64)).toBeCloseTo(0, 12);
    expect(texelToUnit(1 - 0.5 / 64, 64)).toBeCloseTo(1, 12);
  });

  it('is inverted by unitToTexel', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (x) => {
        expect(texelToUnit(unitToTexel(x, 32), 32)).toBeCloseTo(x, 10);
      })
    );
  });
});

describe('transmittance LUT (Bruneton 2017 mapping)', () => {
  // v = 0 is the ground and v = 1 the top of the atmosphere; u = 0 is the
  // shortest ray to the top (straight up), u = 1 the longest (grazing the
  // horizon). These anchors are what make the mapping's resolution land where
  // transmittance changes fastest.
  it('puts the zenith at u = 0 and the horizon at u = 1', () => {
    const zenith = transmittanceUvToParams(0, 0);
    expect(zenith.r).toBe(GROUND);
    expect(zenith.mu).toBeCloseTo(1, 12);
    const grazing = transmittanceUvToParams(1, 0.5);
    expect(grazing.mu).toBeCloseTo(horizonCosZenith(grazing.r), 9);
  });

  it('round-trips every ray that does not hit the ground', () => {
    const r = fc.double({ min: GROUND + 0.01, max: TOP - 0.01, noNaN: true });
    const t = fc.double({ min: 0, max: 1, noNaN: true });
    fc.assert(
      fc.property(r, t, (radius, s) => {
        const horizon = horizonCosZenith(radius);
        const mu = horizon + s * (1 - horizon);
        const uv = transmittanceParamsToUv(radius, mu);
        const back = transmittanceUvToParams(uv.u, uv.v);
        expect(back.r).toBeCloseTo(radius, 6);
        expect(back.mu).toBeCloseTo(mu, 6);
      })
    );
  });
});

describe('sky-view LUT (Hillaire 2020 §5.3, horizon-concentrated latitude)', () => {
  const r = GROUND + 0.2;

  // The horizon sits exactly at v = 0.5, the boundary between the two middle
  // rows (108 rows: 53 above, 54 below), so the rows on either side are
  // wholly sky or wholly ground. Filtering still blends the two over half a
  // row (~±0.008°), which is below anything a pixel shows.
  it('places the geometric horizon on v = 0.5', () => {
    const horizonZenith = Math.acos(horizonCosZenith(r));
    // 6 digits, not 12: the inverse takes a square root of (1 − z / z_h),
    // which turns a 1e-16 rounding difference in z into ~2e-8 in v — about
    // 2e-6 of one of the 108 rows, far below anything a texel can show.
    expect(skyViewParamsToUv(r, horizonZenith, 0).v).toBeCloseTo(0.5, 6);
  });

  // The azimuth is measured from the sun and the sky is mirror-symmetric
  // about the sun's vertical plane, so [0, π] covers every direction.
  it('puts the sun side at u = 0 and the anti-sun side at u = 1', () => {
    expect(skyViewParamsToUv(r, 1, 0).u).toBe(0);
    expect(skyViewParamsToUv(r, 1, Math.PI).u).toBeCloseTo(1, 12);
  });

  it('round-trips view zenith and azimuth over the whole sphere', () => {
    const zenith = fc.double({ min: 0, max: Math.PI, noNaN: true });
    const azimuth = fc.double({ min: 0, max: Math.PI, noNaN: true });
    fc.assert(
      fc.property(zenith, azimuth, (z, a) => {
        const uv = skyViewParamsToUv(r, z, a);
        const back = skyViewUvToParams(r, uv.u, uv.v);
        expect(back.viewZenithRad).toBeCloseTo(z, 6);
        expect(back.deltaAzimuthRad).toBeCloseTo(a, 6);
      })
    );
  });
});

describe('multi-scattering LUT', () => {
  // Linear in the sun's cosine, QUADRATIC in altitude. Ψ is NOT smooth
  // across the terminator, which is why the width is 128 rather than
  // Hillaire's 32 (see MULTI_SCATTERING_LUT_SIZE for the measurement), and
  // under haze it is not smooth in the lowest kilometres either, which is why
  // the rows crowd toward the ground (M3, measured below).
  it('spans sun cos-zenith −1…1 and the ground to the top', () => {
    expect(multiScatteringUvToParams(0, 0)).toEqual({
      sunCosZenith: -1,
      r: GROUND,
    });
    expect(multiScatteringUvToParams(1, 1)).toEqual({
      sunCosZenith: 1,
      r: TOP,
    });
  });

  // The radius round-trips to float precision. v does too, except next to
  // the ground: a height of ~1e-17 km vanishes when added to the 6360 km
  // radius (fast-check found v = 5e-10 → 0), and the square root magnifies
  // the float resolution there to at most ~1e-7 in v. That is a sub-metre
  // question about a quantity the LUT samples at 1/32, so v is held to 1e-6.
  it('round-trips through its inverse', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (u, v) => {
          const p = multiScatteringUvToParams(u, v);
          const back = multiScatteringParamsToUv(p.sunCosZenith, p.r);
          expect(back.u).toBeCloseTo(u, 9);
          expect(Math.abs(back.v - v)).toBeLessThan(1e-6);
          const again = multiScatteringUvToParams(back.u, back.v);
          expect(again.r).toBeCloseTo(p.r, 9);
        }
      )
    );
  });

  // Half the rows lie in the lowest quarter of the atmosphere (25 km), where
  // the haze lives; linear rows put one row every 3.2 km, and a GPU/CPU
  // parity sweep (hazy preset, 12 km visibility) measured the near-horizon
  // sky 12 % dark because of it.
  it('crowds its rows toward the ground', () => {
    expect(multiScatteringUvToParams(0, 0.5).r - GROUND).toBeCloseTo(
      (TOP - GROUND) / 4,
      9
    );
  });
});
