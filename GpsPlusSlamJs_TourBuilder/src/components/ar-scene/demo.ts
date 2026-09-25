/**
 * Standalone demo for component 8 (TASK.md §2.3): the AR viewing scene driven by
 * a REAL recorded walk, on a desktop, with no phone and no GPS (plan A23).
 *
 * What is real here: the store (component 3), the proximity driver (component
 * 4), the whole `runtime/` orchestrator, the Three.js adapter, GLTF parsing,
 * the LRU, the orb pool, the transcript (component 2) and the spatialised audio
 * player (component 1). What is substituted: the framework's GPS anchoring —
 * `demo-walk.json` is already world-space, so an identity anchor factory places
 * waypoints directly, exactly as component 4's own demo does. A real
 * `GpsAnchor` needs an alignment matrix and a GPS zero reference that simply do
 * not exist outside an AR session; that path is proven on the phone in the
 * Goal-2 composition, once the onboarding gate (component 9) exists.
 *
 * The permission/enter-AR flow is deliberately NOT here — that is component 9's
 * job. The only gate is a Start button, because the browser will not start audio
 * without a user gesture (§2.5.7).
 */

import {
  AmbientLight,
  AudioListener,
  DirectionalLight,
  GridHelper,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { createViewingStore } from "../../store/viewing-store.js";
import { loadTour } from "../../store/tour-slice.js";
import type {
  AssetId,
  AssetProvider,
  Tour,
  TourCoord,
  Waypoint,
} from "../../store/types.js";
import { RefCountedAssetProvider } from "../cloud-loader/core/asset-provider.js";
import { createPlaybackLoop } from "../shared/playback-loop.js";
import { attachResize } from "../shared/resize.js";
import walk from "../proximity/demo-walk.json";
import { createTourScene } from "./runtime/tour-scene.js";
import {
  createThreeSceneAdapter,
  type SceneAnchor,
} from "./view/three-scene-adapter.js";
import { TRAIL_ORB_POOL_SIZE } from "./config.js";

const HYSTERESIS_FRACTION = 0.15; // contract D16 default
const SAMPLES_PER_SEC = 12;

// ── The walk ─────────────────────────────────────────────────────────────────
const path: Vector3[] = walk.path.map(([x, z]) => new Vector3(x, 0, z));

/**
 * The demo's geo↔world convention: a `TourCoord`'s `lat` is metres along X and
 * its `lon` metres along Z. That keeps the store contract honest (waypoints are
 * still persisted as coordinates) while letting the anchor factory be an
 * identity — no alignment matrix, no GPS zero reference.
 */
const asCoord = (v: Vector3): TourCoord => ({ lat: v.x, lon: v.z });
const toWorld = (coord: TourCoord): Vector3 =>
  new Vector3(coord.lat, 0, coord.lon);

// ── The tour ─────────────────────────────────────────────────────────────────
const ASSET_URLS: Readonly<Record<AssetId, string>> = {
  "asset-knight": "/ar-scene/knight.glb",
  "asset-banner": "/ar-scene/banner.png",
  "asset-story-1": "/ar-scene/story-1.wav",
  "asset-story-2": "/ar-scene/story-2.wav",
};

function waypointAt(
  id: string,
  point: Vector3,
  content: Waypoint["content"],
): Waypoint {
  return {
    id,
    position: asCoord(point),
    prefetchRadius: 25,
    activeRadius: 10,
    content,
  };
}

const at = (fraction: number): Vector3 =>
  path[Math.floor(path.length * fraction)]!;
const nearMiss = at(0.5).clone();
nearMiss.z += 17; // inside PREFETCH, outside ACTIVE — never appears, but loads

const tour: Tour = {
  id: "tour-demo",
  name: "Component 8 demo walk",
  description: "A real Task 1 walk replayed through the AR viewing scene.",
  assets: [
    { id: "asset-knight", type: "model", filename: "knight.glb" },
    { id: "asset-banner", type: "sprite", filename: "banner.png" },
    { id: "asset-story-1", type: "audio", filename: "story-1.wav" },
    { id: "asset-story-2", type: "audio", filename: "story-2.wav" },
  ],
  waypoints: [
    waypointAt("wp-knight", at(0.25), {
      model: "asset-knight",
      audio: "asset-story-1",
      transcript:
        "Sir Aldric held this gate for thirty winters. They say he never once " +
        "slept in the tower, preferring the cold stone of the wall itself.",
    }),
    waypointAt("wp-banner", at(0.7), {
      sprite: "asset-banner",
      audio: "asset-story-2",
      transcript: "The market banner flew here every spring until 1643.",
    }),
    waypointAt("wp-near-miss", nearMiss, { model: "asset-knight" }),
  ],
  breadcrumb: path.map(asCoord),
};

// ── Scene plumbing ───────────────────────────────────────────────────────────
const container = document.querySelector<HTMLDivElement>("#canvas-root")!;
const scene = new Scene();
const camera = new PerspectiveCamera(
  60,
  container.clientWidth / container.clientHeight,
  0.1,
  2000,
);
camera.position.set(0, 14, 18);
const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
container.appendChild(renderer.domElement);
attachResize(camera, renderer, container);

scene.add(new AmbientLight(0xffffff, 1.6));
const sun = new DirectionalLight(0xffffff, 1.2);
sun.position.set(12, 24, 8);
scene.add(sun);
scene.add(new GridHelper(400, 80, 0x2a3550, 0x1b2233));

/** Stands in for the framework's `arWorldGroup`. */
const arWorldGroup = new Group();
scene.add(arWorldGroup);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

/** The visitor: a marker that follows the recorded walk. */
const userMarker = new Mesh(
  new SphereGeometry(0.4, 16, 12),
  new MeshBasicMaterial({ color: 0x4f8cff }),
);
userMarker.position.copy(path[0]!);
scene.add(userMarker);

// ── Asset provider (real ref-counting, local fixtures) ───────────────────────
const counts = new Map<AssetId, number>();
const baseProvider = new RefCountedAssetProvider({
  loadAssetBlob: async (id: AssetId) => {
    const url = ASSET_URLS[id];
    if (url === undefined) throw new Error(`unknown asset ${id}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`${url}: HTTP ${String(response.status)}`);
    return response.blob();
  },
});
/** Thin counting wrapper so the HUD can show the balance invariant live. */
const assetProvider: AssetProvider = {
  async getAssetUrl(id: AssetId): Promise<string> {
    const url = await baseProvider.getAssetUrl(id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
    return url;
  },
  release(id: AssetId): void {
    counts.set(id, (counts.get(id) ?? 0) - 1);
    baseProvider.release(id);
  },
};

// ── The component under demo ─────────────────────────────────────────────────
const audioListener = new AudioListener();
camera.add(audioListener);

/** Identity anchor: `demo-walk.json` is already world-space (plan A23). */
const createAnchor = (
  object3D: Mesh | Group,
  coord: TourCoord,
): SceneAnchor => {
  object3D.position.copy(toWorld(coord));
  return {
    isFullyAnchored: true,
    setGpsPoint: (next) => object3D.position.copy(toWorld(next)),
    markMovedExternally: () => undefined,
    dispose: () => undefined,
  };
};

let sampleIndex = 0;
const store = createViewingStore();
const adapter = createThreeSceneAdapter({
  parent: arWorldGroup,
  camera,
  audioListener,
  createAnchor: (object3D, coord) => createAnchor(object3D as Group, coord),
  toWorld,
  getUserWorldPos: () => path[sampleIndex] ?? null,
  orbPoolSize: TRAIL_ORB_POOL_SIZE,
  domElement: renderer.domElement,
});

const status = document.querySelector<HTMLElement>("#status")!;
const tourScene = createTourScene({
  store,
  adapter,
  assetProvider,
  hysteresisFraction: HYSTERESIS_FRACTION,
  onAudioBlocked: () => {
    status.textContent = "Audio is blocked — press Start first.";
  },
  // The demo is a diagnosis tool: surface scene warnings where you can see them.
  // eslint-disable-next-line no-console
  log: (message) => console.warn(message),
});

store.dispatch(loadTour(tour));

// ── Playback + HUD ───────────────────────────────────────────────────────────
const scrub = document.querySelector<HTMLInputElement>("#scrub")!;
const playButton = document.querySelector<HTMLButtonElement>("#play")!;
const readout = document.querySelector<HTMLElement>("#readout")!;
scrub.max = String(path.length - 1);

const playback = createPlaybackLoop({
  length: path.length,
  samplesPerSec: SAMPLES_PER_SEC,
  onSeek: (index) => {
    sampleIndex = index;
    userMarker.position.copy(path[index]!);
    scrub.value = String(index);
    readout.textContent = `${String(index)} / ${String(path.length - 1)}`;
  },
  onPlayStateChange: (playing) => {
    playButton.textContent = playing ? "⏸ Pause" : "▶ Play";
  },
});
playButton.addEventListener("click", () => {
  // The click is the user gesture the Web Audio autoplay policy demands
  // (§2.5.7). Component 9's Start button will own this in the composed app.
  void audioListener.context.resume();
  playback.toggle();
});
scrub.addEventListener("input", () => {
  playback.seekTo(Number(scrub.value));
});

let lastTime = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  controls.update();
  tourScene.tick(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
