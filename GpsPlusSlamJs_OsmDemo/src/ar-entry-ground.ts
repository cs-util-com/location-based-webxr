import * as THREE from "three";

import { cameraFadeAlpha, type DescentInput } from "./ar-descent.js";

/**
 * The ground plane the AR entry falls towards, and fades away (r543).
 *
 * "Dass ich den Ground sehe, wenn die Open Street Map Welt weit unter mir
 * spawnt und der dann rausgefadet wird, während die auf mich zufliegt."
 *
 * **AR HAS NEVER DRAWN A GROUND AT ALL, and the field report is the first thing
 * to need one.** The terrain plane belongs to the desktop 3D view; the AR scene
 * gets buildings and nothing under them, because the real world is the floor.
 * That is right for a settled session and wrong for the entry, where the city
 * starts ~60 m below the user: a descent with no floor has nothing to be
 * measured against and reads as objects drifting rather than as the ground
 * rising.
 *
 * **IT MUST NOT SURVIVE THE ENTRY.** An opaque plane left in an AR scene is a
 * lid over the passthrough — the worst outcome available here, and strictly
 * worse than having no ground at all. Every design choice below follows from
 * that: the opacity is driven from the same clock as the descent, it reaches
 * exactly 0 on landing, and the caller disposes the mesh at the same moment it
 * clears the camera fade.
 *
 * @see ar-entry-ground.ts.md
 */

/**
 * Half-width of the plane, metres.
 *
 * Big enough to read as ground from ~60 m up and to reach past the buildings
 * the descent is falling towards; well inside the AR camera's 1000 m far plane
 * so it cannot be clipped mid-fade, which would read as the ground tearing.
 */
export const ENTRY_GROUND_EXTENT_M = 400;

/**
 * The 3D view's ground colour, so the two views do not disagree about what
 * ground looks like. Kept as a literal rather than imported from
 * `building-view.ts`: that module pulls in the whole desktop scene, and this one
 * is loaded inside an XR session.
 *
 * NOT EXPORTED. It was, and the workspace dead-code check caught it: nothing
 * outside this module reads it, and the obvious consumer -- a test asserting it
 * matches the desktop ground -- cannot exist, because `building-view.ts` sets
 * that colour inline in a material rather than exporting it. An export with no
 * reader is a claim of an API that is not one.
 */
const ENTRY_GROUND_COLOUR = 0x6b7280;

/**
 * How opaque the entry ground is, `[0,1]`.
 *
 * **The exact inverse of the camera fade, and derived from it rather than
 * re-implemented.** The two are one visual event: the camera comes in as the
 * ground goes out, so a second curve here could only ever drift from the first.
 * `cameraFadeAlpha` already collapses every degenerate input to "fully visible
 * camera", which becomes "no ground" here — the safe direction, since the
 * failure mode worth designing against is a plane that outlives the entry.
 */
export function entryGroundOpacity(input: DescentInput): number {
  return 1 - cameraFadeAlpha(input);
}

export interface ArEntryGround {
  /** The mesh, for the caller to add to the AR scene root. */
  readonly mesh: THREE.Mesh;
  /** Place the plane at the city's current ground height, metres up. */
  setHeightM(upM: number): void;
  /** Fade it, `[0,1]`. Values outside the range are clamped. */
  setOpacity(opacity: number): void;
  /** Remove it from its parent and free its GPU resources. */
  dispose(): void;
}

/**
 * Build the entry ground.
 *
 * **`MeshBasicMaterial`, not `MeshStandardMaterial`**, unlike the desktop
 * ground: a lit material here would depend on the framework's lights being
 * present and correctly oriented, and `ar-scene-environment.ts` records what
 * happens when an AR material's lighting assumptions turn out to be wrong —
 * every affected shader silently fails to compile and the geometry vanishes
 * with no error. An unlit plane cannot fail that way, and it is being faded to
 * nothing over six seconds, so shading buys nothing.
 *
 * **`depthWrite: false`.** A transparent plane that writes depth punches a hole
 * in everything drawn after it, so the city would disappear wherever the ground
 * covers it.
 *
 * **AND IT CANNOT OCCLUDE ANYTHING, which an earlier version of this comment
 * claimed it could.** It said buildings below the plane stay hidden by it. They
 * do not: `ar-building-material.ts` renders the city with
 * `AdditiveBlending` and `depthWrite: false`, so NOTHING in the AR scene writes
 * depth at all. The buffer is empty, every depth test passes, and buildings
 * under the plane are additively painted THROUGH it. Caught in cold review.
 *
 * So what this plane actually is, stated correctly: a tinted backdrop that gives
 * the descent something to read motion against, not an occluder. That is enough
 * for what it was asked to do, but the next change should not assume otherwise.
 */
export function createArEntryGround(): ArEntryGround {
  const geometry = new THREE.PlaneGeometry(
    ENTRY_GROUND_EXTENT_M * 2,
    ENTRY_GROUND_EXTENT_M * 2,
  );
  // FLAT, not vertical. `PlaneGeometry` is authored in XY; the scene root is
  // NUE, so -90 degrees about X lays it into the North/East plane with its
  // normal along Up.
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    color: ENTRY_GROUND_COLOUR,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    // VISIBLE FROM BELOW TOO. The entry starts with the user above it, but an
    // interrupted descent or a manual nudge can leave them under it, and a
    // single-sided plane simply disappears from there -- which reads as the
    // ground having failed rather than as the user being below it.
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  // BEFORE THE CITY. Transparent objects are drawn back-to-front by distance,
  // and a plane the size of this one has a centre that can sort in front of
  // buildings standing on it. An explicit order is cheaper than relying on that.
  mesh.renderOrder = -1;

  return {
    mesh,
    setHeightM(upM: number): void {
      // NON-FINITE COLLAPSES TO 0, like every other value on this axis: a NaN
      // position removes the mesh from view with no error raised, which would
      // read as "the ground fade is broken" and is indistinguishable from the
      // half-dozen other causes this repo has already chased once.
      mesh.position.y = Number.isFinite(upM) ? upM : 0;
    },
    setOpacity(opacity: number): void {
      const safe = Number.isFinite(opacity)
        ? Math.min(1, Math.max(0, opacity))
        : 0;
      material.opacity = safe;
      // HIDDEN AT ZERO rather than merely fully transparent: a transparent mesh
      // is still submitted, still sorted and still blended every frame, and this
      // one covers the screen.
      mesh.visible = safe > 0;
    },
    dispose(): void {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
