/**
 * Goal-2 composition, Viewing mode (plan
 * `plans/2026-08-14-viewing-composition-plan.md`).
 *
 * Sequences the approved components into the real visiting flow:
 * cloud-loader (6) → onboarding gate (9) → AR entry → the AR viewing scene (8)
 * driven by the proximity machine (4) with the 2D map (7) in the DOM overlay.
 *
 * Screen order is TASK.md §2.4's: the tour opens first (component 6 range-reads
 * only the central directory + tour.json, so this is fast by design), then the
 * mandatory onboarding gate, then a separate Enter-AR gesture (VC3 — the gate's
 * Start is the *audio-unlock* gesture and completes with an awaited
 * `resume()`; requesting an immersive session after those awaits risks losing
 * transient activation).
 *
 * Everything the app root shows lives inside `arHost`, the element handed to
 * `initAR`: under WebXR DOM Overlay only that subtree composites over the
 * camera feed.
 */

import "leaflet/dist/leaflet.css";

import {
  checkCameraPermission,
  checkGeolocationPermission,
  requestCameraPermission,
  requestGeolocationPermission,
} from "gps-plus-slam-app-framework/sensors";
import {
  createGpsPositionHandler,
  startSession,
  endSession,
  updateDeviceOrientation,
  selectAlignmentMatrix,
  selectZeroReference,
  selectTrackingQuality,
  computeOnboardingGuidance,
} from "gps-plus-slam-app-framework/state";
import { createEnableGpsArController } from "gps-plus-slam-app-framework/ar/enable-gps-ar";
import {
  getArWorldGroup,
  getCamera,
  getCurrentArPose,
  getXrReferenceSpace,
  getXrSession,
} from "gps-plus-slam-app-framework/ar/webxr-session";
import { registerFrameUpdate } from "gps-plus-slam-app-framework/ar/frame-loop";
import { enableArWorldGroupAlignment } from "gps-plus-slam-app-framework/visualization/ar-world-group-alignment";
import { buildMapData } from "gps-plus-slam-app-framework/visualization/map-data";

import { createViewingStore } from "../../store/viewing-store.js";
import { loadTour, clearTour } from "../../store/tour-slice.js";
import {
  selectOrderedWaypoints,
  selectNextUnvisitedWaypoint,
  selectVisitedWaypointIds,
} from "../../store/selectors.js";
import type { Tour } from "../../store/types.js";
import { mountOnboardingGate } from "../../components/onboarding/view/onboarding-view.js";
import { openRemoteTour } from "../../components/cloud-loader/view/open-remote-tour.js";
import { TourLoadError } from "../../components/cloud-loader/core/errors.js";
import {
  applyMapVisibility,
  createTourMap,
} from "../../components/map/view/tour-map.js";
import type { TourMapInstance } from "../../components/map/view/tour-map.js";
import { computeMarkerViewModels } from "../../components/map/core/map-marker-state.js";
import { createPreviewSession } from "../../components/desktop-preview/view/preview-session.js";
import type { PreviewSession } from "../../components/desktop-preview/view/preview-session.js";
import type { OsmBuildingStatus } from "../../components/desktop-preview/view/osm-building-layer.js";
import {
  computePreviewStart,
  tourStartCoord,
} from "../../components/desktop-preview/core/preview-start.js";
import { requestWakeLock, type WakeLockHandle } from "../wake-lock.js";
import {
  startArScene,
  type ArRuntime,
  type ArSceneHandle,
} from "./ar-scene-runtime.js";
import { mountHud, type Hud } from "../../components/shared/hud.js";
import {
  clearProgress,
  persistProgress,
  restoreProgress,
  type ProgressStorage,
} from "./progress-store.js";
import {
  mountErrorScreen,
  mountLoadingScreen,
  mountTourEntryScreen,
  type Screen,
  type TourEntryScreen,
} from "./screens.js";

import { locateVisitor, type LocateHandle } from "./locate-visitor.js";
import {
  classifyStartDistance,
  deriveEntryView,
  distanceToStartM,
  isDecisive,
  type StartProximity,
} from "./start-distance.js";

type ControllerFactory = typeof createEnableGpsArController;

/** How long the entry screen waits for a fix that settles how far away the
 *  visitor is, before falling back to the unchanged AR entry. */
const LOCATE_TIMEOUT_MS = 8_000;

