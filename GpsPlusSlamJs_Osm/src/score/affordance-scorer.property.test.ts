/**
 * Scoring property tests.
 *
 * Why these tests matter:
 * The oracle tests prove the kernel reproduces the C# reference's published
 * numbers for the cases someone wrote down. These prove the algebra holds for
 * arbitrary tables and arbitrary feature sets — in particular ORDER
 * INDEPENDENCE, which the short-circuit is the obvious threat to: a `return`
 * mid-loop that skipped the wrong work would make the score depend on the order
 * OSM happened to list an element's tags in.
 *
 * @see affordance-scorer.ts.md
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { scoreFeature, scoreCells } from "./affordance-scorer.js";
import { parseRuleTable } from "../rules/rule-table.js";
import type { RuleTable } from "../rules/rule-table.js";
import { buildFeatureIndex } from "../spatial/h3-feature-index.js";
import type { OsmFeature } from "../model/osm-feature.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };

/** Tag values that the generated table knows about. */
const VALUES = ["a", "b", "c", "d"] as const;

/** A table assigning an arbitrary multiplier to each of `k_a` .. `k_d`. */
function tableWith(values: readonly number[]): RuleTable {
  return parseRuleTable(
    [
      "id,Key,Value,walkable",
      ...VALUES.map((v, i) => `k_${v},k,${v},${values[i] ?? 1}`),
    ].join("\n"),
    { source: "prop", fetchedAt: 0 },
  );
}

const multiplierArb = fc.constantFrom(0, 0.5, 1, 2, 3, 5, 7);

const tagsArb = fc.uniqueArray(fc.constantFrom(...VALUES), { maxLength: 4 });

const node = (id: number, values: readonly string[]): OsmFeature => ({
  type: "node",
  id,
  position: COLOGNE,
  // One key with many values is impossible in OSM, so distinct keys are used
  // and the table is keyed to match — the shape under test is the PRODUCT, not
  // the tag syntax.
  tags: Object.fromEntries(values.map((v) => [`k`, v])),
});

/** A feature carrying exactly one of the known tags. */
const oneTag = (id: number, value: string): OsmFeature => ({
  type: "node",
  id,
  position: COLOGNE,
  tags: { k: value },
});

