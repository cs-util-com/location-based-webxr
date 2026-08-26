/**
 * Persistent-anchor starter — application entry point (glue).
 *
 * This is the "framework wiring — don't touch" layer. It composes the
 * tested seams into the persistent-anchor flow:
 *
 *   1. Capability-gate (E1): no WebXR/GPS → honest message, no crash.
 *   2. On a user gesture, boot the store + AR session + GPS/orientation.
 *   3. Coach the user to move using `computeOnboardingGuidance`.
 *   4. cache-miss → soft-gated "Place anchor" → `createGpsAnchor` + encode the
 *      anchor into the `?show=` URL param (decision F1).
 *      cache-hit  → seed `createGpsAnchor` from the URL-decoded anchor and let
 *                   it re-converge, then reveal the marker in its `ui` style.
 *
 * The ONE place a new developer edits to drop in their own use case is
 * `createAnchorMarker()` in `./marker.ts`. Everything here is plumbing.
 *
 * Pure, unit-tested logic lives in the sibling modules
 * (`setup-state-machine`, `url-anchor-state`, `guidance-view`,
 * `placement-view`, `capability`). This file is verified manually via
 * `pnpm dev` on an AR device, the same convention as the MinimalExample.
 */

import {
  createSlamAppStore,
  teardownArSessionState,
  createGpsPositionHandler,
  updateDeviceOrientation,
  startSession,
  computeOnboardingGuidance,
  selectZeroReference,
} from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import { getCurrentArPose } from "gps-plus-slam-app-framework/ar/webxr-session";
import {
  isFullySupported,
  capabilityMessage,
} from "gps-plus-slam-app-framework/ar/capability-checker";
import {
  stopGpsWatch,
  stopOrientationWatch,
  type GpsPosition,
} from "gps-plus-slam-app-framework/sensors";
import {
  type GpsAnchor,
  type WayfindingHud,
} from "gps-plus-slam-app-framework/visualization";
import type { LatLong, LatLongAlt } from "gps-plus-slam-app-framework/core";
import { odometryTrackingRestarted } from "gps-plus-slam-app-framework/core";
import { Vector3 } from "three";

