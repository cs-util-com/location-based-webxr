/**
 * AR mode: the city, in place, through the camera.
 *
 * **WHAT THIS MILESTONE DOES AND DOES NOT DO.** It starts a WebXR session,
 * hands the already-built city to the framework's scene graph in the right
 * frame, subscribes the world group to the fusion's alignment, and prepares the
 * scene's environment.
 *
 * **The environment lives in `ar-scene-environment.ts`, not here** (M2). The
 * demo has a recorded history of a wrong `scene.environment` making every
 * `MeshStandardMaterial` fail to compile and silently not draw, so the rule
 * against setting one is stated and tested in one place rather than being an
 * absence in this file that nobody could point at.
 *
 * **THE CONTENT IS REPARENTED, NOT REBUILT.** `BuildingView` has already turned
 * ~21 MB of features into typed arrays and three.js objects; AR needs the same
 * objects under a different root. `SceneContent` moves the subtree whole and
 * applies the axis change (the demo's scene is X=East, Y=Up, Z=−North; the
 * framework's scene root is NUE), so entering and leaving AR costs no rebuild.
 *
 * **ENTRY IS GATED ON A FIRST GPS FIX**, and that is not a nicety. The origin is
 * the framework's `zero`, which is `null` until a fix lands, and DEC-R11-6
 * rejected re-anchoring on the first non-null `zero` — so entering early and
 * correcting later is not available. See `ar-origin.ts`.
 *
 * Structure follows `WayfindingHudDemo`'s `ar-mode.ts` (the framework's
 * reference consumer); the UX follows DEC-12 instead, which keeps the map.
 *
 * @see ar-mode.ts.md
 */

// NARROW SUBPATHS, NOT THE BARREL — the framework's root export pulls in
// Leaflet, which touches `window` at import time. `osm-store.ts` carries the
// same note for the same reason.
import {
  endARSession,
  getArWorldGroup,
  getCamera,
  getRenderer,
  getScene,
  initAR,
  registerXrFrameUpdate,
  type TrackingSubscribableStore,
} from "gps-plus-slam-app-framework/ar";
import { enableArWorldGroupAlignment } from "gps-plus-slam-app-framework/visualization";
import { odometryTrackingRestarted } from "gps-plus-slam-app-framework/core";
import type { SubscribableStore } from "gps-plus-slam-app-framework/state";

import type { BuildingView } from "./building-view.js";
import type { LatLng } from "gps-plus-slam-osm";

import { applyArEnvironment } from "./ar-scene-environment.js";
import { createArHud, type ArHud } from "./ar-hud.js";
// Type-only: the GPS-side half of the readout is DEFINED by the formatter, so
// the two cannot drift apart the way two hand-kept field lists would.
import type { ArMeasurements } from "./ar-measurements.js";
import {
  createArElevationControl,
  type ArElevationControl,
} from "./ar-elevation-control.js";
import {
  createArCompassControl,
  type ArCompassControl,
} from "./ar-compass-control.js";
import {
  createArBuildingMaterial,
  type ArBuildingMaterial,
} from "./ar-building-material.js";
import type { CompassSettings } from "./compass-influence.js";
import {
  canEnterAr,
  nueBearingDeg,
  sceneAnchorOffsetNue,
  type FrameworkLatLong,
} from "./ar-origin.js";

// Only for the reusable direction vector below. `getWorldDirection` needs a
// target and allocating one per frame would be litter on the frame path.
import * as THREE from "three";

/**
 * Scratch for the camera's look direction, reused every frame.
 *
 * MODULE-LEVEL rather than per session: only one AR session exists at a time,
 * and the value is consumed synchronously in the line after it is written.
 */
const forward = new THREE.Vector3();

/** The ENU shape the injected frame produces. Structural, nothing imported. */
interface EnuPoint {
  readonly x: number;
  readonly y: number;
}

