import { describe, expect, it } from "vitest";

import { CORPUS_SITES } from "../../places/sites.js";
import { loadSite } from "../../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../../model/overpass-parser.js";
import { enuFrameAt } from "../../mesh/enu.js";
import { buildTrees } from "../../mesh/trees.js";

/**
 * WHY THIS TEST MATTERS. The tree classes are about real tagging, and the O1
 * quiet-greens lab the owner chose counted Heidelberg's trees from this same
 * extract: 54 trees, 53 drawn broad and 1 neutral (its `leaf_type` is outside
 * the vocabulary). Unit tests over invented tags prove the table; only the
 * corpus proves the library now reads the map the way the chosen picture did.
 * A count, not a pixel: it survives a palette change.
 */
describe("Heidelberg trees, as the O1 lab drew them", () => {
  const site = CORPUS_SITES.find((s) => s.id === "heidelberg-altstadt");
  if (site === undefined) throw new Error("heidelberg-altstadt not in corpus");
  const features = parseOverpassJson(loadSite(site.id).payload).features;
  const trees = buildTrees(features, { frame: enuFrameAt(site.position) });

  it("has 54 trees, 53 broadleaved and 1 in the neutral form", () => {
    expect(trees).toHaveLength(54);
    const byVariant = new Map<string, number>();
    for (const t of trees) {
      byVariant.set(t.variant, (byVariant.get(t.variant) ?? 0) + 1);
    }
    expect(Object.fromEntries(byVariant)).toEqual({
      broadleaved: 53,
      unknown: 1,
    });
  });
});
