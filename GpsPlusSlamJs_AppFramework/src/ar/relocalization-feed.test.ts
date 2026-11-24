import { afterEach, describe, expect, it } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import {
  arSpaceCorrectionReducer,
  type RelocalizationObservation,
} from '../state/ar-space-correction-slice';
import type { Pose } from './qr/qr-pose';
import {
  RELOCALIZATION_MAX_GAP_MS,
  createRelocalizationFeed,
  rawCameraPose,
  relocalizationJumpVerdict,
  startRelocalizationFeed,
} from './relocalization-feed';
import { clearXrFrameUpdates, runXrFrameUpdates } from './xr-frame-loop';
import { LogLevel, subscribeToLogs } from '../utils/logger';

const newStore = () =>
  configureStore({ reducer: { arSpaceCorrection: arSpaceCorrectionReducer } });

const at = (x: number, z = 0): Pose => ({
  position: [x, 1.5, z],
  rotation: [0, 0, 0, 1],
});

function feedWith(store: ReturnType<typeof newStore> | null = newStore()) {
  const calls: string[] = [];
  const observed: RelocalizationObservation[] = [];
  const feed = createRelocalizationFeed({
    getStore: () =>
      store === null
        ? null
        : {
            dispatch: (action) => {
              calls.push('dispatch');
              return store.dispatch(action);
            },
          },
    beforeDispatch: () => calls.push('before'),
    onObserved: (o) => observed.push(o),
  });
  return { feed, store, calls, observed };
}

const observationsOf = (store: ReturnType<typeof newStore>) =>
  store.getState().arSpaceCorrection.observations;

afterEach(() => clearXrFrameUpdates());

describe('relocalizationJumpVerdict (the library rule, local copy)', () => {
  it('a step strictly over 1 m is a jump, a gap over 500 ms cannot be judged, the first pose is no jump', () => {
    // Why this test matters: this copy must answer exactly as the library's
    // rawPoseJumpVerdict until the feed switches to it; the gap rule keeps a
    // 0.7 s stall at walking speed from reading as a jump.
    expect(relocalizationJumpVerdict(null, [0, 0, 0], NaN)).toBe('no-jump');
    expect(relocalizationJumpVerdict([0, 0, 0], [1, 0, 0], 33)).toBe('no-jump');
    expect(relocalizationJumpVerdict([0, 0, 0], [1.0001, 0, 0], 33)).toBe(
      'jump'
    );
    expect(relocalizationJumpVerdict([0, 0, 0], [0.8, 0.8, 0], 33)).toBe(
      'jump'
    );
    expect(
      relocalizationJumpVerdict([0, 0, 0], [5, 0, 0], RELOCALIZATION_MAX_GAP_MS)
    ).toBe('jump');
    expect(
      relocalizationJumpVerdict(
        [0, 0, 0],
        [5, 0, 0],
        RELOCALIZATION_MAX_GAP_MS + 1
      )
    ).toBe('cannot-judge');
  });

  it('throws a RangeError on malformed input', () => {
    // Why this test matters: a caller bug must be loud; the feed catches it.
    expect(() => relocalizationJumpVerdict([0, 0], [0, 0, 0], 33)).toThrow(
      RangeError
    );
    expect(() => relocalizationJumpVerdict([0, 0, 0], [NaN, 0, 0], 33)).toThrow(
      RangeError
    );
    expect(() => relocalizationJumpVerdict([0, 0, 0], [0, 0, 0], -1)).toThrow(
      RangeError
    );
    expect(() =>
      relocalizationJumpVerdict([0, 0, 0], [0, 0, 0], 33, 0)
    ).toThrow(RangeError);
  });
});

