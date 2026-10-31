/**
 * Why this test matters: the captions strip shows the voice a few lines
 * at a time, eyes on the place. A chunk that drops a word loses it from
 * the captions; one that overruns its length pushes a fourth line out of
 * the strip; a cut that ignores a nearby comma breaks a clause in two
 * where a reader would pause anyway.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  CAPTION_MAX_CHARS,
  captionChunks,
  chunkHolding,
  wordHolding,
  wordsOf,
} from "./caption-chunks.js";

const show = (text: string, max: number) =>
  captionChunks(text, 0, text.length, max).chunks.map((c) =>
    text.slice(c.from, c.to),
  );

describe("captionChunks", () => {
  it("keeps a short text in one chunk", () => {
    expect(show("The hall burned.", CAPTION_MAX_CHARS.portrait)).toEqual([
      "The hall burned.",
    ]);
  });

  it("cuts at the last word that fits, keeping closing punctuation", () => {
    expect(show("aaaa bbbb cccc. dddd", 14)).toEqual([
      "aaaa bbbb cccc.",
      "dddd",
    ]);
  });

  it("moves a cut back to a clause break in the chunk's last part", () => {
    const text = "one two three four, five six seven eight nine";
    expect(show(text, 30)).toEqual([
      "one two three four,",
      "five six seven eight nine",
    ]);
  });

  it("does not move a cut back to a clause break too early in the chunk", () => {
    const text = "one, two three four five six seven eight nine ten";
    expect(show(text, 30)[0]).toBe("one, two three four five six");
  });

  it("gives one empty chunk for a stretch with no words", () => {
    expect(captionChunks("   ", 0, 3, 10).chunks).toEqual([
      { from: 0, to: 3, w0: -1, w1: -1 },
    ]);
  });

  it("finds the word and the chunk holding an offset", () => {
    const text = "aaaa bbbb cccc. dddd";
    const { words, chunks } = captionChunks(text, 0, text.length, 14);
    expect(wordHolding(words, text.indexOf("dddd"))).toBe(3);
    expect(wordHolding(words, 4)).toBe(0);
    expect(wordHolding(words, -1)).toBe(-1);
    expect(chunkHolding(chunks, 3)).toBe(1);
    expect(chunkHolding(chunks, -1)).toBe(0);
  });

  it("reads only the words inside its stretch", () => {
    expect(wordsOf("ab cd ef", 3, 5)).toEqual([{ from: 3, to: 5 }]);
  });
});

describe("captionChunks (property)", () => {
  // Why: for any words and any length, the chunks must hold every word
  // once, in order, and never run past their length but for a single
  // word longer than it.
  it("covers every word once, in order, within the length", () => {
    const word = fc.stringMatching(/^[a-z]{1,12}[,;:.!?]?$/u);
    fc.assert(
      fc.property(
        fc.array(word, { minLength: 1, maxLength: 60 }),
        fc.integer({ min: 5, max: 130 }),
        (ws, max) => {
          const text = ws.join(" ");
          const { words, chunks } = captionChunks(text, 0, text.length, max);
          let next = 0;
          for (const c of chunks) {
            expect(c.w0).toBe(next);
            expect(c.w1).toBeGreaterThan(c.w0);
            next = c.w1;
          }
          expect(next).toBe(words.length);
          // Only a chunk of a single word may run past the length.
          const tooLong = chunks.filter(
            (c) =>
              c.w1 - c.w0 >= 2 && (words[c.w1 - 1]?.to ?? 0) - c.from > max,
          );
          expect(tooLong).toEqual([]);
        },
      ),
      { numRuns: 300 },
    );
  });
});