export interface ArModeDeps {
  /** Element `initAR` mounts its canvas and DOM overlay into. */
  readonly container: HTMLElement;
  /**
   * The framework store. Supplies the alignment matrix the world group follows.
   *
   * **The INTERSECTION of the two framework interfaces, and neither subsumes
   * the other.** `initAR` wants `TrackingSubscribableStore`, whose `getState`
   * returns `{ tracking }`; `enableArWorldGroupAlignment` wants
   * `SubscribableStore`, whose `getState` returns the combined root. A real
   * `SlamAppStore` satisfies both, so requiring both here is accurate rather
   * than defensive — and it is stated as an intersection rather than as the
   * concrete store type because that type's shape changes with the demo's own
   * `extraReducers`.
   */
  readonly store: TrackingSubscribableStore & SubscribableStore;
  /** Where the city currently lives. Its content is borrowed, not copied. */
  readonly buildingView: BuildingView;
  /** The session's anchor — the framework's `zero`, already read by the caller. */
  readonly origin: FrameworkLatLong | null;
  /**
   * Where the CITY's ENU frame is anchored — the demo's scene anchor.
   *
   * Distinct from {@link origin} and that distinction is the point: the mesh is
   * authored about this, the GPS-world frame is about `zero`, and the offset
   * between them has to be applied or the city lands in the wrong place.
   */
  readonly sceneAnchor: LatLng;
  /** The package's `enuFrameAt`, injected so this module stays testable. */
  readonly enuFrameAt: (origin: LatLng) => { toEnu: (p: LatLng) => EnuPoint };
  readonly onError: (message: string) => void;
  /** Fired when the session ends for ANY reason, including the back gesture. */
  readonly onEnded?: () => void;
  /**
   * The GPS-side numbers for the readout, asked for at the sampling cadence
   * rather than pushed (milestone 4).
   *
   * PULLED, NOT PUSHED, because the two sources tick at completely different
   * rates: draw cost and fps change every frame while a fix arrives about once
   * a second. A push seam would either rewrite the DOM on every frame or make
   * `main.ts` own a cadence that belongs to the readout.
   *
   * Optional so the session still runs without an instrument.
   */
  readonly liveMeasurements?: () => {
    readonly fixAccuracyM?: number | undefined;
    readonly metresFromAnchor?: number | undefined;
    /**
     * The RAW reported altitude and its vertical accuracy.
     *
     * Here rather than derived from the alignment, because separating "the GPS
     * altitude is wrong" from "the solve mishandled a good altitude" is the
     * whole reason the readout exists — and `worldBaselineY` beside it can only
     * answer the second half. See `ar-measurements.ts`.
     */
    readonly altitudeM?: number | undefined;
    readonly altitudeAccuracyM?: number | undefined;
  } & Pick<
    ArMeasurements,
    | "terrainHeightM"
    | "terrainHasData"
    | "demSourceId"
    | "geoidUndulationM"
    | "geoidModelId"
    | "position"
    | "fixAgeMs"
  >;
  /**
   * Apply the compass-influence settings the slider produced (DEC-E2).
   *
   * FOUR SETTINGS RATHER THAN ONE, and the reason is in `compass-influence.ts`:
   * "influence 0" is not "vote weight 0". Dispatching is the caller's job
   * because the action creators belong to the library and this module is kept
   * testable without a real store.
   *
   * Optional so the session still runs without the control.
   */
  readonly onCompassSettings?: (settings: CompassSettings) => void;
}

export interface ArMode {
  /**
   * Whether a session actually started.
   *
   * FALSE on every bail-out path. Callers drive UI from this rather than from
   * "a handle came back", because a handle ALWAYS comes back -- an inert one on
   * a refused permission or a missing scene. Treating that as a live session
   * showed the user an error toast and an "Exit AR" button at the same time.
   */
  readonly started: boolean;
  /** Tear the session down and give the city back. Idempotent. */
  dispose(): void;
}

/** Returned when AR could not start. Never null, so callers need no guard. */
const NOOP_AR_MODE: ArMode = { started: false, dispose: () => undefined };

/**
 * Start AR mode. Resolves to an inert handle when AR cannot start.
 *
 * NEVER REJECTS, matching the reference consumer: a refused session, an
 * unsupported device and a missing GPS fix are all ordinary outcomes the page
 * has to render, not exceptions. Everything reaches the user through
 * `onError`.
 */
