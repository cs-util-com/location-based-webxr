/**
 * Why this test matters: a preset that used a key the library's override
 * action does not accept would throw at dispatch time, in the field, when the
 * tester taps it - and the wheel is only ever used in the field. The library
 * exports its whitelist precisely so this is pinned at test time instead.
 * The shipped entry must stay `null` (clearing, not "a preset that happens to
 * equal the defaults"), ids are dropdown values that must be unique, and the
 * labels must state the memory DIRECTION of the recency factor, because the
 * first draft called recency 100 "memory 100" and the owner read it as
 * shorter than shipped (it is longer: the factor is a penalty steepness).
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

  it('carries the stage-2 field-judgement rows and the robust arm, in dropdown order', () => {
    // The order is the order of the dropdown: the shipped default, the two
    // stage-2 survivors, then the rows that failed the cross-session guardrail
    // and say so in their label, then the robust-solver arm.
    expect(ALIGNMENT_PRESETS.map((p) => p.id)).toEqual([
      'shipped',
      'f100',
      'f100-exp075',
      'f25-exp075',
      'calm-ret04',
      'calm-none-exp075',
      'f25-none-exp1',
      'f25-thr7-ret04-exp1',
      'f50-robust-exp1',
    ]);
    expect(findAlignmentPreset('calm-ret04')?.overrides).toEqual({
      timeWeightEnabled: false,
      outlierRetainRatio: 0.4,
    });
    expect(findAlignmentPreset('calm-none-exp075')?.overrides).toEqual({
      timeWeightEnabled: false,
      outlierRejectionEnabled: false,
      gpsAccuracyExponent: 0.75,
    });
    for (const id of [
      'f25-exp075',
      'calm-ret04',
      'calm-none-exp075',
      'f25-none-exp1',
      'f25-thr7-ret04-exp1',
    ]) {
      expect(findAlignmentPreset(id)?.label, id).toMatch(/agreement −\d\.\d°/);
    }
  });

  it('exactly one preset enables the robust solver, so the heading-penalty box has a home', () => {
    const robust = ALIGNMENT_PRESETS.filter(
      (p) => p.overrides?.robustSolverEnabled === true
    );
    expect(robust.map((p) => p.id)).toEqual(['f50-robust-exp1']);
  });

  it('names the recency factor "recency N", never "memory N", and says the direction for the survivors', () => {
    for (const p of ALIGNMENT_PRESETS) {
      expect(p.label, p.id).not.toMatch(/memory \d/);
    }
    const withFactor = ALIGNMENT_PRESETS.filter(
      (p) => typeof p.overrides?.timeWeightFactor === 'number'
    );
    expect(withFactor.length).toBeGreaterThan(0);
    for (const p of withFactor) {
      expect(p.label, p.id).toMatch(
        new RegExp(`recency ${p.overrides!.timeWeightFactor}\\b`)
      );
    }
    const noRecency = ALIGNMENT_PRESETS.filter(
      (p) => p.overrides?.timeWeightEnabled === false
    );
    expect(noRecency.length).toBeGreaterThan(0);
    for (const p of noRecency) {
      expect(p.label, p.id).toMatch(/^no recency/);
    }
    expect(findAlignmentPreset('f100')?.label).toContain('longer memory');
    expect(findAlignmentPreset('f100-exp075')?.label).toContain(
      'longer memory'
    );
  });
});
