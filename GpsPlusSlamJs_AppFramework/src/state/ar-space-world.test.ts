import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { recordGpsEvent, setZeroPos, type Matrix4 } from 'gps-plus-slam-js';
import { createSlamAppStore } from './create-slam-app-store';
import { NullStorageBackend } from '../storage/null-storage-backend';
import {
  relocalizationObserved,
  selectCorrectionTrack,
  type RelocalizationObservation,
} from './ar-space-correction-slice';
import { arSpaceWorldPose, selectArSpaceToWorld } from './ar-space-world';
import { poseToMatrix4 } from '../ar/ar-space-correction';

const STILL: RelocalizationObservation['lastPose'] = {
  position: [0, 1.6, 0],
  rotation: [0, 0, 0, 1],
};

function observation(t: number): RelocalizationObservation {
  return {
    t,
    tLast: t - 33,
    lastPose: STILL,
    tPrev: t - 66,
    prevPose: STILL,
    newPose: { position: [3, 1.6, 0], rotation: [0, 0, 0, 1] },
  };
}

const fix = (i: number) =>
  recordGpsEvent({
    odomPosition: [i, 0, 0],
    odomRotation: [0, 0, 0, 1],
    rawGpsPoint: {
      id: `fix-${i}`,
      latitude: 47.5 + i * 1e-5,
      longitude: 8.7,
      latLongAccuracy: 5,
      timestamp: 1756150000000 + i * 1000,
    },
  });

const newStore = () =>
  createSlamAppStore({ storageBackend: new NullStorageBackend() });

describe('ar-space-world', () => {
  it('the composed selector equals the alignment times the correction', () => {
    // Why this test matters: the composition is A * Delta(e), in that order:
    // the correction inside O first, the GPS alignment last.
    const store = newStore();
    store.dispatch(setZeroPos({ lat: 47.5, lon: 8.7 }));
    for (let i = 0; i < 6; i++) store.dispatch(fix(i));
    store.dispatch(relocalizationObserved(observation(1000)));
    const s = store.getState();
    const A = new THREE.Matrix4().fromArray([
      ...s.gpsData!.gpsEvents.alignmentMatrix,
    ]);
    const delta0 = new THREE.Matrix4().fromArray([
      ...poseToMatrix4(selectCorrectionTrack(s)[0]!),
    ]);
    const got = selectArSpaceToWorld(s, 0)!;
    const expected = A.clone().multiply(delta0).toArray();
    got.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 12));
    // Reference-stable per epoch while nothing changes.
    expect(selectArSpaceToWorld(s, 0)).toBe(got);
    expect(selectArSpaceToWorld(s, 1)).toEqual(A.toArray());
  });

  it('the composed selector is null before an alignment exists, and refuses an epoch outside 0..n', () => {
    // Why this test matters: a view must not place content with a made-up
    // alignment, and an epoch from another store is a programming error.
    const store = newStore();
    expect(selectArSpaceToWorld(store.getState(), 0)).toBeNull();
    expect(arSpaceWorldPose(store.getState(), STILL_MATRIX, 0)).toBeNull();
    expect(() => selectArSpaceToWorld(store.getState(), 1)).toThrow(RangeError);
    expect(() => selectArSpaceToWorld(store.getState(), -1)).toThrow(
      RangeError
    );
    expect(() => selectArSpaceToWorld(store.getState(), 0.5)).toThrow(
      RangeError
    );
  });

  it('arSpaceWorldPose equals A * Delta(e) * P * X_raw, and the other orders do not', () => {
    // Why this test matters: with non-commuting A, Delta and P, only the
    // stated order is right; the correction applied after A, or P left out,
    // gives a different pose.
    const A = new THREE.Matrix4().compose(
      new THREE.Vector3(5, 0, -2),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.7, 0)),
      new THREE.Vector3(1, 1, 1)
    );
    const P = new THREE.Matrix4().compose(
      new THREE.Vector3(0.3, 0, 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -1.2, 0.1)),
      new THREE.Vector3(1, 1, 1)
    );
    const X = new THREE.Matrix4().makeTranslation(1, 2, 3);
    const obs: RelocalizationObservation = {
      ...observation(1000),
      newPose: {
        position: [3, 1.6, 1],
        rotation: [0, Math.sin(0.2), 0, Math.cos(0.2)],
      },
    };
    const state = {
      gpsData: {
        gpsEvents: { alignmentMatrix: A.toArray() as unknown as Matrix4 },
      },
      arSpaceCorrection: { observations: [obs] },
    } as unknown as Parameters<typeof arSpaceWorldPose>[0];
    const D = new THREE.Matrix4().fromArray([
      ...poseToMatrix4(selectCorrectionTrack(state)[0]!),
    ]);
    const got = arSpaceWorldPose(
      state,
      X.toArray() as unknown as Matrix4,
      0,
      P.toArray() as unknown as Matrix4
    )!;
    const right = A.clone().multiply(D).multiply(P).multiply(X).toArray();
    got.forEach((v, i) => expect(v).toBeCloseTo(right[i]!, 10));
    const deltaAfterA = D.clone().multiply(A).multiply(P).multiply(X).toArray();
    const withoutP = A.clone().multiply(D).multiply(X).toArray();
    const maxDiff = (a: readonly number[], b: readonly number[]) =>
      Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
    expect(maxDiff(got, deltaAfterA)).toBeGreaterThan(1e-3);
    expect(maxDiff(got, withoutP)).toBeGreaterThan(1e-3);
    // P defaults to the identity.
    const noP = arSpaceWorldPose(state, X.toArray() as unknown as Matrix4, 0)!;
    noP.forEach((v, i) => expect(v).toBeCloseTo(withoutP[i]!, 10));
  });
});

const STILL_MATRIX = new THREE.Matrix4().toArray() as unknown as Matrix4;
