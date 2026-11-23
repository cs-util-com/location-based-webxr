/**
 * The one-committer rule through the real anchor APIs: a scene object is
 * moved by the AR-space correction, by a deferred anchor or by a GPS anchor,
 * never by two of them.
 */
import '../test-setup';
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createArSpaceCorrectionRegistry } from './ar-space-correction-registry';
import { deferredAnchor } from './deferred-anchors';
import { __resetAnchorReleaseForTests } from './anchor-release';
import { clearFrameUpdates } from './frame-loop';
import {
  clearSessionDisposers,
  runSessionDisposers,
} from './session-disposers';
import { poseCommitterOf } from './pose-committer';
import { enableArWorldGroupAlignment } from '../visualization/ar-world-group-alignment';
import { createGpsAnchor } from '../visualization/gps-anchor';
import { createSlamAppStore } from '../state/create-slam-app-store';
import { NullStorageBackend } from '../storage/null-storage-backend';

afterEach(() => {
  runSessionDisposers();
  clearSessionDisposers();
  clearFrameUpdates();
  __resetAnchorReleaseForTests();
});

function session() {
  const store = createSlamAppStore({
    storageBackend: new NullStorageBackend(),
  });
  const arWorldGroup = new THREE.Group();
  enableArWorldGroupAlignment({ store, arWorldGroup });
  const registry = createArSpaceCorrectionRegistry({ group: arWorldGroup });
  registry.attach(store);
  return { arWorldGroup, registry, store };
}

const gpsAnchorOn = (arWorldGroup: THREE.Group, object3D: THREE.Object3D) =>
  createGpsAnchor({
    arWorldGroup,
    object3D,
    camera: new THREE.PerspectiveCamera(),
    gpsPoint: { lat: 48, lon: 11 },
    getAlignmentMatrix: () => null,
    getGpsZeroRef: () => ({ lat: 48, lon: 11 }),
    getCurrentGpsPoint: () => ({ lat: 48, lon: 11 }),
  });

describe('AR-space correction and the anchors: one committer per object', () => {
  it('a deferred-anchor root cannot be tracked until the anchor lets it go', () => {
    // Why this test matters: an anchored root re-fitted by its anchor AND
    // moved by the correction would receive every jump twice.
    const { arWorldGroup, registry } = session();
    const root = new THREE.Object3D();
    deferredAnchor(arWorldGroup, 'poster').add(root);
    expect(() => registry.track(root)).toThrow(/deferred anchor/);
    deferredAnchor(arWorldGroup, 'poster').remove(root);
    arWorldGroup.add(root);
    registry.track(root);
    expect(poseCommitterOf(root)).toBe('AR-space correction');
  });

  it('a tracked object cannot join a deferred anchor until it is untracked, and dispose frees every object', () => {
    // Why this test matters: the reverse direction of the rule, and the
    // release at teardown that lets the next session anchor the object.
    const { arWorldGroup, registry } = session();
    const coin = new THREE.Object3D();
    arWorldGroup.add(coin);
    registry.track(coin);
    expect(() => deferredAnchor(arWorldGroup, 'poster').add(coin)).toThrow(
      /AR-space correction/
    );
    registry.dispose();
    expect(poseCommitterOf(coin)).toBeNull();
    deferredAnchor(arWorldGroup, 'poster').add(coin);
    expect(poseCommitterOf(coin)).toBe('deferred anchor');
  });

  it('createGpsAnchor refuses a tracked object, and the registry refuses a GPS-anchored one', () => {
    // Why this test matters: a GPS anchor writes the object's pose from the
    // alignment every frame; the correction must not write it as well.
    const { arWorldGroup, registry } = session();
    const coin = new THREE.Object3D();
    arWorldGroup.add(coin);
    registry.track(coin);
    expect(() => gpsAnchorOn(arWorldGroup, coin)).toThrow(
      /AR-space correction/
    );
    registry.untrack(coin);
    const anchor = gpsAnchorOn(arWorldGroup, coin);
    expect(() => registry.track(coin)).toThrow(/GPS anchor/);
    anchor.dispose();
    registry.track(coin);
    expect(poseCommitterOf(coin)).toBe('AR-space correction');
  });

  it('a root removed from one deferred-anchor key can join another key', () => {
    // Why this test matters: the claim is released on removal, so moving a
    // root between keys does not leave a stale claim behind.
    const { arWorldGroup } = session();
    const root = new THREE.Object3D();
    deferredAnchor(arWorldGroup, 'first').add(root);
    deferredAnchor(arWorldGroup, 'first').remove(root);
    expect(poseCommitterOf(root)).toBeNull();
    deferredAnchor(arWorldGroup, 'second').add(root);
    expect(poseCommitterOf(root)).toBe('deferred anchor');
  });
});

describe('deferred anchors check where the root is going', () => {
  it('a root added under an object the correction tracks is refused, and stays where it was', () => {
    // Why this test matters: the anchor writes the root's matrix while the
    // correction moves its tracked ancestor; both together apply every jump
    // twice. The claim must look at the parent the root is about to get.
    const { arWorldGroup, registry, store } = session();
    const chest = new THREE.Group();
    arWorldGroup.add(chest);
    registry.track(chest);
    enableArWorldGroupAlignment({ store, arWorldGroup: chest });
    const root = new THREE.Object3D();
    expect(() => deferredAnchor(chest, 'x').add(root)).toThrow(
      /AR-space correction/
    );
    expect(root.parent).toBeNull();
    expect(poseCommitterOf(root)).toBeNull();
  });

  it('a root leaving a tracked object for an anchor is accepted: its old parent no longer matters', () => {
    // Why this test matters: the claim must judge the chain the root will
    // live in; its old chain would refuse a move that ends the overlap.
    const { arWorldGroup, registry } = session();
    const chest = new THREE.Group();
    arWorldGroup.add(chest);
    registry.track(chest);
    const root = new THREE.Object3D();
    chest.add(root);
    deferredAnchor(arWorldGroup, 'poster').add(root);
    expect(root.parent).toBe(arWorldGroup);
    expect(poseCommitterOf(root)).toBe('deferred anchor');
  });
});
