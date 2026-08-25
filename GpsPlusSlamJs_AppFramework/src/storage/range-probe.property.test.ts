import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { decideFallback, parseContentRangeTotal } from './range-probe.js';

/**
 * Why these tests matter: `decideFallback` is the whole open policy and
 * `parseContentRangeTotal` feeds it sizes parsed from a hostile network. The
 * invariants that must hold for ANY input, not just the tabled cases: the
 * decision is total (always one of the four modes, never a throw), mode
 * `ranges` never escapes with an unusable size (a bogus size anchors every
 * zip offset — the corruption class D3 closed), and the header parser never
 * throws and never returns an unsafe integer.
 */

const SIZE_ARB = fc.oneof(
  fc.constant(null),
  fc.integer({ min: -10, max: 1_000_000 }),
  fc.double({ noNaN: false }),
  fc.constant(Number.NaN),
  fc.constant(Number.MAX_SAFE_INTEGER + 2)
);

describe('decideFallback — properties', () => {
  it('is total, and mode "ranges" always carries a safe non-negative size', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 599 }),
        SIZE_ARB,
        fc.option(fc.uint8Array({ maxLength: 32 }), { nil: undefined }),
        (status, size, body) => {
          const decision = decideFallback({
            status,
            size,
            ...(body !== undefined ? { body } : {}),
          });
          expect([
            'ranges',
            'eager-local',
            'full-download',
            'reject',
          ]).toContain(decision.mode);
          // Unconditional form (vitest/no-conditional-expect): every non-
          // 'ranges' decision satisfies the size invariant vacuously.
          const rangesSizeInvariantHolds =
            decision.mode !== 'ranges' ||
            (Number.isSafeInteger(decision.size) && decision.size >= 0);
          expect(rangesSizeInvariantHolds).toBe(true);
        }
      )
    );
  });
});

describe('parseContentRangeTotal — properties', () => {
  it('round-trips any safe non-negative total', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        (total) => {
          expect(parseContentRangeTotal(`bytes 0-0/${total}`)).toBe(total);
          expect(parseContentRangeTotal(`bytes */${total}`)).toBe(total);
        }
      )
    );
  });

  it('never throws and only ever returns null or a safe integer', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 64 }), (header) => {
        const total = parseContentRangeTotal(header);
        expect(total === null || Number.isSafeInteger(total)).toBe(true);
      })
    );
  });
});
