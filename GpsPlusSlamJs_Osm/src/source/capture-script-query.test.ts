/**
 * Pins `scripts/capture-fixtures.mjs` to the production query.
 *
 * WHY THIS TEST MATTERS — it is the cheapest possible guard against the single
 * most expensive mistake this package has made.
 *
 * The capture script is a plain `.mjs` file that cannot import the TypeScript
 * source, so its key list is a duplicate. Iteration 2.5 was supposed to remove
 * that duplication and did not: the constant was copied into
 * `src/source/overpass-query.ts` while the script kept its own, and — worse —
 * the script went on building the key REGEX form long after production moved to
 * a union of exact-key statements. The regex 504s on any real fetch tile, so a
 * re-capture would have failed and looked exactly like the server problem the
 * project had already spent a day chasing.
 *
 * Two things therefore have to stay true, and neither is visible in a diff of
 * one file:
 *
 * 1. The script's key list equals `OVERPASS_SELECT_KEYS`. A fixture captured
 *    through a different filter than production ships proves nothing about
 *    production — an element missing from a fixture would be ambiguous between
 *    "not mapped there" and "our capture filter dropped it".
 * 2. The script builds the UNION form, not a regex. This is a correctness
 *    property of the query, not a style preference: measured 2026-07-28, union
 *    200 OK vs regex 504 in 8 s on the same res-7 tile.
 *
 * Reading the script as text is deliberate. The alternative — importing the
 * built `dist/` from the script — removes the duplication entirely but couples
 * fixture capture to a build step, so a stale `dist` would silently capture
 * with an old query. A text assertion has no such failure mode.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { OVERPASS_SELECT_KEYS } from "./overpass-query.js";
import { isArealRelation } from "../model/osm-geometry.js";

const scriptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "scripts",
  "capture-fixtures.mjs",
);

const script = readFileSync(scriptPath, "utf8");

/**
 * Extracts the string literals of the script's `SELECT_KEYS` array.
 *
 * Parsing rather than evaluating: importing the script would run it, and it is
 * a network-touching CLI.
 */
function selectKeysFromScript(): string[] {
  const match = /const SELECT_KEYS = \[([\s\S]*?)\];/.exec(script);
  if (match?.[1] === undefined) {
    throw new Error(
      "Could not find `const SELECT_KEYS = [...]` in capture-fixtures.mjs. " +
        "If the script was restructured, update this test rather than deleting it.",
    );
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
}

/**
 * The body of the script's `buildQuery`, without its doc comment.
 *
 * Scoped deliberately: the first version of this test asserted over the whole
 * file and failed on the doc comment that EXPLAINS why the regex is wrong —
 * prose describing a hazard is not the hazard. Assert on the code that runs.
 */
function buildQueryBody(): string {
  const match = /function buildQuery\(bbox\) \{([\s\S]*?)\n\}/.exec(script);
  if (match?.[1] === undefined) {
    throw new Error(
      "Could not find `function buildQuery(bbox)` in capture-fixtures.mjs. " +
        "If the script was restructured, update this test rather than deleting it.",
    );
  }
  return match[1];
}

describe("scripts/capture-fixtures.mjs", () => {
  it("selects exactly the keys production selects", () => {
    // Order matters too: an identical set in a different order is fine for
    // Overpass but signals that one list was edited without the other.
    expect(selectKeysFromScript()).toEqual([...OVERPASS_SELECT_KEYS]);
  });

  it("builds a UNION of exact-key statements, not a key regex", () => {
    const body = buildQueryBody();
    // The regex form is `nwr[~"^(a|b)$"~"."]`; its signature is `nwr[~`.
    expect(body).not.toContain("nwr[~");
    // The union form emits one `nwr["<key>"];` per key inside one block.
    expect(body).toContain('nwr["${key}"];');
  });

  it("emits one trailing `out geom`, so the union returns each element once", () => {
    // A union with one `out` per statement is what produced the withdrawn
    // "the union duplicates elements" claim. One trailing `out` is the fix.
    const outStatements = buildQueryBody().match(/"out geom;"/g) ?? [];
    expect(outStatements).toHaveLength(1);
  });

  /**
   * WHY THIS SECOND PIN EXISTS (W2). The site extracts drop every relation the
   * package cannot turn into geometry, because `out geom` beside a major
   * station prints every international train route in full — measured on the
   * res-9 cathedral tile at 23.91 MB of 24.64 MB, i.e. 97 % of the payload.
   *
   * That filter is only defensible while it is EXACTLY the package's own
   * areal-relation rule: drop what `toGeometry` would produce nothing for, and
   * the extract loses nothing any consumer could have used. If the two lists
   * ever diverge, the fixtures silently start missing features the package
   * WOULD have used, and the absence would be indistinguishable from "that is
   * not mapped there" — the same ambiguity the key-list pin exists to prevent.
   *
   * The script cannot import the predicate: it is a plain `.mjs`, and Node's
   * type stripping cannot resolve the package's `.js` import specifiers.
   */
  function arealTypesFromScript(): string[] {
    const match = /const AREAL_RELATION_TYPES = \[([\s\S]*?)\];/.exec(script);
    if (match?.[1] === undefined) {
      throw new Error(
        "Could not find `const AREAL_RELATION_TYPES = [...]` in capture-fixtures.mjs. " +
          "If the script was restructured, update this test rather than deleting it.",
      );
    }
    return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
  }

  it("keeps exactly the relation types the package treats as areal", () => {
    const scriptTypes = arealTypesFromScript();
    // Asserted through the exported predicate rather than against a copied
    // list, so this stays true if `AREAL_RELATION_TYPES` is ever restructured.
    for (const type of scriptTypes) {
      expect(
        isArealRelation({
          type: "relation",
          id: 1,
          tags: { type },
          members: [],
        }),
      ).toBe(true);
    }
    // And the other direction: a type the script keeps must not be missing, so
    // a package that gained a third areal type fails here rather than silently
    // dropping it from every future capture.
    for (const type of ["multipolygon", "boundary", "route", "site"]) {
      const packageSaysAreal = isArealRelation({
        type: "relation",
        id: 1,
        tags: { type },
        members: [],
      });
      expect(scriptTypes.includes(type)).toBe(packageSaysAreal);
    }
  });
});
