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

  // About 2.2 s alone (measured 2026-10-07): the 5 s default timed out
  // under a loaded machine (tour-viewer unit flakes follow-up, 2026-10-06-2352), so the budget is explicit; the run
  // count is not lowered.
  it(
    "agrees with URLSearchParams.has('qr') on random queries (property)",
    { timeout: 30_000 },
    () => {
      fc.assert(
        fc.property(fc.webQueryParameters(), (query) => {
          const search = `?${query}`;
          const expected = new URLSearchParams(search).has("qr")
            ? "visitor"
            : "creator";
          expect(viewerModeFromSearch(search)).toBe(expected);
        }),
      );
    },
  );
});
