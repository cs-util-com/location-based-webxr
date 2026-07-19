/**
 * Desktop walk simulator — the demo's non-AR mode.
 *
 * Re-implementation of the frozen Prototype-1 simulator against the
 * graduated framework HUD: a grid floor, the synthetic waypoints as
 * wireframe spheres, WASD/arrow walking + OrbitControls drag-look, and the
 * REAL `createWayfindingHud` running in explicit-tick mode
 * (`autoRegisterFrameUpdate: false` — nothing ticks the framework frame
 * loop outside a WebXR session, so this module owns the rAF and calls
 * `hud.update(dt)` itself).
 *
 * All environment touchpoints (renderer, controls, scheduler, window, HUD
 * factory) are injectable so the wiring is unit-testable in node; the real
 * rendering path is covered by the Playwright e2e (which drives the real
 * HUD — no WebXR needed on this path).
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
// Deep subpath imports (not the /visualization barrel): the barrel pulls in
// the leaflet map overlay, which touches `window` at import time and would
// force jsdom onto these node-env unit tests for no benefit.
import {
  createWayfindingHud,
  type WayfindingHud,
} from "gps-plus-slam-app-framework/visualization/wayfinding-hud";
import { disposeObject3D } from "gps-plus-slam-app-framework/visualization/three-dispose";

import type { HudDemoConfig } from "./hud-config";
import { formatHudStatus, summarizeHudScene } from "./hud-status";
import {
  SIM_EYE_HEIGHT,
  SIM_WAYPOINTS,
  createWaypointMarker,
} from "./sim-waypoints";
import { computeMoveStep, createKeyState } from "./walk-controls";

/** The renderer surface the simulator needs (WebGLRenderer-compatible). */
export interface SimRenderer {
  domElement: HTMLElement;
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
}

/** The controls surface the simulator needs (OrbitControls-compatible). */
export interface SimControls {
  target: THREE.Vector3;
  enableDamping: boolean;
  update(): void;
  dispose(): void;
}

/** rAF-compatible scheduler, injectable for headless tests. */
export interface FrameScheduler {
  request(callback: (timestampMs: number) => void): number;
  cancel(id: number): void;
}

/** The window surface used (events, viewport) — injectable for node tests. */
export type WindowLike = Pick<
  Window,
  | "addEventListener"
  | "removeEventListener"
  | "innerWidth"
  | "innerHeight"
  | "devicePixelRatio"
>;

export interface DesktopSimDeps {
  /** Element the canvas is appended to (the #app container). */
  container: HTMLElement;
  /** Current slider config; read on every (re-)creation of the HUD.
   * (Function-typed properties, not method shorthand: the sim destructures
   * these off the deps object — `unbound-method` safe.) */
  getConfig: () => HudDemoConfig;
  /** Receives the formatted HUD status line once per frame. */
  onStatus: (text: string) => void;
  /** Injectables — default to the real implementations. */
  createHudImpl?: typeof createWayfindingHud;
  createRenderer?: () => SimRenderer;
  createControls?: (
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
  ) => SimControls;
  scheduler?: FrameScheduler;
  windowLike?: WindowLike;
}

export interface DesktopSim {
  /** Re-create the HUD from the current config (slider change). */
  refreshHud(): void;
  /** Stop the loop, release listeners and GPU resources. */
  dispose(): void;
}

const defaultScheduler: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => {
    cancelAnimationFrame(id);
  },
};

function defaultCreateRenderer(): SimRenderer {
  return new THREE.WebGLRenderer({ antialias: true });
}

function defaultCreateControls(
  camera: THREE.PerspectiveCamera,
  domElement: HTMLElement,
): SimControls {
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = false;
  return controls;
}

/** Cap a frame delta so a background-tab resume cannot teleport the walker. */
const MAX_FRAME_DT_S = 0.1;

