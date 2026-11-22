/**
 * Deferred anchors: content under an AR world group (`arWorldGroup`) whose
 * correction waits until none of it is in view.
 *
 * The group carries the alignment T (odometry NUE -> GPS-world NUE): every
 * change of T moves it in one frame (`enableArWorldGroupAlignment`).
 * Content placed under it with the local
 * matrix T^-1 sits at its NUE pose; content that keeps its local matrix
 * instead stays put relative to the camera. An anchor does the second while
 * it is in view, and re-places itself to the latest T^-1 once it has been
 * out of view (at its current pose, in this frame's and the previous frame's
 * view, and at its new pose in this frame's view).
 *
 * Exceptions, each an event:
 * - until the alignment is mature and while no code has voted in the
 *   session, anchors follow the alignment exactly as scene-root content
 *   does (their world pose is their NUE pose every frame);
 * - after an odometry frame switch (a frame-epoch change, or a camera step
 *   above {@link FRAME_JUMP_THRESHOLD_M} in the group's frame between two
 *   frames) they follow for a window that closes when T has been quiet for
 *   {@link WINDOW_QUIET_S}, and at the latest after a span that grows with
 *   the session's length;
 * - a code lock (`requestAnchorRelease('code-lock')`, called by the QR
 *   tracking controller) re-places every anchor once, at once, ends the
 *   follow phase for the session and closes the window.
 *
 * Deep import `gps-plus-slam-app-framework/ar/deferred-anchors`. Sidecar:
 * `deferred-anchors.ts.md`.
 */

import * as THREE from 'three';
import { createLogger } from '../utils/logger';
import { registerFrameUpdate } from './frame-loop';
import { registerSessionDisposer } from './session-disposers';
import {
  hasCodeVoted,
  registerReleaseReceiver,
  type AnchorReleaseReason,
} from './anchor-release';
import { getArParentBinding, type ArParentBinding } from './ar-parent-target';
import {
  ANCHOR_VIEW_MARGIN_DEG,
  anchorBoundsNeedRefresh,
  createAnchorBoundsCache,
  createAnchorView,
  isAnchorInView,
  markAnchorBoundsChanged,
  updateAnchorView,
  type AnchorBoundsCache,
  type AnchorView,
  type AnchorVisibilityCounters,
  type XrCameraSource,
} from './anchor-visibility';
import { getCamera, getRenderer } from './webxr-session';

const log = createLogger('DeferredAnchors');

/** A key is pending when its content would move by more than this (m). */
export const DEFERRED_ANCHOR_EPSILON_M = 0.02;
/** A camera step (m, in the group's frame) between two frames that opens the window. */
export const FRAME_JUMP_THRESHOLD_M = 1;
/** The window closes after this long (s) without a T step above the noise floor. */
const WINDOW_QUIET_S = 2;
/** A T step (m, at the content) at or below this does not keep the window open. */
const WINDOW_NOISE_FLOOR_M = 0.1;
/** The window's longest span (s) after its last trigger: this share of the session... */
const WINDOW_SESSION_SHARE = 0.2;
/** ...clamped to [min, max] seconds. */
export const WINDOW_MIN_S = 10;
export const WINDOW_MAX_S = 120;

interface DeferredAnchorAddOptions {
  /**
   * Called after each placement of this root (first, out of view, release,
   * window entry, follow start), once its world matrices are refreshed and
   * before the frame renders. Never called for the per-frame follow steps.
   */
  readonly onCommit?: (root: THREE.Object3D) => void;
}

/** The anchor for one key under one parent; see {@link deferredAnchor}. */
export interface DeferredAnchor {
  readonly key: string;
  /**
   * Attach `root` under the parent (`parent.add(root)`), take over its local
   * matrix (`matrixAutoUpdate = false`) and place it at once. A root is a
   * pose-free wrapper: its own pose is replaced; poses go on its children.
   * Throws for a root that is (or holds, or sits inside) another anchor's root.
   */
  add(root: THREE.Object3D, options?: DeferredAnchorAddOptions): void;
  /** Detach `root`; the key is dropped with its last root. No-op after teardown. */
  remove(root: THREE.Object3D): void;
  /** Call after a structural change of a root's subtree. No-op after teardown. */
  boundsChanged(): void;
}

