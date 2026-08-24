/**
 * Turns arriving GPS fixes into the framework's alignment loop.
 *
 * **THE THING THE DEMO WAS MISSING.** Reported by the owner 2026-08-14: AR mode
 * "doesn't really use the AR framework — there are no automatic updates of the
 * user position … GPS events keep arriving, get dispatched into the store,
 * which then does automatic alignments — that is missing entirely."
 *
 * It was, and the shape of the gap is worth stating because it is not the
 * obvious one. The demo already had a real 1 Hz watch: `locate-control.ts`
 * runs `map.locate({ watch: true })` for the whole AR session. Those fixes were
 * spent entirely on FETCHING — the refetch gate, the terrain join, the map
 * marker — and never on REGISTRATION. Nothing called
 * `createGpsPositionHandler`, so `recordGpsEvent` was never dispatched,
 * `gpsElements` stayed empty, the alignment matrix never left identity, and the
 * `enableArWorldGroupAlignment` binding in `ar-mode.ts` faithfully lerped
 * identity onto `arWorldGroup` forever. The city was drawn in the AR session's
 * own origin frame: wrong place, arbitrary rotation, no convergence.
 *
 * **ONE WATCH, NOT TWO, and this module exists partly to enforce that.** The
 * obvious fix — call `startGpsWatch` on AR entry, as `AnchorStarter` and the
 * `RecorderApp` do — would open a second `navigator.geolocation.watchPosition`
 * beside Leaflet's. `locate-control.ts` rejects that by name: two sources for
 * the same fact can disagree about which fix is current, and the alignment
 * would then be solved against positions the scene was never fetched for. So
 * this module takes a fix rather than fetching one, and the existing
 * `onLocated` feeds it.
 *
 * **WHY IT IS A MODULE.** `main.ts` cannot be unit-run — it builds a Leaflet
 * map, a `WebGLRenderer` and a worker — so anything living there is guarded
 * only by matching its source text (`ar-walk-wiring.test.ts` explains why at
 * length). The lifecycle here has real behaviour worth asserting, so it lives
 * where a test can run it.
 *
 * @see gps-registration.ts.md
 */

import type {
  GpsPosition,
  RawDeviceOrientation,
} from "gps-plus-slam-app-framework/sensors";
// TYPE-ONLY, and it has to stay that way: `locate-control.ts` imports Leaflet
// at module scope, which touches `window`, and this module's tests run in Node.
import type { LocatedFix } from "./locate-control.js";

/**
 * The framework calls this module needs, injected.
 *
 * NOT for mocking convenience — `sensors` and `state` both touch module-level
 * caches and browser sensors at import time, and the demo's unit suite runs in
 * Node. The seam is the same one `locate-control.ts` and `ar-mode.ts` already
 * use for the same reason.
 */
export interface GpsRegistrationSeams<TStore, TPose> {
  readonly createGpsPositionHandler: (config: {
    store: TStore;
    getArPose: () => TPose;
  }) => (position: GpsPosition) => void;
  readonly startOrientationWatch: (
    handler: (orientation: RawDeviceOrientation) => void,
  ) => void;
  readonly stopOrientationWatch: () => void;
  readonly updateDeviceOrientation: (orientation: RawDeviceOrientation) => void;
  readonly startAbsoluteOrientationWatch: () => Promise<unknown>;
  readonly stopAbsoluteOrientationWatch: () => void;
  readonly requestDeviceOrientationPermission: () => Promise<boolean>;
  readonly startSession: (payload: {
    scenarioName: string;
    sessionName: string;
    startTime: number;
  }) => StoreAction;
  readonly endSession: () => StoreAction;
}

/**
 * The least a dispatched action can be.
 *
 * Deliberately NOT the store's own `Action` union. Redux types `dispatch` as
 * `(action: Action) => Action`, which is assignable to this, so the real store
 * satisfies the interface — while typing it the other way round (a store that
 * takes `unknown`) is contravariantly wrong and the compiler says so.
 *
 * Module-private: it appears in the exported signatures but no caller needs to
 * name it, and `check:deadcode` refuses an export nothing imports.
 */