export interface ViewingAppDeps {
  readonly openRemoteTour: typeof openRemoteTour;
  readonly createController: ControllerFactory;
  readonly createTourMap: typeof createTourMap;
  readonly createAudioContext: () => AudioContext;
  readonly checkCameraPermission: typeof checkCameraPermission;
  readonly checkGeolocationPermission: typeof checkGeolocationPermission;
  readonly requestCameraPermission: typeof requestCameraPermission;
  readonly requestGeolocationPermission: typeof requestGeolocationPermission;
  readonly startArScene: typeof startArScene;
  readonly createPreviewSession: typeof createPreviewSession;
  readonly locateVisitor: typeof locateVisitor;
  readonly arRuntime: ArRuntime;
  readonly progressStorage: ProgressStorage | null | undefined;
  /**
   * Offer the desktop preview even where AR works (`&preview=1`), so the
   * preview can be checked on the same phone the tour is authored on.
   */
  readonly forcePreview: boolean;
}

const defaultArRuntime: ArRuntime = {
  getArWorldGroup,
  getCamera,
  getXrSession,
  getXrReferenceSpace,
  enableArWorldGroupAlignment,
  registerFrameUpdate,
  selectAlignmentMatrix,
  selectZeroReference,
};

function defaultDeps(): ViewingAppDeps {
  return {
    openRemoteTour,
    createController: createEnableGpsArController,
    createTourMap,
    createAudioContext: () => new AudioContext(),
    checkCameraPermission,
    checkGeolocationPermission,
    requestCameraPermission,
    requestGeolocationPermission,
    startArScene,
    createPreviewSession,
    locateVisitor,
    arRuntime: defaultArRuntime,
    progressStorage: undefined,
    forcePreview: false,
  };
}

/** Human-readable, actionable copy for each way a hosted tour fails to open. */
function describeLoadFailure(error: unknown): {
  title: string;
  detail: string;
  retryable: boolean;
} {
  if (error instanceof TourLoadError) {
    switch (error.loadCause) {
      case "cors":
        return {
          title: "This tour link cannot be read",
          detail:
            "The host blocked the browser from reading the file. The tour needs a direct download link that allows cross-origin reads — check the sharing settings, or re-share the zip.",
          retryable: true,
        };
      case "missing":
        return {
          title: "Tour not found",
          detail:
            "Nothing is hosted at this link any more. Ask whoever shared the tour for a current link.",
          retryable: true,
        };
      case "unusable-link":
        return {
          title: "This link does not point at a tour file",
          detail:
            "It looks like a web page rather than a downloadable tour.zip. Use the file's direct download link.",
          retryable: true,
        };
      case "corrupt":
      case "invalid-tour-json":
      case "asset-missing-in-zip":
        return {
          title: "This tour file is damaged",
          detail:
            "The archive opened but its contents are incomplete, so the tour cannot be shown. It needs to be packed and re-uploaded.",
          retryable: false,
        };
    }
  }
  return {
    title: "The tour could not be opened",
    detail:
      error instanceof Error
        ? error.message
        : "An unexpected error occurred while opening the tour.",
    retryable: true,
  };
}

/**
 * A touch-primary device (no physical keyboard/mouse) — the desktop
 * preview's manual walk needs both, so this decides whether to default it
 * into the breadcrumb autopilot instead. `maxTouchPoints` alone would also
 * match a touch-enabled laptop that still has a keyboard; requiring "no
 * hover" too excludes that case.
 */
function isTouchPrimaryDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  if (navigator.maxTouchPoints <= 0) return false;
  if (typeof globalThis.matchMedia !== "function") return true;
  return !globalThis.matchMedia("(hover: hover)").matches;
}

