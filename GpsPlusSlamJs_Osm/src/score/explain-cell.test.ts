/**
 * `explainCell` — the per-tag breakdown behind one cell's score.
 *
 * Why these tests matter:
 * The provenance map answers "which ELEMENT made this cell 9?"; the question
 * the owner actually asked is "which TAG made this cell 0?" — and that answer
 * is thrown away by the scorer, twice over: `CellScore.contributors` keeps one
 * number per feature, and `scoreFeature` `return`s on the first `0`, so the
 * tags after a veto are never even looked up. This function recomputes both.
 *
 * The load-bearing test is the AGREEMENT one: `explainCell`'s arithmetic must
 * equal the scorer's, feature by feature and cell by cell. A debugging UI that
 * quietly disagrees with the thing it is explaining is worse than not having
 * one — it sends the reader to look for a bug in the wrong place.
 *
 * @see explain-cell.ts.md
 */

import { describe, it, expect } from "vitest";
import { explainCell } from "./explain-cell.js";
import { scoreFeature } from "./affordance-scorer.js";
import { parseRuleTable } from "../rules/rule-table.js";
import type { OsmFeature } from "../model/osm-feature.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };
const CELL = "8d1fb46622d8dbf";

/**
 * The cemetery-next-to-the-cathedral case, which is the case that prompted this
 * function: a patch that is genuinely a park AND genuinely a meadow AND has a
 * bench, and is nevertheless `0` because `landuse=cemetery` vetoes it.
 */
const TABLE = parseRuleTable(
  [
    "id,Key,Value,walkable,restingArea",
    "leisure_park,leisure,park,3,4",
    "landuse_meadow,landuse,meadow,2,2",
    "amenity_bench,amenity,bench,1,6",
    "landuse_cemetery,landuse,cemetery,0,0",
    "__threshold__,,,1,2",
  ].join("\n"),
  { source: "test", fetchedAt: 0 },
);

const node = (id: number, tags: Record<string, string>): OsmFeature => ({
  type: "node",
  id,
  position: COLOGNE,
  tags,
});

describe("explainCell — the shape of the answer", () => {
  it("names the cell, the category and the table's threshold", () => {
    const explanation = explainCell(CELL, [], TABLE, "restingArea");
    expect(explanation.cell).toBe(CELL);
    expect(explanation.category).toBe("restingArea");
    expect(explanation.threshold).toBe(2);
  });

  it("a cell with no features scores the identity, not zero", () => {
    // "Nothing said anything here" and "this scored badly" are different claims.
    const explanation = explainCell(CELL, [], TABLE, "walkable");
    expect(explanation.score).toBe(1);
    expect(explanation.features).toEqual([]);
  });

  it("links each feature to its OSM browse page (DEC-8), not the editor", () => {
    const explanation = explainCell(
      CELL,
      [{ type: "way", id: 12345, geometry: [COLOGNE], tags: {} }],
      TABLE,
      "walkable",
    );
    expect(explanation.features[0]?.feature).toBe("way/12345");
    expect(explanation.features[0]?.osmUrl).toBe(
      "https://www.openstreetmap.org/way/12345",
    );
  });

  it("multiplies feature factors into the cell score", () => {
    const explanation = explainCell(
      CELL,
      [node(1, { leisure: "park" }), node(2, { landuse: "meadow" })],
      TABLE,
      "walkable",
    );
    expect(explanation.score).toBe(6); // 3 x 2
  });
});

