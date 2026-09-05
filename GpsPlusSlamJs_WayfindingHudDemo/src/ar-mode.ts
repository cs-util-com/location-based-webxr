/**
 * Live-AR mode — tap-to-place waypoints guided by the wayfinding HUD.
 *
 * Device-only WebXR glue (verified via `pnpm dev` on an AR-capable phone,
 * per the MinimalExample/PhysicsDemo convention); the CONFIG wiring is
 * covered by ar-mode.test.ts. Flow: framework `initAR` (camera/depth
 * crash-surface features off, hit-test on) → screen-centre reticle →
 * `select` (the AR tap) places a wireframe waypoint marker under
 * `arWorldGroup` → the framework HUD guides back to every placed waypoint.
 *
 * The HUD runs in its DEFAULT self-registering mode here: inside a WebXR
 * session the framework frame loop ticks it (unlike the desktop simulator,
 * which owns its own rAF and uses explicit-tick mode).
 */

import * as THREE from "three";
// Deep subpath imports (not the barrels) — keeps the node-env unit test free
// of the leaflet-loading /visualization barrel and mirrors desktop-sim.ts.
import { startHitTestReticle } from "gps-plus-slam-app-framework/ar/hit-test-reticle-driver";
import {
  endARSession,
  getArWorldGroup,
  getCamera,
  initAR,
} from "gps-plus-slam-app-framework/ar/webxr-session";
import { registerXrFrameUpdate } from "gps-plus-slam-app-framework/ar/xr-frame-loop";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state/create-slam-app-store";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage/null-storage-backend";
import {
  createWayfindingHud,
  type WayfindingHud,
  type WayfindingTarget,
} from "gps-plus-slam-app-framework/visualization/wayfinding-hud";

import { buildExampleWaypoints } from "./ar-waypoints";
import type { HudDemoConfig } from "./hud-config";
import { hudLookOptions } from "./hud-options";
import { formatHudStatus, summarizeHudScene } from "./hud-status";
import { createWaypointMarker } from "./sim-waypoints";

export interface ArModeDeps {
  /** Element `initAR` mounts into (the #app container / DOM-overlay root). */
  container: HTMLElement;
  /** Current slider config; read on every (re-)creation of the HUD. */
  getConfig(): HudDemoConfig;
  /** Receives the formatted HUD status line once per XR frame. */
  onStatus(text: string): void;
  /** Transient user hint (e.g. a tap with no surface under the reticle). */
  onHint(message: string): void;
  /** Surfaced when the AR session cannot start or dies. */
  onError(message: string): void;
  /** Fired once the session is live (reveal the in-AR UI). */
  onStarted?(): void;
  /** Fired when the session ends outside dispose() (system back gesture). */
  onEnded?(): void;
}

export interface ArMode {
  /** Re-create the HUD from the current config (slider change). */
  refreshHud(): void;
  /** Number of waypoints placed so far. */
  placedCount(): number;
  /** Tear the session down (idempotent). */
  dispose(): void;
}

const NOOP_AR_MODE: ArMode = {
  refreshHud: () => undefined,
  placedCount: () => 0,
  dispose: () => undefined,
};

