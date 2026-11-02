/**
 * Why these properties matter: whatever text and selection a creator has,
 * a formatting command must only add or take off marks, never lose or
 * change a letter (bold on part of a word, or Enter inside one, splits the
 * word but keeps its letters in order), and Enter in a list must only add
 * a line's mark. A command that ate a letter would be the one thing the
 * writer promises never to do.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  applied,
  continueList,
  indentLines,
  toggleHeading,
  toggleList,
  wrapInline,
  type WriterEdit,
} from "./writer-edits.js";

const text = fc
  .array(
    fc.constantFrom(
      "alpha",
      "beta",
      "gamma",
      " ",
      "\n",
      "\n\n",
      "- ",
      "* ",
      "1. ",
      "12) ",
      "## ",
      "### ",
      "  ",
      "**",
      "*",
    ),
    { maxLength: 30 },
  )
  .map((parts) => parts.join(""));

/** The text with a selection inside it. */
const withSelection = text.chain((value) =>
  fc
    .tuple(fc.nat({ max: value.length }), fc.nat({ max: value.length }))
    .map(([a, b]) => ({ value, a, b })),
);

/** The letters of `value`, in order (a list's numbers are marks). */
function words(value: string): string {
  return value.replace(/[^\p{L}]/gu, "");
}

/** The letters left once an edit is applied (none applied: the text's own). */
function wordsAfter(value: string, edit: WriterEdit | null): string {
  return words(edit === null ? value : applied(value, edit).value);
}

describe("formatting keeps every word", () => {
  it("bold, italic, lists, headings and indents change only marks", () => {
    fc.assert(
      fc.property(withSelection, ({ value, a, b }) => {
        expect(wordsAfter(value, wrapInline(value, a, b, "**"))).toBe(
          words(value),
        );
        expect(wordsAfter(value, wrapInline(value, a, b, "*"))).toBe(
          words(value),
        );
        expect(wordsAfter(value, toggleList(value, a, b, "bullet"))).toBe(
          words(value),
        );
        expect(wordsAfter(value, toggleList(value, a, b, "number"))).toBe(
          words(value),
        );
        expect(wordsAfter(value, toggleHeading(value, a, b, 2))).toBe(
          words(value),
        );
        expect(wordsAfter(value, toggleHeading(value, a, b, 3))).toBe(
          words(value),
        );
        expect(wordsAfter(value, indentLines(value, a, b, "in"))).toBe(
          words(value),
        );
        expect(wordsAfter(value, indentLines(value, a, b, "out"))).toBe(
          words(value),
        );
      }),
      { numRuns: 1000 },
    );
  });

  it("every edit lies inside the text and its selection inside the result", () => {
    fc.assert(
      fc.property(withSelection, ({ value, a, b }) => {
        for (const edit of [
          wrapInline(value, a, b, "**"),
          toggleList(value, a, b, "number"),
          toggleHeading(value, a, b, 2),
          continueList(value, a),
        ]) {
          if (edit === null) continue;
          expect(edit.from).toBeGreaterThanOrEqual(0);
          expect(edit.to).toBeGreaterThanOrEqual(edit.from);
          expect(edit.to).toBeLessThanOrEqual(value.length);
          const out = applied(value, edit);
          const [s, e] = out.selection;
          expect(0 <= s && s <= e && e <= out.value.length).toBe(true);
        }
      }),
      { numRuns: 1000 },
    );
  });
});

describe("list continuation", () => {
  it("Enter in a list line adds only a line break and a mark, or ends the list", () => {
    fc.assert(
      fc.property(withSelection, ({ value, a }) => {
        const edit = continueList(value, a);
        if (edit === null) return;
        // Ending the list removes only a mark and spaces; continuing it
        // inserts a line break and a mark at the cursor.
        const ends = edit.text === "";
        const mark = /^\n\s*(?:[-*+]|\d{1,4}[.)]) $/;
        expect(ends ? words(value.slice(edit.from, edit.to)) : "").toBe("");
        expect(ends || edit.from === edit.to).toBe(true);
        expect(ends || mark.test(edit.text)).toBe(true);
        expect(wordsAfter(value, edit)).toBe(words(value));
      }),
      { numRuns: 2000 },
    );
  });
});
