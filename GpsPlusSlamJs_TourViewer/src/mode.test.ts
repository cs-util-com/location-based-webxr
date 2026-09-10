import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { viewerModeFromSearch } from "./mode";

/**
 * Why these tests matter: the mode decides which page a person sees. A
 * visitor scanning a printed code must NEVER land in the creator's setup,
 * and a creator opening the plain page must never be asked to scan a code
 * they have not printed yet. The rule is presence of `qr`, nothing else -
 * an empty or unreadable payload is still a visitor (the boot reports the
 * payload error where the visitor is looking).
 */
describe("viewerModeFromSearch", () => {
  it("is visitor mode whenever a qr parameter is present, whatever its value", () => {
    expect(viewerModeFromSearch("?qr=abc")).toBe("visitor");
    expect(viewerModeFromSearch("?qr=")).toBe("visitor");
    expect(viewerModeFromSearch("?nocache=1&qr=~blob")).toBe("visitor");
  });

  it.each(["", "?", "?nocache=1", "?author=1", "?QR=abc"])(
    "is creator mode for %j",
    (search) => {
      expect(viewerModeFromSearch(search)).toBe("creator");
    },
  );

  it("agrees with URLSearchParams.has('qr') on random queries (property)", () => {
    fc.assert(
      fc.property(fc.webQueryParameters(), (query) => {
        const search = `?${query}`;
        const expected = new URLSearchParams(search).has("qr")
          ? "visitor"
          : "creator";
        expect(viewerModeFromSearch(search)).toBe(expected);
      }),
    );
  });
});
