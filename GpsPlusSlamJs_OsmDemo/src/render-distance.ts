import { FAR_PLANE_M } from "./building-view.js";

/**
 * How far the 3D view draws, as one number the operator can turn (Q9 + Q10).
 *
 * **[RETRACTED 2026-08-21] THIS MODULE USED TO ARGUE FOR TWO COUPLED
 * DISTANCES, AND THE SHIPPED CONTROL MOVES ONLY ONE.** The paragraph here
 * said a far-plane slider on its own "would show the void past the ground with
 * buildings standing on nothing, which this repo has already fixed once", and
 * that moving the far plane and the ground extent together "is what makes the
 * extra distance mean anything". That is a description of what now ships, and
 * leaving it in place would tell the next reader to "finish the wiring" by
 * widening the plane.
 *
 * **Two owner decisions replaced it, both on 2026-08-21:**
 *
 * - Seeing **empty scene** past the ground's edge is acceptable. That was the
 *   whole objection to a far-plane-only control, and it was cosmetic.
 * - Seeing **invented terrain** is not, which is what widening the plane
 *   actually produces: `surfaceHeight` clamps its sample index per axis and
 *   the GPU path uses `ClampToEdgeWrapping`, so the edge profile extrudes
 *   outward as stripes that read as relief and are fabricated. That is finding
 *   R2-9 in its real form, and `moveGroundTo` names it.
 *
 * So the ground plane must NOT follow this control. Widening it would require
 * widening the height field with it, which is a worker-protocol change nobody
 * has scoped. `BuildingView.setFarPlane` moves the camera and the fog and
 * nothing else.
 *
 * **AN INSTRUMENT, NOT A NEW DEFAULT (DEC-Y24).** `FAR_PLANE_M` is
 * unchanged and `far-field.test.ts` still pins the shipped default view. This module only computes what a
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
 * prevent a crash.
 *
 * **AND 10x IS DELIBERATE, AGAINST A MEASUREMENT THAT LOOKED LIKE IT REFUTED IT**
 * (owner decision, 2026-08-21). A spike measured the COLD-START working set --
 * `fetchWorkingSet` is the user’s res-7 tile plus its ring of six -- and found a
 * guaranteed loaded radius of 1048-2346 m and a best-case reach of ~5 km, which
 * says a 24 km far plane can only ever draw empty space. That reasoning is
 * correct about a session that has just started and wrong about the system:
 * `DemoPipeline.loaded` is **never evicted** (its own cost docstring: "`this.tiles`
 * is never evicted, so the cost of clicking around is quadratic in tiles
 * visited"), so a session that has been walked around holds far more city, and
 * testing 10x on such a session is exactly what this constant is for.
 *
 * The measurement, and the retraction, are in
 * `2026-08-21-1420-render-distance-is-data-bound-findings.md`.
 *
 * So 10x remains where the reporter's own question runs out rather than a
 * measured limit, and finding the affordable value is what the control is for.
 */
export const MAX_RENDER_MULTIPLIER = 10;

export interface RenderDistance {
  /**
   * The camera's far plane, metres.
   *
   * THE ONLY FIELD, SINCE 2026-08-21. There was a `terrainExtentM` beside it,
   * scaled by the same factor, and it was removed when the ground plane was
   * decided against (see the retraction above): nothing read it, and the
   * property test that scaled it guarded a relationship the product had given
   * up. The workspace dead-code check could not have caught that -- an unused
   * INTERFACE MEMBER is not an unused export -- so it would have survived as a
   * computed value with a passing test, which reads to the next reader as
   * supported API.
   */
  readonly farPlaneM: number;
}

/**
 * The distances a given multiplier implies, with the coupling enforced here.
 *
 * `1` returns today's values exactly, so the control is inert until moved.
 * Anything outside `[1, MAX_RENDER_MULTIPLIER]` — including `NaN` and both
 * infinities — collapses to `1` rather than propagating: these numbers reach the
 * camera's `far`, where a `NaN` renders nothing at all
 * and raises no error, which reads in a field report as "the 3D view is empty"
 * and is indistinguishable from half a dozen other causes.
 */
export function renderDistanceFor(multiplier: number): RenderDistance {
  const safe =
    Number.isFinite(multiplier) && multiplier >= 1
      ? Math.min(MAX_RENDER_MULTIPLIER, multiplier)
      : 1;
  return { farPlaneM: FAR_PLANE_M * safe };
}
