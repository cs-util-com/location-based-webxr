/**
 * Why these tests matter: the helper quotes the creator's own words in
 * notes; a note longer than its line, or a cut that ends in a space
 * before the dots, reads as broken.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { truncated } from "./truncated.js";

describe("truncated", () => {
  it("keeps a short text and cuts a long one with dots", () => {
    expect(truncated("the old bridge", 40)).toBe("the old bridge");
    expect(truncated("Welcome to the old bridge", 12)).toBe("Welcome t...");
    expect(truncated("Welcome to the bridge", 11)).toBe("Welcome...");
  });

  it("is never longer than asked, for any text", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 3, max: 80 }), (s, n) => {
        const out = truncated(s, n);
        expect(out.length).toBeLessThanOrEqual(n);
        expect(out === s || s.length > n).toBe(true);
      }),
    );
  });
});