interface RootEntry {
  readonly root: THREE.Object3D;
  readonly cache: AnchorBoundsCache;
  /** Root-local box corners plus the origin, for the displacement bound. */
  corners: THREE.Vector3[];
  readonly onCommit: ((root: THREE.Object3D) => void) | undefined;
  readonly autoUpdateBefore: boolean;
}

interface KeyEntry {
  readonly key: string;
  readonly roots: Map<THREE.Object3D, RootEntry>;
  readonly local: THREE.Matrix4;
  following: boolean;
  pendingSinceMs: number | null;
}

type CommitKind =
  | 'first'
  | 'out-of-view'
  | 'release:code-lock'
  | 'window-entry'
  | 'follow-start';

/** Per-pass operation counts, for the budget tests. */
export interface DeferredAnchorPassCounts {
  readonly sphereTests: number;
  readonly traversals: number;
  /** Whether the frame-switch window is open after this pass. */
  readonly windowOpen: boolean;
  /** Keys whose follow step rewrote their matrix (0 while the parent stands still). */
  readonly followUpdates: number;
}

interface AnchorSet {
  readonly parent: THREE.Object3D;
  handle(key: string): DeferredAnchor;
  pass(
    view: AnchorView | THREE.Camera | null,
    dt: number,
    elapsedS: number
  ): DeferredAnchorPassCounts;
  readonly binding: ArParentBinding;
  isBound(): boolean;
}

const sets = new WeakMap<THREE.Object3D, AnchorSet>();

/**
 * The anchor for `(parent, key)`, created on first use. `parent` must have
 * an alignment binding (`enableArWorldGroupAlignment`); the parent's anchor
 * set lives until the AR session ends.
 */
export function deferredAnchor(
  parent: THREE.Object3D,
  key: string
): DeferredAnchor {
  if (!(parent instanceof THREE.Object3D)) {
    throw new TypeError('deferredAnchor: parent must be a THREE.Object3D');
  }
  if (typeof key !== 'string' || key === '') {
    throw new TypeError('deferredAnchor: key must be a non-empty string');
  }
  let set = sets.get(parent);
  if (!set) {
    const binding = getArParentBinding(parent);
    if (!binding) {
      throw new Error(
        'deferredAnchor: no alignment binding for this parent; call ' +
          'enableArWorldGroupAlignment for it first'
      );
    }
    set = createAnchorSet(parent, binding);
    sets.set(parent, set);
  }
  return set.handle(key);
}

/**
 * Test-only: run the binding's alignment step and then one pass of
 * `parent`'s set. `view` is a camera (read after that step, as in a frame) or a
 * prepared view. Returns this pass's operation counts.
 */
export function __runPassForTests(
  parent: THREE.Object3D,
  view: AnchorView | THREE.Camera,
  dt: number,
  elapsedS: number
): DeferredAnchorPassCounts {
  const set = sets.get(parent);
  if (!set) {
    getArParentBinding(parent)?.step(dt, elapsedS);
    return {
      sphereTests: 0,
      traversals: 0,
      windowOpen: false,
      followUpdates: 0,
    };
  }
  if (set.isBound()) set.binding.step(dt, elapsedS);
  return set.pass(view, dt, elapsedS);
}

const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const ORIGIN_ONLY: readonly THREE.Vector3[] = [new THREE.Vector3()];

/** Largest distance any of `corners` moves between local matrices `a` and `b`. */
function displacement(
  a: THREE.Matrix4,
  b: THREE.Matrix4,
  corners: readonly THREE.Vector3[]
): number {
  let max = 0;
  for (const c of corners) {
    const d = scratchA
      .copy(c)
      .applyMatrix4(a)
      .distanceTo(scratchB.copy(c).applyMatrix4(b));
    if (d > max) max = d;
  }
  return max;
}

