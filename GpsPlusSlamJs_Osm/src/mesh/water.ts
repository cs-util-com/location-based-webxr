/**
 * Which features are water, and where their BANKS run.
 *
 * WHY WATER IS AN OBSTACLE AT ALL. `route-penalty.ts` charges a route
 * `metres × penaltyFor(score)` and clamps the penalty at 3, saying why in as
 * many words: *"without it a score approaching zero costs unboundedly much,
 * which stops being a preference and becomes an obstacle, and obstacles are
 * `crossesObstacle`'s job alone in this demo."* So water has always been
 * expensive and never impossible — and a destination **in** the river cannot be
 * priced out at any multiplier, because there is no alternative route to it.
 * That is the reported case: an NPC sent into the middle of the Thames walks
 * there.
 *
 * **THE BANKS, NOT THE AREA, AND THAT IS MEASURED.** Indexing the filled water
 * surface costs 13 966–18 246 covered cells per site even after clipping,
 * against a budget of **1 000–10 000 for a whole site's obstacle index**. The
 * banks, clipped, cost **1 153–1 517**. Only the band fits — see
 * `site-water-index-cost.test.ts`, which carries the table and guards the bound.
 *
 * It is also the correct semantics rather than merely the affordable one.
 * `crossesObstacle` is a **crossing** test, so a band along the banks refuses
 * every step that enters the water and leaves mid-river steps unindexed. A
 * destination in the river then becomes simply unreachable, which is what "you
 * cannot walk there" means to a search.
 *
 * WHAT COUNTS AS WATER, narrowly, and what does not:
 *
 * - **`natural=water`** and its `water=*` subtypes, including the multipolygon
 *   relation form — which is the only form that matters in practice, since the
 *   Thames is `natural=water water=river type=multipolygon`.
 * - **NOT `waterway=river`.** That is a **centreline**, not an area: at
 *   `london-tower-bridge` it is three open ways. Banding it would lay a
 *   one-cell ribbon down the middle of the river, which is neither its surface
 *   nor a bank anyone can cross.
 * - **NOT `waterway=riverbank`.** It reads like the obvious tag and it is
 *   **deprecated** — zero occurrences across all eight corpus fixtures, and no
 *   row in the rule table. Named here because it is the first thing a reader
 *   will wonder about.
 * - **NOT `natural=coastline` or `natural=wetland`.** A coastline is linear with
 *   land on one side, and a wetland is walkable-ish; both are deliberate
 *   exclusions rather than oversights.
 *
 * **INNER RINGS ARE BANKS TOO.** A hole in a water multipolygon is an island or
 * a pier, so its ring is a shore that must block just as the outer one does.
 * Every ring is returned.
 *
 * @see water.ts.md
 */

import type { OsmFeature } from "../model/osm-feature.js";
import { toGeometry } from "../model/osm-geometry.js";
import { clipToBbox, type Bbox } from "../spatial/clip.js";
import type { PlanarPoint } from "../spatial/point-in-ring.js";

/**
 * Whether this feature is a body of water whose banks should block.
 *
 * Tag-only: it says nothing about whether the geometry turns out to be areal,
 * which {@link waterBankLines} decides, because an unclosed `natural=water` way
 * is real Overpass output and is not a bank.
 */
export function isWaterArea(feature: OsmFeature): boolean {
  return feature.tags["natural"] === "water";
}

/**
 * The bank lines of one water feature, as `x = lng, y = lat` polylines.
 *
 * `clipTo` bounds the geometry first, and passing one is strongly recommended:
 * Overpass `out geom` returns whole member geometry regardless of the query
 * box, so `london-westminster`'s Thames relation spans **16.3 km** inside a
 * 350 m extract. Unclipped it costs 13 052 cells against a site budget of
 * 10 000; clipped to its fetch tile, 1 517.
 *
 * Returns `[]` for anything that is not water, cannot be converted, or is not
 * areal — a river centreline included. **`[]` means "nothing to block with",
 * never "unknown"**, so a caller cannot mistake a refusal for an empty river.
 */
export function waterBankLines(
  feature: OsmFeature,
  clipTo?: Bbox,
): PlanarPoint[][] {
  if (!isWaterArea(feature)) return [];

  const result = toGeometry(feature);
  if (!result.ok) return [];

  const geometry =
    clipTo === undefined
      ? result.geometry
      : clipToBbox(result.geometry, clipTo);
  if (geometry === undefined) return [];

  // Areal kinds only. An open way tagged `natural=water` has no interior, so it
  // has no bank — treating its points as a ring would invent one, which is the
  // silent wrongness `ring-overlap.ts` refuses for the same reason.
  const rings =
    geometry.kind === "polygon"
      ? geometry.rings
      : geometry.kind === "multipolygon"
        ? geometry.polygons.flat()
        : [];

  const lines: PlanarPoint[][] = [];
  for (const ring of rings) {
    if (ring.length < 3) continue;
    lines.push(ring.map((p) => ({ x: p.lng, y: p.lat })));
  }
  return lines;
}
