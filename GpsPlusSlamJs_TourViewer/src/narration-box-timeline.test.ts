/**
 * Why this test matters: in the narration box, moving the words IS moving
 * the voice. Every number the box shows and every seek it makes comes
 * from these functions: when each word starts, which word is lit, how far
 * the lines have scrolled, and where a drag of so many lines lands in the
 * voice. If they disagree with each other, the words under the finger are
 * not the words the voice says after the release.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { TourTiming } from "gps-plus-slam-app-framework/ar/tour-timing";

import { wordsOf } from "./plain-words.js";
import {
  BOX_FOLLOW_ROW,
  BOX_MAX_ROWS,
  BOX_TAP_SLOP_PX,
  dragScroll,
  followScroll,
  isTap,
  lineFloatAt,
  lineIndices,
  lineStarts,
  rubberBand,
  thumbGeometry,
  timeAtLine,
  wordAt,
  wordStartsMs,
} from "./narration-box-timeline.js";

function track(
  segments: TourTiming["segments"],
  granularity: TourTiming["granularity"] = "word",
): TourTiming {
  return { granularity, source: "file", segments, textHash: "sha256:x" };
}

describe("wordStartsMs", () => {
  it("gives each word of a word track its own segment's start", () => {
    const plain = "One two, three.";
    const words = wordsOf(plain, 0, plain.length);
    const timing = track([
      { startMs: 100, endMs: 300, from: 0, to: 3 },
      { startMs: 400, endMs: 600, from: 4, to: 7 },
      { startMs: 900, endMs: 1200, from: 9, to: 14 },
    ]);
    expect(wordStartsMs(words, timing)).toEqual([100, 400, 900]);
  });

  // Why: a sentence track says only when a sentence starts and ends; the
  // box still lights its words one by one, by their share of its letters.
  it("spreads a sentence track's time over its words by their place", () => {
    const plain = "aa bb cc dd";
    const words = wordsOf(plain, 0, plain.length);
    const timing = track(
      [{ startMs: 1000, endMs: 2100, from: 0, to: 11 }],
      "sentence",
    );
    expect(wordStartsMs(words, timing)).toEqual([1000, 1300, 1600, 1900]);
  });

  it("starts a word the track never reaches after the last one before it", () => {
    const plain = "aa bb cc";
    const words = wordsOf(plain, 0, plain.length);
    const timing = track([{ startMs: 500, endMs: 900, from: 3, to: 5 }]);
    // Before the first segment: 0; after the last: its end.
    expect(wordStartsMs(words, timing)).toEqual([0, 500, 900]);
  });

  it("never runs backwards, whatever the track says", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            startMs: fc.nat(10_000),
            len: fc.nat(2000),
            from: fc.nat(60),
            width: fc.integer({ min: 1, max: 12 }),
          }),
          { maxLength: 20 },
        ),
        (raw) => {
          const plain = "word ".repeat(16);
          const words = wordsOf(plain, 0, plain.length);
          const segments = raw
            .map((s) => ({
              startMs: s.startMs,
              endMs: s.startMs + s.len,
              from: s.from,
              to: s.from + s.width,
            }))
            .sort((a, b) => a.startMs - b.startMs);
          const starts = wordStartsMs(words, track(segments));
          expect(starts).toHaveLength(words.length);
          for (let i = 1; i < starts.length; i += 1) {
            expect(starts[i]).toBeGreaterThanOrEqual(starts[i - 1] ?? 0);
          }
          for (const s of starts) expect(Number.isFinite(s)).toBe(true);
        },
      ),
    );
  });
});

describe("wordAt", () => {
  it("is the last word started at or before the time, or -1", () => {
    const starts = [0, 100, 100, 400];
    expect(wordAt(starts, -1)).toBe(-1);
    expect(wordAt(starts, 0)).toBe(0);
    expect(wordAt(starts, 100)).toBe(2);
    expect(wordAt(starts, 399)).toBe(2);
    expect(wordAt(starts, 10_000)).toBe(3);
    expect(wordAt(starts, Number.NaN)).toBe(-1);
  });
});

describe("lines", () => {
  // Why: the box groups words into lines by where the browser put them;
  // a word a pixel lower (a bold name, a different glyph) is still on
  // its line, and the next line starts a whole line height below.
  it("groups words into lines by their top, half a line height apart", () => {
    expect(lineIndices([0, 0, 1, 22, 22, 44], 22)).toEqual([0, 0, 0, 1, 1, 2]);
    expect(lineIndices([], 22)).toEqual([]);
  });

  // Why: the speaker's name opens line 0. A first word too long to fit
  // beside it wraps under it, and is then on line 1, not line 0.
  it("counts from the name's line when given its top", () => {
    expect(lineIndices([22, 22, 44], 22, 0)).toEqual([1, 1, 2]);
    expect(lineIndices([0, 22], 22, 0)).toEqual([0, 1]);
  });

  // Why: a long voice credit after the name can fill a line of its own, no
  // word on it. Counted by first-seen tops, that line got no number, the
  // text one line short, and its last line never scrolled into view.
  it("counts a line that holds no word, from the name's top", () => {
    expect(lineIndices([44, 66], 22, 0)).toEqual([2, 3]);
    expect(lineIndices([66, 66, 88], 22, 0)).toEqual([3, 3, 4]);
  });

  it("starts each line at its first word, and closes with the total", () => {
    expect(lineStarts([0, 300, 600, 900], [0, 0, 1, 2], 1500)).toEqual([
      0, 600, 900, 1500,
    ]);
    // No words: one empty line spanning the whole voice.
    expect(lineStarts([], [], 1500)).toEqual([0, 1500]);
  });

  it("maps a time to a line and back", () => {
    const ls = [0, 600, 900, 1500];
    expect(lineFloatAt(ls, 0)).toBe(0);
    expect(lineFloatAt(ls, 300)).toBeCloseTo(0.5);
    expect(lineFloatAt(ls, 900)).toBe(2);
    expect(lineFloatAt(ls, 1500)).toBe(3);
    expect(lineFloatAt(ls, 99_999)).toBe(3);
    expect(lineFloatAt(ls, -5)).toBe(0);
    expect(timeAtLine(ls, 0.5)).toBe(300);
    expect(timeAtLine(ls, -2)).toBe(0);
    expect(timeAtLine(ls, 7)).toBe(1500);
  });
  // The round trip, monotonicity and clamping of this pair, for any line
  // starts: narration-box-timeline.property.test.ts.
});

describe("scrolling", () => {
  it("keeps the spoken line in the middle row, clamped to the text", () => {
    expect(BOX_MAX_ROWS).toBe(3);
    expect(BOX_FOLLOW_ROW).toBe(1);
    expect(followScroll(0, 10, 3)).toBe(0);
    expect(followScroll(1, 10, 3)).toBe(0);
    expect(followScroll(5, 10, 3)).toBe(4);
    expect(followScroll(9, 10, 3)).toBe(7);
    expect(followScroll(2, 2, 2)).toBe(0);
  });

  // Why: at the first and last line a drag keeps scrubbing while the
  // words stretch 0.3 as far (the prototype's rubber band), so the box
  // never runs empty.
  it("stretches past either end by 0.3 (rubber band)", () => {
    expect(rubberBand(-3, 5)).toBeCloseTo(-0.9);
    expect(rubberBand(2, 5)).toBe(2);
    expect(rubberBand(8, 5)).toBeCloseTo(5.9);
  });

  // Why: with no limit the words ran on past the end until the read line
  // left the window. With a reach, the band starts at the same 0.3 and
  // then flattens out short of it, however far the finger goes.
  it("stretches no further than its reach past either end, starting at 0.3", () => {
    const reach = { before: 1.5, after: 2 };
    expect(rubberBand(2, 5, reach)).toBe(2);
    expect(rubberBand(5 + 0.01, 5, reach) - 5).toBeCloseTo(0.003, 4);
    expect(rubberBand(-0.01, 5, reach)).toBeCloseTo(-0.003, 4);
    for (const far of [10, 100]) {
      expect(rubberBand(5 + far, 5, reach)).toBeLessThan(7);
      expect(rubberBand(-far, 5, reach)).toBeGreaterThan(-1.5);
    }
    // Far enough, rounding reaches the limit, and no further.
    expect(rubberBand(5 + 1e6, 5, reach)).toBe(7);
    expect(rubberBand(-1e6, 5, reach)).toBe(-1.5);
    expect(rubberBand(5 + 100, 5, reach)).toBeGreaterThan(6.9);
    // No reach: the words stay at the end.
    expect(rubberBand(9, 5, { before: 0, after: 0 })).toBe(5);
    expect(rubberBand(-4, 5, { before: 0, after: 0 })).toBe(0);
  });

  // Why: a drag must never move the read line (the line of the lit word)
  // out of the window, at either end or in the text, or the voice goes on
  // from words nobody can see.
  it("holds a drag where the read line stays in the window", () => {
    // 10 lines, 3 rows (top 7), the read line the last: far past the end
    // the words stop short of moving it above the window.
    expect(dragScroll(7 + 50, 7, 9, 3)).toBeLessThan(9);
    expect(dragScroll(7 + 50, 7, 9, 3)).toBeGreaterThan(8.9);
    // The read line the first word's (line 1), far back past the start:
    // the words stop short of moving it below the last row.
    expect(dragScroll(-50, 7, 1, 3)).toBeGreaterThan(-1);
    // The first word on line 2 of 3 rows: no stretch back at all.
    expect(dragScroll(-5, 7, 2, 3)).toBe(0);
    // In the text with the read line in view: the drag as it is.
    expect(dragScroll(4.4, 7, 5, 3)).toBe(4.4);
    // In the text, the read line about to leave: held at the edge.
    expect(dragScroll(5.6, 7, 5, 3)).toBe(5);
    expect(dragScroll(2.5, 7, 5, 3)).toBe(3);
  });

  it("sizes the thumb by the share shown and places it by the scroll", () => {
    // 3 of 12 lines, a 62 px track: a quarter of it, at the top.
    expect(thumbGeometry(0, 12, 3, 62)).toEqual({ height: 15.5, offset: 0 });
    // At the end of the scroll it sits at the bottom.
    const end = thumbGeometry(9, 12, 3, 62);
    expect(end.offset).toBeCloseTo(62 - 15.5);
    // Never smaller than 14 px, never outside the track.
    const tiny = thumbGeometry(500, 400, 3, 62);
    expect(tiny.height).toBe(14);
    expect(tiny.offset).toBeCloseTo(48);
    expect(thumbGeometry(-4, 12, 3, 62).offset).toBe(0);
  });
});

describe("isTap", () => {
  it("is a tap within 8 px of the press, a drag beyond", () => {
    expect(BOX_TAP_SLOP_PX).toBe(8);
    expect(isTap(0, 0)).toBe(true);
    expect(isTap(5, 6)).toBe(true);
    expect(isTap(0, 8.5)).toBe(false);
    expect(isTap(Number.NaN, 0)).toBe(false);
  });
});
