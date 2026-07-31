/**
 * Bringing the orbit target back to the scene origin, without rotating (W11).
 *
 * THE DEFECT THIS FIXES (R4-12). The demo simulates walking by re-origining the
 * world: every refresh rebuilds the mesh in an ENU frame centred on the new
 * position, so the place the user clicked is always at the scene origin. Nothing
 * touches the camera, which is correct — a click must not spin the view.
 *
 * But `controls.target.set(0, 0, 0)` runs exactly once, in `BuildingView`'s
 * constructor, and `MapControls` pans by moving the camera **and** its target
 * together. So after any pan the target is at some `(dx, 0, dz)`, the new content
 * is still built at the origin, and the clicked point renders `|d|` metres
 * off-centre — potentially off screen. The demo reads as having ignored the
 * click, and the further the user has explored the worse it gets.
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
 * Translates camera and target so the target sits at the scene origin.
 *
 * A no-op when it already does, which is the common case — the demo starts
 * there, and a recentre that always moved something would show as a jump on
 * every click rather than only after a pan.
 */
export function recentreOnOrigin(
  camera: THREE.Object3D,
  controls: OrbitTarget,
): void {
  const { target } = controls;
  if (target.x === 0 && target.y === 0 && target.z === 0) return;
  // BOTH, by the same vector. Moving only the target would swing the camera;
  // moving only the camera would slide the pivot out from under it.
  camera.position.sub(target);
  target.set(0, 0, 0);
  // Required: `MapControls` holds the camera's offset from the target in
  // spherical coordinates and re-applies it on the next `update()`. Without
  // this call the very next frame — one is scheduled by the refresh anyway —
  // would restore the pre-recentre position and the fix would appear to do
  // nothing at all.
  controls.update();
}
