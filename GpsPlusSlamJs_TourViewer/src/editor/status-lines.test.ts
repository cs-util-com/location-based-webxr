/**
 * Why these tests matter (QR-first M1b-2 milestone review #5): the
 * needs-no-GPS warnings sit in a polite live region, and the page redraws
 * them on every `refresh()` - each save, move, delete and restore. Putting
 * identical lines back as new nodes makes screen readers announce the same
 * warning again and again; only a change of the words may be announced.
 * Plain objects: the module's DOM surface is structural (no jsdom here).
 */
import { describe, expect, it } from "vitest";
import { createStatusLines } from "./status-lines.js";

function box(): {
  replaceChildren: (...nodes: string[]) => void;
  shown: string[][];
} {
  const shown: string[][] = [];
  return {
    replaceChildren: (...nodes) => {
      shown.push(nodes);
    },
    shown,
  };
}

describe("createStatusLines", () => {
  it("puts the lines in, and leaves the nodes alone when the same lines come again", () => {
    const b = box();
    const lines = createStatusLines(b, (text) => `<p>${text}</p>`);
    expect(lines.show(["A", "B"])).toBe(true);
    expect(lines.show(["A", "B"])).toBe(false);
    expect(b.shown).toEqual([["<p>A</p>", "<p>B</p>"]]);
  });

  it("replaces them when the words change, and empties the region when none are left", () => {
    const b = box();
    const lines = createStatusLines(b, (text) => text);
    lines.show(["A"]);
    expect(lines.show(["A", "B"])).toBe(true);
    expect(lines.show([])).toBe(true);
    expect(lines.show([])).toBe(false);
    expect(b.shown).toEqual([["A"], ["A", "B"], []]);
  });

  it("tells a line split in two from one line with the same characters", () => {
    // Why: a join on a separator could call ["a b"] and ["a", "b"] equal.
    const b = box();
    const lines = createStatusLines(b, (text) => text);
    lines.show(["a\nb"]);
    expect(lines.show(["a", "b"])).toBe(true);
  });

  it("starts empty: no lines is no change", () => {
    const b = box();
    expect(createStatusLines(b, (text) => text).show([])).toBe(false);
    expect(b.shown).toEqual([]);
  });
});
