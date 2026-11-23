/**
 * Automatic AR-space correction of app content: a framework-owned group,
 * `arContent`, whose children are tracked by the correction registry the
 * moment they are added, so a relocalization jump moves them back onto
 * their physical place with no call from the app.
 *
 * The watcher listens to `childadded` and `childremoved` on `arContent`
 * and on every container (a group that collects items over time). A direct
 * child is one rigid item, tracked with the store's epoch at the add (or
 * with a `capturedAt` hint the app gave before or after the add); a
 * removed child is untracked, and a re-added child is a new placement.
 * Containers are never corrected themselves; their children are.
 *
 * Content added to `arWorldGroup` directly is not watched: the framework's
 * own children of that group (anchors, tile and occupancy nodes) stay out by
 * placement. The listeners, the containers, the exclusions and the pending
 * hints are imperative scene state about three.js objects, outside the
 * store; the correction itself comes from the store's selectors only.
 *
 * Sidecar: `ar-content-watcher.ts.md`.
 */
import * as THREE from 'three';
import {
  createArSpaceCorrectionRegistry,
  type TrackOptions,
} from './ar-space-correction-registry';
import type { RootWithArSpaceCorrection } from '../state/ar-space-correction-slice';
import { createLogger } from '../utils/logger';

const log = createLogger('ArSpaceCorrection');

/** The store surface the correction reads. */
interface ArSpaceCorrectionStore {
  getState(): RootWithArSpaceCorrection;
  subscribe(listener: () => void): () => void;
}

export interface ArSpaceCorrection {
  /**
   * Say which epoch `object`'s current pose belongs to (see
   * `TrackOptions`). Under `arWorldGroup` the object is tracked now (it
   * need not be watched: a tile under a framework node). Anywhere else
   * the hint is kept until the object is added to a watched group. Throws
   * a `TypeError` for an excluded object, a container, or both options.
   */
  track(object: THREE.Object3D, options?: TrackOptions): void;
  /** Stop correcting `object` and drop its pending hint. */
  untrack(object: THREE.Object3D): void;
  /**
   * Mark `group` as a container: never corrected itself, its direct
   * children tracked one by one. Its transform must stay fixed relative to
   * `arContent` while it holds tracked items. Returns `group`.
   */
  container<T extends THREE.Object3D>(group: T): T;
  /** Never track `object`, now or after any later add. */
  exclude(object: THREE.Object3D): void;
  /** Follow another store (a new recording in the same AR session). */
  attach(store: ArSpaceCorrectionStore): () => void;
  /** Stop watching, untrack everything and detach. `arContent` stays. */
  dispose(): void;
}

export interface ArSpaceCorrectionHandle {
  /** Put AR content here; children are corrected automatically. */
  readonly arContent: THREE.Group;
  readonly arCorrection: ArSpaceCorrection;
}

function assertOptions(options: TrackOptions): void {
  if (options.epoch !== undefined && options.capturedAt !== undefined) {
    throw new TypeError('track: give epoch or capturedAt, not both');
  }
  if (options.capturedAt !== undefined && Number.isNaN(options.capturedAt)) {
    throw new TypeError('track: capturedAt must be a number');
  }
}

function isUnder(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let p = object.parent; p !== null; p = p.parent) {
    if (p === ancestor) return true;
  }
  return false;
}

/**
 * Create `arContent` under `arWorldGroup` (identity transform) and correct
 * its content for every relocalization the store observes.
 */
export function enableArSpaceCorrection(options: {
  readonly store: ArSpaceCorrectionStore;
  /** The node whose local space is O. */
  readonly arWorldGroup: THREE.Object3D;
}): ArSpaceCorrectionHandle {
  const { store, arWorldGroup } = options;
  if (!(arWorldGroup instanceof THREE.Object3D)) {
    throw new TypeError(
      'enableArSpaceCorrection: arWorldGroup must be an Object3D'
    );
  }
  if (
    typeof store?.getState !== 'function' ||
    typeof store.subscribe !== 'function'
  ) {
    throw new TypeError(
      'enableArSpaceCorrection: store must have getState and subscribe'
    );
  }
  const registry = createArSpaceCorrectionRegistry({ group: arWorldGroup });
  registry.attach(store);
  const arContent = new THREE.Group();
  arContent.name = 'arContent';
  arWorldGroup.add(arContent);

  const containers = new WeakSet<THREE.Object3D>();
  const excluded = new WeakSet<THREE.Object3D>();
  const hints = new WeakMap<THREE.Object3D, TrackOptions>();
  const watched = new Set<THREE.Object3D>();

  const onChildAdded = (event: { child: THREE.Object3D }): void => {
    place(event.child);
  };
  const onChildRemoved = (event: { child: THREE.Object3D }): void => {
    leave(event.child);
  };

  function watch(node: THREE.Object3D): void {
    if (watched.has(node)) return;
    watched.add(node);
    node.addEventListener('childadded', onChildAdded);
    node.addEventListener('childremoved', onChildRemoved);
    for (const child of [...node.children]) place(child);
  }

  function unwatch(node: THREE.Object3D): void {
    if (!watched.delete(node)) return;
    node.removeEventListener('childadded', onChildAdded);
    node.removeEventListener('childremoved', onChildRemoved);
    for (const child of node.children) leave(child);
  }

  function place(child: THREE.Object3D): void {
    if (excluded.has(child)) return;
    if (containers.has(child)) {
      watch(child);
      return;
    }
    const hint = hints.get(child);
    hints.delete(child);
    registry.track(child, hint);
  }

  function leave(child: THREE.Object3D): void {
    if (containers.has(child)) unwatch(child);
    else registry.untrack(child);
  }

  watch(arContent);
  log.info(
    'AR content goes into arContent; children added to arWorldGroup ' +
      'directly are not corrected after a relocalization'
  );

  const arCorrection: ArSpaceCorrection = {
    track(object, opts = {}) {
      if (!(object instanceof THREE.Object3D)) {
        throw new TypeError('track: object must be an Object3D');
      }
      if (excluded.has(object) || containers.has(object)) {
        throw new TypeError(
          'track: the object is excluded or a container; neither is corrected'
        );
      }
      assertOptions(opts);
      if (isUnder(object, arWorldGroup)) {
        hints.delete(object);
        registry.track(object, opts);
      } else {
        hints.set(object, opts);
      }
    },
    untrack(object) {
      hints.delete(object);
      registry.untrack(object);
    },
    container(group) {
      if (!(group instanceof THREE.Object3D) || excluded.has(group)) {
        throw new TypeError('container: an Object3D that is not excluded');
      }
      if (containers.has(group)) return group;
      registry.untrack(group);
      hints.delete(group);
      containers.add(group);
      if (group.parent !== null && watched.has(group.parent)) watch(group);
      return group;
    },
    exclude(object) {
      if (!(object instanceof THREE.Object3D) || containers.has(object)) {
        throw new TypeError('exclude: an Object3D that is not a container');
      }
      excluded.add(object);
      hints.delete(object);
      registry.untrack(object);
    },
    attach(next) {
      return registry.attach(next);
    },
    dispose() {
      for (const node of watched) {
        node.removeEventListener('childadded', onChildAdded);
        node.removeEventListener('childremoved', onChildRemoved);
      }
      watched.clear();
      registry.dispose();
    },
  };
  return { arContent, arCorrection };
}
