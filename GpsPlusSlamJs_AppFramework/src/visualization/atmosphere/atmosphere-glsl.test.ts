/**
 * Tests for the generated atmosphere GLSL.
 *
 * Why this file matters: CI has no GPU, so nothing here can prove the shaders
 * compute the right sky (the look-dev smoke's parity readback does that). What
 * CAN be held here are the two ways this module fails silently in three.js:
 * a number written as a GLSL int (`6360` in a float expression is a compile
 * error that only logs), and a helper name that collides with three's own
 * `common` chunk once the haze injects this code into three's programs.
 */
import { describe, expect, it } from 'vitest';

import * as THREE from 'three';

import {
  ATMOSPHERE_CLOUD_GLSL,
  ATMOSPHERE_COMMON_GLSL,
  ATMOSPHERE_MAX_SCENE_RADIANCE,
  MULTI_SCATTERING_LUT_FRAGMENT_GLSL,
  SKY_FRAGMENT_GLSL,
  SKY_VIEW_LUT_FRAGMENT_GLSL,
  TRANSMITTANCE_LUT_FRAGMENT_GLSL,
} from './atmosphere-glsl.js';
import { EARTH_ATMOSPHERE } from './atmosphere-model.js';
import { CLOUD_SHEET_FRAGMENT_GLSL } from './cloud-sheet.js';
import { CLOUD_SLAB_FRAGMENT_GLSL } from './cloud-slab.js';
import { glslFloat } from '../../utils/glsl-float.js';

