/**
 * Tests for the pure atmosphere model — the ONE place the sky's numbers live.
 *
 * Why this file matters: the GLSL look-up-table passes receive every constant
 * from this module and are checked against it pixel-by-pixel in the look-dev
 * page's smoke (a GPU/CPU parity readback). If these CPU functions are wrong,
 * that parity check would happily confirm a wrong GPU. So the claims below are
 * physical, checked against hand-derived optical depths and against a
 * brute-force integration, never against the implementation's own output.
 */
import { describe, expect, it } from 'vitest';

import {
  EARTH_ATMOSPHERE,
  distanceToAtmosphereTop,
  horizonCosZenith,
  mieExtinctionForVisibility,
  opticalDepthToTop,
  sunDiscLimbDarkening,
  sunLight,
  transmittanceToTop,
  type AtmosphereParams,
} from './atmosphere-model.js';

const CLEAR: AtmosphereParams = { visibilityKm: 80 };
const SEA_LEVEL = EARTH_ATMOSPHERE.groundRadiusKm;
const DEG = Math.PI / 180;

describe('mieExtinctionForVisibility', () => {
  // Koschmieder gives the TOTAL extinction at 550 nm (3.912 / V). Rayleigh is
  // part of that total, so Mie is the remainder. Forgetting to subtract makes
  // every visibility hazier than it claims to be.
  it('is Koschmieder total extinction minus the Rayleigh share at 550 nm', () => {
    const rayleigh550 = EARTH_ATMOSPHERE.rayleighScatteringPerKm[1];
    expect(mieExtinctionForVisibility(20)).toBeCloseTo(
      3.912 / 20 - rayleigh550,
      10
    );
  });

  // Above ~290 km the Rayleigh share alone exceeds Koschmieder's total. A
  // negative Mie coefficient would ADD light along a ray, so it is clamped.
  it('clamps to zero instead of going negative for extreme visibility', () => {
    expect(mieExtinctionForVisibility(1000)).toBe(0);
  });

  // The boundary rule: a visibility slider or preset must never feed NaN into
  // a shader, where it renders black without an error.
  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a non-positive or non-finite visibility (%s)',
    (bad) => {
      expect(() => mieExtinctionForVisibility(bad)).toThrow(RangeError);
    }
  );
});

describe('ray geometry', () => {
  // Straight up from sea level the path to the top is exactly the atmosphere's
  // thickness: the simplest case the quadratic has to get right.
  it('measures the atmosphere thickness straight up', () => {
    const thickness = EARTH_ATMOSPHERE.topRadiusKm - SEA_LEVEL;
    expect(distanceToAtmosphereTop(SEA_LEVEL, 1)).toBeCloseTo(thickness, 9);
  });

  // The horizon dips below the horizontal as the observer rises: at 200 m it
  // is about 0.45°. A sun just below the geometric horizontal is therefore
  // still visible from a rooftop, and the model must say so.
  it('puts the horizon slightly below the horizontal for a raised observer', () => {
    const mu = horizonCosZenith(SEA_LEVEL + 0.2);
    expect(mu).toBeLessThan(0);
    expect(Math.acos(-mu) / DEG).toBeCloseTo(90 - 0.454, 2);
  });
});

describe('transmittanceToTop', () => {
  // Hand-derived zenith optical depths (per km coefficient × scale height,
  // plus the ozone tent's area): Rayleigh blue 33.1e-3 × 8 = 0.265, and so on.
  // This is the anchor that proves the units and the density profiles.
  it('matches the hand-derived zenith transmittance at sea level', () => {
    const t = transmittanceToTop(SEA_LEVEL, 1, CLEAR);
    const mie = mieExtinctionForVisibility(CLEAR.visibilityKm) * 1.2;
    const expected = [
      Math.exp(-(5.802e-3 * 8 + mie + 0.65e-3 * 15)),
      Math.exp(-(13.558e-3 * 8 + mie + 1.881e-3 * 15)),
      Math.exp(-(33.1e-3 * 8 + mie + 0.085e-3 * 15)),
    ];
    // 0.2 % covers the finite atmosphere top (exp(-100/8) is not zero) and
    // the quadrature; a unit mistake would be off by orders of magnitude.
    for (let c = 0; c < 3; c++) {
      expect(t[c]).toBeGreaterThan(expected[c]! * 0.998);
      expect(t[c]).toBeLessThan(expected[c]! * 1.002);
    }
  });

  // Why the sky is blue and the setting sun is red: blue is scattered out of
  // a ray fastest.
  it('attenuates blue more than red', () => {
    const t = transmittanceToTop(SEA_LEVEL + 0.1, Math.cos(80 * DEG), CLEAR);
    expect(t[2]).toBeLessThan(t[0]);
  });

  // A ray that hits the planet never reaches the top of the atmosphere. For
  // the sun this is the difference between dusk and a sun shining through
  // the Earth.
  it('is zero for a ray that hits the ground', () => {
    expect(transmittanceToTop(SEA_LEVEL + 0.2, -0.2, CLEAR)).toEqual([0, 0, 0]);
  });

  // The quadrature must converge. The oracle is the same integral with 20 000
  // steps. The sweep covers the zenith down to the grazing rays at the
  // horizon, where the path is ~1 000 km long and the density is sharply
  // peaked: the case where a coarse step count fails first.
  it.each([1, 0.5, 0.2, 0.05, 0.01, 0])(
    'agrees with a brute-force integration at cos(zenith) = %s',
    (mu) => {
      const r = SEA_LEVEL + 0.2;
      const fast = opticalDepthToTop(r, mu, CLEAR);
      const oracle = opticalDepthToTop(r, mu, CLEAR, 20_000);
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(fast[c] - oracle[c]) / oracle[c]).toBeLessThan(0.005);
      }
    }
  );

  it('rejects a non-finite direction', () => {
    expect(() => transmittanceToTop(SEA_LEVEL, Number.NaN, CLEAR)).toThrow(
      RangeError
    );
  });
});

