/**
 * Scoring-kernel tests — the oracle tests, and the point of the whole iteration.
 *
 * Why these tests matter:
 * The C# reference's tests pin EXACT expected products: a beach cell at
 * 5 × 7 = 35, the same cell with a historic way at 105, a hard veto at 0. Those
 * numbers are the entire reason the multiplicative model was kept over a bounded
 * [0,1] redesign — they make this port *verifiable* rather than merely
 * plausible. If these pass, the port is faithful; if they drift, something in
 * the chain from CSV to cell is wrong and the rest of the package is scoring
 * confidently against nothing.
 *
 * Everything here uses a hand-built table with known inputs. That is deliberate:
 * an oracle needs exact known inputs, not whatever a real tile happens to
 * contain — which is also why the `beach` fixture (one element, the entire North
 * Sea) is NOT the right place for these.
 *
 * @see affordance-scorer.ts.md
 */

import { describe, it, expect } from "vitest";
import { latLngToCell } from "h3-js";
import {
  scoreFeature,
  scoreCells,
  cellsAboveThreshold,
  debugUrlForKey,
} from "./affordance-scorer.js";
import { parseRuleTable } from "../rules/rule-table.js";
import { buildFeatureIndex } from "../spatial/h3-feature-index.js";
import { AFFORDANCE_RES } from "../spatial/resolutions.js";
import type { OsmFeature } from "../model/osm-feature.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };
const HERE = latLngToCell(COLOGNE.lat, COLOGNE.lng, AFFORDANCE_RES);

/** The C# oracle's own values. */
const TABLE = parseRuleTable(
  [
    "id,Key,Value,walkable,battleArea",
    "surface_sand,surface,sand,5,5",
    "natural_beach,natural,beach,7,8",
    "historic_ruins,historic,ruins,3,3",
    "building_house,building,house,0,0",
    "landuse_grass,landuse,grass,9,10",
  ].join("\n"),
  { source: "test", fetchedAt: 0 },
);

const at = (id: number, tags: Record<string, string>): OsmFeature => ({
  type: "node",
  id,
  position: COLOGNE,
  tags,
});

const scoreAt = (features: OsmFeature[], category: string): number => {
  const result = scoreCells(buildFeatureIndex(features), TABLE);
  const cell = result.cells.find((c) => c.cell === HERE);
  return cell?.scores[category] ?? Number.NaN;
};

describe("THE ORACLE — the C# reference's published values", () => {
  it("a cell covered by surface=sand and natural=beach scores exactly 35 walkable", () => {
    // 5 x 7. The headline number from the reference's own test suite.
    expect(
      scoreAt(
        [at(1, { surface: "sand" }), at(2, { natural: "beach" })],
        "walkable",
      ),
    ).toBe(35);
  });

  it("adding a historic way worth 3 makes it exactly 105", () => {
    expect(
      scoreAt(
        [
          at(1, { surface: "sand" }),
          at(2, { natural: "beach" }),
          at(3, { historic: "ruins" }),
        ],
        "walkable",
      ),
    ).toBe(105);
  });

  it("one feature carrying BOTH tags gives the same 35", () => {
    // The product is over (features x tags), so how the tags are distributed
    // between elements must not change the answer. A mapper drawing one beach
    // polygon with both tags and a mapper drawing two overlapping ones must get
    // the same score.
    expect(
      scoreAt([at(1, { surface: "sand", natural: "beach" })], "walkable"),
    ).toBe(35);
  });

  it("any cell touched by building=house scores exactly 0 for battleArea", () => {
    expect(
      scoreAt(
        [at(1, { landuse: "grass" }), at(2, { building: "house" })],
        "battleArea",
      ),
    ).toBe(0);
  });

  it("a cell with no matching tags scores exactly 1 — the identity", () => {
    expect(scoreAt([at(1, { amenity: "bench" })], "walkable")).toBe(1);
  });

  it("a feature with no tags at all scores 1", () => {
    expect(scoreFeature(at(1, {}), "walkable", TABLE)).toBe(1);
  });
});

