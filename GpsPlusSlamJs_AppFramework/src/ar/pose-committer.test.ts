import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { claimPose, poseCommitterOf, releasePose } from './pose-committer';

describe('pose-committer', () => {
  it('lets one committer claim an object and refuses a second one', () => {
    // Why this test matters: two systems writing one object's transform
    // (an anchor and the AR-space correction) would apply a correction twice
    // or undo each other; the claim makes that a thrown error at the call.
    const o = new THREE.Object3D();
    claimPose(o, 'GPS anchor');
    expect(poseCommitterOf(o)).toBe('GPS anchor');
    expect(() => claimPose(o, 'AR-space correction')).toThrow(/GPS anchor/);
    releasePose(o, 'GPS anchor');
    expect(poseCommitterOf(o)).toBeNull();
    claimPose(o, 'AR-space correction');
    expect(poseCommitterOf(o)).toBe('AR-space correction');
  });

  it('refuses a claim inside, or holding, a claimed object, whoever holds it', () => {
    // Why this test matters: a pose carries to every descendant, so a claim
    // nested in another one applies two corrections to the inner object.
    const outer = new THREE.Group();
    const mid = new THREE.Group();
    const inner = new THREE.Object3D();
    outer.add(mid);
    mid.add(inner);
    claimPose(mid, 'deferred anchor');
    expect(() => claimPose(inner, 'deferred anchor')).toThrow(/nested/);
    expect(() => claimPose(outer, 'AR-space correction')).toThrow(/nested/);
    expect(() => claimPose(mid, 'deferred anchor')).toThrow(/already/);
    releasePose(mid, 'deferred anchor');
    claimPose(inner, 'AR-space correction');
    claimPose(new THREE.Object3D(), 'AR-space correction');
  });

  it('releases only its own claim', () => {
    // Why this test matters: a late cleanup of one committer must not free
    // an object another committer holds now.
    const o = new THREE.Object3D();
    claimPose(o, 'GPS anchor');
    releasePose(o, 'AR-space correction');
    expect(poseCommitterOf(o)).toBe('GPS anchor');
    releasePose(o, 'GPS anchor');
    releasePose(o, 'GPS anchor');
    expect(poseCommitterOf(o)).toBeNull();
  });
});