describe('createRelocalizationFeed', () => {
  it('a 3 m frame switch dispatches one raw observation with the jump frame and the two frames before it', () => {
    // Why this test matters: the correction is derived from these raw
    // fields alone (the jump frame's own time and pose), and the QR fold
    // must close its burst before the store sees the new frame.
    const { feed, store, calls, observed } = feedWith();
    feed.frame(1000, at(0));
    feed.frame(1033, at(0.05));
    feed.frame(1066, at(3.1));
    const obs = observationsOf(store!);
    expect(obs).toEqual([
      {
        t: 1066,
        tLast: 1033,
        lastPose: at(0.05),
        tPrev: 1000,
        prevPose: at(0),
        newPose: at(3.1),
      },
    ]);
    expect(calls).toEqual(['before', 'dispatch']);
    expect(observed).toEqual(obs);
  });

  it('walking frames never dispatch', () => {
    // Why this test matters: a false jump would move every placed object.
    const { feed, store } = feedWith();
    for (let i = 0; i < 300; i++) feed.frame(1000 + i * 33, at(i * 0.05));
    expect(observationsOf(store!)).toEqual([]);
  });

  it('nothing is dispatched across a lost pose, a forget, or a gap over 500 ms, whatever the distance', () => {
    // Why this test matters: a jump across a tracking loss, recovery or
    // origin reset is not a relocalization the correction may apply.
    const { feed, store } = feedWith();
    feed.frame(1000, at(0));
    feed.frame(1033, null);
    feed.frame(1066, at(10));
    feed.forget();
    feed.frame(1099, at(20));
    feed.frame(1099 + RELOCALIZATION_MAX_GAP_MS + 1, at(40));
    feed.frame(1099 + RELOCALIZATION_MAX_GAP_MS + 34, at(40.05));
    expect(observationsOf(store!)).toEqual([]);
    // The rule still works after each of them.
    feed.frame(2000, at(45));
    expect(observationsOf(store!)).toHaveLength(1);
  });

  it('after a jump the next observation never mixes in a frame from before it', () => {
    // Why this test matters: prevPose of the next jump must be in the same
    // raw frame as its lastPose, or the compensation reads the jump as motion.
    const { feed, store } = feedWith();
    feed.frame(1000, at(0));
    feed.frame(1033, at(0));
    feed.frame(1066, at(3));
    feed.frame(1099, at(7));
    const obs = observationsOf(store!);
    expect(obs).toHaveLength(2);
    expect(obs[1]).toMatchObject({ tLast: 1066, tPrev: null, prevPose: null });
  });

  it('copies the poses it keeps, so a caller reusing its arrays changes nothing', () => {
    // Why this test matters: a frame source may reuse scratch arrays.
    const { feed, store } = feedWith();
    const scratch = {
      position: [0, 1.5, 0] as [number, number, number],
      rotation: [0, 0, 0, 1] as [number, number, number, number],
    };
    feed.frame(1000, scratch);
    scratch.position[0] = 3;
    feed.frame(1033, scratch);
    expect(observationsOf(store!)[0]!.lastPose.position).toEqual([0, 1.5, 0]);
  });

  it('a clock that does not advance, a non-finite pose or time starts over without throwing', () => {
    // Why this test matters: the frame loop must never see a throw.
    const { feed, store } = feedWith();
    feed.frame(1000, at(0));
    expect(() => feed.frame(1000, at(5))).not.toThrow();
    expect(() => feed.frame(NaN, at(5))).not.toThrow();
    expect(() =>
      feed.frame(1033, { position: [Infinity, 0, 0], rotation: [0, 0, 0, 1] })
    ).not.toThrow();
    feed.frame(1066, at(9));
    expect(observationsOf(store!)).toEqual([]);
    expect(feed.isStopped()).toBe(false);
  });

  it('dispatches into the store current at the jump and drops the jump with a warning when there is none', () => {
    // Why this test matters: the recorder swaps its store per recording; an
    // observation in a stale store would be missing from the recording.
    let current: ReturnType<typeof newStore> | null = newStore();
    const first = current;
    const feed = createRelocalizationFeed({ getStore: () => current });
    feed.frame(1000, at(0));
    current = newStore();
    feed.frame(1033, at(3));
    expect(observationsOf(first)).toEqual([]);
    expect(observationsOf(current)).toHaveLength(1);
    current = null;
    const warnings: string[] = [];
    const off = subscribeToLogs((e) => {
      if (e.level === LogLevel.WARN) warnings.push(e.message);
    });
    expect(() => feed.frame(1066, at(6))).not.toThrow();
    off();
    expect(warnings.join('\n')).toMatch(/no store/);
  });

  it('a fault in the jump rule itself switches the feed off once, logged, and never throws into the frame loop', () => {
    // Why this test matters: the feature must never break a recording; a
    // fault it cannot attribute to one hook stops it for the session.
    const feed = createRelocalizationFeed({
      getStore: () => {
        throw new Error('getStore broke');
      },
    });
    const errors: string[] = [];
    const off = subscribeToLogs((e) => {
      if (e.level === LogLevel.ERROR) errors.push(e.message);
    });
    feed.frame(1000, at(0));
    expect(() => feed.frame(1033, at(3))).not.toThrow();
    expect(() => feed.frame(1066, at(6))).not.toThrow();
    off();
    expect(feed.isStopped()).toBe(true);
    expect(errors.filter((m) => /getStore broke/.test(m))).toHaveLength(1);
  });

  it('a throwing dispatch, beforeDispatch or onObserved is logged once each and the feed goes on', () => {
    // Why this test matters: one faulty hook (a QR fold, a store
    // subscriber) must not stop recording every later relocalization, and
    // a failing beforeDispatch must not cost the jump itself.
    const store = newStore();
    let dispatchFails = true;
    const feed = createRelocalizationFeed({
      getStore: () => ({
        dispatch: (action) => {
          const result = store.dispatch(action);
          // As a throwing store subscriber does: the state is updated first.
          if (dispatchFails) throw new Error('subscriber broke');
          return result;
        },
      }),
      beforeDispatch: () => {
        throw new Error('fold broke');
      },
      onObserved: () => {
        throw new Error('observer broke');
      },
    });
    const errors: string[] = [];
    const off = subscribeToLogs((e) => {
      if (e.level === LogLevel.ERROR) errors.push(e.message);
    });
    feed.frame(1000, at(0));
    feed.frame(1033, at(3));
    feed.frame(1066, at(6));
    dispatchFails = false;
    feed.frame(1099, at(9));
    off();
    expect(feed.isStopped()).toBe(false);
    expect(observationsOf(store).map((o) => o.t)).toEqual([1033, 1066, 1099]);
    for (const what of [/subscriber broke/, /fold broke/, /observer broke/]) {
      expect(errors.filter((m) => what.test(m))).toHaveLength(1);
    }
  });

  it('logs one readout line per observation with |D|, degrees and the compensation reason', () => {
    // Why this test matters: the copy-log line is how a field recording
    // tells what was corrected and measures the phone's still noise.
    const { feed } = feedWith();
    const infos: string[] = [];
    const off = subscribeToLogs((e) => {
      if (e.tag === 'ArSpaceCorrection' && e.level === LogLevel.INFO) {
        infos.push(e.message);
      }
    });
    feed.frame(1000, at(0));
    feed.frame(1033, at(0));
    feed.frame(1066, at(3));
    off();
    expect(infos).toHaveLength(1);
    expect(infos[0]).toMatch(
      /\|D\| 3\.000 m, 0\.00 deg; compensation off \(still; camera step 0\.0 mm, turn 0\.00 deg\); frame gap 33 ms/
    );
  });

  it('says in the readout line when the dispatch failed, and only then', () => {
    // Why this test matters: the readout line is what a field diagnosis
    // reads to tell whether a jump reached the recording. The dispatch
    // failure is logged once per session, so without this every later
    // failed jump would read as recorded.
    const store = newStore();
    let dispatchFails = true;
    const feed = createRelocalizationFeed({
      getStore: () => ({
        dispatch: (action) => {
          if (dispatchFails) throw new Error('store broke');
          return store.dispatch(action);
        },
      }),
    });
    const infos: string[] = [];
    const off = subscribeToLogs((e) => {
      if (e.tag === 'ArSpaceCorrection' && e.level === LogLevel.INFO) {
        infos.push(e.message);
      }
    });
    feed.frame(1000, at(0));
    feed.frame(1033, at(3));
    feed.frame(1066, at(6));
    dispatchFails = false;
    feed.frame(1099, at(9));
    off();
    const notRecorded = '; NOT recorded (the dispatch failed)';
    expect(infos.map((m) => m.endsWith(notRecorded))).toEqual([
      true,
      true,
      false,
    ]);
    expect(observationsOf(store).map((o) => o.t)).toEqual([1099]);
  });

  it('rejects a missing getStore', () => {
    // Why this test matters: a wiring mistake must fail at setup, not later.
    expect(() =>
      createRelocalizationFeed({} as unknown as { getStore: () => null })
    ).toThrow(TypeError);
  });
});