describe("zero is absorbing, and the short-circuit is real", () => {
  it("stops looking up rules once a veto is hit", () => {
    // Asserted by COUNTING lookups, because "it returns 0" would pass with no
    // short-circuit at all. The reference's comment is explicit that it "wont
    // recover from 0 so can be stopped", and on a building with 30 tags that is
    // 29 lookups saved per cell per category — in the hot loop.
    const many: Record<string, string> = { building: "house" };
    for (let i = 0; i < 30; i++) many[`filler${i}`] = "x";

    const counters = { lookups: 0 };
    expect(scoreFeature(at(1, many), "battleArea", TABLE, counters)).toBe(0);
    expect(counters.lookups).toBe(1);
  });

  it("does not short-circuit when the veto is not first", () => {
    // Sanity check on the counter itself: tags before the veto are still looked
    // up, so a passing count of 1 above is evidence and not an artefact.
    const counters = { lookups: 0 };
    expect(
      scoreFeature(
        at(1, { surface: "sand", building: "house" }),
        "battleArea",
        TABLE,
        counters,
      ),
    ).toBe(0);
    expect(counters.lookups).toBe(2);
  });

  it("a veto anywhere in the cell wins, whatever else is there", () => {
    expect(
      scoreAt(
        [
          at(1, { landuse: "grass" }),
          at(2, { surface: "sand" }),
          at(3, { building: "house" }),
        ],
        "battleArea",
      ),
    ).toBe(0);
  });
});

describe("scoring cost does not grow with the ground a feature covers", () => {
  /**
   * WHY THIS TEST MATTERS.
   *
   * `scoreFeature(feature, category, table)` reads the feature's tags and the
   * table. It does NOT read the cell. So the factor a feature contributes is
   * the same for every cell it touches, and computing it once per (cell,
   * category, feature) is redundant work that grows with the feature's area.
   *
   * Measured on the `building-block` fixture before this was fixed: ~19,400
   * `scoreFeature` calls, each allocating an `Object.entries(tags)` array,
   * where 227 features × 6 categories = 1,362 give byte-identical results.
   * The C# reference has the same shape and is no better — but only this one
   * runs inside a 16 ms AR frame budget, and the plan's own measurement puts a
   * dense chunk at ~87 % of its 10 ms indexing budget on a DESKTOP.
   *
   * Asserting the count rather than the wall clock is deliberate: this repo has
   * already learned that a timing assertion inside a parallel suite measures
   * the machine, not the code (a "generous" 100 ms ceiling failed at 104 ms in
   * a contended run). A lookup count is machine-independent and says exactly
   * the thing that matters.
   */
  const wayAcross = (id: number, tags: Record<string, string>): OsmFeature => ({
    type: "way",
    id,
    // A line long enough to rasterise into many res-13 cells, so "per cell" and
    // "per feature" are far apart and the assertion can tell them apart.
    geometry: [COLOGNE, { lat: COLOGNE.lat + 0.002, lng: COLOGNE.lng + 0.002 }],
    tags,
  });

  it("looks up each (feature, category) exactly once, however many cells it spans", () => {
    const features = [
      wayAcross(1, { surface: "sand", natural: "beach" }),
      wayAcross(2, { landuse: "grass" }),
    ];
    const index = buildFeatureIndex(features);
    const result = scoreCells(index, TABLE);

    // The feature genuinely covers many cells — otherwise this test proves
    // nothing, so it is asserted rather than assumed.
    expect(index.byCell.size).toBeGreaterThan(20);

    // 2 categories in TABLE. Feature 1 has 2 tags, feature 2 has 1.
    // Per-feature-per-category: (2 + 1) × 2 = 6. Per-cell it would be 6 × the
    // number of cells, i.e. well over a hundred.
    expect(result.lookups).toBe(6);
  });

  it("still short-circuits a veto, so memoising did not cost the early exit", () => {
    // The short-circuit and the memo interact: a cached factor of 0 must not
    // be recomputed, AND computing it must still stop at the vetoing tag.
    const many: Record<string, string> = { building: "house" };
    for (let i = 0; i < 30; i++) many[`filler${i}`] = "x";

    const result = scoreCells(buildFeatureIndex([wayAcross(1, many)]), TABLE);

    // `building=house` vetoes in both categories, and it is the first tag, so
    // one lookup per category and nothing more — not 31, and not 31 per cell.
    expect(result.lookups).toBe(2);
  });

  it("scores identically to a per-cell computation", () => {
    // The memo is only safe if it changes nothing observable. Two features that
    // overlap on some cells and not others is the case where a wrongly-scoped
    // cache would leak a factor into a cell the feature does not touch.
    const near = { lat: COLOGNE.lat + 0.0015, lng: COLOGNE.lng + 0.0015 };
    const result = scoreCells(
      buildFeatureIndex([
        wayAcross(1, { landuse: "grass" }),
        { type: "node", id: 2, position: near, tags: { surface: "sand" } },
      ]),
      TABLE,
    );

    const sandCell = latLngToCell(near.lat, near.lng, AFFORDANCE_RES);
    const sandFactorIn = (cellId: string): number | undefined =>
      result.cells.find((c) => c.cell === cellId)?.contributors["walkable"]?.[
        "node/2"
      ];

    // The node contributes 5 to exactly the one cell it sits in...
    expect(sandFactorIn(sandCell)).toBe(5);
    // ...and to none of the way's other cells. Asserted as a set so a leak
    // anywhere along the way shows up as a value in the diff.
    const elsewhere = result.cells
      .filter((c) => c.cell !== sandCell)
      .map((c) => c.contributors["walkable"]?.["node/2"]);
    expect(new Set(elsewhere)).toEqual(new Set([undefined]));
  });
});

