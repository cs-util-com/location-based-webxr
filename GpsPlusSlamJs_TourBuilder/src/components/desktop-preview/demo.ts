/**
 * Standalone demo for component 11 — the desktop preview.
 *
 * A tour written in real lat/lon, walked on a desktop with no phone, no GPS
 * and no WebXR: the preview session supplies the world (camera, world group,
 * frame loop, pinned frame) and component 8's real scene runs inside it, so
 * proximity, asset loading, the transcript and the spatialised audio are all
 * the production code paths.
 *
 * Verify: click anywhere (or press a key) to unblock audio, then walk with
 * W A S D (shift to run), drag to look around; the knight appears as you
 * come within its active radius and its story plays; clicking it toggles
 * playback. The HUD's Auto-walk button follows the breadcrumb by itself,
 * Buildings toggles the real OSM building layer, and Map toggles the
 * floating 2D overview (component 7), tracking position and visited stops.
 */

import { AudioListener } from "three";
import "leaflet/dist/leaflet.css";

import { buildMapData } from "gps-plus-slam-app-framework/visualization/map-data";

import { createViewingStore } from "../../store/viewing-store.js";
import { loadTour } from "../../store/tour-slice.js";
import {
  selectOrderedWaypoints,
  selectNextUnvisitedWaypoint,
  selectVisitedWaypointIds,
} from "../../store/selectors.js";
import type { AssetId, AssetProvider, Tour } from "../../store/types.js";
import { RefCountedAssetProvider } from "../cloud-loader/core/asset-provider.js";
import { createTourScene } from "../ar-scene/runtime/tour-scene.js";
import { createThreeSceneAdapter } from "../ar-scene/view/three-scene-adapter.js";
import { TRAIL_ORB_POOL_SIZE } from "../ar-scene/config.js";
import { applyMapVisibility, createTourMap } from "../map/view/tour-map.js";
import { computeMarkerViewModels } from "../map/core/map-marker-state.js";
import { mountHud } from "../shared/hud.js";
import type { Hud } from "../shared/hud.js";
import { computePreviewStart } from "./core/preview-start.js";
import { createPreviewSession } from "./view/preview-session.js";

const HYSTERESIS_FRACTION = 0.15; // contract D16 default

const ASSET_URLS: Readonly<Record<AssetId, string>> = {
  "asset-knight": "/ar-scene/knight.glb",
  "asset-banner": "/ar-scene/banner.png",
  "asset-story-1": "/ar-scene/story-1.wav",
  "asset-story-2": "/ar-scene/story-2.wav",
};

/** A short walk north from a trailhead, with a stop on either side of it. */
const TRAILHEAD = { lat: 48.137, lon: 11.575 };
const metresNorth = (m: number): number => TRAILHEAD.lat + m / 111_320;
const metresEast = (m: number): number =>
  TRAILHEAD.lon + m / (111_320 * Math.cos((TRAILHEAD.lat * Math.PI) / 180));

const tour: Tour = {
  id: "tour-preview-demo",
  name: "Preview demo walk",
  description: "Two stops, walked on a desktop.",
  assets: [
    { id: "asset-knight", type: "model", filename: "knight.glb" },
    { id: "asset-banner", type: "sprite", filename: "banner.png" },
    { id: "asset-story-1", type: "audio", filename: "story-1.wav" },
    { id: "asset-story-2", type: "audio", filename: "story-2.wav" },
  ],
  waypoints: [
    {
      id: "wp-knight",
      position: { lat: metresNorth(35), lon: TRAILHEAD.lon },
      prefetchRadius: 40,
      activeRadius: 12,
      content: {
        model: "asset-knight",
        audio: "asset-story-1",
        transcript:
          "Sir Aldric held this gate for thirty winters, and never once slept " +
          "in the tower.",
      },
    },
    {
      id: "wp-banner",
      position: { lat: metresNorth(70), lon: metresEast(25) },
      prefetchRadius: 40,
      activeRadius: 12,
      content: {
        sprite: "asset-banner",
        audio: "asset-story-2",
        transcript: "The market banner flew here every spring until 1643.",
      },
    },
  ],
  breadcrumb: [
    TRAILHEAD,
    { lat: metresNorth(35), lon: TRAILHEAD.lon },
    { lat: metresNorth(70), lon: metresEast(25) },
  ],
};

const container = document.querySelector<HTMLDivElement>("#canvas-root")!;

/**
 * A touch-primary device (no physical keyboard/mouse) — the desktop
 * preview's manual walk needs both, so this decides which status hint to
 * show. `maxTouchPoints` alone would also match a touch-enabled laptop that
 * still has a keyboard; requiring "no hover" too excludes that case.
 * Mirrors `viewing-app.ts`'s `isTouchPrimaryDevice` — kept local since a
 * component may not import from `src/app/`.
 */
function isTouchPrimaryDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  if (navigator.maxTouchPoints <= 0) return false;
  if (typeof globalThis.matchMedia !== "function") return true;
  return !globalThis.matchMedia("(hover: hover)").matches;
}

