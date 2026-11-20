/**
 * Why this test matters: in travel mode the painted texture is the only
 * thing the visitor sees of a narrated text's words, on the plate under
 * the sign, in flight and at the dock. It must draw the words where the
 * browser put them in the invisible box (so plate and dock break the same
 * way), grey until said and white after with the box's fade, only the
 * rows the window shows, the name and disclosure, the head row's hint and
 * the thin scrollbar. And it repaints only when something visible
 * changes: a paused voice must cost no paints at all. A recording 2D
 * context stands in for the canvas, so this runs without a browser.
 */

import { describe, expect, it } from "vitest";

import {
  paintNarrationWords,
  wordsCanvasSize,
  wordsPaintKey,
  type WordsPaintContext,
  type WordsPaintFrame,
  type WordsPaintLayout,
} from "./narration-words-paint";

interface Call {
  readonly op: string;
  readonly args: readonly unknown[];
  readonly fill: string;
  readonly font: string;
  readonly align: string;
}

/** A 2D context that records every call with the style it was made in. */
function recorder() {
  const calls: Call[] = [];
  const g = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    createLinearGradient() {
      return { addColorStop() {} } as unknown as CanvasGradient;
    },
  } as Record<string, unknown>;
  for (const op of [
    "save",
    "restore",
    "setTransform",
    "clearRect",
    "beginPath",
    "roundRect",
    "rect",
    "clip",
    "fill",
    "stroke",
    "fillText",
  ]) {
    g[op] = (...args: unknown[]) => {
      calls.push({
        op,
        args,
        fill: typeof g.fillStyle === "string" ? g.fillStyle : "gradient",
        font: String(g.font),
        align: String(g.textAlign),
      });
    };
  }
  return { g: g as unknown as WordsPaintContext, calls };
}

/** Five words on three lines (line 0 opens with the name), a 2-row window. */
function layout(over: Partial<WordsPaintLayout> = {}): WordsPaintLayout {
  return {
    width: 272,
    height: 86,
    radius: 12,
    win: { x: 15, y: 30, w: 246, h: 44 },
    head: { x: 15, y: 10, w: 234, h: 20 },
    fontPx: 16,
    lineHeight: 22,
    rows: 2,
    lines: 3,
    fonts: {
      word: "500 16px sans-serif",
      who: "700 16px sans-serif",
      disc: "500 13px sans-serif",
      hint: "600 11px sans-serif",
    },
    whoColor: "#f9a8d4",
    grey: 0.55,
    tint: 0.72,
    runs: [
      { kind: "who", text: "Narrator", x: 0, line: 0, word: -1 },
      { kind: "disc", text: "·", x: 74, line: 0, word: -1 },
      { kind: "disc", text: "synthetic", x: 84, line: 0, word: -1 },
      { kind: "word", text: "one", x: 160, line: 0, word: 0 },
      { kind: "word", text: "two", x: 0, line: 1, word: 1 },
      { kind: "word", text: "three", x: 40, line: 1, word: 2 },
      { kind: "word", text: "four", x: 0, line: 2, word: 3 },
      { kind: "word", text: "five", x: 50, line: 2, word: 4 },
    ],
    startsMs: [0, 1000, 2000, 3000, 4000],
    ...over,
  };
}

function frame(over: Partial<WordsPaintFrame> = {}): WordsPaintFrame {
  return {
    voiceMs: 0,
    lit: -1,
    scroll: 0,
    scrubbing: false,
    hint: "",
    ...over,
  };
}

function texts(calls: readonly Call[]) {
  return calls.filter((c) => c.op === "fillText");
}

