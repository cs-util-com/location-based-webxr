/**
 * Live-AR mode — a genuine on-device AR physics session (the other half of the
 * demo; the desktop-replay path lives in `main.ts`).
 *
 * It starts a WebXR session (`initAR`), reconstructs the room from the live depth
 * stream (`createOccupancyView` — the same occupancy stack the replay path uses),
 * runs the shared `createPhysicsRuntime`, and places balls where a screen-centre
 * WebXR hit-test reticle sits when the user taps. Everything below the tested
 * pieces (occupancy view, physics runtime, mesh-view controller) is device-only
 * WebXR glue — verified manually via `pnpm dev` on an Android phone, per the repo
 * norm (Playwright Chromium has no `navigator.xr`), mirroring the sibling apps'
 * `reticle-hit-test.ts` / `startArInteraction`.
 */

import * as THREE from "three";
import {
  initAR,
  endARSession,
  getArWorldGroup,
  getCamera,
  getRenderer,
  getScene,
  startDepthCapture,
  stopDepthCapture,
} from "gps-plus-slam-app-framework/ar/webxr-session";
import { registerXrFrameUpdate } from "gps-plus-slam-app-framework/ar/xr-frame-loop";
import {
  DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE,
  DEFAULT_RECONSTRUCTION_DEPTH_INTERVAL_MS,
} from "gps-plus-slam-app-framework/ar/depth-sampler";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state/create-slam-app-store";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage/null-storage-backend";
import { recordDepthSample } from "gps-plus-slam-app-framework/state/recording-slice";
import { createOccupancyView } from "./occupancy-view";
import { createPhysicsRuntime } from "./physics-runtime";
import {
  bindShadowSwitch,
  shadowsLabel,
  startDemoShadows,
  type DemoShadows,
} from "./ar-shadows-wiring";
import { createBallStatus, statsText } from "./ball-status";
import { shootBallFromCamera } from "./shoot-ball";
import type { OccluderDebugStyle } from "gps-plus-slam-app-framework/visualization/occlusion-mesh";
import type { MeshMode } from "gps-plus-slam-app-framework/ar/occupancy-mesher";

export interface ArModeDeps {
  readonly container: HTMLElement;
  readonly statsEl: HTMLElement;
  /** Mesh-mode dropdown (Surface nets / Cubes / Corner-fit). */
  readonly meshStyleSelect: HTMLSelectElement;
  /** Shader dropdown (the OccluderDebugStyle skins). */
  readonly meshShaderSelect: HTMLSelectElement;
  /** Surface a failure (permission denied, no depth, WebXR error) to the UI. */
  readonly onError: (message: string) => void;
  /** Called once the live AR session is up and physics is running. */
  readonly onStarted?: () => void;
  /** Called once per XR frame (drives the always-on perf panel). */
  readonly onFrame?: () => void;
  /** AR shadows from the thrown balls (off with `?shadows=0`). Default on. */
  readonly shadows?: boolean;
  /** The panel's Shadows switch (round-2 plan M1), when the page has one. */
  readonly shadowToggle?: HTMLInputElement;
  /**
   * The controls panel: a tap on it must not also shoot (a DOM-overlay tap
   * fires the click AND an XR select; see `startArMode`).
   */
  readonly panel?: HTMLElement;
}

/**
 * Start the live-AR physics session. Resolves once the session is running (or
 * rejects/`onError`s on failure). The returned disposer ends the AR session.
 */
