/**
 * Minimal GPS + AR hit-test example for gps-plus-slam-app-framework.
 *
 * Structural port of the stock three.js `webxr_ar_hittest` example
 * (button → AR session → hit-test reticle → tap-to-place), adapted for a
 * GPS-aligned framework. See ../README.md for the "ladder" narrative and the
 * plan doc
 * GpsPlusSlamJs_Docs/docs/2026-06-03-0553-threejs-arbutton-minimal-ar-example-user-feedback.md.
 *
 * What is testable vs. glue:
 * - The reticle view-model (the framework's `hit-test-reticle.ts`) and status
 *   formatter (./status.ts) are pure and unit-tested.
 * - Everything in this file is WebXR glue: it needs a real device with an
 *   immersive-ar session and is verified manually via `pnpm dev` on an
 *   AR-capable phone. It is deliberately kept small and copy-pasteable.
 *
 * Two framework deltas a porting developer must not get wrong:
 * 1. The "Enable GPS AR" button is app-rendered over `createEnableGpsArController`
 *    state — the framework owns the permission/enter-AR *sequence*, not the DOM.
 * 2. Placed AR content is parented under `getArWorldGroup()` (AR-local space),
 *    NOT the GPS-aligned scene root. The reticle below follows this rule.
 */
import {
  createEnableGpsArController,
  getArWorldGroup,
  getCamera,
  getCurrentArPose,
  getScene,
  registerXrFrameUpdate,
  startHitTestReticle,
  type EnableGpsArState,
  type HitTestReticleHandle,
} from 'gps-plus-slam-app-framework/ar';
import {
  createGpsPositionHandler,
  createSlamAppStore,
  selectAlignmentMatrix,
  selectZeroReference,
  startSession,
  teardownArSessionState,
  updateDeviceOrientation,
  type SubscribableStore,
} from 'gps-plus-slam-app-framework/state';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage';
import type {
  GpsPosition,
  RawDeviceOrientation,
} from 'gps-plus-slam-app-framework/sensors';
import {
  createGpsAnchor,
  enableArWorldGroupAlignment,
} from 'gps-plus-slam-app-framework/visualization';
import type { LatLong, LatLongAlt } from 'gps-plus-slam-app-framework/core';
import { Vector3 } from 'three';

import { ANCHOR_MODE, coSpawnAtWorldPose } from './co-spawn.js';
import { createConnectorLine } from './connector-line.js';
import { decideTapPlacement } from './placement.js';
import { formatStatus } from './status.js';
import { createStatusPanel } from './status-panel.js';

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing #${id} element in index.html`);
  }
  return element as T;
}

/**
 * Derive the button's label + disabled state from the controller status. Pure
 * mapping so the (verified-on-device) wiring stays a one-liner.
 */
function buttonView(state: EnableGpsArState): { label: string; disabled: boolean } {
  switch (state.status) {
    case 'checking':
      return { label: 'Checking AR support…', disabled: true };
    case 'unsupported':
      return { label: 'AR not supported on this device', disabled: true };
    case 'ready':
      return { label: 'Enable GPS AR', disabled: false };
    case 'starting':
      return { label: 'Starting…', disabled: true };
    case 'running':
      return { label: 'AR running', disabled: true };
    case 'stopping':
      return { label: 'Stopping…', disabled: true };
    case 'error':
      return { label: `Retry — ${state.error ?? 'failed to start'}`, disabled: false };
  }
}

/**
 * Install the hit-test reticle and tap-to-place once AR is running. The
 * per-frame WebXR plumbing (source request, race guards, session-end reset)
 * lives in the framework's shared `startHitTestReticle` driver; only the app
 * decisions stay here. The actual placement (the contrast co-spawn) is
 * delegated to `onPlace` so the store-bound `createGpsAnchor` wiring stays in
 * `main()`. Returns the driver handle so `main()` can dispose it on session
 * end (replacing the old inline `'end'`-listener self-teardown).
 */