describe("paintNarrationWords", () => {
  it("draws at the scale, each shown word at its x and line in the window", () => {
    const { g, calls } = recorder();
    paintNarrationWords(g, { layout: layout(), frame: frame() }, 2.5);
    expect(calls.find((c) => c.op === "setTransform")?.args).toEqual([
      2.5, 0, 0, 2.5, 0, 0,
    ]);
    const drawn = texts(calls);
    // Two rows from line 0: line 2's words are outside the window.
    expect(drawn.map((c) => c.args[0])).toEqual([
      "Narrator",
      "·",
      "synthetic",
      "one",
      "two",
      "three",
    ]);
    const two = drawn.find((c) => c.args[0] === "two");
    // x: window x + the word's x; y: the line's middle.
    expect(two?.args.slice(1)).toEqual([15, 30 + 22 + 11]);
    expect(two?.font).toBe("500 16px sans-serif");
    expect(wordsCanvasSize(layout(), 2.5)).toEqual({ width: 680, height: 215 });
  });

  it("scrolls the lines up and clips them to the window", () => {
    const { g, calls } = recorder();
    paintNarrationWords(
      g,
      { layout: layout(), frame: frame({ scroll: 1 }) },
      2,
    );
    const drawn = texts(calls).map((c) => c.args[0]);
    expect(drawn).toEqual(["two", "three", "four", "five"]);
    expect(texts(calls).find((c) => c.args[0] === "four")?.args[2]).toBe(
      30 + 22 + 11,
    );
    const clip = calls.findIndex((c) => c.op === "clip");
    const rect = calls[clip - 1];
    expect(rect?.op).toBe("rect");
    expect(rect?.args).toEqual([15, 30, 246, 44]);
    // Every word is drawn inside the clip.
    const firstWord = calls.findIndex((c) => c.op === "fillText");
    expect(firstWord).toBeGreaterThan(clip);
  });

  it("draws the name bold in its colour and the disclosure muted", () => {
    const { g, calls } = recorder();
    paintNarrationWords(g, { layout: layout(), frame: frame() }, 2);
    const who = texts(calls).find((c) => c.args[0] === "Narrator");
    expect(who?.fill).toBe("#f9a8d4");
    expect(who?.font).toBe("700 16px sans-serif");
    const disc = texts(calls).find((c) => c.args[0] === "synthetic");
    expect(disc?.fill).toBe("rgba(255,255,255,0.55)");
    expect(disc?.font).toBe("500 13px sans-serif");
  });

  it("lights the words said with the box's fade, in eight steps", () => {
    // Word 1 started at 1000 ms; the fade starts 120 ms later and takes
    // 550 ms, from grey 0.55 to white.
    const fills = (voiceMs: number, scrubbing = false) => {
      const { g, calls } = recorder();
      paintNarrationWords(
        g,
        { layout: layout(), frame: frame({ voiceMs, lit: 1, scrubbing }) },
        2,
      );
      const at = (w: string) => texts(calls).find((c) => c.args[0] === w)?.fill;
      return { one: at("one"), two: at("two"), three: at("three") };
    };
    expect(fills(1100)).toEqual({
      one: "rgba(255,255,255,1)",
      two: "rgba(255,255,255,0.55)",
      three: "rgba(255,255,255,0.55)",
    });
    // Half way: 0.55 + 0.45 x 0.5.
    expect(fills(1120 + 275).two).toBe("rgba(255,255,255,0.775)");
    // 0.3 of the way rounds to 2/8.
    expect(fills(1120 + 165).two).toBe("rgba(255,255,255,0.6625)");
    expect(fills(1120 + 550).two).toBe("rgba(255,255,255,1)");
    // A scrub lights at once, in 0.12 s.
    expect(fills(1120, true).two).toBe("rgba(255,255,255,1)");
  });

  it("draws the scrollbar only when there are more lines than rows", () => {
    const thumbs = (l: WordsPaintLayout, scrubbing = false) => {
      const { g, calls } = recorder();
      paintNarrationWords(g, { layout: l, frame: frame({ scrubbing }) }, 2);
      return calls.filter(
        (c) =>
          c.op === "fill" &&
          c.fill.startsWith("rgba(255,255,255,0.") &&
          c.fill !== "rgba(255,255,255,0.55)",
      );
    };
    expect(thumbs(layout()).map((c) => c.fill)).toEqual([
      "rgba(255,255,255,0.1)",
      "rgba(255,255,255,0.5)",
    ]);
    expect(
      thumbs(layout(), true)
        .map((c) => c.fill)
        .at(-1),
    ).toBe("rgba(255,255,255,0.9)");
    expect(thumbs(layout({ lines: 2 }))).toEqual([]);
  });

  it("writes the hint right-aligned in the head row, and nothing without one", () => {
    const { g, calls } = recorder();
    paintNarrationWords(
      g,
      {
        layout: layout(),
        frame: frame({ hint: "tap the words to listen" }),
      },
      2,
    );
    const hint = texts(calls).find(
      (c) => c.args[0] === "tap the words to listen",
    );
    expect(hint?.align).toBe("right");
    expect(hint?.args.slice(1, 3)).toEqual([15 + 234, 10 + 10]);
    expect(hint?.font).toBe("600 11px sans-serif");
    const none = recorder();
    paintNarrationWords(
      none.g,
      { layout: layout({ head: null }), frame: frame({ hint: "x" }) },
      2,
    );
    expect(texts(none.calls).map((c) => c.args[0])).not.toContain("x");
  });
});

describe("wordsPaintKey", () => {
  const l = layout();

  it("stays the same while paused after the fades end", () => {
    expect(wordsPaintKey(l, frame({ voiceMs: 1700, lit: 1 }))).toBe(
      wordsPaintKey(l, frame({ voiceMs: 1900, lit: 1 })),
    );
  });

  it("changes with the lit word, a fade step, the scroll, a scrub and the hint", () => {
    const base = wordsPaintKey(l, frame({ voiceMs: 1700, lit: 1 }));
    for (const f of [
      frame({ voiceMs: 2700, lit: 2 }),
      frame({ voiceMs: 1300, lit: 1 }),
      frame({ voiceMs: 1700, lit: 1, scroll: 0.5 }),
      frame({ voiceMs: 1700, lit: 1, scrubbing: true }),
      frame({ voiceMs: 1700, lit: 1, hint: "paused - tap to play" }),
    ]) {
      expect(wordsPaintKey(l, f)).not.toBe(base);
    }
    // A fade within one of its eight steps is no change.
    expect(wordsPaintKey(l, frame({ voiceMs: 1300, lit: 1 }))).toBe(
      wordsPaintKey(l, frame({ voiceMs: 1310, lit: 1 })),
    );
  });
});
