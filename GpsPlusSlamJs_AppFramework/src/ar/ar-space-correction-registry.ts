/**
 * The AR-space correction registry: bakes each relocalization jump into the
 * local transform of the scene objects it tracks, once per jump.
 *
 * An object is tracked with the raw pose it holds at that moment (its local
 * transform) and the epoch that pose belongs to. On every new observation
 * in the attached store, each tracked object of an older epoch gets
 * `local := M * local` with `M = P^-1 * D * P` (the jumps it has not
 * received yet, conjugated into its parent's frame). So its local transform
 * always holds its pose in the CURRENT raw frame, the frame of every new
 * camera pose and hit test, and an app's own writes to `position` or
 * `quaternion` (absolute or relative) stay right without any call.
 *
 * The registry and its entries are imperative scene resources, outside the
 * store; the correction itself is read from the store's selectors only. The
 * registry never dispatches and never reads the GPS alignment.
 *
 * Sidecar: `ar-space-correction-registry.ts.md`.
 */
import * as THREE from 'three';
import type { Matrix4 } from 'gps-plus-slam-js';
import {
  IDENTITY_POSE,
  composeRigid,
  invertRigid,
  shownLocalMatrix,
} from './ar-space-correction';
import type { Pose } from './qr/qr-pose';
import { claimPose, releasePose } from './pose-committer';
import {
  selectArSpaceCorrectionEpoch,
  selectArSpaceEpochAt,
  selectArSpaceObservations,
  selectCorrectionTrack,
  type RootWithArSpaceCorrection,
} from '../state/ar-space-correction-slice';
import { createLogger } from '../utils/logger';

const log = createLogger('ArSpaceCorrection');

/** The store surface the registry reads. */
interface ArSpaceCorrectionStore {
  getState(): RootWithArSpaceCorrection;
  subscribe(listener: () => void): () => void;
}

/**
 * Which epoch the object's current local transform belongs to. Default: the
 * store's current epoch (a pose computed now, from a hit test or the
 * camera). `capturedAt` (epoch-ms XR clock) for a pose computed from older
 * data; `epoch` when the caller knows it. At most one of the two.
 */
export interface TrackOptions {
  readonly capturedAt?: number;
  readonly epoch?: number;
}

/** The event a tracked object receives right after a correction is baked in. */
interface ArCorrectedEvent {
  /**
   * `M`, the transform applied to the object's local matrix
   * (`local := M * local`), column-major. Frozen and shared by every object
   * with the same parent and epoch in one jump: read it, never keep a
   * mutable reference to it.
   */
  readonly matrix: Matrix4;
}

declare module 'three' {
  interface Object3DEventMap {
    /**
     * Dispatched on an object the AR-space correction tracks, once per
     * bake that moved it (a jump, or jumps it missed applied at tracking).
     * A physics body or an app's own copy of the position follows here.
     */
    arcorrected: ArCorrectedEvent;
  }
}

/** What the registry keeps per tracked object (read-only view). */
interface TrackedEntry {
  /** Number of observations whose jumps the local transform already holds. */
  readonly applied: number;
  /** The correction baked in since tracking, in O (`Q`). */
  readonly correction: Pose;
  /** The `capturedAt` hint the object was tracked with, or `null`. */
  readonly stampedAt: number | null;
  /** The epoch the placement belongs to; its jumps from there are baked in. */
  readonly start: number;
}

export interface ArSpaceCorrectionRegistry {
  /**
   * Track `object` (a descendant of the group) from its current local
   * transform. Jumps the object missed are applied at once. Tracking a
   * tracked object again WITH a hint re-dates its placement: the jumps
   * between the hint's epoch and the epoch it was tracked with are applied
   * (or taken back), so a late hint is right even after a jump, as long as
   * the app has not rewritten the pose nor moved its container since. Without a
   * hint it restarts from its current transform, unmoved. Throws when no
   * store is attached, the object is not under the group, the options are
   * invalid, or another committer owns the object.
   */
  track(object: THREE.Object3D, options?: TrackOptions): void;
  /** Stop correcting `object`; its transform keeps its current value. */
  untrack(object: THREE.Object3D): void;
  /**
   * Follow `store`. A previously attached store is detached first, and every
   * entry restarts at the new store's epoch (its transform is already in
   * the current frame). Returns the detach function.
   */
  attach(store: ArSpaceCorrectionStore): () => void;
  /** Whether a store is attached. */
  isAttached(): boolean;
  /** The entry of a tracked object, or `undefined`. */
  entryOf(object: THREE.Object3D): Readonly<TrackedEntry> | undefined;
  /** Untrack everything and detach. */
  dispose(): void;
}

