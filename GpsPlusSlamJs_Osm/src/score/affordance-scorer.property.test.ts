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

// Includes 0.8 and 0.1: the LIVE sheet has decimal multipliers (landuse_farmland
// scores battleArea 0.8), and binary-inexact factors are the only ones for which
// multiplication order is observable at all. A set of exact binary values would
// make the order property below pass for the wrong reason.
const multiplierArb = fc.constantFrom(0, 0.1, 0.5, 0.8, 1, 2, 3, 5, 7);

/**
 * A table keyed on a DISTINCT OSM key per value: `ka=a`, `kb=b`, …
 *
 * `tableWith` above declares ONE key `k` with four values, which is right for
 * properties that vary the FEATURE. It is wrong for a property about the order
 * of one feature's OWN tags, because a feature cannot carry `k` twice — and the
 * tag-order property below silently built `ka=a`, `kb=b` against it. Those keys
 * matched nothing in the table, so every tag scored the multiplicative
 * identity and the assertion was `1 === 1` for every generated case: a property
 * test that could not fail.
 */
function tableWithDistinctKeys(values: readonly number[]): RuleTable {
  const rows = VALUES.map((v, i) => `k${v}_${v},k${v},${v},${values[i] ?? 1}`);
  return parseRuleTable(["id,Key,Value,walkable", ...rows].join("\n"), {
    source: "prop",
    fetchedAt: 0,
  });
}

const tagsArb = fc.uniqueArray(fc.constantFrom(...VALUES), { maxLength: 4 });

/**
 * Asserts two scores are the same product, to within floating-point noise.
 *
 * WHY NOT `toBe`. Floating-point multiplication is commutative but **not
 * associative**, so `(0.1 × 0.5) × 0.8` and `0.1 × (0.5 × 0.8)` can differ in
 * the last bit. Order independence therefore holds for the VALUE and not for
 * the bits, and asserting exact equality would be asserting something the IEEE
 * spec does not promise. Measured over every permutation of eight realistic
 * factors: 4 distinct doubles, spread 3.5e-15 absolute — **1–2 ULP**.
 *
 * The alternative was to canonicalise: sort tags by rule key and cell entries
 * by feature key before multiplying, making the bits reproducible. Rejected on
 * the numbers. A threshold comparison (`score > threshold`) only flips if the
 * score lands within 1 ULP of the threshold, which is an exact tie — and exact
 * ties come from binary-exact factors like 0.5 × 2, which have no ordering
 * problem in the first place. Paying a sort per (feature, category) in the hot
 * path, which was just made ~14× cheaper by hoisting it, to buy bit-identity no
 * consumer reads, is the wrong trade.
 *
 * **What consumers must therefore not do:** compare two scores for exact
 * equality across differently-ordered inputs. Documented in the sidecar.
 */
function expectSameScore(a: number | undefined, b: number | undefined): void {
  if (a === undefined || b === undefined) {
    expect(a).toBe(b);
    return;
  }
  if (a === b) return;
  // Relative, because scores are unbounded products; 1e-12 is many orders of
  // magnitude above the 3.5e-16 measured and far below anything meaningful.
  expect(Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b))).toBeLessThan(
    1e-12,
  );
}

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

          expectSameScore(forward, backward);
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
          // NOT `tableWith`: that declares one key `k`, so these `ka`/`kb` tags
          // would match nothing and every score would be the identity — see
          // `tableWithDistinctKeys`.
          const table = tableWithDistinctKeys(multipliers);
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
          expectSameScore(a, b);
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
          // Same reason as expectSameScore: the provenance factors are
          // multiplied here in map-iteration order, which need not be the
          // order the kernel used.
          expectSameScore(product, cell.scores["walkable"]);
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
