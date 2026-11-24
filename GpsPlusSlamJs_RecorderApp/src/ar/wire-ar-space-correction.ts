/**
 * The RecorderApp's AR-space content correction: after an ARCore
 * relocalization, the content placed before it moves back onto its physical
 * place. Built once for the live AR scene (`ar/wire-ar-scene.ts`) and once
 * per replay (`replay/replay-mode.ts`), so both share one code path.
 *
 * The relocalization feed records each observation into the store whether
 * this is on or off; the store derives the correction; this module only
 * applies it to scene objects, through the framework's content watcher:
 *
 * - `arContent`: a group under `arWorldGroup` whose children are corrected
 *   by themselves (the fused GPS markers go here);
 * - `onPlaced(object, capturedAt?)`: for content that stays under a
 *   framework node of `arWorldGroup` (the frame tiles and the QR debug axis
 *   and cube hang off their own WebXR basis nodes). Called after the
 *   object's raw pose was written; the pose is dated by `capturedAt` (the
 *   capture time of the data it came from, epoch-ms XR clock), or by now.
 *   Each call restarts the placement, so an object whose raw pose is
 *   rewritten every frame (the QR cube) is re-dated on each write.
 *
 * The watcher follows the store a new recording swaps in. The listeners,
 * the registry and `arContent` are imperative three.js state, outside the
 * store; the correction itself is read from the store's selectors only.
 *
 * Sidecar: `wire-ar-space-correction.ts.md`.
 */

import type * as THREE from 'three';
import { enableArSpaceCorrection } from 'gps-plus-slam-app-framework/ar/ar-content-watcher';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import type { StoreRef } from '../state/store-ref';
import type { RecorderStore } from '../state/recorder-store';

const log = createLogger('ArSpaceCorrection');

/** Report an object whose raw pose was just written (see the module doc). */
export type ArContentPlacedHook = (
  object: THREE.Object3D,
  capturedAt?: number
) => void;

export interface ArSpaceCorrectionWiring {
  /** Parent for self-correcting content; `null` when the correction is off. */
  readonly arContent: THREE.Group | null;
  /** `undefined` when the correction is off, so callers pass nothing on. */
  readonly onPlaced: ArContentPlacedHook | undefined;
  /** Stop correcting, follow no store, and remove `arContent`. Idempotent. */
  dispose(): void;
}

export interface WireArSpaceCorrectionDeps {
  /** The alignment-riding node whose local space is AR odometry (NUE). */
  readonly arWorldGroup: THREE.Object3D;
  /** Follows the store of each new recording; replay passes a fixed one. */
  readonly storeRef: StoreRef<RecorderStore>;
  /** `arSpaceCorrection.applyEnabled`, read once by the caller. */
  readonly enabled: boolean;
}

const OFF: ArSpaceCorrectionWiring = {
  arContent: null,
  onPlaced: undefined,
  dispose: () => {},
};

export function wireArSpaceCorrection({
  arWorldGroup,
  storeRef,
  enabled,
}: WireArSpaceCorrectionDeps): ArSpaceCorrectionWiring {
  if (!enabled) return OFF;
  let handle: ReturnType<typeof enableArSpaceCorrection>;
  try {
    handle = enableArSpaceCorrection({ store: storeRef.get(), arWorldGroup });
  } catch (error) {
    // Enter AR and replay go on uncorrected: content is still drawn, only
    // not moved after a relocalization.
    log.warn(`AR content correction not wired: ${String(error)}`);
    return OFF;
  }
  const { arContent, arCorrection } = handle;
  const unsubscribeSwap = storeRef.subscribe((next) => {
    arCorrection.attach(next);
  });

  let warned = false;
  const onPlaced: ArContentPlacedHook = (object, capturedAt) => {
    try {
      // Untrack first: the raw pose was just rewritten, so the old
      // placement's applied jumps no longer describe it.
      arCorrection.untrack(object);
      arCorrection.track(
        object,
        capturedAt === undefined ? {} : { capturedAt }
      );
    } catch (error) {
      // A tile or cube that cannot be corrected is still drawn; it is never
      // worth breaking the frame or store listener that placed it. Once per
      // wiring, because the QR cube is placed every frame.
      if (!warned) {
        warned = true;
        log.warn(`AR content not corrected: ${String(error)}`);
      }
    }
  };

  let disposed = false;
  return {
    arContent,
    onPlaced,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeSwap();
      arCorrection.dispose();
      arWorldGroup.remove(arContent);
    },
  };
}