describe('generated shaders', () => {
  const ALL = {
    common: ATMOSPHERE_COMMON_GLSL,
    transmittance: TRANSMITTANCE_LUT_FRAGMENT_GLSL,
    multiScattering: MULTI_SCATTERING_LUT_FRAGMENT_GLSL,
    skyView: SKY_VIEW_LUT_FRAGMENT_GLSL,
    sky: SKY_FRAGMENT_GLSL,
    // The cloud chunk the dome and the fly-through sheet share, and the sheet.
    clouds: ATMOSPHERE_CLOUD_GLSL,
    cloudSheet: CLOUD_SHEET_FRAGMENT_GLSL,
    // The ray-marched slab (plan 2026-09-24-1010 §11).
    cloudSlab: CLOUD_SLAB_FRAGMENT_GLSL,
  };

  // Every function this module defines must be `atm`-prefixed (or be
  // `main`). three's `common` chunk defines `saturate`, `luminance`,
  // `pow2`… and the haze patch puts this code in the same program.
  it.each(Object.entries(ALL))(
    '%s defines only atm-prefixed functions',
    (_name, source) => {
      const defined = [
        ...source.matchAll(
          /^\s*(?:float|vec[234]|void|bool|int)\s+(\w+)\s*\(/gm
        ),
      ].map((m) => m[1]);
      expect(defined.length).toBeGreaterThan(0);
      for (const name of defined) {
        expect(name === 'main' || name!.startsWith('atm')).toBe(true);
      }
    }
  );

  // The constants come from the model, so the GPU cannot drift from the
  // tested numbers. This is a guard on the interpolation, not on the physics.
  it('carries the model constants', () => {
    expect(ATMOSPHERE_COMMON_GLSL).toContain(
      `ATM_GROUND_RADIUS = ${glslFloat(EARTH_ATMOSPHERE.groundRadiusKm)}`
    );
    expect(ATMOSPHERE_COMMON_GLSL).toContain(
      `ATM_MIE_ALBEDO = ${glslFloat(EARTH_ATMOSPHERE.mieAlbedo)}`
    );
  });

  // The transmittance LUT must integrate with the SAME step count as the CPU
  // oracle, or the parity readback compares two different quadratures.
  it('integrates optical depth with the model step count', () => {
    expect(TRANSMITTANCE_LUT_FRAGMENT_GLSL).toContain(
      `ATM_OPTICAL_DEPTH_STEPS = ${EARTH_ATMOSPHERE.opticalDepthSteps};`
    );
  });
});

describe('the cloud chunk explicit-level noise (plan 2026-09-24-1010 §11.3)', () => {
  // WHY: a march reads the noise inside a loop, where implicit derivatives
  // are undefined; the explicit-level read must be the same two-octave sum,
  // with the second octave one log2(frequency) coarser, as its coordinates
  // are that much denser.
  it('sums the same two octaves through textureLod', () => {
    const fn = ATMOSPHERE_CLOUD_GLSL.slice(
      ATMOSPHERE_CLOUD_GLSL.indexOf('float atmCloudNoiseLod(')
    );
    expect(fn.startsWith('float atmCloudNoiseLod(')).toBe(true);
    const body = fn.slice(0, fn.indexOf('}'));
    expect(body.split('textureLod(')).toHaveLength(3);
    expect(body).toContain('log2(ATM_CLOUD_OCTAVE2_FREQ)');
    expect(body).toContain('ATM_CLOUD_OCTAVE1_WEIGHT');
    expect(body).not.toContain('texture2D(');
  });
});

describe('the visible sky stays finite in a half-float target (M4)', () => {
  // A composer (the look-dev page's desktop bloom tier) renders the sky
  // into a HALF-FLOAT target. The sun disc at golden hour (auto-exposure
  // ×22 × ~15 000× the sky's radiance) overflowed its 65 504 maximum to Inf in
  // red and green, and bloom blurred the Inf across the whole frame: a
  // blue-only picture. The sky's output is clamped below the largest finite
  // half float (from three's own half-float decoder).
  it('clamps its output below the largest finite half float', () => {
    const largestHalf = THREE.DataUtils.fromHalfFloat(0x7bff);
    expect(largestHalf).toBe(65504);
    expect(ATMOSPHERE_MAX_SCENE_RADIANCE).toBeLessThan(largestHalf);
    expect(ATMOSPHERE_MAX_SCENE_RADIANCE).toBeGreaterThan(1000);
    expect(SKY_FRAGMENT_GLSL).toContain(
      'gl_FragColor = vec4(min(radiance * atmRadianceToScene, vec3(ATM_MAX_SCENE_RADIANCE)), 1.0);'
    );
    expect(SKY_FRAGMENT_GLSL).toContain(
      `ATM_MAX_SCENE_RADIANCE = ${glslFloat(ATMOSPHERE_MAX_SCENE_RADIANCE)}`
    );
  });
});

describe('the sun through clouds in the sky (round-3 plan 2026-09-27-0532, DEC-FB3-6)', () => {
  const fnBody = (source: string, signature: string) => {
    const start = source.indexOf(signature);
    expect(start).toBeGreaterThan(0);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
      if (source[i] === '{') depth++;
      if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`unterminated ${signature}`);
  };

  // WHY: the disc is the one term the extinction must reach; a disc added
  // without the factor keeps blazing behind every cloud (the owner's report).
  it('dims the disc by the clouds along the view', () => {
    expect(SKY_FRAGMENT_GLSL).toMatch(
      /atmSampleTransmittance\(atmTransmittanceLut, r, dir\.y\)\s*\*\s*atmCloudDiscTransmittance\(dir\);/
    );
  });

  // WHY: in the slab and sheet modes the visible sky's threshold is 2 (it
  // draws no clouds); the disc must read the REAL threshold, with an
  // explicit level (it runs for disc pixels only: a branch), weighted by how
  // much cloud is drawn there, and be exactly 1 when off.
  it('reads the real threshold, explicitly, and only the drawn cloud', () => {
    const body = fnBody(SKY_FRAGMENT_GLSL, 'float atmCloudDiscTransmittance(');
    expect(body).toContain(
      'if (atmCloudDiscExponent <= 0.0 || atmCloudSunThreshold >= 2.0 || dir.y <= 0.0) return 1.0;'
    );
    expect(body).toContain('atmCloudNoiseLod(');
    expect(body).not.toContain('atmCloudNoise(');
    expect(body).not.toContain('atmCloudThreshold,');
    expect(body).toContain('atmCloudHorizonFade(dir.y)');
    expect(body).toContain('atmCloudFarFadeM');
    expect(body).toContain('exp(-atmCloudDiscExponent * tau * drawn');
  });

  // WHY: the dome's glow must come from the same column along the view,
  // faded like the cloud it belongs to, and be gated by its strength.
  it('adds the forward glow to the dome, faded like its cloud', () => {
    // Each lobe at its own strength: x the aureole, y the silver lining.
    expect(ATMOSPHERE_CLOUD_GLSL).toContain('uniform vec2 atmCloudForward;');
    expect(ATMOSPHERE_CLOUD_GLSL).toContain(
      'atmForwardPhase(dot(dir, atmSunDirection), atmCloudForward)'
    );
    const body = fnBody(SKY_FRAGMENT_GLSL, 'vec3 atmClouds(');
    expect(body).toContain('if (atmCloudForward.x + atmCloudForward.y > 0.0)');
    expect(body).toContain(
      'atmColumnOpticalDepth(noise, atmCloudThreshold, 0.0, dir.y)'
    );
    expect(body).toContain(
      'atmCloudForwardRadiance(dir, r, tau) * fade * aerial'
    );
  });
});
