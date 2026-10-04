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

  /**
   * Why this test matters: the ladder is the field test. If two rungs differ in
   * anything but the window length, an impression formed in the street cannot be
   * attributed - which is exactly how the offline programme wasted a comparison
   * on a "90 s window" arm that still had recency decay running underneath it.
   */
  it('is one ladder: every rung varies only the window, and only downward from whole-session', () => {
    const rungs = ALIGNMENT_PRESETS.filter((p) => p.id.startsWith('w'));
    expect(rungs.map((p) => p.id)).toEqual([
      'w45',
      'w90',
      'w180',
      'w300',
      'wall',
    ]);

    const allowedRungKeys = new Set([
      'timeWeightEnabled',
      'recentWindowSeconds',
    ]);
    for (const p of rungs) {
      for (const key of Object.keys(p.overrides ?? {})) {
        expect(allowedRungKeys.has(key), `${p.id}: ${key}`).toBe(true);
      }
      // Without this, the oldest fix inside the window is still weighted 251x
      // lighter than the newest and the window is not the variable under test.
      expect(p.overrides?.timeWeightEnabled, p.id).toBe(false);
    }

    const bounded = rungs.filter(
      (p) => typeof p.overrides?.recentWindowSeconds === 'number'
    );
    expect(bounded.map((p) => p.overrides!.recentWindowSeconds)).toEqual([
      45, 90, 180, 300,
    ]);

    // The unbounded rung carries NO window key at all. It cannot: there is no
    // public override that sets useOnlyRecentData back to false, so it depends
    // on the shipped default plus setAlignmentOverrides replacing rather than
    // merging. If that ever became a merge, this rung would silently inherit
    // the previously selected rung's window - see the plan, section 3.3.
    expect(findAlignmentPreset('wall')?.overrides).toEqual({
      timeWeightEnabled: false,
    });
    expect(findAlignmentPreset('nope')).toBeUndefined();
  });

  it('keeps the shipped baseline and the robust arm, and nothing from the confounded scorecard', () => {
    expect(ALIGNMENT_PRESETS.map((p) => p.id)).toEqual([
      'shipped',
      'w45',
      'w90',
      'w180',
      'w300',
      'wall',
      'f50-robust-exp1',
    ]);
    // Removed 2026-09-12: every one of these was built on the scorecard whose
    // exponent axis is confounded (raising gpsAccuracyExponent also squashes
    // the recency span, because the kernel ADDS the two terms), and each varied
    // two or three knobs at once.
    for (const gone of [
      'f100',
      'f100-exp075',
      'f25-exp075',
      'calm-ret04',
      'calm-none-exp075',
      'f25-none-exp1',
      'f25-thr7-ret04-exp1',
    ]) {
      expect(findAlignmentPreset(gone), gone).toBeUndefined();
    }
  });

  it('exactly one preset enables the robust solver, so the heading-penalty box has a home', () => {
    const robust = ALIGNMENT_PRESETS.filter(
      (p) => p.overrides?.consensusSolverEnabled === true
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
    // The ladder rungs are all timeWeightEnabled:false, so the "no recency"
    // prefix rule above covers every one of them. That guard exists because the
    // owner once misread a label's direction, which is why the rungs are not
    // called "flat" however much shorter that would read.
    expect(noRecency.map((p) => p.id)).toEqual([
      'w45',
      'w90',
      'w180',
      'w300',
      'wall',
    ]);
  });
});
