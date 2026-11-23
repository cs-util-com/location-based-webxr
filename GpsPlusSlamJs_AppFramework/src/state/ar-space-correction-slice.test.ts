import { describe, expect, it, vi } from 'vitest';
import { recordGpsEvent, setZeroPos } from 'gps-plus-slam-js';
import { createSlamAppStore } from './create-slam-app-store';
import { NullStorageBackend } from '../storage/null-storage-backend';
import { isSegmentingActionType } from './segmenting-actions';
import {
  UNIT_QUATERNION_TOLERANCE,
  arSpaceCorrectionReducer,
  relocalizationObserved,
  selectArSpaceCorrectionEpoch,
  selectArSpaceEpochAt,
  selectCorrectionTrack,
  type ArSpaceCorrectionState,
  type RelocalizationObservation,
} from './ar-space-correction-slice';
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

  describe('boundary validation', () => {
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

  it('epochAt via the store counts observations at or before the capture time', () => {
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

  it('GPS fixes leave the correction track reference-equal, and an observation leaves gpsData deeply equal', () => {
    // Why this test matters: the layers stay apart. The correction reads no
    // GPS state, and the alignment does not see the correction (yet).
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

  it('the action creator keeps only the six observation fields', () => {
    // Why this test matters: the payload is recorded as it is dispatched. A
    // feed that passes its own richer record would otherwise write extra,
    // possibly derived, fields into every recording.
    const base = observation(1000);
    const richer = {
      ...base,
      corrected: { position: [9, 9, 9] },
      debugLabel: 'x',
      // A pose with its own extra field (a covariance) is cut down too.
      newPose: { ...base.newPose, covariance: [1, 2, 3] },
    } as RelocalizationObservation;
    const action = relocalizationObserved(richer);
    expect(Object.keys(action.payload).sort()).toEqual(
      ['lastPose', 'newPose', 'prevPose', 't', 'tLast', 'tPrev'].sort()
    );
    expect(action.payload).toEqual(observation(1000));
    // A missing payload still reaches the reducer, which refuses it.
    expect(
      relocalizationObserved(undefined as unknown as RelocalizationObservation)
        .payload
    ).toBeUndefined();
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

describe('arSpaceCorrection slice: the stored observation owns its numbers', () => {
  it('copies the caller arrays, so a feed reusing scratch arrays cannot change recorded state', () => {
    // Why this test matters: the track is memoised on the observations; a
    // feed that rewrites its scratch arrays after dispatching would silently
    // change a recorded raw value behind a stale track.
    const store = newStore();
    const position: [number, number, number] = [3, 1.6, 0];
    const rotation: [number, number, number, number] = [0, 0, 0, 1];
    store.dispatch(
      relocalizationObserved({
        ...observation(1000),
        newPose: { position, rotation },
      })
    );
    position[0] = 99;
    rotation[3] = -1;
    const stored = store.getState().arSpaceCorrection.observations[0]!;
    expect(stored.newPose.position).toEqual([3, 1.6, 0]);
    expect(stored.newPose.rotation).toEqual([0, 0, 0, 1]);
  });
});
