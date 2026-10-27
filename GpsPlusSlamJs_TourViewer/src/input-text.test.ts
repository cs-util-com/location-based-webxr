/**
 * Why these tests matter: typed text is stored in NFC so a cap counts the
 * same on every device and a hash of the text (B3b) is stable for text
 * that reads the same (B2a review finding 6).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { inputText } from "./input-text.js";

describe("inputText", () => {
  it("composes a decomposed accent", () => {
    const decomposed = `Cafe${String.fromCodePoint(0x301)}`;
    expect(inputText(decomposed)).toBe(`Caf${String.fromCodePoint(0xe9)}`);
  });

  it("is idempotent and keeps NFC text as it is (property)", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 60 }), (text) => {
        const once = inputText(text);
        expect(inputText(once)).toBe(once);
        expect(once).toBe(text.normalize("NFC"));
      }),
    );
  });
});