function startArInteraction(deps: {
  hasGpsFix: () => boolean;
  onWaitingForGps: () => void;
  onPlace: (worldPosition: Vector3) => void;
}): HitTestReticleHandle | null {
  const arWorldGroup = getArWorldGroup();
  if (!arWorldGroup) {
    return null;
  }
  return startHitTestReticle({
    arWorldGroup,
    // A `select` is the AR "tap"; the driver reports every tap with the
    // reticle world position, or `null` when no surface is present. The GPS
    // gate (decideTapPlacement) deliberately outranks the surface check so a
    // pre-fix tap surfaces "waiting for GPS…" even with no surface (Step 4:
    // both objects must share a start pose).
    onSelect: (worldPosition) => {
      const decision = decideTapPlacement({
        hasGpsFix: deps.hasGpsFix(),
        reticleVisible: worldPosition !== null,
      });
      if (decision.kind === 'waiting-for-gps') {
        deps.onWaitingForGps();
        return;
      }
      if (decision.kind === 'no-surface' || worldPosition === null) {
        return;
      }
      deps.onPlace(worldPosition);
    },
  });
}

/** Narrow a GPS fix to the anchor's seed shape (drop altitude when absent). */
function toGpsSeed(position: GpsPosition): LatLong | LatLongAlt {
  return typeof position.altitude === 'number'
    ? { lat: position.lat, lon: position.lon, altitude: position.altitude }
    : { lat: position.lat, lon: position.lon };
}