/** Mounts the composed Viewing-mode flow into `root`. */
export function mountViewingApp(
  root: HTMLElement,
  tourUrl: string,
  overrides: Partial<ViewingAppDeps> = {},
): { destroy(): void } {
  const deps: ViewingAppDeps = { ...defaultDeps(), ...overrides };

  // The DOM-overlay root: every screen, the HUD and the map are its
  // descendants so they survive the transition into the immersive session.
  const arHost = document.createElement("div");
  arHost.id = "ar-container";
  arHost.className = "ar-container";
  root.appendChild(arHost);

  const store = createViewingStore();
  const controller = deps.createController();

  const mapHost = document.createElement("div");
  mapHost.className = "map-card";

  let screen: Screen | null = null;
  let entryScreen: TourEntryScreen | null = null;
  let hud: Hud | null = null;
  let map: TourMapInstance | null = null;
  let scene: ArSceneHandle | null = null;
  let preview: PreviewSession | null = null;
  let wakeLock: WakeLockHandle | null = null;
  let audioContext: AudioContext | null = null;
  let tour: Tour | null = null;
  let assetProvider: { release(id: string): void } | null = null;
  let unsubscribeProgress: (() => void) | null = null;
  let unsubscribeTracking: (() => void) | null = null;
  let unsubscribeOsmBuildings: (() => void) | null = null;
  let mapVisible = false;
  /** The one place `mapVisible` changes: shows/hides the map and tells the HUD. */
  function setMapVisible(visible: boolean): void {
    mapVisible = visible;
    applyMapVisibility(map, visible);
    hud?.setMapActive(visible);
  }
  let wayfindingEnabled = false;
  let destroyed = false;
  // How far the visitor is from the tour's start, as the entry screen last
  // learned it. `locating` while a fix is being waited for.
  let proximity: StartProximity | "locating" = { kind: "unknown" };
  let locate: LocateHandle | null = null;

  function cancelLocate(): void {
    locate?.cancel();
    locate = null;
  }

  function clearScreen(): void {
    cancelLocate();
    screen?.destroy();
    screen = null;
    entryScreen = null;
  }

  async function acquireWakeLock(): Promise<void> {
    // Non-immersive screens only — an immersive session keeps the display on.
    wakeLock?.release();
    wakeLock = await requestWakeLock();
  }

  function releaseWakeLock(): void {
    wakeLock?.release();
    wakeLock = null;
  }

  // ── Screen 1: open the hosted tour ────────────────────────────────────────

  function showLoadFailure(error: unknown): void {
    clearScreen();
    const { title, detail, retryable } = describeLoadFailure(error);
    screen = mountErrorScreen(arHost, {
      title,
      detail,
      ...(retryable ? { onRetry: () => void openTour() } : {}),
    });
  }

  async function openTour(): Promise<void> {
    if (tourUrl.trim() === "") {
      clearScreen();
      screen = mountErrorScreen(arHost, {
        title: "No tour link",
        detail:
          "This page needs a tour link to show. Scan the QR code that came with the tour, or open the link you were given.",
      });
      return;
    }

    clearScreen();
    screen = mountLoadingScreen(
      arHost,
      "Reading the tour from its hosting link…",
    );
    void acquireWakeLock();

    try {
      const opened = await deps.openRemoteTour(tourUrl);
      if (destroyed) return;
      tour = opened.tour;
      assetProvider = opened.assetProvider;
      store.dispatch(loadTour(opened.tour));
      // VC14: a reload or an evicted tab must not lose the visitor's place.
      restoreProgress(store.dispatch, opened.tour.id, deps.progressStorage);
      opened.cacheWarming
        .then(() => entryScreen?.markOfflineReady())
        .catch(() => {
          /* Staying on remote reads is not a visitor-facing failure. */
        });
      mountGate();
    } catch (error) {
      if (destroyed) return;
      showLoadFailure(error);
    }
  }

  // ── Screen 2: the mandatory onboarding gate ───────────────────────────────

  function mountGate(): void {
    clearScreen();
    const gateHost = document.createElement("div");
    gateHost.className = "gate-card";
    arHost.appendChild(gateHost);
    const gate = mountOnboardingGate(gateHost, {
      checkCameraPermission: deps.checkCameraPermission,
      checkGeolocationPermission: deps.checkGeolocationPermission,
      requestCameraPermission: deps.requestCameraPermission,
      requestGeolocationPermission: deps.requestGeolocationPermission,
      createAudioContext: deps.createAudioContext,
      onComplete: (context) => {
        // VC4: viewing mode is the consumer the gate was built for — the
        // unlocked context becomes the scene's AudioListener.
        audioContext = context;
        gate.destroy();
        gateHost.remove();
        mountEntry();
      },
    });
    screen = {
      destroy() {
        gate.destroy();
        gateHost.remove();
      },
    };
  }

  // ── Screen 3: tour overview + Enter AR ────────────────────────────────────

  function refreshMapMarkers(): void {
    if (map === null || tour === null) return;
    const state = store.getState();
    map.setWaypoints(
      computeMarkerViewModels(
        selectOrderedWaypoints(state),
        [...selectVisitedWaypointIds(state)],
        selectNextUnvisitedWaypoint(state)?.id ?? null,
      ),
    );
  }

  function ensureMap(): void {
    if (map !== null || tour === null) return;
    map = deps.createTourMap(mapHost, {
      onTileError: () => {
        // VC24: tiles are not in the tour zip, so they fail exactly when the
        // cache warm has made everything else work offline. Say so once.
        hud?.showNotice(
          "Map tiles are unavailable offline — stops and your position still work.",
        );
      },
    });
    refreshMapMarkers();
  }

  function mountEntry(): void {
    if (tour === null) return;
    clearScreen();
    void acquireWakeLock();

    const visitedCount = selectVisitedWaypointIds(store.getState()).length;
    const entry = mountTourEntryScreen(arHost, {
      tourName: tour.name,
      tourDescription: tour.description,
      waypointCount: tour.waypoints.length,
      visitedCount,
      mapHost,
      onEnterAr: () => void enterAr(),
      onEnterPreview: () => enterPreview(),
      onRestartTour: () => restartTour(),
    });
    entryScreen = entry;
    screen = entry;

    // mapHost is now parented at its final layout position (inside `entry`'s
    // element) — only now does Leaflet's size measurement give a real box.
    ensureMap();
    setMapVisible(true);

    // Hold Enter AR until we know how far the visitor is from the start — but
    // only where AR could run at all; a tour with no position has no start.
    proximity =
      tourStartCoord(tour) === undefined ? { kind: "unknown" } : "locating";

    // Reflect what the controller already knows about this device.
    void controller.refreshSupport().then(() => {
      if (destroyed || entryScreen !== entry) return;
      if (controller.getState().status === "unsupported") {
        // Nothing to measure: without AR the visitor only gets the preview.
        proximity = { kind: "unknown" };
      } else {
        startLocating(entry);
      }
      applyEntryState(entry);
    });
    applyEntryState(entry);
  }

  /** One short read of the visitor's position, classified against the tour's
   *  start. Decided once per entry screen (SG7): it never re-flips buttons
   *  under the visitor's thumb. */
  function startLocating(entry: TourEntryScreen): void {
    const start = tour === null ? undefined : tourStartCoord(tour);
    if (start === undefined) return;
    cancelLocate();
    proximity = "locating";
    const handle = deps.locateVisitor({
      timeoutMs: LOCATE_TIMEOUT_MS,
      isDecisive: (fix) => isDecisive(fix, start),
    });
    locate = handle;
    void handle.result.then((fix) => {
      if (destroyed || locate !== handle) return;
      locate = null;
      proximity =
        fix === null
          ? { kind: "unknown" }
          : classifyStartDistance(distanceToStartM(fix, start), fix.accuracy);
      if (entryScreen === entry) applyEntryState(entry);
    });
  }

  function applyEntryState(entry: TourEntryScreen): void {
    const { status, error } = controller.getState();
    // VC25: without AR the tour is not over — the same scene runs in the
    // desktop preview, so offer it rather than leaving a dead end. The same
    // goes for a visitor too far from the start for AR to ever trigger.
    const view = deriveEntryView({
      controllerStatus: status,
      controllerError: error ?? null,
      forcePreview: deps.forcePreview,
      proximity,
    });
    entry.setEnterArVisible(view.arVisible);
    entry.setEnterArEnabled(view.arEnabled);
    entry.setPreviewOffered(view.previewOffered);
    entry.setArStatus(view.message?.text ?? "", view.message?.tone ?? "info");
  }

  function restartTour(): void {
    if (tour === null) return;
    clearProgress(tour.id, deps.progressStorage);
    store.dispatch(clearTour());
    store.dispatch(loadTour(tour));
    // The map already exists (ensureMap() no-ops once it does) and nothing
    // else is subscribed to the store here — the progress subscription that
    // normally drives this was torn down when the visitor left the last
    // session — so without this it kept showing the old visited/GPS state
    // until a full page reload recreated everything from scratch.
    refreshMapMarkers();
    mountEntry();
  }

  // ── The AR session ────────────────────────────────────────────────────────

  async function enterAr(): Promise<void> {
    const entry = entryScreen;
    if (entry === null || tour === null || audioContext === null) return;

    entry.setEnterArEnabled(false);
    entry.setEnterArLabel("Starting AR…");
    entry.setArStatus("", "info");

    // The GPS coordinator only feeds alignment while a recording session is
    // active; with the default NullStorageBackend nothing is written anywhere,
    // this is purely what turns GPS fixes into alignment input. Without it the
    // alignment matrix never arrives, no waypoint ever anchors, and the tour
    // silently shows nothing (AnchorStarter carries the same call for the same
    // reason).
    store.dispatch(
      startSession({
        scenarioName: "tour-viewing",
        sessionName: "live",
        startTime: Date.now(),
      }),
    );

    const gpsHandler = createGpsPositionHandler({
      store,
      getArPose: getCurrentArPose,
    });

    const result = await controller.enable({
      container: arHost,
      // The viewing app needs only DOM overlay (the HUD/map composite). The
      // framework's crash-isolation defaults enable camera-access and
      // depth-sensing too, but nothing here primes those permission-gated
      // features (only `requestDepth: true` does — see enable-gps-ar.ts) and
      // this app never uses them. Requesting them un-primed makes real
      // Android devices reject the whole session with "the specified session
      // config is not supported" instead of just omitting the feature.
      isolationOptions: {
        enableDomOverlay: true,
        enableCameraAccess: false,
        enableDepthSensingFeature: false,
        enableCameraTextureAcquisition: false,
      },
      callbacks: {
        tracking: { store },
        onSessionEnd: () => {
          // Also fires for the Android system back gesture (VC13).
          if (!destroyed) leaveAr("external");
        },
      },
      onGpsPosition: (position) => {
        gpsHandler(position);
        map?.setGpsPosition(position.lat, position.lon);
        map?.render(
          buildMapData({
            userPosition: { lat: position.lat, lng: position.lon },
          }),
        );
      },
      // Not a store action: `updateDeviceOrientation` writes the framework's
      // device-orientation cache, which the GPS event payload reads from
      // (same wiring the recorder uses).
      onOrientation: updateDeviceOrientation,
    });

    if (destroyed) return;
    entry.setEnterArLabel("Enter AR");
    if (!result.ok) {
      store.dispatch(endSession());
      entry.setEnterArEnabled(true);
      entry.setArStatus(
        result.error ??
          "AR could not be started. Check camera and location access, then try again.",
        "error",
      );
      return;
    }

    startInSession();
  }

  /** The HUD + map furniture every in-session mode shares. */
  function mountSessionShell(options: {
    onEndTour: () => void;
    onToggleAutopilot?: () => void;
    onToggleOsmBuildings?: () => void;
  }): void {
    clearScreen();
    wayfindingEnabled = false;
    hud = mountHud(arHost, {
      onToggleMap: () => setMapVisible(!mapVisible),
      onEndTour: options.onEndTour,
      // Available in both AR and preview (unlike autopilot, which only
      // makes sense in preview) — an opt-in aid, off at the start of every
      // session rather than carried over from a previous one.
      onToggleWayfinding: () => {
        wayfindingEnabled = !wayfindingEnabled;
        scene?.scene.setWayfindingEnabled(wayfindingEnabled);
        hud?.setWayfindingActive(wayfindingEnabled);
        hud?.dismissWayfindingHint();
      },
      ...(options.onToggleAutopilot
        ? { onToggleAutopilot: options.onToggleAutopilot }
        : {}),
      ...(options.onToggleOsmBuildings
        ? { onToggleOsmBuildings: options.onToggleOsmBuildings }
        : {}),
    });
    arHost.appendChild(mapHost);
    setMapVisible(true);
  }

  /** VC14: persist as the walk progresses, not only at the end. */
  function subscribeProgress(): void {
    let lastVisited = selectVisitedWaypointIds(store.getState());
    unsubscribeProgress = store.subscribe(() => {
      const visited = selectVisitedWaypointIds(store.getState());
      if (visited === lastVisited || tour === null) return;
      lastVisited = visited;
      persistProgress(tour.id, [...visited], deps.progressStorage);
      refreshMapMarkers();
    });
  }

  function startInSession(): void {
    if (tour === null || audioContext === null) return;
    releaseWakeLock();
    mountSessionShell({ onEndTour: () => leaveAr("user") });

    scene = deps.startArScene({
      store,
      assetProvider: assetProvider as never,
      audioContext,
      runtime: deps.arRuntime,
      onAudioBlocked: () => {
        hud?.showNotice("Tap the screen once to allow this story to play.");
      },
    });

    // VC23: until the alignment converges nothing can be anchored, so tell the
    // visitor what to do instead of showing an empty camera feed.
    const applyGuidance = (): void => {
      const guidance = computeOnboardingGuidance(
        selectTrackingQuality(store.getState()),
      );
      const aligned =
        deps.arRuntime.selectAlignmentMatrix(store.getState()) !== null;
      hud?.setStatus(
        aligned && guidance.phase === "ready"
          ? ""
          : (guidance.hint ?? "Walk a few metres so the tour can line up."),
      );
    };
    unsubscribeTracking = store.subscribe(applyGuidance);
    applyGuidance();

    subscribeProgress();
  }

  // ── The desktop preview (VC25) ────────────────────────────────────────────

  /**
   * The same component-8 scene the phone runs, on a walkable desktop stand-in
   * for the AR session: a pinned frame instead of GPS alignment, a keyboard
   * instead of legs. Nothing below the runtime/seams boundary changes, which
   * is the point — what a visitor previews is the real tour, not a mock-up.
   */
  function enterPreview(): void {
    if (tour === null || audioContext === null || preview !== null) return;

    const { origin, start, route } = computePreviewStart(tour);
    mountSessionShell({
      onEndTour: () => leavePreview(),
      onToggleAutopilot: () => {
        if (preview === null) return;
        const next = !preview.isAutopilot();
        preview.setAutopilot(next);
        hud?.setAutopilotActive(next);
        hud?.dismissAutopilotHint();
      },
      onToggleOsmBuildings: () => {
        if (preview === null) return;
        const status = preview.getOsmBuildingsStatus();
        preview.setOsmBuildingsEnabled(status === "off" || status === "failed");
      },
    });

    const session = deps.createPreviewSession({
      container: arHost,
      origin,
      start,
      route,
      onPositionChange: (position) => {
        map?.setGpsPosition(position.lat, position.lon);
        map?.render(
          buildMapData({
            userPosition: { lat: position.lat, lng: position.lon },
          }),
        );
      },
    });
    preview = session;
    // The canvas must sit UNDER the HUD and the map, which were mounted first.
    arHost.insertBefore(session.domElement, arHost.firstChild);

    // Subscribed right after creation, then immediately applied once: the
    // session's own load() already ran synchronously inside
    // createPreviewSession, so the idle -> loading transition has already
    // happened and onOsmBuildingsStatusChange will not replay it.
    const applyOsmBuildingsStatus = (status: OsmBuildingStatus): void => {
      hud?.setOsmBuildingsStatus(status);
    };
    unsubscribeOsmBuildings = session.onOsmBuildingsStatusChange(
      applyOsmBuildingsStatus,
    );
    applyOsmBuildingsStatus(session.getOsmBuildingsStatus());

    scene = deps.startArScene({
      store,
      assetProvider: assetProvider as never,
      audioContext,
      runtime: session.runtime,
      seams: session.seams,
      domElement: session.domElement,
      onAudioBlocked: () => {
        hud?.showNotice("Click the scene once to allow this story to play.");
      },
    });

    // Autopilot starts OFF regardless of device — the visitor stays in
    // control of how they move from the first frame. A touch-primary
    // device has no WASD and no other way to walk manually, so it's the
    // one that actually needs Auto-walk; the HUD's one-time callout above
    // that button (not this status line alone) is what tells it exists.
    if (isTouchPrimaryDevice()) {
      hud?.setStatus(
        "Preview — drag to look around, tap a stop to hear it. Tap Auto-walk below to walk the route.",
      );
    } else {
      hud?.setStatus(
        "Preview — walk with W A S D, drag to look around, click a stop to hear it.",
      );
    }
    subscribeProgress();
  }

  function leavePreview(): void {
    unsubscribeProgress?.();
    unsubscribeProgress = null;
    unsubscribeOsmBuildings?.();
    unsubscribeOsmBuildings = null;
    scene?.dispose();
    scene = null;
    preview?.dispose();
    preview = null;
    hud?.destroy();
    hud = null;
    if (!destroyed) mountEntry();
  }

  /**
   * Leave the session without ending the tour (VC13): the store, the warmed
   * cache and the visitor's progress all outlive the session, so re-entering
   * resumes rather than restarts.
   */
  function leaveAr(reason: "user" | "external"): void {
    unsubscribeProgress?.();
    unsubscribeProgress = null;
    unsubscribeTracking?.();
    unsubscribeTracking = null;
    scene?.dispose();
    scene = null;
    hud?.destroy();
    hud = null;
    store.dispatch(endSession());
    if (reason === "user") {
      void controller.disable();
    }
    if (!destroyed) mountEntry();
  }

  void openTour();

  return {
    destroy() {
      destroyed = true;
      unsubscribeProgress?.();
      unsubscribeTracking?.();
      unsubscribeOsmBuildings?.();
      scene?.dispose();
      preview?.dispose();
      hud?.destroy();
      clearScreen();
      map?.destroy();
      releaseWakeLock();
      void controller.disable();
      arHost.remove();
    },
  };
}
