/**
 * `enableArWorldGroupAlignment` — wire the store's alignment matrix to a
 * smoothly-lerped `arWorldGroup.matrix`, as a single framework-default call.
 *
 * Why this exists: `arWorldGroup` is the AR-odometry node that the camera and
 * every GPS anchor live under. Applying the GPS+VIO alignment to its matrix is
 * what GPS-registers the *view* — the camera and all anchored content shift
 * together as the alignment refines, so anchors stay stable in the AR overlay
 * and only ever have to correct a small residual when they re-register. The
 * recorder already wires this by hand (its own `createAlignmentLerper` driven
 * from the frame loop); the two simpler apps never did, leaving the camera
 * pure-VIO and forcing each anchor to absorb the full alignment delta. This
 * helper folds the lerper + store subscription + frame-loop drive into one
 * call so no app can forget it.
 *
 * Refinements ease; corrections land at once. A change of T that moves the
 * AR camera's group-local position (the group's origin when it has no
 * camera child) by more than {@link CORRECTION_STEP_M}, or the first change
 * within {@link EPOCH_SNAP_S} of a frame-epoch change, is applied exactly in
 * the frame it is read, so the world is never seen sliding through the poses
 * between two frames of reference. Smaller re-solves of a converging
 * alignment keep the lerper's ease (about 0.3 s), so noise in them does not
 * become a per-fix jitter.
 *
 * See
 * `gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-05-0650-gps-anchor-frame-architecture-bug-and-plan.md`
 * (Slice 2 / Bug A) and the colocated sidecar.
 */
import * as THREE from 'three';
import { createAlignmentLerper } from './alignment-lerper.js';
import { registerFrameUpdate } from '../ar/frame-loop.js';
import { registerSessionDisposer } from '../ar/session-disposers.js';
import type { SubscribableStore } from '../state/subscribe-to-selector.js';
import {
  createArParentTarget,
  devWorldJumpFromPage,
  registerArParentBinding,
  type ArParentBinding,
} from '../ar/ar-parent-target.js';

/** A T step at the camera above this many metres is a correction (snaps). */
const CORRECTION_STEP_M = 1;
/** Seconds after a frame-epoch change in which the next T change snaps. */
const EPOCH_SNAP_S = 2;

const _probe = new THREE.Vector3();
const _before = new THREE.Vector3();

/**
 * The point whose motion decides a correction: the first camera child's
 * group-local position (WebXR keeps `position` in step with the pose), else
 * the origin.
 */
function correctionProbe(
  group: THREE.Object3D,
  out: THREE.Vector3
): THREE.Vector3 {
  for (const child of group.children) {
    if ((child as THREE.Camera).isCamera === true)
      return out.copy(child.position);
  }
  return out.set(0, 0, 0);
}

/** How far T moves `probe` (group-local) in the parent frame, previous to next. */
function stepAt(
  previous: THREE.Matrix4,
  next: THREE.Matrix4,
  probe: THREE.Vector3
): number {
  _before.copy(probe).applyMatrix4(previous);
  return probe.applyMatrix4(next).distanceTo(_before);
}

export interface ArWorldGroupAlignmentOptions {
  /** The store whose alignment selector drives the lerper. */
  readonly store: SubscribableStore;
  /** The AR world group whose `.matrix` is lerped toward each alignment. */
  readonly arWorldGroup: THREE.Object3D;
  /**
   * Lerp speed multiplier forwarded to {@link createAlignmentLerper}
   * (default matches the lerper's own `DEFAULT_LERP_RATE`).
   */
  readonly lerpRate?: number;
}

export interface ArWorldGroupAlignmentHandle {
  /** Stop the subscription and the per-frame update. */
  dispose(): void;
}

/**
 * Begin applying the store's (lerped) alignment to `arWorldGroup`. Returns a
 * handle whose `dispose()` removes both the store subscription and the
 * per-frame update.
 *
 * Disposal is tied to the AR session lifecycle: the binding registers itself
 * with the session-disposer registry that `resetWebXRState()` flushes on
 * teardown, so a caller can `enableArWorldGroupAlignment(...)` once and never
 * hold the handle — the binding cannot outlive the session (which is what two
 * apps independently leaked: the store subscription survives a teardown because
 * `clearFrameUpdates` only drops the per-frame tick). Because `initAR()` throws
 * while a prior session is live, every restart passes through that flush. The
 * handle is still returned for callers that want to stop alignment mid-session,
 * and is idempotent + self-deregistering so a manual `dispose()` and the
 * teardown flush never double-run. See
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-08-2149-arworldgroup-alignment-session-scoped-disposal.md.
 *
 * Double-drive is still the caller's concern: the recorder owns its own lerper
 * and must NOT also call this (it would double-lerp the same group). It does not
 * call this helper, so flushing the registry on teardown never affects it.
 */
