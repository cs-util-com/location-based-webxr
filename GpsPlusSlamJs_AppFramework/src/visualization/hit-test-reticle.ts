/**
 * Hit-test reticle — the small, deterministic "reticle view-model" shared by
 * the framework's example/starter apps.
 *
 * A faithful port of the reticle from the stock three.js `webxr_ar_hittest`
 * example: a flat ring laid on whatever real-world surface the WebXR
 * `hit-test` API reports under the screen centre. The framework delta is
 * *where* the mesh is parented and *which frame the hit pose is in*: apps add
 * the mesh under `getArWorldGroup()` (NUE local space) rather than the
 * GPS-aligned scene root, so the reticle rides the same lerped `arWorldGroup`
 * alignment as the camera — but the WebXR hit pose arrives in the WebXR
 * reference space, so `updateReticle` applies the `WEBXR_TO_NUE` basis change
 * to it (see that function for the full rationale).
 *
 * The per-frame XR plumbing (requesting the hit-test source, reading
 * `frame.getHitTestResults(...)`) lives in the framework's shared driver,
 * `ar/hit-test-reticle-driver.ts` (`startHitTestReticle`), promoted 2026-07-18
 * from the app-local copies. The two functions here are the unit-tested core:
 * given the latest hit pose (a column-major 4x4 transform matrix) or `null`,
 * drive the mesh's visibility + transform. They are unit tested because that is
 * the logic a porting developer is most likely to get subtly wrong (e.g.
 * forgetting the basis change so the reticle drifts off-centre, forgetting to
 * hide the reticle when no surface is found, or letting Three.js overwrite the
 * matrix).
 */
import {
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  RingGeometry,
} from 'three';
import { WEBXR_TO_NUE } from '../ar/webxr-nue-basis.js';

/** A column-major 4x4 transform, as produced by `XRPose.transform.matrix`. */
export type HitMatrix = Float32Array | number[];

// Per-frame scratch matrix reused across `updateReticle` calls to avoid
// allocating a fresh `Matrix4` every animation frame.
const hitPoseMatrix = /* @__PURE__ */ new Matrix4();

/**
 * Build the reticle mesh: a thin ring oriented flat (rotated to lie in the
 * XZ plane) so it reads as a marker on the ground/wall.
 *
 * `matrixAutoUpdate` is disabled because the reticle's world transform is
 * written wholesale from the hit-test pose every frame; letting Three.js
 * recompose it from position/quaternion/scale would discard that pose.
 *
 * The mesh starts hidden (`visible = false`) — there is no surface yet.
 */
export function createReticleMesh(): Mesh {
  const reticle = new Mesh(
    new RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ color: 0x4f8cff })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  return reticle;
}

/**
 * Apply the latest hit-test pose to the reticle.
 *
 * - When `matrix` is a 16-element transform, the reticle adopts it (after the
 *   WebXR→NUE basis change, see below) and becomes visible.
 * - When `matrix` is `null` (no surface under the screen centre, or the
 *   hit-test source is not ready yet), the reticle is hidden.
 *
 * Frame handling — the part a porting developer must not get wrong. The
 * hit-test pose is expressed in the **WebXR reference space** (`X=East, Y=Up,
 * Z=South`), the same frame as the live camera pose. The reticle, however, is
 * parented under `getArWorldGroup()`, whose local space is **NUE** (`X=North,
 * Y=Up, Z=East`) — the camera reaches that frame through the static
 * `basisChangeNode` that holds `WEBXR_TO_NUE`. The reticle has no such
 * intermediate node, so we apply the same basis change here:
 * `reticle.matrix = WEBXR_TO_NUE · hitPose`. The reticle's resulting world pose
 * is then `arWorldGroup.matrix · WEBXR_TO_NUE · hitPose` — identical to the
 * transform chain the camera rides, so it stays pinned under the screen centre.
 *
 * Without the basis change the WebXR coordinates were interpreted as NUE: the
 * Up axis matched (both are Y) but East/North were swapped, so the reticle
 * drifted sideways instead of tracking the screen centre.
 *
 * Works on any `Object3D` (not just the mesh from `createReticleMesh`) so it can
 * be unit tested without a WebGL context.
 */
export function updateReticle(
  reticle: Object3D,
  matrix: HitMatrix | null
): void {
  if (matrix === null) {
    reticle.visible = false;
    return;
  }
  hitPoseMatrix.fromArray(matrix);
  // arWorldGroup-local (NUE) = WEBXR_TO_NUE · hitPose (WebXR reference space).
  reticle.matrix.multiplyMatrices(WEBXR_TO_NUE, hitPoseMatrix);
  // matrixAutoUpdate is false (see createReticleMesh), so a manual local-matrix
  // write does NOT mark the world matrix dirty by itself. Without this flag the
  // render-time `updateMatrixWorld(force=false)` reuses a stale `matrixWorld`
  // whenever the parent (arWorldGroup) didn't change that frame — which it
  // doesn't between ~1 Hz GPS alignment updates — so the reticle would render
  // frozen at its previous surface despite a fresh pose each frame.
  reticle.matrixWorldNeedsUpdate = true;
  reticle.visible = true;
}
