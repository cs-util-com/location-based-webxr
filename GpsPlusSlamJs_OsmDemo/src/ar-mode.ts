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
import { canEnterAr, type FrameworkLatLong } from "./ar-origin.js";

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
  readonly onError: (message: string) => void;
  /** Fired when the session ends for ANY reason, including the back gesture. */
  readonly onEnded?: () => void;
}

export interface ArMode {
  /** Tear the session down and give the city back. Idempotent. */
  dispose(): void;
}

/** Returned when AR could not start. Never null, so callers need no guard. */
const NOOP_AR_MODE: ArMode = { dispose: () => undefined };

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

  const teardown = (): void => {
    if (disposed) return;
    disposed = true;
    // GIVE THE CITY BACK FIRST. The framework's scene root outlives this
    // session, so content left attached there is content the desktop view no
    // longer has and nothing else will reclaim.
    deps.buildingView.attachContentTo(
      deps.buildingView.localRoot,
      "demo-scene",
    );
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
          teardown();
          deps.onEnded?.();
        },
      },
    );
  } catch (error) {
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
  deps.buildingView.attachContentTo(scene, "gps-world-nue");

  const alignment = enableArWorldGroupAlignment({
    store: deps.store,
    arWorldGroup,
  });

  bootCompleted = true;

  return {
    dispose: () => {
      if (disposed) return;
      alignment.dispose();
      teardown();
      void endARSession();
    },
  };
}
