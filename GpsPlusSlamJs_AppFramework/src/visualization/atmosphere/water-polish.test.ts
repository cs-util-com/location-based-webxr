/**
 * Tests for the water polish (round-3 plan 2026-09-27-0532, stream W;
 * DEC-FB3-9).
 *
 * Why this file matters: the owner judges each trick ALONE against the
 * unpolished water, so a switch that leaks into another's shader, a typo
 * that switches nothing, or a constant that reaches the GPU with another
 * value would make the owner judge something else than the label says.
 * The pixels are measured by the look-dev smoke; these check the TS twins
 * and the GLSL each switch contributes.
 */
import { describe, expect, it } from 'vitest';

import {
  buildWaterPolish,
  configureWaterPolishUniforms,
  createWaterPolishUniforms,
  normalizeWaterPolish,
  WATER_POLISH,
  WATER_POLISH_DEFAULT_PARAMS,
  WATER_POLISH_SWITCHES,
  waterFresnelDampFactor,
  waterGustGain,
  waterLostVariance,
  waterSunRoughness,
  waterTileWave,
  waterVarianceRoughness,
} from './water-polish.js';
import { WATER_SURFACE } from './water-surface-material.js';

/** A wave set in the generated candidates' shape (warped position `q`). */
const CANDIDATE = `vec2 waterWarp(vec2 p) { return vec2(0.0); }
void waterWave(vec2 q, float t, vec2 d, float k, float ak, float w, float phase, inout vec2 slope) {
  float ph = k * dot(d, q);
  float fade = 1.0 - smoothstep(0.800000000, 1.60000000, fwidth(ph));
  slope += fade * ak * cos(ph - w * t + phase) * d;
}
vec2 waterSlopeAt(vec2 p, float t) {
  vec2 q = p + waterWarp(p);
  vec2 slope = vec2(0.0);
  waterWave(q, t, vec2(1.0, 0.0), 4.0, 0.06, 6.2, 0.0, slope);
  return slope;
}`;

describe('normalizeWaterPolish', () => {
  it('names every switch, off unless true', () => {
    expect(normalizeWaterPolish()).toEqual(
      Object.fromEntries(WATER_POLISH_SWITCHES.map((n) => [n, false]))
    );
    expect(normalizeWaterPolish({ gusts: true, body: false }).gusts).toBe(true);
  });

  // A misspelt switch would otherwise switch nothing, silently.
  it('refuses an unknown switch or a non-boolean value', () => {
    expect(() =>
      normalizeWaterPolish({ gust: true } as unknown as { gusts: boolean })
    ).toThrow(RangeError);
    expect(() =>
      normalizeWaterPolish({ gusts: 1 } as unknown as { gusts: boolean })
    ).toThrow(RangeError);
    expect(() =>
      normalizeWaterPolish(null as unknown as { gusts: boolean })
    ).toThrow(RangeError);
  });
});