interface Entry {
  applied: number;
  correction: Pose;
  stampedAt: number | null;
  start: number;
  /** The parent at tracking time; a re-parented object is untracked. */
  readonly parent: THREE.Object3D;
  /** The one-shot `removed` listener that untracks the object. */
  readonly onRemoved: () => void;
}

const IDENTITY_MATRIX = new THREE.Matrix4().toArray() as unknown as Matrix4;

/**
 * `P`: the product of the local matrices from `group` down to `parent`,
 * read now, so a container the app moved is read at its new transform.
 */
function parentToGroupOf(
  parent: THREE.Object3D | null,
  group: THREE.Object3D
): Matrix4 {
  const chain: THREE.Object3D[] = [];
  let p = parent;
  while (p && p !== group) {
    chain.push(p);
    p = p.parent;
  }
  if (p !== group) {
    throw new RangeError(
      'ArSpaceCorrectionRegistry.track: the object is not a descendant of ' +
        'the AR-space group'
    );
  }
  if (chain.length === 0) return IDENTITY_MATRIX;
  const m = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  for (let i = chain.length - 1; i >= 0; i--) {
    const node = chain[i]!;
    if (node.matrixAutoUpdate) {
      local.compose(node.position, node.quaternion, node.scale);
    } else {
      local.copy(node.matrix);
    }
    m.multiply(local);
  }
  assertConjugable(m);
  return m.toArray() as unknown as Matrix4;
}

/**
 * Relative tolerance of the similarity check on `P`. A chain of float32
 * rotations composes to about 1e-7 off orthogonal; a real shear or an axis
 * scale differs by far more than 1e-5.
 */
const SIMILARITY_TOLERANCE = 1e-5;

/**
 * Throws unless `P` is a similarity (rotation, uniform scale, translation)
 * with a finite, non-zero scale. Only then is `P^-1 * D * P` rigid for every
 * rigid `D`, which the bake relies on (it moves position and quaternion
 * and leaves the scale alone).
 */
function assertConjugable(p: THREE.Matrix4): void {
  const e = p.elements;
  const col = (c: number) => [e[4 * c]!, e[4 * c + 1]!, e[4 * c + 2]!];
  const cols = [col(0), col(1), col(2)];
  const dot = (a: number[], b: number[]) =>
    a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const s2 = dot(cols[0]!, cols[0]!);
  const tol = SIMILARITY_TOLERANCE * s2;
  const ok =
    e.every(Number.isFinite) &&
    s2 > 1e-12 &&
    Math.abs(dot(cols[1]!, cols[1]!) - s2) <= tol &&
    Math.abs(dot(cols[2]!, cols[2]!) - s2) <= tol &&
    Math.abs(dot(cols[0]!, cols[1]!)) <= tol &&
    Math.abs(dot(cols[0]!, cols[2]!)) <= tol &&
    Math.abs(dot(cols[1]!, cols[2]!)) <= tol;
  if (!ok) {
    throw new RangeError(
      'ArSpaceCorrectionRegistry.track: the parent chain has a non-uniform ' +
        'scale, a shear or a zero scale; a rigid correction cannot be moved ' +
        'through it'
    );
  }
}

/** Whether `object` still sits under `parent`, and `parent` under `group`. */
function stillUnder(
  object: THREE.Object3D,
  parent: THREE.Object3D,
  group: THREE.Object3D
): boolean {
  if (object.parent !== parent) return false;
  let p: THREE.Object3D | null = parent;
  while (p !== null && p !== group) p = p.parent;
  return p === group;
}

/**
 * One `M = P^-1 * Delta(applied) * P`, decomposed once and shared by every
 * entry with the same parent and `applied` within one sync (the common case:
 * every direct child of the content group, or of one container).
 */
interface PreparedCorrection {
  /** `M`, column-major and frozen: it is handed to `arcorrected` listeners. */
  readonly matrix: Matrix4;
  readonly m: THREE.Matrix4;
  readonly t: THREE.Vector3;
  readonly q: THREE.Quaternion;
  /** `Q` before the bake to `Q` after it, so equal `Q`s stay shared. */
  readonly corrections: Map<Pose, Pose>;
}

/** Per parent within one sync: its `P` (or why it has none) and its `M`s. */
interface ParentCorrections {
  readonly p: Matrix4 | Error;
  readonly byApplied: Map<number, PreparedCorrection>;
}

/** Per sync: parent object to its fresh `P` and prepared corrections. */
type CorrectionCache = Map<THREE.Object3D, ParentCorrections>;

