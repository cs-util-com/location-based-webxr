/**
 * The approach on the camera: one frame of the intro, the dive or the pin
 * flight placed on the lab's camera, and the field of view easing back to
 * the lab's `fovY` when the fly-in is interrupted while a variant has it
 * wider or narrower (round-5 plan 2026-10-01-0945 §3.1: no snap, and no
 * interim value left behind). Moved out of the globe lab as a pure
 * refactor (editor-on-the-full-globe plan, the approach slice).
 *
 * @see globe-approach-camera.ts.md
 */
import * as THREE from "three";

import { applyOrbitPose, smoothstep } from "./globe-camera.js";
import type { ApproachStep, GlobeApproach } from "./globe-approach.js";

/** How long the field of view takes to ease back to `fovY`, ms. */
export const FOV_RETURN_MS = 500;

/** One ease back: from, to, when it began, how long, the last frame it set. */
export interface FovEase {
  from: number;
  to: number;
  at: number;
  ms: number;
  lastFrameAt?: number;
}

/** The ease's field of view `elapsedMs` after it began. */
export function fovAt(r: FovEase, elapsedMs: number): number {
  return r.ms > 0 && elapsedMs < r.ms
    ? r.from + (r.to - r.from) * smoothstep(elapsedMs / r.ms)
    : r.to;
}

/** The camera parts the field of view's ease writes. */
interface FovCamera {
  fov: number;
  updateProjectionMatrix(): void;
}

/**
 * The ease back to `targetFov()` (read each frame, so a changed `fovY`
 * applies live). `step(now)` runs one frame of it if one is due; `clear()`
 * drops it (an orbit frame set the field of view itself); `at(fraction)`
 * reads the last ease for the `fovReturnAt` test hook.
 */
export function createFovReturn(
  camera: FovCamera,
  targetFov: () => number,
  ms = FOV_RETURN_MS,
) {
  let ease: FovEase | null = null;
  let last: FovEase | null = null;
  return {
    step(now: number) {
      if (camera.fov === targetFov()) {
        ease = null;
        return;
      }
      if (!ease) {
        ease = { from: camera.fov, to: targetFov(), at: now, ms };
        last = ease;
      }
      ease.to = targetFov();
      camera.fov = fovAt(ease, now - ease.at);
      ease.lastFrameAt = now;
      camera.updateProjectionMatrix();
      if (camera.fov === targetFov()) ease = null;
    },
    clear() {
      ease = null;
    },
    /**
     * The last ease, `{ from, to, ms, at, lastFrameAt, fov }`, `fov` being
     * what a frame sets `fraction` x `ms` after it began; null before any.
     * RangeError for a fraction that is not finite.
     */
    at(fraction: number) {
      if (!Number.isFinite(fraction))
        throw new RangeError(`fraction must be finite, got ${fraction}`);
      if (!last) return null;
      const { from, to, ms: lasting, at, lastFrameAt } = last;
      return {
        from,
        to,
        ms: lasting,
        at,
        lastFrameAt,
        fov: fovAt(last, fraction * lasting),
      };
    },
  };
}

export type FovReturn = ReturnType<typeof createFovReturn>;

/**
 * One frame of the approach on the camera: an orbit frame is placed at its
 * distance (the fitted one when null) and sets its field of view, ending
 * any ease; a placed frame (the dive, the pin flight) sets no field of
 * view, so one the fly-in left eases back. `placeCameraEcef` places the
 * camera from an ECEF pose (the world is not ECEF once the frame is at a
 * target). The caller then updates the camera's matrix and its controls.
 */
export function createApproachDrive({
  approach,
  camera,
  fovReturn,
  placeCameraEcef,
  fitDistance,
}: {
  approach: Pick<GlobeApproach, "pose" | "cameraPlaced">;
  camera: FovCamera;
  fovReturn: Pick<FovReturn, "step" | "clear">;
  placeCameraEcef: (
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
  ) => void;
  fitDistance: () => number;
}) {
  const scratch = new THREE.PerspectiveCamera();
  const placeOrbit = (step: Extract<ApproachStep, { pose: unknown }>) => {
    applyOrbitPose(scratch, step.pose, step.distanceM ?? fitDistance());
    placeCameraEcef(scratch.position, scratch.quaternion);
    approach.cameraPlaced(scratch.position.length());
    if (camera.fov !== step.fovDeg) {
      camera.fov = step.fovDeg;
      camera.updateProjectionMatrix();
    }
    fovReturn.clear();
  };
  return (now: number) => {
    const step = approach.pose(now);
    if ("pose" in step) {
      placeOrbit(step);
    } else {
      placeCameraEcef(step.position, step.quaternion);
      fovReturn.step(now);
    }
  };
}