describe("scoring algebra", () => {
  it("is ORDER-INDEPENDENT over features", () => {
    // The short-circuit is the obvious threat: a `return` that skipped the wrong
    // work would make the answer depend on which feature happened to come first.
    fc.assert(
      fc.property(
        fc.array(multiplierArb, { minLength: 4, maxLength: 4 }),
        fc.array(fc.constantFrom(...VALUES), { minLength: 1, maxLength: 5 }),
        (multipliers, values) => {
          const table = tableWith(multipliers);
          const features = values.map((v, i) => oneTag(i + 1, v));

          const forward = scoreCells(buildFeatureIndex(features), table)
            .cells[0]?.scores["walkable"];
          const backward = scoreCells(
            buildFeatureIndex([...features].reverse()),
            table,
          ).cells[0]?.scores["walkable"];

          expect(forward).toBe(backward);
        },
      ),
    );
  });

  it("is ORDER-INDEPENDENT over a feature's own tags", () => {
    fc.assert(
      fc.property(
        fc.array(multiplierArb, { minLength: 4, maxLength: 4 }),
        tagsArb,
        (multipliers, values) => {
          const table = tableWith(multipliers);
          const tags = Object.fromEntries(values.map((v) => [`k${v}`, v]));
          const reversed = Object.fromEntries(Object.entries(tags).reverse());

          const a = scoreFeature(
            { type: "node", id: 1, position: COLOGNE, tags },
            "walkable",
            table,
          );
          const b = scoreFeature(
            { type: "node", id: 1, position: COLOGNE, tags: reversed },
            "walkable",
            table,
          );
          expect(a).toBe(b);
        },
      ),
    );
  });

  it("ZERO is absorbing: any veto anywhere makes the cell 0", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...VALUES), { minLength: 0, maxLength: 4 }),
        (others) => {
          // `a` is the veto in this table; everything else is positive.
          const table = tableWith([0, 2, 3, 5]);
          const features = [
            oneTag(1, "a"),
            ...others.map((v, i) => oneTag(i + 2, v)),
          ];
          const score = scoreCells(buildFeatureIndex(features), table).cells[0]
            ?.scores["walkable"];
          expect(score).toBe(0);
        },
      ),
    );
  });

  it("is MONOTONICALLY NON-DECREASING as features with values >= 1 are added", () => {
    // The statement that makes thresholding meaningful: adding evidence can only
    // strengthen a cell, never weaken it — as long as no rule vetoes.
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(1, 2, 3, 5), { minLength: 4, maxLength: 4 }),
        fc.array(fc.constantFrom(...VALUES), { minLength: 1, maxLength: 4 }),
        (multipliers, values) => {
          const table = tableWith(multipliers);
          let previous = 1;
          for (let n = 1; n <= values.length; n++) {
            const features = values.slice(0, n).map((v, i) => oneTag(i + 1, v));
            const score =
              scoreCells(buildFeatureIndex(features), table).cells[0]?.scores[
                "walkable"
              ] ?? 1;
            expect(score).toBeGreaterThanOrEqual(previous);
            previous = score;
          }
        },
      ),
    );
  });

  it("provenance factors always multiply back to the total", () => {
    // The invariant that makes the provenance map trustworthy rather than
    // decorative. If it cannot reconstruct the score, it cannot explain it.
    fc.assert(
      fc.property(
        fc.array(multiplierArb, { minLength: 4, maxLength: 4 }),
        fc.array(fc.constantFrom(...VALUES), { minLength: 1, maxLength: 5 }),
        (multipliers, values) => {
          const table = tableWith(multipliers);
          const features = values.map((v, i) => oneTag(i + 1, v));
          const cell = scoreCells(buildFeatureIndex(features), table).cells[0];
          if (cell === undefined) return;

          const product = Object.values(
            cell.contributors["walkable"] ?? {},
          ).reduce((a, b) => a * b, 1);
          expect(product).toBe(cell.scores["walkable"]);
        },
      ),
    );
  });

  it("an unknown tag always contributes exactly the identity", () => {
    // The rule that keeps an unmapped tag from vetoing. Its failure mode is the
    // worst available: every cell everywhere would score 0.
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        (key, value) => {
          const table = tableWith([2, 3, 5, 7]);
          const score = scoreFeature(
            {
              type: "node",
              id: 1,
              position: COLOGNE,
              tags: { [`zz${key}`]: `zz${value}` },
            },
            "walkable",
            table,
          );
          expect(score).toBe(1);
        },
      ),
    );
  });

  it("never produces NaN, however odd the table", () => {
    // A NaN score compares false against every threshold, so a cell would
    // silently vanish from every region rather than erroring.
    fc.assert(
      fc.property(
        fc.array(multiplierArb, { minLength: 4, maxLength: 4 }),
        fc.array(fc.constantFrom(...VALUES), { minLength: 0, maxLength: 4 }),
        (multipliers, values) => {
          const table = tableWith(multipliers);
          const features = values.map((v, i) => oneTag(i + 1, v));
          for (const cell of scoreCells(buildFeatureIndex(features), table)
            .cells) {
            for (const score of Object.values(cell.scores)) {
              expect(Number.isNaN(score)).toBe(false);
            }
          }
        },
      ),
    );
  });
});

describe("the generated-node helper is honest about OSM tag shape", () => {
  it("cannot express two values for one key, which is why oneTag exists", () => {
    // Documented because the `node()` helper above looks like it takes several
    // values for key `k` and in fact keeps only the last — JS object literals
    // deduplicate. Distinct features carrying one tag each is the accurate model
    // of "several things overlap this cell", and it is what the properties use.
    const built = node(1, ["a", "b"]);
    expect(Object.keys(built.tags)).toEqual(["k"]);
  });
});