const assetProvider: AssetProvider = new RefCountedAssetProvider({
  loadAssetBlob: async (id: AssetId) => {
    const url = ASSET_URLS[id];
    if (url === undefined) throw new Error(`unknown asset ${id}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`${url}: HTTP ${String(response.status)}`);
    return response.blob();
  },
});

// Creating the store activates gps-plus-slam-js's license; must happen
// before any call into its math (computePreviewStart -> toWorld).
const store = createViewingStore();

// Forward-declared: the map's onTileError and the session's onPositionChange
// both close over `hud`/`map` before either is actually mounted below —
// mirrors viewing-app.ts's own module-scope `let hud`/`let map`.
let hud: Hud | null = null;

// Attached to the DOM BEFORE `createTourMap` — Leaflet measures the
// container's real box at construction, and a detached (0×0) element leaves
// its view permanently wrong even after a later `resize()`/`invalidateSize()`.
// Mirrors `viewing-app.ts`'s own comment: "mapHost is now parented at its
// final layout position — only now does Leaflet's size measurement give a
// real box."
const mapHost = document.createElement("div");
mapHost.className = "map-card";
container.appendChild(mapHost);
const map = createTourMap(mapHost, {
  onTileError: () => {
    hud?.showNotice(
      "Map tiles are unavailable offline — stops and your position still work.",
    );
  },
});
let mapVisible = true;

function setMapVisible(visible: boolean): void {
  mapVisible = visible;
  applyMapVisibility(map, visible);
  hud?.setMapActive(visible);
}

function refreshMapMarkers(): void {
  const state = store.getState();
  map?.setWaypoints(
    computeMarkerViewModels(
      selectOrderedWaypoints(state),
      [...selectVisitedWaypointIds(state)],
      selectNextUnvisitedWaypoint(state)?.id ?? null,
    ),
  );
}

const { origin, start, route } = computePreviewStart(tour);
const session = createPreviewSession({
  container,
  origin,
  start,
  route,
  onPositionChange: (position) => {
    map?.setGpsPosition(position.lat, position.lon);
    map?.render(
      buildMapData({ userPosition: { lat: position.lat, lng: position.lon } }),
    );
  },
});

const camera = session.runtime.getCamera()!;
const audioListener = new AudioListener();
camera.add(audioListener);

// The same control bar the composed app mounts (component 11's own scope,
// per plans/2026-09-17-osm-buildings-ui-plan.md, only excluded the
// end-tour concept this single-page demo has no use for).
let wayfindingEnabled = false;
hud = mountHud(container, {
  onToggleMap: () => setMapVisible(!mapVisible),
  onToggleAutopilot: () => {
    const next = !session.isAutopilot();
    session.setAutopilot(next);
    hud?.setAutopilotActive(next);
    hud?.dismissAutopilotHint();
  },
  onToggleOsmBuildings: () => {
    const buildingStatus = session.getOsmBuildingsStatus();
    session.setOsmBuildingsEnabled(
      buildingStatus === "off" || buildingStatus === "failed",
    );
  },
  onToggleWayfinding: () => {
    wayfindingEnabled = !wayfindingEnabled;
    tourScene.setWayfindingEnabled(wayfindingEnabled);
    hud?.setWayfindingActive(wayfindingEnabled);
    hud?.dismissWayfindingHint();
  },
});
session.onOsmBuildingsStatusChange((buildingStatus) => {
  hud?.setOsmBuildingsStatus(buildingStatus);
});
hud.setOsmBuildingsStatus(session.getOsmBuildingsStatus());

// mapHost was already attached (above, before `createTourMap`) — just
// unhide it now that the rest of the session furniture exists.
setMapVisible(true);

const adapter = createThreeSceneAdapter({
  parent: session.runtime.getArWorldGroup()!,
  camera,
  audioListener,
  createAnchor: (object3D, coord) =>
    session.seams.createAnchor(object3D, coord),
  toWorld: (coord) => session.seams.toWorld(coord),
  getUserWorldPos: () => session.seams.getUserWorldPos(),
  orbPoolSize: TRAIL_ORB_POOL_SIZE,
  domElement: session.domElement,
});

const tourScene = createTourScene({
  store,
  adapter,
  assetProvider,
  hysteresisFraction: HYSTERESIS_FRACTION,
  onAudioBlocked: () => {
    hud?.showNotice("Audio is blocked — click the scene or press a key.");
  },
  // The demo is a diagnosis tool: surface scene warnings where you can see them.
  // eslint-disable-next-line no-console
  log: (message) => console.warn(message),
});

store.dispatch(loadTour(tour));
refreshMapMarkers();
let lastVisited = selectVisitedWaypointIds(store.getState());
store.subscribe(() => {
  const visited = selectVisitedWaypointIds(store.getState());
  if (visited === lastVisited) return;
  lastVisited = visited;
  refreshMapMarkers();
});

session.runtime.registerFrameUpdate((dt) => {
  tourScene.tick(dt);
});

// The composed app gets its Web Audio autoplay-unlock gesture (§2.5.7) from
// the onboarding gate; this single-page demo has none, so the first click or
// keypress anywhere stands in for it.
function unlockAudio(): void {
  void audioListener.context.resume();
  window.removeEventListener("pointerdown", unlockAudio);
  window.removeEventListener("keydown", unlockAudio);
}
window.addEventListener("pointerdown", unlockAudio);
window.addEventListener("keydown", unlockAudio);

// Exact copy the composed app's own desktop preview shows (viewing-app.ts's
// `enterPreview`), so the two render identically.
hud.setStatus(
  isTouchPrimaryDevice()
    ? "Preview — drag to look around, tap a stop to hear it. Tap Auto-walk below to walk the route."
    : "Preview — walk with W A S D, drag to look around, click a stop to hear it.",
);