/**
 * The root's subtree box in its own frame, as 8 corners plus the origin.
 * The displacement of a rigid or affine change is a convex function of the
 * point, so its maximum over the box is at a corner: exact over the box.
 */
function rootCorners(root: THREE.Object3D): THREE.Vector3[] {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const corners = [new THREE.Vector3()];
  if (box.isEmpty()) return corners;
  box.applyMatrix4(root.matrixWorld.clone().invert());
  for (let i = 0; i < 8; i += 1) {
    corners.push(
      new THREE.Vector3(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z
      )
    );
  }
  return corners;
}

function isAncestorOf(a: THREE.Object3D, b: THREE.Object3D): boolean {
  for (let p = b.parent; p; p = p.parent) if (p === a) return true;
  return false;
}

function copyView(into: AnchorView, from: AnchorView): void {
  into.viewCount = 0;
  into.setCount = 0;
  for (let i = 0; i < from.viewCount; i += 1) {
    const src = from.slots[i]!;
    let slot = into.slots[i];
    if (!slot) {
      slot = {
        worldFromView: new THREE.Matrix4(),
        projection: new THREE.Matrix4(),
        layersMask: 1,
        coordinateSystem: THREE.WebGLCoordinateSystem,
        reversedDepth: false,
        isPerspective: true,
      };
      into.slots.push(slot);
    }
    slot.worldFromView.copy(src.worldFromView);
    slot.projection.copy(src.projection);
    slot.layersMask = src.layersMask;
    slot.coordinateSystem = src.coordinateSystem;
    slot.reversedDepth = src.reversedDepth;
    slot.isPerspective = src.isPerspective;
    into.viewCount += 1;
  }
}

