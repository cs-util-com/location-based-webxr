/**
 * Tap-vs-drag-gated raycast picking, shared by every component whose desktop
 * interaction is "click a mesh, get the hit" (component 1's billboard,
 * component 2's in-world text). The tap-vs-drag decision itself is the pure
 * `isTap` gate in `tap-gate.ts`; component 8 swaps this `pointerup`-raycast for
 * the WebXR `select` ray while keeping the same downstream hit handling.
 *
 * Multi-touch safe: only one pointer is tracked as a potential tap, identified
 * by `pointerId`. A second concurrent `pointerdown` (a pinch/rotate gesture) or
 * a `pointercancel` invalidates the gesture, so a finger lifting mid-pinch can
 * never fire a phantom tap against the wrong down-coordinates.
 *
 * Owns the raycast mechanics only — interpreting the hit's `userData` (which
 * mesh, which role) is each component's own concern via `onTap`.
 */
import {
  Raycaster,
  Vector2,
  type Camera,
  type Intersection,
  type Object3D,
} from 'three';

import { isTap, type PointerSample } from './tap-gate.js';

/** The raycast target set every `*-interaction.ts` wrapper also takes. */
export interface PointerTapPickerTargetOptions {
  readonly domElement: HTMLElement;
  readonly camera: Camera;
  readonly getPickTargets: () => readonly Object3D[];
}

export function createPointerTapPicker(
  options: PointerTapPickerTargetOptions & {
    readonly onTap: (hit: Intersection<Object3D>) => void;
  }
): { dispose(): void } {
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  // The single pointer currently tracked as a potential tap; null while idle
  // or after the gesture was invalidated (second finger / cancel).
  let pending: {
    readonly pointerId: number;
    readonly down: PointerSample;
  } | null = null;

  const sample = (event: PointerEvent): PointerSample => ({
    x: event.clientX,
    y: event.clientY,
    timeMs: performance.now(),
  });

  const onPointerDown = (event: PointerEvent): void => {
    // A second finger while one is tracked = pinch/rotate, not a tap — drop
    // the whole gesture rather than re-basing on the new finger.
    pending =
      pending === null
        ? { pointerId: event.pointerId, down: sample(event) }
        : null;
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (pending === null || pending.pointerId !== event.pointerId) {
      return;
    }
    const { down } = pending;
    pending = null;
    if (isTap(down, sample(event))) {
      pick(event);
    }
  };

  const onPointerCancel = (event: PointerEvent): void => {
    if (pending !== null && pending.pointerId === event.pointerId) {
      pending = null;
    }
  };

  function pick(event: PointerEvent): void {
    const rect = options.domElement.getBoundingClientRect();
    ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, options.camera);

    const hit = raycaster.intersectObjects(
      options.getPickTargets() as Object3D[],
      false
    )[0];
    if (hit !== undefined) {
      options.onTap(hit);
    }
  }

  options.domElement.addEventListener('pointerdown', onPointerDown);
  options.domElement.addEventListener('pointerup', onPointerUp);
  options.domElement.addEventListener('pointercancel', onPointerCancel);

  return {
    dispose(): void {
      options.domElement.removeEventListener('pointerdown', onPointerDown);
      options.domElement.removeEventListener('pointerup', onPointerUp);
      options.domElement.removeEventListener('pointercancel', onPointerCancel);
    },
  };
}
