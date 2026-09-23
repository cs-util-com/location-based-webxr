/**
 * Tests for the CPU scattering model: phase functions, the multi-scattering
 * term Ψ and the sky march.
 *
 * Why this file matters: these functions are the ORACLE for the GPU passes
 * (the look-dev smoke reads LUT texels back and compares them with these), so
 * they are tested against physics, not against themselves. Every claim here
 * is something a photograph of the sky would also show.
 */
import { describe, expect, it } from 'vitest';

import {
  MULTI_SCATTERING_LUT_SIZE,
  multiScatteringParamsToUv,
  multiScatteringUvToParams,
  texelToUnit,
  unitToTexel,
} from './atmosphere-lut-mapping.js';
import { EARTH_ATMOSPHERE, type AtmosphereParams } from './atmosphere-model.js';
import {
  miePhase,
  multiScattering,
  rayleighPhase,
  skyRadiance,
  type PsiLookup,
} from './atmosphere-scattering.js';

const R = EARTH_ATMOSPHERE.groundRadiusKm + 0.2;
const CLEAR: AtmosphereParams = { visibilityKm: 80 };
const DEG = Math.PI / 180;
const NO_MULTI: PsiLookup = () => [0, 0, 0];
const lum = (c: readonly number[]) =>
  0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

/** ∫ p(cos θ) dω over the sphere, by midpoint quadrature in cos θ. */
function integrateOverSphere(phase: (cosTheta: number) => number): number {
  const n = 200_000;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += phase(-1 + (2 * (i + 0.5)) / n);
  return (sum * 2 * Math.PI * 2) / n;
}

describe('phase functions', () => {
  // A phase function redistributes scattered light; it must not create or
  // destroy any. If it integrated to 1.3 the sky would be 30 % too bright,
  // and nothing else in the pipeline would reveal why.
  it('both integrate to 1 over the sphere', () => {
    expect(integrateOverSphere(rayleighPhase)).toBeCloseTo(1, 4);
    expect(
      integrateOverSphere((c) => miePhase(c, EARTH_ATMOSPHERE.miePhaseG))
    ).toBeCloseTo(1, 3);
  });

  // Aerosols scatter strongly forward: that is the bright halo around the sun.
  it('Mie scatters far more forward than backward', () => {
    expect(miePhase(1, 0.8) / miePhase(-1, 0.8)).toBeGreaterThan(100);
  });
});

describe('skyRadiance (single scattering)', () => {
  const sky = (
    viewZenithDeg: number,
    deltaAzDeg: number,
    sunElevationDeg: number
  ) =>
    skyRadiance(
      R,
      viewZenithDeg * DEG,
      deltaAzDeg * DEG,
      Math.sin(sunElevationDeg * DEG),
      CLEAR,
      NO_MULTI
    );

  // Why the sky is blue: at noon the zenith's radiance is dominated by the
  // short wavelengths.
  it('makes the noon zenith blue', () => {
    const zenith = sky(0, 90, 60);
    expect(zenith[2]).toBeGreaterThan(zenith[1]);
    expect(zenith[1]).toBeGreaterThan(zenith[0]);
  });

  // Why sunsets are red: toward a low sun, the horizon is warm.
  it('makes the horizon toward a setting sun warm', () => {
    const towardSun = sky(88, 0, 2);
    expect(towardSun[0]).toBeGreaterThan(towardSun[2]);
  });

  // The Mie glow: at a low sun the sky beside the sun is much brighter than
  // the sky opposite it. The look-dev smoke asserts the same thing in pixels.
  it('is brighter toward a low sun than away from it', () => {
    expect(lum(sky(85, 5, 5))).toBeGreaterThan(3 * lum(sky(85, 180, 5)));
  });

  // With the sun far below the horizon no point on the path sees it, so
  // single scattering has nothing to scatter.
  it('is dark when the sun is far below the horizon', () => {
    expect(lum(sky(60, 90, -20))).toBeLessThan(1e-4 * lum(sky(60, 90, 30)));
  });

  // Looking down at the ground: the ray stops there and the lit ground
  // contributes, so the value is finite and positive, never NaN.
  it('is finite and positive below the horizon', () => {
    const below = sky(120, 90, 30);
    for (const c of below) {
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThan(0);
    }
  });
});