function correctionsOf(
  cache: CorrectionCache,
  parent: THREE.Object3D,
  group: THREE.Object3D
): ParentCorrections {
  let pc = cache.get(parent);
  if (pc === undefined) {
    let p: Matrix4 | Error;
    try {
      p = parentToGroupOf(parent, group);
    } catch (error) {
      p = error instanceof Error ? error : new Error(String(error));
    }
    pc = { p, byApplied: new Map() };
    cache.set(parent, pc);
  }
  return pc;
}

function prepare(delta: Pose, parentToGroup: Matrix4): PreparedCorrection {
  const matrix = Object.freeze(
    shownLocalMatrix(delta, parentToGroup, IDENTITY_MATRIX)
  );
  const m = new THREE.Matrix4().fromArray(matrix);
  const t = new THREE.Vector3();
  const q = new THREE.Quaternion();
  m.decompose(t, q, new THREE.Vector3());
  return { matrix, m, t, q, corrections: new Map() };
}

/** `local := M * local`, M rigid; the scale is untouched. */
function bakeInto(object: THREE.Object3D, c: PreparedCorrection): void {
  object.position.applyQuaternion(c.q).add(c.t);
  object.quaternion.premultiply(c.q);
  if (!object.matrixAutoUpdate) object.matrix.premultiply(c.m);
  object.matrixWorldNeedsUpdate = true;
}

