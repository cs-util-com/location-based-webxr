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
