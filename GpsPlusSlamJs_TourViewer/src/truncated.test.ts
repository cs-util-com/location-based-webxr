/**
 * Why these tests matter: the helper quotes the creator's own words in
 * notes, labels and chips; a text longer than its line, a cut that ends
 * in a space before the ellipsis, or a cut through an emoji's surrogate
 * pair (a broken character on screen) reads as broken.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { truncated } from "./truncated.js";

describe("truncated", () => {
  it("keeps a short text and cuts a long one with an ellipsis", () => {
    expect(truncated("the old bridge", 40)).toBe("the old bridge");
    expect(truncated("Welcome to the old bridge", 12)).toBe("Welcome to…");
    expect(truncated("Welcome to the bridge", 9)).toBe("Welcome…");
  });

  it("never splits a character made of two code units", () => {
    expect(truncated("🌉🌉🌉 bridge", 3)).toBe("🌉🌉…");
    expect(truncated("ab🌉cd", 4)).toBe("ab🌉…");
  });

  it("is never longer than asked and never cuts a pair, for any text", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: "grapheme-composite" }),
        fc.integer({ min: 1, max: 80 }),
        (s, n) => {
          const out = truncated(s, n);
          expect([...out].length).toBeLessThanOrEqual(n);
          expect(out === s || [...s].length > n).toBe(true);
          expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out)).toBe(
            /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(s),
          );
        },
      ),
    );
  });
});
