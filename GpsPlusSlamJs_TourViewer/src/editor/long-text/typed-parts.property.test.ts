/**
 * Why this property matters: the writer promises that "Make it plain
 * text" never removes a word. Bodies are built from a fixed vocabulary
 * that no mark contains, mixed with every kind of mark the reader shows
 * as typed, so any fix that dropped or changed a vocabulary word would
 * change its count. A picture's address is built from other letters: it
 * is not read by visitors and goes with the picture's marks.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { plainTextEdit, typedParts } from "./typed-parts.js";

const VOCAB = ["alpha", "bravo", "charlie", "delta", "echo"] as const;

const piece = fc.constantFrom(
  ...VOCAB,
  " ",
  " ",
  "\n",
  "\n\n",
  "#### ",
  "> > ",
  "+ ",
  "1) ",
  "- ",
  "      - ",
  "---",
  "\n=====\n",
  "```",
  "`",
  "|",
  "\t",
  "<b>",
  "</b>",
  "<i>",
  "&amp;",
  "&zz;",
  "<https://xy.zq>",
  "~~",
  "[^1]",
  "[^1]: ",
  "[ref]: https://xy.zq",
  "![",
  "](https://xy.zq/p.png)",
  "](asset:pic-1)",
  "](asset:gone)",
  "[",
  "](javascript:x)",
  "](https://xy.zq)",
);

const body = fc.array(piece, { maxLength: 40 }).map((parts) => parts.join(""));

function counts(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const w of VOCAB) {
    out[w] = text.match(new RegExp(w, "g"))?.length ?? 0;
  }
  return out;
}

const assetExists = (id: string): boolean => id.startsWith("pic");

describe("Make it plain text keeps every word", () => {
  it("keeps the count of every vocabulary word, for every part", () => {
    fc.assert(
      fc.property(body, (b) => {
        for (const part of typedParts(b, { assetExists })) {
          const edit = plainTextEdit(b, part);
          expect(edit.from).toBeGreaterThanOrEqual(0);
          expect(edit.from).toBeLessThanOrEqual(part.from);
          expect(edit.to).toBeGreaterThanOrEqual(part.to);
          expect(edit.to).toBeLessThanOrEqual(b.length);
          const out = b.slice(0, edit.from) + edit.text + b.slice(edit.to);
          expect(counts(out)).toEqual(counts(b));
        }
      }),
      { numRuns: 2000 },
    );
  });
});
