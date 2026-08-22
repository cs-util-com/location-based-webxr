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
 * **DEC-Y24 IS SUPERSEDED (DEC-K2, 2026-08-22).** It said "an instrument, not a
 * new default", and that the shipped view was pinned by `far-field.test.ts`.
 * Both halves have changed and leaving the paragraph would mislead:
 *
 * - The dial now BOOTS at `DEFAULT_RENDER_MULTIPLIER`, so it is the default
 *   picture rather than an opt-in. A field session tested 2x on-device and
 *   asked for it — "das sieht super aus, dann kann ich schön weit rauszoomen".
 * - `far-field.test.ts` never pinned the shipped VIEW; it pins the CONSTANT
 *   `FAR_PLANE_M`, which this change deliberately does not move. Its own
 *   comment warns about assertions that keep passing while the invariant they
 *   name goes false, and it had become one. It is re-scoped alongside this.
 *
 * `FAR_PLANE_M` is still the 1x baseline and is still unchanged. What moved is
 * which multiplier the page starts on.
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

/**
 * The multiplier the page starts on (DEC-K2, 2026-08-22).
 *
 * **2x — draw 4800 m, haze 3168 m — chosen from a field test, not a
 * derivation.** The sixteenth session ran the dial up on a real phone, saw no
 * performance problem at any setting, and asked for this value specifically.
 * That is better evidence than anything the gates here can produce, and it is
 * the whole reason the number is 2 rather than something with a formula behind
 * it.
 *
 * **THE DEFAULT VIEW NOW DRAWS PAST THE GROUND PLATE, AND THAT IS THE ACCEPTED
 * HALF OF A DECISION WHOSE OTHER HALF STILL HOLDS.** `TERRAIN_EXTENT_M` is
 * 2400, so at 2x there is empty scene beyond the ground's edge. The owner
 * decision of 2026-08-21 says exactly that is acceptable and that INVENTED
 * terrain is not — widening the plate to match would extrude the edge profile
 * outward as fabricated relief (R2-9). So this constant may be raised; the
 * ground plate still must not follow it.
 *
 * **IT IS THE MARKUP'S VALUE TOO.** `index.html` carries it as the dial's
 * `value` and the boot path applies `renderDistanceFor` to whatever the input
 * holds, so the two cannot drift — `render-distance-markup.test.ts` is the
 * guard. Painting without applying is the specific bug that guard exists for.
 */
export const DEFAULT_RENDER_MULTIPLIER = 2;

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
