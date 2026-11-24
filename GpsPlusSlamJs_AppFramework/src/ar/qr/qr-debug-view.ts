/**
 * QR debug view — the shared 3D "is it glued to the code?" overlay: a 3D axis at
 * the solved QR pose plus a semi-transparent cube sized to the QR so its front
 * face lands on the printed corners. Both are parented under `arWorldGroup` so
 * they ride the alignment / transform chain exactly like real content.
 *
 * Promoted to the framework (recorder live-QR WS-5) as the **shared consumer**
 * view: both the QR-tracking demo and the GPS Recorder render this same overlay
 * off the derived pose (`qr-derived-pose.ts` / `selectSolvedQrPose`). The view is
 * pure three.js — it knows nothing about who solved the pose, so it runs
 * identically live and on replay.
 *
 * Persistence across detection misses: `update()` is called on every lock;
 * `clear()` is NOT called on a miss, so the objects keep their last pose and
 * never flicker between throttled detections. They stay hidden until the first
 * `update()`.
 *
 * Coordinate space (IMPORTANT): the QR pose is in **raw WebXR** space (the
 * corners are depth-unprojected with the raw WebXR camera pose), but the
 * injected `parent` (`arWorldGroup`) local space is **NUE**. So the objects must
 * ride the SAME {@link WEBXR_TO_NUE} basis the camera does (`arWorldGroup →
 * basisChangeNode → arpose → camera`). We mirror that by hanging them off an
 * internal basis node carrying `WEBXR_TO_NUE`; parenting them directly under
 * `arWorldGroup` would leave them East/North axis-swapped and they would NOT
 * line up with the camera/QR on a real device (the recurring scene-frame bug —
 * see the frame-tile / occupancy-cube / hit-test-reticle precedents). We never
 * touch the camera; WebXR owns its pose.
 *
 * @see qr-derived-pose.ts — derives the `Pose` this view renders (size + PnP).
 * @see webxr-nue-basis.ts — the `WEBXR_TO_NUE` basis the objects ride.
 */

import { AxesHelper, BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import type { Object3D } from 'three';
import type { Pose } from './qr-pose.js';
import { WEBXR_TO_NUE } from '../webxr-nue-basis.js';

/** A thin slab so the cube's front face sits on the printed code (1 cm deep). */
const CUBE_DEPTH_M = 0.01;

export interface QrDebugView {
  /**
   * Glue the debug objects to a solved pose. The **axis** is placed from the
   * pose alone (it needs no size). The **cube** models the QR's physical extent,
   * so it is shown only when a measured `sizeM` is available; pass `null` to show
   * the axis while keeping the cube hidden.
   *
   * The derive-on-read consumer only solves a pose once a size exists (PnP needs
   * a metric size), so in practice `sizeM` is non-null; the `null` path is
   * retained for the generic "pose but no size" case (e.g. a future
   * depth-position/PnP-rotation hybrid).
   */
  update(pose: Pose, sizeM: number | null, capturedAt?: number): void;
  /** Hide the objects (e.g. on reset); does NOT detach them from the scene. */
  clear(): void;
  /** Remove the objects from the parent and free GPU resources. */
  dispose(): void;
}

export interface QrDebugViewOptions {
  /**
   * Called after `update()` wrote an object's pose, when the update named
   * the capture time of the observation the pose was solved from. An app
   * that corrects AR content after a relocalization re-dates the object
   * here, because each update rewrites the raw pose from scratch.
   */
  readonly onPlaced?: (object: Object3D, capturedAt: number) => void;
}

/**
 * Create the debug axis + cube under `parent` (the `arWorldGroup`). Objects
 * start hidden; the first `update()` reveals and positions them.
 */
export function createQrDebugView(
  parent: Object3D,
  options: QrDebugViewOptions = {}
): QrDebugView {
  const { onPlaced } = options;
  // Static basis node carrying WEBXR_TO_NUE (matrixAutoUpdate=false so Three.js
  // never recomputes it from position/quaternion/scale). The debug objects hang
  // off it, so their world pose = parent × WEBXR_TO_NUE × pose — the camera's
  // chain. Mirrors webxr-session's `basisChangeNode`.
  const basis = new Group();
  basis.name = 'qr-debug-basis';
  basis.matrix.copy(WEBXR_TO_NUE);
  basis.matrixAutoUpdate = false;
  parent.add(basis);

  const axes = new AxesHelper(0.15);
  axes.visible = false;

  const cubeMaterial = new MeshBasicMaterial({
    color: 0x33ddff,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const cube = new Mesh(new BoxGeometry(1, 1, 1), cubeMaterial);
  cube.visible = false;

  basis.add(axes);
  basis.add(cube);

  function applyPose(object: Object3D, pose: Pose): void {
    object.position.set(pose.position[0], pose.position[1], pose.position[2]);
    object.quaternion.set(
      pose.rotation[0],
      pose.rotation[1],
      pose.rotation[2],
      pose.rotation[3]
    );
  }

  return {
    update(pose: Pose, sizeM: number | null, capturedAt?: number): void {
      // The axis needs only the pose — show it as soon as a detection locks.
      applyPose(axes, pose);
      axes.visible = true;
      if (capturedAt !== undefined) onPlaced?.(axes, capturedAt);

      // The cube needs a measured size (its front face must land on the printed
      // corners). Until one is available, keep it hidden rather than drawing a
      // wrong/NaN-sized box — the axis alone already proves the QR is glued.
      if (sizeM === null) {
        cube.visible = false;
        return;
      }
      applyPose(cube, pose);
      // Front face on the printed code: span sizeM in-plane, thin in depth, and
      // push the slab back by half its depth so the +z face sits at the code.
      cube.scale.set(sizeM, sizeM, CUBE_DEPTH_M);
      cube.translateZ(-CUBE_DEPTH_M / 2);
      cube.visible = true;
      if (capturedAt !== undefined) onPlaced?.(cube, capturedAt);
    },
    clear(): void {
      axes.visible = false;
      cube.visible = false;
    },
    dispose(): void {
      // Detach the whole basis subtree (axis + cube ride it) from the parent.
      parent.remove(basis);
      axes.dispose();
      cube.geometry.dispose();
      cubeMaterial.dispose();
    },
  };
}
