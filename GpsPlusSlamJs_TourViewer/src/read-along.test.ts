/**
 * Why this test matters: every mark the sheet and the captions strip draw
 * comes from these lookups. An off-by-one in the time search marks the
 * word before the one spoken; a sentence found by the wrong end of a
 * segment marks the wrong sentence across a sentence boundary; and the
 * "previous sentence" rule is what makes the button feel right (back to
 * the start of this sentence, or, just after it began, to the one before).
 */
import { describe, expect, it } from "vitest";

import type { TourTiming } from "gps-plus-slam-app-framework/ar/tour-timing";

import {
  clockText,
  cursorAt,
  marksWords,
  narrationMinutes,
  previousSentenceMs,
  segmentAt,
  sentenceSeekMs,
  sentenceStarts,
} from "./read-along.js";

const SENTENCES = [
  { from: 0, to: 10 },
  { from: 11, to: 20 },
  { from: 22, to: 30 },
];

function track(
  segments: [number, number, number][],
  granularity: TourTiming["granularity"] = "word",
): TourTiming {
  return {
    granularity,
    source: "file",
    textHash: "sha256:x",
    segments: segments.map(([startMs, from, to]) => ({
      startMs,
      endMs: startMs + 100,
      from,
      to,
    })),
  };
}

const T = track([
  [0, 0, 4],
  [500, 5, 10],
  [1000, 11, 15],
  [3000, 16, 20],
  [4000, 22, 30],
]);

describe("segmentAt", () => {
  it("is the last segment started, -1 before the first", () => {
    expect(segmentAt(T.segments, -1)).toBe(-1);
    expect(segmentAt(T.segments, 0)).toBe(0);
    expect(segmentAt(T.segments, 499)).toBe(0);
    expect(segmentAt(T.segments, 500)).toBe(1);
    expect(segmentAt(T.segments, 99_999)).toBe(4);
    expect(segmentAt(T.segments, Number.NaN)).toBe(-1);
    expect(segmentAt([], 10)).toBe(-1);
  });

  it("takes the last of equal starts", () => {
    const equal = [{ startMs: 0 }, { startMs: 10 }, { startMs: 10 }];
    expect(segmentAt(equal, 10)).toBe(2);
  });
});

describe("cursorAt", () => {
  it("gives the segment and the sentences it lies in", () => {
    expect(cursorAt(T, SENTENCES, 1200)).toEqual({
      segment: 2,
      from: 11,
      to: 15,
      s0: 1,
      s1: 1,
    });
    expect(cursorAt(T, SENTENCES, -5)).toBeNull();
  });

  it("spans two sentences for a segment across their boundary", () => {
    const across = track([[0, 5, 25]], "sentence");
    expect(cursorAt(across, SENTENCES, 0)).toMatchObject({ s0: 0, s1: 2 });
  });
});

describe("sentence starts and seeks", () => {
  it("finds each sentence's first segment, -1 for one never spoken", () => {
    const starts = sentenceStarts(
      track([
        [0, 0, 4],
        [900, 22, 30],
      ]),
      SENTENCES,
    );
    expect(starts).toEqual([0, -1, 1]);
  });

  it("seeks 30 ms before a sentence's first word, never below 0", () => {
    const starts = sentenceStarts(T, SENTENCES);
    expect(sentenceSeekMs(T, starts, 1)).toBe(970);
    expect(sentenceSeekMs(T, starts, 0)).toBe(0);
    expect(sentenceSeekMs(T, starts, 9)).toBeNull();
  });

  it("goes back to this sentence after 1.6 s in it, else to the one before", () => {
    const starts = sentenceStarts(T, SENTENCES);
    // 2.0 s into sentence 1 (from 1000): its own start.
    expect(previousSentenceMs(T, SENTENCES, starts, 3000)).toBe(970);
    // 0.5 s into it: the one before.
    expect(previousSentenceMs(T, SENTENCES, starts, 1500)).toBe(0);
    // At the first sentence's start: nowhere earlier.
    expect(previousSentenceMs(T, SENTENCES, starts, 100)).toBeNull();
    expect(previousSentenceMs(T, SENTENCES, starts, -1)).toBeNull();
  });
});

describe("the words around the voice", () => {
  it("marks words only on a word track read from a file", () => {
    expect(marksWords(T)).toBe(true);
    expect(marksWords({ ...T, granularity: "sentence" })).toBe(false);
    expect(marksWords({ ...T, source: "marked" })).toBe(false);
  });

  it("writes the clock as m:ss, rounded to the second", () => {
    expect(clockText(0)).toBe("0:00");
    expect(clockText(61_499)).toBe("1:01");
    expect(clockText(59_600)).toBe("1:00");
    expect(clockText(-5)).toBe("0:00");
    expect(clockText(Number.NaN)).toBe("0:00");
  });

  it("counts minutes of narration, at least one", () => {
    expect(narrationMinutes(0)).toBe(1);
    expect(narrationMinutes(150_000)).toBe(3);
  });
});
