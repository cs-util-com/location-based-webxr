/**
 * Moving the orbit pivot onto a point, without rotating (W11).
 *
 * THE DEFECT THIS FIXES (R4-12). A click must bring the chosen place back to the
 * middle of the 3D view, and must not spin it. `controls.target.set(0, 0, 0)`
 * runs exactly once, in `BuildingView`'s constructor, and `MapControls` pans by
 * moving the camera **and** its target together — so after any pan the target is
 * at some `(dx, 0, dz)` and the chosen point renders `|d|` metres off-centre,
 * potentially off screen. The demo reads as having ignored the click, and the
 * further the user has explored the worse it gets.
 *
 * **THE PIVOT IS THE USER, NOT THE SCENE ORIGIN.** Those were the same point
 * while the demo simulated walking by re-origining the world — every refresh
 * rebuilt the mesh in an ENU frame centred on the new position, so the clicked
 * place always sat at the origin. `scene-anchor.ts` fixed the frame, and the two
 * diverged: recentring on the origin drags the camera back to the session start
 * on every step, steadily further away the more the user walks. Hence the `at`
 * parameter, and hence the tests that pin it.
 *
 * WHY TRANSLATION-ONLY IS THE WHOLE POINT, AND WHY IT IS FREE. The requirement in
 * the notes is precise: _"man darf quasi nur ihre Translation ändern, sodass die
 * Kamera auf den Punkt guckt, der auf der 2D-Karte angeklickt wurde"_. Subtracting
 * the target's offset from **both** the camera and the target leaves the
 * camera→target vector bit-identical, so the orientation is unchanged **by
 * construction** rather than by care. Anything that recomputed the camera from a
 * distance and two angles would put the target in the right place and quietly
 * re-derive the rotation — which is the failure this file's test exists to make
 * impossible.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *
 * - **It does not animate.** The notes ask for the invariant, not a transition,
 *   and an animation would need a frame loop that DEC-R3-9 deliberately does not
 *   have (a permanent rAF made the e2e suite ~6x slower and burns phone battery
 *   repainting a static city).
 * - **It does not touch the pivot plane.** `controls.target` stays on `y = 0`
 *   here as everywhere else; DEC-R3-6 left that question open on purpose and it
 *   is a separate, much smaller effect.
 * - **It does not follow the 2D map's scroll.** Declined in the notes themselves:
 *   moving the two views independently is wanted, and this is a desktop demo
 *   whose point is the AR case.
 *
 * @see recentre-camera.ts.md
 */

import type * as THREE from "three";

/**
 * The part of `MapControls` this needs.
 *
 * Narrowed to a structural type rather than importing the class, so the contract
 * is "anything with an orbit target" and the module carries no dependency on
 * which controller the view happens to use. `update()` is required because the
 * controls cache their own spherical offset and would otherwise re-apply the old
 * one on the next frame — silently undoing the move.
 */
export interface OrbitTarget {
  readonly target: THREE.Vector3;
  update(): boolean | void;
}

/**
 * Translates camera and target so the target sits at `at`.
 *
 * A no-op when it already does, which is the common case — and a recentre that
 * always moved something would show as a jump on every click rather than only
 * after a pan.
 */
export function recentreOn(
  camera: THREE.Object3D,
  controls: OrbitTarget,
  /**
   * Where the pivot should sit, in scene coordinates.
   *
   * **USED TO BE IMPLICITLY THE ORIGIN**, back when the ENU frame was rebuilt
   * at the user's position on every publish, so "the origin" and "the user"
   * were the same point. Since `scene-anchor.ts` fixed the frame they are not:
   * the origin is where the scene was anchored, and recentring on it would drag
   * the camera back to the session start on every step.
   */
  at: { readonly x: number; readonly y: number; readonly z: number },
): void {
  const { target } = controls;
  if (target.x === at.x && target.y === at.y && target.z === at.z) return;
  // BOTH, by the same vector. Moving only the target would swing the camera;
  // moving only the camera would slide the pivot out from under it.
  camera.position.x += at.x - target.x;
  camera.position.y += at.y - target.y;
  camera.position.z += at.z - target.z;
  target.set(at.x, at.y, at.z);
  // Required: `MapControls` holds the camera's offset from the target in
  // spherical coordinates and re-applies it on the next `update()`. Without
  // this call the very next frame — one is scheduled by the refresh anyway —
  // would restore the pre-recentre position and the fix would appear to do
  // nothing at all.
  controls.update();
}
