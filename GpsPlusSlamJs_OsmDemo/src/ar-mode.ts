/**
 * AR mode: the city, in place, through the camera.
 *
 * **WHAT THIS MILESTONE DOES AND DOES NOT DO.** It starts a WebXR session,
 * hands the already-built city to the framework's scene graph in the right
 * frame, and subscribes the world group to the fusion's alignment. It does NOT
 * touch lighting, fog or materials — that is M2, and the demo has a recorded
 * history of a wrong environment making every `MeshStandardMaterial` fail to
 * compile and silently not draw, so it is deliberately a separate step with its
 * own verification.
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
  getScene,
  initAR,
  type TrackingSubscribableStore,
} from "gps-plus-slam-app-framework/ar";
import { enableArWorldGroupAlignment } from "gps-plus-slam-app-framework/visualization";
import type { SubscribableStore } from "gps-plus-slam-app-framework/state";

import type { BuildingView } from "./building-view.js";
import type { LatLng } from "gps-plus-slam-osm";

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
  const session: { alignment?: { dispose: () => void } } = {};

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
    // GIVE THE CITY BACK. The framework's scene root outlives this session, so
    // content left attached there is content the desktop view no longer has and
    // nothing else will reclaim — and three.js reports nothing, so the symptom
    // is an empty map view.
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
  if (scene === null || arWorldGroup === null) {
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

  session.alignment = enableArWorldGroupAlignment({
    store: deps.store,
    arWorldGroup,
  });

  bootCompleted = true;

  return {
    started: true,
    dispose: () => {
      release(true);
    },
  };
}