export async function startArMode(deps: ArModeDeps): Promise<() => void> {
  const store = createSlamAppStore({
    storageBackend: new NullStorageBackend(),
  });

  try {
    await initAR(
      deps.container,
      {},
      { requestDepthOcclusion: true },
      {
        tracking: { store },
        depth: {
          onCaptured: (sample) => store.dispatch(recordDepthSample(sample)),
          onUnavailable: () =>
            deps.onError("Depth sensing is unavailable on this device."),
        },
      },
    );
  } catch (err) {
    deps.onError(
      err instanceof Error ? err.message : "Could not start the AR session.",
    );
    return () => {};
  }

  const arWorldGroup = getArWorldGroup();
  if (!arWorldGroup) {
    deps.onError("AR session started without a scene.");
    void endARSession();
    return () => {};
  }

  // Live room reconstruction from the depth stream — one occluder for occlusion
  // AND physics, with the mesh mode + shader from the UI dropdowns. Depth runs
  // at the framework RECONSTRUCTION cadence — the same single tuning source
  // the recorder defaults read, so the two apps can never drift apart again
  // (2026-07-16 field feedback; values from the maintainer’s on-device
  // framerate/mesh trade-off pass).
  startDepthCapture({
    intervalMs: DEFAULT_RECONSTRUCTION_DEPTH_INTERVAL_MS,
    gridSize: DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE,
  });
  const occupancy = createOccupancyView(arWorldGroup, store, {
    meshMode: deps.meshStyleSelect.value as MeshMode,
    debugStyle: deps.meshShaderSelect.value as OccluderDebugStyle,
  });
  deps.meshStyleSelect.addEventListener("change", () =>
    occupancy.setMeshMode(deps.meshStyleSelect.value as MeshMode),
  );
  deps.meshShaderSelect.addEventListener("change", () =>
    occupancy.setDebugStyle(deps.meshShaderSelect.value as OccluderDebugStyle),
  );

  // Shared physics runtime — its trimesh collider follows the same occluder.
  let shadows: DemoShadows | null = null;
  const ballStatus = createBallStatus();
  const viewerPosition = new THREE.Vector3();
  const runtime = createPhysicsRuntime(arWorldGroup, occupancy, {
    // The owner's view on the phone (round-2 plan M1): resting and fallen
    // balls, the collider, and the shadows' state.
    onStats: (_balls, tris) => {
      const viewerY = getCamera()?.getWorldPosition(viewerPosition).y ?? 0;
      deps.statsEl.textContent = statsText(
        ballStatus.update(
          runtime.balls(),
          viewerY,
          (p) => shadows?.inRange(p) ?? false,
        ),
        tris,
        shadowsLabel(shadows),
      );
    },
  });

  // The thrown balls cast onto the reconstructed room (W4 plan §11). The
  // session already renders, so turning the shadow map on recompiles the lit
  // materials once (accepted, plan §8 item 6). Started even with
  // ?shadows=0 (then switched off), so the switch never recompiles later.
  const renderer = getRenderer();
  const scene = getScene();
  let releaseSwitch = (): void => {};
  if (renderer && scene) {
    shadows = startDemoShadows({
      renderer,
      scene,
      arWorldGroup,
      getOccluder: () => occupancy.getOcclusionMesh(),
      ballCount: () => runtime.ballCount(),
      getCamera,
    });
    releaseSwitch = bindShadowSwitch(
      shadows,
      deps.shadows ?? true,
      deps.shadowToggle,
    );
  }

  // Tap-to-shoot: a ball leaves the camera along its forward direction and flies
  // into the reconstructed room. No reticle — the ball goes where you look.
  const shootForward = (): void => {
    const camera = getCamera();
    if (!camera) return;
    shootBallFromCamera(
      runtime,
      camera.getWorldPosition(new THREE.Vector3()),
      camera.getWorldDirection(new THREE.Vector3()),
    );
  };

  // ONE TAP, ONE EVENT (as OsmDemo's DEC-Y18): a tap on the DOM overlay
  // fires a DOM click AND an XR select, and a select shoots a ball, so every
  // flip of the Shadows switch or a dropdown threw one (M1 review).
  // Cancelling `beforexrselect` on the panel suppresses only the XR half, and
  // only for taps on the panel: taps on the scene still shoot.
  const cancelXrSelect = (event: Event): void => event.preventDefault();
  deps.panel?.addEventListener("beforexrselect", cancelXrSelect);

  let selectWired = false;
  const unregisterFrame = registerXrFrameUpdate(({ session }) => {
    // Step physics every XR frame (the throttle uses wall-clock ms).
    runtime.step(performance.now());
    shadows?.update(); // before this frame's render: no shadow lag in AR
    deps.onFrame?.(); // advance the always-on perf panel
    if (!selectWired) {
      selectWired = true;
      session.addEventListener("select", shootForward);
    }
  });

  deps.onStarted?.();

  return () => {
    unregisterFrame();
    stopDepthCapture();
    deps.panel?.removeEventListener("beforexrselect", cancelXrSelect);
    releaseSwitch();
    shadows?.dispose();
    occupancy.dispose();
    runtime.dispose();
    void endARSession();
  };
}
