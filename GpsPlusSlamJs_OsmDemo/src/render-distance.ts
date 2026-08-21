import { FAR_PLANE_M } from "./building-view.js";
import { TERRAIN_EXTENT_M } from "./heightfield.js";

/**
 * How far the 3D view draws, as one number the operator can turn (Q9 + Q10).
 *
 * **WHY ONE CONTROL AND NOT TWO.** The field report asked for two things — draw
 * further, and stop culling the terrain profile near the user — and
 * `building-view.ts` says they are the same request:
 *
 * > **IT IS EXACTLY `TERRAIN_EXTENT_M`, and that is the constraint rather than a
 * > coincidence.** The ground plane reaches `TERRAIN_EXTENT_M` along each axis
 * > and then stops; a far plane beyond it lets the default view see the edge of
 * > the world, which is finding R2-9 (buildings standing on nothing) returning.
 *
 * A far-plane slider on its own would therefore not answer "how much further
 * could we render?" — it would show the void past the ground with buildings
 * standing on nothing, which this repo has already fixed once. Moving both
 * together is what makes the extra distance mean anything.
 *
 * **AN INSTRUMENT, NOT A NEW DEFAULT (DEC-Y24).** `FAR_PLANE_M` and
 * `TERRAIN_EXTENT_M` are unchanged, and `far-field.test.ts` still pins their
 * relationship for the shipped default view. This module only computes what a
 * deliberately-opted-into debug session should use instead. If wiring it ever
 * requires editing those constants, the design is wrong and gets re-planned
 * rather than the guard relaxed.
 *
 * Pure on purpose, like `elevation-nudge.ts`, `map-zoom-to-camera.ts` and
 * `ar-descent.ts`: the arithmetic and its invariant are the part worth testing,
 * and they should be testable without a renderer.
 *
 * @see render-distance.ts.md
 */

/**
 * The largest multiplier the control offers.
 *
 * The reporter asked to "really push it to the extreme", and 10× is that.
 *
 * **THE ORIGINAL RATIONALE HERE WAS WRONG, and the correction matters for
 * whoever wires this.** It said an unbounded multiplier would be an
 * out-of-memory because `GROUND_SEGMENTS` derives from
 * `TERRAIN_EXTENT_M * 2 / TERRAIN_SPACING_M`. That derivation is **capped**:
 * `GROUND_SEGMENTS = Math.min(MAX_GROUND_SEGMENTS, derived)`, and
 * `MAX_GROUND_SEGMENTS` is 480. At 10x
 * the derived value is 4000 against a cap of 480, so the vertex count is pinned
 * and cannot grow at all. Caught in review of PR #333.
 *
 * What actually degrades is **resolution, not memory**: with the segment count
 * fixed, widening the plane grows each quad from ~12 m to ~120 m, so the terrain
 * relief the reporter wants to see further away is exactly what gets coarser as
 * they turn the dial. That is worth knowing before reading the result — a flat-
 * looking distance at 10× may be the sampling, not the ground.
 *
 * The ceiling therefore exists to bound **draw cost and legibility**, not to
 * prevent a crash. 10× is where the reporter's own question runs out rather than
 * a measured limit, and finding the affordable value is what the control is for.
 */
export const MAX_RENDER_MULTIPLIER = 10;

export interface RenderDistance {
  /** The camera's far plane, metres. */
  readonly farPlaneM: number;
  /** Half-width of the ground plane, metres. */
  readonly terrainExtentM: number;
}

/**
 * The distances a given multiplier implies, with the coupling enforced here.
 *
 * `1` returns today's values exactly, so the control is inert until moved.
 * Anything outside `[1, MAX_RENDER_MULTIPLIER]` — including `NaN` and both
 * infinities — collapses to `1` rather than propagating: these numbers reach the
 * camera's `far` and the plane's geometry, where a `NaN` renders nothing at all
 * and raises no error, which reads in a field report as "the 3D view is empty"
 * and is indistinguishable from half a dozen other causes.
 */
export function renderDistanceFor(multiplier: number): RenderDistance {
  const safe =
    Number.isFinite(multiplier) && multiplier >= 1
      ? Math.min(MAX_RENDER_MULTIPLIER, multiplier)
      : 1;
  // BOTH FROM THE SAME FACTOR, which is what keeps `farPlaneM <= terrainExtentM`
  // true at every setting: the two constants are equal today, so scaling them by
  // one number preserves the relation by construction rather than by a clamp
  // that a later edit could get wrong.
  return {
    farPlaneM: FAR_PLANE_M * safe,
    terrainExtentM: TERRAIN_EXTENT_M * safe,
  };
}
