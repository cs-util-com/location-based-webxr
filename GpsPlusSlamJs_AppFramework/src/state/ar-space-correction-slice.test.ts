import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { recordGpsEvent, setZeroPos, type Matrix4 } from 'gps-plus-slam-js';
import { createSlamAppStore } from './create-slam-app-store';
import { NullStorageBackend } from '../storage/null-storage-backend';
import { isSegmentingActionType } from './segmenting-actions';
import {
  UNIT_QUATERNION_TOLERANCE,
  arSpaceCorrectionReducer,
  arSpaceWorldPose,
  relocalizationObserved,
  selectArSpaceCorrectionEpoch,
  selectArSpaceEpochAt,
  selectArSpaceToWorld,
  selectCorrectionTrack,
  type ArSpaceCorrectionState,
  type RelocalizationObservation,
} from './ar-space-correction-slice';
import { poseToMatrix4 } from '../ar/ar-space-correction';
import { LogLevel, subscribeToLogs } from '../utils/logger';

const ID: RelocalizationObservation['lastPose'] = {
  position: [0, 1.6, 0],
  rotation: [0, 0, 0, 1],
};

function observation(t: number, shiftX = 3): RelocalizationObservation {
  return {
    t,
    tLast: t - 33,
    lastPose: ID,
    tPrev: t - 66,
    prevPose: ID,
    newPose: { position: [shiftX, 1.6, 0], rotation: [0, 0, 0, 1] },
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

describe('arSpaceCorrection slice', () => {
  it('stores each valid observation raw, in arrival order', () => {
    // Why this test matters: the slice is the single source of truth of the
    // correction; it holds the raw observations and nothing derived.
    const store = newStore();
    store.dispatch(relocalizationObserved(observation(1000)));
    store.dispatch(relocalizationObserved(observation(2000, 1)));
    expect(store.getState().arSpaceCorrection.observations).toEqual([
      observation(1000),
      observation(2000, 1),
    ]);
    expect(selectArSpaceCorrectionEpoch(store.getState())).toBe(2);
  });

  it('accepts an observation without an earlier frame (tPrev and prevPose null)', () => {
    // Why this test matters: the first frames of a session have no frame
    // before the last one; the absence is explicit, never a fake pose.
    const s = arSpaceCorrectionReducer(
      undefined,
      relocalizationObserved({
        ...observation(1000),
        tPrev: null,
        prevPose: null,
      })
    );
    expect(s.observations).toHaveLength(1);
  });

  describe('U8 boundary validation', () => {
    const bad: Array<[string, unknown]> = [
      ['a NaN time', { ...observation(1000), t: Number.NaN }],
      [
        'an infinite position',
        {
          ...observation(1000),
          newPose: { position: [Infinity, 0, 0], rotation: [0, 0, 0, 1] },
        },
      ],
      [
        'a zero quaternion',
        {
          ...observation(1000),
          lastPose: { position: [0, 0, 0], rotation: [0, 0, 0, 0] },
        },
      ],
      [
        'a non-unit quaternion',
        {
          ...observation(1000),
          newPose: {
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1 + 10 * UNIT_QUATERNION_TOLERANCE],
          },
        },
      ],
      [
        'a short position',
        {
          ...observation(1000),
          newPose: { position: [0, 0], rotation: [0, 0, 0, 1] },
        },
      ],
      ['tLast not before t', { ...observation(1000), tLast: 1000 }],
      ['tPrev not before tLast', { ...observation(1000), tPrev: 967 }],
      ['prevPose without tPrev', { ...observation(1000), tPrev: null }],
      ['tPrev without prevPose', { ...observation(1000), prevPose: null }],
      ['a missing payload', undefined],
    ];
    it.each(bad)(
      'refuses %s with a logged reason, never throwing',
      (_, payload) => {
        // Why this test matters: the feed dispatches from the XR frame loop;
        // bad input must leave the state unchanged and say why, and a replay
        // of the same bad action must refuse it the same way.
        const warn = vi.fn();
        const unsubscribe = subscribeToLogs((entry) => {
          if (
            entry.tag === 'ArSpaceCorrection' &&
            entry.level === LogLevel.WARN
          ) {
            warn(entry.message);
          }
        });
        const before: ArSpaceCorrectionState = { observations: [] };
        const after = arSpaceCorrectionReducer(
          before,
          relocalizationObserved(payload as RelocalizationObservation)
        );
        expect(after).toBe(before);
        expect(warn).toHaveBeenCalledTimes(1);
        unsubscribe();
      }
    );

    it('refuses an observation earlier than the previous one', () => {
      // Why this test matters: epochs count observations by time; an
      // out-of-order time would make epochAt's binary search wrong.
      const store = newStore();
      store.dispatch(relocalizationObserved(observation(2000)));
      store.dispatch(relocalizationObserved(observation(1000)));
      expect(selectArSpaceCorrectionEpoch(store.getState())).toBe(1);
      store.dispatch(relocalizationObserved(observation(2000)));
      expect(selectArSpaceCorrectionEpoch(store.getState())).toBe(2);
    });
  });

  it('U10 via the store: epochAt counts observations at or before the capture time', () => {
    // Why this test matters: the selector form is what tiles, depth samples
    // and QR sightings will call with their capture time.
    const store = newStore();
    store.dispatch(relocalizationObserved(observation(1000)));
    store.dispatch(relocalizationObserved(observation(2000)));
    const s = store.getState();
    expect(selectArSpaceEpochAt(s, 999)).toBe(0);
    expect(selectArSpaceEpochAt(s, 1000)).toBe(1);
    expect(selectArSpaceEpochAt(s, 1999)).toBe(1);
    expect(selectArSpaceEpochAt(s, 5000)).toBe(2);
  });

  it('U6: GPS fixes leave the correction track reference-equal, and an observation leaves gpsData deeply equal', () => {
    // Why this test matters: the layers stay apart. The correction reads no
    // GPS state, and in M1 the alignment does not see the correction at all.
    const store = newStore();
    store.dispatch(setZeroPos({ lat: 47.5, lon: 8.7 }));
    store.dispatch(fix(0));
    store.dispatch(relocalizationObserved(observation(1000)));
    const track = selectCorrectionTrack(store.getState());
    store.dispatch(fix(1));
    store.dispatch(fix(2));
    expect(selectCorrectionTrack(store.getState())).toBe(track);

    const gpsBefore = structuredClone(store.getState().gpsData);
    store.dispatch(relocalizationObserved(observation(3000)));
    expect(store.getState().gpsData).toEqual(gpsBefore);
    expect(selectCorrectionTrack(store.getState())).not.toBe(track);
    expect(selectCorrectionTrack(store.getState())).toHaveLength(3);
  });

  it('U6: the composed selector equals the alignment times the correction', () => {
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
    expect(() => selectArSpaceToWorld(store.getState(), 1)).toThrow(RangeError);
    expect(() => selectArSpaceToWorld(store.getState(), -1)).toThrow(
      RangeError
    );
    expect(() => selectArSpaceToWorld(store.getState(), 0.5)).toThrow(
      RangeError
    );
  });

  it('U3: arSpaceWorldPose equals A * Delta(e) * P * X_raw, and the other orders do not', () => {
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

  it('is a segmenting action', () => {
    // Why this test matters: QR folds segment and the Tour Viewer join
    // declines at it; both read the one shared list.
    expect(isSegmentingActionType(relocalizationObserved.type)).toBe(true);
  });

  it('is recorded: the persistence whitelist carries its prefix', async () => {
    // Why this test matters: the observation is raw data the recordings
    // must hold, or a replay cannot re-derive the correction.
    const written: string[] = [];
    const backend = new NullStorageBackend();
    const spy = vi
      .spyOn(backend, 'writeAction')
      .mockImplementation((action: unknown) => {
        written.push((action as { type: string }).type);
        return Promise.resolve();
      });
    const store = createSlamAppStore({
      storageBackend: backend,
      persistWhile: () => true,
    });
    store.dispatch(relocalizationObserved(observation(1000)));
    await store.flushPendingActionWrites();
    expect(written).toContain(relocalizationObserved.type);
    spy.mockRestore();
  });
});
