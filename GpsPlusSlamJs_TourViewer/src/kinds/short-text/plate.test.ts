/**
 * Why this test matters: a sign's board is sized from its words' layout
 * before anything is painted, so a layout that lets a line run past the
 * board, loses a character or grows a board without bound shows as cut
 * or missing words in the world. The layout is pure, so it is pinned in
 * Node with a fixed measure.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  ESTIMATED_MEASURE,
  layoutSignPlate,
  PLATE_PX_PER_EM,
  SHORT_TEXT_ACCENT,
  signPlate,
  wrapText,
} from "./plate.js";

/** Every character 10 px wide. */
const tenPx = (t: string) => [...t].length * 10;

describe("wrapping a short text", () => {
  it("breaks at spaces, and a word longer than a line between its characters", () => {
    // Why: a caption is at most 40 characters, but one long word (a
    // place name) must still fit the board rather than run off it.
    expect(wrapText("the old gate", 80, tenPx)).toEqual(["the old", "gate"]);
    expect(wrapText("abcdefghij", 40, tenPx)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrapText("   ", 40, tenPx)).toEqual([" "]);
  });

  it("never loses a character and never runs past the line", () => {
    // Why: the property behind both cases above, over any text.
    fc.assert(
      fc.property(
        fc.string({ maxLength: 60 }),
        fc.integer({ min: 10, max: 300 }),
        (text, maxW) => {
          const lines = wrapText(text, maxW, tenPx);
          expect(lines.join("").replace(/\s/gu, "")).toBe(
            text.replace(/\s/gu, ""),
          );
          for (const line of lines) {
            expect(tenPx(line) <= maxW || [...line].length === 1).toBe(true);
          }
        },
      ),
    );
  });
});

describe("a sign's plate", () => {
  it("grows with its words and keeps its icon inside the board", () => {
    // Why: the board's size is the world size; a longer caption must
    // give a larger board, and the icon sits on the board.
    const short = layoutSignPlate("Gate", undefined, ESTIMATED_MEASURE);
    const long = layoutSignPlate(
      "The north gate of the old town",
      "Built in 1632 after the siege.",
      ESTIMATED_MEASURE,
    );
    expect(long.bodyW * long.bodyH).toBeGreaterThan(short.bodyW * short.bodyH);
    expect(long.descLines.length).toBeGreaterThan(0);
    for (const lay of [short, long]) {
      expect(lay.iconX).toBeGreaterThan(lay.margin);
      expect(lay.iconX).toBeLessThan(lay.margin + lay.bodyW);
      expect(lay.canvasW).toBe(lay.bodyW + 2 * lay.margin);
    }
  });

  it("keeps a long description to six lines ending in an ellipsis", () => {
    // Why: a 160-character description must not stretch the board.
    const lay = layoutSignPlate(
      "Gate",
      "word ".repeat(40).trim(),
      ESTIMATED_MEASURE,
    );
    expect(lay.descLines).toHaveLength(6);
    expect(lay.descLines[5]?.endsWith(" ...")).toBe(true);
  });

  it("stays within the widest caption line the sign allows", () => {
    // Why: 8.6 letter heights of caption at most, plus padding and icon.
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }), (caption) => {
        const lay = layoutSignPlate(caption, undefined, ESTIMATED_MEASURE);
        expect(lay.bodyW).toBeLessThanOrEqual(
          Math.ceil((8.6 + 2 * 0.55 + 1.22) * PLATE_PX_PER_EM),
        );
      }),
    );
  });

  it("is laid out without a canvas in Node, where it paints nothing", () => {
    // Why: the editor's contract tests build signs in Node; they need
    // the board's size, not its picture.
    const plate = signPlate("Gate", undefined, "warning", { icon: true });
    expect(plate.canvas).toBeNull();
    expect(plate.layout.bodyW).toBeGreaterThan(0);
  });

  it("gives each role its own accent", () => {
    // Why: the role is told apart by colour first; two alike would
    // make a warning read as a label.
    expect(new Set(Object.values(SHORT_TEXT_ACCENT)).size).toBe(3);
  });
});
