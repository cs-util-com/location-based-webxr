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

  it('on the seeded generator', () => {
    const a = framework.aoNoiseRandom(designSystem.AO_NOISE_SEED);
    const b = designSystem.aoNoiseRandom(designSystem.AO_NOISE_SEED);
    for (let i = 0; i < 16; i++) expect(a()).toBe(b());
  });
});
