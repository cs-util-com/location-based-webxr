/**
 * Tests for the sun through clouds (round-3 plan 2026-09-27-0532, stream D;
 * DEC-FB3-6): the disc's extinction and the forward scattering.
 *
 * Why this file matters: the look is judged on the page, but three claims
 * behind it are arithmetic the eye cannot check. The phase must be a
 * probability density (or the glow's brightness means nothing), the forward
 * share must vanish both in the clear and through a thick cloud (so a clear
 * sky is unchanged and a thick cloud does not glow), and the disc must dim
 * far faster than the diffuse sky behind the same cloud, which is what makes
 * a disc behind a cloud stop blazing. Each is checked against an independent
 * statement, not against the function's own output.
 */
import { describe, expect, it } from 'vitest';

import {
  CLOUD_SUN,
  CLOUD_SUN_GLSL,
  cloudDiscTransmittance,
  cloudForwardPhase,
  cloudForwardPhaseOf,
  cloudForwardRadiance,
  cloudForwardShare,
} from './cloud-sun.js';
import { glslFloat } from '../../utils/glsl-float.js';

const DEG = Math.PI / 180;

describe('cloudForwardPhase', () => {
  // A phase function is a density over the sphere: ∫ p dΩ = 2π ∫ p(μ) dμ = 1.
  it('integrates to 1 over the sphere', () => {
    const n = 200_000;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const mu = -1 + (2 * (i + 0.5)) / n;
      sum += cloudForwardPhase(mu);
    }
    expect(2 * Math.PI * sum * (2 / n)).toBeCloseTo(1, 3);
  });

  // Forward: brightest at the sun, falling with the angle to it.
  it('is strongest at the sun and falls with the angle', () => {
    let previous = Infinity;
    for (const deg of [0, 1, 3, 10, 30, 60, 90, 180]) {
      const p = cloudForwardPhase(Math.cos(deg * DEG));
      expect(p).toBeLessThan(previous);
      previous = p;
    }
  });

  // Two lobes: the aureole keeps the glow tight around the sun (most of it
  // within a few degrees) while the silver lining still lifts edges tens of
  // degrees away. One narrow lobe alone would drop far faster at 20°.
  it('has a narrow aureole and a broad silver lining', () => {
    const at = (deg: number) => cloudForwardPhase(Math.cos(deg * DEG));
    expect(at(0) / at(5)).toBeGreaterThan(1.5);
    expect(at(20) / at(0)).toBeGreaterThan(0.03);
    expect(at(60)).toBeLessThan(at(20) / 4);
  });

  it('throws for a cosine outside [-1, 1]', () => {
    expect(() => cloudForwardPhase(1.5)).toThrow(RangeError);
    expect(() => cloudForwardPhase(Number.NaN)).toThrow(RangeError);
  });
});

describe('cloudForwardShare', () => {
  // None in the clear (a clear sky stays unchanged), none through a thick
  // cloud (it does not glow), most at τ = 1.
  it('is 0 in the clear, vanishes when thick, and peaks at τ = 1', () => {
    expect(cloudForwardShare(0)).toBe(0);
    expect(cloudForwardShare(12)).toBeLessThan(1e-4);
    expect(cloudForwardShare(1)).toBeCloseTo(1 / Math.E, 12);
    for (const tau of [0.3, 0.8, 1.2, 3]) {
      expect(cloudForwardShare(tau)).toBeLessThan(cloudForwardShare(1));
    }
  });

  it('throws for a negative optical depth', () => {
    expect(() => cloudForwardShare(-0.1)).toThrow(RangeError);
  });
});

describe('cloudForwardRadiance', () => {
  it('is E · phase · share · strength, and 0 at strength 0', () => {
    const cos = Math.cos(4 * DEG);
    expect(cloudForwardRadiance(2, cos, 0.7, 1, 1)).toBeCloseTo(
      2 * cloudForwardPhase(cos) * 0.7 * Math.exp(-0.7),
      12
    );
    expect(cloudForwardRadiance(2, cos, 0.7, 0, 0)).toBe(0);
    expect(() => cloudForwardRadiance(1, cos, 0.7, -1, 1)).toThrow(RangeError);
    expect(() => cloudForwardRadiance(1, cos, 0.7, 1, Number.NaN)).toThrow(
      RangeError
    );
  });
});