describe('the TS twins', () => {
  // The fade is the wave sets' own: the built-in waves share the constants.
  it('fades with the wave sets constants', () => {
    expect([...WATER_SURFACE.aliasFadeRad]).toEqual([0.8, 1.6]);
  });

  it('loses no variance for a small pixel and all of it for a large one', () => {
    const waves = [
      { k: 4, ak: 0.06 },
      { k: 0.2, ak: 0.06 },
    ];
    expect(waterLostVariance(waves, 0)).toBe(0);
    expect(waterLostVariance(waves, 0.1)).toBe(0); // 0.4 rad per pixel
    // 4 m: the short wave (16 rad) is gone, the long one (0.8 rad) whole.
    expect(waterLostVariance(waves, 4)).toBeCloseTo(0.0018, 12);
    expect(waterLostVariance(waves, 1000)).toBeCloseTo(0.0036, 12);
    expect(() => waterLostVariance(waves, -1)).toThrow(RangeError);
    expect(() => waterLostVariance(waves, Number.NaN)).toThrow(RangeError);
  });

  it('adds variance to GGX alpha squared (three: alpha = roughness squared)', () => {
    expect(waterVarianceRoughness(0.06, 0)).toBeCloseTo(0.06, 12);
    // alpha^2 = 0.06^4 + 0.025 -> roughness 0.3977
    expect(waterVarianceRoughness(0.06, 0.025)).toBeCloseTo(
      (0.06 ** 4 + 0.025) ** 0.25,
      12
    );
    expect(waterVarianceRoughness(0.5, 10)).toBe(1);
    expect(waterVarianceRoughness(0.06, 0.025, 0)).toBeCloseTo(0.06, 12);
  });

  // The sun's disc (0.27 deg radius) widens a mirror's highlight: at three's
  // floor roughness 0.0525 alpha^2 is 7.6e-6, the disc adds 2.2e-5, so the
  // lobe's peak drops about fourfold.
  it('widens the direct highlight by the sun disc', () => {
    const floor = 0.0525;
    const widened = waterSunRoughness(floor);
    expect(widened ** 4).toBeCloseTo(
      floor ** 4 + WATER_POLISH.sunAngularRadiusRad ** 2,
      15
    );
    expect(floor ** 4 / widened ** 4).toBeLessThan(0.3);
    expect(waterSunRoughness(floor, 0)).toBeCloseTo(floor, 12);
    // Negligible where the water is already rough.
    expect(waterSunRoughness(0.4) - 0.4).toBeLessThan(1e-3);
  });

  it('damps the reflection only where the water is rough', () => {
    expect(waterFresnelDampFactor(0.06)).toBeGreaterThan(0.9999);
    expect(waterFresnelDampFactor(0.4)).toBeCloseTo(1 / (1 + 6 * 0.4 ** 4), 12);
    expect(waterFresnelDampFactor(1, 6)).toBeCloseTo(1 / 7, 12);
  });

  it('gusts scale a ripple around 1 and never below 0', () => {
    expect(waterGustGain(0)).toBe(1);
    expect(waterGustGain(1, 0.7)).toBeCloseTo(1.7, 12);
    expect(waterGustGain(-1, 0.7)).toBeCloseTo(0.3, 12);
    expect(waterGustGain(-1, 1)).toBe(0);
  });

  // The second sample travels at ITS OWN deep-water speed (omega^2 = g k),
  // or the rescaled ripples would slide against the first ones.
  it('rotates, rescales and keeps deep-water dispersion', () => {
    const k = 4.27785053;
    const omega = Math.sqrt(9.81 * k);
    const tile = waterTileWave([1, 0], k, omega, Math.PI / 2, 0.5);
    expect(tile.direction[0]).toBeCloseTo(0, 12);
    expect(tile.direction[1]).toBeCloseTo(1, 12);
    expect(tile.k).toBeCloseTo(k / 2, 12);
    expect(tile.omega ** 2).toBeCloseTo(9.81 * tile.k, 9);
  });
});

describe('the polish uniforms', () => {
  it('start at the declared defaults', () => {
    const u = createWaterPolishUniforms();
    expect(u.uWaterPolishVarianceScale.value).toBe(WATER_POLISH.varianceScale);
    expect(u.uWaterPolishSunAlpha2.value).toBeCloseTo(
      (WATER_POLISH.sunSizeScale * WATER_POLISH.sunAngularRadiusRad) ** 2,
      15
    );
    expect(u.uWaterPolishTileRot.value.x).toBeCloseTo(
      Math.cos(WATER_POLISH.tileRotationRad),
      12
    );
    expect(u.uWaterPolishGustDepth.value).toBe(WATER_POLISH.gustDepth);
    expect(u.uWaterPolishCrestSlope.value).toBe(WATER_POLISH.crestSlope);
  });

  // A sweep sets these; a bad value must change NOTHING (not half a set).
  it('validates the whole set before writing any of it', () => {
    const u = createWaterPolishUniforms();
    expect(() =>
      configureWaterPolishUniforms(u, { gustDepth: 0.2, tileScale: 0 })
    ).toThrow(RangeError);
    expect(u.uWaterPolishGustDepth.value).toBe(WATER_POLISH.gustDepth);
    expect(() => configureWaterPolishUniforms(u, { gustDepth: 1.5 })).toThrow(
      RangeError
    );
    expect(() =>
      configureWaterPolishUniforms(u, { crestPower: Number.NaN })
    ).toThrow(RangeError);
    expect(() =>
      configureWaterPolishUniforms(u, { nope: 1 } as unknown as {
        gustDepth: number;
      })
    ).toThrow(RangeError);
    configureWaterPolishUniforms(u, { gustDepth: 0.2, sunSizeScale: 2 });
    expect(u.uWaterPolishGustDepth.value).toBe(0.2);
    expect(u.uWaterPolishSunAlpha2.value).toBeCloseTo(
      (2 * WATER_POLISH.sunAngularRadiusRad) ** 2,
      15
    );
  });
});