interface StoreAction {
  readonly type: string;
}

export interface GpsRegistrationOptions<TStore, TPose> {
  /**
   * The demo's store.
   *
   * GENERIC RATHER THAN `unknown`, because `unknown` is contravariantly wrong
   * here and the compiler says so: the framework's
   * `createGpsPositionHandler` wants a real `SlamAppStore`, and a seam that
   * advertised `unknown` could only be satisfied with a cast. The first draft
   * of this file had that cast, and it was hiding two genuine mismatches —
   * this one and the orientation handler's type.
   */
  readonly store: TStore & { dispatch: (action: StoreAction) => unknown };
  /** The live AR pose, or `null` before tracking settles. */
  readonly getArPose: () => TPose;
  readonly seams: GpsRegistrationSeams<TStore, TPose>;
  /** Wall clock for the session's start time. Injected so tests are stable. */
  readonly now?: () => number;
}

export interface GpsRegistration {
  /** Begin registering fixes. Idempotent. */
  start(): Promise<void>;
  /** Stop registering and end the session. Idempotent. */
  stop(): void;
  /** Hand over a fix. A no-op unless started. */
  onFix(position: GpsPosition): void;
}

/**
 * The demo's fix shape → the framework's.
 *
 * Two renames and a default, and each one is a place the two conventions
 * disagree: this demo says `lng` where the framework says `lon` (the same
 * mismatch `ar-origin.ts` exists to absorb one level up), the demo carries
 * horizontal accuracy as the optional `accuracyM` while `GpsPosition` requires
 * a plain `accuracy`, and the vertical fields are already `null`-shaped here
 * because `locate-control.ts` normalised them at the browser boundary.
 *
 * **The accuracy default is the one judgement call.** `GpsPosition.accuracy` is
 * not optional, and the library's horizontal weighting divides by it — so a
 * missing value has to become a number. `Number.POSITIVE_INFINITY` is the
 * honest choice: it drives the pair's weight to zero, i.e. "this fix tells us
 * nothing about where we are", which is exactly what an accuracy-less fix
 * means. A small default would silently make the least trustworthy fixes the
 * most influential.
 */
export function toGpsPosition(fix: LocatedFix): GpsPosition {
  return {
    lat: fix.lat,
    lon: fix.lng,
    accuracy: fix.accuracyM ?? Number.POSITIVE_INFINITY,
    altitude: fix.altitude,
    altitudeAccuracy: fix.altitudeAccuracy,
    heading: fix.heading,
    speed: fix.speed,
    timestamp: fix.timestamp,
  };
}