describe('multiScattering', () => {
  // The transfer factor f_ms is the fraction of light that scatters again;
  // Ψ = L2 / (1 − f_ms) only converges if it is strictly below 1.
  it('keeps the transfer factor within (0, 1) and Ψ positive', () => {
    const m = multiScattering(EARTH_ATMOSPHERE.groundRadiusKm + 1, 0.5, CLEAR);
    for (let c = 0; c < 3; c++) {
      expect(m.fms[c]).toBeGreaterThan(0);
      expect(m.fms[c]).toBeLessThan(1);
      expect(m.psi[c]).toBeGreaterThan(0);
    }
  });

  // Multiple scattering is what keeps the sky lit after sunset (blue hour).
  // Measured by a sweep (plan §5; visibility 20/80 km × sun +30°…−9° × view
  // zenith 0/60/85°): it adds 23–80 % by day and grows to 6–40× at −9°,
  // because single scattering then only reaches the thin upper air the sun
  // still lights directly. The claim tested is that SHAPE: without Ψ,
  // twilight goes black too early, which is the defect Hillaire's Ψ fixes.
  it('brightens the sky, and dominates deep in twilight', () => {
    const psi: PsiLookup = (r, mu) => multiScattering(r, mu, CLEAR, 6, 12).psi;
    const ratio = (sunDeg: number) => {
      const sunCos = Math.sin(sunDeg * DEG);
      const single = skyRadiance(
        R,
        60 * DEG,
        90 * DEG,
        sunCos,
        CLEAR,
        NO_MULTI,
        16
      );
      const both = skyRadiance(R, 60 * DEG, 90 * DEG, sunCos, CLEAR, psi, 16);
      return lum(both) / lum(single);
    };
    const day = ratio(30);
    const twilight = ratio(-9);
    expect(day).toBeGreaterThan(1.1);
    expect(twilight).toBeGreaterThan(3);
    expect(twilight).toBeGreaterThan(2 * day);
  });
});

// The step and direction counts shared with the GLSL, held to the verdicts of
// the 2026-09-23 sweeps (owner rule: a one-value verdict is provisional). The
// oracles are the same integrals at far higher resolution.
describe('sampling counts', () => {
  const rel = (a: readonly number[], b: readonly number[]) =>
    Math.max(
      ...[0, 1, 2].map((c) => Math.abs(a[c]! - b[c]!) / Math.abs(b[c]!))
    );

  // Sweep: 16 steps reach 5 % off near the horizon at blue hour, 32 stay
  // within 1.3 %, 64 within 0.4 % (visibility 20/80 × sun 30/5/−4 × view
  // zenith 0…89.5°).
  it('32 sky-view steps are within 1.5 % of 512 across the sweep grid', () => {
    for (const visibilityKm of [20, 80]) {
      for (const sunDeg of [30, 5, -4]) {
        for (const zenithDeg of [0, 60, 85, 89.5]) {
          const args = [
            R,
            zenithDeg * DEG,
            40 * DEG,
            Math.sin(sunDeg * DEG),
            { visibilityKm },
            NO_MULTI,
          ] as const;
          const error = rel(skyRadiance(...args), skyRadiance(...args, 512));
          expect(
            error,
            `vis ${visibilityKm} sun ${sunDeg} z ${zenithDeg}`
          ).toBeLessThan(0.015);
        }
      }
    }
  });

  // Sweep (2026-09-23), END TO END because that is what is seen: sky
  // radiance from the ground at 0.2 km, Ψ at each direction count vs a
  // 64×64 oracle, over visibility 20/80 × sun −6/−4/5 × view zenith 0/60/85.
  // Worst: 8×8 → 11.6 %, 16×16 → 2.0 %, 24×24 → 0.3 %. (Ψ itself converges
  // far slower at 20 km in twilight, but that barely reaches the ground.) A
  // first version compared 24×20 against 24×400, the same direction count,
  // and so could not see the direction error at all. This is the worst cell,
  // against a 32×32 oracle (≤ 0.1 % from 64×64) to keep the suite fast.
  it('16×16 directions keep the twilight sky within 3 % of a dense oracle', () => {
    const params = { visibilityKm: 80 };
    const sunCos = Math.sin(-6 * DEG);
    const sky = (sqrtDirections: number) =>
      skyRadiance(
        R,
        85 * DEG,
        90 * DEG,
        sunCos,
        params,
        (r, mu) => multiScattering(r, mu, params, sqrtDirections, 20).psi
      );
    expect(
      rel(sky(EARTH_ATMOSPHERE.multiScatteringSqrtDirections), sky(32))
    ).toBeLessThan(0.03);
  }, 120_000);
});

