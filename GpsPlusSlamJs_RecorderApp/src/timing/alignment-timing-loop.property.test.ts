import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { resolveLadder, runAlignmentTiming } from './alignment-timing-loop';

/**
 * Property-based cover for the ladder arithmetic.
 *
 * Why these properties matter: the ladder is the axis the whole reading is
 * quoted against, and it is assembled from page-authored rungs crossed with a
 * fix count that comes from whatever recording the owner picked. The
 * example-based tests pin the cases a human thought of; these pin the ones
 * nobody did - a rung equal to the fix count, a recording shorter than every
 * rung, a ladder given out of order.
 */
describe('the resolved ladder', () => {
  const ladderArb = fc.uniqueArray(fc.integer({ min: 1, max: 5000 }), {
    minLength: 1,
    maxLength: 8,
  });
  const fixCountArb = fc.integer({ min: 1, max: 5000 });

  it('is strictly increasing and ends at the full history', () => {
    fc.assert(
      fc.property(ladderArb, fixCountArb, (ladder, fixCount) => {
        const rungs = resolveLadder(ladder, fixCount);
        expect(rungs.at(-1)).toBe(fixCount);
        for (let i = 1; i < rungs.length; i++) {
          expect(rungs[i]!).toBeGreaterThan(rungs[i - 1]!);
        }
        expect(rungs.every((r) => r <= fixCount)).toBe(true);
      })
    );
  });

  it('contains every requested rung that is strictly inside the recording', () => {
    fc.assert(
      fc.property(ladderArb, fixCountArb, (ladder, fixCount) => {
        const rungs = resolveLadder(ladder, fixCount);
        const expected = ladder
          .filter((r) => r < fixCount)
          .sort((a, b) => a - b);
        expect(rungs.slice(0, expected.length)).toEqual(expected);
      })
    );
  });
});

describe('the segments of a run', () => {
  /**
   * Why this property matters: every fix must be charged to exactly one
   * segment. A gap would quietly drop solves out of the reported cost and an
   * overlap would charge some of them twice - both produce a plausible-looking
   * table whose numbers are wrong in a direction the reader cannot see.
   */
  it('partition the whole recording exactly once, in order', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.integer({ min: 1, max: 400 }), {
          minLength: 1,
          maxLength: 5,
        }),
        fc.integer({ min: 1, max: 400 }),
        fc.integer({ min: 1, max: 3 }),
        async (ladder, fixCount, repeats) => {
          let clock = 0;
          const result = await runAlignmentTiming({
            armIds: ['a'],
            fixCount,
            ladder,
            repeats,
            warmups: 0,
            createPass: () => () => {
              clock += 1;
            },
            now: () => clock,
          });
          const segments = result.arms[0]!.segments;
          expect(segments[0]!.fromHistory).toBe(0);
          expect(segments.at(-1)!.toHistory).toBe(fixCount);
          let covered = 0;
          for (const s of segments) {
            expect(s.fromHistory).toBe(covered);
            expect(s.toHistory).toBeGreaterThan(s.fromHistory);
            expect(s.fixCount).toBe(s.toHistory - s.fromHistory);
            covered = s.toHistory;
          }
          expect(covered).toBe(fixCount);
        }
      ),
      { numRuns: 60 }
    );
  });
});
