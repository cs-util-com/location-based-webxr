import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  ELLIPSIS,
  PLATE_MAX_LINES,
  plainWords,
  plateLines,
  tagLine,
} from "./plate.js";

/** A line fits within `n` characters: a monospace stand-in for a
 *  canvas's measure. */
const within = (n: number) => (line: string) => line.length <= n;

describe("a framed print's plate", () => {
  // Why: the plate shows three lines and the sheet all of the caption;
  // a short caption must come through whole, unmarked.
  it("keeps a caption that fits whole, with no ellipsis", () => {
    expect(plateLines("The market hall in 1885", within(12))).toEqual({
      lines: ["The market", "hall in 1885"],
      truncated: false,
    });
  });

  // Why: the three-line cut is the plate's rule (the prototype's wrap): a
  // fourth line is never drawn, and the last ends in an ellipsis, its
  // closing punctuation dropped before it.
  it("cuts after three lines and ends the third in an ellipsis", () => {
    const cut = plateLines(
      "one two three, four five six, seven eight, nine ten",
      within(14),
    );
    expect(cut.truncated).toBe(true);
    expect(cut.lines).toHaveLength(PLATE_MAX_LINES);
    expect(cut.lines.at(-1)).toBe(`seven eight${ELLIPSIS}`);
    expect(cut.lines.every((l) => l.length <= 14)).toBe(true);
  });

  // Why: a word longer than a line must still show (alone on its line),
  // never loop or vanish.
  it("puts a word longer than a line on a line of its own", () => {
    expect(plateLines("a Marktplatzhallenbau b", within(5)).lines).toEqual([
      "a",
      "Marktplatzhallenbau",
      "b",
    ]);
  });

  it("gives no line for no caption", () => {
    expect(plateLines(undefined, within(10))).toEqual({
      lines: [],
      truncated: false,
    });
    expect(plateLines("  \n ", within(10)).lines).toEqual([]);
  });

  it("refuses a line count that is no whole number from 1", () => {
    expect(() => plateLines("a", within(3), 0)).toThrow(RangeError);
    expect(() => plateLines("a", within(3), 1.5)).toThrow(RangeError);
  });

  // Why: the plate is a label of the sheet's text, never different words.
  // Property: for any caption and line width, the plate's words (ellipsis
  // removed) are a prefix of the sheet's words; uncut, they are all of
  // them.
  it("always shows a prefix of the sheet's text", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.stringMatching(/^[A-Za-z]{1,12}[,.;:]?$/),
            fc.constantFrom("1885", "-", "été", "a"),
          ),
          { maxLength: 60 },
        ),
        fc.constantFrom(" ", "  ", "\n", "\t "),
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 1, max: 4 }),
        (words, gap, width, maxLines) => {
          const caption = words.join(gap);
          const cut = plateLines(caption, within(width), maxLines);
          const sheet = plainWords(caption);
          expect(cut.lines.length).toBeLessThanOrEqual(maxLines);
          const shown = cut.lines.join(" ");
          // Untruncated: the plate shows the whole caption. Truncated: it ends
          // in the ellipsis and everything before it is a prefix of the sheet.
          const holds = cut.truncated
            ? shown.endsWith(ELLIPSIS) &&
              sheet.startsWith(shown.slice(0, -ELLIPSIS.length))
            : shown === sheet;
          expect(holds, JSON.stringify({ shown, sheet })).toBe(true);
        },
      ),
      { numRuns: 400 },
    );
  });
});

describe("a cut-out's tag", () => {
  // Why: the format's title is the tag's line (a title derived from the
  // caption read as cut off); without one, the caption's first phrase.
  it("reads the title, else the caption's first phrase", () => {
    expect(tagLine("Fish stall", "Long caption. More.")).toBe("Fish stall");
    expect(tagLine(undefined, "The fish stall, 1886. It stood here.")).toBe(
      "The fish stall, 1886",
    );
    expect(tagLine("  ", undefined)).toBe("");
  });

  it("cuts a long first phrase after a whole word, with an ellipsis", () => {
    const line = tagLine(
      undefined,
      "The fishmongers of the lower market square every morning",
    );
    expect(line).toBe(`The fishmongers of the lower${ELLIPSIS}`);
    expect(line.length).toBeLessThanOrEqual(34);
  });
});
