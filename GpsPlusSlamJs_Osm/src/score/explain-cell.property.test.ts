/**
 * `explainCell` property tests — the agreement invariant, over arbitrary input.
 *
 * Why these tests matter:
 * The example tests pin the cemetery case someone wrote down. These pin the
 * claim the whole function rests on: that its arithmetic IS the scorer's, for
 * any table and any tag set. `explainCell` deliberately walks tags the scorer
 * short-circuits past, so it is one careless line away from including a skipped
 * factor in the product — and that line would only be visible on features that
 * carry a veto followed by another scored tag, which is exactly the case a
 * hand-written test set under-samples.
 *
 * @see explain-cell.ts.md
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { explainCell } from "./explain-cell.js";
import { scoreFeature, scoreCells } from "./affordance-scorer.js";
import { parseRuleTable, type RuleTable } from "../rules/rule-table.js";
import { buildFeatureIndex } from "../spatial/h3-feature-index.js";
import { AFFORDANCE_RES } from "../spatial/resolutions.js";
import { latLngToCell } from "h3-js";
import type { OsmFeature } from "../model/osm-feature.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };
const HERE = latLngToCell(COLOGNE.lat, COLOGNE.lng, AFFORDANCE_RES);

/** Tag keys the generated table knows, plus one it never will. */
const KNOWN = ["ka", "kb", "kc", "kd"] as const;
const UNKNOWN = "kz";

// Includes 0 (the veto this function exists to explain) and decimals, because
// the live sheet carries them and they are the only factors for which
// multiplication order is observable at all.
const multiplierArb = fc.constantFrom(0, 0.1, 0.5, 0.8, 1, 2, 3, 5, 7);

/** A table scoring `ka=v` .. `kd=v`, one distinct OSM key each. */
function tableWith(values: readonly number[]): RuleTable {
  const rows = KNOWN.map((k, i) => `${k}_v,${k},v,${values[i] ?? 1}`);
  return parseRuleTable(["id,Key,Value,walkable", ...rows].join("\n"), {
    source: "prop",
    fetchedAt: 0,
  });
}

/** A feature carrying some subset of the known keys, plus optionally the unknown one. */
const featureArb = fc
  .record({
    id: fc.integer({ min: 1, max: 1000 }),
    keys: fc.uniqueArray(fc.constantFrom(...KNOWN), { maxLength: 4 }),
    withUnknown: fc.boolean(),
  })
  .map(({ id, keys, withUnknown }): OsmFeature => {
    const tags: Record<string, string> = Object.fromEntries(
      keys.map((k) => [k, "v"]),
    );
    if (withUnknown) tags[UNKNOWN] = "v";
    return { type: "node", id, position: COLOGNE, tags };
  });

const tableArb = fc
  .array(multiplierArb, { minLength: 4, maxLength: 4 })
  .map(tableWith);

describe("explainCell agreement", () => {
  it("every feature's factor is EXACTLY scoreFeature's", () => {
    // Exact, not approximate: both multiply the same factors in the same tag
    // order, so the bits must match. A tolerance here would hide the very slip
    // this property exists to catch — a skipped factor folded into the product.
    fc.assert(
      fc.property(
        tableArb,
        fc.array(featureArb, { maxLength: 6 }),
        (table, features) => {
          const explanation = explainCell(HERE, features, table, "walkable");
          for (const [i, explained] of explanation.features.entries()) {
            const feature = features[i];
            if (feature === undefined) continue;
            expect(explained.factor).toBe(
              scoreFeature(feature, "walkable", table),
            );
          }
        },
      ),
    );
  });

  it("the cell score matches what the scorer computes for the same features", () => {
    // The claim that makes the details panel trustworthy: the number it explains
    // is the number the map coloured. Compared with a relative tolerance because
    // floating-point multiplication is not associative — see
    // `affordance-scorer.property.test.ts` for why bit-identity is not promised
    // across differently-ordered inputs.
    fc.assert(
      fc.property(
        tableArb,
        fc.array(featureArb, { minLength: 1, maxLength: 6 }),
        (table, features) => {
          // OSM ids must be unique or the index merges them, which would make
          // the two sides disagree for a reason that is not about arithmetic.
          const unique = features.filter(
            (f, i) => features.findIndex((g) => g.id === f.id) === i,
          );
          const scored = scoreCells(buildFeatureIndex(unique), table);
          const cell = scored.cells.find((c) => c.cell === HERE);
          if (cell === undefined) return;

          // The covering set comes from the provenance map, exactly as a
          // consumer must take it — never re-derived from geometry.
          const byKey = new Map(
            unique.map((f) => [`${f.type}/${f.id}` as const, f]),
          );
          const covering = Object.keys(cell.contributors.walkable ?? {})
            .map((key) => byKey.get(key as `node/${number}`))
            .filter((f): f is OsmFeature => f !== undefined);

          const explanation = explainCell(HERE, covering, table, "walkable");
          const expected = cell.scores.walkable ?? 1;
          if (explanation.score === expected) return;
          expect(
            Math.abs(explanation.score - expected) /
              Math.max(Math.abs(explanation.score), Math.abs(expected)),
          ).toBeLessThan(1e-12);
        },
      ),
    );
  });
});

describe("explainCell tag reporting invariants", () => {
  it("reports every tag exactly once, in the feature's own tag order", () => {
    fc.assert(
      fc.property(tableArb, featureArb, (table, feature) => {
        const explanation = explainCell(HERE, [feature], table, "walkable");
        const reported = (explanation.features[0]?.tags ?? []).map(
          (t) => t.key,
        );
        expect(reported).toEqual(Object.keys(feature.tags));
      }),
    );
  });

  it("`factor === undefined` exactly when the table has no rule for the tag", () => {
    // The distinction between "no rule" and "a rule scoring 1" — both contribute
    // nothing, and conflating them misrepresents the table's coverage.
    fc.assert(
      fc.property(tableArb, featureArb, (table, feature) => {
        for (const tag of explainCell(HERE, [feature], table, "walkable")
          .features[0]?.tags ?? []) {
          expect(tag.factor === undefined).toBe(
            table.rules[tag.ruleKey] === undefined,
          );
        }
      }),
    );
  });

  it("`skippedByVeto` is set for exactly the tags after the first zero", () => {
    // The honest part of the answer: "these were never evaluated because the
    // cemetery already vetoed it". Off-by-one here would either claim the veto
    // itself was skipped, or claim a skipped tag was weighed.
    fc.assert(
      fc.property(tableArb, featureArb, (table, feature) => {
        const tags =
          explainCell(HERE, [feature], table, "walkable").features[0]?.tags ??
          [];
        const firstZero = tags.findIndex((t) => t.factor === 0);
        for (const [i, tag] of tags.entries()) {
          expect(tag.skippedByVeto).toBe(firstZero !== -1 && i > firstZero);
        }
      }),
    );
  });
});
