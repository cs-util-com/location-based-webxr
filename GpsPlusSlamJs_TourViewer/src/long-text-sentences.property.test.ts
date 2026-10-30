/**
 * Why this test matters: the reading mark moves sentence by sentence and
 * the position readout counts them. For any text the spans must be in
 * order, must not overlap, must not start or end in white space, and
 * together must cover every letter - a letter outside every span is a
 * word the mark can never reach.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { sentenceSpans } from "./long-text-sentences.js";

const PIECES = [
  "The hall",
  " burned",
  ".",
  "!",
  "?",
  " ",
  "  ",
  "\n",
  "\n\n",
  "“Why?”",
  " (in 1612)",
  "Mr. Brown",
  "...",
  "été",
  "2.5 m",
];

describe("sentenceSpans (property)", () => {
  it("gives ordered, trimmed, non-overlapping spans covering every letter", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...PIECES), { maxLength: 40 }),
        fc.constantFrom("en", "de", "fr"),
        (pieces, lang) => {
          const text = pieces.join("");
          const spans = sentenceSpans(text, lang);
          const broken: string[] = [];
          let end = 0;
          const covered = new Set<number>();
          for (const { from, to } of spans) {
            if (from < end) broken.push(`overlap at ${String(from)}`);
            if (!(to > from)) broken.push(`empty at ${String(from)}`);
            if (/\s/u.test(text.charAt(from))) broken.push("leading space");
            if (/\s/u.test(text.charAt(to - 1))) broken.push("trailing space");
            if (to > text.length) broken.push("past the end");
            for (let i = from; i < to; i += 1) covered.add(i);
            end = to;
          }
          for (let i = 0; i < text.length; i += 1) {
            if (!/\s/u.test(text.charAt(i)) && !covered.has(i)) {
              broken.push(`letter ${String(i)} outside every sentence`);
            }
          }
          expect(broken).toEqual([]);
        },
      ),
      { numRuns: 500 },
    );
  });
});