/** Start the walk simulator. Returns a handle for HUD refresh + teardown. */
export function startDesktopSim(deps: DesktopSimDeps): DesktopSim {
  const {
    container,
    getConfig,
    onStatus,
    createHudImpl = createWayfindingHud,
    createRenderer = defaultCreateRenderer,
    createControls = defaultCreateControls,
    scheduler = defaultScheduler,
    windowLike = window,
  } = deps;

  // --- scene -------------------------------------------------------------
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x222222);
  scene.add(new THREE.GridHelper(50, 50));

  const targets = SIM_WAYPOINTS.map((waypoint) => waypoint.clone());
  for (const target of targets) {
    scene.add(createWaypointMarker(target));
  }

  const camera = new THREE.PerspectiveCamera(
    70,
    windowLike.innerWidth / windowLike.innerHeight,
    0.1,
    1000,
  );
  camera.position.set(0, SIM_EYE_HEIGHT, 5);
  camera.lookAt(0, SIM_EYE_HEIGHT, 4.99);

  const renderer = createRenderer();
  renderer.setPixelRatio(windowLike.devicePixelRatio);
  renderer.setSize(windowLike.innerWidth, windowLike.innerHeight);
  container.appendChild(renderer.domElement);

  const controls = createControls(camera, renderer.domElement);
  controls.target.set(0, SIM_EYE_HEIGHT, 4.99);
  controls.update();

  // --- HUD (explicit-tick mode) -----------------------------------------
  let hud: WayfindingHud = createHud();

  function createHud(): WayfindingHud {
    const config = getConfig();
    return createHudImpl({
      camera,
      getTargets: () => targets,
      distanceMin: config.distanceMin,
      distanceMax: config.distanceMax,
      indicatorScale: config.indicatorScale,
      autoRegisterFrameUpdate: false,
    });
  }

  // --- input -------------------------------------------------------------
  const keys = createKeyState();
  const onKeyDown = (event: KeyboardEvent): void => {
    // Slider focus must keep arrow keys for value changes, not walking.
    // (typeof guard: unit tests run in node, where HTMLInputElement is absent.)
    if (
      typeof HTMLInputElement !== "undefined" &&
      event.target instanceof HTMLInputElement
    ) {
      return;
    }
    keys.keyDown(event.key);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    keys.keyUp(event.key);
  };
  const onBlur = (): void => {
    keys.clear(); // never leave a key stuck when the tab loses focus
  };
  const onResize = (): void => {
    camera.aspect = windowLike.innerWidth / windowLike.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(windowLike.innerWidth, windowLike.innerHeight);
  };
  windowLike.addEventListener("keydown", onKeyDown as EventListener);
  windowLike.addEventListener("keyup", onKeyUp as EventListener);
  windowLike.addEventListener("blur", onBlur);
  windowLike.addEventListener("resize", onResize);

  // --- loop --------------------------------------------------------------
  let disposed = false;
  let rafId: number | null = null;
  let lastTimestampMs: number | null = null;

  function frame(timestampMs: number): void {
    if (disposed) return;
    rafId = scheduler.request(frame);

    const dt =
      lastTimestampMs === null
        ? 0
        : Math.min(
            Math.max((timestampMs - lastTimestampMs) / 1000, 0),
            MAX_FRAME_DT_S,
          );
    lastTimestampMs = timestampMs;

    const step = computeMoveStep(keys.active, camera.quaternion, dt);
    if (step.lengthSq() > 0) {
      camera.position.add(step);
      controls.target.add(step);
    }
    controls.update();

    hud.update(dt);
    onStatus(
      formatHudStatus(
        summarizeHudScene(camera.children, camera.position, targets),
      ),
    );

    renderer.render(scene, camera);
  }
  rafId = scheduler.request(frame);

  return {
    refreshHud(): void {
      if (disposed) return;
      hud.dispose();
      hud = createHud();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (rafId !== null) scheduler.cancel(rafId);
      windowLike.removeEventListener("keydown", onKeyDown as EventListener);
      windowLike.removeEventListener("keyup", onKeyUp as EventListener);
      windowLike.removeEventListener("blur", onBlur);
      windowLike.removeEventListener("resize", onResize);
      hud.dispose();
      controls.dispose();
      disposeObject3D(scene);
      renderer.domElement.remove();
      renderer.dispose();
    },
  };
}
