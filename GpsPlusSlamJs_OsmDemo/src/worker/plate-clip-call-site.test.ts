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

/**
 * Every `buildAreaPlates(...)` call in `source`, its argument list bounded by
 * walking to the matching close-paren rather than by a guessed character
 * budget or a trailing `);`.
 *
 * Extracted so the WALKER ITSELF is testable against synthetic sources — the
 * PR #333 review noted the commit message claimed it was "mutation-tested
 * against that shape" while, inline in the test body, the only source it
 * could ever see was the real `demo-worker.ts` (PR #333 review, second
 * thread).
 */
function enumerateBuildAreaPlatesCalls(
  source: string,
): { args: string; at: number }[] {
  const calls = [];
  for (const match of source.matchAll(/buildAreaPlates\s*\(/g)) {
    let depth = 0;
    let end = match.index + match[0].length - 1;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push({
      args: source.slice(match.index + match[0].length, end),
      at: source.slice(0, match.index).split("\n").length,
    });
  }
  return calls;
}

describe("the call enumerator", () => {
  it("sees the shapes the first version silently skipped", () => {
    // The `);`-anchored version missed a call used as a sub-expression and a
    // call whose arguments ran long — and `calls.length > 0` let the existing
    // clipped call keep the guard green while an unclipped one in either shape
    // went unseen. These fixtures fail against that version.
    const synthetic = [
      `const plates = buildAreaPlates(all, options).filter(keep);`,
      `return buildAreaPlates(all, { clipTo: box(a, b), ${"x: 1, ".repeat(80)}});`,
      `buildAreaPlates(nest(fn(1), fn(2)), options);`,
    ].join("\n");

    const calls = enumerateBuildAreaPlatesCalls(synthetic);
    expect(calls).toHaveLength(3);
    expect(calls[0]?.args).toBe("all, options");
    expect(calls[1]?.args).toContain("clipTo: box(a, b)");
    expect(calls[2]?.args).toBe("nest(fn(1), fn(2)), options");
    expect(calls.map((c) => c.at)).toEqual([1, 2, 3]);
  });
});

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
    // ENUMERATED BY COUNTING PARENTHESES, not by matching a closing `);`.
    //
    // The first version required the call to end in `)` `;` within 400
    // characters, which silently skipped the two shapes that matter most —
    // `buildAreaPlates(all, options).filter(...)` and any call whose arguments
    // ran long. Since `calls.length` was only checked against zero, the existing
    // clipped call kept the guard green while an added unclipped one in either
    // shape went unseen. That is precisely "a new call site without it", one of
    // the three regressions this file names. Caught in review of PR #333.
    const calls = enumerateBuildAreaPlatesCalls(source);
    expect(calls.length).toBeGreaterThan(0);

    for (const call of calls) {
      expect(
        call.args,
        `demo-worker.ts:${call.at} calls buildAreaPlates without clipTo, which costs ~2 s per full mesh build and changes nothing visible`,
      ).toMatch(/clipTo\s*:/);
    }
  });
});