export function createGpsRegistration<TStore, TPose>(
  options: GpsRegistrationOptions<TStore, TPose>,
): GpsRegistration {
  const { store, getArPose, seams } = options;
  const now = options.now ?? (() => Date.now());

  let handler: ((position: GpsPosition) => void) | undefined;
  let orientationStarted = false;
  /**
   * Bumped by every `start()`, re-checked after every `await`.
   *
   * **WITHOUT THIS, A STOP DURING A PENDING START LEAKS BOTH SENSOR WATCHES
   * FOR THE REST OF THE PAGE'S LIFE** (r515 review). `main.ts` calls
   * `void start()` — fire-and-forget — while `stop()` is synchronous, so
   * `stopWalking()` can run while this function is parked on the orientation
   * permission. The resumed tail then attached a `deviceorientation` listener
   * and started the sensor AFTER the teardown that was supposed to remove
   * them, and `stop()` had already seen `orientationStarted === false` and
   * skipped its own cleanup. The framework's own generation guard does not
   * cover it either: that invalidates a start already in flight when the stop
   * happened, not one that begins afterwards.
   *
   * The `handler === undefined` half of the check is not redundant — it catches
   * a stop that happened with no intervening start, where the counter is
   * unchanged.
   *
   * RELATED BUT NOT THE SAME AS `latest-only.ts`, which four modules use across six call sites.
   * That wraps an async FUNCTION and discards all but the newest call's result;
   * this guards a callback that fires later against an identity that has since
   * changed. Cousins, not twins — recorded here rather than merged, so the next
   * reader finds the shared helper and can judge for themselves (2026-08-24
   * duplicated-helper review).
   */
  let startGeneration = 0;

  return {
    async start(): Promise<void> {
      // IDEMPOTENT because `startWalking` is reachable twice — the Android back
      // gesture leaves and re-enters AR, and `locateControl` guards its own
      // watch for exactly this. Two starts would mean two sessions and two
      // orientation listeners writing one cache.
      if (handler !== undefined) return;
      const generation = ++startGeneration;

      // RECORDING FIRST, and nothing works without it.
      // `createGpsPositionHandler` returns early unless
      // `recording.isRecording`, so a loop wired without this runs on every fix
      // and does nothing at all — no event, no alignment, no error. That is the
      // exact failure being fixed, and it would be trivially reintroduced by
      // anyone who reads this as bookkeeping.
      store.dispatch(
        seams.startSession({
          scenarioName: "osm-demo",
          sessionName: "ar",
          startTime: now(),
        }),
      );

      handler = seams.createGpsPositionHandler({ store, getArPose });

      // THE COMPASS, both halves, because they feed different fields.
      // `DeviceOrientation` supplies the event's device rotation; the
      // `AbsoluteOrientationSensor` supplies `absoluteOrientation`, and the
      // library's cold-start yaw override — default ON — engages only when THAT
      // is non-null. Starting one and not the other leaves the override inert
      // with nothing to report it, which is the state every consumer except the
      // Recorder was in.
      //
      // A REFUSED PERMISSION MUST NOT ABORT AR. iOS and some Android
      // configurations say no; degrading to GPS-only yaw is far better than no
      // AR at all, and the GPS half above is already live either way.
      const permitted = await Promise.resolve(
        seams.requestDeviceOrientationPermission(),
      ).catch(() => false);
      // STOPPED WHILE WE WERE AWAITING? Then this start is stale and must
      // attach nothing — `stop()` has already run its teardown and cannot see
      // a watch started after it. See `startGeneration`.
      if (generation !== startGeneration || handler === undefined) return;

      if (permitted) {
        seams.startOrientationWatch(seams.updateDeviceOrientation);
        orientationStarted = true;
      }

      // FIRE-AND-FORGET, as the Recorder does it: the sensor is unavailable off
      // Chrome Android and its absence is a clean no-op rather than an error.
      // Awaiting it would make AR entry wait on a sensor that may never arrive.
      void Promise.resolve(seams.startAbsoluteOrientationWatch()).catch(
        () => undefined,
      );
    },

    stop(): void {
      if (handler === undefined) return;
      handler = undefined;

      // ENDING THE SESSION IS NOT OPTIONAL HERE, and `AnchorStarter` — the app
      // this wiring otherwise mirrors — does not do it. It never leaves AR, so
      // it never pays for the omission. This demo leaves AR back onto a live
      // map whose locate watch keeps running, so without this every later
      // desktop fix would dispatch an event against a null AR pose: a growing
      // `gpsElements`, a re-solved alignment on every click, and a warning per
      // fix. Copying the reference consumer would have copied the bug.
      store.dispatch(seams.endSession());

      if (orientationStarted) {
        seams.stopOrientationWatch();
        orientationStarted = false;
      }
      seams.stopAbsoluteOrientationWatch();
    },

    onFix(position: GpsPosition): void {
      // A NO-OP BEFORE START AND AFTER STOP. The watch outlives AR mode, so
      // this is the boundary that keeps map-only fixes out of the fusion.
      handler?.(position);
    },
  };
}
