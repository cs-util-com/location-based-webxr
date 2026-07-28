/**
 * The key-filter coverage measurement.
 *
 * Why these tests matter:
 * The plan calls this "the test that makes this honest". The Overpass query
 * fetches only elements carrying one of `OVERPASS_SELECT_KEYS`, and an element
 * that never arrives scores the multiplicative identity — which downstream reads
 * as "nothing is mapped here" rather than as a missing fetch. So the size of that
 * hole has to be a MEASURED number, not an assumption.
 *
 * These tests deliberately **report rather than assert a target**. A number that
 * moves when the sheet is edited is information; a threshold picked to make the
 * current number pass is a ratchet that gets loosened whenever it fails. The one
 * thing genuinely asserted is the property that matters operationally: no
 * fixture element that WOULD score is dropped by the filter.
 *
 * @see rule-table.ts.md
 */

import { describe, it, expect } from "vitest";
import { snapshotRuleTable } from "./rule-table-loader.js";
import { ruleTableKeys } from "./rule-table.js";
import { OVERPASS_SELECT_KEYS } from "../source/overpass-query.js";
import { loadAllFixtures } from "../test-utils/load-fixtures.js";
import { toRuleKey } from "../model/osm-tags.js";

const table = snapshotRuleTable();
const selected = new Set(OVERPASS_SELECT_KEYS);

describe("how much of the rule table the shipped filter can reach", () => {
  it("reports key and rule coverage as numbers, not as a pass/fail threshold", () => {
    const tableKeys = ruleTableKeys(table);
    const coveredKeys = tableKeys.filter((key) => selected.has(key));

    const ruleIds = Object.keys(table.rules);
    const coveredRules = ruleIds.filter((id) => {
      const key = keyOfRuleId(id, table.keys);
      return key !== undefined && selected.has(key);
    });

    const keyPct = ((100 * coveredKeys.length) / tableKeys.length).toFixed(1);
    const rulePct = ((100 * coveredRules.length) / ruleIds.length).toFixed(1);

    // Printed so a reader of CI output learns the number without opening a doc.
    console.info(
      `key-filter coverage: ${coveredKeys.length}/${tableKeys.length} keys (${keyPct}%), ` +
        `${coveredRules.length}/${ruleIds.length} scoring rules (${rulePct}%)`,
    );

    // Sanity floors only — wide enough that legitimate sheet edits do not fail
    // the build, tight enough that a filter accidentally emptied does.
    expect(coveredKeys.length).toBeGreaterThan(15);
    expect(coveredRules.length / ruleIds.length).toBeGreaterThan(0.5);
  });

  it("lists the uncovered keys, so widening the filter is an informed choice", () => {
    // Iteration 3's deliverable is to widen the filter FROM the snapshot. This
    // is the list to widen with — and the reason widening is not automatic is
    // that a runtime-derived filter would couple the two riskiest external
    // dependencies in the package to each other.
    const uncovered = ruleTableKeys(table).filter((key) => !selected.has(key));
    console.info(`uncovered rule-table keys: ${uncovered.join(", ")}`);
    expect(Array.isArray(uncovered)).toBe(true);
  });

  it("names the filter keys that the rule table does not score on", () => {
    // Expected and correct: the 3D work (§8) needs `building:part`, `height`,
    // `roof:shape` and friends, which no affordance rule scores. Asserted so
    // that a future reader does not "tidy them away" as dead entries.
    const unscored = OVERPASS_SELECT_KEYS.filter(
      (key) => !table.keys.includes(key),
    );
    expect(unscored).toEqual(
      expect.arrayContaining([
        "building:part",
        "building:levels",
        "height",
        "min_height",
        "roof:shape",
        "roof:levels",
        "layer",
      ]),
    );
  });
});

describe("the property that actually matters: nothing scoreable is dropped", () => {
  const fixtures = loadAllFixtures();

  it.each(fixtures.map((f) => [f.name, f] as const))(
    "%s — every dropped element is unscoreable",
    (_label, fixture) => {
      // The real question is not "what share of the TABLE is covered" but "what
      // share of the DATA is lost". An element is only lost if it carries NONE
      // of the selected keys; and losing it only costs a score if one of its
      // tags would have scored something other than the identity.
      const elements = ((fixture.payload as { elements?: unknown[] })
        .elements ?? []) as {
        tags?: Record<string, string>;
      }[];

      const dropped = elements.filter(
        (element) =>
          element.tags !== undefined &&
          !Object.keys(element.tags).some((key) => selected.has(key)),
      );

      const lostScores = dropped.filter((element) =>
        Object.entries(element.tags ?? {}).some(
          ([key, value]) => table.rules[toRuleKey(key, value)] !== undefined,
        ),
      );

      if (lostScores.length > 0) {
        // Reported, not asserted away: a measured gap is a finding. If this ever
        // prints, the fix is to widen OVERPASS_SELECT_KEYS with the keys named.
        const keys = new Set(
          lostScores.flatMap((e) => Object.keys(e.tags ?? {})),
        );
        console.warn(
          `${lostScores.length} element(s) dropped by the key filter WOULD have scored; ` +
            `keys involved: ${[...keys].sort().join(", ")}`,
        );
      }

      // Zero is the target and the current state. Asserted rather than merely
      // reported because this is the operational invariant — if it breaks, the
      // symptom in the field is silent unmapped-looking ground.
      expect(lostScores).toHaveLength(0);
    },
  );
});

/** The OSM key for a rule id, using the table's own key list rather than a split. */
function keyOfRuleId(id: string, keys: readonly string[]): string | undefined {
  // Longest match wins: `man_made_bridge` must resolve to `man_made`, not to a
  // hypothetical `man`. This is the same trap `ruleTableKeys` avoids by reading
  // the sheet's Key column.
  let best: string | undefined;
  for (const key of keys) {
    if (id === key || id.startsWith(`${key}_`)) {
      if (best === undefined || key.length > best.length) best = key;
    }
  }
  return best;
}
