/**
 * Suppresses POI markers that duplicate a building already extruded — F33, §5.
 *
 * THE DEFECT, AND WHY IT IS A GEOMETRY PROBLEM RATHER THAN A POI ONE. Four POI
 * kinds are buildings in their own right at real-world scale —
 * `amenity=hospital` (15.3 m), `tourism=hotel` (13.5), `amenity=place_of_worship`
 * (12.0), `leisure=sports_centre` (9.0) — and a hospital is routinely mapped as
 * BOTH a node and a building way. `poi.ts` marks nodes, `buildings.ts` extrudes
 * ways, neither knows about the other, and a 15 m block ends up standing inside
 * a building that is already there.
 *
 * DEC-R6-8 kept POI models at real-world scale rather than adopting the plinth
 * idiom, which would have dissolved this by making every marker ~0.9 m. So it is
 * fixed as what it structurally is: **a volume drawn where another volume
 * already stands**, the same defect the outline/part rule handles one level up.
 *
 * THE RULE IS KIND *AND* POSITION, AND BOTH HALVES ARE LOad-BEARING. Position
 * alone would empty every station concourse of its benches; kind alone would
 * delete a hospital that is mapped only as a node, which is a visible fix
 * turning into an invisible data loss. That second case is the one the tests
 * spend most of their effort on, because the obvious implementation gets it
 * wrong and looks right on any fixture where a building happens to exist.
 *
 * PURE, AND SEPARATE FROM BOTH BUILDERS. `poi.ts` stays free of buildings and
 * `buildings.ts` stays free of POI; the caller that already has both applies
 * this. That also keeps it testable without a fixture.
 *
 * @see poi-building-overlap.ts.md
 */

import { poiModelFor } from "./poi-models.js";

/**
 * How tall a POI model has to be before it counts as a building claim.
 *
 * 8 m, and the number is bounded from BOTH sides by real models rather than
 * chosen. Below it sit the shopfronts — `amenity=restaurant` at 3.6 m,
 * `amenity=cafe` at 3, `amenity=fast_food` at 3.2 — every one of which is
 * legitimately inside a building, so a lower threshold would delete most of a
 * high street. Above it sit exactly the four kinds that duplicate a building:
 * `leisure=sports_centre` (9.0) is the smallest.
 */
export const BUILDING_SCALE_POI_HEIGHT_M = 8;

/** The minimum a marker must carry for this rule to judge it. */
export interface PoiFootprintMarker {
  readonly feature: string;
  readonly kind: string;
  /** ENU metres, in the same frame as the footprints. */
  readonly position: { readonly x: number; readonly y: number };
}

/**
 * Whether a POI kind is tall enough that drawing it inside a building duplicates
 * that building.
 *
 * DERIVED FROM THE MODEL'S OWN HEIGHT, never from a list of kind strings. The
 * heights are already measured from the geometry rather than declared
 * (`poi-models.ts` does that because twenty-five of fifty models disagreed with
 * a hand-written figure), so this inherits that property: a fifth
 * building-scale model added later is covered without anyone remembering to
 * update a list. A literal list would fail silently, which is how F33 arrived.
 */
export function isBuildingScalePoi(kind: string): boolean {
  const model = poiModelFor(kind);
  // No model means the unmodelled tail, which draws a fallback cone. That is not
  // a building claim, and there are ~650 such kinds — a wrong answer here would
  // be broad.
  if (model === undefined) return false;
  return model.heightM >= BUILDING_SCALE_POI_HEIGHT_M;
}

/**
 * True when a point is inside a ring, by the even-odd rule.
 *
 * A REAL POINT-IN-POLYGON RATHER THAN A BOUNDING-BOX TEST, and the difference is
 * not academic here: buildings are routinely L-shaped or U-shaped, and a marker
 * standing in the notch is inside the box and outside the building. Deleting it
 * would be exactly the invisible data loss this file exists to avoid.
 *
 * The bounding box is still used, as a cheap PRE-FILTER — see
 * {@link suppressPoiInsideBuildings}.
 */
function insideRing(
  point: { x: number; y: number },
  ring: readonly { x: number; y: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a === undefined || b === undefined) continue;
    const straddles = a.y > point.y !== b.y > point.y;
    if (!straddles) continue;
    // The x where edge a→b crosses the horizontal line through `point`.
    const crossing = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < crossing) inside = !inside;
  }
  return inside;
}

/** A ring's axis-aligned bounds, for the cheap pre-filter. */
function bounds(ring: readonly { x: number; y: number }[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of ring) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, maxX, minY, maxY };
}

/**
 * The markers to keep, dropping building-scale ones inside a building.
 *
 * ORDER IS PRESERVED, and that is a hard requirement rather than a nicety: the
 * consumer indexes marker identity by position in this array (instancing
 * collapses N objects onto one, so there is nowhere per-object left to put it).
 * Reordering would make every pick after the first name the wrong feature —
 * confidently.
 *
 * COST. Bounding boxes are precomputed once and used as a pre-filter, so the
 * inner point-in-polygon runs only for the handful of (marker, building) pairs
 * whose boxes overlap. Round 5 measured what the naive shape costs on this data:
 * a `parts x outlines x vertices` scan was 0.8–4.6 s per build at res-7 scale.
 * Only building-scale markers are considered at all, and there are very few.
 */
export function suppressPoiInsideBuildings<T extends PoiFootprintMarker>(
  markers: readonly T[],
  footprints: readonly (readonly { x: number; y: number }[])[],
): T[] {
  if (footprints.length === 0) return [...markers];
  // Built once. Recomputing per marker is the shape that made the round-5
  // part-to-outline search cost seconds.
  const boxes = footprints.map(bounds);

  return markers.filter((candidate) => {
    if (!isBuildingScalePoi(candidate.kind)) return true;
    for (let i = 0; i < footprints.length; i += 1) {
      const box = boxes[i];
      const ring = footprints[i];
      if (box === undefined || ring === undefined) continue;
      if (
        candidate.position.x < box.minX ||
        candidate.position.x > box.maxX ||
        candidate.position.y < box.minY ||
        candidate.position.y > box.maxY
      ) {
        continue;
      }
      if (insideRing(candidate.position, ring)) return false;
    }
    return true;
  });
}
