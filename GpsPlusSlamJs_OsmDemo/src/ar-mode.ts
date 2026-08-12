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
import type { SubscribableStore } from "gps-plus-slam-app-framework/state";

import type { BuildingView } from "./building-view.js";
import type { LatLng } from "gps-plus-slam-osm";

import { applyArEnvironment } from "./ar-scene-environment.js";
import { createArHud, type ArHud } from "./ar-hud.js";
import {
  canEnterAr,
  sceneAnchorOffsetNue,
  type FrameworkLatLong,
} from "./ar-origin.js";

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
  };
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
        tracking: { store: deps.store },
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
  deps.buildingView.attachContentTo(
    scene,
    "gps-world-nue",
    sceneAnchorOffsetNue(
      deps.origin as FrameworkLatLong,
      deps.sceneAnchor,
      deps.enuFrameAt,
    ),
  );

  // M2. Clears the background so the passthrough shows, widens the depth budget
  // to 0.5 / 1000, adds fog ending exactly at that far plane, matches the demo's
  // ACES grading, and pointedly does NOT set an environment map.
  //
  // THE RENDERER IS NOT IN THE GUARD ABOVE, deliberately: a missing camera
  // leaves the city clipping at 200 m, while a missing renderer only leaves it
  // ungraded. Failing the session over a look is the wrong trade.
  session.restoreEnvironment = applyArEnvironment(scene, camera, getRenderer());

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
  let framesThisWindow = 0;
  let windowOpenedAtS = 0;
  session.unregisterFrame = registerXrFrameUpdate(({ dt, elapsed }) => {
    framesThisWindow += 1;
    const windowS = elapsed - windowOpenedAtS;
    const fps = windowS > 0 ? framesThisWindow / windowS : undefined;
    // `dt` is unused for the rate now, but it still marks the first frame after
    // a reset (the framework's contract says `dt` is 0 there), which is the one
    // sample whose window is meaningless.
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
        worldBaselineY: arWorldGroup.matrix.elements[13],
        ...live,
      },
      // THE SESSION CLOCK, not wall time: `elapsed` is what the frame loop
      // already computed, and it is monotonic.
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
}
