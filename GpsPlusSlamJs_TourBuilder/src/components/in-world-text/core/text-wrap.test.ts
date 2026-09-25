import { describe, expect, it } from "vitest";

import { wrapText, type Measure } from "./text-wrap.js";

/**
 * A deterministic monospace measurer: every character is 10px wide. With
 * `maxWidthPx = 100` a line therefore holds 10 characters (spaces included),
 * which makes the expected wrapping easy to reason about without a real font.
 */
const measure: Measure = (text) => text.length * 10;
const MAX = 100;

describe("wrapText", () => {
  it("wraps at word boundaries without exceeding the max width", () => {
    const lines = wrapText("hello world foo", MAX, measure);
    expect(lines).toEqual(["hello", "world foo"]);
    for (const line of lines) {
      expect(measure(line)).toBeLessThanOrEqual(MAX);
    }
  });

  it("treats an explicit newline as a hard break", () => {
    expect(wrapText("alpha\nbeta", MAX, measure)).toEqual(["alpha", "beta"]);
  });

  it("hard-breaks a single word wider than the line", () => {
    // 20 chars, 200px → two 10-char (100px) chunks, each within the limit.
    const lines = wrapText("supercalifragilistic", MAX, measure);
    expect(lines).toEqual(["supercalif", "ragilistic"]);
    for (const line of lines) {
      expect(measure(line)).toBeLessThanOrEqual(MAX);
    }
  });

  it("returns [] for empty or whitespace-only text", () => {
    expect(wrapText("", MAX, measure)).toEqual([]);
    expect(wrapText("   \n  ", MAX, measure)).toEqual([]);
  });
});