describe('sunLight', () => {
  const at = (elevationDeg: number) =>
    sunLight(Math.sin(elevationDeg * DEG), CLEAR);

  // THE SAME-SCALE CLAIM. three multiplies a light's colour by its intensity,
  // so colour × intensity is the irradiance the scene receives, and it must
  // be the transmitted sunlight on the scale the sky uses (T / lum(T_ref)).
  // The first version normalised the colour to a chroma AND put lum(T) in the
  // intensity, so the light came out short by lum(chroma): 0.91 at 45°, 0.55
  // at golden hour, surfaces ~0.85 EV too dark against their own sky (M1
  // milestone review, finding 1). Its test compared the light with itself.
  it.each([60, 45, 20, 5, 2])(
    'colour × intensity is the transmitted sunlight on the sky scale (%s°)',
    (elevationDeg) => {
      const r = SEA_LEVEL + EARTH_ATMOSPHERE.defaultObserverAltitudeKm;
      const mu = Math.sin(elevationDeg * DEG);
      const t = transmittanceToTop(r, mu, CLEAR);
      const tRef = transmittanceToTop(
        r,
        Math.sin(EARTH_ATMOSPHERE.referenceSunElevationRad),
        CLEAR
      );
      const lumRef = 0.2126 * tRef[0] + 0.7152 * tRef[1] + 0.0722 * tRef[2];
      const light = sunLight(mu, CLEAR);
      expect(Math.max(...light.colour)).toBeCloseTo(1, 12);
      for (let c = 0; c < 3; c++) {
        expect(light.colour[c]! * light.intensity).toBeCloseTo(
          t[c]! / lumRef,
          10
        );
      }
    }
  );

  // A caller that used a white light of intensity k keeps k's LUMINANCE at
  // the reference elevation: what keeps material grading stable.
  it('delivers luminance 1 at the reference elevation', () => {
    const light = sunLight(
      Math.sin(EARTH_ATMOSPHERE.referenceSunElevationRad),
      CLEAR
    );
    const c = light.colour;
    const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    expect(lum * light.intensity).toBeCloseTo(1, 12);
  });

  // Golden hour exists: at 3° the light is visibly warmer (bluer channel
  // relatively weaker) than at 60°.
  it('is warmer near the horizon than high in the sky', () => {
    const high = at(60);
    const low = at(3);
    expect(low.colour[2] / low.colour[0]).toBeLessThan(
      high.colour[2] / high.colour[0] - 0.2
    );
    expect(low.intensity).toBeLessThan(high.intensity);
  });

  // The sun sets over its own disc (0.53°), not in one frame. A light that
  // snapped off at exactly 0° would pop.
  it('fades out over the solar disc and is dark once the disc has set', () => {
    expect(at(-2).intensity).toBe(0);
    const partly = at(-0.5).intensity;
    expect(partly).toBeGreaterThan(0);
    expect(partly).toBeLessThan(at(0.5).intensity);
  });
});

describe('sunDiscLimbDarkening', () => {
  // The disc must emit exactly the sun's illuminance: E / (π·R²) times a
  // profile whose average over the disc is 1. The first version used the raw
  // profile 1 − u(1 − μ), whose average is 1 − u/3 = 0.8 at u = 0.6, so the
  // sun was 20 % short (M1 milestone review, finding 6).
  it('averages to 1 over the disc', () => {
    const n = 20_000;
    let sum = 0;
    let area = 0;
    for (let i = 0; i < n; i++) {
      const rho = (i + 0.5) / n;
      sum += sunDiscLimbDarkening(rho) * rho;
      area += rho;
    }
    expect(sum / area).toBeCloseTo(1, 4);
  });

  // Darker at the limb than at the centre, as the real sun is.
  it('is brighter at the centre than at the limb', () => {
    expect(sunDiscLimbDarkening(0)).toBeGreaterThan(sunDiscLimbDarkening(0.99));
  });
});