/** Start the live AR mode. Resolves to a no-op handle when AR fails. */
export async function startArMode(deps: ArModeDeps): Promise<ArMode> {
  // The store rides into initAR as the tracking group (framework convention;
  // this demo reads no GPS, so no sensor watches are started).
  const store = createSlamAppStore({
    storageBackend: new NullStorageBackend(),
  });

  let sessionEnded = false;
  let disposed = false;
  // False until startArMode's wiring below is complete. Guards the case where
  // the session ends during a failed boot (e.g. the scene-not-ready bailout
  // calls endARSession): dispose()/onEnded must not run against half-built
  // state — matching the old inline 'end' listener, which was only wired
  // once the frame loop ran.
  let bootCompleted = false;

  try {
    await initAR(
      deps.container,
      {
        // Tap-to-place only — never reads the camera image or depth. Turn the
        // camera/depth crash-surface features (default true) off; keep
        // hit-test for the reticle and dom-overlay for the panel UI.
        enableCameraAccess: false,
        enableDepthSensingFeature: false,
        enableCameraTextureAcquisition: false,
      },
      { requestHitTest: true },
      {
        tracking: { store },
        // Fires on both the app-initiated end (our dispose → endARSession)
        // and the system-initiated one (back gesture). Replaces the inline
        // session-'end' listener the hand-rolled reticle loop used to carry.
        onSessionEnd: () => {
          sessionEnded = true;
          if (!bootCompleted) return;
          dispose();
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

  const arWorldGroup = getArWorldGroup();
  const camera = getCamera();
  if (!arWorldGroup || !camera) {
    deps.onError("AR scene not ready.");
    void endARSession();
    return NOOP_AR_MODE;
  }

  const markers: THREE.Mesh[] = [];
  // Fresh WayfindingTarget literals every call are fine BECAUSE each carries
  // the marker's uuid as its stable id — the HUD keys per-target hysteresis
  // state by id (2026-07-20 per-target config plan).
  const getTargets = (): WayfindingTarget[] =>
    markers.map((marker) => ({
      id: marker.uuid,
      position: marker.getWorldPosition(new THREE.Vector3()),
    }));

  function createHud(): WayfindingHud {
    // Deadband, scale, accent tint and sprites: one derivation shared with
    // the desktop simulator (hud-options.ts).
    return createWayfindingHud({
      camera: camera as THREE.PerspectiveCamera,
      getTargets,
      ...hudLookOptions(deps.getConfig()),
    });
  }
  let hud = createHud();

  /** Add a waypoint marker at a WORLD position (parented under arWorldGroup). */
  const addMarkerAtWorld = (worldPosition: THREE.Vector3): void => {
    const marker = createWaypointMarker(new THREE.Vector3());
    arWorldGroup.updateWorldMatrix(true, false);
    marker.position.copy(arWorldGroup.worldToLocal(worldPosition));
    arWorldGroup.add(marker);
    markers.push(marker);
  };

  // The framework's shared driver owns the reticle mesh and every per-frame
  // hit-test/session-end race guard; the app only decides what a tap means.
  const reticleHandle = startHitTestReticle({
    arWorldGroup,
    onSelect: (worldPosition) => {
      if (!worldPosition) {
        // Async-feedback rule: a tap that cannot place must say why.
        deps.onHint("Point the camera at the floor, then tap.");
        return;
      }
      addMarkerAtWorld(worldPosition);
    },
  });

  let examplesSpawned = false;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    unregisterFrameUpdate();
    hud.dispose();
    reticleHandle.dispose();
    for (const marker of markers) {
      arWorldGroup.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
    }
    markers.length = 0;
    if (!sessionEnded) {
      void endARSession();
    }
  };

  // The app keeps its own frame callback beside the driver's: it spawns the
  // example waypoints on the first tracked frame and pushes the HUD status
  // line every frame — only the hit-test plumbing moved into the framework.
  const unregisterFrameUpdate = registerXrFrameUpdate(() => {
    // First tracked frame: spawn the example targets around the user's
    // start pose so the HUD demonstrates itself immediately (ring ahead,
    // arrows right + behind) — see ar-waypoints.ts and the demo plan's
    // AR-onboarding revision. The init-time camera pose is not settled
    // yet, hence first-frame spawning rather than at startArMode.
    if (!examplesSpawned) {
      examplesSpawned = true;
      const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
      const cameraQuaternion = camera.getWorldQuaternion(
        new THREE.Quaternion(),
      );
      for (const waypoint of buildExampleWaypoints(
        cameraPosition,
        cameraQuaternion,
      )) {
        addMarkerAtWorld(waypoint);
      }
    }

    deps.onStatus(
      formatHudStatus(
        summarizeHudScene(
          camera.children,
          camera.position,
          getTargets().map((target) => target.position),
        ),
      ),
    );
  });

  bootCompleted = true;
  deps.onStarted?.();

  return {
    refreshHud(): void {
      if (disposed) return;
      hud.dispose();
      hud = createHud();
    },
    placedCount: () => markers.length,
    dispose,
  };
}
