import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  DEFAULT_CODE_DISCRIMINATOR,
  codeFromDetectedText,
  codeFromSearch,
} from "./code-param";

/**
 * Why these tests matter: the discriminator decides WHICH level file a
 * visitor relocalizes against. A wrong fallback dead-ends a printed URL (a
 * code nobody can reprint cheaply), and a parser that reads `c` from the
 * wrong place anchors the visitor to another poster's geometry.
 */
describe("codeFromSearch", () => {
  it("reads c and defaults to '1' when absent/empty", () => {
    expect(codeFromSearch("?qr=x&c=2")).toBe("2");
    expect(codeFromSearch("?qr=x")).toBe(DEFAULT_CODE_DISCRIMINATOR);
    expect(codeFromSearch("?c=")).toBe(DEFAULT_CODE_DISCRIMINATOR);
    expect(codeFromSearch("")).toBe(DEFAULT_CODE_DISCRIMINATOR);
  });

  it("never returns an empty discriminator (property)", () => {
    fc.assert(
      fc.property(fc.webQueryParameters(), (query) => {
        expect(codeFromSearch(`?${query}`).length).toBeGreaterThan(0);
      }),
    );
  });
});

describe("codeFromDetectedText", () => {
  it("reads c from a printed launch URL", () => {
    expect(
      codeFromDetectedText("https://gps.csutil.com/tour/?qr=abc&c=3"),
    ).toBe("3");
  });

  it("falls back to '1' for URLs without c and for non-URL text", () => {
    expect(codeFromDetectedText("https://gps.csutil.com/tour/?qr=abc")).toBe(
      DEFAULT_CODE_DISCRIMINATOR,
    );
    expect(codeFromDetectedText("not a url")).toBe(DEFAULT_CODE_DISCRIMINATOR);
  });
});