describe('cloudDiscTransmittance', () => {
  // The disc is ~15 000x the sky beside it; a pixel of it stays white until
  // it is dimmed to ~1e-5. So behind a cloud whose view transmittance is T
  // the disc must lose far more than the sky's 1 - T: with the page's k = 4
  // a cloud that passes a third of the sky passes ~1 % of the disc, and a
  // cloud with T = e^-3 (still a veil to the diffuse sky) blanks the disc.
  it('dims the disc far faster than the diffuse sky behind the same cloud', () => {
    const k = CLOUD_SUN.pageDiscExponent;
    for (const tau of [0.5, 1, 2, 3]) {
      const sky = Math.exp(-tau);
      const disc = cloudDiscTransmittance(tau, k);
      expect(disc).toBeLessThan(sky * sky);
    }
    expect(cloudDiscTransmittance(Math.log(3), k)).toBeCloseTo(1 / 81, 12);
    expect(cloudDiscTransmittance(3, k)).toBeLessThan(1e-5);
  });

  // Off, and in the clear, the disc is untouched.
  it('is 1 at k = 0 and in the clear', () => {
    expect(cloudDiscTransmittance(2, 0)).toBe(1);
    expect(cloudDiscTransmittance(0, 4)).toBe(1);
  });

  it('throws for a negative exponent or depth', () => {
    expect(() => cloudDiscTransmittance(1, -1)).toThrow(RangeError);
    expect(() => cloudDiscTransmittance(-1, 1)).toThrow(RangeError);
  });
});

describe('CLOUD_SUN_GLSL', () => {
  it('carries the model’s lobes and an include guard, and no uniform', () => {
    expect(CLOUD_SUN_GLSL).toContain('#ifndef ATM_CLOUD_SUN_GLSL');
    expect(CLOUD_SUN_GLSL).toContain(
      `ATM_FORWARD_AUREOLE_G = ${glslFloat(CLOUD_SUN.aureoleG)}`
    );
    expect(CLOUD_SUN_GLSL).toContain(
      `ATM_FORWARD_SILVER_G = ${glslFloat(CLOUD_SUN.silverG)}`
    );
    expect(CLOUD_SUN_GLSL).toContain(
      'float atmForwardPhase(float cosTheta, vec2 strengths)'
    );
    expect(CLOUD_SUN_GLSL).toContain('return tau * exp(-tau);');
    expect(CLOUD_SUN_GLSL).not.toContain('uniform');
  });
});

describe('cloudForwardPhaseOf (one knob per lobe, the owner’s requirement)', () => {
  // Each lobe must be switchable alone, and the two at 1 must be the
  // phase the look was judged with.
  it('is the two lobes each at its own strength, summing to the phase', () => {
    for (const deg of [0, 3, 12, 40]) {
      const cos = Math.cos(deg * DEG);
      const a = cloudForwardPhaseOf(cos, 1, 0);
      const s = cloudForwardPhaseOf(cos, 0, 1);
      expect(a + s).toBeCloseTo(cloudForwardPhase(cos), 12);
      expect(cloudForwardPhaseOf(cos, 0.5, 2)).toBeCloseTo(0.5 * a + 2 * s, 12);
      expect(cloudForwardPhaseOf(cos, 0, 0)).toBe(0);
    }
    // The aureole is the narrow one: it falls far faster away from the sun.
    const fall = (a: number, s: number) =>
      cloudForwardPhaseOf(Math.cos(20 * DEG), a, s) /
      cloudForwardPhaseOf(1, a, s);
    expect(fall(1, 0)).toBeLessThan(fall(0, 1) / 5);
  });
});