export async function startArMode(deps: ArModeDeps): Promise<ArMode> {
  if (!canEnterAr(deps.origin)) {
    // BEFORE `initAR`, deliberately. Prompting for camera permission and then
    // refusing to draw anything is a worse experience than not prompting.
    deps.onError("Waiting for a GPS fix before AR can anchor the scene.");
    return NOOP_AR_MODE;
  }

  let disposed = false;
  // Guards the case where the session ends DURING a failed boot: the bail-out
  // below calls `endARSession`, which fires `onSessionEnd`, which must not run
  // teardown against half-built state. Same reason the reference consumer has
  // it.
  let bootCompleted = false;
  // Held so `release` can dispose it whichever exit runs first. Undefined until
  // the session is fully built, which is why `release` uses optional chaining.
  const session: {
    alignment?: { dispose: () => void };
    restoreEnvironment?: () => void;
    hud?: ArHud;
    elevation?: ArElevationControl;
    compass?: ArCompassControl;
    shell?: ArBuildingMaterial;
    unregisterFrame?: () => void;
  } = {};

  /**
   * Everything this session owns, released. **ONE function for BOTH exits.**
   *
   * An earlier split had `teardown()` re-attach the content while `dispose()`
   * additionally released the alignment handle and ended the session — with the
   * system-end path calling only `teardown()`. That worked, but by accident:
   * the only thing `dispose()` added was a handle the framework already
   * reclaims through `runSessionDisposers()` before it invokes `onSessionEnd`.
   *
   * **M2, M4 and M5 each add cleanup here** — restoring lights and fog,
   * detaching the draw-cost readout, waking the desktop renderer — and every
   * one of them would have silently not run on the Android back gesture, which
   * calls no `dispose()`. Merging the two paths now costs nothing; merging them
   * after three milestones have piled onto the wrong one is a bug hunt.
   *
   * `endSession` is the ONE thing that differs, and it is a parameter rather
   * than a branch: the system-end path must not call `endARSession()` on a
   * session that is already ending.
   */
  const release = (endSession: boolean): void => {
    if (disposed) return;
    disposed = true;
    // The alignment handle first: it is a subscription, and releasing it before
    // the scene graph changes under it is the cheaper order.
    //
    // Idempotent by the framework's own guard, which matters because
    // `runSessionDisposers()` has usually already called it by the time a
    // system-initiated end reaches us.
    session.alignment?.dispose();
    // THE FRAME CALLBACK FIRST. It reads the renderer and writes the DOM, and
    // both are about to be torn down — an unregister that ran after the scene
    // changed would leave one more sample running against half-dead state.
    session.unregisterFrame?.();
    session.hud?.dispose();
    // BEFORE the city is handed back, so the control cannot outlive the scene
    // it nudges — and so nothing is left in `#ar-root`, which is hidden only
    // while `:empty`.
    session.elevation?.dispose();
    // Same reason as the elevation control above: nothing may be left in
    // `#ar-root`, which is hidden only while `:empty`.
    session.compass?.dispose();
    // RESTORED BEFORE the city is handed back, so the desktop view never sees
    // an additive, depth-write-free material against its own sky gradient.
    deps.buildingView.setArShellMaterial(undefined);
    session.shell?.material.dispose();
    // On BOTH exits, and NOT because the framework's objects are shared —
    // `initAR` builds a fresh scene, camera and renderer each time. It runs
    // here because this is the one place that knows the session is over, and
    // because the next thing added to `release()` will assume the pattern.
    session.restoreEnvironment?.();
    // GIVE THE CITY BACK, and the reason is the opposite of a leak: the
    // framework DISCARDS its scene when the session ends. Content still
    // attached to it goes with it — out of the desktop view, with nothing left
    // holding a parent. The city itself survives (`BuildingView` owns the
    // objects), but nothing re-parents it on its own, and three.js reports
    // nothing, so the symptom is an empty map view.
    deps.buildingView.attachContentTo(
      deps.buildingView.localRoot,
      "demo-scene",
    );
    if (endSession) void endARSession();
  };

  try {
    await initAR(
      deps.container,
      {
        // The city is geometry, not vision. Nothing here reads the camera
        // image or the depth buffer, and both default ON — leaving them on
        // would add a crash surface and a permission prompt for features this
        // mode never uses. Depth-sensing in particular OVERRIDES the camera's
        // near/far planes when a texture is present (plan §2.3), which M4 has
        // to reason about; not requesting it keeps that variable out.
        enableCameraAccess: false,
        enableDepthSensingFeature: false,
        enableCameraTextureAcquisition: false,
      },
      // No hit-test: nothing is placed by tapping. The city's position comes
      // from GPS, which is the entire point of the mode.
      {},
      {
        tracking: {
          store: deps.store,
          // RE-BASE THE ODOMETRY WHEN ARCORE RESETS ITS ORIGIN (2026-08-14 AR
          // review, F4). The framework calls this on a `lost → tracking`
          // transition that reset the origin; with no callback the payload is
          // dropped and every pre-restart odometry position stays in a frame
          // that no longer exists, so the solve mixes two incompatible frames.
          //
          // It was harmless while no GPS events existed. It became load-bearing
          // the moment `gps-registration.ts` started feeding the coordinator,
          // and its failure mode is the worst kind: the city jumps once and
          // never re-converges, which reads exactly like a broken fusion.
          onRestarted: (payload) =>
            deps.store.dispatch(odometryTrackingRestarted(payload)),
        },
        onSessionEnd: () => {
          if (!bootCompleted) return;
          // NOT `endARSession()` — the session is already ending.
          release(false);
          deps.onEnded?.();
        },
      },
    );
  } catch (error) {
    // CLEAR THE CONTAINER, and this is not tidiness (r507 review).
    //
    // `initAR` inserts its canvas BEFORE calling `requestSession`, with no
    // cleanup of its own if that rejects — which it does whenever the user
    // dismisses the AR prompt or the device has no ARCore. Two consequences,
    // both worse than the failure itself:
    //
    // - `#ar-root` stops being `:empty`, so its `position: fixed; inset: 0`
    //   rule turns an abandoned canvas into an invisible, click-eating layer
    //   over the entire page. **That is a regression the layout fix
    //   introduced**: before it, the leftover canvas merely sat in the grid.
    // - The framework's re-entry guard sees a non-null renderer and throws
    //   "AR session already initialized" on every later attempt, so AR is dead
    //   until a reload.
    //
    // `endARSession()` is the framework's own teardown and is safe to call
    // against a half-built session; it is what clears both.
    void endARSession();
    deps.onError(
      error instanceof Error ? error.message : "Failed to start AR.",
    );
    return NOOP_AR_MODE;
  }

  const scene = getScene();
  const arWorldGroup = getArWorldGroup();
  // The camera joins the same guard rather than being treated as optional: it
  // is null only when there is no session, and continuing without it would
  // leave the framework's 0.01 / 200 planes in place — clipping the city at
  // 200 m with no error anywhere, which reads as the demo being broken.
  const camera = getCamera();
  if (scene === null || arWorldGroup === null || camera === null) {
    deps.onError("AR scene not ready.");
    void endARSession();
    return NOOP_AR_MODE;
  }

  // EVERYTHING PAST THIS POINT IS GUARDED, because the session is now OPEN and
  // the contract above says this function never rejects (PR #316 review).
  // Only the `initAR` call used to sit inside a try, so a throw anywhere in the
  // boot below left the worst state this file has: the XR session live, the
  // city already reparented onto the framework scene so the desktop map is
  // empty with nothing to give it back, `bootCompleted` still false so
  // `onSessionEnd` returns early and `release()` never runs — and a rejected
  // promise that `main.ts` consumes as `void startArMode(...).then(...)` with no
  // `.catch`, i.e. an unhandled rejection: no toast, no `onError`, and the
  // button still reading "Enter AR".
  try {
    // THE SCENE ROOT, NOT `arWorldGroup`. The root IS the GPS-world frame, so
    // map-derived content built once belongs there with no inverse-alignment
    // container; the lerped alignment on `arWorldGroup` moves the CAMERA through
    // a world that stands still. Two independent readers previously concluded
    // the opposite, which is why `ar-scene-hierarchy.ts` now says so at the top.
    //
    // `"gps-world-nue"` is not optional: the demo's scene is X=East, Y=Up,
    // Z=−North and the root is NUE, so attaching without it renders the city 90°
    // off.
    // THE OFFSET IS NOT OPTIONAL EITHER. The city is authored in ENU about the
    // demo's scene anchor, not about `zero` — attaching with the rotation alone
    // put it at the right orientation and the wrong place, by up to the 5 km
    // re-anchor threshold. `origin` is non-null here: `canEnterAr` returned true.
    // THE GEOMETRIC OFFSET, COMPUTED ONCE. The manual nudge is summed onto it
    // below rather than folded into it: `sceneAnchorOffsetNue` returns
    // `up: 0` as a GUARDED INVARIANT with its own test — a vertical term inside
    // it would double-count the geoid. The nudge is a user fudge, not a datum
    // term, so it belongs here at the call site and nowhere else.
    const geometricOffset = sceneAnchorOffsetNue(
      deps.origin as FrameworkLatLong,
      deps.sceneAnchor,
      deps.enuFrameAt,
    );

    // RE-ATTACHING IS THE LIVE PATH, and it is safe because `SceneContent.attachTo`
    // documents its transform as "SET, NEVER ACCUMULATED" — so applying a new
    // offset is idempotent rather than a second translation stacked on the first.
    const applyElevation = (offsetM: number) => {
      deps.buildingView.attachContentTo(scene, "gps-world-nue", {
        ...geometricOffset,
        up: geometricOffset.up + offsetM,
      });
    };
    applyElevation(0);

    // AR ONLY. The desktop preview discards `geometricOffset` (it attaches with
    // "demo-scene", which sets identity), and making it follow would lift the
    // buildings away from the ground plane, the route line and the NPC agent —
    // all of which live on the preview's own scene and would stay put.
    session.elevation = createArElevationControl({
      root: deps.container,
      onChange: applyElevation,
    });
    session.elevation.attach();

    // THE COMPASS SLIDER (DEC-E2), only when the caller can actually dispatch.
    if (deps.onCompassSettings !== undefined) {
      const onCompassSettings = deps.onCompassSettings;
      session.compass = createArCompassControl({
        root: deps.container,
        onChange: onCompassSettings,
      });
      session.compass.attach();
      // READY IMMEDIATELY, and that is a fact rather than an assumption: every
      // compass setter is a no-op while the store's gps state is null, but AR
      // entry is GATED on `canEnterAr(deps.origin)`, and a non-null origin IS the
      // framework's `zero` — so `setZeroPos` has already been dispatched by the
      // time this line runs. The control's latch stays as the defensive path for
      // any future caller that is not gated the same way.
      session.compass.setReady(true);
    }

    // THE AR LOOK (owner decision 2026-08-16): the "Double-sided X-ray pulse"
    // shell replaces the desktop material on the buildings for the session, and
    // is restored in `release()`. Held ON THE VIEW rather than applied once, so a
    // refetch mid-session cannot silently drop it.
    session.shell = createArBuildingMaterial();
    deps.buildingView.setArShellMaterial(session.shell.material);

    // M2. Clears the background so the passthrough shows, widens the depth budget
    // to 0.5 / 1000, adds fog ending exactly at that far plane, matches the demo's
    // ACES grading, and pointedly does NOT set an environment map.
    //
    // THE RENDERER IS NOT IN THE GUARD ABOVE, deliberately: a missing camera
    // leaves the city clipping at 200 m, while a missing renderer only leaves it
    // ungraded. Failing the session over a look is the wrong trade.
    session.restoreEnvironment = applyArEnvironment(
      scene,
      camera,
      getRenderer(),
    );

    session.alignment = enableArWorldGroupAlignment({
      store: deps.store,
      arWorldGroup,
    });

    // M4. The instrument the milestone needs before it can take a measurement:
    // the desktop status line reports `BuildingView`'s renderer, and the session
    // draws with a DIFFERENT one, so the number visible during AR described a
    // renderer that was not producing the frames.
    session.hud = createArHud(deps.container);
    const renderer = getRenderer();
    // FPS IS AVERAGED OVER THE WINDOW, not sampled from one frame (r510 review).
    // A single `1/dt` spikes routinely on a phone — GC, a worker message, the
    // terrain field landing — so at 2 Hz the readout would flicker between 60 and
    // 22 with no way to tell a sustained drop from a hiccup. Counting frames and
    // dividing by elapsed time is what makes the number answer §4's question.
    // WHAT `createSceneHierarchy` LEAVES THE MATRIX AT until the fusion writes an
    // alignment. Cloned from the instance rather than built from a `THREE.Matrix4`
    // import: this module deliberately imports no three.js, and taken once here it
    // costs the per-frame sampler nothing.
    const identityMatrix = arWorldGroup.matrix.clone().identity();
    let framesThisWindow = 0;
    // OPENED ON THE FIRST FRAME, NOT AT ZERO. `elapsed` is PAGE-relative — the
    // frame loop computes it from the rAF timestamp — so a session entered thirty
    // seconds after load sees its first frame at `elapsed ≈ 30`. Seeding this to
    // `0` made the first window as long as the page had been open, and the first
    // reading "0 fps" (r511 review). The framework's docstring said "seconds since
    // the session started", which is what made it look safe; that is corrected too.
    let windowOpenedAtS: number | undefined;
    session.unregisterFrame = registerXrFrameUpdate(({ dt, elapsed }) => {
      windowOpenedAtS ??= elapsed;
      framesThisWindow += 1;
      const windowS = elapsed - windowOpenedAtS;
      const fps = windowS > 0 ? framesThisWindow / windowS : undefined;
      // `dt` is unused for the rate now, but it still marks the first frame after
      // a reset (the framework's contract says `dt` is 0 there), which is the one
      // sample whose window is meaningless.
      // THE BREATHING. Driven from `elapsed` -- the frame clock the loop already
      // computed, monotonic and page-relative -- rather than from wall time, so the
      // pulse cannot jump when the tab is backgrounded.
      session.shell?.setTime(elapsed);
      const live = deps.liveMeasurements?.() ?? {};
      const wrote = session.hud?.sample(
        {
          // THE PREVIOUS FRAME'S COST, and the comment here said "this frame's"
          // until the r510 review. `WebGLRenderer.render` calls `info.reset()` at
          // its top, and the framework runs these callbacks BEFORE `render` — so
          // what is readable now is the last completed frame. At a 2 Hz readout
          // the one-frame lag is invisible; the mechanism is written down because
          // the next change will reason from it.
          drawCost:
            renderer === null
              ? undefined
              : {
                  calls: renderer.info.render.calls,
                  triangles: renderer.info.render.triangles,
                },
          fps,
          // THE VERTICAL TERM §4 PREDICTS WILL JUMP. `arWorldGroup.matrix` is
          // written directly by the alignment lerper with `matrixAutoUpdate =
          // false`, so element 13 is the live baseline rather than a stale copy.
          //
          // UNDEFINED UNTIL AN ALIGNMENT EXISTS (r511 review).
          // `createSceneHierarchy` leaves the matrix at IDENTITY, whose element 13
          // is a perfectly real `0` — so the readout showed `baseline 0.00 m`
          // before the fusion had said anything at all. That is the one thing
          // `ar-measurements.ts` exists to forbid: an unmeasured value rendered as
          // a number, and this one is worse than most because zero is a plausible
          // reading. Compared against the whole matrix rather than element 13
          // alone, because a genuine zero baseline must still be reportable.
          worldBaselineY: arWorldGroup.matrix.equals(identityMatrix)
            ? undefined
            : arWorldGroup.matrix.elements[13],
          // THE FUSED BEARING — what the alignment currently thinks north is,
          // which is the only way to SEE what the compass slider did.
          //
          // WORLD SPACE IS THE GEO FRAME HERE, and that is the whole subtlety.
          // The hierarchy is `scene (GPS-world NUE) → arWorldGroup (receives the
          // alignment) → basisChangeNode → arpose → camera`, so the camera is a
          // DESCENDANT of the aligned group and its world transform already
          // carries the alignment. A direction taken relative to `arWorldGroup`
          // would be in the AR-odometry frame — the alignment's *domain*, i.e.
          // un-aligned — and would be a plausible number that is not north.
          // `ar-scene-hierarchy.ts` records two independent readers getting this
          // backwards; `nueBearingDeg` carries the axis convention and its tests.
          fusedBearingDeg: arWorldGroup.matrix.equals(identityMatrix)
            ? undefined
            : nueBearingDeg(camera.getWorldDirection(forward).x, forward.z),
          ...live,
        },
        // THE FRAME CLOCK, not wall time: `elapsed` is what the frame loop
        // already computed, and it is monotonic. **Page-relative, not a session
        // duration** — this comment said "the session clock" until r513, which is
        // the wording that caused the fps window to be opened at zero a few lines
        // above. Safe here because `sample` only ever differences this stamp
        // against its own previous value; never treat it as an elapsed time.
        elapsed * 1000,
      );
      // THE WINDOW RESETS ONLY WHEN ONE WAS ACTUALLY WRITTEN, so the average
      // covers exactly the frames the displayed number describes. Resetting every
      // frame would make it a single-frame reciprocal again by another route.
      if (wrote === true) {
        framesThisWindow = 0;
        windowOpenedAtS = elapsed;
      }
      // Referenced so the first-frame contract stays visible to a reader; the
      // rate no longer derives from it.
      void dt;
    });

    bootCompleted = true;

    return {
      started: true,
      dispose: () => {
        release(true);
      },
    };
  } catch (error) {
    // `release(true)` is the SAME teardown a normal exit takes: it hands the
    // city back to the desktop scene, disposes whatever was built, and ends the
    // session. Reusing it rather than unwinding by hand is what keeps the
    // partial-boot path from drifting away from the working one.
    release(true);
    deps.onError(
      error instanceof Error ? error.message : "Failed to start AR.",
    );
    return NOOP_AR_MODE;
  }
}
