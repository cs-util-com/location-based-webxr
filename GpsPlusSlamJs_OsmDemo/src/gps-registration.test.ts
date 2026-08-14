/**
 * The GPS→store→alignment loop, which the demo did not have.
 *
 * WHY THIS FILE EXISTS. The owner reported that AR mode "doesn't really use the
 * AR framework — there are no automatic updates of the user position, the
 * typical thing the other demos do where GPS events keep arriving, get
 * dispatched into the store, which then does automatic alignments, is missing
 * entirely". It was: the demo received real fixes (`map.locate({watch:true})`)
 * and spent them on FETCHING, never on REGISTRATION. `recordGpsEvent` was never
 * dispatched, so `gpsElements` stayed empty, the alignment matrix never left
 * identity, and `arWorldGroup` was never GPS-registered.
 *
 * WHY A MODULE RATHER THAN LINES IN `main.ts`. `ar-walk-wiring.test.ts` exists
 * because `main.ts` cannot be unit-run — it builds a Leaflet map, a
 * `WebGLRenderer` and a worker — so everything put there can only ever be
 * guarded by matching its source TEXT. That is enough to prove a call is
 * written and nothing about whether it works. This loop has real behaviour
 * worth asserting (does an arriving fix become a dispatched event? is the
 * session ended on exit?), so it lives where a test can run it, and `main.ts`
 * keeps only the two calls a text guard can honestly cover.
 *
 * @see gps-registration.ts.md
 */

import { describe, it, expect, vi } from "vitest";

import {
  createGpsRegistration,
  toGpsPosition,
  type GpsRegistrationSeams,
} from "./gps-registration.js";

/** A fix with every field the framework's `GpsPosition` carries. */
const FIX = {
  lat: 50.9413,
  lon: 6.9583,
  altitude: 53.2,
  accuracy: 4.5,
  altitudeAccuracy: 3.1,
  heading: null,
  speed: null,
  timestamp: 1_700_000_000_000,
};

interface Dispatched {
  readonly type: string;
  readonly payload?: unknown;
}

/**
 * A store that records dispatches — the framework's coordinator only needs
 * `dispatch` and `getState`, and building a real one would drag the whole
 * reducer graph into a test about wiring.
 */
function fakeStore(isRecording = false) {
  const dispatched: Dispatched[] = [];
  let recording = isRecording;
  return {
    dispatched,
    setRecording: (value: boolean) => {
      recording = value;
    },
    dispatch: (action: Dispatched) => {
      dispatched.push(action);
      // The real `startSession`/`endSession` reducers flip this; the fake keeps
      // the one bit the coordinator actually reads.
      if (action.type.includes("startSession")) recording = true;
      if (action.type.includes("endSession")) recording = false;
      return action;
    },
    getState: () => ({ recording: { isRecording: recording } }),
  };
}

type FakeStore = ReturnType<typeof fakeStore>;
/**
 * The seams, at the concrete types this test uses.
 *
 * SPELLED OUT rather than left to inference: the interface is generic in the
 * store and the AR pose precisely so a caller cannot satisfy it with a cast,
 * and a test that reached for `as never` here would be opting out of the check
 * it exists to demonstrate. (`main.ts` had exactly that cast in the first
 * draft, and it was hiding two real mismatches.)
 */
type Seams = GpsRegistrationSeams<FakeStore, null>;

function seams(overrides: Partial<Seams> = {}): Seams {
  return {
    createGpsPositionHandler: vi.fn(() => vi.fn()),
    startOrientationWatch: vi.fn(),
    stopOrientationWatch: vi.fn(),
    updateDeviceOrientation: vi.fn(),
    startAbsoluteOrientationWatch: vi.fn(() => Promise.resolve(undefined)),
    stopAbsoluteOrientationWatch: vi.fn(),
    requestDeviceOrientationPermission: vi.fn(() => Promise.resolve(true)),
    startSession: vi.fn((p: unknown) => ({
      type: "recording/startSession",
      payload: p,
    })),
    endSession: vi.fn(() => ({ type: "recording/endSession" })),
    ...overrides,
  };
}

