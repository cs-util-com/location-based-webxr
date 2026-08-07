/**
 * What a retained chunk actually costs (F54).
 *
 * WHY THIS EXISTS. DEC-R9-14 declined to raise the 488-chunk cap on two grounds
 * and deliberately measured neither: the `scoresByCell` rebuild was O(everything
 * retained), and per-chunk memory was "unmeasured, and deliberately not guessed
 * at". Round 10 stage A removed the first — the map is maintained now, and
 * `scoresByCellBuilds` is pinned at 1 for an index's lifetime — so the CPU
 * objection is gone and only the memory one is left.
 *
 * WHAT IS MEASURED, and what that is worth. Serialised bytes per retained chunk,
 * over the real corpus. It is a LOWER BOUND on heap: a JS object graph carries
 * per-object headers, map overhead and string interning that JSON does not show,
 * so real memory is some multiple of this. The multiple is not measured here
 * because `process.memoryUsage()` inside a test runner measures the runner as
 * much as the subject, and a number that noisy would be worse than an honest
 * bound.
 *
 * So this answers "is raising the cap obviously cheap or obviously expensive",
 * which is the decision actually pending, rather than pretending to a precision
 * it cannot have.
 */

import { describe, expect, it } from "vitest";
import { latLngToCell } from "h3-js";

import { AffordanceIndex } from "./affordance-index.js";
import { DEFAULT_RULE_TABLE_CSV } from "../rules/default-rules.js";
import { parseRuleTable } from "../rules/rule-table.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { loadSite } from "../test-utils/load-fixtures.js";
import { CORPUS_SITES } from "../places/sites.js";
import { OVERPASS_SCHEMA_VERSION } from "../source/overpass-query.js";
import { AFFORDANCE_RES, toFetchTile } from "../spatial/resolutions.js";

const TABLE = parseRuleTable(DEFAULT_RULE_TABLE_CSV, {
  source: "snapshot",
  fetchedAt: 0,
});

/**
 * Scored at MODULE SCOPE, like `corpus-score-distribution.test.ts` does, and for
 * the same reason: scoring a whole corpus site takes longer than vitest's 5 s
 * per-test timeout allows once the rest of the suite is competing for the CPU.
 * It passes standalone and times out in the full run, which is the least useful
 * kind of failure. Module-load work is not counted against a test.
 */
const CELLS = (() => {
  const site = CORPUS_SITES[0];
  if (site === undefined) throw new Error("no corpus sites");
  const features = parseOverpassJson(loadSite(site.id).payload).features;
  const index = new AffordanceIndex({ table: TABLE });
  index.acceptTile({
    tile: toFetchTile(
      latLngToCell(site.position.lat, site.position.lng, AFFORDANCE_RES),
    ),
    features,
    schemaVersion: OVERPASS_SCHEMA_VERSION,
    fetchedAt: 0,
    sourceId: `fixture:${site.id}`,
    skipped: [],
  });
  index.update(site.position);
  return [...index.scoresByCell().values()];
})();

describe("what a retained chunk costs (F54)", () => {
  it("measures serialised bytes per chunk, as a lower bound on heap", () => {
    expect(CELLS.length).toBeGreaterThan(500);

    const bytes = JSON.stringify(CELLS).length;
    const perCell = bytes / CELLS.length;
    // A res-11 chunk covers ~49 res-13 cells, so per-chunk is derived from that
    // rather than from a chunk count that varies with the fixture.
    const perChunk = perCell * 49;

    // MEASURED 2026-08-05 at Cologne, six categories, 927 cells:
    //
    //   808 bytes per cell   ~39.6 KB per chunk
    //   19.3 MB at the current 488-chunk cap
    //   79.1 MB at the 2 000 DEC-R9-14 wondered about
    //
    // AND THOSE ARE LOWER BOUNDS. A live object graph carries per-object
    // headers, Map overhead and un-interned strings that JSON does not show, so
    // real heap is several times these figures.
    //
    // SO THE ANSWER TO F54 IS NO. Stage A removed the CPU objection — the map is
    // maintained, not rebuilt — but the memory one was never measured and turns
    // out to be the real blocker: ~79 MB serialised, so plausibly 150–400 MB
    // live, for the score cache alone. Mobile browsers discard tabs well below
    // that, and this demo is meant to run on a phone.
    //
    // Bounds are wide enough that fixture drift does not fail them and narrow
    // enough that an order-of-magnitude change does — which is the only change
    // that would revisit the decision.
    expect(perCell).toBeGreaterThan(50);
    expect(perCell).toBeLessThan(2000);
    expect(perChunk).toBeGreaterThan(2_000);
    expect(perChunk).toBeLessThan(100_000);
  });
});
