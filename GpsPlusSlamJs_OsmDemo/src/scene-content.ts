/**
 * The world content, as one subtree with a swappable parent.
 *
 * **WHY THIS IS ITS OWN MODULE, AND WHY IT IS THE WHOLE OF AR MILESTONE 0.**
 * The demo draws its city into `BuildingView`'s own `THREE.Scene`. AR mode
 * needs the same geometry under the framework's scene root instead — that root
 * IS the GPS-world frame, so no alignment⁻¹ container is needed (see the
 * framework's `ar-scene-hierarchy.ts`, which states this at the top because two
 * readers previously concluded the opposite).
 *
 * **THE AXES STILL DIFFER, AND THE FIRST VERSION OF THIS FILE DENIED IT.** "No
 * alignment container" is not "no transform": the demo's scene is X=East,
 * Y=Up, Z=−North and the GPS-world frame is NUE. This module owns that
 * conversion — see {@link ContentFrame} and `DEMO_TO_NUE` — which is what plan
 * §2.2 means by "the axis mapping must be stated, tested, and derived once".
 *
 * Moving the subtree is one `add()` call, because three.js reparents rather
 * than copying. What is NOT free is (a) that conversion, and (b) knowing WHICH
 * objects have to move: an edit that attaches AR-relevant content straight to
 * `BuildingView`'s scene leaves it behind, and the symptom is content missing
 * in AR while every desktop test stays green. `building-view-content.test.ts`
 * guards (b) as source text, because no runtime test can reach it.
 *
 * **`BuildingView` cannot be unit-tested** — it constructs a
 * `THREE.WebGLRenderer` in its own constructor — so a seam left as an option on
 * that class would be a seam the unit suite cannot reach. Extracting it here is
 * what lets milestone 0 be proved rather than asserted.
 *
 * WHAT LIVES HERE, and the boundary is deliberate:
 *
 * - **In:** the drawn mesh layers, and the res-13 cell mesh with its outlines.
 *   These are exactly plan §2.8's list — buildings, region slabs, the heat
 *   grid, POI markers, trees.
 * - **Out:** lights, the ground plane, the sun rig, the route line, the NPC
 *   agent, **and the underground diagnostic lines.** AR supplies its own
 *   lighting from the framework's scene, hides the ground plane by design, and
 *   §2.8 lists neither the NPC nor the underground layer as AR content.
 *   - The underground layer is the one worth naming: its material **disables
 *     depth testing** so it can be seen through the terrain it runs beneath
 *     (`layer-order.ts`). With no ground plane in AR it would become an
 *     un-occluded overlay painted across the passthrough. It was briefly in
 *     this set and was taken out for that reason.
 * - Objects that stay behind stay behind ON PURPOSE.
 *
 * @see scene-content.ts.md
 */

import * as THREE from "three";

/**
 * Which axis convention the content's parent uses.
 *
 * - `demo-scene` — X=East, Y=Up, **Z=−North**. What `BuildingView` and every
 *   mesh builder produce, and what `main.ts` round-trips a picked point with
 *   (`frame.toLatLng({ x: point.x, y: -point.z })`).
 * - `gps-world-nue` — X=North, Y=Up, Z=East. The framework's scene root, and
 *   what `calcRelativeCoordsInMeters` returns (`[north, up, east]`).
 */
export type ContentFrame = "demo-scene" | "gps-world-nue";

/**
 * Demo scene axes → GPS-world NUE, as a rotation about Up.
 *
 * DERIVED ONCE, HERE, and this is what plan §2.2 means by "the axis mapping
 * must be stated, tested, and derived once — a second, disagreeing copy is the
 * exact class of defect the fixed-origin plan was written about".
 *
 *     north = −z_demo  →  X_nue
 *     up    =  y_demo  →  Y_nue
 *     east  =  x_demo  →  Z_nue
 *
 * i.e. `NUE = (−z, y, x)`. Both frames are right-handed, so this is a pure
 * −90° yaw and NOT a reflection — `scene-content.test.ts` pins the determinant
 * at +1, because this demo has already shipped a mirrored mesh frame that
 * survived for months (see `building-view.ts.md`).
 *
 * **The first version of this module claimed no mapping was needed.** It was
 * wrong, and it said so in three places, which would have sent the AR milestone
 * to render the city 90° off while telling the implementer not to look.
 */
const DEMO_TO_NUE = new THREE.Matrix4().makeRotationY(-Math.PI / 2);

export class SceneContent {
  /**
   * The one node everything world-derived hangs from.
   *
   * Public because AR reparents it and tests assert on it; there is no
   * behaviour to protect behind a getter, and hiding it would only force the
   * same access through a less obvious name.
   */
  readonly root = new THREE.Group();

  constructor(parent: THREE.Object3D) {
    this.root.name = "osm-content";
    parent.add(this.root);
  }

  /**
   * Move the whole subtree under `parent`.
   *
   * Idempotent: three.js removes from the old parent before adding, so
   * re-attaching to the current parent reorders it within that parent's child
   * list and changes nothing else. That matters because AR entry is gated on a
   * first GPS fix and may run more than once.
   */
  attachTo(parent: THREE.Object3D, frame: ContentFrame = "demo-scene"): void {
    parent.add(this.root);
    // SET, NEVER ACCUMULATED. The transform is a property of the frame being
    // attached to, so a round trip out to AR and back is exactly the identity
    // rather than two rotations that happen to cancel.
    this.root.matrixAutoUpdate = false;
    this.root.matrix.copy(
      frame === "gps-world-nue" ? DEMO_TO_NUE : new THREE.Matrix4(),
    );
    this.root.matrixWorldNeedsUpdate = true;
  }

  /**
   * Remove the root from whatever scene graph currently holds it.
   *
   * **Called from `BuildingView.dispose()`, and the reason is AR-specific.**
   * On desktop the root dies with the view's own scene and detaching is
   * invisible. Once AR has reparented it, the framework's scene root OUTLIVES
   * the view — so disposing without detaching leaves a subtree of freed
   * geometry attached to a live scene. **three.js does not report drawing a
   * disposed geometry**, so the symptom is silent absence, which is the exact
   * failure `building-view.ts` already documents for the shared POI resources.
   */
  detach(): void {
    this.root.removeFromParent();
  }

  add(object: THREE.Object3D): void {
    this.root.add(object);
  }

  remove(object: THREE.Object3D): void {
    this.root.remove(object);
  }
}
