/**
 * The target transform of an AR world group (T: odometry NUE -> GPS-world
 * NUE), read from the store once for everything that needs it: the binding
 * that sets the group to T, and the deferred anchors that re-place their
 * content to T^-1. Composing T in one place is what keeps the two from ever
 * disagreeing (content would otherwise carry the alignment twice).
 *
 * Besides T it answers the anchors' other questions about the session:
 * - the odometry frame epoch (`state.qrDetected.frameEpoch`, read
 *   structurally, 0 when the app has no such slice);
 * - whether the alignment is mature (`isMatureAlignment` over the session's
 *   GPS extent of device fixes), sticky once reached;
 * - seconds since the session's first frame.
 *
 * In development builds only, `?devWorldJumpM=<m>` and/or
 * `?devWorldJumpDeg=<deg>` add a synthetic world jump to T every 10 s
 * (north by m metres, a yaw by deg degrees), so a tester can watch content
 * hold through a jump. Also in development builds only, `?anchors=0`
 * turns the anchor deferral off (`defersAnchors` false): every correction
 * lands on the anchors at once, for a frame-time comparison with it on.
 * Production builds drop both readers entirely
 * (`ar-parent-target.build.test.ts`).
 *
 * Internal: no package entry, reached through `enableArWorldGroupAlignment`
 * and the binding registry below. Sidecar: `ar-parent-target.ts.md`.
 */

import * as THREE from 'three';
import {
  selectAlignmentMatrix,
  selectGpsPositions,
  selectZeroReference,
} from '../state/app-selectors';
import { isMatureAlignment } from '../state/alignment-maturity';
import { createGpsExtentTracker } from '../state/gps-extent-tracker';
import type { SubscribableStore } from '../state/subscribe-to-selector';

/** Seconds between two synthetic dev jumps. */
export const DEV_WORLD_JUMP_PERIOD_S = 10;

/** A synthetic world jump step (development builds only). */
export interface DevWorldJump {
  /** Metres north per jump. */
  readonly metres: number;
  /** Yaw degrees per jump (about the up axis). */
  readonly degrees: number;
  /** Seconds between jumps; the first lands one period after the first tick. */
  readonly periodS: number;
}

export interface ArParentTarget {
  /** T, column-major. Identity before the first alignment. Do not mutate. */
  target(): THREE.Matrix4;
  /** Changes whenever {@link target} does. */
  version(): number;
  /** The odometry frame epoch, 0 without a `qrDetected` slice. */
  frameEpoch(): number;
  /** Whether the session's alignment is mature; sticky once true. */
  isMature(): boolean;
  /** False when the anchors under this target follow every change at once (`?anchors=0`, development builds only). */
  readonly defersAnchors: boolean;
  /** Seconds since the first {@link tick} (the session's first frame), or since this was first asked. */
  sessionElapsedS(elapsedS: number): number;
  /** Start the session clock on the first call; advance the dev jump clock. */
  tick(elapsedS: number): void;
  /** Stop listening to the store. Reads still work (from `getState`). */
  dispose(): void;
}

export interface ArParentTargetOptions {
  /** A synthetic jump; tests pass it, apps get it from {@link devWorldJumpFromPage}. */
  readonly devJump?: DevWorldJump | null;
  /** False turns the anchor deferral off; apps get it from {@link anchorDeferralFromPage}. Default true. */
  readonly deferAnchors?: boolean;
}

interface StateWithEpoch {
  readonly qrDetected?: { readonly frameEpoch?: unknown } | null;
}

/** Read T's parts from the store and keep them current. */
export function createArParentTarget(
  store: SubscribableStore,
  options: ArParentTargetOptions = {}
): ArParentTarget {
  if (!store || typeof store.getState !== 'function') {
    throw new TypeError('createArParentTarget: store must have getState');
  }
  const devJump = validDevJump(options.devJump ?? null);
  const alignment = new THREE.Matrix4();
  const jump = new THREE.Matrix4();
  const composed = new THREE.Matrix4();
  let lastAlignment: unknown = undefined;
  let jumps = 0;
  let firstTickS: number | null = null;
  let version = 0;
  let mature = false;
  let startS: number | null = null;
  const extent = createGpsExtentTracker();

  function recompose(): void {
    composed.multiplyMatrices(jump, alignment);
    version += 1;
  }

  /** Re-read the alignment; true when it changed. */
  function refresh(): boolean {
    const matrix = selectAlignmentMatrix(store.getState());
    if (matrix === lastAlignment) return false;
    lastAlignment = matrix;
    if (matrix === null || matrix === undefined) return false;
    if (!isFiniteMatrix(matrix)) return false;
    alignment.fromArray(matrix);
    recompose();
    return true;
  }

  refresh();
  const unsubscribe =
    typeof store.subscribe === 'function'
      ? store.subscribe(() => {
          refresh();
        })
      : () => undefined;

  return {
    defersAnchors: options.deferAnchors !== false,
    target() {
      refresh();
      return composed;
    },
    version() {
      refresh();
      return version;
    },
    frameEpoch() {
      const epoch = (store.getState() as StateWithEpoch).qrDetected?.frameEpoch;
      return typeof epoch === 'number' && Number.isFinite(epoch) ? epoch : 0;
    },
    isMature() {
      if (mature) return true;
      const state = store.getState();
      const gpsExtentM = extent.update(selectGpsPositions(state));
      mature = isMatureAlignment({
        alignmentMatrix: selectAlignmentMatrix(state),
        zero: selectZeroReference(state),
        gpsExtentM,
      });
      return mature;
    },
    sessionElapsedS(elapsedS) {
      if (!Number.isFinite(elapsedS)) return 0;
      if (startS === null) startS = elapsedS;
      return Math.max(0, elapsedS - startS);
    },
    tick(elapsedS) {
      if (!Number.isFinite(elapsedS)) return;
      // The binding ticks from the session's first frame, so the session
      // clock starts there even when the first anchor comes later.
      if (startS === null) startS = elapsedS;
      if (devJump === null) return;
      if (firstTickS === null) firstTickS = elapsedS;
      const due = Math.floor((elapsedS - firstTickS) / devJump.periodS);
      if (due <= jumps) return;
      jumps = due;
      jump.multiplyMatrices(
        new THREE.Matrix4().makeTranslation(devJump.metres * jumps, 0, 0),
        new THREE.Matrix4().makeRotationY(
          THREE.MathUtils.degToRad(devJump.degrees * jumps)
        )
      );
      recompose();
    },
    dispose() {
      unsubscribe();
    },
  };
}

