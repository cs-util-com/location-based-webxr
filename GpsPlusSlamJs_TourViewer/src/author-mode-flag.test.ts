import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { authorModeEnabledFromSearch } from "./author-mode-flag";

/**
 * Why these tests matter: the flag decides which of the two AR modes boots —
 * a passerby scanning a printed QR must NEVER land in author mode, so the
 * parser is strict (`author=1` only) and everything else stays viewer. A
 * loosened parser (accepting "true"/"yes") would widen the accidental-author
 * surface without anyone noticing, because both modes boot the same AR
 * foundation and only diverge later.
 */
describe("authorModeEnabledFromSearch", () => {
  it("enables author mode only for author=1", () => {
    expect(authorModeEnabledFromSearch("?author=1")).toBe(true);
    expect(authorModeEnabledFromSearch("?qr=abc&author=1")).toBe(true);
  });

  it.each([
    "",
    "?",
    "?author=",
    "?author=0",
    "?author=true",
    "?author=yes",
    "?qr=abc",
  ])("stays in viewer mode for %j", (search) => {
    expect(authorModeEnabledFromSearch(search)).toBe(false);
  });

  it("never enables author mode unless the author param is exactly '1' (property)", () => {
    fc.assert(
      fc.property(
        fc.webQueryParameters(),
        // Random query strings: enabled ⇔ URLSearchParams reads author === "1".
        (query) => {
          const search = `?${query}`;
          const expected = new URLSearchParams(search).get("author") === "1";
          expect(authorModeEnabledFromSearch(search)).toBe(expected);
        },
      ),
    );
  });
});
