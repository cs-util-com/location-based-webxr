import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Why this file exists: `GpsPlusSlamJs_Osm/src/mesh/plates-clip.test.ts` proves
 * that `clipTo` **does something when passed** — it removes ~55 % of the mesh
 * vertices and ~16× of the build time. It does **not** prove that production
 * passes it, and those are different claims.
 *
 * Cold review of the commit that added that guard caught the gap: every
 * assertion there constructs its own box and calls `buildAreaPlates` directly,
 * while the only production call site lives here, in a different package. Delete
 * `clipTo` from `demo-worker.ts` and the entire gate stays green while the mesh
 * build returns to ~2 s — which is precisely the regression the other file's
 * docstring claims to prevent.
 *
 * **This is a SOURCE-TEXT check, and that is a deliberate trade.** The honest
 * alternative — importing `buildMesh` and spying — is not available: `buildMesh`
 * is module-private to `demo-worker.ts`, and the worker cannot be instantiated in
 * a unit test without a `Worker` global and an `init` round-trip. A source check
 * cannot see a `clipTo` that is passed but computed wrongly; it can see the one
 * failure mode actually reported from measurement, which is the option going
 * missing. `plates-clip.test.ts` covers the other half.
 */

const WORKER_SRC = new URL("./demo-worker.ts", import.meta.url);

describe("the production area-plate call site", () => {
  const source = readFileSync(WORKER_SRC, "utf8");

  it("finds the call at all, so the check cannot pass by looking at nothing", () => {
    // VACUITY GUARD, and the one that matters most for a source-text test: if
    // the call is renamed, moved to another module, or this path goes stale,
    // every assertion below would pass against an empty search. Failing here
    // means "re-point this test", not "the clip is gone".
    expect(source).toMatch(/buildAreaPlates\s*\(/);
  });

  it("passes clipTo on EVERY buildAreaPlates call", () => {
    // The measured cost of not doing so: ~2 160 ms against ~135 ms, with the
    // same plate count returned either way — so nothing downstream looks wrong
    // and no other assertion in the repo fires.
    const calls = [
      ...source.matchAll(/buildAreaPlates\s*\(([\s\S]{0,400}?)\)\s*;/g),
    ];
    expect(calls.length).toBeGreaterThan(0);

    for (const [whole, args] of calls) {
      expect(
        args,
        `a buildAreaPlates call omits clipTo, which costs ~2 s per full mesh build and changes nothing visible:\n${whole}`,
      ).toMatch(/clipTo\s*:/);
    }
  });
});
