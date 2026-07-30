/**
 * The vertical offset ladder for everything drawn at ground level.
 *
 * WHY THIS IS ONE MODULE AND NOT A CONSTANT PER FILE. Five things now want to be at
 * y ≈ 0: the terrain plane, ground plates, road ribbons, merged-area slabs and the
 * affordance grid. Coplanar geometry z-fights — a shimmering stripe wherever two
 * surfaces meet, which changes with the camera and reads as a rendering bug rather
 * than as a layering decision. The fix is that no two of them are ever coplanar, and
 * that is only checkable if the offsets are stated together.
 *
 * It existed implicitly before as `cell-mesh.ts`'s lone `GRID_LIFT_M`. That was fine
 * with one lifted layer and stops being fine at five: each new constant would be
 * chosen against whichever neighbour its author happened to think of.
 *
 * THE ORDER IS A DESIGN DECISION, not an accident of magnitude:
 *
 *  - **plates** sit lowest, just above the terrain. They are the ground's own
 *    surface — a car park IS the ground there.
 *  - **roads** sit above plates, because a road crossing a landuse polygon should
 *    read as being on top of it, which is also true.
 *  - **areas** (merged affordance regions) sit above both, because they are a claim
 *    ABOUT the ground rather than a part of it.
 *  - **cells** sit highest, because the per-cell grid is the finest-grained claim and
 *    is the thing being inspected — it must never be occluded by a coarser one.
 *
 * WHY THE STEPS ARE SO SMALL. Large enough to beat depth-buffer precision at the
 * camera's near/far range (0.5 m to 4000 m), small enough that nothing looks like it
 * is floating. 4 cm between layers is invisible at any distance this scene is viewed
 * from and is ~three orders of magnitude above the depth resolution there.
 *
 * @see layer-order.ts.md
 */

import type { LayerKind } from "./layers.js";

/** Metres between adjacent ground layers. */
const STEP_M = 0.04;

/**
 * Vertical offset for a ground-level layer, metres above the terrain surface.
 *
 * Non-ground layers return 0: buildings, trees and POI markers stand up from the
 * ground and are separated by their own geometry, so lifting them would only make
 * them float.
 */
export function groundLift(layer: LayerKind): number {
  switch (layer) {
    case "plates":
      return STEP_M;
    case "roads":
      return STEP_M * 2;
    case "areas":
      return STEP_M * 3;
    case "cells":
      return STEP_M * 4;
    case "buildings":
    case "trees":
    case "poi":
      return 0;
  }
}

/**
 * The ground layers, lowest first.
 *
 * Exported so a test can assert the ladder is strictly increasing without
 * re-listing it — a second list would be the thing that drifts.
 */
export const GROUND_LAYERS = ["plates", "roads", "areas", "cells"] as const;
