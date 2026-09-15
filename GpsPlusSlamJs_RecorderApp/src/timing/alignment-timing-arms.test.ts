import { describe, it, expect } from 'vitest';
import { ALIGNMENT_OVERRIDE_KEYS } from 'gps-plus-slam-app-framework/state';
import {
  TIMING_ARMS,
  HISTORY_LADDER,
  REPEAT_OPTIONS,
  DEFAULT_REPEATS,
  WARMUP_PASSES,
  SHIPPED_ARM_ID,
} from './alignment-timing-arms';

describe('the timing arms', () => {
  // Why this test matters: an override key the library does not know is
  // rejected at dispatch, and a page that silently measured the shipped
  // configuration four times would produce four agreeing columns that look
  // like a stable measurement. The whitelist is the library's own, imported
  // rather than retyped, so a key removed upstream fails here.
  it('uses only keys from the published override whitelist', () => {
    const allowed = new Set<string>(ALIGNMENT_OVERRIDE_KEYS);
    for (const arm of TIMING_ARMS) {
      for (const key of Object.keys(arm.overrides ?? {})) {
        expect(
          allowed.has(key),
          `arm "${arm.id}" sets "${key}", which is not a public override key`
        ).toBe(true);
      }
    }
  });

  // Why this test matters: the shipped arm is the denominator of every ratio a
  // reader will compute, and `null` (not `{}`) is what clears a previous
  // preset - `setAlignmentOverrides` REPLACES rather than merges.
  it('starts from the shipped configuration, expressed as null', () => {
    expect(TIMING_ARMS[0]?.id).toBe(SHIPPED_ARM_ID);
    expect(TIMING_ARMS[0]?.overrides).toBeNull();
  });

  it('gives every arm a distinct id and a label', () => {
    const ids = TIMING_ARMS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const arm of TIMING_ARMS) {
      expect(arm.label.length).toBeGreaterThan(0);
    }
  });

  // Why this test matters: these are the page's parameters, and the standing
  // rule is that a verdict from one parameter value is provisional. The
  // default must be one of the offered repeat counts, and the ladder must be
  // ordered - a reversed rung would produce a negative-width segment.
  it('offers a swept repeat count and an ordered ladder', () => {
    expect(REPEAT_OPTIONS).toContain(DEFAULT_REPEATS);
    expect([...REPEAT_OPTIONS].sort((a, b) => a - b)).toEqual([
      ...REPEAT_OPTIONS,
    ]);
    expect([...HISTORY_LADDER].sort((a, b) => a - b)).toEqual([
      ...HISTORY_LADDER,
    ]);
    expect(WARMUP_PASSES).toBeGreaterThanOrEqual(1);
  });
});
