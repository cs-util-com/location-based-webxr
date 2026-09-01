/**
 * Components → regions with exact outlines and statistics.
 *
 * The other half of what the geohash→H3 move buys. The C# reference finished a
 * flood fill with a **concave hull** carrying `DEFAUT_MAX_EDGE_LENGTH_RATIO =
 * 0.69` — misspelled, public, and unexplained beyond *"any value between 0.69
 * and 0.99 seems to work that the geometry does not become convex"*. That
 * constant exists because a rectangular grid's filled region has no exact
 * boundary you can read off the grid.
 *
 * On a hex grid `cellsToMultiPolygon` gives the exact outline by construction,
 * so the hull, the tuning constant and the guesswork all disappear.
 *
 * @see region-builder.ts.md
 */

import { cellsToMultiPolygon, cellArea, UNITS } from "h3-js";
import type { LatLng, OsmFeatureKey } from "../model/osm-feature.js";
import type { CellScore } from "../score/affordance-scorer.js";
import { median } from "../utils/median.js";

/** A contiguous run of above-threshold cells, with its outline. */
export interface Region {
  /** Stable across recomputation while the component's extent holds. */
  readonly id: string;
  readonly category: string;
  /**
   * Outline as `[polygon][ring][position]`, outer ring first.
   *
   * Exact, not a hull: these are the cell boundaries themselves. A region with
   * a hole (a building inside a park) has that hole as a second ring.
   */
  readonly outline: readonly (readonly (readonly LatLng[])[])[];
  readonly cells: readonly string[];
  readonly cellCount: number;
  readonly areaM2: number;
  /**
   * MEDIAN, not mean.
   *
   * Scores are unbounded and multiplicative, so one heavily-mapped cell can be
   * orders of magnitude above its neighbours and would drag a mean with it. The
   * median describes the region a user is standing in.
   */
  readonly medianScore: number;
  readonly minScore: number;
  readonly maxScore: number;
  /** Every OSM element that contributed to any cell of the region. */
  readonly osmSourceIds: readonly OsmFeatureKey[];
}

/**
 * Builds a region from one component.
 *
 * `scoresByCell` must cover every cell in the component; a missing cell is
 * treated as the identity rather than dropped, so a region never silently
 * shrinks because of a lookup miss.
 */
export function buildRegion(
  component: readonly string[],
  category: string,
  scoresByCell: ReadonlyMap<string, CellScore>,
): Region {
  // An empty component is not a small region, it is a caller error: it would
  // produce id "", minScore Infinity and maxScore -Infinity, all of which look
  // like data downstream. connectedComponents never emits one (minSize >= 1),
  // so this is a public-boundary guard rather than a reachable path.
  if (component.length === 0) {
    throw new RangeError("A region component must contain at least one cell");
  }
  const cells = [...component].sort();
  const scores = cells.map(
    (cell) => scoresByCell.get(cell)?.scores[category] ?? 1,
  );

  const sources = new Set<OsmFeatureKey>();
  for (const cell of cells) {
    const contributors = scoresByCell.get(cell)?.contributors[category];
    if (contributors === undefined) continue;
    for (const key of Object.keys(contributors)) {
      sources.add(key as OsmFeatureKey);
    }
  }

  return {
    id: regionId(cells),
    category,
    outline: toOutline(cells),
    cells,
    cellCount: cells.length,
    areaM2: cells.reduce((sum, cell) => sum + cellArea(cell, UNITS.m2), 0),
    // `?? 1` narrows the type; it is not a reachable default. `scores` has
    // one entry per cell and an empty component threw above, so the empty
    // case cannot occur — 1 is simply the same neutral affordance the
    // per-cell lookup already falls back to. The private `median` this
    // replaced buried that same 1 inside the arithmetic, where it read as a
    // live default and would have been wrong for any other caller.
    medianScore: median(scores) ?? 1,
    minScore: Math.min(...scores),
    maxScore: Math.max(...scores),
    osmSourceIds: [...sources].sort(),
  };
}

/** Builds regions for every component. */
export function buildRegions(
  components: readonly (readonly string[])[],
  category: string,
  scoresByCell: ReadonlyMap<string, CellScore>,
): Region[] {
  return components.map((component) =>
    buildRegion(component, category, scoresByCell),
  );
}

/**
 * A stable id for a component.
 *
 * **The lowest-sorting cell id in the component.** Deterministic,
 * order-independent, and free.
 *
 * Its failure mode is real and must be documented wherever regions are
 * persisted: **two regions merging as more data loads changes BOTH their ids**,
 * because the merged component's lowest cell is the lower of the two. Consumers
 * must not persist a region id as a long-lived key — it identifies a shape at a
 * moment, not a place forever.
 */
export function regionId(cells: readonly string[]): string {
  let lowest: string | undefined;
  for (const cell of cells) {
    if (lowest === undefined || cell < lowest) lowest = cell;
  }
  return lowest ?? "";
}

/**
 * Exact outline of a cell set.
 *
 * `cellsToMultiPolygon(cells, true)` returns GeoJSON-order coordinates
 * (`[lng, lat]`); this package uses `{ lat, lng }` everywhere, so they are
 * converted here rather than leaving a coordinate-order trap in the public API.
 */
function toOutline(cells: readonly string[]): LatLng[][][] {
  return cellsToMultiPolygon([...cells], true).map((polygon) =>
    polygon.map((ring) => ring.map(([lng, lat]) => ({ lat, lng }))),
  );
}
