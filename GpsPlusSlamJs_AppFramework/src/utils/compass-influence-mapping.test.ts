/**
 * Why this test matters: the 0-end of a compass-influence slider is the whole
 * reason this mapping exists as a module. The library's steady-state weight is
 * `clamp01((1 − obs) + obs·trust·weight)`, which at `weight = 0` is
 * `1 − observability` - a FULL compass override at low observability - and
 * switching the rotation prior off falls through to the cold-start override,
 * whose curve is identical and which is default-ON. So a genuine zero takes
 * THREE settings, and a slider that dispatches fewer ships a zero end where the
 * compass still drives. That is not observable from any UI; it is only
 * observable here. Shared by two apps since 2026-09-02, so it is pinned once.
 */

import { describe, expect, it } from 'vitest';
import {
  compassSettingsFor,
  silentCompassSettings,
  type CompassExperiments,
} from './compass-influence-mapping.js';

const EXPERIMENTS: CompassExperiments = {
  rotationPriorEnabled: true,
  trustGateMode: 'ramp',
  pairSelectionEnabled: true,
  trustToleranceDeg: 15,
  webXRConsistencyEnabled: false,
};

describe('compassSettingsFor', () => {
  it('silences the compass COMPLETELY at zero, which takes three settings', () => {
    const s = compassSettingsFor(0, EXPERIMENTS);
    expect(s.rotationPriorEnabled).toBe(false);
    expect(s.coldStartOverrideEnabled).toBe(false);
    expect(s.voteWeight).toBe(0);
    expect(s).toEqual(silentCompassSettings(EXPERIMENTS));
  });

  it('stays genuinely silent at zero whatever the experiments say', () => {
    // "GPS only" is the control arm of every comparison; no experiment toggle
    // may reintroduce a compass switch at zero.
    const s = compassSettingsFor(0, {
      ...EXPERIMENTS,
      pairSelectionEnabled: true,
      webXRConsistencyEnabled: true,
    });
    expect(s.pairSelectionEnabled).toBe(false);
    expect(s.webXRConsistencyEnabled).toBe(false);
    expect(s.rotationPriorEnabled).toBe(false);
  });

  it("carries the app's gate mode and tolerance even at zero - inert without a prior, and the app's call", () => {
    const s = compassSettingsFor(0, {
      ...EXPERIMENTS,
      trustGateMode: 'latch',
      trustToleranceDeg: 25,
    });
    expect(s.trustGateMode).toBe('latch');
    expect(s.trustToleranceDeg).toBe(25);
  });

  it('turns the cold-start override OFF at every non-zero position while the prior is on', () => {
    for (const influence of [0.05, 0.1, 0.5, 1]) {
      const s = compassSettingsFor(influence, EXPERIMENTS);
      expect(s.rotationPriorEnabled).toBe(true);
      expect(s.coldStartOverrideEnabled).toBe(false);
    }
  });

  it('hands back to the validated Stage 0 when the prior is switched off - the override flips ON', () => {
    // Without this half "prior off" would mean "no compass at all" rather than
    // the baseline the experiment is compared against.
    const s = compassSettingsFor(0.5, {
      ...EXPERIMENTS,
      rotationPriorEnabled: false,
    });
    expect(s.rotationPriorEnabled).toBe(false);
    expect(s.coldStartOverrideEnabled).toBe(true);
    expect(s.voteWeight).toBe(0.5);
  });

  it('passes the influence straight through as the vote weight and carries every experiment', () => {
    const s = compassSettingsFor(0.35, EXPERIMENTS);
    expect(s.voteWeight).toBe(0.35);
    expect(s.trustGateMode).toBe('ramp');
    expect(s.pairSelectionEnabled).toBe(true);
    expect(s.trustToleranceDeg).toBe(15);
    expect(s.webXRConsistencyEnabled).toBe(false);
  });

  it('clamps out of range rather than dispatching an invalid weight, ASYMMETRICALLY', () => {
    // A clamped −0.5 reaches 0 and is genuinely silent; a clamped 1.5 reaches
    // 1 - FULL influence, not silence.
    expect(compassSettingsFor(-0.5, EXPERIMENTS)).toEqual(
      silentCompassSettings(EXPERIMENTS)
    );
    const high = compassSettingsFor(1.5, EXPERIMENTS);
    expect(high.voteWeight).toBe(1);
    expect(high.rotationPriorEnabled).toBe(true);
  });

  it('treats a non-finite influence as fully off', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(compassSettingsFor(bad, EXPERIMENTS)).toEqual(
        silentCompassSettings(EXPERIMENTS)
      );
    }
  });
});
