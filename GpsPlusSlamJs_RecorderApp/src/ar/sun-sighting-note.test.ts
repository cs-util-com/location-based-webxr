import { describe, expect, it } from 'vitest';
import { recordDiagnostic } from 'gps-plus-slam-app-framework/state';

import {
  createSunSightingRecorder,
  SUN_SIGHTING_KIND,
  type SunSighting,
} from './sun-sighting-note';

const sighting = (atMs = 1_700_000_000_500): SunSighting =>
  ({
    schema: 1,
    mode: 'reticle',
    atMs,
    windowStartMs: atMs - 500,
    frames: 30,
    spreadDeg: 0.1,
    rayXrX: 0.1,
    rayXrY: 0.2,
    rayXrZ: -0.97,
    viewQx: 0,
    viewQy: 0,
    viewQz: 0,
    viewQw: 1,
    projP0: 1.5,
    projP5: 2.7,
    projP8: 0,
    projP9: 0,
    viewportW: 1080,
    viewportH: 2400,
    screenAngleDeg: 0,
    displayedYawDeg: 12,
    yawMinDeg: 12,
    yawMaxDeg: 12,
    targetYawDeg: null,
    targetChanged: false,
    lat: 50.9,
    lng: 6.9,
    sunAzDeg: 250,
    sunElApparentDeg: 12,
    refractionDeg: 0.07,
    pressureHPa: 1010,
    temperatureC: 10,
    clockOffsetMs: 3,
    headingErrDeg: 1.8,
    elevationErrDeg: -0.2,
    separationDeg: 1.81,
  }) satisfies SunSighting;

function fakeStore(isRecording: boolean | undefined) {
  const dispatched: unknown[] = [];
  return {
    dispatched,
    getState: () =>
      isRecording === undefined ? {} : { recording: { isRecording } },
    dispatch: (action: unknown) => {
      dispatched.push(action);
      return action;
    },
  };
}

describe('createSunSightingRecorder', () => {
  // WHY: the sighting is only worth logging if it reaches the recording's
  // zip, where M5 re-derives the heading error for every solver preset. The
  // note is the framework's built-in, already persisted `diagnostics/note`.
  it('dispatches one sun-sighting note with the sighting flat, at its middle frame', () => {
    const store = fakeStore(true);
    const record = createSunSightingRecorder({
      getStore: () => store,
      isStopInProgress: () => false,
      isReplaying: () => false,
    });
    const s = sighting();
    expect(record(s)).toBe('recorded');
    expect(store.dispatched).toEqual([
      recordDiagnostic({
        kind: SUN_SIGHTING_KIND,
        atMs: s.atMs,
        detail: { ...s },
      }),
    ]);
    expect(SUN_SIGHTING_KIND).toBe('sun-sighting');
  });

  // WHY: the persistence middleware drops actions outside a recording
  // silently; the UI has to say "not recorded" instead of implying it was.
  it('does not dispatch outside a recording, and says so', () => {
    for (const state of [false, undefined]) {
      const store = fakeStore(state);
      const record = createSunSightingRecorder({
        getStore: () => store,
        isStopInProgress: () => false,
        isReplaying: () => false,
      });
      expect(record(sighting())).toBe('not-recording');
      expect(store.dispatched).toEqual([]);
    }
  });

  // WHY: Stop flushes the action writes, THEN exports the zip, and only
  // then ends the session; a note dispatched in between passes the
  // isRecording gate but can miss the zip (stop-recording.ts).
  it('does not dispatch while a stop is in progress', () => {
    const store = fakeStore(true);
    const record = createSunSightingRecorder({
      getStore: () => store,
      isStopInProgress: () => true,
      isReplaying: () => false,
    });
    expect(record(sighting())).toBe('not-recording');
    expect(store.dispatched).toEqual([]);
  });

  // WHY: a replay store re-dispatches the recorded session, including its
  // start; a live Mark must never be written into a replayed recording.
  it('does not dispatch into a replay store', () => {
    const store = fakeStore(true);
    const record = createSunSightingRecorder({
      getStore: () => store,
      isStopInProgress: () => false,
      isReplaying: () => true,
    });
    expect(record(sighting())).toBe('not-recording');
    expect(store.dispatched).toEqual([]);
  });

  // WHY: the recorder swaps stores per recording; a captured store would
  // log into a dead store (the store-ref rule).
  it('reads the store at call time, never a captured one', () => {
    const first = fakeStore(true);
    const second = fakeStore(true);
    let current = first;
    const record = createSunSightingRecorder({
      getStore: () => current,
      isStopInProgress: () => false,
      isReplaying: () => false,
    });
    current = second;
    record(sighting());
    expect(first.dispatched).toEqual([]);
    expect(second.dispatched).toHaveLength(1);
  });
});
