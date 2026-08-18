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
    // Nothing to lift: buildings, trees and POI markers stand up from the ground
    // and are separated by their own geometry.
    //
    // `terrainDebug` used to be here for a DIFFERENT reason with the same answer
    // — it re-coloured the ground plane in place, so a lifted copy would z-fight
    // with the very plane it replaced. That is now a ground MODE rather than a
    // layer (W6, DEC-R5-4), and needing a bespoke reason to sit in this table was
    // one of the signs it never belonged in the registry.
    case "buildings":
    case "trees":
    case "poi":
    case "underground":
      // `underground` is BELOW the ground rather than on it, so it has no place
      // on the lift ladder: it is drawn at the features' own depth, and lifting
      // it towards the surface would defeat the one thing it exists to show.
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

/**
 * The planned route's polyline, one rung ABOVE the highest ground layer.
 *
 * IT LIVES HERE RATHER THAN IN `route-path.ts` because that is this module's
 * whole reason for existing: a constant chosen next to the thing that uses it is
 * a constant chosen against whichever neighbour its author happened to think of.
 * A route is not a `LayerKind` — it is not toggleable and it is not a claim
 * about the ground — so it cannot go through `groundLift`, but it is coplanar
 * with everything that does.
 *
 * ABOVE `cells`, which is the top of the ladder, because the route is the thing
 * the user just asked for. Occluding it behind an affordance overlay would hide
 * the one artefact stage 4 exists to show (DEC-R11-3).
 */
export const ROUTE_LIFT_M = STEP_M * 5;

/**
 * Draw order for the TRANSPARENT layers (DEC-R7b-7).
 *
 * WHY THIS EXISTS AT ALL. Until round 8 nothing in the demo set `renderOrder`,
 * so every translucent surface was ordered by three's default — back-to-front by
 * distance from the camera. That is the right rule for unrelated transparent
 * objects and the wrong one for two surfaces making the SAME claim at different
 * grains: whether a region slab composites over or under the cells inside it
 * would flip as the camera moved, which reads as flicker rather than as a
 * decision.
 *
 * THE ORDER IS THE LADDER'S ORDER, coarse to fine, so the finer claim always
 * wins. It mirrors `groundLift` deliberately — a reader who changes one and not
 * the other should find them obviously adjacent.
 *
 * Only the layers that are actually translucent appear here. An opaque mesh does
 * not need an order, and giving it one would opt it out of the depth-sorted
 * batch it belongs in.
 *
 * THAT IS A REQUIREMENT ON THE MATERIAL, not a description of one. `WebGLRenderer`
 * splits its render list into opaque / transmissive / transparent and draws
 * opaque first; `renderOrder` only sorts WITHIN a list. So an opaque material
 * with a high rung still draws before every translucent layer and gets blended
 * over — it ranks above them in this table and loses to them on screen. Review
 * on #256 found exactly that: the underground lines shipped opaque.
 */
export const RENDER_ORDER = Object.freeze({
  areas: 1,
  cells: 2,
  // ABOVE both, and deliberately: the underground outlines are a diagnostic
  // drawn BELOW the terrain, so they would otherwise be occluded by the very
  // ground they are meant to be seen under. Their material disables depth
  // testing for the same reason, and render order is what then decides.
  underground: 3,
  // THE TOP RUNG, for the same reason `ROUTE_LIFT_M` is the top of the lift
  // ladder: the planned route is the artefact stage 4 exists to show
  // (DEC-R11-3), and a route half-hidden behind a building proves nothing. Its
  // material disables depth testing, so this is what decides where it lands.
  route: 4,
});