export function enableArWorldGroupAlignment(
  options: ArWorldGroupAlignmentOptions
): ArWorldGroupAlignmentHandle {
  const lerper = createAlignmentLerper(options.arWorldGroup, options.lerpRate);

  // T (the store's alignment, plus the development-only synthetic jump) is
  // composed ONCE, in the parent target, and both the lerper and the deferred
  // anchors under this group read it: two readers composing it separately
  // could disagree, and content would then carry the alignment twice.
  const target = createArParentTarget(options.store, {
    devJump: devWorldJumpFromPage(),
  });
  // Adopt an alignment that is already present when we enable: an app that
  // enables after the first fix registers the view on its first frame.
  // Changes are read once per frame (by version), in the frame step, where
  // the correction rule can see the epoch and the camera.
  const appliedT = new THREE.Matrix4();
  const targetArray: number[] = new Array<number>(16).fill(0);
  let appliedVersion = target.version();
  if (appliedVersion > 0) {
    appliedT.copy(target.target());
    lerper.setTarget(appliedT.toArray(targetArray));
  }
  let lastEpoch = target.frameEpoch();
  let snapUntilS = Number.NEGATIVE_INFINITY;

  /** Hand a changed T to the lerper, instantly when it is a correction. */
  const adoptChangedTarget = (elapsedS: number): void => {
    const version = target.version();
    if (version === appliedVersion) return;
    const next = target.target();
    let instant =
      appliedVersion > 0 &&
      stepAt(appliedT, next, correctionProbe(options.arWorldGroup, _probe)) >
        CORRECTION_STEP_M;
    if (elapsedS <= snapUntilS) {
      instant = true;
      snapUntilS = Number.NEGATIVE_INFINITY;
    }
    appliedVersion = version;
    appliedT.copy(next);
    lerper.setTarget(appliedT.toArray(targetArray), { instant });
  };

  // The group's anchor set (if any) runs its pass in this same callback,
  // right after the lerp step, so it reads this frame's lerped matrix.
  let pass: ((dt: number, elapsedS: number) => void) | null = null;
  const disposeListeners = new Set<() => void>();
  const step = (dt: number, elapsedS: number): void => {
    target.tick(elapsedS);
    const epoch = target.frameEpoch();
    if (epoch !== lastEpoch) {
      lastEpoch = epoch;
      snapUntilS = elapsedS + EPOCH_SNAP_S;
    }
    adoptChangedTarget(elapsedS);
    lerper.update(dt);
  };
  const binding: ArParentBinding = {
    group: options.arWorldGroup,
    target,
    step,
    attachPass(fn) {
      pass = fn;
      return () => {
        if (pass === fn) pass = null;
      };
    },
    onDispose(listener) {
      disposeListeners.add(listener);
      return () => {
        disposeListeners.delete(listener);
      };
    },
  };
  const unregisterBinding = registerArParentBinding(binding);

  const unregister = registerFrameUpdate((dt, elapsed) => {
    step(dt, elapsed);
    pass?.(dt, elapsed);
  });

  let disposed = false;
  const handle: ArWorldGroupAlignmentHandle = {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unregister();
      unregisterBinding();
      target.dispose();
      lerper.dispose();
      // An anchor set driven by this binding goes back to its own tick.
      for (const listener of [...disposeListeners]) listener();
      disposeListeners.clear();
      // Remove ourselves from the session registry so the teardown flush won't
      // re-run this (and so an early manual dispose doesn't leave a dead entry).
      deregisterSessionDisposer();
    },
  };

  // Auto-dispose on session teardown so callers never have to hold the handle.
  const deregisterSessionDisposer = registerSessionDisposer(() =>
    handle.dispose()
  );

  return handle;
}
