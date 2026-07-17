/**
 * Desktop-replay physics lifecycle — the per-replay resources behind ONE disposer.
 *
 * On the desktop path the demo, for each loaded recording, builds an occupancy
 * view (occlusion AND collider), a shared physics runtime, an rAF step loop and
 * click-to-shoot. This module owns all of that and returns a disposer that STOPS
 * the loop and frees every resource + listener, so starting a new replay (or
 * ending one) can never stack orphaned rAF loops, physics worlds or WebGL
 * geometries — the leak/crash PR #197 review flagged (a freed Rapier world would
 * throw on the next `step`; an undisposed one leaks unboundedly on reload).
 *
 * Extracted from `main.ts` (the "logic lives in tested modules" split) so the
 * lifecycle is headless-testable: the rAF scheduler and the view/runtime
 * factories are injectable.
 *
 * @see replay-physics.ts.md
 */

import * as THREE from "three";
import { pointerToNdc } from "gps-plus-slam-app-framework/visualization/pointer-picking";
import type { OccluderDebugStyle } from "gps-plus-slam-app-framework/visualization/occlusion-mesh";
import type { MeshMode } from "gps-plus-slam-app-framework/ar/occupancy-mesher";
import type { ReplaySessionController } from "gps-plus-slam-app-framework/state/replay-session";
import { createOccupancyView } from "./occupancy-view";
import { createPhysicsRuntime } from "./physics-runtime";
import { shootBallFromCamera } from "./shoot-ball";

/** The mesh-panel controls + per-frame perf hook the replay physics drives. */
export interface ReplayPhysicsControls {
  /** Mesh-mode dropdown (Surface nets / Cubes / Corner-fit). */
  readonly meshStyleSelect: HTMLSelectElement;
  /** Shader dropdown (the `OccluderDebugStyle` skins). */
  readonly meshShaderSelect: HTMLSelectElement;
  /** Element that shows the `balls N · collider N tris` line. */
  readonly statsEl: HTMLElement;
  /** Advance the always-on perf panel once per frame. */
  readonly onFrame: () => void;
}

/** Injectable rAF scheduler so the step loop is unit-testable without a browser. */
export interface FrameScheduler {
  request(cb: (t: number) => void): number;
  cancel(handle: number): void;
}

/** Injectable factories so the lifecycle is testable without WebGL/Rapier. */
export interface ReplayPhysicsFactories {
  readonly createOccupancyView: typeof createOccupancyView;
  readonly createPhysicsRuntime: typeof createPhysicsRuntime;
}

const defaultScheduler: FrameScheduler = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (handle) => cancelAnimationFrame(handle),
};

const defaultFactories: ReplayPhysicsFactories = {
  createOccupancyView,
  createPhysicsRuntime,
};

/**
 * Wire desktop-replay physics onto a live replay `session` and return a disposer.
 *
 * The disposer stops the rAF loop (a straggler frame already queued becomes a
 * no-op), disposes the runtime + occupancy view, and removes the pointer + mesh
 * dropdown listeners. It is idempotent — safe to call before starting the next
 * replay AND on final teardown.
 */
export function startReplayPhysics(
  session: ReplaySessionController,
  controls: ReplayPhysicsControls,
  scheduler: FrameScheduler = defaultScheduler,
  factories: ReplayPhysicsFactories = defaultFactories,
): () => void {
  const scene = session.getScene();

  // The demo owns its occupancy view (one occluder for occlusion AND physics),
  // fed by the replay store's depth stream. Mesh mode + shader come from the UI.
  const occupancyView = factories.createOccupancyView(
    scene.arWorldGroup,
    session.getStore(),
    {
      meshMode: controls.meshStyleSelect.value as MeshMode,
      debugStyle: controls.meshShaderSelect.value as OccluderDebugStyle,
    },
  );
  const onMeshStyleChange = (): void =>
    occupancyView.setMeshMode(controls.meshStyleSelect.value as MeshMode);
  const onMeshShaderChange = (): void =>
    occupancyView.setDebugStyle(
      controls.meshShaderSelect.value as OccluderDebugStyle,
    );
  controls.meshStyleSelect.addEventListener("change", onMeshStyleChange);
  controls.meshShaderSelect.addEventListener("change", onMeshShaderChange);

  const runtime = factories.createPhysicsRuntime(
    scene.arWorldGroup,
    occupancyView,
    {
      onStats: (balls, tris) => {
        controls.statsEl.textContent = `balls ${balls} · collider ${tris} tris`;
      },
    },
  );

  // Desktop replay is driven by window rAF. `active` guards the straggler frame
  // that can still fire after the pending handle is cancelled.
  let active = true;
  let frameHandle = 0;
  const tick = (t: number): void => {
    if (!active) return;
    runtime.step(t);
    controls.onFrame();
    frameHandle = scheduler.request(tick);
  };
  frameHandle = scheduler.request(tick);

  // Placement (desktop): click → shoot a ball FROM the camera toward where you
  // clicked, so it flies out, hits the reconstructed mesh and bounces.
  const canvas = scene.renderer.domElement;
  const raycaster = new THREE.Raycaster();
  const onPointerDown = (e: PointerEvent): void => {
    const ndc = pointerToNdc(
      e.clientX,
      e.clientY,
      canvas.getBoundingClientRect(),
    );
    raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), scene.camera);
    shootBallFromCamera(
      runtime,
      scene.camera.getWorldPosition(new THREE.Vector3()),
      raycaster.ray.direction,
    );
  };
  canvas.addEventListener("pointerdown", onPointerDown);

  let disposed = false;
  return (): void => {
    if (disposed) return;
    disposed = true;
    active = false;
    scheduler.cancel(frameHandle);
    canvas.removeEventListener("pointerdown", onPointerDown);
    controls.meshStyleSelect.removeEventListener("change", onMeshStyleChange);
    controls.meshShaderSelect.removeEventListener("change", onMeshShaderChange);
    runtime.dispose();
    occupancyView.dispose();
  };
}