describe('multi-scattering LUT altitude rows (M3)', () => {
  // THE GPU READS Ψ FROM A 32-ROW LUT, bilinearly; the CPU oracle computes it
  // exactly. Under haze Ψ changes fastest in the lowest kilometres, where
  // linear rows (3.2 km apart) put almost nothing: the hazy preset's
  // near-horizon sky came out 12 % dark on the GPU, and a CPU replica of the
  // linear LUT reproduced the GPU's number to 0.1 %. This replica uses the
  // SHIPPED mapping and size, with the same Ψ function for its texels and for
  // the oracle, so it measures only the altitude interpolation. Swept over
  // the preset visibilities 12 / 30 / 60 km.
  it.each([12, 30, 60])(
    'a LUT replica keeps the near-horizon sky within 2 per cent at %s km visibility',
    (visibilityKm) => {
      const params = { visibilityKm };
      const psiExact = (r: number, mu: number) =>
        multiScattering(r, mu, params, 8, 20).psi;
      const { width, height } = MULTI_SCATTERING_LUT_SIZE;
      const texels = new Map<number, readonly number[]>();
      const texel = (i: number, j: number) => {
        const key = j * width + i;
        let value = texels.get(key);
        if (value === undefined) {
          const p = multiScatteringUvToParams(
            texelToUnit((i + 0.5) / width, width),
            texelToUnit((j + 0.5) / height, height)
          );
          const r = Math.min(
            Math.max(p.r, EARTH_ATMOSPHERE.groundRadiusKm + 0.001),
            EARTH_ATMOSPHERE.topRadiusKm - 0.001
          );
          value = psiExact(r, p.sunCosZenith);
          texels.set(key, value);
        }
        return value;
      };
      const psiLut: PsiLookup = (r, mu) => {
        const uv = multiScatteringParamsToUv(mu, r);
        const x = Math.min(
          width - 1,
          Math.max(0, unitToTexel(uv.u, width) * width - 0.5)
        );
        const y = Math.min(
          height - 1,
          Math.max(0, unitToTexel(uv.v, height) * height - 0.5)
        );
        const i0 = Math.floor(x);
        const j0 = Math.floor(y);
        const i1 = Math.min(width - 1, i0 + 1);
        const j1 = Math.min(height - 1, j0 + 1);
        const fx = x - i0;
        const fy = y - j0;
        const at = (c: number) =>
          (texel(i0, j0)[c]! * (1 - fx) + texel(i1, j0)[c]! * fx) * (1 - fy) +
          (texel(i0, j1)[c]! * (1 - fx) + texel(i1, j1)[c]! * fx) * fy;
        return [at(0), at(1), at(2)];
      };
      // The sky-view texel (96, 40) of the hazy failure: ~2° above the
      // horizon, 35° of sun.
      const sunCos = Math.sin(35 * DEG);
      const lut = skyRadiance(R, 88 * DEG, 60 * DEG, sunCos, params, psiLut);
      const exact = skyRadiance(
        R,
        88 * DEG,
        60 * DEG,
        sunCos,
        params,
        psiExact
      );
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(lut[c]! / exact[c]! - 1)).toBeLessThan(0.02);
      }
    },
    120_000
  );
});
