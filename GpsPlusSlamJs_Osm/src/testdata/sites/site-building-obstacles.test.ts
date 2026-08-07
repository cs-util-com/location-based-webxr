import { describe, expect, it } from "vitest";

import { CORPUS_SITES } from "../../places/sites.js";
import { loadSite } from "../../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../../model/overpass-parser.js";
import { enuFrameAt } from "../../mesh/enu.js";
import { buildBuildings } from "../../mesh/buildings.js";
import { solidBuildingFootprints } from "../../mesh/buildings.js";
import { isBuilding } from "../../mesh/building-heights.js";
import { featureKey } from "../../model/osm-feature.js";
import type { OsmFeature } from "../../model/osm-feature.js";

/**
 * WHY THESE TESTS MATTER — they are the record of a decision that the data
 * overturned.
 *
 * DEC-R11-9 chose "`building:part` volumes where they exist, else the outline
 * **below a footprint-area cap**", to stop a castle-sized outline sealing its
 * own courtyard, and it deliberately left the cap's value to be **measured
 * against this corpus rather than guessed**. The measurement says there is no
 * cap to find, and both halves of that are pinned below so a corpus refresh
 * re-opens the question instead of quietly inheriting the answer:
 *
 * 1. **The hazard is not in the corpus.** Heidelberg's defensive castle carries
 *    no `building` tag at all, so it never becomes a volume under any rule. The
 *    way the design cites as the trap — `historic=castle` also tagged
 *    `building=university` — is a few hundred square metres: an ordinary
 *    building, not an enclosure.
 * 2. **A cap would break real buildings.** The outlines that survive the parts
 *    rule at the top of the size range are a train station, a city-block office
 *    and a department store, all in the 7 000–17 000 m² range. Any cap low
 *    enough to catch a bailey makes all of them walk-through, which is a louder
 *    bug than the one it prevents.
 *
 * @see ../../mesh/buildings.ts.md
 */

/** Absolute shoelace area of a ring, square metres in the site's ENU frame. */
function areaOf(ring: readonly { x: number; y: number }[]): number {
  if (ring.length < 3) return 0;
  let twice = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

function featuresOf(id: string): OsmFeature[] {
  return [...parseOverpassJson(loadSite(id).payload).features];
}

const cases = CORPUS_SITES.map((site) => [site.id, site] as const);

describe("building obstacles across the corpus", () => {
  it.each(cases)(
    "%s selects the same volumes the extruder draws",
    (id, site) => {
      // THE INVARIANT THE WHOLE SPLIT RESTS ON. `buildBuildings` extrudes in ENU
      // and `solidBuildingFootprints` selects in lat/lng; they share
      // `assignPartsToOutlines`, so they must agree on WHICH features are solid.
      // If they can disagree, an agent walks through a drawn building or detours
      // around an undrawn one.
      const features = featuresOf(id);
      const drawn = new Set(
        buildBuildings(features, { frame: enuFrameAt(site.position) })
          // Tall structures are drawn but are not `building=*`, and the obstacle
          // rule is about buildings — so compare on the building population only.
          .filter((v) => {
            const f = features.find((g) => featureKey(g) === v.feature);
            return (
              f !== undefined && (isBuilding(f) || f.tags["building:part"])
            );
          })
          .map((v) => v.feature),
      );
      const solid = new Set(
        solidBuildingFootprints(features).map((s) => featureKey(s.feature)),
      );

      // Every solid footprint is drawn. The converse can differ by the
      // `min_height` skip, which is deliberate and asserted separately.
      for (const key of solid) expect(drawn.has(key)).toBe(true);
      expect(solid.size).toBeGreaterThan(0);
    },
  );

  it("skips volumes that start above the ground, so a gateway stays open", () => {
    // `min_height > 0` is the S3DB form for an arch or a canopy. The corpus has
    // them, so this is a live path rather than a defensive formality.
    const features = featuresOf("cologne-cathedral");
    const solid = new Set(
      solidBuildingFootprints(features).map((s) => featureKey(s.feature)),
    );
    const floating = features.filter(
      (f) => Number(f.tags["min_height"] ?? "0") > 0,
    );

    expect(floating.length).toBeGreaterThan(0);
    for (const f of floating) {
      expect(solid.has(featureKey(f))).toBe(false);
    }
  });

  it("finds no castle enclosure to cap — the defensive one is not a building", () => {
    // FACT 1 THAT KILLED THE CAP. The design names Heidelberg's castle as the
    // trap; the extract says the defensive castle way carries no `building` tag,
    // so it never becomes a volume, and the one that does carry
    // `building=university` is an ordinary-sized building.
    const features = featuresOf("heidelberg-altstadt");
    const castles = features.filter((f) => f.tags["historic"] === "castle");
    expect(castles.length).toBeGreaterThan(0);

    const solid = solidBuildingFootprints(features);
    const volumes = buildBuildings(features, {
      frame: enuFrameAt(
        CORPUS_SITES.find((s) => s.id === "heidelberg-altstadt")!.position,
      ),
    });

    const keyOf = featureKey;
    const solidKeys = new Set(solid.map((s) => keyOf(s.feature)));

    // The enclosure: not a building, so no rule can make it an obstacle.
    const notBuildings = castles.filter((c) => !isBuilding(c));
    expect(notBuildings.length).toBeGreaterThan(0);
    for (const castle of notBuildings) {
      expect(solidKeys.has(keyOf(castle))).toBe(false);
    }

    // The `building=university` one: a wing, not a bailey — small enough that
    // no plausible cap would have excluded it in the first place.
    const areas = castles
      .filter((c) => isBuilding(c))
      .map((c) => volumes.find((v) => v.feature === keyOf(c)))
      .filter((v) => v !== undefined)
      .map((v) => areaOf(v.footprint));
    for (const area of areas) expect(area).toBeLessThan(2000);
  });

  it("keeps genuinely large buildings solid, which is what a cap would break", () => {
    // FACT 2 THAT KILLED THE CAP. These are real, solid, walk-around buildings
    // in the size range a bailey-catching cap would have to exclude. The
    // assertion is deliberately about the SIZE of the largest survivor: if a
    // future change introduces a cap, this fails.
    const site = CORPUS_SITES.find((s) => s.id === "cologne-cathedral")!;
    const features = featuresOf(site.id);
    const solid = new Set(
      solidBuildingFootprints(features).map((s) => featureKey(s.feature)),
    );
    const volumes = buildBuildings(features, {
      frame: enuFrameAt(site.position),
    });

    const largestSolid = Math.max(
      ...volumes
        .filter((v) => solid.has(v.feature))
        .map((v) => areaOf(v.footprint)),
    );
    expect(largestSolid).toBeGreaterThan(10_000);
  });
});