export function createArSpaceCorrectionRegistry(options: {
  /** The node whose local space is O (`arWorldGroup`). */
  readonly group: THREE.Object3D;
}): ArSpaceCorrectionRegistry {
  const { group } = options;
  if (!(group instanceof THREE.Object3D)) {
    throw new TypeError(
      'createArSpaceCorrectionRegistry: group must be an Object3D'
    );
  }
  const entries = new Map<THREE.Object3D, Entry>();
  let store: ArSpaceCorrectionStore | null = null;
  let unsubscribe: (() => void) | null = null;
  let seenObservations: unknown = null;

  /** Bake `c` (the image of `delta`) into `object`; the entry is now at `n`. */
  function apply(
    object: THREE.Object3D,
    entry: Entry,
    c: PreparedCorrection,
    delta: Pose,
    n: number
  ): void {
    bakeInto(object, c);
    let correction = c.corrections.get(entry.correction);
    if (correction === undefined) {
      correction = composeRigid(delta, entry.correction);
      c.corrections.set(entry.correction, correction);
    }
    entry.correction = correction;
    entry.applied = n;
    object.dispatchEvent({ type: 'arcorrected', matrix: c.matrix });
  }

  function bake(
    object: THREE.Object3D,
    entry: Entry,
    state: RootWithArSpaceCorrection,
    cache: CorrectionCache
  ): void {
    const n = selectArSpaceCorrectionEpoch(state);
    if (entry.applied === n) return;
    if (!stillUnder(object, entry.parent, group)) {
      // An explicitly tracked object whose parent left the group: its
      // placement no longer holds. (A removed object is untracked at once.)
      log.warn('a tracked object left its parent or the group; untracked');
      untrack(object);
      return;
    }
    if (entry.applied > n) {
      // Not reachable within one store: observations only grow.
      log.warn(`entry ahead of the store (${entry.applied} > ${n}); restarted`);
      entry.applied = n;
      entry.start = n;
      entry.correction = IDENTITY_POSE;
      return;
    }
    const pc = correctionsOf(cache, entry.parent, group);
    if (pc.p instanceof Error) throw pc.p;
    const delta = selectCorrectionTrack(state)[entry.applied]!;
    let c = pc.byApplied.get(entry.applied);
    if (c === undefined) {
      c = prepare(delta, pc.p);
      pc.byApplied.set(entry.applied, c);
    }
    apply(object, entry, c, delta, n);
  }

  /**
   * Re-date a tracked placement from epoch `start` to `target`: it holds
   * the jumps `[start, applied)`, which is `Delta(applied)^-1 * Delta(start)`
   * in O, and needs `[target, n)`, which is `Delta(target)`; so it gets
   * `Delta(target) * Delta(start)^-1 * Delta(applied)`. `applied` may be
   * below `n` (a hint from a store listener that runs before this one).
   */
  function redate(
    object: THREE.Object3D,
    entry: Entry,
    state: RootWithArSpaceCorrection,
    target: number,
    p: Matrix4
  ): void {
    const n = selectArSpaceCorrectionEpoch(state);
    if (target === entry.start && entry.applied === n) return;
    const deltas = selectCorrectionTrack(state);
    const delta = composeRigid(
      deltas[target]!,
      composeRigid(invertRigid(deltas[entry.start]!), deltas[entry.applied]!)
    );
    entry.start = target;
    apply(object, entry, prepare(delta, p), delta, n);
  }

  /**
   * The store subscriber. It never throws: a failed correction must not
   * come out of the app's dispatch call (a GPS fix, a recorded frame).
   */
  function sync(): void {
    try {
      syncNow();
    } catch (error) {
      log.error(`correction sync failed; skipped: ${String(error)}`);
    }
  }

  function syncNow(): void {
    if (store === null) return;
    const state = store.getState();
    const observations = selectArSpaceObservations(state);
    if (observations === seenObservations) return;
    seenObservations = observations;
    const cache: CorrectionCache = new Map();
    for (const [object, entry] of [...entries]) {
      // An arcorrected listener of an earlier object may have untracked,
      // removed or re-tracked this one.
      if (entries.get(object) !== entry) continue;
      try {
        bake(object, entry, state, cache);
      } catch (error) {
        // One broken object must not stop the others from being corrected.
        log.error(`correction of one object failed; skipped: ${String(error)}`);
      }
    }
  }

  function untrack(object: THREE.Object3D, only?: Entry): void {
    const entry = entries.get(object);
    if (entry === undefined || (only !== undefined && entry !== only)) return;
    entries.delete(object);
    object.removeEventListener('removed', entry.onRemoved);
    releasePose(object, 'AR-space correction');
  }

  function epochFor(
    state: RootWithArSpaceCorrection,
    opts: TrackOptions
  ): number {
    const n = selectArSpaceCorrectionEpoch(state);
    if (opts.epoch !== undefined && opts.capturedAt !== undefined) {
      throw new TypeError('track: give epoch or capturedAt, not both');
    }
    if (opts.epoch !== undefined) {
      if (!Number.isInteger(opts.epoch) || opts.epoch < 0 || opts.epoch > n) {
        throw new RangeError(`track: epoch ${opts.epoch} is outside 0..${n}`);
      }
      return opts.epoch;
    }
    if (opts.capturedAt !== undefined) {
      return selectArSpaceEpochAt(state, opts.capturedAt);
    }
    return n;
  }

  /** Claim `object` and track it from `epoch`, then bake the jumps since. */
  function begin(
    object: THREE.Object3D,
    state: RootWithArSpaceCorrection,
    epoch: number,
    stampedAt: number | null,
    p: Matrix4
  ): void {
    const parent = object.parent!;
    claimPose(object, 'AR-space correction');
    const entry: Entry = {
      applied: epoch,
      correction: IDENTITY_POSE,
      stampedAt,
      start: epoch,
      parent,
      // This placement only: a removed listener that ran first may have put
      // the object back as a new placement.
      onRemoved: () => untrack(object, entry),
    };
    entries.set(object, entry);
    object.addEventListener('removed', entry.onRemoved);
    const cache: CorrectionCache = new Map([
      [parent, { p, byApplied: new Map() }],
    ]);
    bake(object, entry, state, cache);
  }

  return {
    track(object, opts = {}) {
      if (!(object instanceof THREE.Object3D)) {
        throw new TypeError('track: object must be an Object3D');
      }
      if (store === null) {
        throw new Error('track: no store attached');
      }
      const state = store.getState();
      const epoch = epochFor(state, opts);
      // Read and checked before anything is claimed.
      const p = parentToGroupOf(object.parent, group);
      const parent = object.parent!;
      const known = entries.get(object);
      const stampedAt = opts.capturedAt ?? null;
      const hinted = stampedAt !== null || opts.epoch !== undefined;
      if (known !== undefined && known.parent === parent && hinted) {
        known.stampedAt = stampedAt;
        redate(object, known, state, epoch, p);
        return;
      }
      if (known !== undefined) untrack(object);
      begin(object, state, epoch, stampedAt, p);
    },
    untrack: (object) => untrack(object),
    attach(next) {
      unsubscribe?.();
      store = next;
      const state = next.getState();
      const n = selectArSpaceCorrectionEpoch(state);
      for (const entry of entries.values()) {
        entry.applied = n;
        entry.start = n;
        entry.correction = IDENTITY_POSE;
      }
      seenObservations = selectArSpaceObservations(state);
      const detachThis = next.subscribe(sync);
      unsubscribe = detachThis;
      return () => {
        if (unsubscribe !== detachThis) return;
        detachThis();
        unsubscribe = null;
        store = null;
      };
    },
    isAttached() {
      return store !== null;
    },
    entryOf(object) {
      return entries.get(object);
    },
    dispose() {
      unsubscribe?.();
      unsubscribe = null;
      store = null;
      for (const object of [...entries.keys()]) untrack(object);
    },
  };
}
