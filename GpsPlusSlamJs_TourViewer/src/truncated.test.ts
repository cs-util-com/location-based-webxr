/**
 * Why these tests matter: the helper quotes the creator's own words in
 * notes, labels and chips; a text longer than its line, a cut that ends
 * in a space before the ellipsis, or a cut through a character (an
 * emoji's surrogate pair, a flag, a family emoji joined by ZWJ, a letter
 * with a combining accent: a broken or changed character on screen) reads
 * as broken.
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

  it("never cuts a character made of several code points", () => {
    const family = "👨‍👩‍👧";
    const flag = "🇩🇪";
    const e = "é";
    expect(truncated(`${family}${family}${family}`, 3)).toBe(
      `${family}${family}${family}`,
    );
    expect(truncated(`${family}${family}${family}`, 2)).toBe(`${family}…`);
    expect(truncated(`${flag}${flag}${flag}`, 2)).toBe(`${flag}…`);
    expect(truncated(`Caf${e} au lait`, 5)).toBe(`Caf${e}…`);
    // Counted as one each: three of them fit in three.
    expect(truncated(`${family}${flag}${e}`, 3)).toBe(`${family}${flag}${e}`);
  });

  it("ends a cut on a character boundary, for any text", () => {
    const graphemes = (t: string) =>
      [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(t)].map(
        (g) => g.segment,
      );
    fc.assert(
      fc.property(
        fc.string({ unit: "grapheme-composite" }),
        fc.integer({ min: 1, max: 40 }),
        (s, n) => {
          const out = truncated(s, n);
          if (out === s) return;
          const kept = out.slice(0, -1);
          const whole = graphemes(s);
          const head = graphemes(kept);
          expect(head.length).toBeLessThan(n);
          // The kept start is the text's first characters, whole.
          expect(head).toEqual(whole.slice(0, head.length));
        },
      ),
    );
  });

  it("is never longer than asked and never cuts a pair, for any text", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: "grapheme-composite" }),
        fc.integer({ min: 1, max: 80 }),
        (s, n) => {
          const out = truncated(s, n);
          const count = (t: string) =>
            [
              ...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(
                t,
              ),
            ].length;
          expect(count(out)).toBeLessThanOrEqual(n);
          expect(out === s || count(s) > n).toBe(true);
          expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out)).toBe(
            /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(s),
          );
        },
      ),
    );
  });
});