describe("provenance", () => {
  const result = scoreCells(
    buildFeatureIndex([
      at(1, { surface: "sand" }),
      at(2, { natural: "beach" }),
    ]),
    TABLE,
  );
  const cell = result.cells.find((c) => c.cell === HERE)!;

  it("records each feature's own factor", () => {
    expect(cell.contributors["walkable"]!["node/1"]).toBe(5);
    expect(cell.contributors["walkable"]!["node/2"]).toBe(7);
  });

  it("factors multiply back to the total", () => {
    // The invariant that makes the provenance map trustworthy: if it does not
    // reconstruct the score, it is decoration.
    const product = Object.values(cell.contributors["walkable"]!).reduce(
      (a, b) => a * b,
      1,
    );
    expect(product).toBe(cell.scores["walkable"]);
  });

  it("records a feature that contributed the IDENTITY too", () => {
    // "This feature touched the cell and said nothing" is different information
    // from "this feature was not here", and the difference is exactly what makes
    // a surprising score diagnosable.
    const withNeutral = scoreCells(
      buildFeatureIndex([
        at(1, { surface: "sand" }),
        at(2, { amenity: "bench" }),
      ]),
      TABLE,
    );
    const c = withNeutral.cells.find((x) => x.cell === HERE)!;
    expect(c.contributors["walkable"]!["node/2"]).toBe(1);
  });

  it("is a plain Record, not a Map — it has to survive JSON", () => {
    // Scored chunks are cached through the string-valued blob store. A Map
    // JSON-serialises to {} silently, which reads as "this score has no
    // explanation" rather than as a bug.
    const revived = JSON.parse(JSON.stringify(cell)) as typeof cell;
    expect(revived.contributors["walkable"]!["node/1"]).toBe(5);
  });

  it("debugUrlForKey points at the real element", () => {
    // Takes the composed `type/id` key, which is the form a caller reading
    // `contributors` actually has. The model's getOsmDebugUrl(type, id) takes
    // the pieces; needing to split the key first would mean nobody clicks.
    expect(debugUrlForKey("node/1")).toBe(
      "https://www.openstreetmap.org/node/1",
    );
  });
});

describe("category independence", () => {
  it("scores every category the table declares", () => {
    const result = scoreCells(
      buildFeatureIndex([at(1, { surface: "sand" })]),
      TABLE,
    );
    const cell = result.cells.find((c) => c.cell === HERE)!;
    expect(Object.keys(cell.scores).sort()).toEqual(["battleArea", "walkable"]);
  });

  it("a veto in one category does not affect another", () => {
    // Categories are independent columns; a `building=house` that vetoes
    // battleArea must not veto walkable unless the table says so.
    const table = parseRuleTable(
      [
        "id,Key,Value,walkable,battleArea",
        "building_house,building,house,2,0",
      ].join("\n"),
      { source: "test", fetchedAt: 0 },
    );
    const result = scoreCells(
      buildFeatureIndex([at(1, { building: "house" })]),
      table,
    );
    const cell = result.cells.find((c) => c.cell === HERE)!;
    expect(cell.scores["battleArea"]).toBe(0);
    expect(cell.scores["walkable"]).toBe(2);
  });

  it("can be restricted to a subset of categories", () => {
    const result = scoreCells(
      buildFeatureIndex([at(1, { surface: "sand" })]),
      TABLE,
      { categories: ["walkable"] },
    );
    expect(Object.keys(result.cells[0]!.scores)).toEqual(["walkable"]);
  });
});

