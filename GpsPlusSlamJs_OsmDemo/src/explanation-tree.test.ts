/**
 * The details panel's view model — the cemetery question, answered.
 *
 * Why these tests matter:
 * The whole of D6 is one sentence from the owner: "I want to see that it was a
 * meadow and a park and maybe even had a bench, but that the cemetery reset it
 * to zero regardless of how high the other ratings were." That answer needs
 * three things the popup cannot give — every feature, every tag under it, and
 * the tags the veto short-circuit never even looked up. Each is asserted here.
 *
 * The ordering is the same trap as the popup's: if the vetoing FEATURE does not
 * lead, the reader opens the wrong row first.
 *
 * @see explanation-tree.ts.md
 */

import { describe, it, expect } from "vitest";
import { explainCell, parseRuleTable } from "gps-plus-slam-osm";
import type { OsmFeature } from "gps-plus-slam-osm";

import { explanationTree } from "./explanation-tree.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };
const CELL = "8d1fb46622d8dbf";

const TABLE = parseRuleTable(
  [
    "id,Key,Value,restingArea",
    "leisure_park,leisure,park,4",
    "landuse_meadow,landuse,meadow,2",
    "amenity_bench,amenity,bench,6",
    "landuse_cemetery,landuse,cemetery,0",
  ].join("\n"),
  { source: "test", fetchedAt: 0 },
);

const node = (id: number, tags: Record<string, string>): OsmFeature => ({
  type: "node",
  id,
  position: COLOGNE,
  tags,
});

const treeFor = (features: OsmFeature[]) =>
  explanationTree(explainCell(CELL, features, TABLE, "restingArea"));

describe("explanationTree — the cemetery answer", () => {
  it("shows the outvoted tags AND names the one that vetoed them", () => {
    const tree = treeFor([
      node(1, { leisure: "park", landuse: "meadow" }),
      node(2, { landuse: "cemetery", amenity: "bench" }),
    ]);

    // The veto leads: opening the first row is opening the explanation.
    expect(tree.features[0]?.key).toBe("node/2");
    expect(tree.features[0]?.state).toBe("veto");

    const vetoTags = tree.features[0]?.tags ?? [];
    expect(vetoTags[0]).toMatchObject({
      ruleKey: "landuse_cemetery",
      state: "veto",
    });
    // "These four tags were never evaluated because the cemetery already
    // vetoed it" is the honest half of the answer, and the half the scorer
    // discards.
    expect(vetoTags[1]).toMatchObject({
      ruleKey: "amenity_bench",
      state: "skipped",
    });

    // The outvoted positives are still shown, under their own feature.
    const positives = tree.features[1]?.tags.map((t) => t.ruleKey) ?? [];
    expect(positives).toEqual(["leisure_park", "landuse_meadow"]);
  });

  it("says the cell is zero, and that zero is below the bar", () => {
    const tree = treeFor([node(1, { landuse: "cemetery" })]);
    expect(tree.scoreLabel).toBe("0");
    expect(tree.aboveThreshold).toBe(false);
  });

  it("shows the running product, so 48 is traceable to the numbers that made it", () => {
    // 4 x 2 x 6 = 48. Without the accumulation the reader has to multiply the
    // column in their head to check the total, which is the whole task.
    const tree = treeFor([
      node(1, { leisure: "park", landuse: "meadow", amenity: "bench" }),
    ]);
    expect(tree.scoreLabel).toBe("48");
    expect((tree.features[0]?.tags ?? []).map((t) => t.runningLabel)).toEqual([
      "4",
      "8",
      "48",
    ]);
  });
});

describe("explanationTree — ordering and labelling", () => {
  it("orders features by how much they moved the score, veto first", () => {
    const tree = treeFor([
      node(1, { amenity: "bench" }), // 6
      node(2, { landuse: "meadow" }), // 2
      node(3, { landuse: "cemetery" }), // 0
    ]);
    expect(tree.features.map((f) => f.key)).toEqual([
      "node/3",
      "node/1",
      "node/2",
    ]);
  });

  it("marks a feature that touched the cell and said nothing", () => {
    const tree = treeFor([node(1, { wheelchair: "yes" })]);
    expect(tree.features[0]?.state).toBe("silent");
    expect(tree.features[0]?.tags[0]?.state).toBe("no-rule");
    expect(tree.features[0]?.tags[0]?.factorLabel).toBe("—");
  });

  it("marks a tag the table deliberately ignores, distinctly from an unknown one", () => {
    // "The table has never heard of this" and "the table decided this can never
    // matter" are different statements about the RULE TABLE's coverage, and the
    // second is not a gap worth filing.
    const tree = treeFor([node(1, { name: "Melaten", wheelchair: "yes" })]);
    const states = tree.features[0]?.tags.map((t) => t.state);
    expect(states).toEqual(["ignored", "no-rule"]);
  });

  it("links each feature to its OSM browse page", () => {
    const tree = treeFor([node(12345, { leisure: "park" })]);
    expect(tree.features[0]?.osmUrl).toBe(
      "https://www.openstreetmap.org/node/12345",
    );
  });

  it("rounds display numbers without touching the arithmetic", () => {
    const tree = treeFor([
      node(1, { leisure: "park" }),
      node(2, { landuse: "meadow" }),
    ]);
    expect(tree.scoreLabel).toBe("8");
    expect(tree.features[0]?.factorLabel).toBe("4");
  });

  it("describes an empty cell as the identity rather than as zero", () => {
    const tree = treeFor([]);
    expect(tree.features).toEqual([]);
    expect(tree.scoreLabel).toBe("1");
    expect(tree.summary).toMatch(/nothing|identity/i);
  });
});
