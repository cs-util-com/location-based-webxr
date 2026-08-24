/**
 * The endpoint → operator grouping.
 *
 * WHY THESE TESTS MATTER. The default pool has five entries and three
 * operators, and everything the retry policy does with a refusal depends on
 * knowing which is which. Get the grouping wrong in one direction and the
 * client spends attempts on a quota it has already been refused by; wrong in
 * the other and a self-hosted instance inherits a stranger's rate limit.
 *
 * The last test here is the one with the shortest half-life: the same table
 * exists in `scripts/benchmark-matrix.mjs`, which cannot be imported from `src`
 * (plain `.mjs`, no build step, deliberately). Duplication is the accepted cost;
 * an assertion that the copies agree is what keeps it honest.
 */

import { describe, expect, it } from "vitest";

import {
  hostnameOf,
  knownOperatorHostnames,
  operatorForUrl,
} from "./overpass-operators.js";
import { DEFAULT_OVERPASS_ENDPOINTS } from "./overpass-source.js";

describe("operatorForUrl", () => {
  it("groups all three FOSSGIS front-ends as ONE operator", () => {
    // THE FINDING THIS TABLE EXISTS FOR. The three answered `/api/status` on
    // 2026-08-19 with one connection id and one rate limit, and two of them
    // named the same backend. Treating them as three chances is what made a
    // 429 on the first entry predict a 429 on the retry.
    expect(operatorForUrl("https://lz4.overpass-api.de/api/interpreter")).toBe(
      "fossgis",
    );
    expect(operatorForUrl("https://z.overpass-api.de/api/interpreter")).toBe(
      "fossgis",
    );
    expect(operatorForUrl("https://overpass-api.de/api/interpreter")).toBe(
      "fossgis",
    );
  });

  it("groups kumi.systems with private.coffee, which it became", () => {
    // The OSM wiki records the rename, and the 2026-07-28 benchmark found both
    // returning byte-identical bodies — two names, one instance, one quota.
    const a = operatorForUrl("https://overpass.private.coffee/api/interpreter");
    const b = operatorForUrl("https://overpass.kumi.systems/api/interpreter");
    expect(a).toBe("private.coffee");
    expect(b).toBe(a);
  });

  it("gives an UNKNOWN host its own operator rather than lumping it in", () => {
    // The asymmetry is the point. Splitting one operator into two costs a
    // single wasted attempt; merging two into one throttles a self-hosted
    // instance permanently against a quota it does not share. A self-hosted
    // endpoint passed via `endpoints` is precisely the case that must stay
    // independent, and it is also the case the table can never know about.
    expect(operatorForUrl("https://overpass.example.org/api/interpreter")).toBe(
      "overpass.example.org",
    );
    expect(
      operatorForUrl("https://a.example.org/api/interpreter") ===
        operatorForUrl("https://b.example.org/api/interpreter"),
    ).toBe(false);
  });

  it("never throws on a URL it cannot parse", () => {
    // Reached from inside the retry loop, where a throw would turn a recoverable
    // fetch failure into an unhandled one. A caller-supplied `endpoints` entry
    // is the likely source of a malformed URL.
    expect(hostnameOf("not a url")).toBe("not a url");
    expect(operatorForUrl("not a url")).toBe("not a url");
  });

  it("covers every endpoint in the shipped default pool", () => {
    // Why this test matters: an endpoint the table does not know becomes its
    // own operator, which is the safe default for a stranger but the WRONG
    // answer for a host we ship — a fourth FOSSGIS front-end added to the pool
    // without a table entry would silently be treated as independent, and the
    // retry policy would go back to spending attempts on a spent quota.
    for (const url of DEFAULT_OVERPASS_ENDPOINTS) {
      expect(Object.keys(knownOperatorHostnames())).toContain(hostnameOf(url));
    }
  });

  // THE AGREEMENT WITH `scripts/benchmark-matrix.mjs` IS ASSERTED THERE, in
  // `benchmark-matrix.test.mjs`, not here. `typecheck:tests` compiles
  // `src/**/*.ts` only, so importing the untyped `.mjs` from this file fails
  // with TS6307 — and adding the scripts directory to the vitest tsconfig to
  // satisfy one import would put a whole directory of hand-written JS under the
  // type-checker for no other reason. The script's own test already imports the
  // script, so the check costs nothing there.
});
