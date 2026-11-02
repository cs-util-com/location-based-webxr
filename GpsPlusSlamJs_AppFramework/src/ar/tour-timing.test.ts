/**
 * Why this test matters: a narrated long text's read-along timing is a
 * file a creator tool writes and a viewer reads only when the text opens.
 * Two kinds of fault must stay apart: a STRUCTURAL fault (a wrong shape)
 * is a creator-tool bug and fails loud, so it is found when the tour is
 * made; a RANGE fault (the track no longer fits the text, because the
 * text was edited after the track was made) is ordinary life, and the
 * visitor must just get the plain text. A fault filed in the wrong kind
 * either breaks a tour over an edit or hides a broken writer. Every rule
 * is pinned here, each at its edge.
 */

import { describe, expect, it } from 'vitest';

import {
  parseTourTiming,
  parseTourTimingText,
  TOUR_TIMING_MAX_ANCHORS,
  TOUR_TIMING_MAX_BYTES,
  TOUR_TIMING_MAX_SEGMENTS,
  tourTimingEntryName,
  TourTimingError,
  tourTimingStaleReason,
} from './tour-timing';

const HASH = `sha256:${'a'.repeat(64)}`;

function track(overrides: Record<string, unknown> = {}) {
  return {
    granularity: 'word',
    source: 'file',
    textHash: HASH,
    segments: [
      { startMs: 0, endMs: 300, from: 0, to: 5, text: 'Hello' },
      { startMs: 300, endMs: 700, from: 6, to: 11 },
    ],
    ...overrides,
  };
}

function segment(overrides: Record<string, unknown>) {
  return track({
    segments: [{ startMs: 0, endMs: 10, from: 0, to: 1, ...overrides }],
  });
}

describe('tourTimingEntryName', () => {
  // Why: the name reaches a zip path, so an id that is not a tour id must
  // never name an entry (a slash or dots would name another folder).
  it('names timing/<id>.json and refuses an unsafe id', () => {
    expect(tourTimingEntryName('t1')).toBe('timing/t1.json');
    expect(tourTimingEntryName('A-b_9')).toBe('timing/A-b_9.json');
    for (const bad of ['', '../x', 'a/b', 'a.b', 'x'.repeat(65)]) {
      expect(() => tourTimingEntryName(bad)).toThrow(TypeError);
    }
    expect(() => tourTimingEntryName(7 as unknown as string)).toThrow(
      TypeError
    );
  });
});