function main(): void {
  // NOTE: the Chromium WebXR camera-access tab-crash workaround is applied by
  // the framework's initAR() itself since quality-review G-7 (default-on via
  // isolationOptions) — no manual bootstrap call needed here any more.

  const statusEl = getElement<HTMLPreElement>('status');
  const button = getElement<HTMLButtonElement>('enter-ar');
  const arRoot = getElement<HTMLDivElement>('ar-root');

  // The store boots the framework end-to-end (covered by boot.test.ts) and,
  // once recording, fuses GPS + AR pose into the alignment matrix that
  // createGpsAnchor reads.
  const store = createSlamAppStore({ storageBackend: new NullStorageBackend() });
  let gpsFixCount = 0;
  let lastGps: LatLong | LatLongAlt | null = null;

  // Status panel: skips redundant DOM writes and flashes transient hints
  // (e.g. when the user taps before the first GPS fix, honouring the
  // async/feedback UX rule). Extracted to status-panel.ts (PR #177 review)
  // so the cache/hint interaction is unit-tested.
  const { refreshStatus, showHint } = createStatusPanel({
    statusEl,
    getStatusText: () =>
      formatStatus({
        isRecording: store.getState().recording.isRecording,
        actionCount: store.getState().recording.actionCount,
        gpsPositionCount: gpsFixCount,
        failedWriteCount: store.getState().recording.failedWriteCount,
      }),
  });

  // GPS → store. The coordinator only records while a session is active and an
  // AR pose is available, so it is created once and driven from onGpsPosition.
  const gpsHandler = createGpsPositionHandler({
    store,
    getArPose: getCurrentArPose,
  });

  /**
   * The Step 4 contrast co-spawn: place the deliberate floater cube under the
   * scene root and an anchored marker under arWorldGroup at the same world pose,
   * then hand the marker to createGpsAnchor in its default bootstrap.
   */
  function placeContrastPair(worldPosition: Vector3): void {
    const scene = getScene();
    const arWorldGroup = getArWorldGroup();
    const camera = getCamera();
    if (!scene || !arWorldGroup || !camera || lastGps === null) {
      return;
    }

    const { cube, anchorObject } = coSpawnAtWorldPose({ scene, arWorldGroup, worldPosition });

    // Draw a red line from the anchored sphere to its floater cube so the pair
    // (and the drift that opens between them) is identifiable with several pairs
    // on screen. The line is a child of the sphere — end A is the sphere origin,
    // end B tracks the cube's world pose each frame.
    const connector = createConnectorLine({ sphere: anchorObject, cube });
    registerXrFrameUpdate(connector.update);

    // Default bootstrap (NO skipBootstrap): the anchor holds the tapped pose
    // while sampling its own GPS-world pose via the framework's built-in
    // object-pose bootstrap source (quality-review G-6 — the hand-built
    // closure this app used to carry is now the anchor's default), then
    // makes its first lazy correction off-screen. This pins the anchor to
    // the tapped point, not the device, and only works because
    // `enableArWorldGroupAlignment` makes the object's world position
    // GPS-world NUE. The selectors accept any store carrying the gpsData
    // slice (quality-review G-2), so the former `as unknown as` casts are
    // gone too.
    createGpsAnchor({
      object3D: anchorObject,
      arWorldGroup,
      camera,
      gpsPoint: lastGps,
      mode: ANCHOR_MODE,
      getAlignmentMatrix: () => selectAlignmentMatrix(store.getState()),
      getGpsZeroRef: (): LatLong | null =>
        selectZeroReference(store.getState()),
    });
  }

  const controller = createEnableGpsArController();
  let reticleHandle: HitTestReticleHandle | null = null;
  controller.subscribe((state) => {
    const view = buttonView(state);
    button.textContent = view.label;
    button.disabled = view.disabled;
    if (state.status === 'running') {
      // Recording must be active for the GPS coordinator to feed alignment.
      store.dispatch(
        startSession({
          scenarioName: 'minimal-example',
          sessionName: 'live',
          startTime: Date.now(),
        })
      );
      // GPS-register the AR view: lerp the store's alignment onto arWorldGroup
      // so the camera and every anchored child ride the alignment together (the
      // scene-root contrast cube deliberately does NOT, so it visibly slides).
      // Without this the camera is pure-VIO and anchors must absorb the full
      // alignment delta on each re-registration. Fire-and-forget: the framework
      // ties this binding's disposal to the AR session teardown (it registers a
      // session disposer that `resetWebXRState()` flushes), so re-entering AR
      // never leaks the previous session's lerp + store subscription.
      const arWorldGroup = getArWorldGroup();
      if (arWorldGroup) {
        enableArWorldGroupAlignment({
          store: store as unknown as SubscribableStore,
          arWorldGroup,
        });
      }
      // Each `running` transition gets a fresh arWorldGroup + reticle; the
      // previous handle (if the session-end callback somehow didn't run) is
      // disposed first so two drivers never run at once.
      reticleHandle?.dispose();
      reticleHandle = startArInteraction({
        hasGpsFix: () => gpsFixCount > 0,
        onWaitingForGps: () => {
          showHint('waiting for GPS…');
        },
        onPlace: placeContrastPair,
      });
    }
  });

  button.addEventListener('click', () => {
    void controller.enable({
      container: arRoot,
      requestHitTest: true,
      // This example only places content under a hit-test reticle — it never
      // reads the camera image or depth. Disable the camera/depth crash-surface
      // features (which default to `true`) so the session doesn't request
      // `camera-access` / `depth-sensing` or acquire the camera texture each
      // frame. `dom-overlay` / CSS3D stay on for the status hint UI.
      isolationOptions: {
        enableCameraAccess: false,
        enableDepthSensingFeature: false,
        enableCameraTextureAcquisition: false,
      },
      callbacks: {
        // Dispose the reticle driver when the session ends (system back
        // gesture or programmatic stop) — this replaces the inline `'end'`
        // listener the hand-rolled loop used to carry; the next `running`
        // transition creates a fresh driver against the new arWorldGroup.
        onSessionEnd: () => {
          reticleHandle?.dispose();
          reticleHandle = null;
          // The store lives for the whole page while startSession() fires on
          // EVERY `running` transition — without the shared teardown a
          // re-entry blends the dead session's odometry-origin GPS pairs
          // into the new alignment solve (DEC-H3; PR #363 review caught the
          // call missing while the import landed).
          teardownArSessionState(store);
        },
      },
      onGpsPosition: (position: GpsPosition) => {
        gpsFixCount += 1;
        lastGps = toGpsSeed(position);
        gpsHandler(position);
        refreshStatus();
      },
      onOrientation: (orientation: RawDeviceOrientation) => {
        updateDeviceOrientation(orientation);
      },
    });
  });

  store.subscribe(refreshStatus);
  refreshStatus();

  void controller.refreshSupport();
}

main();
