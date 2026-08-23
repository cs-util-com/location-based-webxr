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
  getCurrentArPose,
  getRenderer,
  getScene,
  initAR,
  registerXrFrameUpdate,
  startDepthCapture,
  type TrackingSubscribableStore,
} from "gps-plus-slam-app-framework/ar";
import { enableArWorldGroupAlignment } from "gps-plus-slam-app-framework/visualization";
import { odometryTrackingRestarted } from "gps-plus-slam-app-framework/core";
import type { SubscribableStore } from "gps-plus-slam-app-framework/state";
import { getCompassDiagnostics } from "gps-plus-slam-app-framework/state";
import { createArEntryVeil, entryVeilAlpha } from "./ar-entry-veil.js";
import {
  createArEntryDomVeil,
  domVeilAlpha,
  type ArEntryDomVeil,
} from "./ar-entry-dom-veil.js";
import { fusedGpsFrom } from "./ar-fused-gps.js";
import {
  descentMayStart,
  descentComplete,
  descentOffsetM,
  DESCENT_MAX_START_M,
} from "./ar-descent.js";

import type { BuildingView } from "./building-view.js";
import type { LatLng } from "gps-plus-slam-osm";

import { applyArEnvironment } from "./ar-scene-environment.js";
import {
  createArDepthPipeline,
  AR_DEPTH_SAMPLER_CONFIG,
} from "./ar-depth-pipeline.js";
import {
  composeElevationM,
  createArElevationAuto,
  type AnchorEnuPoint,
  type ArElevationAuto,
  type ArElevationAutoState,
} from "./ar-elevation-auto.js";
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
import {
  COMPASS_EXPERIMENT_DEFAULTS,
  describeTrustGate,
  type CompassSettings,
} from "./compass-influence.js";
import {
  createArExperimentPanel,
  type ArExperimentPanel,
} from "./ar-experiment-panel.js";
import {
  canEnterAr,
  nueBearingDeg,
  sceneAnchorOffsetNue,
  toDemoLatLng,
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

/**
 * Scratch for the camera's world position, reused every frame.
 *
 * SEPARATE FROM `forward`, and not merely for tidiness: both are written in the
 * same frame callback, and `getWorldDirection` and `getWorldPosition` would
 * otherwise clobber each other between the two reads.
 *
 * SHARED BY TWO CONSUMERS, which is safe because they want the SAME quantity and
 * each re-reads it: the entry veil centres on it every frame, and the readout
 * back-projects it into GPS at the HUD's ~2 Hz. Sharing a scratch between two
 * consumers of DIFFERENT quantities is the hazard above; this is not that.
 */
const cameraWorld = new THREE.Vector3();

/**
 * How fast the APPLIED auto elevation may move the content, metres/second
 * (cold-review F4). The estimator's slew limiter (0.5 m/s) shapes the signal
 * BETWEEN ticks but cannot touch the cold-start FIRST value or the re-added
 * baseline — both reach the composed target as steps, and a city that snaps
 * metres in one frame reads as a glitch. 1.5 m/s is deliberately 3× the
 * estimator's rate: fast enough that the ease adds little lag on top of the
 * corpus-tuned smoothing, slow enough that even a 5 m first value arrives as
 * a ~3 s glide. The MANUAL trim stays instant (owner-driven, DEC-E1) — the
 * split is: measured signal eases, owner override obeys.
 */
const AUTO_APPLY_RATE_M_PER_S = 1.5;

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
  /**
   * Called once when the entry fly-down lands (Q5).
   *
   * THE END-STATE SIGNAL, and it is not decoration: a descent that STALLS is
   * indistinguishable from the recorded "flying roughly 50 m above the OSM
   * buildings" datum bug, and that ambiguity is what would make a field report
   * unactionable. Optional, so a caller that does not want to say anything is
   * unchanged.
   */
  readonly onDescentComplete?: () => void;
  /**
   * Called ONCE, with seconds since the session's first frame, when the
   * elevation estimator first engages (owner decision, 2026-08-23).
   *
   * **AN INSTRUMENT, NOT A FEATURE.** DEC-L2 lengthened the entry fly-in to
   * 12 s partly so the auto-elevation correction lands underneath it — and that
   * argument turns on how long engagement takes while a user stands still,
   * which has never been measured and which **no gate here can measure**: the
   * estimator needs depth observations built from motion, and every fixture
   * that reaches an engaged state does so by walking. See
   * `2026-08-21-1120-ar-entry-gate-fallback-may-be-the-normal-path-followup.md`.
   *
   * **Its ABSENCE is also a measurement**: a session where this never fires
   * says the estimator never engaged, which is the outcome that followup
   * considers most likely.
   *
   * Optional, so a caller that does not want to say anything is unchanged.
   */
  readonly onEstimateEngaged?: (afterS: number) => void;
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
  /**
   * The package's `enuFrameAt`, injected so this module stays testable.
   *
   * **`toLatLng` IS PART OF THE CONTRACT since J7** (DEC-J10). It was `toEnu`
   * only, and both fixtures supplied only that — with an `as ArModeDeps` cast at
   * the end, so a missing member would not necessarily have been a type error:
   * it would have surfaced as `frame.toLatLng is not a function` in
   * `ar-mode.depth-wiring.test.ts`, a file M5 had no reason to touch and which
   * carries no assertion that would explain the failure. Cold review caught it.
   */
  readonly enuFrameAt: (origin: LatLng) => {
    toEnu: (p: LatLng) => EnuPoint;
    toLatLng: (p: EnuPoint) => LatLng;
  };
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
    | "demStats"
    | "geoidUndulationM"
    | "geoidModelId"
    | "position"
    | "fixAgeMs"
  >;
  /**
   * The automatic elevation offset (plan §2.6). **Presence IS the switch**:
   * `main.ts` omits the whole group when the URL kill switch
   * (`?autoElevation=off`) is set, and with it absent this module requests no
   * depth sensing, builds no grid and ticks no estimator — the session is
   * byte-identical to the pre-auto behaviour, which is what makes the kill
   * switch a real field A/B rather than a UI flag.
   *
   * `terrainHeightM` is the AR-DATUM-GATED DEM sampler (ellipsoidal DEM+N at
   * a point in the scene anchor's ENU), answering `undefined` while the held
   * field does not match AR's datum — the same two gates the HUD's terrain
   * line uses (`terrainReadout`). The gate lives with the caller because the
   * caller owns the field and the session undulation.
   */
  readonly autoElevation?:
    | {
        readonly terrainHeightM: (enu: AnchorEnuPoint) => number | undefined;
      }
    | undefined;
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
    /**
     * Removes the `beforexrselect` handler from the PAGE-lifetime overlay root.
     *
     * Named here rather than left unregistered because `deps.container` is
     * `el("ar-root")` and outlives every session: a handler added per entry and
     * never removed accumulates for the life of the tab (PR #333 review).
     */
    releaseXrSelect?: () => void;
    /** The top-of-screen column the readout lives in (DEC-W5). */
    stack?: HTMLElement;
    /**
     * The bottom-of-screen stack: elevation + slider + gear on one row, the
     * compass readout on its own line beneath (H6, DEC-Y10/Y12).
     */
    bottom?: HTMLElement;
    experiments?: ArExperimentPanel;
    shell?: ArBuildingMaterial;
    // `| undefined` EXPLICITLY, because `exactOptionalPropertyTypes` is on:
    // the landing branch CLEARS this field, and without the union a bare `?`
    // means "may be absent", not "may be set to undefined".
    entryVeil?: ReturnType<typeof createArEntryVeil> | undefined;
    entryWait?: HTMLElement | undefined;
    entryDomVeil?: ArEntryDomVeil | undefined;
    /**
     * Frames seen since the veil went up.
     *
     * The DOM veil starts fading on the SECOND, not the first. Both per-frame
     * hooks run BEFORE `renderer.render` in the same tick, so "the callback
     * ran" does not mean "a frame was drawn" — fading from the first would
     * close a sub-frame race with a trigger that fires one call too early.
     */
    framesSinceVeil?: number;
    /**
     * The frame clock reading the DOM veil's fade began at (DEC-L1).
     *
     * Latched on the frame the hard removal used to happen, so the fully-black
     * period is never shorter than the one the fade replaces.
     */
    domVeilFadeStartS?: number;
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
    // THE DOM VEIL FIRST, and unconditionally. It is an OPAQUE, full-viewport
    // child of `#ar-root`, which is `position: fixed; inset: 0` and hidden only
    // while `:empty` — so one left behind is a black rectangle over the whole
    // desktop app. The framework's teardown removes only its own canvas, never
    // arbitrary children, and this repo has shipped exactly that regression
    // once already.
    session.entryDomVeil?.remove();
    session.releaseXrSelect?.();
    session.unregisterFrame?.();
    session.hud?.dispose();
    // BEFORE the city is handed back, so the control cannot outlive the scene
    // it nudges — and so nothing is left in `#ar-root`, which is hidden only
    // while `:empty`.
    session.elevation?.dispose();
    // Same reason as the elevation control above: nothing may be left in
    // `#ar-root`, which is hidden only while `:empty`.
    session.compass?.dispose();
    session.experiments?.dispose();
    // AFTER its two children, so the column goes with them. `#ar-root` is
    // hidden only while `:empty`, and anything left attached keeps a
    // full-viewport layer over the page once AR stops — the regression
    // `ar-compass-control.ts`'s own sidecar records having shipped once.
    session.stack?.remove();
    // AND THE BOTTOM STACK, for the same reason: `#ar-root` is hidden only
    // while `:empty`, so an orphaned container keeps a full-viewport layer over
    // the page once AR stops.
    session.bottom?.remove();
    // RESTORED BEFORE the city is handed back, so the desktop view never sees
    // an additive, depth-write-free material against its own sky gradient.
    // THE ENTRY VEIL, BEFORE the city is handed back. It is an opaque,
    // screen-filling surface in the AR scene; anything that leaves it behind
    // turns the passthrough into a lid. Disposing here as well as on landing is
    // deliberate belt-and-braces -- a session ended DURING the descent never
    // reaches the landing branch, and that is the common case when someone
    // backs out because the entry looked wrong.
    session.entryVeil?.dispose();
    session.entryVeil = undefined;
    // AND THE WAITING LINE WITH IT (DEC-J11). It is removed when the descent
    // starts, but a session abandoned DURING the hold never gets there, and a
    // stranded "finding your position..." is a claim about a session that has
    // ended.
    session.entryWait?.remove();
    session.entryWait = undefined;
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

  // BUILT BEFORE `initAR`, because the depth callback below closes over it.
  // One pipeline per session, dropped with the handle — grid cells are
  // odometry-frame state and must never survive into a later session.
  const depthPipeline =
    deps.autoElevation === undefined ? undefined : createArDepthPipeline();
  // DECLARED BEFORE `initAR` because the restart callback below closes over
  // it; ASSIGNED after, because its construction needs `geometricOffset`. The
  // callback only fires inside a live session, after the assignment.
  let auto: ArElevationAuto | undefined;

  // ONE TAP MUST BE ONE EVENT (DEC-Y18). Inside an `immersive-ar` session with
  // `dom-overlay`, a tap on the overlay fires a DOM `click` AND generates an XR
  // `select`, and cancelling `beforexrselect` suppresses only the XR half.
  //
  // The spec is explicit that this has "no effect on DOM event processing", so
  // it can never stop a button working — the failure it prevents is the reverse:
  // a control firing twice through two paths, where anything stateful on the
  // select side can undo what the click just did. That is one candidate for the
  // gear button reported as dead in r541.
  //
  // Registered BEFORE `initAR` so no frame of a live session is unprotected, and
  // on the overlay root itself because the event is composed and bubbles from
  // whichever child was hit.
  //
  // REGISTERED INTO `release()`'s DISCIPLINE, not outside it (PR #333 review).
  // `deps.container` is `el("ar-root")` — a PAGE-lifetime element, not something
  // built per session — so a listener added here and never removed accumulates
  // one handler per AR entry for the life of the tab. Today that is N idempotent
  // `preventDefault()` calls and therefore benign, which is exactly why it would
  // have survived: the next listener added to this element by someone following
  // the pattern would not be benign.
  const cancelXrSelect = (event: Event): void => {
    event.preventDefault();
  };
  deps.container.addEventListener("beforexrselect", cancelXrSelect);
  session.releaseXrSelect = () => {
    deps.container.removeEventListener("beforexrselect", cancelXrSelect);
  };

  /**
   * Where the descent starts: the height the user was already looking from in
   * the 3D view, capped.
   *
   * **Taken ONCE at entry rather than read per frame** — the desktop camera
   * keeps living while AR runs, and a descent that tracked it would move the
   * city because something off-screen moved.
   *
   * **Read BEFORE the session is requested (DEC-K5)**, because the DOM veil is
   * gated on it and has to be in place before `requestSession`. It is the same
   * number either way: `cameraHeightM()` reads the DESKTOP camera, which
   * starting a session does not touch.
   */
  const descentStartM = Math.min(
    DESCENT_MAX_START_M,
    Math.max(0, deps.buildingView.cameraHeightM?.() ?? 0),
  );

  // THE DOM VEIL GOES UP BEFORE THE SESSION IS ASKED FOR (DEC-K5). From the
  // moment `requestSession` resolves the passthrough camera is composited, and
  // nothing is drawn into the XR layer until the first `renderer.render` — an
  // undrawn `alpha-blend` framebuffer IS the camera image. That window is what
  // the field report saw as a flash of camera between two blacks, and no scene
  // mesh can close it because there is no rendered scene yet.
  //
  // GATED ON THE SAME CONDITION AS THE MESH VEIL. With `descentStartM === 0`
  // there is no descent, no mesh veil and nothing to fade, so a DOM veil there
  // would be an opaque lid with nothing to lift it.
  //
  // ⚠️ AND THE DESKTOP GOES BLACK WHILE THE CONSENT PROMPT IS UP, which is the
  // accepted price rather than an oversight. `#ar-root` is hidden only while
  // `:empty`, so inserting the veil makes it cover the page immediately — and
  // the browser's AR permission dialog sits over that. Waiting until the
  // session is granted is not available: `initAR` wraps `requestSession`, and
  // the window this veil exists for opens the moment that call resolves.
  // Every exit path removes it, so a refusal returns to the desktop view.
  if (descentStartM > 0) {
    session.entryDomVeil = createArEntryDomVeil(deps.container);
  }

  try {
    await initAR(
      deps.container,
      {
        // The city is geometry, not vision. The camera image is never read,
        // and both camera flags default ON — leaving them on would add a
        // crash surface and a permission prompt for features this mode never
        // uses. Depth-sensing follows the auto-elevation switch: the floor
        // estimator needs the depth stream, and the kill switch turns all of
        // it off at once. The depth-TEXTURE near/far override that once kept
        // this flag false is NOT in play here — see the note at the frame
        // loop below (the framework pins cpu-optimized depth usage).
        enableCameraAccess: false,
        enableDepthSensingFeature: depthPipeline !== undefined,
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
          //
          // THE GRID IS CLEARED IN THE SAME BREATH (plan §2.4): its cells are
          // measured in the frame that just died, and stale cells produce a
          // plausible-looking WRONG floor inside the estimator's acceptance
          // band. THE ESTIMATOR IS RESET IN THE SAME BREATH TOO (cold-review
          // F2): its window holds samples measured in the same dead frame,
          // and its hold branch would keep publishing a dead-frame value for
          // up to 45 s while the cleared grid refills. One callback, so the
          // three can never drift apart.
          onRestarted: (payload) => {
            depthPipeline?.clear();
            auto?.reset();
            deps.store.dispatch(odometryTrackingRestarted(payload));
          },
        },
        // DIRECT FOLD, NO STORE HOP (plan §2.6): the demo records nothing, so
        // routing 576-point payloads through Redux at ~5 Hz would buy only
        // dev-mode serializability checks. Present only with the pipeline —
        // the framework creates its DepthSampler from this group's presence.
        ...(depthPipeline === undefined
          ? {}
          : { depth: { onCaptured: depthPipeline.fold } }),
        onSessionEnd: () => {
          if (!bootCompleted) {
            // THE DOM VEIL STILL COMES DOWN, and this branch used to leak it
            // (found in the DEC-L1 milestone review; the defect predates that
            // work). A session that ends between `initAR` resolving and the
            // boot finishing never reaches `release()`, so the veil — FULLY
            // OPAQUE at that point, since the frame loop has not started —
            // stays attached to `#ar-root`, which is `position: fixed; inset: 0`
            // and hidden only while `:empty`. That is a black rectangle over
            // the whole desktop app with no error anywhere: the exact
            // regression this repo has shipped once already.
            //
            // ONLY THE VEIL, not `release(false)`: the boot is still running
            // and tearing its half-built state down from here is a different
            // and much larger change. `remove()` is idempotent, so the boot
            // path that follows is unaffected.
            session.entryDomVeil?.remove();
            return;
          }
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
    // AND THE DOM VEIL, which `endARSession` does not touch — it removes the
    // framework's own canvas and nothing else. This is the path the user takes
    // by dismissing the AR permission prompt, so leaving an opaque child here
    // would black out the desktop app on a refusal.
    session.entryDomVeil?.remove();
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
    // Same reasoning as the reject path above: `endARSession` clears the
    // framework's canvas, not our overlay children.
    session.entryDomVeil?.remove();
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
    // ONE CHANNEL, TWO CONTRIBUTORS (plan §2.6): the automatic offset and the
    // manual trim share the nudge's `applyElevation` path, composed here and
    // nowhere else. A null auto contributes ZERO, so with the estimator cold
    // or the kill switch set the buttons behave exactly as they always did —
    // the owner's escape hatch stays live whatever the estimator does.
    //
    // WHAT IS COMPOSED IS THE EASED, GATED AUTO VALUE, not the published one
    // (cold-review F4 for the ease, F1 for the gate — see the frame loop):
    // `appliedAutoM` glides toward the gated target
    // at AUTO_APPLY_RATE_M_PER_S in the frame loop below, so the cold-start
    // first value and each 1 Hz step reach the content as an ease, never a
    // step. The manual trim bypasses the ease by design (DEC-E1).
    let autoM: number | null = null;
    let manualTrimM = 0;
    /**
     * The entry fly-down (Q5). `descentStartS` is the frame clock reading the
     * descent began at, cleared once it lands so the term costs nothing for the
     * rest of the session; `descentM` is its current contribution.
     */
    let descentStartS: number | undefined;
    /** The frame clock reading of the session's first frame (r543 entry gate). */
    let contentAttached = false;
    let firstFrameS: number | undefined;
    let descentM = 0;
    /** Latched, so the one-shot start guard cannot re-arm after the landing. */
    let descentDone = false;
    /** Latched, so the engagement stamp is announced once per session. */
    let estimateEngagedReported = false;

    let appliedAutoM = 0;
    /**
     * Move everything that lives on the vertical axis, together.
     *
     * THE ENTRY GROUND MOVES HERE AND NOWHERE ELSE, which is the whole reason
     * this function grew a body. It was positioned at its creation and again in
     * the frame loop, and both call sites used `descentM` alone -- so the
     * ground sat `auto + trim` metres from the surface the buildings stand on.
     * Fixing the two call sites left a THIRD path uncovered: the manual nudge
     * re-attaches the city through here without touching the frame loop, so the
     * ground lagged a nudge until the next frame. Three call sites, one of them
     * missed, is the argument for none.
     */
    const applyComposed = () => {
      const composedM = composeElevationM(appliedAutoM, manualTrimM, descentM);
      applyElevation(composedM);
      // NOTHING FOR THE VEIL HERE. Unlike the entry ground it replaced, the
      // veil is centred on the CAMERA rather than on the city, so the elevation
      // composition cannot move it -- which removes the three-call-site hazard
      // this function was grown to contain.
    };
    // ATTACHED AT DESCENT DEPTH, NOT AT ZERO -- the r543 entry jump.
    //
    // This used to be `applyElevation(0)`, which put the city at the height an
    // auto-elevation term of 0 implies, because no estimate has arrived on the
    // first frame. "Das erste Mal ... starte ich bei Altitude null ... wodurch
    // ich dann erstmal sehr weit unter der Open Street Map Welt bin und dann
    // wird meine Altitude gefixt, so dass ich dann auf einmal über die OSM Welt
    // springe." The correction landed mid-descent, as a jump.
    //
    // THE FIX IS TWO HALVES AND NEEDS BOTH. The city goes straight to the
    // descent's starting depth here, and the frame loop holds the passthrough
    // BLACK until the estimate lands (see `descentMayStart`) -- so the frames
    // in which the city is placed from an uncorrected datum are frames nobody
    // sees. The auto term is then SNAPPED rather than eased, under that black,
    // and the descent begins from a position that is already right.
    //
    // WHY EAGERLY AT ALL, rather than deferring the first attach to the frame
    // that opens the gate: `attachContentTo` can throw, and `startArMode`'s
    // catch is what turns that into a clean rollback -- `onError`, the session
    // ended, the button restored. Moving the first attach into the frame
    // callback moved it OUT of that catch, leaving a live session with no city
    // and no error. A test written for exactly that path caught it.
    descentM = descentOffsetM({ elapsedS: 0, startM: descentStartM });

    // THE ENTRY VEIL (J1, DEC-J1). "Eine Schicht ... die zwischen dem
    // Kamerahintergrundbild und den 3D-OpenStreetMap-Szenendaten ist ... erst
    // komplett sichtbar ... und dann ... herausgefadet wird."
    //
    // IT REPLACES BOTH the entry GROUND (r543, reversed by the same session that
    // asked for this) AND `renderer.setClearAlpha`, which was the shipped veil
    // and is dead inside an XR session -- three's `WebGLBackground.render()`
    // overwrites the clear to (0,0,0,0) for every `alpha-blend` environment.
    // See `ar-entry-veil.ts.md`.
    //
    // ONLY WHEN THERE IS A DESCENT. Entering from a ground-level 3D view gives
    // `descentStartM === 0`, and `cameraFadeAlpha` returns 1 for a zero start,
    // so there is nothing to fade: a veil there would be an opaque lid that
    // never lifts.
    if (descentStartM > 0) {
      const entryVeil = createArEntryVeil();
      entryVeil.setAlpha(
        entryVeilAlpha({ elapsedS: 0, startM: descentStartM }),
      );
      entryVeil.follow(camera.getWorldPosition(new THREE.Vector3()));
      scene.add(entryVeil.mesh);
      session.entryVeil = entryVeil;

      // THE WAITING LINE (DEC-J11). The hold before the descent can last
      // `DESCENT_ESTIMATE_WAIT_S`, and a static picture with no motion for that
      // long does not say whether the entry is working or stalled -- the same
      // ambiguity `descentComplete` exists to remove at the other end.
      //
      // NOT "the screen would otherwise be blank", which an earlier draft
      // claimed: the city is already attached below the user by the eager
      // attach above, and the additive shell draws OVER the veil, so the hold
      // shows the city 60-100 m down. It is the absence of MOTION that is
      // ambiguous, not the absence of pixels.
      const entryWait = document.createElement("p");
      entryWait.className = "ar-entry-wait";
      entryWait.setAttribute("role", "status");
      entryWait.setAttribute("aria-live", "polite");
      entryWait.textContent = "Finding your position…";
      deps.container.append(entryWait);
      session.entryWait = entryWait;
    }

    applyComposed();

    // AR ONLY. The desktop preview discards `geometricOffset` (it attaches with
    // "demo-scene", which sets identity), and making it follow would lift the
    // buildings away from the ground plane, the route line and the NPC agent —
    // all of which live on the preview's own scene and would stay put.
    // THE BOTTOM STACK (H6, DEC-Y10). Two rows, and the second one is forced by
    // arithmetic rather than chosen: measured at 390 px the elevation control is
    // ~149 px with the round-four tap targets (2 rem buttons, a 3 rem value box)
    // and the gear adds ~40 px, leaving ~180 px for a slider — while the live
    // readout (DEC-Y12) is ~40 characters and cannot share a row with anything.
    // So row one is elevation + slider + gear, and the readout gets its own line
    // beneath. Discovering that in CSS instead of stating it here is how the
    // previous two attempts at this row ended up overflowing.
    //
    // ONE CONTAINER, not three absolutely-positioned controls. The compass box
    // changes height at runtime and the readout's text length changes with the
    // phase, so two hard-coded offsets that must not collide is exactly how the
    // earlier toast/slider overlap happened (PR #311 review, finding 4).
    const arBottom = document.createElement("div");
    arBottom.className = "ar-bottom";
    deps.container.append(arBottom);
    session.bottom = arBottom;

    const arBottomRow = document.createElement("div");
    arBottomRow.className = "ar-bottom-row";
    arBottom.append(arBottomRow);

    session.elevation = createArElevationControl({
      root: arBottomRow,
      onChange: (offsetM) => {
        manualTrimM = offsetM;
        applyComposed();
      },
    });
    session.elevation.attach();

    // THE ESTIMATOR, only when the caller wired the DEM sampler (kill switch:
    // absent dep = no depth, no grid, no estimator — see `ArModeDeps`).
    // `geometricOffset` doubles as the anchor's NUE offset: the same value the
    // city is attached with is what reconciles hit positions (about `zero`)
    // with the DEM field (about the scene anchor), so the two CANNOT disagree.
    auto =
      depthPipeline !== undefined && deps.autoElevation !== undefined
        ? createArElevationAuto({
            grid: depthPipeline.grid,
            terrainHeightM: deps.autoElevation.terrainHeightM,
            anchorOffsetNue: geometricOffset,
          })
        : undefined;
    // Sampling starts once, after `initAR` created the framework's sampler.
    // The framework tears it down with the session, so there is no stop here.
    if (depthPipeline !== undefined) {
      startDepthCapture(AR_DEPTH_SAMPLER_CONFIG);
    }

    // THE TOP-OF-SCREEN COLUMN the readout and the slider share (G9, DEC-W5).
    //
    // A BOX THE DEMO OWNS, not `#ar-root` itself. The framework inserts its
    // full-screen canvas as `#ar-root`'s first child, in flow with an inline
    // 100vh height — so making that element a flex column pushed both controls
    // a full viewport below the fold. This wrapper keeps the column without
    // touching what the framework puts in the overlay root.
    const arStack = document.createElement("div");
    arStack.className = "ar-stack";
    deps.container.append(arStack);
    session.stack = arStack;

    // THE COMPASS SLIDER (DEC-E2) AND THE EXPERIMENT PANEL (DEC-Y10), only when
    // the caller can actually dispatch.
    //
    // BOTH IN THE BOTTOM ROW SINCE H6: "diesen Kompass-Slider würde ich
    // eigentlich gerne nach unten packen neben die Plus-Minus-UI". That
    // partially reverses DEC-W5, which put the slider in the top stack — G9's
    // original complaint was that it sat in the MIDDLE of the view, and the
    // bottom satisfies that just as well as the top did.
    if (deps.onCompassSettings !== undefined) {
      const onCompassSettings = deps.onCompassSettings;
      // Held so a panel change can re-publish the slider's current position:
      // `compassSettingsFor` maps influence AND experiments together, so a
      // toggle change must resend the weight or the store would take the
      // experiments with a default weight.
      let experiments = COMPASS_EXPERIMENT_DEFAULTS;

      const compass = createArCompassControl({
        root: arBottom,
        onChange: onCompassSettings,
        experiments: () => experiments,
      });
      session.compass = compass;
      compass.attach();
      // READY IMMEDIATELY, and that is a fact rather than an assumption: every
      // compass setter is a no-op while the store's gps state is null, but AR
      // entry is GATED on `canEnterAr(deps.origin)`, and a non-null origin IS the
      // framework's `zero` — so `setZeroPos` has already been dispatched by the
      // time this line runs. The control's latch stays as the defensive path for
      // any future caller that is not gated the same way.
      compass.setReady(true);

      session.experiments = createArExperimentPanel({
        root: arBottomRow,
        initial: experiments,
        onChange: (next) => {
          const gateChanged = next.trustGateMode !== experiments.trustGateMode;
          experiments = next;
          // RE-PUBLISH THROUGH THE SLIDER, not directly: the store needs one
          // coherent configuration, and the slider owns the weight half of it.
          compass.republish();
          // AND SAY SO (DEC-K6). The trust gate is read live, on every GPS
          // observation — but nothing re-solves on the dispatch, the matrix is
          // recomputed only when the next fix arrives, and the view lerps
          // toward it. So a correct change produces NO visible motion, the
          // panel closes itself, and a field session reasonably concluded the
          // setting was being ignored.
          //
          // Announced only when the gate actually MOVED: a confirmation that
          // fires for every panel interaction, including ones that changed
          // nothing, is noise and stops being read.
          if (gateChanged) {
            compass.announce(describeTrustGate(next.trustGateMode));
          }
        },
      });
      session.experiments.attach();
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
    session.hud = createArHud(arStack);
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
    // The last auto state, held for the HUD between the ~1 Hz ticks.
    let latestAuto: ArElevationAutoState | undefined;
    session.unregisterFrame = registerXrFrameUpdate(({ dt, elapsed }) => {
      // THE DOM VEIL STARTS FADING ON THE SECOND FRAME, AND THE COUNT IS THE
      // POINT.
      //
      // Both per-frame hooks the framework offers run BEFORE
      // `renderer.render(scene, camera)` in the same tick, so by the time this
      // callback runs for the first time NOTHING has been drawn yet. Removing
      // the DOM veil there would uncover the passthrough for exactly the frame
      // the mesh veil has not been rendered into — closing a sub-frame race
      // with a trigger that fires one call too early, which is the same class
      // of mistake this milestone exists to fix.
      //
      // On the second callback a full frame has been submitted with the mesh
      // veil in the scene, so the handover is invisible: same colour, one
      // opaque layer over another.
      //
      // AND IT FADES FROM THERE RATHER THAN VANISHING (DEC-L1). The
      // seventeenth field session still saw a flash of camera at the instant of
      // the hard cut, and the cause is not determinable from here — a later
      // frame that skipped `renderer.render`, a one-frame seam between the DOM
      // overlay layer and the WebGL layer, or a two-frame margin too thin for
      // the device. A fade covers all three without anyone having to decide
      // which is real. The fully-black period is unchanged: the fade STARTS
      // where the removal used to be, at alpha 1.
      //
      // REMOVED WHEN THE CURVE REACHES 0, not on a timer of its own, so the
      // element and the opacity cannot disagree about whether the entry is over.
      if (session.entryDomVeil !== undefined) {
        session.framesSinceVeil = (session.framesSinceVeil ?? 0) + 1;
        if (session.framesSinceVeil >= 2) {
          session.domVeilFadeStartS ??= elapsed;
          const alpha = domVeilAlpha(elapsed - session.domVeilFadeStartS);
          if (alpha > 0) {
            session.entryDomVeil.setAlpha(alpha);
          } else {
            session.entryDomVeil.remove();
            session.entryDomVeil = undefined;
          }
        }
      }
      // THE DESCENT'S CLOCK STARTS ON THE FIRST FRAME, not at `startArMode`.
      // `elapsed` is PAGE-relative — a session entered thirty seconds after load
      // sees its first frame at `elapsed ≈ 30` — so anchoring to 0 would make
      // the hold and the fall both already over before a single frame ran, and
      // the feature would silently do nothing on any page that had been open a
      // while. That is the same trap the fps sampler below documents.
      // THE ENTRY GATE (r543). The descent -- and the first attach with it --
      // waits for the elevation estimate it is measured from.
      //
      // THE CLOCK STILL STARTS ON THE FIRST FRAME, not at `startArMode`.
      // `elapsed` is PAGE-relative: a session entered thirty seconds after
      // load sees its first frame at `elapsed ~= 30`, so anchoring to 0 would
      // make the hold and the fall both already over before a single frame
      // ran. That is the same trap the fps sampler below documents.
      firstFrameS ??= elapsed;
      // NO `descentM === 0` TERM ANY MORE, and dropping it was required rather
      // than tidy: the city is now attached at descent depth by `startArMode`,
      // so `descentM` is already `-startM` on the first frame and that
      // condition would never hold again. Left in place it silently disabled
      // the entire descent -- four tests caught it, all reporting the city
      // stuck at its starting depth. `descentStartS === undefined` already
      // means "not begun" and `descentDone` already means "finished".
      if (descentStartS === undefined && !descentDone) {
        // TWO WAYS TO HAVE NOTHING TO WAIT FOR, and both must open the gate
        // immediately or it becomes a stall.
        //
        // NO ESTIMATOR: `auto` is undefined when the caller wired no DEM
        // sampler or the kill switch is set, so no estimate is ever coming.
        //
        // NO DESCENT: `descentStartM === 0` -- entered from a ground-level 3D
        // view, or from a `buildingView` that reports no camera height at all,
        // since that read is optional-chained. There is then no entry
        // transition to hide the wait behind: `cameraFadeAlpha` returns 1 for a
        // zero start, so nothing fades and the hold below would be up to THREE
        // SECONDS of opaque veil ending in a hard cut. That is worse than the
        // jump this gate exists to remove, and it would hit every such session
        // rather than only the first. Caught in cold review.
        const estimateReady =
          auto === undefined ||
          descentStartM === 0 ||
          (latestAuto?.engaged === true && autoM !== null);
        if (
          !descentMayStart({ waitedS: elapsed - firstFrameS, estimateReady })
        ) {
          // OPAQUE WHILE WAITING, on the same channel the descent fade uses, so
          // the two cannot disagree about what the screen shows. Without this
          // the wait would be plain passthrough and would read as AR having
          // failed to load anything.
          //
          // AND FOLLOWING THE CAMERA THROUGHOUT. The user can turn on the spot
          // during the hold, and a veil left where the session started would
          // swing off the screen edge -- the one failure DEC-J2 chose a sphere
          // to avoid, given away for free by not re-centring it.
          session.entryVeil?.setAlpha(1);
          session.entryVeil?.follow(camera.getWorldPosition(cameraWorld));
        } else {
          // SNAP THE AUTO TERM RATHER THAN EASE IT, exactly once, and only here.
          // The ease below exists so a LIVE correction cannot make the city jump
          // under someone who is looking at it -- but nothing is on screen yet,
          // so there is nothing to jump, and easing from 0 would spend the whole
          // descent travelling to the position the descent is measured from.
          // NOT COVERED BY A TEST, and the reason is itself the finding: the
          // estimator cannot engage inside the 3 s wait in any existing
          // fixture (it needs ~5 s of walking), so this branch is unreachable
          // there and mutating it to a bare 0 leaves the suite green. Writing
          // the test needs a field measurement first -- see the followup doc
          // named beside DESCENT_ESTIMATE_WAIT_S.
          appliedAutoM = estimateReady && autoM !== null ? autoM : 0;
          descentStartS = elapsed;
          // ASKED FOR, NOT RE-DERIVED (DEC-Y14). This used to be
          // `descentM = descentStartM`, a hand-rolled copy of "the offset at
          // t=0" -- and `descentStartM` is a POSITIVE height, so after the sign
          // fix that one line still attached the city ABOVE the user for a
          // single frame before the block below recomputed it. It self-healed
          // within the frame, which is precisely why it survived: the endpoint
          // assertions read the last attach and never saw it.
          descentM = descentOffsetM({ elapsedS: 0, startM: descentStartM });
          // AND RE-APPLY, which is what corrects the auto term: the eager attach
          // at entry used 0, and `applyComposed` is where the snapped value
          // above reaches the city -- under the black that has been held since
          // entry. This line was duplicated, with the comment attached to the
          // dead copy, until a cold review pointed out that recomputing a pure
          // function of two unchanged values cannot correct anything.
          applyComposed();
          contentAttached = true;
        }
      }
      windowOpenedAtS ??= elapsed;
      framesThisWindow += 1;
      const windowS = elapsed - windowOpenedAtS;
      const fps = windowS > 0 ? framesThisWindow / windowS : undefined;

      // NO NEAR/FAR RE-ASSERTION HERE, and its absence is a verified fact,
      // not an oversight (cold-review F1 removed an inert guard): three.js
      // takes depthNear/depthFar from a depth texture only in GPU-OPTIMIZED
      // depth sessions, and the framework pins `usagePreference:
      // ['cpu-optimized']` (permission-checker.ts, asserted by its own
      // test) — so the override path is not in play, and three never writes
      // near/far back onto the app's camera object either, which made the
      // old drift check unreachable. The M5 field check is now simply:
      // confirm no clip/fog anomaly with depth sensing on.

      // THE AUTO TICK, before the HUD sample so the readout shows what this
      // very frame published. `sample` self-throttles to ~1 Hz.
      if (auto !== undefined) {
        const pose = getCurrentArPose();
        const aligned = !arWorldGroup.matrix.equals(identityMatrix);
        latestAuto = auto.sample({
          nowMs: elapsed * 1000,
          cameraPosAr:
            pose === null
              ? undefined
              : [pose.position.x, pose.position.y, pose.position.z],
          // GATED ON AN ALIGNMENT EXISTING, like `worldBaselineY` below and
          // for the same reason: identity's element 13 is a plausible 0.
          alignment: aligned ? arWorldGroup.matrix.elements : undefined,
        });
        autoM = latestAuto.autoM;
        // THE ENGAGEMENT STAMP (owner decision, 2026-08-23), and it is an
        // instrument rather than a feature — see `onEstimateEngaged`.
        //
        // ONCE, latched on its own flag rather than on `latestAuto.engaged`
        // alone: engagement is HYSTERETIC (`ar-elevation-auto.ts` owns both
        // thresholds), so a confidence hovering at the boundary would otherwise
        // re-announce every crossing.
        //
        // RELATIVE TO THE FIRST FRAME, not to `elapsed`, which is PAGE-relative
        // — a session entered thirty seconds after load sees its first frame at
        // `elapsed ~= 30`, and an unsubtracted stamp would report a number that
        // grows with how long the tab has been open. Same trap the fps sampler
        // and the descent clock both document.
        if (latestAuto.engaged && !estimateEngagedReported) {
          estimateEngagedReported = true;
          deps.onEstimateEngaged?.(elapsed - (firstFrameS ?? elapsed));
        }
        // THE APPLICATION-TIME EASE (cold-review F4): glide the applied auto
        // contribution toward the published target at the bounded rate, so a
        // cold-start first value or a 1 Hz step never moves the content in
        // one frame. A null target eases back to the auto-off contribution
        // of ZERO — the kill-switch/cold-start contract, reached smoothly.
        // `dt` is 0 on the first frame after a reset (framework contract),
        // which correctly moves nothing on that frame.
        // THE CONFIDENCE GATE (cold-review F1): only an ENGAGED auto value
        // reaches the content. Below the gate the contribution is ZERO — the
        // manual trim behaves exactly as it did before this feature existed —
        // while `autoM` stays published for the HUD, which labels it as not
        // applied. Engagement is hysteretic (`ar-elevation-auto.ts` owns both
        // thresholds), so a confidence hovering at the boundary cannot flap
        // the city; and because the target is EASED below, engaging and
        // releasing both glide at AUTO_APPLY_RATE_M_PER_S rather than step.
        const targetM = latestAuto.engaged && autoM !== null ? autoM : 0;
        // NOT BEFORE THE FIRST ATTACH (r543). Until the entry gate above has
        // put the city in the scene there is nothing to ease -- and easing
        // anyway would call `applyComposed`, which IS the attach, defeating
        // the gate by the back door. The gate snaps `appliedAutoM` to its
        // target at the moment it attaches, so this block has nothing left to
        // do on that frame either.
        if (contentAttached && appliedAutoM !== targetM) {
          // Non-finite dt (defensive: the contract says a number, but a NaN
          // here would poison appliedAutoM for the rest of the session)
          // moves nothing, like the documented dt = 0 reset frame.
          const maxStepM =
            AUTO_APPLY_RATE_M_PER_S * (Number.isFinite(dt) ? dt : 0);
          const deltaM = targetM - appliedAutoM;
          appliedAutoM +=
            Math.abs(deltaM) <= maxStepM
              ? deltaM
              : Math.sign(deltaM) * maxStepM;
          applyComposed();
        }
      }
      // THE ENTRY FLY-DOWN (H5, Q5), driven from the same `elapsed` clock as the
      // breathing below — monotonic and page-relative, so a backgrounded tab
      // cannot make the city jump.
      //
      // A THIRD TERM IN THE COMPOSITION, never its own `applyElevation` call:
      // that function SETS rather than accumulates, and the auto ease above
      // re-applies the composition whenever it moves, so a descent written the
      // obvious way is clobbered within a frame or two.
      if (descentStartS !== undefined) {
        const input = {
          elapsedS: elapsed - descentStartS,
          startM: descentStartM,
        };
        const nextDescentM = descentOffsetM(input);
        if (nextDescentM !== descentM) {
          descentM = nextDescentM;
          applyComposed();
        }
        // THE CAMERA FADE (DEC-J1), on the veil rather than on the renderer.
        //
        // THIS USED TO BE `setClearAlpha(1 - cameraFadeAlpha(input))`, and it
        // did nothing on any device: `WebGLBackground.render()` reads
        // `xr.getEnvironmentBlendMode()` AFTER applying our clear and forces
        // (0,0,0,0) for `alpha-blend`, which is every video-passthrough phone.
        // The unit test asserting the call was made passed the whole time.
        //
        // THE WAITING LINE GOES THE MOMENT THE DESCENT DOES (DEC-J11): the
        // ambiguity it answers is "is anything happening", and something is.
        session.entryWait?.remove();
        session.entryWait = undefined;
        session.entryVeil?.follow(camera.getWorldPosition(cameraWorld));
        session.entryVeil?.setAlpha(entryVeilAlpha(input));
        if (descentComplete(input)) {
          // THE VISIBLE END-STATE SIGNAL the plan requires. A descent that
          // STALLS is otherwise indistinguishable from the recorded "flying
          // roughly 50 m above the OSM buildings" datum bug, and that ambiguity
          // is what would make a field report unactionable. Saying so once, on
          // arrival, is the cheapest way to tell them apart.
          descentStartS = undefined;
          descentDone = true;
          // GONE ON LANDING, not merely transparent. This is the moment the
          // entry is over, and a veil that survives it is the one failure this
          // feature can produce that is worse than not having it.
          session.entryVeil?.dispose();
          session.entryVeil = undefined;
          deps.onDescentComplete?.();
        }
      }

      // THE BREATHING. Driven from `elapsed` -- the frame clock the loop already
      // computed, monotonic and page-relative -- rather than from wall time, so the
      // pulse cannot jump when the tab is backgrounded.
      session.shell?.setTime(elapsed);
      // NOTHING BELOW IS BUILT UNLESS THE READOUT WILL ACCEPT IT (PR review of
      // P4/P5, finding 7). `sample` is cheap and its argument is not: this
      // object costs an ENU transform, a bilinear terrain read and a
      // great-circle distance, and the loop was paying all of it at display
      // rate for a readout that takes a value twice a second — roughly 30x more
      // often than the result is used, inside an XR frame loop, on a phone.
      //
      // `due` reads the same `lastWriteMs` `sample` does, so this is one
      // cadence queried twice rather than two cadences that can drift.
      const hud = session.hud;
      if (hud !== undefined && hud.due(elapsed * 1000)) {
        const live = deps.liveMeasurements?.() ?? {};
        // THE COMPASS READOUT (DEC-Y12), on the HUD's own ~1 Hz rather than per
        // frame: these change once per GPS event, and a per-frame readout would
        // flicker while saying nothing new.
        //
        // Read through the library's selector rather than off the state tree, so
        // the demo does not depend on where the fields live. Absence is passed
        // through as absence — the readout distinguishes "not measured yet" from
        // "measured as zero", and with an untrusted vote those look identical in
        // the number alone.
        // MAPPED FIELD BY FIELD, not spread. The selector returns the whole
        // `TrustMemory` object; the readout wants its `state` string. Passing
        // the selector's result straight through typechecked only because the
        // framework's built `dist` was stale at the time — it would have
        // rendered every session as "untrusted" on device while every test
        // passed. Naming the three fields makes the adapter visible and makes a
        // future shape change a compile error rather than a wrong readout.
        // GUARDED, because this is a DEBUG READOUT and it runs in the frame
        // loop. `getCompassDiagnostics` is licence-gated like every other public
        // selector and throws when the store was not built through
        // `createSlamAppStore` — a legitimate configuration for a harness or a
        // future embedder. A readout that cannot be drawn must never stop the
        // session drawing: the failure mode without this is that AR dies at the
        // first HUD tick, which is a far worse outcome than a missing line.
        try {
          // CAST, and the `try` above is what makes it safe rather than
          // hopeful. `ArModeDeps.store` is typed as the framework's minimal
          // `SubscribableStore` on purpose — this module needs a subscription
          // and nothing else, and widening it to the full `GpsSlamState` would
          // make every test fixture build a whole store. The selector reads
          // three optional fields and the guard catches a store that cannot
          // answer, so the narrow type is a documentation choice rather than a
          // safety one. The parameter type is derived from the selector itself, so
          // the demo needs no direct dependency on the library to name it.
          const compassState = getCompassDiagnostics(
            deps.store.getState() as unknown as Parameters<
              typeof getCompassDiagnostics
            >[0],
          );
          session.compass?.setLive({
            observability: compassState.observability,
            appliedWeight: compassState.appliedWeight,
            trust: compassState.trust?.state,
          });
        } catch {
          // Leave the readout showing the target alone, which is what it shows
          // before anything has been measured — an honest "no live value".
        }
        const wrote = hud.sample(
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
            // THE REAL HOLDING HEIGHT (DEC-Y5), which the auto sampler above
            // already reads and this readout already had every reason to show.
            // The framework requests `local-floor` as a REQUIRED feature
            // (`webxr-session.ts`), so the pose's `y` is height above the floor
            // plane — the only quantity here that answers "how high am I holding
            // the phone", and the one a reader was previously trying to get out
            // of `above terrain`, which cannot express it at all.
            //
            // `?? undefined` rather than a fallback number: before the first
            // pose there is no camera, and `camera 0.00 m` would claim the phone
            // is lying on the ground.
            cameraHeightM: getCurrentArPose()?.position.y,
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
            // WHERE THE ALIGNMENT THINKS THE USER IS (J7, DEC-J9/DEC-J10), so
            // the `raw gps` line beside it finally has something to be raw
            // AGAINST — two sessions in three asked whether it was already
            // fused.
            //
            // THE SAME GUARD AND THE SAME FRAME ARGUMENT as `fusedBearingDeg`
            // above: the camera is a descendant of `arWorldGroup`, so its WORLD
            // position is already NUE metres about `zero` with the alignment
            // applied, and an identity matrix means no alignment has happened —
            // which would otherwise render as a perfectly plausible coordinate.
            //
            // `toDemoLatLng` rather than a cast: `origin` is the framework's
            // `{lat, lon}` and the OSM frame takes `{lat, lng}`. That adapter
            // exists to be the alternative to a cast (`ar-origin.ts`).
            fusedPosition:
              arWorldGroup.matrix.equals(identityMatrix) || deps.origin === null
                ? undefined
                : fusedGpsFrom(
                    deps.enuFrameAt(toDemoLatLng(deps.origin)),
                    camera.getWorldPosition(cameraWorld),
                  ),
            // THE PUBLISHED AUTO OFFSET, beside the raw `above terrain` residual
            // the live measurements carry — the pair is the M5 instrument (see
            // `ar-measurements.ts`). Absent while the estimator publishes
            // nothing, per the readout's no-invented-numbers rule. `autoEngaged`
            // rides along because published is NOT applied (cold-review F1) and
            // the readout is the only thing that can say which state this is.
            ...(latestAuto === undefined || latestAuto.autoM === null
              ? {}
              : {
                  autoOffsetM: latestAuto.autoM,
                  autoConfidence: latestAuto.confidence,
                  autoEngaged: latestAuto.engaged,
                  autoFrozen: latestAuto.frozen,
                }),
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
        // covers exactly the frames the displayed number describes. Resetting
        // every frame would make it a single-frame reciprocal again by another
        // route. `due` and `sample` can still disagree — the toggle repaints
        // outside the window — so this stays keyed on what `sample` returned.
        if (wrote) {
          framesThisWindow = 0;
          windowOpenedAtS = elapsed;
        }
      }
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