describe("toGpsPosition", () => {
  it("carries the vertical fields, which is the whole point of widening the fix", () => {
    // Why this test matters: these four were dropped at the demo's boundary,
    // and their absence is why the vertical solve could never work.
    // `applyAltitudeOverride` fits `ref[1] - odom[1]` weighted by
    // `altitudeAccuracy`, so with either field missing `alignmentMatrix[13]`
    // stays structurally zero and the AR HUD reports a confident `0.00 m`.
    const position = toGpsPosition({
      lat: 50.9413,
      lng: 6.9583,
      accuracyM: 4.5,
      altitude: 53.2,
      altitudeAccuracy: 3.1,
      heading: 12,
      speed: 1.4,
      timestamp: 1_700_000_000_000,
    });

    expect(position).toEqual({
      lat: 50.9413,
      lon: 6.9583,
      accuracy: 4.5,
      altitude: 53.2,
      altitudeAccuracy: 3.1,
      heading: 12,
      speed: 1.4,
      timestamp: 1_700_000_000_000,
    });
  });

  it("gives an accuracy-less fix INFINITE accuracy, not a small default", () => {
    // Why this test matters: `GpsPosition.accuracy` is required and the
    // library's horizontal weighting divides by it, so the missing case has to
    // become some number. Infinity drives the weight to zero — "this fix says
    // nothing about where we are" — whereas any small default would make the
    // least trustworthy fixes the most influential, silently and in the
    // direction that looks like a fusion bug.
    const position = toGpsPosition({
      lat: 1,
      lng: 2,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      timestamp: 5,
    });

    expect(position.accuracy).toBe(Number.POSITIVE_INFINITY);
    expect(position.altitude).toBeNull();
  });
});

