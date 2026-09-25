/**
 * The desktop preview session: everything a WebXR session would have provided,
 * standing in for it.
 *
 * A phone gets its world from `initAR` — an `arWorldGroup`, a pose-tracked
 * camera, a frame loop and a GPS-derived alignment. A desktop gets none of
 * that, so this module supplies the same four things from a plain Three.js
 * scene: a walkable first-person camera, a world group, a `requestAnimation
 * Frame` loop, and a *pinned* frame (tour origin as the GPS zero reference,
 * identity alignment). Because the shapes match, the composed viewing app can
 * run the real AR scene (component 8) — real proximity, real assets, real
 * spatial audio, real tap handling — with no scene-side branching.
 *
 * The renderer, the clock and the controls are injected so the whole session
 * is exercisable in jsdom; only the WebGL rendering itself is not.
 */

import {
  AmbientLight,
  BackSide,
  CircleGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  GridHelper,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";

import type { TourCoord } from "../../../store/types.js";
import {
  createPreviewFrame,
  type PreviewFrame,
} from "../core/preview-frame.js";
import {
  createWalkSimulator,
  type WalkPose,
  type WalkSimulator,
} from "../core/walk-simulator.js";
import { createRouteFollower } from "../core/route-follower.js";
import {
  createPreviewControls,
  type PreviewControls,
} from "./preview-controls.js";
import { createPreviewSeams, type PreviewSeams } from "./preview-seams.js";
import {
  createOsmBuildingLayer,
  type OsmBuildingLayer,
  type OsmBuildingStatus,
} from "./osm-building-layer.js";
import { OSM_ATTRIBUTION } from "gps-plus-slam-osm";

/** The subset of `WebGLRenderer` the session drives (test seam). */
interface PreviewRenderer {
  readonly domElement: HTMLCanvasElement;
  render(scene: Scene, camera: PerspectiveCamera): void;
  setSize(width: number, height: number): void;
  setPixelRatio(ratio: number): void;
  dispose(): void;
}

/**
 * The `ArRuntime` shape `src/app/viewing/ar-scene-runtime.ts` consumes,
 * restated here because a component may not import from `src/app/`
 * (dependency-cruiser `components-and-store-not-to-app`). Structural typing
 * makes the two interchangeable.
 */
interface PreviewRuntime {
  getArWorldGroup(): Object3D | null;
  getCamera(): PerspectiveCamera | null;
  getXrSession(): null;
  getXrReferenceSpace(): null;
  enableArWorldGroupAlignment(options: {
    store: unknown;
    arWorldGroup: Object3D;
  }): { dispose(): void };
  registerFrameUpdate(fn: (dt: number, elapsed: number) => void): () => void;
  selectAlignmentMatrix(state: unknown): readonly number[];
  selectZeroReference(state: unknown): { lat: number; lon: number };
}

export interface PreviewSessionOptions {
  /** Where the canvas is mounted. The HUD and map stay on top of it. */
  readonly container: HTMLElement;
  /** The GPS zero reference the preview world is pinned to. */
  readonly origin: { readonly lat: number; readonly lon: number };
  /** Breadcrumb for the autopilot, in tour coordinates. */
  readonly route?: readonly TourCoord[];
  /** Where the walker starts. Defaults to the origin, facing north. */
  readonly start?: WalkPose;
  readonly eyeHeightM?: number;
  /** Reported whenever the walker moves, so the 2D map can follow. */
  readonly onPositionChange?: (position: { lat: number; lon: number }) => void;
  readonly createRenderer?: (canvasParent: HTMLElement) => PreviewRenderer;
  readonly controls?: PreviewControls;
  readonly now?: () => number;
  readonly raf?: (callback: (time: number) => void) => number;
  readonly cancelRaf?: (handle: number) => void;
  /**
   * Test seam — defaults to a real `OverpassSource`-backed layer. See
   * `plans/2026-08-27-desktop-preview-osm-buildings-plan.md`: every real
   * desktop preview (not only a test double) fetches live OSM buildings
   * once, around the tour's origin, and fails soft to the flat plane.
   */
  readonly osmBuildings?: OsmBuildingLayer;
  /** Forwarded to `createOsmBuildingLayer`'s `enabled` option. Default `true`. */
  readonly osmBuildingsEnabled?: boolean;
}

export interface PreviewSession {
  readonly runtime: PreviewRuntime;
  /** The seams component 8 needs, bound to this session's frame and camera. */
  readonly seams: PreviewSeams;
  readonly frame: PreviewFrame;
  /** The canvas — component 8 raycasts pointer taps against it. */
  readonly domElement: HTMLCanvasElement;
  getPose(): WalkPose;
  /** Walk the tour's breadcrumb automatically instead of by keyboard. */
  setAutopilot(enabled: boolean): void;
  isAutopilot(): boolean;
  getOsmBuildingsStatus(): OsmBuildingStatus;
  onOsmBuildingsStatusChange(
    callback: (status: OsmBuildingStatus) => void,
  ): () => void;
  setOsmBuildingsEnabled(enabled: boolean): void;
  dispose(): void;
}

const IDENTITY_MATRIX: readonly number[] = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];

