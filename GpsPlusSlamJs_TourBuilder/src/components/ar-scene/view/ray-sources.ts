/**
 * Ray production — the one genuine desktop/AR difference (plan A11).
 *
 * Component 1 already named this seam: "component 8 swaps the `pointerup`
 * raycast for the WebXR `select` ray, keeping the same callbacks." Both
 * implementations below produce the same thing — a nearest `Intersection` from a
 * target set — so everything downstream (the `userData` walk, the pick-target
 * policy, the story session) is identical in both modes.
 *
 * The tap-vs-drag gate belongs to the **pointer** path only. In an immersive
 * session `select` already IS the completed tap gesture; re-gating it on
 * distance and duration would drop legitimate selections.
 */

import type { Matrix4 } from "three";
import {
  Raycaster,
  type Camera,
  type Intersection,
  type Object3D,
} from "three";

import { createPointerTapPicker } from "../../shared/pointer-tap-picker.js";

export type RayHitListener = (hit: Intersection<Object3D>) => void;

export interface RaySource {
  dispose(): void;
}

/** Desktop / handheld-AR-preview: the shared tap-gated pointer picker. */
export function createPointerRaySource(options: {
  readonly domElement: HTMLElement;
  readonly camera: Camera;
  readonly getPickTargets: () => readonly Object3D[];
  readonly onHit: RayHitListener;
}): RaySource {
  return createPointerTapPicker({
    domElement: options.domElement,
    camera: options.camera,
    getPickTargets: options.getPickTargets,
    onTap: options.onHit,
  });
}

/** The minimum of the WebXR session surface this module uses. */
export interface XrSessionLike {
  addEventListener(
    type: "select",
    listener: (event: XrSelectEvent) => void,
  ): void;
  removeEventListener(
    type: "select",
    listener: (event: XrSelectEvent) => void,
  ): void;
}

export interface XrSelectEvent {
  readonly inputSource: { readonly targetRayMode?: string };
}

/** Resolves the controller/hand ray for the frame the `select` happened in. */
export type TargetRayMatrixSource = (event: XrSelectEvent) => Matrix4 | null;

/**
 * Immersive WebXR: raycast along the input source's target ray. The matrix is
 * injected rather than read from a global session/frame, so this stays testable
 * and the adapter keeps ownership of the XR plumbing.
 */
export function createXrSelectRaySource(options: {
  readonly session: XrSessionLike;
  readonly getTargetRayMatrix: TargetRayMatrixSource;
  readonly getPickTargets: () => readonly Object3D[];
  readonly onHit: RayHitListener;
}): RaySource {
  const raycaster = new Raycaster();

  const onSelect = (event: XrSelectEvent): void => {
    const matrix = options.getTargetRayMatrix(event);
    if (matrix === null) return;
    raycaster.ray.origin.setFromMatrixPosition(matrix);
    raycaster.ray.direction
      .set(0, 0, -1) // XR target rays point down -Z in their own space
      .transformDirection(matrix)
      .normalize();

    const targets = options.getPickTargets();
    if (targets.length === 0) return;
    const hits = raycaster.intersectObjects([...targets], true);
    const nearest = hits[0];
    if (nearest !== undefined) options.onHit(nearest);
  };

  options.session.addEventListener("select", onSelect);
  return {
    dispose(): void {
      options.session.removeEventListener("select", onSelect);
    },
  };
}