describe('buildWaterPolish (the GLSL per switch)', () => {
  it('contributes nothing with every switch off', () => {
    const off = buildWaterPolish({});
    expect(off.active).toBe(false);
    expect(off.slope(CANDIDATE)).toBe(CANDIDATE);
    expect(
      [
        off.declarations,
        off.beforeSlope,
        off.afterMaterial,
        off.afterLightingPars,
      ].join('')
    ).toBe('');
  });

  // Each switch alone touches only its own part of the shader, so "trick N
  // alone" is exactly trick N.
  it('gives each switch only its own hooks', () => {
    const parts = (name: (typeof WATER_POLISH_SWITCHES)[number]) => {
      const g = buildWaterPolish({ [name]: true });
      return {
        hooksWaves: g.slope(CANDIDATE) !== CANDIDATE,
        beforeSlope: g.beforeSlope,
        afterMaterial: g.afterMaterial,
        lighting: g.afterLightingPars,
      };
    };
    const lost = parts('lostVariance');
    expect(lost.hooksWaves).toBe(true);
    expect(lost.beforeSlope).toBe('waterLostVar = 0.0;');
    expect(lost.afterMaterial).toContain('waterLostVar');
    expect(lost.lighting).toBe('');

    const sun = parts('sunSize');
    expect(sun.hooksWaves).toBe(false);
    expect(sun.afterMaterial).toBe('');
    expect(sun.lighting).toContain('uWaterPolishSunAlpha2');
    expect(sun.lighting).not.toContain('uWaterPolishFresnelDamp *');
    expect(sun.lighting).not.toContain('diffuseContribution = vec3(0.0)');

    const fresnel = parts('fresnelDamp');
    expect(fresnel.hooksWaves).toBe(false);
    expect(fresnel.lighting).toContain('uWaterPolishFresnelDamp *');
    expect(fresnel.lighting).not.toContain('uWaterPolishSunAlpha2');

    const tiles = parts('antiTiling');
    expect(tiles.hooksWaves).toBe(true);
    expect(tiles.beforeSlope).toContain('waterTileMask =');
    expect(tiles.beforeSlope).not.toContain('waterGustGain');
    expect(tiles.afterMaterial).toBe('');

    const gusts = parts('gusts');
    expect(gusts.hooksWaves).toBe(true);
    expect(gusts.beforeSlope).toContain('waterGustGain =');
    expect(gusts.beforeSlope).not.toContain('waterTileMask');

    const body = parts('body');
    expect(body.hooksWaves).toBe(false);
    expect(body.lighting).toContain('diffuseContribution = vec3(0.0)');
    expect(body.lighting).toContain('uWaterPolishCrestStrength');
    expect(body.lighting).not.toContain('uWaterPolishSunAlpha2');
  });

  // The hook replaces the wave's ONE slope statement and keeps its own
  // cosine argument, so the wave's term is the same expression as before.
  it("routes the wave set's statement through the hook, keeping its argument", () => {
    const hooked = buildWaterPolish({ gusts: true }).slope(CANDIDATE);
    expect(hooked).toContain(
      'waterPolishWave(q, t, d, k, ak, w, phase, fade, ph - w * t + phase, slope);'
    );
    expect(hooked).not.toContain('slope += fade * ak');
  });

  it('refuses a wave set it cannot hook', () => {
    const polish = buildWaterPolish({ antiTiling: true });
    expect(() =>
      polish.slope('vec2 waterSlopeAt(vec2 p, float t) { return vec2(0.0); }')
    ).toThrow(RangeError);
    // A lighting-only polish does not need the hook.
    const lighting = buildWaterPolish({ body: true });
    expect(
      lighting.slope('vec2 waterSlopeAt(vec2 p, float t) { return vec2(0.0); }')
    ).toContain('waterSlopeAt');
  });
});

// The page's "back to default" writes these; a missing or extra name would
// leave a swept value in place or throw.
describe('WATER_POLISH_DEFAULT_PARAMS', () => {
  it('names every swept constant at its default, and configures cleanly', () => {
    const u = createWaterPolishUniforms();
    configureWaterPolishUniforms(u, { gustDepth: 0.1, varianceScale: 3 });
    configureWaterPolishUniforms(u, WATER_POLISH_DEFAULT_PARAMS);
    expect(u.uWaterPolishGustDepth.value).toBe(WATER_POLISH.gustDepth);
    expect(u.uWaterPolishVarianceScale.value).toBe(WATER_POLISH.varianceScale);
    expect(Object.keys(WATER_POLISH_DEFAULT_PARAMS)).toHaveLength(14);
  });
});
