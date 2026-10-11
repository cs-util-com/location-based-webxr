import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  advanceMatureAlignmentPick,
  isMatureAlignment,
  isUsableAlignment,
  openMatureAlignmentPick,
  type AlignmentMoment,
} from './alignment-maturity.js';

const ZERO = { lat: 48.1, lon: 11.5 };

type Tagged = AlignmentMoment & { readonly tag: number };

const momentArb = (tag: number): fc.Arbitrary<Tagged> =>
  fc
    .record({
      extent: fc.oneof(
        fc.double({ min: 0, max: 300, noNaN: true }),
        fc.constant(Number.NaN),
        fc.constant(undefined)
      ),
      usable: fc.boolean(),
    })
    .map(({ extent, usable }) => ({
      tag,
      alignmentMatrix: usable
        ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tag, 0, 0, 1]
        : null,
      zero: ZERO,
      ...(extent === undefined ? {} : { gpsExtentM: extent }),
    }));

const sequenceArb = fc
  .integer({ min: 1, max: 30 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => momentArb(i))));

/** The definition, by search: the first mature moment of the sequence (the
 *  event's own moment first); else the last usable one; else the event's. */
function byDefinition(moments: readonly Tagged[], floorM: number): number {
  const first = moments.find((m) => isMatureAlignment(m, floorM));
  if (first !== undefined) return first.tag;
  const usable = moments.filter((m) => isUsableAlignment(m));
  return (usable.at(-1) ?? moments[0]!).tag;
}

describe('alignment maturity (property)', () => {
  // Why this test matters: the pick is folded one alignment change at a
  // time in three places (the QR mint, the GPS anchor, the authoring
  // settle); whatever the sequence, the fold must equal the rule it
  // implements, stated as a search over the whole history.
  it('folds to the first mature alignment at or after the event, else the last usable one', () => {
    fc.assert(
      fc.property(
        sequenceArb,
        fc.double({ min: 1, max: 200, noNaN: true }),
        (moments, floorM) => {
          let pick = openMatureAlignmentPick(moments[0]!, floorM);
          for (const m of moments.slice(1)) {
            pick = advanceMatureAlignmentPick(pick, m, floorM);
          }
          expect(pick.alignment.tag).toBe(byDefinition(moments, floorM));
          expect(pick.mature).toBe(isMatureAlignment(pick.alignment, floorM));
        }
      )
    );
  });

  // Why this test matters: "fixed once mature" is the property the left-
  // behind fix rests on - no later alignment, however different, may move
  // an object whose pick has matured.
  it('never moves a mature pick', () => {
    fc.assert(
      fc.property(
        sequenceArb,
        fc.double({ min: 1, max: 200, noNaN: true }),
        (moments, floorM) => {
          let pick = openMatureAlignmentPick(moments[0]!, floorM);
          // The tag the pick first froze on, and every tag it ends a later
          // step on.
          let frozenTag: number | null = pick.mature
            ? pick.alignment.tag
            : null;
          const later: number[] = [];
          for (const m of moments.slice(1)) {
            pick = advanceMatureAlignmentPick(pick, m, floorM);
            if (frozenTag !== null) later.push(pick.alignment.tag);
            else if (pick.mature) frozenTag = pick.alignment.tag;
          }
          expect(later.every((t) => t === frozenTag)).toBe(true);
        }
      )
    );
  });
});