function isFiniteMatrix(matrix: unknown): boolean {
  if (matrix === null || typeof matrix !== 'object') return false;
  const m = matrix as ArrayLike<unknown>;
  if (m.length !== 16) return false;
  for (let i = 0; i < 16; i += 1) {
    if (typeof m[i] !== 'number' || !Number.isFinite(m[i])) return false;
  }
  return true;
}

function validDevJump(jump: DevWorldJump | null): DevWorldJump | null {
  if (jump === null) return null;
  const { metres, degrees, periodS } = jump;
  if (
    !Number.isFinite(metres) ||
    !Number.isFinite(degrees) ||
    !Number.isFinite(periodS) ||
    periodS <= 0
  ) {
    throw new RangeError('createArParentTarget: invalid devJump');
  }
  return metres === 0 && degrees === 0 ? null : jump;
}

/**
 * The dev jump a page URL asks for (`devWorldJumpM`, `devWorldJumpDeg`),
 * or null. Pure; {@link devWorldJumpFromPage} calls it only in development
 * builds.
 */
export function parseDevWorldJump(search: string): DevWorldJump | null {
  const params = new URLSearchParams(search);
  const read = (name: string): number => {
    const raw = params.get(name);
    if (raw === null || raw.trim() === '') return 0;
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
  };
  const metres = read('devWorldJumpM');
  const degrees = read('devWorldJumpDeg');
  if (metres === 0 && degrees === 0) return null;
  return { metres, degrees, periodS: DEV_WORLD_JUMP_PERIOD_S };
}

interface ImportMetaWithEnv {
  readonly env?: { readonly DEV?: boolean };
}

/**
 * The page's dev jump in a development build, else null. The condition is
 * written so a bundler that replaces `import.meta.env` (Vite does) folds it
 * to false in production and drops the reader with it.
 */
export function devWorldJumpFromPage(): DevWorldJump | null {
  if (
    (import.meta as ImportMetaWithEnv).env &&
    (import.meta as ImportMetaWithEnv).env!.DEV === true
  ) {
    const search = (globalThis as { location?: { search?: string } }).location
      ?.search;
    return parseDevWorldJump(typeof search === 'string' ? search : '');
  }
  return null;
}

/**
 * Whether a page URL keeps the anchor deferral on: false only for
 * `anchors=0`. Pure; {@link anchorDeferralFromPage} calls it only in
 * development builds.
 */
export function parseAnchorDeferral(search: string): boolean {
  return new URLSearchParams(search).get('anchors')?.trim() !== '0';
}

/**
 * The page's anchor deferral switch in a development build, else true
 * (deferral on). Written like {@link devWorldJumpFromPage}, so a
 * production build folds it to true and drops the reader.
 */
export function anchorDeferralFromPage(): boolean {
  if (
    (import.meta as ImportMetaWithEnv).env &&
    (import.meta as ImportMetaWithEnv).env!.DEV === true
  ) {
    const search = (globalThis as { location?: { search?: string } }).location
      ?.search;
    return parseAnchorDeferral(typeof search === 'string' ? search : '');
  }
  return true;
}

/**
 * What an alignment binding registers for its group: the target, and the
 * hook through which the group's anchor set runs its pass inside the
 * binding's own frame update, right after the alignment step.
 */
export interface ArParentBinding {
  readonly group: THREE.Object3D;
  readonly target: ArParentTarget;
  /** The alignment step (and the dev jump clock) of one frame, without the pass. */
  step(dt: number, elapsedS: number): void;
  /** Run `pass` after each alignment step; returns the detach function. */
  attachPass(pass: (dt: number, elapsedS: number) => void): () => void;
  /** Called once when the binding is disposed (the set then ticks itself). */
  onDispose(listener: () => void): () => void;
}

const bindings = new WeakMap<THREE.Object3D, ArParentBinding>();

/** Register `binding` for its group (one per group; a newer one replaces). */
export function registerArParentBinding(binding: ArParentBinding): () => void {
  bindings.set(binding.group, binding);
  return () => {
    if (bindings.get(binding.group) === binding) bindings.delete(binding.group);
  };
}

/** The binding registered for `group`, or null. */
export function getArParentBinding(
  group: THREE.Object3D
): ArParentBinding | null {
  return bindings.get(group) ?? null;
}
