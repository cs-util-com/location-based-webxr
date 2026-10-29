import { describe, expect, it } from "vitest";

import {
  BUBBLE,
  PIP,
  bubbleLayout,
  bubbleTipX,
  dieCutPad,
  pipLayout,
  readAlongColour,
  scrollLayout,
  sheetCells,
  wordsOf,
  wrapWords,
  type MeasureText,
} from "./character-canvas";

/** A fixed-pitch stand-in for the browser's text metrics: 30 px a letter
 *  plus the letter spacing, so every size below is computable by hand. */
const mono: MeasureText = (text, _font, spacing = 0) =>
  text.length * (30 + spacing);

describe("wrapWords", () => {
  // Why this test matters: the bubble's height and the e2e's head-to-tail
  // check both rest on the wrap; a word must never be split or lost.
  it("breaks before the word that would cross the width", () => {
    const lines = wrapWords(["aa", "bb", "cc"], 200, (t) => t.length * 30);
    expect(lines.map((l) => l.map((w) => w.i))).toEqual([[0, 1], [2]]);
    expect(lines[0]![1]).toEqual({ i: 1, x: 90, w: 60 });
  });

  it("gives a word wider than the line a line alone", () => {
    const lines = wrapWords(
      ["a", "x".repeat(40), "b"],
      100,
      (t) => t.length * 10,
    );
    expect(lines.map((l) => l.map((w) => w.i))).toEqual([[0], [1], [2]]);
  });

  it("reads white space only as the separator", () => {
    expect(wordsOf("  Good   day,\ntraveller ")).toEqual([
      "Good",
      "day,",
      "traveller",
    ]);
    expect(wordsOf("")).toEqual([]);
  });
});

describe("bubbleLayout", () => {
  const base = {
    name: "Wendel",
    footer: null,
    reserveFooter: false,
    side: "right" as const,
  };

  // Why this test matters: the prototype's width rule - as wide as the
  // longest line, never under 440 px nor over 1024 px (one metre).
  it("keeps the width between 440 and 1024 px", () => {
    expect(bubbleLayout({ ...base, line: "Hi." }, mono).w).toBe(BUBBLE.minW);
    const long = bubbleLayout({ ...base, line: "word ".repeat(80) }, mono);
    // Wrapped at 908 px: six 120 px words and their spaces, 870 + 116.
    expect(long.w).toBe(986);
    // One unbreakable word wider than a metre is clamped to it.
    expect(bubbleLayout({ ...base, line: "x".repeat(60) }, mono).w).toBe(
      BUBBLE.maxW,
    );
    expect(long.lines.length).toBeGreaterThan(1);
  });

  it("grows by one line height per wrapped line and by the footer row", () => {
    const one = bubbleLayout({ ...base, line: "Hi." }, mono);
    const two = bubbleLayout(
      { ...base, line: "x".repeat(20) + " " + "y".repeat(20) },
      mono,
    );
    expect(two.lines).toHaveLength(2);
    expect(two.bodyH - one.bodyH).toBe(BUBBLE.lineH);
    const footed = bubbleLayout(
      { ...base, line: "Hi.", reserveFooter: true },
      mono,
    );
    expect(footed.bodyH - one.bodyH).toBe(Math.ceil(BUBBLE.footFont * 1.9));
    expect(one.h).toBe(one.bodyH + BUBBLE.tailH + 6);
  });

  // Why this test matters: the look hangs the bubble by its tail's tip at
  // his head; a tip on the wrong side puts the bubble over his face.
  it("puts the tail's tip near the edge facing him", () => {
    const right = bubbleLayout({ ...base, line: "Hi." }, mono);
    const left = bubbleLayout({ ...base, line: "Hi.", side: "left" }, mono);
    expect(right.tipX).toBe(30);
    expect(left.tipX).toBe(left.w - 30);
    expect(bubbleTipX(600, "left")).toBe(570);
  });
});

describe("pipLayout and scrollLayout", () => {
  it("sizes the name tag's plate to the name and anchors it on its side", () => {
    const r = pipLayout("Wendel", "right", mono);
    expect(r.bw).toBe(6 * 34 + 150);
    expect(r.bx).toBe(4);
    const l = pipLayout("Wendel", "left", mono);
    expect(l.bx + l.bw).toBe(PIP.w - 4);
    expect(l.tipX).toBe(l.bx + l.bw - 26);
    expect(pipLayout("x".repeat(60), "right", mono).bw).toBe(PIP.w - 8);
  });

  it("grows the scroll by its lines and its footer", () => {
    const a = scrollLayout("Hi.", null, mono);
    const b = scrollLayout("Hi.", "Speaking", mono);
    expect(a.w).toBe(1024);
    expect(b.h - a.h).toBe(44);
  });
});

describe("dieCutPad", () => {
  it("is the prototype's 14 px of 1024, never under 3 px", () => {
    expect(dieCutPad(1024)).toBe(14);
    expect(dieCutPad(512)).toBe(7);
    expect(dieCutPad(10)).toBe(3);
  });
});

// Why these tests matter: the frames sheet's layout is the tour format's
// (four equal cells in one row: idle, talk-a, talk-b, beckon), so a wrong
// slice would give every creator's character the wrong pose.
describe("sheetCells", () => {
  it("slices four equal cells in one row, left to right", () => {
    expect(sheetCells(2048, 1024)).toEqual([
      { x: 0, y: 0, w: 512, h: 1024 },
      { x: 512, y: 0, w: 512, h: 1024 },
      { x: 1024, y: 0, w: 512, h: 1024 },
      { x: 1536, y: 0, w: 512, h: 1024 },
    ]);
  });

  it("drops the remainder of a width not divisible by four", () => {
    expect(sheetCells(2050, 1000).map((c) => c.x)).toEqual([
      0, 512, 1024, 1536,
    ]);
    expect(sheetCells(2050, 1000)[0]!.w).toBe(512);
  });

  it("gives nothing for a sheet too small or not a size", () => {
    expect(sheetCells(3, 100)).toEqual([]);
    expect(sheetCells(Number.NaN, 100)).toEqual([]);
    expect(sheetCells(400, 0)).toEqual([]);
  });
});

// Why this test matters: the prototype's read-along - the words said in
// full colour, the one sounding in gold, the ones to come dimmed - and a
// bubble with no voice playing stays plain.
describe("readAlongColour", () => {
  it("colours said, sounding and coming words as the prototype does", () => {
    expect(readAlongColour(0, 1)).toBe("#f4efe6");
    expect(readAlongColour(1, 1)).toBe("#f6c45a");
    expect(readAlongColour(2, 1)).toBe("rgba(244,239,230,0.46)");
    expect(readAlongColour(0, -1)).toBe("rgba(244,239,230,0.46)");
    expect(readAlongColour(3, undefined)).toBe("#f4efe6");
  });
});