describe('parseTourTiming: the structure', () => {
  // Why: the plain case must read back field for field, `text` included,
  // so a viewer and the editor see the same track.
  it('reads a well-formed track', () => {
    const timing = parseTourTiming(track());
    expect(timing).toEqual({
      granularity: 'word',
      source: 'file',
      textHash: HASH,
      segments: [
        { startMs: 0, endMs: 300, from: 0, to: 5, text: 'Hello' },
        { startMs: 300, endMs: 700, from: 6, to: 11 },
      ],
    });
  });

  // Why: unknown fields are how a later format adds to the file; an
  // older reader must ignore them, not refuse the track.
  it('ignores unknown fields', () => {
    const timing = parseTourTiming(track({ voice: 'x', extra: [1] }));
    expect(timing).not.toHaveProperty('voice');
  });

  // Why: every structural rule of the format fails the track, each with
  // the error class a viewer catches.
  it.each([
    ['not an object', null],
    ['an array', []],
    ['an unknown granularity', track({ granularity: 'syllable' })],
    ['a missing granularity', track({ granularity: undefined })],
    ['an unknown source', track({ source: 'guess' })],
    ['a missing textHash', track({ textHash: undefined })],
    ['a textHash that is no text', track({ textHash: 5 })],
    ['segments not an array', track({ segments: {} })],
    ['a segment that is no object', track({ segments: [3] })],
    ['a missing startMs', segment({ startMs: undefined })],
    ['a fractional endMs', segment({ endMs: 10.5 })],
    ['a negative from', segment({ from: -1 })],
    ['a string offset', segment({ to: '1' })],
    ['an unsafe integer', segment({ endMs: 2 ** 53 })],
    ['from equal to to', segment({ from: 1, to: 1 })],
    ['from after to', segment({ from: 2, to: 1 })],
    ['startMs after endMs', segment({ startMs: 11, endMs: 10 })],
    ['a text that is no string', segment({ text: 4 })],
    [
      'segments out of order',
      track({
        segments: [
          { startMs: 100, endMs: 200, from: 0, to: 1 },
          { startMs: 99, endMs: 200, from: 1, to: 2 },
        ],
      }),
    ],
    ['anchors on a file track', track({ anchors: [{ ms: 0, at: 0 }] })],
    ['anchors not an array', track({ source: 'marked', anchors: {} })],
    [
      'an anchor with a negative time',
      track({ source: 'marked', anchors: [{ ms: -1, at: 0 }] }),
    ],
  ])('fails %s', (_name, value) => {
    expect(() => parseTourTiming(value)).toThrow(TourTimingError);
  });

  // Why: equal starts are legal (a zero-length word at a sentence's end
  // starts where the next begins), and a zero-length segment in time is
  // legal; only a step back in time is a fault.
  it('takes equal starts and zero-length times', () => {
    const timing = parseTourTiming(
      track({
        segments: [
          { startMs: 100, endMs: 100, from: 0, to: 1 },
          { startMs: 100, endMs: 150, from: 1, to: 2 },
        ],
      })
    );
    expect(timing.segments).toHaveLength(2);
  });

  // Why: the caps are what keeps a viewer's parse bounded; each is
  // pinned at N and N+1.
  it('caps segments at TOUR_TIMING_MAX_SEGMENTS', () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        startMs: i,
        endMs: i + 1,
        from: i,
        to: i + 1,
      }));
    expect(
      parseTourTiming(track({ segments: many(TOUR_TIMING_MAX_SEGMENTS) }))
        .segments
    ).toHaveLength(TOUR_TIMING_MAX_SEGMENTS);
    expect(() =>
      parseTourTiming(track({ segments: many(TOUR_TIMING_MAX_SEGMENTS + 1) }))
    ).toThrow(TourTimingError);
  });

  // Why: anchors belong to a marked track, are kept, and are capped.
  it('keeps the anchors of a marked track, up to the cap', () => {
    const anchors = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ ms: i * 10, at: i }));
    const read = parseTourTiming(
      track({ source: 'marked', anchors: anchors(TOUR_TIMING_MAX_ANCHORS) })
    );
    expect(read.anchors).toHaveLength(TOUR_TIMING_MAX_ANCHORS);
    expect(read.anchors?.[1]).toEqual({ ms: 10, at: 1 });
    expect(() =>
      parseTourTiming(
        track({
          source: 'marked',
          anchors: anchors(TOUR_TIMING_MAX_ANCHORS + 1),
        })
      )
    ).toThrow(TourTimingError);
  });

  // Why: a malformed hash is NOT structural - it is a track naming its
  // text in a way this reader cannot check, which reads as stale.
  it('reads a malformed hash, which then reads as stale', () => {
    const timing = parseTourTiming(track({ textHash: 'md5:abc' }));
    expect(
      tourTimingStaleReason(timing, { plainLength: 20, textHash: HASH })
    ).toMatch(/hash/);
  });
});

describe('parseTourTimingText', () => {
  // Why: the text cap is the timing entry's own size limit, separate
  // from the 16 MiB a text entry may hold.
  it('reads JSON, refuses non-JSON and text over the cap', () => {
    expect(parseTourTimingText(JSON.stringify(track())).segments).toHaveLength(
      2
    );
    expect(() => parseTourTimingText('{')).toThrow(TourTimingError);
    const padded = JSON.stringify(track()).padEnd(TOUR_TIMING_MAX_BYTES + 1);
    expect(() => parseTourTimingText(padded)).toThrow(TourTimingError);
    const atCap = JSON.stringify(track()).padEnd(TOUR_TIMING_MAX_BYTES);
    expect(parseTourTimingText(atCap).segments).toHaveLength(2);
  });
});

describe('tourTimingStaleReason: the range', () => {
  const timing = parseTourTiming(track());
  const fits = { plainLength: 11, textHash: HASH, durationMs: 700 };

  // Why: a track that fits its text is live.
  it('is null for a track that fits', () => {
    expect(tourTimingStaleReason(timing, fits)).toBeNull();
    expect(
      tourTimingStaleReason(timing, { plainLength: 11, textHash: HASH })
    ).toBeNull();
  });

  // Why: each range fault, at its edge, makes the track stale (plain
  // text for the visitor), never an error.
  it('is stale past each edge', () => {
    expect(
      tourTimingStaleReason(timing, { ...fits, plainLength: 10 })
    ).not.toBeNull();
    expect(
      tourTimingStaleReason(timing, { ...fits, durationMs: 699 })
    ).not.toBeNull();
    expect(
      tourTimingStaleReason(timing, {
        ...fits,
        textHash: `sha256:${'b'.repeat(64)}`,
      })
    ).not.toBeNull();
    expect(
      tourTimingStaleReason(parseTourTiming(track({ segments: [] })), fits)
    ).not.toBeNull();
    expect(
      tourTimingStaleReason(
        parseTourTiming(track({ textHash: `sha256:${'A'.repeat(64)}` })),
        { ...fits, textHash: `sha256:${'A'.repeat(64)}` }
      )
    ).not.toBeNull();
  });
});
