/**
 * Why this test matters: a preset that used a key the library's override
 * action does not accept would throw at dispatch time, in the field, when the
 * tester taps it - and the wheel is only ever used in the field. The library
 * exports its whitelist precisely so this is pinned at test time instead.
 * The shipped entry must stay `null` (clearing, not "a preset that happens to
 * equal the defaults"), and ids are dropdown values that must be unique.
 */

import { describe, expect, it } from 'vitest';
import { ALIGNMENT_OVERRIDE_KEYS } from 'gps-plus-slam-app-framework/state';
import {
  ALIGNMENT_PRESETS,
  SHIPPED_PRESET_ID,
  findAlignmentPreset,
} from './alignment-presets';

describe('ALIGNMENT_PRESETS', () => {
  it('starts with the shipped entry, whose overrides are null (clear), and has unique ids', () => {
    expect(ALIGNMENT_PRESETS[0]!.id).toBe(SHIPPED_PRESET_ID);
    expect(ALIGNMENT_PRESETS[0]!.overrides).toBeNull();
    const ids = ALIGNMENT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses only keys the library override action accepts', () => {
    const allowed = new Set<string>(ALIGNMENT_OVERRIDE_KEYS);
    for (const p of ALIGNMENT_PRESETS) {
      for (const key of Object.keys(p.overrides ?? {})) {
        expect(allowed.has(key), `${p.id}: ${key}`).toBe(true);
      }
    }
  });

  it('carries the three scorecard candidates with their measured knobs', () => {
    expect(findAlignmentPreset('f100')?.overrides).toEqual({
      timeWeightFactor: 100,
    });
    expect(findAlignmentPreset('f100-exp075')?.overrides).toEqual({
      timeWeightFactor: 100,
      gpsAccuracyExponent: 0.75,
    });
    expect(findAlignmentPreset('f25-exp075')?.overrides).toEqual({
      timeWeightFactor: 25,
      gpsAccuracyExponent: 0.75,
    });
    expect(findAlignmentPreset('nope')).toBeUndefined();
  });
});
