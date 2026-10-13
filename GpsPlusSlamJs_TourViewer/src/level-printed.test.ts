/**
 * The code's printed text on its level file (follow-up F2): a re-print
 * reads the spelling and the number a code was printed with instead of
 * guessing them by hashing a fixed list of spellings.
 *
 * Why these tests matter: the field is external data in a hosted zip, so
 * it is read leniently (anything but a usable string is no text, never a
 * reason to reject the level); visitors' parser must not see it change;
 * and every re-mint must carry it, or the next re-print falls back to
 * guessing for exactly the codes that were re-measured.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseQrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";

import {
  carryPrintedText,
  readPrintedText,
  withPrintedText,
} from "./level-printed";

const TEXT = "https://gps.csutil.com/tour/?qr=~AQMxQTRtVThlVjE2&n=2";
const LEVEL = JSON.stringify({
  version: 1,
  qr: {
    physicalSizeM: 0.18,
    geo: { lat: 48.1, lon: 11.5, alt: 520, headingDeg: 90 },
  },
  content: { kept: true },
});

describe("withPrintedText / readPrintedText", () => {
  it("writes the text as qr.printed and reads it back, keeping every other field", () => {
    const json = withPrintedText(LEVEL, TEXT);
    expect(readPrintedText(json)).toBe(TEXT);
    const data = JSON.parse(json) as Record<string, unknown>;
    expect(data["content"]).toEqual({ kept: true });
    expect((data["qr"] as Record<string, unknown>)["physicalSizeM"]).toBe(0.18);
  });

  it("is invisible to the visitors' parser", () => {
    // The framework's parser rebuilds the level from known fields, so a
    // visitor's page reads the same level with or without the field.
    expect(parseQrLevel(JSON.parse(withPrintedText(LEVEL, TEXT)))).toEqual(
      parseQrLevel(JSON.parse(LEVEL)),
    );
  });

  it("reads no text from a level without one, a damaged field or a non-level", () => {
    expect(readPrintedText(LEVEL)).toBeNull();
    const withField = (printed: unknown) =>
      JSON.stringify({ version: 1, qr: { printed } });
    expect(readPrintedText(withField(42))).toBeNull();
    expect(readPrintedText(withField(""))).toBeNull();
    expect(readPrintedText(withField("x".repeat(5000)))).toBeNull();
    expect(readPrintedText("{")).toBeNull();
    expect(readPrintedText("[]")).toBeNull();
  });

  it("refuses to write onto something that is not a level", () => {
    expect(() => withPrintedText("{", TEXT)).toThrow(SyntaxError);
  });
});

describe("carryPrintedText - every re-mint keeps the text", () => {
  it("keeps the old level's text on the freshly minted level", () => {
    const old = withPrintedText(LEVEL, TEXT);
    expect(readPrintedText(carryPrintedText(old, LEVEL))).toBe(TEXT);
  });

  it("leaves the fresh level unchanged when the old one had no text", () => {
    expect(carryPrintedText(LEVEL, LEVEL)).toBe(LEVEL);
    expect(carryPrintedText("{", LEVEL)).toBe(LEVEL);
  });

  it("keeps a text the fresh level already has", () => {
    const old = withPrintedText(LEVEL, "https://old.example/?qr=a");
    const fresh = withPrintedText(LEVEL, TEXT);
    expect(readPrintedText(carryPrintedText(old, fresh))).toBe(TEXT);
  });

  it("round-trips any usable text (property)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 300 }), (text) => {
        expect(readPrintedText(withPrintedText(LEVEL, text))).toBe(text);
      }),
    );
  });
});