describe("createGpsRegistration", () => {
  it("marks the session as recording, or every fix is silently dropped", async () => {
    // Why this test matters: `createGpsPositionHandler` returns early unless
    // `recording.isRecording` (gps-event-coordinator.ts:184-187). Without a
    // `startSession` the whole loop is wired, runs, and does nothing — no
    // error, no event, no alignment. That is the failure mode the owner hit,
    // and it is invisible from every other angle.
    const store = fakeStore();
    const s = seams();
    const registration = createGpsRegistration({
      store,
      getArPose: () => null,
      seams: s,
    });

    await registration.start();

    expect(store.dispatched.map((a) => a.type)).toContain(
      "recording/startSession",
    );
    expect(store.getState().recording.isRecording).toBe(true);
  });

  it("hands an arriving fix to the framework's coordinator", async () => {
    // Why this test matters: this is the missing link itself. The demo already
    // had fixes; what it lacked was anything turning one into a
    // `recordGpsEvent`. Asserting the handler is CALLED with the fix — rather
    // than asserting on the store — keeps the test about the demo's wiring and
    // leaves the payload's shape to the framework, which tests it already.
    const handler = vi.fn();
    const store = fakeStore();
    const s = seams({ createGpsPositionHandler: vi.fn(() => handler) });
    const registration = createGpsRegistration({
      store,
      getArPose: () => null,
      seams: s,
    });

    await registration.start();
    registration.onFix(FIX);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(FIX);
  });

  it("ignores fixes before start and after stop", async () => {
    // Why this test matters: the demo's GPS watch outlives AR mode — the same
    // `map.locate({watch:true})` serves the desktop map. Without this, leaving
    // AR would leave every later desktop fix dispatching events against a null
    // AR pose, growing `gpsElements` and re-solving the alignment while the
    // user clicks around a map. `endSession` alone would stop the coordinator,
    // but only after the call; not calling it at all is cheaper and clearer.
    const handler = vi.fn();
    const store = fakeStore();
    const registration = createGpsRegistration({
      store,
      getArPose: () => null,
      seams: seams({ createGpsPositionHandler: vi.fn(() => handler) }),
    });

    registration.onFix(FIX);
    expect(handler).not.toHaveBeenCalled();

    await registration.start();
    registration.onFix(FIX);
    expect(handler).toHaveBeenCalledTimes(1);

    registration.stop();
    registration.onFix(FIX);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ends the session on stop", async () => {
    // Why this test matters: `AnchorStarter` never dispatches `endSession`, so
    // copying it would have copied the gap (r514 review, F5). It is a
    // single-mode app that never leaves AR; this demo leaves AR back onto a
    // live map, which is exactly the case the omission breaks.
    const store = fakeStore();
    const registration = createGpsRegistration({
      store,
      getArPose: () => null,
      seams: seams(),
    });

    await registration.start();
    registration.stop();

    expect(store.dispatched.map((a) => a.type)).toContain(
      "recording/endSession",
    );
    expect(store.getState().recording.isRecording).toBe(false);
  });

  it("starts BOTH compass mechanisms, because they answer different questions", async () => {
    // Why this test matters: the payload builder reads two separate caches
    // (gps-event-coordinator.ts:216-221). `DeviceOrientation` feeds the event's
    // device rotation; the `AbsoluteOrientationSensor` feeds
    // `absoluteOrientation`, and the library's cold-start yaw override — DEFAULT
    // ON — engages only when that field is non-null. Start one and not the
    // other and the override stays inert with nothing reporting it, which is
    // the state the whole repo was in outside the Recorder.
    const s = seams();
    const registration = createGpsRegistration({
      store: fakeStore(),
      getArPose: () => null,
      seams: s,
    });

    await registration.start();

    expect(s.requestDeviceOrientationPermission).toHaveBeenCalled();
    expect(s.startOrientationWatch).toHaveBeenCalledWith(
      s.updateDeviceOrientation,
    );
    expect(s.startAbsoluteOrientationWatch).toHaveBeenCalled();
  });

  it("stops both sensor watches on stop", async () => {
    // Why this test matters: AR can be left and re-entered (the Android back
    // gesture does it), and a leaked orientation watch would accumulate one
    // listener per entry, each writing the same module-level cache.
    const s = seams();
    const registration = createGpsRegistration({
      store: fakeStore(),
      getArPose: () => null,
      seams: s,
    });

    await registration.start();
    registration.stop();

    expect(s.stopOrientationWatch).toHaveBeenCalled();
    expect(s.stopAbsoluteOrientationWatch).toHaveBeenCalled();
  });

  it("survives a refused orientation permission rather than failing AR entry", async () => {
    // Why this test matters: iOS and some Android configurations refuse the
    // DeviceOrientation permission, and a rejected promise here would abort AR
    // entry entirely. Degrading to GPS-only yaw is far better than no AR — and
    // it must still start the GPS half, which is the part that actually places
    // the city.
    const handler = vi.fn();
    const s = seams({
      requestDeviceOrientationPermission: vi.fn(() => Promise.resolve(false)),
      createGpsPositionHandler: vi.fn(() => handler),
    });
    const registration = createGpsRegistration({
      store: fakeStore(),
      getArPose: () => null,
      seams: s,
    });

    await expect(registration.start()).resolves.toBeUndefined();

    registration.onFix(FIX);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(s.startOrientationWatch).not.toHaveBeenCalled();
  });

  it("is idempotent on double start and double stop", async () => {
    // Why this test matters: `startWalking`/`stopWalking` are reachable twice
    // in a row through the back gesture, and the existing `locateControl`
    // guards its own watch for the same reason. Two sessions would mean two
    // `startSession` dispatches and two orientation listeners.
    const s = seams();
    const registration = createGpsRegistration({
      store: fakeStore(),
      getArPose: () => null,
      seams: s,
    });

    await registration.start();
    await registration.start();
    registration.stop();
    registration.stop();

    expect(s.startOrientationWatch).toHaveBeenCalledTimes(1);
    expect(s.stopOrientationWatch).toHaveBeenCalledTimes(1);
  });
});