describe('startRelocalizationFeed (XR frames)', () => {
  const viewer = (x: number, emulatedPosition = false) => ({
    emulatedPosition,
    views: [
      {
        transform: {
          position: { x, y: 1.5, z: 0 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        },
      },
    ],
  });
  function tick(elapsedS: number, pose: ReturnType<typeof viewer> | null) {
    runXrFrameUpdates({
      frame: { getViewerPose: () => pose } as unknown as XRFrame,
      referenceSpace: {} as XRReferenceSpace,
      session: {} as XRSession,
      dt: 0.033,
      elapsed: elapsedS,
    });
  }

  it('reads the viewer pose of each frame, stamped timeOrigin + XR time, and ignores emulated poses', () => {
    // Why this test matters: the observation time must be on the clock of
    // the captures' capturedAt, or tiles land in the wrong epoch.
    const store = newStore();
    const feed = startRelocalizationFeed({
      getStore: () => store,
      timeOriginMs: 1_700_000_000_000,
    });
    tick(10, viewer(0));
    tick(10.033, viewer(3, true));
    tick(10.066, viewer(6));
    expect(observationsOf(store)).toEqual([]);
    tick(10.099, viewer(9));
    const obs = observationsOf(store);
    expect(obs).toHaveLength(1);
    expect(obs[0]!.t).toBeCloseTo(1_700_000_010_099, 3);
    feed.dispose();
    tick(10.132, viewer(20));
    expect(observationsOf(store)).toHaveLength(1);
  });

  it('a viewer pose that throws forgets the earlier pose and warns once per run of failures', () => {
    // Why this test matters: a jump must never be judged across a frame
    // whose pose is unknown, and a browser stuck failing every frame must
    // not flood the 100-entry copy-log buffer.
    const store = newStore();
    startRelocalizationFeed({ getStore: () => store, timeOriginMs: 0 });
    const broken = () =>
      runXrFrameUpdates({
        frame: {
          getViewerPose: () => {
            throw new Error('no pose');
          },
        } as unknown as XRFrame,
        referenceSpace: {} as XRReferenceSpace,
        session: {} as XRSession,
        dt: 0.033,
        elapsed: 1.033,
      });
    const warnings: string[] = [];
    const off = subscribeToLogs((e) => {
      if (e.level === LogLevel.WARN) warnings.push(e.message);
    });
    tick(1, viewer(0));
    broken();
    broken();
    tick(1.1, viewer(3));
    broken();
    off();
    expect(observationsOf(store)).toEqual([]);
    expect(
      warnings.filter((m) => /viewer pose unreadable/.test(m))
    ).toHaveLength(2);
  });

  it('a viewer pose that throws is a skipped frame', () => {
    // Why this test matters: a browser quirk must not stop the frame loop.
    const store = newStore();
    startRelocalizationFeed({ getStore: () => store, timeOriginMs: 0 });
    expect(() =>
      runXrFrameUpdates({
        frame: {
          getViewerPose: () => {
            throw new Error('no pose');
          },
        } as unknown as XRFrame,
        referenceSpace: {} as XRReferenceSpace,
        session: {} as XRSession,
        dt: 0,
        elapsed: 1,
      })
    ).not.toThrow();
  });

  it('rawCameraPose: null for no pose, an emulated pose or no view', () => {
    // Why this test matters: a 3DoF fallback pose must never be judged.
    expect(rawCameraPose(null)).toBeNull();
    expect(rawCameraPose(viewer(1, true))).toBeNull();
    expect(rawCameraPose({ views: [] })).toBeNull();
    expect(rawCameraPose(viewer(1))).toEqual(at(1));
  });
});
