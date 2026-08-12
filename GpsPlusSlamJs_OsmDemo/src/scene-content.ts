/**
 * The world content, as one subtree with a swappable parent.
 *
 * **WHY THIS IS ITS OWN MODULE, AND WHY IT IS THE WHOLE OF AR MILESTONE 0.**
 * The demo draws its city into `BuildingView`'s own `THREE.Scene`. AR mode
 * needs the same geometry under the framework's scene root instead — that root
 * IS the GPS-world frame, so map-derived content belongs there in raw NUE with
 * nothing to pre-multiply (see the framework's `ar-scene-hierarchy.ts`, which
 * states this at the top because two readers previously concluded the
 * opposite).
 *
 * Moving it is one `add()` call, because three.js reparents rather than
 * copying. What is NOT free is knowing WHICH objects have to move: a future
 * edit that attaches AR-relevant content straight to `BuildingView`'s scene
 * leaves it behind, and the symptom is content missing in AR while every
 * desktop test stays green. Naming the subtree is what makes that answerable.
 *
 * **`BuildingView` cannot be unit-tested** — it constructs a
 * `THREE.WebGLRenderer` in its own constructor — so a seam left as an option on
 * that class would be a seam the unit suite cannot reach. Extracting it here is
 * what lets milestone 0 be proved rather than asserted.
 *
 * WHAT LIVES HERE, and the boundary is deliberate:
 *
 * - **In:** the drawn mesh layers, the res-13 cell mesh and its outlines, the
 *   underground diagnostic lines. These are the map-derived content AR renders.
 * - **Out:** lights, the ground plane, the sun rig, the route line and the NPC
 *   agent. AR supplies its own lighting from the framework's scene, hides the
 *   ground plane by design (plan §2.8), and does not list the NPC as AR
 *   content. Objects that stay behind stay behind ON PURPOSE.
 *
 * @see scene-content.ts.md
 */

import * as THREE from "three";

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
  attachTo(parent: THREE.Object3D): void {
    parent.add(this.root);
  }

  add(object: THREE.Object3D): void {
    this.root.add(object);
  }

  remove(object: THREE.Object3D): void {
    this.root.remove(object);
  }
}