const DEFAULT_EYE_HEIGHT_M = 1.6;

function resolveOsmBuildingsEnabled(options: PreviewSessionOptions): boolean {
  return options.osmBuildingsEnabled ?? true;
}

/** A daylight sky dome: cheap, and far more legible than a flat clear colour. */
function createSky(): Mesh {
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new Color(0x5b8fd6) },
      bottomColor: { value: new Color(0xd9e6f2) },
    },
    vertexShader: `
      varying float vH;
      void main() {
        vH = normalize(position).y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      varying float vH;
      void main() {
        gl_FragColor = vec4(mix(bottomColor, topColor, smoothstep(-0.1, 0.6, vH)), 1.0);
      }
    `,
  });
  const sky = new Mesh(new SphereGeometry(900, 24, 16), material);
  sky.frustumCulled = false;
  return sky;
}

/**
 * The scenery: sky, sun, ground, grid, fog — the stand-in for a camera feed.
 * Deliberately cheap and deliberately plain: it has to read as "outdoors, and
 * that thing over there is a tour stop", nothing more.
 */
function buildWorld(): {
  scene: Scene;
  camera: PerspectiveCamera;
  arWorldGroup: Group;
} {
  const scene = new Scene();
  scene.background = new Color(0xbcd2ea);
  // Fog tuned to the sky colour: distant waypoints fade in as the visitor
  // approaches, which is roughly how they behave on a real camera feed.
  scene.fog = new Fog(0xbcd2ea, 40, 320);

  scene.add(createSky());
  scene.add(new AmbientLight(0xffffff, 1.4));
  const sun = new DirectionalLight(0xfff4e0, 1.5);
  sun.position.set(60, 120, 30);
  scene.add(sun);

  const ground = new Mesh(
    new CircleGeometry(600, 64),
    new MeshLambertMaterial({ color: 0x6f8f5e }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  scene.add(ground);

  // A faint grid gives the ground a sense of scale — without it a first-person
  // walk over a flat plane reads as standing still.
  const grid = new GridHelper(600, 300, 0x8aa87a, 0x7d9a6e);
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  scene.add(grid);

  /** Stands in for the framework's `arWorldGroup` (identity alignment). */
  const arWorldGroup = new Group();
  scene.add(arWorldGroup);

  const camera = new PerspectiveCamera(65, aspectOf(), 0.1, 1200);
  // Anything parented to the camera (audioListener, and now the wayfinding
  // guide's indicator) only gets traversed by renderer.render(scene, camera)
  // if the camera itself is reachable from `scene` — the camera's OWN view
  // matrix works fine either way, but its children silently never render
  // without this.
  scene.add(camera);

  return { scene, camera, arWorldGroup };
}

/** The animation clock, real by default and hand-driven under test. */
function resolveClock(options: PreviewSessionOptions): {
  now: () => number;
  raf: (callback: (time: number) => void) => number;
  cancelRaf: (handle: number) => void;
} {
  return {
    now: options.now ?? (() => performance.now()),
    raf:
      options.raf ??
      ((callback: (time: number) => void) => requestAnimationFrame(callback)),
    cancelRaf:
      options.cancelRaf ?? ((handle: number) => cancelAnimationFrame(handle)),
  };
}

export function createPreviewSession(
  options: PreviewSessionOptions,
): PreviewSession {
  const eyeHeight = options.eyeHeightM ?? DEFAULT_EYE_HEIGHT_M;
  const frame = createPreviewFrame(options.origin);

  // ── The world ─────────────────────────────────────────────────────────────
  const { scene, camera, arWorldGroup } = buildWorld();

  // Real OSM buildings, fetched once around the tour's origin AND its whole
  // breadcrumb — desktop preview only, see osm-building-layer.ts. Added to
  // the scene root (fixed geographic content), never to arWorldGroup. Empty
  // until (and unless) `load()` finds anything; the flat ground/sky/fog
  // above is the permanent fallback, not replaced by this.
  const osmBuildings =
    options.osmBuildings ??
    createOsmBuildingLayer({
      origin: options.origin,
      ...(options.route ? { route: options.route } : {}),
      enabled: resolveOsmBuildingsEnabled(options),
    });
  scene.add(osmBuildings.group);
  void osmBuildings.load();

  // The ODbL attribution obligation: a fixed, always-on credit line while
  // desktop preview is open, deliberately not conditioned on whether
  // buildings actually loaded (kept simple, per plan).
  const attribution = document.createElement("div");
  attribution.className = "preview-attribution";
  attribution.textContent = OSM_ATTRIBUTION;
  options.container.appendChild(attribution);

  const renderer =
    options.createRenderer?.(options.container) ?? createDefaultRenderer();
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
  renderer.setSize(widthOf(), heightOf());
  renderer.domElement.className = "preview-canvas";
  options.container.appendChild(renderer.domElement);

  // ── Locomotion ────────────────────────────────────────────────────────────
  const walk: WalkSimulator = createWalkSimulator(
    options.start ? { start: options.start } : {},
  );
  const routePoints = (options.route ?? []).map((coord) => {
    const point = frame.toWorld(coord);
    return { x: point.x, z: point.z };
  });
  const route = createRouteFollower({ path: routePoints, speedMps: 2.8 });
  let autopilot = false;
  let pitchRad = 0;

  const controls =
    options.controls ??
    createPreviewControls({
      keyTarget: globalThis.window,
      pointerTarget: renderer.domElement,
    });

  const lookTarget = new Vector3();
  function applyPose(pose: WalkPose): void {
    camera.position.set(pose.x, eyeHeight, pose.z);
    const cosPitch = Math.cos(pitchRad);
    lookTarget.set(
      pose.x + Math.cos(pose.headingRad) * cosPitch,
      eyeHeight + Math.sin(pitchRad),
      pose.z + Math.sin(pose.headingRad) * cosPitch,
    );
    camera.lookAt(lookTarget);
    camera.updateMatrixWorld();
  }
  applyPose(walk.pose());

  let lastReported: WalkPose | null = null;
  function reportPosition(pose: WalkPose): void {
    if (
      lastReported !== null &&
      lastReported.x === pose.x &&
      lastReported.z === pose.z
    ) {
      return;
    }
    lastReported = pose;
    options.onPositionChange?.(frame.toCoord({ x: pose.x, y: 0, z: pose.z }));
  }
  reportPosition(walk.pose());

  // ── The frame loop ────────────────────────────────────────────────────────
  const { now, raf, cancelRaf } = resolveClock(options);

  const frameCallbacks = new Set<(dt: number, elapsed: number) => void>();
  const startedAt = now();
  let lastTime = startedAt;
  let rafHandle = 0;
  let disposed = false;

  function tick(time: number): void {
    if (disposed) return;
    const dt = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;

    const sample = controls.sample();
    if (autopilot) {
      const pose = route.advance(dt);
      walk.teleport(pose);
    } else {
      walk.turnBy(sample.yawDeltaRad);
      pitchRad = clampPitch(pitchRad + sample.pitchDeltaRad);
      walk.step(dt, sample.input);
    }
    applyPose(walk.pose());
    reportPosition(walk.pose());

    for (const callback of [...frameCallbacks]) {
      callback(dt, (time - startedAt) / 1000);
    }
    renderer.render(scene, camera);
    rafHandle = raf(tick);
  }
  rafHandle = raf(tick);

  const onResize = (): void => {
    camera.aspect = aspectOf();
    camera.updateProjectionMatrix();
    renderer.setSize(widthOf(), heightOf());
  };
  globalThis.window.addEventListener("resize", onResize);

  const runtime: PreviewRuntime = {
    getArWorldGroup: () => arWorldGroup,
    getCamera: () => camera,
    getXrSession: () => null,
    getXrReferenceSpace: () => null,
    // Nothing to lerp: the preview's alignment is pinned from frame one.
    enableArWorldGroupAlignment: () => ({ dispose: () => undefined }),
    registerFrameUpdate(fn) {
      frameCallbacks.add(fn);
      return () => frameCallbacks.delete(fn);
    },
    selectAlignmentMatrix: () => IDENTITY_MATRIX,
    selectZeroReference: () => options.origin,
  };

  const seams = createPreviewSeams({ frame, getCamera: () => camera });

  return {
    runtime,
    seams,
    frame,
    domElement: renderer.domElement,
    getPose: () => walk.pose(),
    setAutopilot(enabled) {
      if (enabled === autopilot) return;
      autopilot = enabled;
      // Neither branch touches `route`'s own position: it already sits
      // wherever autopilot last left it (advance() is the only thing that
      // moves it, and that only runs while autopilot is on), so toggling
      // off and back on resumes from there instead of jumping back to the
      // start of the route every time.
      if (!enabled) {
        // Hand the walker back exactly where the autopilot left it.
        walk.teleport(walk.pose());
      }
    },
    isAutopilot: () => autopilot,
    getOsmBuildingsStatus: () => osmBuildings.getStatus(),
    onOsmBuildingsStatusChange: (callback) =>
      osmBuildings.onStatusChange(callback),
    setOsmBuildingsEnabled: (enabled) => osmBuildings.setEnabled(enabled),
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelRaf(rafHandle);
      globalThis.window.removeEventListener("resize", onResize);
      controls.dispose();
      frameCallbacks.clear();
      osmBuildings.dispose();
      attribution.remove();
      renderer.domElement.remove();
      renderer.dispose();
    },
  };
}

const clampPitch = (value: number): number =>
  Math.max(-1.2, Math.min(1.2, value));

// The canvas is a fixed, full-viewport backdrop (`.preview-canvas` sits under
// the HUD and the map, exactly where the camera feed sits in a real AR
// session) — its resolution must track the viewport, not whatever box its
// mount point happens to have in the surrounding page's layout.
const widthOf = (): number => globalThis.window.innerWidth;
const heightOf = (): number => globalThis.window.innerHeight;
const aspectOf = (): number => widthOf() / Math.max(heightOf(), 1);

function createDefaultRenderer(): PreviewRenderer {
  const renderer = new WebGLRenderer({ antialias: true });
  return renderer;
}
