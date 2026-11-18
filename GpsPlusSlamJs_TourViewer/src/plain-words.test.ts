/**
 * Why this test matters: the narration box lights a narrated text word by
 * word, and the editor matches a timing file to a body by the same words.
 * A word that swallows its punctuation, splits at an apostrophe, or leaks
 * past its stretch puts the voice's place on the wrong word.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { wordsOf } from "./plain-words.js";

const texts = (text: string) =>
  wordsOf(text, 0, text.length).map((w) => text.slice(w.from, w.to));

describe("wordsOf", () => {
  it("leaves punctuation between words and keeps inner apostrophes", () => {
    expect(texts("It's 1611, the well's year!")).toEqual([
      "It's",
      "1611",
      "the",
      "well's",
      "year",
    ]);
    expect(texts("Grüße, Ærø.")).toEqual(["Grüße", "Ærø"]);
    expect(texts("... !")).toEqual([]);
  });

  it("reads only the words inside its stretch", () => {
    expect(wordsOf("ab cd ef", 3, 5)).toEqual([{ from: 3, to: 5 }]);
    expect(wordsOf("abcdef", 0, 3)).toEqual([{ from: 0, to: 3 }]);
    expect(wordsOf("ab cd", -4, 2)).toEqual([{ from: 0, to: 2 }]);
  });

  it("gives words in order, inside the stretch, never empty (property)", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 80 }),
        fc.nat(90),
        fc.nat(90),
        (text, a, b) => {
          const [from, to] = a <= b ? [a, b] : [b, a];
          const words = wordsOf(text, from, to);
          let last = from;
          for (const w of words) {
            expect(w.from).toBeGreaterThanOrEqual(last);
            expect(w.to).toBeGreaterThan(w.from);
            expect(w.to).toBeLessThanOrEqual(to);
            last = w.to;
          }
        },
      ),
    );
  });
});