describe("unmapped-tag diagnostics", () => {
  it("counts tags the table does not score", () => {
    const result = scoreCells(
      buildFeatureIndex([at(1, { tactile_paving: "yes" })]),
      TABLE,
      { collectUnmapped: true },
    );
    expect(result.unmappedTagCounts["tactile_paving"]).toBe(1);
  });

  it("filters out the known noise", () => {
    const result = scoreCells(
      buildFeatureIndex([at(1, { "addr:city": "Köln", name: "X" })]),
      TABLE,
      { collectUnmapped: true },
    );
    expect(result.unmappedTagCounts).toEqual({});
  });

  it("counts per FEATURE, not per (feature, cell)", () => {
    // A building covering 200 cells would otherwise report its one unmapped tag
    // two hundred times and drown the signal this exists to provide.
    const wide: OsmFeature = {
      type: "way",
      id: 1,
      geometry: [
        { lat: COLOGNE.lat, lng: COLOGNE.lng },
        { lat: COLOGNE.lat, lng: COLOGNE.lng + 0.002 },
      ],
      tags: { tactile_paving: "yes" },
    };
    const index = buildFeatureIndex([wide]);
    expect(index.byCell.size).toBeGreaterThan(10);

    const result = scoreCells(index, TABLE, { collectUnmapped: true });
    expect(result.unmappedTagCounts["tactile_paving"]).toBe(1);
  });

  it("is off by default — it costs work in the hot loop", () => {
    const result = scoreCells(
      buildFeatureIndex([at(1, { tactile_paving: "yes" })]),
      TABLE,
    );
    expect(result.unmappedTagCounts).toEqual({});
  });
});

describe("thresholding", () => {
  it("selects strictly-above cells", () => {
    const result = scoreCells(
      buildFeatureIndex([at(1, { surface: "sand" })]),
      TABLE,
    );
    expect(cellsAboveThreshold(result, "walkable", 1)).toContain(HERE);
    expect(cellsAboveThreshold(result, "walkable", 5)).not.toContain(HERE);
  });

  it("excludes a cell scoring exactly the identity", () => {
    // "At least one rule said something positive here" is the bar. A cell that
    // merely scores 1 is unmapped ground, not a region.
    const result = scoreCells(
      buildFeatureIndex([at(1, { amenity: "bench" })]),
      TABLE,
    );
    expect(cellsAboveThreshold(result, "walkable", 1)).toEqual([]);
  });
});

describe("the known flaw, asserted so it stays known", () => {
  it("is UNBOUNDED — five mapped features outscore one identical surface", () => {
    // Carried over deliberately (plan §2). This is a data-COMPLETENESS artefact,
    // not a real signal: the same physical ground scores higher where more
    // mappers have been. Consumers must threshold per category and must never
    // compare across categories. Asserted here so the flaw is visible in the
    // test suite rather than only in a document.
    const sparse = scoreAt([at(1, { surface: "sand" })], "walkable");
    const dense = scoreAt(
      [
        at(1, { surface: "sand" }),
        at(2, { natural: "beach" }),
        at(3, { historic: "ruins" }),
        at(4, { landuse: "grass" }),
      ],
      "walkable",
    );

    expect(sparse).toBe(5);
    expect(dense).toBe(5 * 7 * 3 * 9);
    expect(dense).toBeGreaterThan(sparse * 100);
  });
});

describe("empty and degenerate input", () => {
  it("returns no cells for an empty index", () => {
    const result = scoreCells(buildFeatureIndex([]), TABLE);
    expect(result.cells).toEqual([]);
  });

  it("scores a table with no matching rules as all-identity", () => {
    const result = scoreCells(
      buildFeatureIndex([at(1, { unknown: "thing" })]),
      TABLE,
    );
    expect(result.cells[0]!.scores["walkable"]).toBe(1);
  });
});
