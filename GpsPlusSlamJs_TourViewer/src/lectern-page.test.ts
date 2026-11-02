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
  LECTERN_FIRST_PLACE,
  LECTERN_PAGE,
  lecternPlaceStart,
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
    const turn = (s: number) =>
      lecternTurn(a, { sentence: s, start: null }, mono, 15);
    expect(turn(0)).toEqual({ sentence: 7, start: null });
    // Line 7 + 7 = 14 does not exist: the next paragraph.
    expect(turn(7)).toEqual({ sentence: 10, start: null });
    expect(turn(10)).toEqual({ sentence: 11, start: null });
    expect(turn(11)).toEqual(LECTERN_FIRST_PLACE);
  });

  // Why: a sentence of 14 lines followed by more text:
  // a turn that moved on to the sentence after it opened the page two
  // lines above that one (line 12) and lines 9-11 were never shown. The
  // turn now moves the window seven lines on inside the sentence, keeping
  // it highlighted, and only then turns to the next.
  it("turns through a sentence longer than the page by its lines, keeping it highlighted, and shows every line", () => {
    const long = `${Array.from(
      { length: 14 },
      (_, i) => `word${String(i).padStart(2, "0")}xxxx`,
    ).join(" ")}.`;
    const a = analyzeLecternText(`${long} ${lineSentences(8)}`);
    const lines = wrapLecternParagraph(a, 0, mono, 15);
    expect(lines).toHaveLength(22);
    const places = [LECTERN_FIRST_PLACE];
    for (let i = 0; i < 4; i += 1) {
      places.push(lecternTurn(a, places.at(-1)!, mono, 15));
    }
    expect(places).toEqual([
      { sentence: 0, start: null },
      { sentence: 0, start: 5 },
      { sentence: 1, start: null },
      { sentence: 8, start: null },
      LECTERN_FIRST_PLACE,
    ]);
    const shown = new Set<number>();
    for (const place of places.slice(0, -1)) {
      const from = a.sentences[place.sentence]!.from;
      const start = lecternPlaceStart(lines, from, place.start);
      for (let r = start; r < start + LECTERN_PAGE.rows; r += 1) shown.add(r);
    }
    expect([...shown].sort((x, y) => x - y)).toEqual(
      Array.from({ length: 22 }, (_, i) => i),
    );
  });

  it("an empty text, or a sentence out of range, turns to the first", () => {
    expect(
      lecternTurn(analyzeLecternText(""), LECTERN_FIRST_PLACE, mono, 15),
    ).toEqual(LECTERN_FIRST_PLACE);
    const a = analyzeLecternText("One. Two.");
    for (const sentence of [99, Number.NaN]) {
      expect(lecternTurn(a, { sentence, start: null }, mono, 15)).toEqual(
        LECTERN_FIRST_PLACE,
      );
    }
  });
});

describe("lecternPlaceStart", () => {
  it("keeps a moved window inside the paragraph, and opens the sentence's window without one", () => {
    const a = analyzeLecternText(lineSentences(20));
    const lines = wrapLecternParagraph(a, 0, mono, 15);
    const from = a.sentences[5]!.from;
    expect(lecternPlaceStart(lines, from, null)).toBe(3);
    expect(lecternPlaceStart(lines, from, 7)).toBe(7);
    expect(lecternPlaceStart(lines, from, 99)).toBe(11);
    expect(lecternPlaceStart(lines, from, -4)).toBe(0);
    expect(lecternPlaceStart(lines, from, 2.5)).toBe(3);
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