import {
  initialSetupState,
  setupReducer,
  canPlaceAnchor,
  type SetupState,
  type SetupEvent,
} from "./setup-state-machine.js";
import {
  decodeShowParam,
  encodeAnchorsToShowParam,
  type AnchorSpec,
} from "./url-anchor-state.js";
import { toGuidanceView } from "./guidance-view.js";
import { toPlacementView } from "./placement-view.js";
import { getSeams } from "./seams.js";
import { decideAnchorPlacement } from "./placement-decision.js";
import { coldStartOverrideEnabledFromSearch } from "./cold-start-override-flag.js";
import { hudTargetsFromMarker, type HudTargetMarker } from "./hud-targets.js";
import { type HitTestReticleHandle } from "gps-plus-slam-app-framework/ar/hit-test-reticle-driver";
// --- your content here -----------------------------------------------------
import { type MarkerOptions } from "./marker.js";
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DOM lookup
// ---------------------------------------------------------------------------

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} element in index.html`);
  return node as T;
}

const dom = {
  startScreen: el("start-screen"),
  startButton: el<HTMLButtonElement>("start-button"),
  capabilityMessage: el("capability-message"),
  guidance: el("guidance"),
  guidanceTitle: el("guidance-title"),
  guidanceBarFill: el("guidance-bar-fill"),
  guidancePercent: el("guidance-percent"),
  guidanceHint: el("guidance-hint"),
  placement: el("placement"),
  banner: el("banner"),
  error: el("error"),
  placeButton: el<HTMLButtonElement>("place-button"),
  copyLinkButton: el<HTMLButtonElement>("copy-link-button"),
  reloadPrompt: el("reload-prompt"),
} as const;

// ---------------------------------------------------------------------------
// App state (mutable glue)
// ---------------------------------------------------------------------------

type AppStore = ReturnType<typeof createSlamAppStore>;

let store: AppStore | null = null;
let setupState: SetupState = initialSetupState;
let anchor: GpsAnchor | null = null;
let reticleHandle: HitTestReticleHandle | null = null;
let lastGps: LatLongAlt | null = null;
let lastTrackingReady = false;
let wayfindingHud: WayfindingHud | null = null;
let hudMarker: HudTargetMarker | null = null;

/**
 * Wayfinding HUD deadband (F2, decision D2.2 "show when far"): the indicator
 * activates once the anchor is at least HUD_DISTANCE_MAX_M away and hides
 * again below HUD_DISTANCE_MIN_M ("arrived") — the gap is the anti-flicker
 * hysteresis. Values carried over from the field-validated prototype.
 */
const HUD_DISTANCE_MIN_M = 1.5;
const HUD_DISTANCE_MAX_M = 3.0;

/** Idle label for the copy-link button; must match the text in index.html. */
const COPY_LINK_IDLE_LABEL = "Copy link";
/** Pending revert timer for the copy-link label, so rapid re-clicks cancel it. */
let copyLinkRevertTimer: number | null = null;

/**
 * Run a framework selector against the live store (throws before init —
 * the null-guard is the reason this helper survives). Since quality-review
 * G-2 the framework selectors accept any store that carries the slice they
 * read, so the former cast-through-`unknown` is gone.
 */
function sel<R>(selector: (state: ReturnType<AppStore["getState"]>) => R): R {
  if (!store) throw new Error("store not initialised");
  return selector(store.getState());
}

function toLatLongAlt(pos: GpsPosition): LatLongAlt {
  return typeof pos.altitude === "number" && Number.isFinite(pos.altitude)
    ? { lat: pos.lat, lon: pos.lon, altitude: pos.altitude }
    : { lat: pos.lat, lon: pos.lon, altitude: 0 };
}

/**
 * Current GPS alignment matrix, or null when no store/alignment exists yet.
 * Read through the seam so the e2e fake can drive the alignment gate (the real
 * alignment is computed from GPS + AR pose, neither of which exists in a desktop
 * Playwright browser).
 */
function currentAlignment(): ReturnType<
  ReturnType<typeof getSeams>["selectAlignmentMatrix"]
> {
  if (!store) return null;
  return sel(getSeams().selectAlignmentMatrix);
}

// ---------------------------------------------------------------------------
// Rendering — copy the tested view-models onto the DOM (no logic here)
// ---------------------------------------------------------------------------

/**
 * Last tracking-quality report identity the guidance rendered from
 * (quality-review F-7): the framework's listener only publishes a NEW report
 * reference when it meaningfully changed (epsilon-gated `reportUpdated`), so
 * reference identity is the change signal. `undefined` (never a selector
 * result) forces the first render.
 */
let lastRenderedGuidanceReport: unknown = undefined;

function applyGuidance(
  guidance: ReturnType<typeof computeOnboardingGuidance>,
): void {
  const view = toGuidanceView(guidance);
  dom.guidanceTitle.textContent = view.title;
  dom.guidanceBarFill.style.width = `${view.barWidthPct}%`;
  dom.guidanceBarFill.className = `tone-${view.tone}`;
  dom.guidancePercent.textContent = view.percentText;
  dom.guidanceHint.textContent = view.hint;
}

function renderGuidance(): void {
  const report = store ? sel(getSeams().selectTrackingQuality) : null;
  lastRenderedGuidanceReport = report;
  applyGuidance(computeOnboardingGuidance(report));
}

function renderPlacement(): void {
  const view = toPlacementView(setupState);
  dom.banner.textContent = view.banner;
  dom.placeButton.hidden = !view.button.visible;
  dom.placeButton.textContent = view.button.label;
  dom.placeButton.disabled = view.button.disabled;
  dom.error.hidden = view.error === null;
  dom.error.textContent = view.error ?? "";
  dom.copyLinkButton.hidden = !view.copyLink.visible;
  dom.reloadPrompt.hidden = !view.reloadPrompt;
}

function render(): void {
  renderGuidance();
  renderPlacement();
}

// ---------------------------------------------------------------------------
// Setup FSM dispatch
// ---------------------------------------------------------------------------

function dispatchSetup(event: SetupEvent): void {
  const next = setupReducer(setupState, event);
  if (next === setupState) return;
  setupState = next;
  render();
}

/**
 * Per-dispatch store subscriber. Skips all work while the tracking-quality
 * report reference is unchanged (quality-review F-7 — this used to recompute
 * the guidance twice and issue 5 unconditional DOM writes on EVERY store
 * dispatch, i.e. every XR frame, defeating the framework's epsilon-gated
 * report publishing). On a real report change, the single guidance
 * computation feeds both the FSM flag and the DOM.
 */
function onStoreChanged(): void {
  if (!store) return;
  const report = sel(getSeams().selectTrackingQuality);
  if (report === lastRenderedGuidanceReport) return;
  lastRenderedGuidanceReport = report;

  const guidance = computeOnboardingGuidance(report);
  const ready = guidance.phase === "ready";
  if (ready !== lastTrackingReady) {
    lastTrackingReady = ready;
    dispatchSetup({ type: "TRACKING_READY_CHANGED", ready });
  }
  applyGuidance(guidance);
}

// ---------------------------------------------------------------------------
// Anchor creation — anchors `createAnchorMarker()` to a GPS coordinate
// ---------------------------------------------------------------------------

function spawnAnchor(
  gpsPoint: LatLong | LatLongAlt,
  skipBootstrap: boolean,
  markerOptions: MarkerOptions = {},
  options: {
    hideUntilAligned?: boolean;
    /**
     * World pose to place the marker at (the reticle hit point, cache-miss).
     * When omitted the marker stays at the `arWorldGroup` origin (cache-hit;
     * the skipBootstrap anchor snaps itself into place via steady-state).
     */
    worldPosition?: Vector3;
    /** Forwarded to `createGpsAnchor` (cache-miss persists `?show=` from it). */
    onBootstrapComplete?: (gpsPoint: LatLong | LatLongAlt) => void;
  } = {},
): GpsAnchor {
  const seams = getSeams();
  const arWorldGroup = seams.getArWorldGroup();
  const camera = seams.getCamera();
  if (!arWorldGroup || !camera) {
    throw new Error("AR scene not ready — cannot place anchor");
  }
  const marker = seams.createAnchorMarker(markerOptions);
  arWorldGroup.add(marker);
  // Place the marker at the reticle world pose (cache-miss). Refresh the world
  // matrix first so the world→local conversion uses the current arWorldGroup
  // transform, then express the world point in arWorldGroup-local coords (the
  // marker is a child of arWorldGroup).
  if (options.worldPosition) {
    arWorldGroup.updateWorldMatrix(true, false);
    marker.position.copy(
      arWorldGroup.worldToLocal(options.worldPosition.clone()),
    );
  }

  // Bootstrap source: the marker's own GPS-world (NUE) world pose — the
  // framework anchor's built-in object-pose sampler since quality-review G-6
  // (the hand-built closure this app carried is now the default; it reads
  // through the seam-based getAlignmentMatrix/getGpsZeroRef below, so the
  // e2e fakes keep driving it). This pins the anchor to the reticle point
  // the user aimed at, not the device, and only works because
  // `enableArWorldGroupAlignment` makes the marker's world position
  // GPS-world NUE. Skipped entirely for the cache-hit `skipBootstrap` path.
  let gpsAnchor: GpsAnchor;
  try {
    gpsAnchor = seams.createGpsAnchor({
      object3D: marker,
      arWorldGroup,
      camera,
      gpsPoint,
      skipBootstrap,
      getAlignmentMatrix: () => sel(getSeams().selectAlignmentMatrix),
      getGpsZeroRef: (): LatLong | null => sel(selectZeroReference),
      ...(options.onBootstrapComplete
        ? { onBootstrapComplete: options.onBootstrapComplete }
        : {}),
    });
  } catch (err) {
    // createGpsAnchor failed *after* the marker was added to the scene — undo
    // the add so a failed spawn never leaves an orphaned mesh behind that a
    // later retry would overlap.
    arWorldGroup.remove(marker);
    throw err;
  }

  // Q4 — deferred reveal for the `?show=` reload (cache-hit) path. A
  // skipBootstrap anchor sits at the AR origin (local 0,0,0) until its first
  // steady-state commit, which cannot happen until an alignment exists. Showing
  // the marker before then would flash it at the origin and then jump it to its
  // real pose. Keep it hidden until the first non-null alignment arrives, then
  // reveal it where the anchor has by-then placed it.
  let unsubReveal: (() => void) | null = null;
  if (options.hideUntilAligned) {
    marker.visible = false;
    const revealWhenAligned = (): void => {
      if (sel(getSeams().selectAlignmentMatrix) === null) return;
      marker.visible = true;
      unsubReveal?.();
      unsubReveal = null;
    };
    // Alignment may already be present (e.g. a fast re-localise); check once,
    // and otherwise reveal on the first store change that produces one.
    revealWhenAligned();
    if (!marker.visible && store) {
      unsubReveal = store.subscribe(revealWhenAligned);
    }
  }

  // F2 wayfinding HUD — guide the user to the (possibly off-screen / far)
  // anchor. The target feed reuses the marker's visibility gate, so the
  // hidden cache-hit marker yields no target until the first alignment.
  // Auxiliary by design: a HUD failure must never break the anchor flow.
  wayfindingHud?.dispose();
  wayfindingHud = null;
  hudMarker = marker;
  try {
    wayfindingHud = seams.createWayfindingHud({
      camera,
      getTargets: () => hudTargetsFromMarker(hudMarker),
      distanceMin: HUD_DISTANCE_MIN_M,
      distanceMax: HUD_DISTANCE_MAX_M,
    });
  } catch (err) {
    console.error(
      "[anchor-starter] wayfinding HUD failed to start; continuing without it.",
      err,
    );
  }

  // The framework's `dispose()` only unregisters the anchor from the frame
  // loop; it deliberately does NOT detach the marker from the scene graph
  // (see gps-anchor.ts). Wrap it so disposing the anchor also removes its
  // marker and the marker's wayfinding HUD — making `anchor.dispose()` a
  // complete teardown for every caller (placement retry, boot rollback,
  // beforeunload).
  const disposeAnchor = gpsAnchor.dispose.bind(gpsAnchor);
  gpsAnchor.dispose = (): void => {
    disposeAnchor();
    unsubReveal?.();
    wayfindingHud?.dispose();
    wayfindingHud = null;
    hudMarker = null;
    arWorldGroup.remove(marker);
  };
  return gpsAnchor;
}

// ---------------------------------------------------------------------------
// URL `?show=` persistence (decision F1) — the anchor lives in the page link,
// so reloading restores it and the link can be shared to another device.
// ---------------------------------------------------------------------------

/** Build the minimal default-styled anchor spec from a committed GPS point. */
function anchorSpecFromGps(gps: LatLong | LatLongAlt): AnchorSpec {
  return {
    lat: gps.lat,
    lon: gps.lon,
    alt:
      "altitude" in gps && typeof gps.altitude === "number" ? gps.altitude : 0,
    ui: 1,
    scale: 1,
    rotationDeg: 0,
  };
}

/** Encode the anchors into `?show=` without adding a history entry. */
function writeShowParam(anchors: readonly AnchorSpec[]): void {
  const param = encodeAnchorsToShowParam(anchors);
  const url = `${location.pathname}?show=${param}${location.hash}`;
  history.replaceState(null, "", url);
}

/** Decode the first anchor from the current `?show=` param, or null. */
function readCachedAnchor(): AnchorSpec | null {
  const raw = new URLSearchParams(location.search).get("show");
  const decoded = decodeShowParam(raw);
  return decoded?.[0] ?? null;
}

/**
 * Copy the shareable page link, flipping the button label as feedback.
 *
 * Uses a constant idle label (never the live `textContent`) and cancels any
 * pending revert timer before scheduling a new one. Without this, a second
 * click within the 2 s window would capture the transient "Link copied ✓" as
 * the idle label and the button would lock to it permanently.
 */
async function copyShareLink(): Promise<void> {
  if (copyLinkRevertTimer !== null) {
    window.clearTimeout(copyLinkRevertTimer);
    copyLinkRevertTimer = null;
  }
  try {
    await navigator.clipboard.writeText(location.href);
    dom.copyLinkButton.textContent = "Link copied ✓";
  } catch {
    dom.copyLinkButton.textContent = "Copy failed — long-press the link";
  }
  copyLinkRevertTimer = window.setTimeout(() => {
    dom.copyLinkButton.textContent = COPY_LINK_IDLE_LABEL;
    copyLinkRevertTimer = null;
  }, 2000);
}

// ---------------------------------------------------------------------------
// Placement action (cache-miss branch) — the press positions the marker at the
// reticle pose and starts the bootstrap; the durable `?show=` write + the
// `saving → saved` transition happen later, when the bootstrap median is
// committed (`onBootstrapComplete`). A press that cannot place yet (no surface
// / no alignment) surfaces a hint via `PLACE_BLOCKED` without entering `saving`.
// All paths route through the setup FSM so the placement view-model renders the
// in-progress → final states consistently.
// ---------------------------------------------------------------------------

function placeAnchor(): void {
  if (!canPlaceAnchor(setupState)) return;
  // Surface/alignment gate (mirrors MinimalExample's decideTapPlacement): the
  // anchor is placed under the hit-test reticle, so a press only commits when a
  // surface is under the cursor AND a GPS alignment exists. Otherwise surface
  // the matching hint and no-op (the FSM stays placeable — no `saving`).
  const decision = decideAnchorPlacement({
    reticleVisible: reticleHandle?.isVisible() ?? false,
    hasAlignment: currentAlignment() !== null,
  });
  if (decision.kind === "blocked") {
    dispatchSetup({ type: "PLACE_BLOCKED", message: decision.hint });
    return;
  }
  dispatchSetup({ type: "PLACE_REQUESTED" });
  try {
    if (!reticleHandle)
      throw new Error("Reticle not ready — point at the ground, then retry");
    const gps = lastGps;
    if (!gps)
      throw new Error("No GPS fix yet — wait for a location, then retry");
    // Place the marker at the reticle world pose and bootstrap from that pose.
    // `?show=` is NOT written here: it is persisted from the committed bootstrap
    // median via `onBootstrapComplete`, so the shared link equals the anchor's
    // committed reference by construction (and the "Saving…" state stays until
    // the median lands, then resolves to "Saved ✓"). The reticle pose only
    // *positions* the marker; the persisted GPS comes from the median.
    const worldPosition = reticleHandle.getWorldPosition(new Vector3());
    anchor = spawnAnchor(
      gps,
      false,
      {},
      {
        worldPosition,
        onBootstrapComplete: (median) => {
          writeShowParam([anchorSpecFromGps(median)]);
          reticleHandle?.dispose();
          reticleHandle = null;
          dispatchSetup({ type: "PLACE_SUCCEEDED" });
        },
      },
    );
  } catch (err) {
    // Fully tear down a partially created anchor so a retry cannot accumulate
    // overlapping markers / leaked frame-loop registrations. This covers the
    // case where spawnAnchor succeeded but a later step (e.g. writeShowParam)
    // threw, leaving `anchor` assigned while the FSM reverts to placeable.
    anchor?.dispose();
    anchor = null;
    dispatchSetup({
      type: "PLACE_FAILED",
      message: err instanceof Error ? err.message : "Failed to place anchor",
    });
  }
}

// ---------------------------------------------------------------------------
// AR boot (user gesture)
// ---------------------------------------------------------------------------

/**
 * Unwind a failed AR boot so the app never lingers half-started. Any of the
 * post-`initAR` steps in `startAr` (the awaited orientation-permission prompt,
 * the GPS/orientation watch starts, the cache-hit `spawnAnchor`) can throw or
 * reject; this rolls back every side effect they may have left behind — tear
 * down the framework session, stop the sensor watches, drop a partially created
 * anchor, and restore the start screen — then surfaces the reason so the user
 * can retry. Each cleanup call is idempotent, so the helper is safe even when
 * only some steps had run.
 */
async function failStart(err: unknown, fallbackMessage: string): Promise<void> {
  // Tear down the framework session (renderer, xrSession, session-disposer
  // registry) so `initAR()` can succeed on a retry. Without this, the
  // re-entry guard ("AR session already initialized") permanently wedges the
  // app after a post-initAR failure. Safe to call even when initAR itself
  // failed (the session is only partly up or not at all).
  try {
    await getSeams().endARSession();
  } catch {
    // endARSession wraps XRSession.end() in try/finally and always runs
    // resetWebXRState(); a throw here means the native session was already
    // ended or never started — either way the framework is back to clean.
  }

  stopGpsWatch();
  stopOrientationWatch();
  anchor?.dispose();
  anchor = null;
  reticleHandle?.dispose();
  reticleHandle = null;
  // The store half of the session teardown (framework-shared): without it
  // a retry's second session appended its odometry-GPS pairs onto the dead
  // session's and the alignment solve blended two odometry origins.
  if (store) teardownArSessionState(store);

  dom.startScreen.hidden = false;
  dom.guidance.hidden = true;
  dom.placement.hidden = true;
  dom.startButton.disabled = false;
  dom.startButton.textContent = "Start AR";
  dom.capabilityMessage.hidden = false;
  dom.capabilityMessage.textContent =
    err instanceof Error ? err.message : fallbackMessage;
  console.error("[anchor-starter] AR boot failed; rolled back.", err);
}

async function startAr(): Promise<void> {
  dom.startButton.disabled = true;
  dom.startButton.textContent = "Starting…";

  store = createSlamAppStore({
    storageBackend: new NullStorageBackend(),
    // Stage-0 cold-start compass override ships ON; opt out via ?coldStartOverride=0.
    enableCompassColdStartOverride: coldStartOverrideEnabledFromSearch(
      window.location.search,
    ),
  });
  store.subscribe(onStoreChanged);

  const appContainer = el("app");
  try {
    // This example places its anchor under a screen-centre hit-test reticle —
    // it never reads the camera image or depth. Turn off the camera/depth
    // crash-surface features (which default to `true`) so the session doesn't
    // request `camera-access` or `depth-sensing` or acquire the camera texture
    // each frame, but DO request `hit-test` so the cache-miss reticle works.
    // `dom-overlay` and the CSS3D renderer stay on so the overlay UI still
    // composites in AR.
    //
    // Tracking-state pipeline: the store + restart callback ride into initAR
    // as its `callbacks.tracking` group (they arrive TOGETHER since the
    // framework's setter fold). Without the group the framework's per-frame
    // `updateTrackingState()` silently no-ops, `tracking.phase` never leaves
    // `initializing`, and the tracking-quality report (and thus the onboarding
    // guidance) stays pinned to "AR tracking lost" with no progress. The
    // onRestarted callback re-bases odometry after an origin reset so
    // alignment continues correctly across tracking restarts (same contract as
    // the recorder). Routed through the seam so the e2e suite can assert the
    // wiring actually happens (the fake initAR records the group).
    await getSeams().initAR(
      appContainer,
      {
        enableCameraAccess: false,
        enableDepthSensingFeature: false,
        enableCameraTextureAcquisition: false,
      },
      { requestHitTest: true },
      {
        // A session the USER ends (system back gesture, headset "Exit AR")
        // never reaches `failStart` — without this callback the recording
        // stayed open and the dead session's odometry↔GPS pairs blended into
        // the next entry's alignment solve, the exact DEC-H3 failure. The
        // start-failure path tears down via `failStart`; this covers the
        // user-ended path (PR #364 review — AnchorStarter was the one app
        // in the unification still missing it).
        onSessionEnd: () => {
          if (store) teardownArSessionState(store);
        },
        tracking: {
          store,
          onRestarted: (payload) => {
            store?.dispatch(odometryTrackingRestarted(payload));
          },
        },
      },
    );
  } catch (err) {
    await failStart(err, "Failed to start the AR session.");
    return;
  }

  // Everything past initAR has side effects (sensor watches, a possible
  // cache-hit anchor); wrap it so a thrown/rejected step rolls them back via
  // `failStart` instead of leaving the app half-started.
  try {
    // Recording must be active for the GPS coordinator to feed alignment.
    store.dispatch(
      startSession({
        scenarioName: "anchor-starter",
        sessionName: "live",
        startTime: Date.now(),
      }),
    );

    // GPS-register the AR view: lerp the store's alignment onto arWorldGroup so
    // the camera and the anchored marker ride the alignment together. Without
    // this the camera is pure-VIO and the anchor must absorb the full alignment
    // delta on every off-screen re-registration.
    const alignmentArWorldGroup = getSeams().getArWorldGroup();
    if (alignmentArWorldGroup) {
      // Fire-and-forget: the framework ties this binding's disposal to the AR
      // session teardown (it registers a session disposer that
      // `resetWebXRState()` flushes), so a restart never leaks the previous
      // session's per-frame lerp + store subscription.
      getSeams().enableArWorldGroupAlignment({
        store,
        arWorldGroup: alignmentArWorldGroup,
      });
    }

    // GPS → store (+ remember the latest fix for anchor seeding).
    const gpsHandler = createGpsPositionHandler({
      store,
      getArPose: getCurrentArPose,
    });
    getSeams().startGpsWatch((pos) => {
      lastGps = toLatLongAlt(pos);
      gpsHandler(pos);
    });

    // Device orientation (compass) feeds the GPS event payload.
    await getSeams().requestDeviceOrientationPermission();
    getSeams().startOrientationWatch((orientation) =>
      updateDeviceOrientation(orientation),
    );

    // Reveal the live UI and choose the branch from the cache.
    dom.startScreen.hidden = true;
    dom.guidance.hidden = false;
    dom.placement.hidden = false;

    const cached = readCachedAnchor();
    if (cached) {
      // cache-hit: seed from the URL-decoded GPS and let it re-converge as
      // alignment settles (skipBootstrap — no live median accumulation), then
      // reveal the marker in its requested `ui` style. `hideUntilAligned` keeps
      // the marker hidden until the first alignment arrives so it never flashes
      // at the AR origin before jumping to its real pose (Q4).
      lastGps = { lat: cached.lat, lon: cached.lon, altitude: cached.alt };
      anchor = spawnAnchor(
        lastGps,
        true,
        {
          ui: cached.ui,
          scale: cached.scale,
          rotationDeg: cached.rotationDeg,
        },
        { hideUntilAligned: true },
      );
    } else {
      // cache-miss: drive a screen-centre hit-test reticle so the user places
      // the anchor under the AR cursor (the "ground spot" they point at), not
      // at their own position. Parented under `arWorldGroup` so the reticle
      // rides the GPS alignment and its world pose is GPS-world (NUE).
      if (alignmentArWorldGroup) {
        reticleHandle = getSeams().startReticleHitTest({
          arWorldGroup: alignmentArWorldGroup,
        });
      }
    }
    dispatchSetup({ type: "BOOTED", hasCachedAnchor: cached !== null });
    render();
  } catch (err) {
    await failStart(err, "Failed to start the AR session.");
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // NOTE: the Chromium WebXR camera-access tab-crash workaround is applied
  // by the framework's initAR() itself since quality-review G-7 (default-on
  // via isolationOptions) — no manual bootstrap call needed here any more.

  render();

  const seams = getSeams();
  const [webxr, geolocation] = await Promise.all([
    seams.checkWebXRSupport(),
    seams.checkGeolocationPermission(),
  ]);
  const support = {
    webxr: webxr.supported,
    geolocation: geolocation.supported,
  };

  if (!isFullySupported(support)) {
    // E1: honest, capability-gated message instead of a crash.
    dom.startButton.disabled = true;
    dom.capabilityMessage.hidden = false;
    dom.capabilityMessage.textContent =
      capabilityMessage(support, {
        contextLabel: "the persistent-anchor flow",
      }) ?? "";
    return;
  }

  // Wire the soft-gated "Place anchor" + copy-link buttons once. Both handlers
  // self-gate (`placeAnchor` no-ops unless the FSM allows it; `copyShareLink`
  // just copies `location.href`), so attaching them before AR boots is inert —
  // and wiring them here (rather than inside `startAr`) means a boot that fails
  // and is retried can never register duplicate listeners.
  dom.placeButton.addEventListener("click", () => placeAnchor());
  dom.copyLinkButton.addEventListener("click", () => {
    void copyShareLink();
  });

  dom.startButton.addEventListener("click", () => {
    void startAr();
  });
}

window.addEventListener("beforeunload", () => {
  stopGpsWatch();
  anchor?.dispose();
  reticleHandle?.dispose();
});

void main();
