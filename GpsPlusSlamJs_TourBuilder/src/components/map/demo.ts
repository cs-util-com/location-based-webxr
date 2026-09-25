/**
 * Standalone demo for component 7 (TASK.md §2.3): replay a real Task 1 walk
 * and watch the position dot move + waypoint markers recolour on a plain 2D
 * Leaflet page — no Three.js. This composes components 3 (store) + 4
 * (proximity) + 7 (this map) for real: "visited" is driven by the real
 * proximity driver reaching ACTIVE, not a fake check (plan: final, not a
 * prototype).
 *
 * The walk's world-space path (`../proximity/demo-walk.json`) and its lat/lon
 * track (`./demo-track.json`) are both precomputed from the SAME recording's
 * `odometryPositions`, in the same order (`scripts/make-map-demo-track.mjs`),
 * so picking the same index into both arrays gives a self-consistent
 * world-space anchor (for proximity) and lat/lon anchor (for the map) with
 * zero runtime geo conversion needed in the browser.
 */

import "leaflet/dist/leaflet.css";
import { Vector3 } from "three";

import { buildMapData } from "gps-plus-slam-app-framework/visualization/map-data";
import {
  createProximityDriver,
  type ProximityObject,
} from "gps-plus-slam-app-framework/visualization";

import walk from "../proximity/demo-walk.json";
import trackData from "./demo-track.json";

import { createViewingStore } from "../../store/viewing-store.js";
import { loadTour } from "../../store/tour-slice.js";
import { initZones, setWaypointZone } from "../../store/zones-slice.js";
import { markWaypointVisited } from "../../store/tour-progress-slice.js";
import {
  selectNextUnvisitedWaypoint,
  selectOrderedWaypoints,
  selectVisitedWaypointIds,
} from "../../store/selectors.js";
import type { Tour, Waypoint } from "../../store/types.js";

import { computeMarkerViewModels } from "./core/map-marker-state.js";
import { createTourMap } from "./view/tour-map.js";
import { createPlaybackLoop } from "../shared/playback-loop.js";

const PREFETCH_R = 25;
const ACTIVE_R = 10;

const worldPath = walk.path as Array<[number, number]>;
const track = trackData.track as Array<[number, number]>;

// ── Synthesize 3 waypoints, index-aligned between world-space (proximity)
// and lat/lon (map) — see file header. ──────────────────────────────────────
const indices = [0.3, 0.6, 0.85].map((f) => Math.floor(worldPath.length * f));

interface DemoWaypoint {
  readonly waypoint: Waypoint;
  readonly proximityObject: ProximityObject;
}

const demoWaypoints: DemoWaypoint[] = indices.map((i, n) => {
  const id = `wp-${n + 1}`;
  const [x, z] = worldPath[i]!;
  const [lat, lon] = track[i]!;
  return {
    waypoint: {
      id,
      position: { lat, lon },
      prefetchRadius: PREFETCH_R,
      activeRadius: ACTIVE_R,
      content: {},
    },
    proximityObject: {
      id,
      position: new Vector3(x, 0, z),
      prefetchRadius: PREFETCH_R,
      activeRadius: ACTIVE_R,
    },
  };
});

const tour: Tour = {
  id: "tour-map-demo",
  name: "Map Demo Walk",
  description: "A real Task 1 recording replayed for the map demo.",
  assets: [],
  waypoints: demoWaypoints.map((d) => d.waypoint),
  breadcrumb: [],
};
const proximityObjects = demoWaypoints.map((d) => d.proximityObject);

// ── Store + proximity driver (real component 3 + component 4) ──────────────
const store = createViewingStore();
store.dispatch(loadTour(tour));
store.dispatch(initZones(tour.waypoints.map((w) => w.id)));

let currentWorldPos: Vector3 | null = null;
const driver = createProximityDriver({
  getUserWorldPos: () => currentWorldPos,
  getObjects: () => proximityObjects,
  getZones: () => store.getState().zones.byWaypointId,
  onTransition: (t) => {
    store.dispatch(setWaypointZone({ id: t.id, zone: t.to }));
    if (t.to === "ACTIVE") {
      store.dispatch(markWaypointVisited(t.id));
    }
  },
  config: { hysteresisFraction: 0.15 },
  movementEpsilonM: 0, // demo: re-evaluate every sample for a smooth marker readout
});

// ── Map (component 7) ────────────────────────────────────────────────────────
const mapContainer = document.getElementById("map") as HTMLElement;
const tourMap = createTourMap(mapContainer)!;
tourMap.show();

function refreshWaypointMarkers(): void {
  const state = store.getState();
  const models = computeMarkerViewModels(
    selectOrderedWaypoints(state),
    selectVisitedWaypointIds(state),
    selectNextUnvisitedWaypoint(state)?.id ?? null,
  );
  tourMap.setWaypoints(models);
}
refreshWaypointMarkers();

// ── Playback ──────────────────────────────────────────────────────────────────
const scrub = document.getElementById("scrub") as HTMLInputElement;
const playBtn = document.getElementById("play") as HTMLButtonElement;
const readout = document.getElementById("readout") as HTMLSpanElement;
const statusEl = document.getElementById("status") as HTMLPreElement;

scrub.max = String(track.length - 1);

function statusLine(): string {
  const state = store.getState();
  return tour.waypoints
    .map((w) => `${w.id}  ${state.zones.byWaypointId[w.id] ?? "IDLE"}`)
    .join("\n");
}

function seekTo(index: number): void {
  const [x, z] = worldPath[index]!;
  currentWorldPos = new Vector3(x, 0, z);
  driver.tick();

  const [lat, lon] = track[index]!;
  tourMap.setGpsPosition(lat, lon);
  tourMap.render(buildMapData({ userPosition: { lat, lng: lon } }));
  refreshWaypointMarkers();

  readout.textContent = `${index} / ${track.length - 1}`;
  scrub.value = String(index);
  statusEl.textContent = statusLine();
}

const loop = createPlaybackLoop({
  length: track.length,
  samplesPerSec: 20,
  onSeek: seekTo,
  onPlayStateChange: (playing) => {
    playBtn.textContent = playing ? "❚❚ Pause" : "▶ Play";
  },
});
playBtn.addEventListener("click", () => loop.toggle());
scrub.addEventListener("input", () => {
  driver.reset();
  loop.seekTo(Number(scrub.value));
});
seekTo(0);
