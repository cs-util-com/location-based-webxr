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
interface TrackOptions {
  readonly capturedAt?: number;
  readonly epoch?: number;
}

/** What the registry keeps per tracked object (read-only view). */
interface TrackedEntry {
  /** Number of observations whose jumps the local transform already holds. */
  readonly applied: number;
  /** The correction baked in since tracking, in O (`Q`). */
  readonly correction: Pose;
  /** The `capturedAt` hint the object was tracked with, or `null`. */
  readonly stampedAt: number | null;
  /** Parent-to-group transform `P` at tracking time, column-major. */
  readonly parentToGroup: Matrix4;
}

export interface ArSpaceCorrectionRegistry {
  /**
   * Track `object` (a descendant of the group) from its current local
   * transform. Tracking an object again restarts it from its current local
   * transform with the new options. Jumps the object missed are applied at
   * once. Throws when no store is attached, the object is not under the
   * group, the options are invalid, or another committer owns the object.
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
  /** The entry of a tracked object, or `undefined`. */
  entryOf(object: THREE.Object3D): Readonly<TrackedEntry> | undefined;
  /** Untrack everything and detach. */
  dispose(): void;
}

interface Entry {
  applied: number;
  correction: Pose;
  stampedAt: number | null;
  readonly parentToGroup: Matrix4;
}

const IDENTITY_MATRIX = new THREE.Matrix4().toArray() as unknown as Matrix4;

/** `P`: the product of the local matrices from `group` down to `object.parent`. */
function parentToGroupOf(
  object: THREE.Object3D,
  group: THREE.Object3D
): Matrix4 {
  const chain: THREE.Object3D[] = [];
  let p = object.parent;
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
  return m.toArray() as unknown as Matrix4;
}

const scratchM = new THREE.Matrix4();
const scratchT = new THREE.Vector3();
const scratchQ = new THREE.Quaternion();
const scratchS = new THREE.Vector3();

/** `local := M * local`, M rigid; the scale is untouched. */
function bakeInto(object: THREE.Object3D, m: Matrix4): void {
  scratchM.fromArray(m);
  scratchM.decompose(scratchT, scratchQ, scratchS);
  object.position.applyQuaternion(scratchQ).add(scratchT);
  object.quaternion.premultiply(scratchQ);
  if (!object.matrixAutoUpdate) object.matrix.premultiply(scratchM);
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

  function bake(
    object: THREE.Object3D,
    entry: Entry,
    state: RootWithArSpaceCorrection
  ): void {
    const n = selectArSpaceCorrectionEpoch(state);
    if (entry.applied === n) return;
    if (entry.applied > n) {
      // Not reachable within one store: observations only grow.
      log.warn(`entry ahead of the store (${entry.applied} > ${n}); restarted`);
      entry.applied = n;
      entry.correction = IDENTITY_POSE;
      return;
    }
    const delta = selectCorrectionTrack(state)[entry.applied]!;
    bakeInto(
      object,
      shownLocalMatrix(delta, entry.parentToGroup, IDENTITY_MATRIX)
    );
    entry.correction = composeRigid(delta, entry.correction);
    entry.applied = n;
  }

  function sync(): void {
    if (store === null) return;
    const state = store.getState();
    const observations = selectArSpaceObservations(state);
    if (observations === seenObservations) return;
    seenObservations = observations;
    for (const [object, entry] of entries) bake(object, entry, state);
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
      const parentToGroup = parentToGroupOf(object, group);
      if (!entries.has(object)) claimPose(object, 'AR-space correction');
      const entry: Entry = {
        applied: epoch,
        correction: IDENTITY_POSE,
        stampedAt: opts.capturedAt ?? null,
        parentToGroup,
      };
      entries.set(object, entry);
      bake(object, entry, state);
    },
    untrack(object) {
      if (!entries.delete(object)) return;
      releasePose(object, 'AR-space correction');
    },
    attach(next) {
      unsubscribe?.();
      store = next;
      const state = next.getState();
      const n = selectArSpaceCorrectionEpoch(state);
      for (const entry of entries.values()) {
        entry.applied = n;
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
    entryOf(object) {
      return entries.get(object);
    },
    dispose() {
      unsubscribe?.();
      unsubscribe = null;
      store = null;
      for (const object of entries.keys()) {
        releasePose(object, 'AR-space correction');
      }
      entries.clear();
    },
  };
}
