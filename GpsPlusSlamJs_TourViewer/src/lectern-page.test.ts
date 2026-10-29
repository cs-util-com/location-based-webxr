/**
 * Why this test matters: the reading stand (`lectern`, a long text's world
 * view) shows nine lines of one paragraph and turns its page on a tap. The
 * rules are the prototype's (`station-blocks-1-narrated-text`, the
 * lectern): paragraphs a blank line apart, sentences ending in `.`, `!`,
 * `?` or `…` before a capital, a digit or a quote, a window starting two
 * lines above the current sentence, and a turn of seven lines that moves
 * on to the next paragraph and wraps to the first. These examples pin the
 * exact words; `lectern-page.property.test.ts` holds the invariants for
 * any text.
 */

import { describe, expect, it } from "vitest";

import {
  analyzeLecternText,
  LECTERN_PAGE,
  lecternTurn,
  lecternWindowStart,
  sentenceAt,
  wrapLecternParagraph,
} from "./lectern-page";

/** One unit per character: a line holds `maxW` characters with spaces. */
const mono = (s: string): number => s.length;

describe("analyzeLecternText", () => {
  it("splits paragraphs on blank lines and sentences before a capital, a digit or a quote", () => {
    const text =
      'It burned. In 1612 it stood. 1613 came.\n\nThe hall? "Gone." e.g. this.';
    const a = analyzeLecternText(text);
    expect(a.paragraphs.map((p) => text.slice(p.from, p.to))).toEqual([
      "It burned. In 1612 it stood. 1613 came.",
      'The hall? "Gone." e.g. this.',
    ]);
    expect(a.sentences.map((s) => text.slice(s.from, s.to))).toEqual([
      "It burned.",
      "In 1612 it stood.",
      "1613 came.",
      "The hall?",
      '"Gone." e.g. this.',
    ]);
    expect(a.sentences.map((s) => s.p)).toEqual([0, 0, 0, 1, 1]);
    expect(a.paragraphs.map((p) => [p.s0, p.s1])).toEqual([
      [0, 3],
      [3, 5],
    ]);
  });

  it("trims blank paragraphs and whitespace, and reads an empty text as none", () => {
    const a = analyzeLecternText("\n\n  First.  \n\n\n\n   \n\nSecond.\n");
    expect(a.paragraphs).toHaveLength(2);
    expect(a.sentences.map((s) => a.text.slice(s.from, s.to))).toEqual([
      "First.",
      "Second.",
    ]);
    expect(analyzeLecternText("")).toEqual({
      text: "",
      paragraphs: [],
      sentences: [],
    });
    expect(analyzeLecternText("   \n\n ").sentences).toEqual([]);
  });

  it("a paragraph with no sentence end is one sentence", () => {
    const a = analyzeLecternText("no full stop here");
    expect(a.sentences).toEqual([{ from: 0, to: 17, p: 0 }]);
  });
});

describe("wrapLecternParagraph", () => {
  it("breaks before the word that would cross the width, and keeps each word's offsets and x", () => {
    const text = "aaa bb cccc d";
    const a = analyzeLecternText(text);
    const lines = wrapLecternParagraph(a, 0, mono, 7);
    expect(lines.map((l) => l.map((t) => t.text))).toEqual([
      ["aaa", "bb"],
      ["cccc", "d"],
    ]);
    expect(lines[0]?.[1]).toEqual({ from: 4, to: 6, text: "bb", x: 4, w: 2 });
    expect(lines[1]?.[0]?.x).toBe(0);
  });

  it("a word wider than the line gets a line of its own", () => {
    const a = analyzeLecternText("a verylongword b");
    const lines = wrapLecternParagraph(a, 0, mono, 5);
    expect(lines.map((l) => l.map((t) => t.text))).toEqual([
      ["a"],
      ["verylongword"],
      ["b"],
    ]);
  });

  it("a paragraph index out of range has no lines", () => {
    const a = analyzeLecternText("One.");
    expect(wrapLecternParagraph(a, 3, mono, 10)).toEqual([]);
    expect(wrapLecternParagraph(a, -1, mono, 10)).toEqual([]);
  });
});

/** A paragraph of `n` one-line sentences: "S0." ... each fills a line. */
function lineSentences(n: number): string {
  return Array.from({ length: n }, (_, i) => `Line${String(i)} is here.`).join(
    " ",
  );
}

describe("lecternWindowStart", () => {
  const text = lineSentences(20);
  const a = analyzeLecternText(text);
  // Each sentence is 14 or 15 characters; a width of 15 puts one per line.
  const lines = wrapLecternParagraph(a, 0, mono, 15);

  it("starts two lines above the current sentence's line, clamped to the paragraph", () => {
    expect(lines).toHaveLength(20);
    expect(lecternWindowStart(lines, a.sentences[0]!.from)).toBe(0);
    expect(lecternWindowStart(lines, a.sentences[1]!.from)).toBe(0);
    expect(lecternWindowStart(lines, a.sentences[5]!.from)).toBe(3);
    // Near the end the window shows the last nine lines.
    expect(lecternWindowStart(lines, a.sentences[19]!.from)).toBe(11);
  });

  it("a paragraph shorter than the window starts at its first line", () => {
    const short = analyzeLecternText(lineSentences(4));
    const few = wrapLecternParagraph(short, 0, mono, 15);
    expect(lecternWindowStart(few, short.sentences[3]!.from)).toBe(0);
    expect(lecternWindowStart([], 0)).toBe(0);
  });
});

describe("lecternTurn", () => {
  it("moves seven lines on within a paragraph, then to the next paragraph's first sentence, then back to the first", () => {
    const text = `${lineSentences(10)}\n\nNext one.\n\nLast.`;
    const a = analyzeLecternText(text);
    const turn = (s: number) => lecternTurn(a, s, mono, 15);
    expect(turn(0)).toBe(7);
    // Line 7 + 7 = 14 does not exist: the next paragraph.
    expect(turn(7)).toBe(10);
    expect(turn(10)).toBe(11);
    expect(turn(11)).toBe(0);
  });

  it("an empty text, or a sentence out of range, turns to the first", () => {
    expect(lecternTurn(analyzeLecternText(""), 0, mono, 15)).toBe(0);
    const a = analyzeLecternText("One. Two.");
    expect(lecternTurn(a, 99, mono, 15)).toBe(0);
    expect(lecternTurn(a, Number.NaN, mono, 15)).toBe(0);
  });
});

describe("sentenceAt", () => {
  it("names the last sentence starting at or before an offset", () => {
    const a = analyzeLecternText("One. Two. Three.");
    expect(sentenceAt(a, 0)).toBe(0);
    expect(sentenceAt(a, 5)).toBe(1);
    expect(sentenceAt(a, 7)).toBe(1);
    expect(sentenceAt(a, 999)).toBe(2);
    expect(sentenceAt(analyzeLecternText(""), 3)).toBe(0);
  });
});

describe("LECTERN_PAGE", () => {
  it("is the prototype's page: 1024 x 768, nine lines 54 px apart from 206, 900 px wide", () => {
    expect(LECTERN_PAGE).toMatchObject({
      widthPx: 1024,
      heightPx: 768,
      rows: 9,
      firstBaselinePx: 206,
      lineStepPx: 54,
      lineWidthPx: 900,
      turnLines: 7,
      leadLines: 2,
    });
  });
});
