import { describe, expect, it } from "vitest";

import { loadSite } from "../../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../../model/overpass-parser.js";
import { enuFrameAt } from "../../mesh/enu.js";
import { buildCity } from "../../mesh/city.js";
import { buildObstacleIndex } from "../../nav/obstacles.js";
import { buildFeatureIndex } from "../../spatial/h3-feature-index.js";
import { scoreCells } from "../../score/affordance-scorer.js";
import { parseRuleTable } from "../../rules/rule-table.js";
import { DEFAULT_RULE_TABLE_CSV } from "../../rules/default-rules.js";

/**
 * WHY THESE TESTS MATTER. Hinterzarten is the one captured scene with real
 * woods (O1 quiet greens, the owner's choice), and two of its forest
 * relations (112835, 67504) reach far outside the capture, so it is where
 * the build window has to hold: invented trees inside the fetched box and
 * nowhere else. The count is pinned because it is the number the chosen
 * picture showed (O1 measured 1,037 to 1,163 at 0.02 per m2); a change to
 * the grid, the exclusions or the window moves it. And because the trees
 * are invented, navigation and scoring must not see them: both are built
 * from features, and the test pins them identical with the switch on and off.
 */
const site = loadSite("woodland-hinterzarten");
const features = parseOverpassJson(site.payload).features;
const frame = enuFrameAt(site.centre);
const window = site.bbox;

describe("Hinterzarten cosmetic trees", () => {
  const city = buildCity(features, { frame }, { window });

  it("invents the number of trees O1 drew, pinned", () => {
    expect(city.cosmeticTrees.length).toBeGreaterThanOrEqual(1040);
    expect(city.cosmeticTrees.length).toBeLessThanOrEqual(1160);
    const bySource = new Map<string, number>();
    for (const t of city.cosmeticTrees) {
      bySource.set(t.source, (bySource.get(t.source) ?? 0) + 1);
    }
    expect({
      total: city.cosmeticTrees.length,
      ...Object.fromEntries(bySource),
    }).toEqual(PINNED);
  });

  it("places the relations' trees inside the window and nowhere else", () => {
    for (const id of ["relation/112835", "relation/67504"]) {
      const own = city.cosmeticTrees.filter((t) => t.feature === id);
      expect(own.length).toBeGreaterThan(0);
    }
    for (const t of city.cosmeticTrees) {
      const p = frame.toLatLng(t.position);
      expect(p.lat).toBeGreaterThanOrEqual(window.south - 1e-12);
      expect(p.lat).toBeLessThanOrEqual(window.north + 1e-12);
      expect(p.lng).toBeGreaterThanOrEqual(window.west - 1e-12);
      expect(p.lng).toBeLessThanOrEqual(window.east + 1e-12);
    }
  });

  it("leaves the mapped trees as they are", () => {
    const off = buildCity(
      features,
      { frame },
      { window, cosmeticTrees: false },
    );
    expect(off.cosmeticTrees).toEqual([]);
    expect(city.trees).toEqual(off.trees);
    expect(city.trees.length).toBe(126);
  });

  it("leaves the obstacle index and the cell scores byte-identical", () => {
    const snapshot = () => {
      const obstacles = buildObstacleIndex(features);
      const cells = [...obstacles.cells].sort();
      const scores = scoreCells(
        buildFeatureIndex(features, { restrictTo: cells.slice(0, 2000) }),
        parseRuleTable(DEFAULT_RULE_TABLE_CSV, {
          source: "default",
          fetchedAt: 0,
        }),
      );
      return JSON.stringify({
        obstacles: cells.map((c) => [c, obstacles.obstaclesIn(c)]),
        scores: scores.cells,
      });
    };
    const before = snapshot();
    buildCity(features, { frame }, { window, cosmeticTrees: false });
    const off = snapshot();
    buildCity(features, { frame }, { window });
    const on = snapshot();
    expect(on).toBe(off);
    expect(off).toBe(before);
    expect(JSON.parse(on).scores.length).toBeGreaterThan(0);
  });
});

/** Measured on the port, 2026-11-08: woods 772, the orchard 282, the two rows 26. */
const PINNED = { total: 1080, wood: 772, orchard: 282, tree_row: 26 };
