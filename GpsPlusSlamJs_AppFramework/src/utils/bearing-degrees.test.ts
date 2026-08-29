/**
 * Why this test matters: six unnamed copies of this expression lived in this
 * package, and the one property that separates the correct form from the
 * copies — exact idempotence on already-in-range input — is invisible unless
 * something asserts it. The `360 − ε` case is a real fast-check counterexample
 * from the core library (`−2.842e−14`, 2026-07-20); without the early return
 * it returns 0, a full turn that never happened.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { normalizeBearingDeg } from './bearing-degrees';

/** The bare form the six copies used, kept as the differential oracle. */
const bareDoubleMod = (deg: number): number => ((deg % 360) + 360) % 360;

describe('normalizeBearingDeg', () => {
  it('wraps negative and over-turn inputs into [0, 360)', () => {
    expect(normalizeBearingDeg(-90)).toBe(270);
    expect(normalizeBearingDeg(450)).toBe(90);
    expect(normalizeBearingDeg(-360)).toBe(0);
    expect(normalizeBearingDeg(720)).toBe(0);
  });

  it('returns already-in-range input EXACTLY, losing no precision', () => {
    // The bare form round-trips through `x + 360`, which is not exactly
    // representable: this is the silent half of the bug, present in all six
    // copies and invisible to any range assertion.
    for (const deg of [0.1, 123.456, 1e-9, 359.9]) {
      expect(normalizeBearingDeg(deg)).toBe(deg);
    }
    expect(bareDoubleMod(0.1)).not.toBe(0.1);
  });

  it('does not snap 360 − ε to zero (the library fast-check counterexample)', () => {
    const justUnder = 359.99999999999994;
    expect(bareDoubleMod(justUnder)).toBe(0); // the defect, pinned
    expect(normalizeBearingDeg(justUnder)).toBe(justUnder);
  });

  it('is in range and idempotent for any finite input', () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        (deg) => {
          const once = normalizeBearingDeg(deg);
          expect(once).toBeGreaterThanOrEqual(0);
          expect(once).toBeLessThan(360);
          // Idempotence is the contract the early return buys: normalizing an
          // already-normalized bearing must be a no-op, so a consumer that
          // re-normalizes cannot drift.
          expect(normalizeBearingDeg(once)).toBe(once);
        }
      )
    );
  });

  it('propagates NaN rather than inventing a bearing', () => {
    expect(normalizeBearingDeg(Number.NaN)).toBeNaN();
  });
});
