import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { viewerModeFromSearch, meshCursorFromSearch } from "./mode";

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

describe("meshCursorFromSearch (polish round M5, Q-Mesh; the default since 2026-10-15)", () => {
  // Why: the owner tested the mesh cursor on the phone ("it works fine")
  // and it became the creator default (mesh-cursor smoothing plan
  // 2026-10-15-0944): only ?mesh=0 turns it off, and the old ?mesh=1 links
  // keep working. The off values mirror the debug flag's on values
  // (`1`/`true`, case and spaces tolerated); any other value keeps it on,
  // so a typo never silently drops a creator back to the hit-test ring.
  it("is on unless mesh=0 (or false)", () => {
    for (const search of [
      "",
      "?mesh=1",
      "?debug=1&mesh=1",
      "?debug=1",
      "?mesh",
      "?mesh=true",
      "?mesh=01",
    ]) {
      expect(meshCursorFromSearch(search), search).toBe(true);
    }
    expect(meshCursorFromSearch("?mesh=0")).toBe(false);
    expect(meshCursorFromSearch("?debug=1&mesh=0")).toBe(false);
    expect(meshCursorFromSearch("?mesh=false")).toBe(false);
    expect(meshCursorFromSearch("?mesh=%20FALSE%20")).toBe(false);
  });
});

/**
 * Why these tests matter (tour editor plan 2026-10-17-1816, W1): the page
 * paints before `main.ts` has run its imports, and the paper colour and the
 * hidden header are keyed on `body[data-mode]`. A tiny inline script, the
 * body's first child, sets the mode for that first paint - with its own
 * copy of the rule, since a classic inline script cannot import this
 * module. These tests hold the copy to the rule: if the two ever disagreed,
 * the page would paint one mode and then switch to the other.
 */
describe("the first-paint script in index.html", () => {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const html = readFileSync(resolve(packageRoot, "index.html"), "utf8");
  const match =
    /<body class="page">\s*<script id="first-paint-mode">([\s\S]*?)<\/script>/.exec(
      html,
    );

  it("is the body's first child, so it runs before anything is painted", () => {
    expect(match).not.toBeNull();
  });

  /** The mode the inline script writes for `search`. */
  function inlineMode(search: string): string | undefined {
    const dataset: Record<string, string> = {};
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const run = new Function("location", "document", match?.[1] ?? "") as (
      location: { search: string },
      document: { body: { dataset: Record<string, string> } },
    ) => void;
    run({ search }, { body: { dataset } });
    return dataset["mode"];
  }

  it.each(["", "?", "?qr=abc", "?qr=", "?nocache=1&qr=~blob", "?QR=abc"])(
    "writes the mode viewerModeFromSearch reads for %j",
    (search) => {
      expect(inlineMode(search)).toBe(viewerModeFromSearch(search));
    },
  );

  it(
    "agrees with viewerModeFromSearch on random queries (property)",
    { timeout: 30_000 },
    () => {
      fc.assert(
        fc.property(fc.webQueryParameters(), (query) => {
          const search = `?${query}`;
          expect(inlineMode(search)).toBe(viewerModeFromSearch(search));
        }),
      );
    },
  );
});