function createAnchorSet(
  parent: THREE.Object3D,
  binding: ArParentBinding
): AnchorSet {
  const target = binding.target;
  const keys = new Map<string, KeyEntry>();
  const handles = new Map<string, DeferredAnchor>();
  const keyOfRoot = new Map<THREE.Object3D, KeyEntry>();
  let disposed = false;
  let bound = true;

  // Views: the set owns two and swaps them after each pass.
  let cur = createAnchorView();
  let prev = createAnchorView();
  let hasPrev = false;
  const prevParentWorld = new THREE.Matrix4();

  // Phases.
  let immatureEnded = hasCodeVoted();
  let releaseRequested = false;
  let windowOpen = false;
  let windowUntilS = -Infinity;
  let lastStepS = -Infinity;
  let windowTrigger: 'epoch' | 'jump' = 'epoch';
  let lastEpoch = target.frameEpoch();
  let lastCam: THREE.Vector3 | null = null;
  const lastTargetInv = target.target().clone().invert();
  let lastTargetVersion = target.version();
  let roundRobin = 0;

  // Per-pass scratch.
  const targetInv = new THREE.Matrix4();
  const followInv = new THREE.Matrix4();
  const motion = new THREE.Matrix4();
  const parentInv = new THREE.Matrix4();
  const camNow = new THREE.Vector3();
  const counters: AnchorVisibilityCounters = { sphereTests: 0, traversals: 0 };
  let followUpdates = 0;
  let nowMs = 0;
  // Reused view-test options (no per-test allocation): at the current pose,
  // and at the new pose T^-1 (`targetInv` is updated in place each pass).
  const atCurrent = {
    marginDeg: ANCHOR_VIEW_MARGIN_DEG,
    nowMs: 0,
    counters,
    cache: createAnchorBoundsCache(),
    fresh: false,
  };
  const atTarget = { ...atCurrent, atLocal: targetInv };

  function cornersOf(key: KeyEntry): THREE.Vector3[] {
    const all: THREE.Vector3[] = [];
    for (const r of key.roots.values()) all.push(...r.corners);
    return all;
  }

  function assign(key: KeyEntry, local: THREE.Matrix4): void {
    key.local.copy(local);
    for (const r of key.roots.values()) {
      r.root.matrix.copy(local);
      r.root.updateMatrixWorld(true);
    }
  }

  function notify(entries: Iterable<RootEntry>): void {
    for (const r of entries) {
      if (!r.onCommit) continue;
      // Isolated: one consumer's hook must not stop the other roots' hooks.
      try {
        r.onCommit(r.root);
      } catch (error) {
        log.error(`onCommit threw for ${r.root.name || 'a root'}`, error);
      }
    }
  }

  function commit(
    key: KeyEntry,
    local: THREE.Matrix4,
    kind: CommitKind,
    detail = ''
  ): void {
    const moved = displacement(key.local, local, cornersOf(key));
    const waitMs =
      key.pendingSinceMs === null ? 0 : Math.max(0, nowMs - key.pendingSinceMs);
    assign(key, local);
    key.pendingSinceMs = null;
    log.info(
      `commit ${kind}${detail ? ` (${detail})` : ''}: ${key.key}, waited ` +
        `${waitMs.toFixed(0)} ms, moved ${moved.toFixed(3)} m`
    );
    notify(key.roots.values());
  }

  function isFollowWanted(): boolean {
    return windowOpen || (!immatureEnded && !target.isMature());
  }

  function inView(
    view: AnchorView,
    r: RootEntry,
    options: typeof atCurrent,
    fresh: boolean
  ): boolean {
    options.cache = r.cache;
    options.fresh = fresh;
    options.nowMs = nowMs;
    return isAnchorInView(view, r.root, options);
  }

  /** In view at its current pose (this or the previous view) or at T^-1 (this view). */
  function keyInView(key: KeyEntry, fresh: boolean): boolean {
    for (const r of key.roots.values()) {
      if (inView(cur, r, atCurrent, fresh)) return true;
      if (hasPrev && inView(prev, r, atCurrent, false)) return true;
      if (inView(cur, r, atTarget, false)) return true;
    }
    return false;
  }

  /** A root an app moved inside another anchor's root is dropped (it would carry the correction twice). */
  function excludeNested(key: KeyEntry): void {
    for (const r of [...key.roots.values()]) {
      for (let p = r.root.parent; p && p !== parent; p = p.parent) {
        if (keyOfRoot.has(p)) {
          log.error(
            `${key.key}: a root sits inside another anchor's root; excluded`
          );
          detachRoot(key, r, false);
          break;
        }
      }
    }
  }

  function detachRoot(key: KeyEntry, r: RootEntry, unparent: boolean): void {
    key.roots.delete(r.root);
    keyOfRoot.delete(r.root);
    r.root.matrixAutoUpdate = r.autoUpdateBefore;
    if (unparent && r.root.parent === parent) parent.remove(r.root);
    if (key.roots.size === 0) keys.delete(key.key);
  }

  function readView(view: AnchorView | THREE.Camera | null): void {
    if (view instanceof THREE.Object3D) {
      updateAnchorView(cur, view, null);
    } else if (view) {
      copyView(cur, view);
    } else {
      const camera = getCamera();
      if (camera) {
        const xr = getRenderer()?.xr as XrCameraSource | undefined;
        updateAnchorView(cur, camera, xr ?? null);
      } else {
        cur.viewCount = 0;
        cur.setCount = 0;
      }
    }
  }

  /** The previous view, carried by the parent's motion since then, so the frusta derived from it sit where they were in the parent frame. */
  function rebasePrevView(): void {
    if (!hasPrev) return;
    motion.copy(prevParentWorld).invert().premultiply(parent.matrixWorld);
    for (let i = 0; i < prev.viewCount; i += 1) {
      prev.slots[i]!.worldFromView.premultiply(motion);
    }
    prev.setCount = 0;
  }

  /** The first view's camera position in the parent frame, or null without a view. */
  function cameraInParent(): THREE.Vector3 | null {
    parentInv.copy(parent.matrixWorld).invert();
    if (cur.viewCount === 0) return null;
    return camNow
      .setFromMatrixPosition(cur.slots[0]!.worldFromView)
      .applyMatrix4(parentInv);
  }

  /** A pending release: one commit per displaced key, then deferral. */
  function applyRelease(epoch: number, cam: THREE.Vector3 | null): void {
    if (!releaseRequested) return;
    releaseRequested = false;
    immatureEnded = true;
    windowOpen = false;
    windowUntilS = -Infinity;
    // The release absorbs a frame switch it lands with.
    lastEpoch = epoch;
    lastCam = cam ? cam.clone() : null;
    for (const key of keys.values()) {
      if (
        displacement(key.local, targetInv, cornersOf(key)) >
        DEFERRED_ANCHOR_EPSILON_M
      ) {
        commit(key, targetInv, 'release:code-lock');
      }
      if (key.following) {
        key.following = false;
        log.info(`follow-end: ${key.key} (release)`);
      }
    }
  }

  /** A frame switch since the last pass: a new epoch, or a camera step. */
  function detectTrigger(
    epoch: number,
    cam: THREE.Vector3 | null
  ): 'epoch' | 'jump' | null {
    let trigger: 'epoch' | 'jump' | null = null;
    if (epoch !== lastEpoch) {
      lastEpoch = epoch;
      trigger = 'epoch';
    }
    if (cam && lastCam && cam.distanceTo(lastCam) > FRAME_JUMP_THRESHOLD_M) {
      trigger ??= 'jump';
    }
    if (cam) (lastCam ??= new THREE.Vector3()).copy(cam);
    return trigger;
  }

  /** How far T^-1 moved any key's content (or the origin) since the last pass. */
  function targetStep(): number {
    let step = displacement(lastTargetInv, targetInv, ORIGIN_ONLY);
    for (const key of keys.values()) {
      step = Math.max(
        step,
        displacement(lastTargetInv, targetInv, cornersOf(key))
      );
    }
    lastTargetInv.copy(targetInv);
    return step;
  }

  /** Frame switches open (or extend) the window; a cap or a quiet spell closes it. */
  function stepWindow(
    trigger: 'epoch' | 'jump' | null,
    tStep: number,
    elapsedS: number,
    sessionS: number
  ): void {
    if (trigger) {
      const cap = Math.min(
        WINDOW_MAX_S,
        Math.max(WINDOW_MIN_S, WINDOW_SESSION_SHARE * sessionS)
      );
      windowUntilS = elapsedS + cap;
      lastStepS = elapsedS;
      if (!windowOpen) {
        windowOpen = true;
        windowTrigger = trigger;
        log.info(`window opened (${trigger}), at most ${cap.toFixed(0)} s`);
      }
    } else if (windowOpen && tStep > WINDOW_NOISE_FLOOR_M) {
      lastStepS = elapsedS;
    }
    const expired =
      elapsedS >= windowUntilS || elapsedS - lastStepS >= WINDOW_QUIET_S;
    if (windowOpen && expired) {
      windowOpen = false;
      log.info('window closed');
    }
  }

  function startFollow(key: KeyEntry): void {
    key.following = true;
    const kind: CommitKind = windowOpen ? 'window-entry' : 'follow-start';
    if (
      displacement(key.local, followInv, cornersOf(key)) >
      DEFERRED_ANCHOR_EPSILON_M
    ) {
      commit(
        key,
        followInv,
        kind,
        kind === 'window-entry' ? windowTrigger : ''
      );
    } else {
      assign(key, followInv);
      log.info(`follow-start: ${key.key}`);
    }
  }

  function continueFollow(key: KeyEntry, followWanted: boolean): void {
    // A parent that stands still leaves nothing to rewrite.
    if (!key.local.equals(followInv)) {
      assign(key, followInv);
      followUpdates += 1;
    }
    // After the phase ends, follow on until the key is at T^-1.
    if (
      !followWanted &&
      displacement(followInv, targetInv, cornersOf(key)) <=
        DEFERRED_ANCHOR_EPSILON_M
    ) {
      key.following = false;
      log.info(`follow-end: ${key.key}`);
    }
  }

  /** Follow: world pose equals NUE (scene-root behaviour). */
  function followKeys(): void {
    const followWanted = isFollowWanted();
    for (const key of keys.values()) {
      if (followWanted && !key.following) startFollow(key);
      else if (key.following) continueFollow(key, followWanted);
    }
  }

  /** Displaced deferred keys by what their cached tests say, in round-robin order. */
  function classifyDeferred(ordered: KeyEntry[]): {
    out: KeyEntry[];
    build: KeyEntry[];
    stale: KeyEntry[];
  } {
    const out: KeyEntry[] = [];
    const build: KeyEntry[] = [];
    const stale: KeyEntry[] = [];
    for (let i = 0; i < ordered.length; i += 1) {
      const key = ordered[(i + roundRobin) % ordered.length]!;
      if (key.following) continue;
      if (
        displacement(key.local, targetInv, cornersOf(key)) <=
        DEFERRED_ANCHOR_EPSILON_M
      ) {
        key.pendingSinceMs = null;
        continue;
      }
      key.pendingSinceMs ??= nowMs;
      if (!hasPrev) continue;
      const roots = [...key.roots.values()];
      if (roots.some((r) => !r.cache.valid || r.cache.anchor !== r.root)) {
        build.push(key);
      } else if (!keyInView(key, false)) {
        out.push(key);
      } else if (roots.some((r) => anchorBoundsNeedRefresh(r.cache, nowMs))) {
        stale.push(key);
      }
    }
    return { out, build, stale };
  }

  /** Deferred keys: cached tests for all, at most one key's traversal. */
  function commitOneDeferred(): void {
    const ordered = [...keys.values()];
    const { out, build, stale } = classifyDeferred(ordered);
    const pick = out[0] ?? build[0] ?? stale[0];
    if (!pick) return;
    roundRobin = (ordered.indexOf(pick) + 1) % ordered.length;
    excludeNested(pick);
    if (keys.get(pick.key) !== pick) return;
    // The fresh traversal renews the bounds; the corners follow it, so a
    // part mounted without boundsChanged() counts from here on.
    for (const r of pick.roots.values()) r.corners = rootCorners(r.root);
    if (!keyInView(pick, true)) commit(pick, targetInv, 'out-of-view');
  }

  /** This view is the next pass's previous view. */
  function swapViews(): void {
    const swap = prev;
    prev = cur;
    cur = swap;
    prevParentWorld.copy(parent.matrixWorld);
    hasPrev = true;
  }

  function pass(
    view: AnchorView | THREE.Camera | null,
    _dt: number,
    elapsedS: number
  ): DeferredAnchorPassCounts {
    counters.sphereTests = 0;
    counters.traversals = 0;
    followUpdates = 0;
    if (disposed || !Number.isFinite(elapsedS))
      return { ...counters, windowOpen, followUpdates };
    nowMs = elapsedS * 1000;
    const sessionS = target.sessionElapsedS(elapsedS);
    parent.updateWorldMatrix(true, false);
    targetInv.copy(target.target()).invert();
    followInv.copy(parent.matrix).invert();

    rebasePrevView();
    readView(view);
    const cam = cameraInParent();
    const epoch = target.frameEpoch();
    applyRelease(epoch, cam);
    const trigger = detectTrigger(epoch, cam);
    const version = target.version();
    const tStep = version === lastTargetVersion ? 0 : targetStep();
    lastTargetVersion = version;
    stepWindow(trigger, tStep, elapsedS, sessionS);
    followKeys();
    commitOneDeferred();
    swapViews();
    return { ...counters, windowOpen, followUpdates };
  }

  /** Throws on a root the set cannot take; true when it already belongs to `key`. */
  function isMemberOf(root: THREE.Object3D, key: string): boolean {
    if (disposed) {
      throw new Error(
        'DeferredAnchor.add: the anchor set ended with its AR session; ' +
          'call deferredAnchor again'
      );
    }
    if (!(root instanceof THREE.Object3D)) {
      throw new TypeError('DeferredAnchor.add: root must be a THREE.Object3D');
    }
    const current = keyOfRoot.get(root);
    if (current) {
      if (current.key === key) return true;
      throw new Error(
        `DeferredAnchor.add: root already belongs to ${current.key}`
      );
    }
    assertNoNesting(root);
    return false;
  }

  function assertNoNesting(root: THREE.Object3D): void {
    if (root === parent || isAncestorOf(root, parent)) {
      throw new Error('DeferredAnchor.add: root must not hold its parent');
    }
    for (const other of keyOfRoot.keys()) {
      if (isAncestorOf(other, root) || isAncestorOf(root, other)) {
        throw new Error(
          'DeferredAnchor.add: anchors must not nest; add each root directly'
        );
      }
    }
  }

  /** A key's first root: following in a follow phase, else at T^-1. */
  function placeNewKey(keyEntry: KeyEntry): void {
    parent.updateWorldMatrix(true, false);
    if (isFollowWanted()) {
      keyEntry.following = true;
      commit(keyEntry, followInv.copy(parent.matrix).invert(), 'follow-start');
    } else {
      commit(keyEntry, targetInv.copy(target.target()).invert(), 'first');
    }
  }

  function handle(key: string): DeferredAnchor {
    const existing = handles.get(key);
    if (existing) return existing;
    const anchor: DeferredAnchor = {
      key,
      add(root, options = {}) {
        if (isMemberOf(root, key)) return;
        const autoUpdateBefore = root.matrixAutoUpdate;
        parent.add(root);
        root.matrixAutoUpdate = false;
        const entry: RootEntry = {
          root,
          cache: createAnchorBoundsCache(),
          corners: rootCorners(root),
          onCommit: options.onCommit,
          autoUpdateBefore,
        };
        keyOfRoot.set(root, keys.get(key) ?? newKey(key));
        const keyEntry = keyOfRoot.get(root)!;
        const isNew = keyEntry.roots.size === 0;
        keyEntry.roots.set(root, entry);
        if (isNew) {
          placeNewKey(keyEntry);
        } else {
          root.matrix.copy(keyEntry.local);
          root.updateMatrixWorld(true);
          notify([entry]);
        }
      },
      remove(root) {
        if (disposed) return;
        const keyEntry = keyOfRoot.get(root);
        if (!keyEntry || keyEntry.key !== key) return;
        detachRoot(keyEntry, keyEntry.roots.get(root)!, true);
      },
      boundsChanged() {
        if (disposed) return;
        const keyEntry = keys.get(key);
        if (!keyEntry) return;
        for (const r of keyEntry.roots.values()) {
          markAnchorBoundsChanged(r.cache);
          r.corners = rootCorners(r.root);
        }
      },
    };
    handles.set(key, anchor);
    return anchor;
  }

  function newKey(key: string): KeyEntry {
    const entry: KeyEntry = {
      key,
      roots: new Map(),
      local: new THREE.Matrix4(),
      following: false,
      pendingSinceMs: null,
    };
    keys.set(key, entry);
    return entry;
  }

  const productionPass = (dt: number, elapsedS: number): void => {
    pass(null, dt, elapsedS);
  };
  let detachPass: (() => void) | null = binding.attachPass(productionPass);
  let selfTick: (() => void) | null = null;
  const stopBindingWatch = binding.onDispose(() => {
    detachPass = null;
    bound = false;
    if (!disposed) selfTick = registerFrameUpdate(productionPass);
  });
  const stopRelease = registerReleaseReceiver((reason: AnchorReleaseReason) => {
    if (reason === 'code-lock') releaseRequested = true;
  });
  registerSessionDisposer(() => {
    disposed = true;
    detachPass?.();
    detachPass = null;
    selfTick?.();
    selfTick = null;
    stopBindingWatch();
    stopRelease();
    if (sets.get(parent) === set) sets.delete(parent);
  });

  const set: AnchorSet = {
    parent,
    handle,
    pass,
    binding,
    isBound: () => bound,
  };
  return set;
}