describe("explainCell — per-tag contributions", () => {
  it("reports every tag's own factor, in the order the scorer reads them", () => {
    const explanation = explainCell(
      CELL,
      [node(1, { leisure: "park", landuse: "meadow" })],
      TABLE,
      "walkable",
    );
    const tags = explanation.features[0]?.tags ?? [];
    expect(tags.map((t) => [t.key, t.value, t.factor])).toEqual([
      ["leisure", "park", 3],
      ["landuse", "meadow", 2],
    ]);
    expect(explanation.features[0]?.factor).toBe(6);
  });

  it("distinguishes 'no rule for this tag' from 'a rule that scores 1'", () => {
    // Both contribute nothing to the product, and conflating them is how a
    // reader concludes the table covers a tag it has never heard of.
    const explanation = explainCell(
      CELL,
      [node(1, { amenity: "bench", wheelchair: "yes" })],
      TABLE,
      "walkable",
    );
    const tags = explanation.features[0]?.tags ?? [];
    expect(tags[0]).toMatchObject({ ruleKey: "amenity_bench", factor: 1 });
    expect(tags[1]).toMatchObject({
      ruleKey: "wheelchair_yes",
      factor: undefined,
    });
  });

  it("flags tags the table deliberately ignores", () => {
    const explanation = explainCell(
      CELL,
      [node(1, { name: "Melaten", "addr:city": "Köln", leisure: "park" })],
      TABLE,
      "walkable",
    );
    const tags = explanation.features[0]?.tags ?? [];
    expect(tags.map((t) => t.ignored)).toEqual([true, true, false]);
  });
});

describe("explainCell — the veto, which is the whole point", () => {
  it("shows the vetoing tag AND the tags the short-circuit never evaluated", () => {
    // The cemetery answer: "it is a park and a meadow and there is a bench, and
    // none of it matters because landuse=cemetery is 0." `scoreFeature` returns
    // at the cemetery tag, so amenity/bench is never looked up — saying so is
    // more honest than silently omitting it or implying it was weighed.
    const explanation = explainCell(
      CELL,
      [
        node(1, {
          leisure: "park",
          landuse: "cemetery",
          amenity: "bench",
        }),
      ],
      TABLE,
      "restingArea",
    );

    const tags = explanation.features[0]?.tags ?? [];
    expect(tags.map((t) => [t.ruleKey, t.factor, t.skippedByVeto])).toEqual([
      ["leisure_park", 4, false],
      ["landuse_cemetery", 0, false],
      ["amenity_bench", 6, true],
    ]);
    expect(explanation.features[0]?.factor).toBe(0);
    expect(explanation.score).toBe(0);
  });

  it("a veto in one feature zeroes the cell even when another feature scores well", () => {
    const explanation = explainCell(
      CELL,
      [node(1, { leisure: "park" }), node(2, { landuse: "cemetery" })],
      TABLE,
      "walkable",
    );
    expect(explanation.score).toBe(0);
    expect(explanation.features.map((f) => f.factor)).toEqual([3, 0]);
  });

  it("marks nothing as skipped when there is no veto", () => {
    const explanation = explainCell(
      CELL,
      [node(1, { leisure: "park", amenity: "bench" })],
      TABLE,
      "walkable",
    );
    expect(
      (explanation.features[0]?.tags ?? []).every((t) => !t.skippedByVeto),
    ).toBe(true);
  });
});

describe("explainCell — agreement with the scorer", () => {
  it("every feature's factor equals scoreFeature, for every category", () => {
    // The invariant that makes the UI trustworthy. If these ever disagree, the
    // panel is lying about the number it is standing next to.
    const features = [
      node(1, { leisure: "park", landuse: "meadow" }),
      node(2, { landuse: "cemetery", amenity: "bench" }),
      node(3, { wheelchair: "yes" }),
      node(4, {}),
    ];

    for (const category of TABLE.categories) {
      const explanation = explainCell(CELL, features, TABLE, category);
      for (const [i, explained] of explanation.features.entries()) {
        const feature = features[i];
        expect(feature).toBeDefined();
        if (feature === undefined) continue;
        expect(explained.factor).toBe(scoreFeature(feature, category, TABLE));
      }
      const product = features.reduce(
        (acc, f) => acc * scoreFeature(f, category, TABLE),
        1,
      );
      expect(explanation.score).toBe(product);
    }
  });
});
