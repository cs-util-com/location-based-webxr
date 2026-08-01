import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { buildBuildings } from "./buildings.js";
import { enuFrameAt } from "./enu.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import type { OsmFeature } from "../model/osm-feature.js";
import { loadSite } from "../test-utils/load-fixtures.js";
import { CORPUS_SITES } from "../places/sites.js";

/**
 * The build does not depend on the order its features arrived in (N3, W4).
 *
 * WHY THIS TEST MATTERS, and it is a different claim from `nested-outlines.
 * test.ts`. That file asserts WHICH outline wins. This one asserts that the
 * answer is a property of the DATA rather than of its serialisation — and until
 * W3 it was not. `assignPartsToOutlines` used `outlines.find(...)`, so with two
 * nested outlines the winner was decided by whichever Overpass happened to emit
 * first. Cologne rendered wrongly every time only because the cathedral's id
 * sorts below the tower's; the same tile from a different server, or after an
 * upstream reordering, could have rendered correctly and made the defect
 * unreproducible.
 *
 * A smallest-AREA rule is order-independent only while no two containing
 * outlines have EQUAL area. The tie-break on feature key is what closes that,
 * and this is the test that keeps someone from removing it as redundant.
 *
 * Shuffling REAL data rather than generated data is deliberate: the property is
 * about nesting, and a generator that produced genuinely nested multi-ring OSM
 * buildings would be a larger and less trustworthy artefact than the fixture
 * this project already captured for exactly this purpose.
 */

const CATHEDRAL = CORPUS_SITES.find((site) => site.id === "cologne-cathedral");

if (CATHEDRAL === undefined) {
  throw new Error("cologne-cathedral is missing from CORPUS_SITES");
}
const site = CATHEDRAL;

const FEATURES: readonly OsmFeature[] = parseOverpassJson(
  loadSite(site.id).payload,
).features;

/**
 * A comparable, order-insensitive summary of one build.
 *
 * Keyed on feature and parent, with the vertex count and height, because those
 * are what the assignment decides. Comparing the raw arrays would also compare
 * the ORDER volumes come out in, which is not what this test is about — the
 * renderer merges them into one buffer per chunk and never reads that order.
 */
function summarise(features: readonly OsmFeature[]): string[] {
  return buildBuildings(features, { frame: enuFrameAt(site.position) })
    .map(
      (volume) =>
        `${volume.feature}|${volume.parentFeature ?? "-"}|${volume.mesh.positions.length}|${volume.heights.totalHeightM}`,
    )
    .sort();
}

const BASELINE = summarise(FEATURES);

describe("buildBuildings is order-independent", () => {
  it("produces the same volumes however the payload was serialised", () => {
    fc.assert(
      fc.property(
        // `shuffledSubarray` over the whole array is a permutation generator.
        fc.shuffledSubarray([...FEATURES], {
          minLength: FEATURES.length,
          maxLength: FEATURES.length,
        }),
        (shuffled) => {
          expect(summarise(shuffled)).toEqual(BASELINE);
        },
      ),
      // Ten permutations of a 1281-element fixture, each a full build. Enough to
      // catch an order dependency — the failure mode is systematic, not rare —
      // and few enough to stay inside the regression suite's budget.
      { numRuns: 10 },
    );
  });

  it("puts the cathedral's tower on the same side of the rule every time", () => {
    // The specific instance, asserted directly as well as by the property: a
    // property that regressed to comparing two empty builds would still pass
    // above. This cannot.
    for (const shuffled of [[...FEATURES].reverse(), [...FEATURES]]) {
      const volumes = buildBuildings(shuffled, {
        frame: enuFrameAt(site.position),
      });
      const towerAsOutline = volumes.filter(
        (volume) =>
          volume.feature === "way/645732604" &&
          volume.parentFeature === undefined,
      );
      expect(towerAsOutline).toEqual([]);
    }
  });

  it("is not vacuous — the fixture really does build volumes", () => {
    // Every assertion above compares two builds, so both being empty would be a
    // green suite describing nothing at all.
    expect(BASELINE.length).toBeGreaterThan(50);
  });
});
