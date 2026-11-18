// Why this test matters: the ambient occlusion exists twice. The design
// system's look-dev page runs its own copy inside an effect composer (the
// page cannot import the framework), and the framework's copy is what the 3D
// apps run. The look was chosen on the look-dev page, so its values are the
// specification: a radius, thickness or denoise weight re-tuned in one copy
// only would make the apps quietly stop looking like what was chosen. The
// FADE WINDOW is the one deliberate difference: each consumer passes the
// distance at which its own haze takes over, so it is excluded here.
import { describe, expect, it } from 'vitest';

import * as designSystem from '../../GpsPlusSlamJs_DesignSystem/3d/ambient-occlusion.js';
import * as framework from '../../GpsPlusSlamJs_AppFramework/src/visualization/ambient-occlusion.ts';
import { mulberry32 } from '../../GpsPlusSlamJs_AppFramework/src/utils/mulberry32.ts';

const FADE_FIELDS = ['fadeStartM', 'fadeEndM'];

const withoutFade = (params) =>
  Object.fromEntries(
    Object.entries(params).filter(([key]) => !FADE_FIELDS.includes(key))
  );

describe('the two ambient occlusion copies agree', () => {
  it('on every AO parameter except the fade window', () => {
    expect(withoutFade(framework.AO_PARAMS)).toEqual(
      withoutFade(designSystem.AO_PARAMS)
    );
    // The exclusion is deliberate, not a missing field.
    for (const key of FADE_FIELDS) {
      expect(framework.AO_PARAMS).toHaveProperty(key);
      expect(designSystem.AO_PARAMS).toHaveProperty(key);
    }
  });

  it('on the denoise parameters and the noise seed', () => {
    expect(framework.AO_DENOISE).toEqual(designSystem.AO_DENOISE);
    expect(framework.AO_NOISE_SEED).toBe(designSystem.AO_NOISE_SEED);
  });

  // The framework's AO draws from the package's one generator
  // (`utils/mulberry32.ts`), which the live clouds share, so the pin holds
  // that generator itself to the look-dev copy as well as the AO's use of it.
  it('on the seeded generator', () => {
    for (const seed of [designSystem.AO_NOISE_SEED, 0, 7, -1, 0xffffffff]) {
      const ao = framework.aoNoiseRandom(seed);
      const shared = mulberry32(seed);
      const lookDev = designSystem.aoNoiseRandom(seed);
      for (let i = 0; i < 16; i++) {
        const expected = lookDev();
        expect(ao(), `AO, seed ${seed}`).toBe(expected);
        expect(shared(), `shared generator, seed ${seed}`).toBe(expected);
      }
    }
  });
});
