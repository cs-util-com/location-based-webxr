/**
 * Why this test matters: the timing validator must decide every segment
 * list the same way, not only the examples in `tour-timing.test.ts`: a
 * list that keeps every structural rule always reads back unchanged, a
 * list with exactly one rule broken is always refused with
 * `TourTimingError` (never another error, never accepted), and the range
 * check never throws and is null exactly when every offset fits the text
 * and every time fits the narration.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  parseTourTiming,
  TourTimingError,
  tourTimingStaleReason,
} from './tour-timing';

const HASH = `sha256:${'c'.repeat(64)}`;

/** A well-formed segment list: ordered starts, from < to, start <= end. */
const segmentsArb = fc
  .array(
    fc.record({
      gap: fc.nat(500),
      length: fc.nat(800),
      from: fc.nat(5_000),
      width: fc.integer({ min: 1, max: 40 }),
    }),
    { maxLength: 60 }
  )
  .map((raw) => {
    let start = 0;
    return raw.map(({ gap, length, from, width }) => {
      start += gap;
      return {
        startMs: start,
        endMs: start + length,
        from,
        to: from + width,
      };
    });
  });

const timingOf = (segments: unknown[]) => ({
  granularity: 'word',
  source: 'file',
  textHash: HASH,
  segments,
});

describe('parseTourTiming over any segment list', () => {
  it('reads every well-formed list back unchanged', () => {
    fc.assert(
      fc.property(segmentsArb, (segments) => {
        expect(parseTourTiming(timingOf(segments)).segments).toEqual(segments);
      })
    );
  });

  it('refuses every list with one structural rule broken', () => {
    const breakers: ((s: Record<string, number>) => Record<string, unknown>)[] =
      [
        (s) => ({ ...s, from: s.to }),
        (s) => ({ ...s, endMs: (s.startMs ?? 0) - 1 }),
        (s) => ({ ...s, from: -1 }),
        (s) => ({ ...s, to: (s.to ?? 0) + 0.5 }),
        (s) => ({ ...s, startMs: String(s.startMs) }),
        ({ endMs: _gone, ...s }) => s,
      ];
    fc.assert(
      fc.property(
        segmentsArb.filter((s) => s.length > 0),
        fc.nat(),
        fc.nat(breakers.length - 1),
        (segments, pick, how) => {
          const i = pick % segments.length;
          const broken: unknown[] = segments.map((s, j) =>
            j === i ? breakers[how]?.(s) : s
          );
          expect(() => parseTourTiming(timingOf(broken))).toThrow(
            TourTimingError
          );
        }
      )
    );
  });

  it('refuses every list whose starts step back in time', () => {
    fc.assert(
      fc.property(
        segmentsArb.filter((s) => s.length >= 2 && (s[1]?.startMs ?? 0) > 0),
        (segments) => {
          const [a, b, ...rest] = segments;
          if (a === undefined || b === undefined) return;
          const later = { ...a, startMs: b.startMs, endMs: b.startMs };
          const earlier = { ...b, startMs: b.startMs - 1, endMs: b.endMs };
          expect(() =>
            parseTourTiming(timingOf([later, earlier, ...rest]))
          ).toThrow(TourTimingError);
        }
      )
    );
  });

  it('is stale exactly when an offset or a time does not fit', () => {
    fc.assert(
      fc.property(
        segmentsArb,
        fc.nat(6_000),
        fc.option(fc.nat(40_000), { nil: undefined }),
        (segments, plainLength, durationMs) => {
          const timing = parseTourTiming(timingOf(segments));
          const reason = tourTimingStaleReason(timing, {
            plainLength,
            textHash: HASH,
            ...(durationMs === undefined ? {} : { durationMs }),
          });
          const fits =
            segments.length > 0 &&
            segments.every(
              (s) =>
                s.to <= plainLength &&
                (durationMs === undefined || s.endMs <= durationMs)
            );
          expect(reason === null).toBe(fits);
        }
      )
    );
  });
});
