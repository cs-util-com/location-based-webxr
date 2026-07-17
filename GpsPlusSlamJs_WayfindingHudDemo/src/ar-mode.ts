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
  createReticleMesh,
  updateReticle,
} from "gps-plus-slam-app-framework/visualization/hit-test-reticle";
import {
  createWayfindingHud,
  type WayfindingHud,
} from "gps-plus-slam-app-framework/visualization/wayfinding-hud";

import { buildExampleWaypoints } from "./ar-waypoints";
import type { HudDemoConfig } from "./hud-config";
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

/**
 * Request a screen-centre hit-test source from the live session. Returns
 * `null` when the runtime does not expose `requestHitTestSource` (older
 * WebXR builds).
 */
async function requestHitTestSource(
  session: XRSession,
): Promise<XRHitTestSource | null> {
  const viewerSpace = await session.requestReferenceSpace("viewer");
  const source = await session.requestHitTestSource?.({ space: viewerSpace });
  return source ?? null;
}

/** Start the live AR mode. Resolves to a no-op handle when AR fails. */
export async function startArMode(deps: ArModeDeps): Promise<ArMode> {
  // The store rides into initAR as the tracking group (framework convention;
  // this demo reads no GPS, so no sensor watches are started).
  const store = createSlamAppStore({
    storageBackend: new NullStorageBackend(),
  });

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
      { tracking: { store } },
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

  const reticle = createReticleMesh();
  arWorldGroup.add(reticle);

  const markers: THREE.Mesh[] = [];
  const getTargets = (): THREE.Vector3[] =>
    markers.map((marker) => marker.getWorldPosition(new THREE.Vector3()));

  function createHud(): WayfindingHud {
    const config = deps.getConfig();
    return createWayfindingHud({
      camera: camera as THREE.PerspectiveCamera,
      getTargets,
      distanceMin: config.distanceMin,
      distanceMax: config.distanceMax,
      indicatorScale: config.indicatorScale,
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

  const placeWaypoint = (): void => {
    if (!reticle.visible) {
      // Async-feedback rule: a tap that cannot place must say why.
      deps.onHint("Point the camera at the floor, then tap.");
      return;
    }
    addMarkerAtWorld(reticle.getWorldPosition(new THREE.Vector3()));
  };

  let hitTestSource: XRHitTestSource | null = null;
  let hitTestSourceRequested = false;
  let sessionEnded = false;
  let selectWired = false;
  let examplesSpawned = false;
  let disposed = false;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    unregisterFrameUpdate();
    hud.dispose();
    arWorldGroup.remove(reticle);
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

  const unregisterFrameUpdate = registerXrFrameUpdate(
    ({ frame, referenceSpace, session }) => {
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

      if (!selectWired) {
        selectWired = true;
        session.addEventListener("select", placeWaypoint);
        session.addEventListener("end", () => {
          sessionEnded = true;
          hitTestSource = null;
          dispose();
          deps.onEnded?.();
        });
      }

      if (!hitTestSourceRequested) {
        hitTestSourceRequested = true;
        requestHitTestSource(session)
          .then((source) => {
            // Session may have ended while the request was in flight.
            if (sessionEnded) {
              source?.cancel();
              return;
            }
            hitTestSource = source;
          })
          .catch(() => {
            hitTestSourceRequested = false; // allow a later-frame retry
          });
      }

      if (hitTestSource) {
        const [hit] = frame.getHitTestResults(hitTestSource);
        const pose = hit?.getPose(referenceSpace);
        updateReticle(reticle, pose ? pose.transform.matrix : null);
      } else {
        updateReticle(reticle, null);
      }

      deps.onStatus(
        formatHudStatus(
          summarizeHudScene(camera.children, camera.position, getTargets()),
        ),
      );
    },
  );

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
