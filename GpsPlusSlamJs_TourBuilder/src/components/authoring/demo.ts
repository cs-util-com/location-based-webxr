/**
 * Standalone demo for component 10 (TASK.md §2.3): drop waypoints with
 * attached assets while a live GPS position moves, then export a real
 * `tour.zip` via component 5's already-approved `packTour`.
 *
 * Mirrors the composed app's authoring screen (`src/app/authoring/
 * authoring-app.ts`) as closely as a standalone demo can — same full-bleed
 * interactive map (drag a marker, or click an empty spot, to place a
 * waypoint), same GPS badge, same live-GPS-only position source, same
 * `mountAuthoringView` panel. What it deliberately leaves out is Goal-2
 * composition, not component 10's own scope: no onboarding gate, no
 * durable draft persistence/resume, no wake-lock, no share panel — those
 * belong to `authoring-app.ts`, not this component's demo.
 */

import "leaflet/dist/leaflet.css";

import { buildMapData } from "gps-plus-slam-app-framework/visualization/map-data";
import { downloadZip } from "gps-plus-slam-app-framework/storage";

import {
  authoringReducer,
  updateWaypoint,
} from "../../store/authoring-slice.js";
import type { AuthoringSliceState } from "../../store/authoring-slice.js";
import { packTour } from "../packaging/core/pack-tour.js";
import { computeMarkerViewModels } from "../map/core/map-marker-state.js";
import { createTourMap } from "../map/view/tour-map.js";
import { createAuthoringSession } from "./view/authoring-session.js";
import { createFilesAssetProvider } from "./view/files-asset-provider.js";
import { createLiveGpsPositionSource } from "./view/gps-position-source.js";
import { mountAuthoringView } from "./view/authoring-view.js";
import type { TourCoord } from "../../store/types.js";

const el = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const authoringRoot = el<HTMLDivElement>("authoring-root");
const mapHost = el<HTMLDivElement>("map-host");
const gpsBadge = el<HTMLDivElement>("gps-badge");

// ── A minimal hand-rolled store over the real authoringReducer (same spirit
// as components 1/4's own dispatch loops — no full Redux store needed for a
// standalone demo). ──────────────────────────────────────────────────────
let authoringState: AuthoringSliceState = authoringReducer(undefined, {
  type: "@@INIT",
});
const listeners = new Set<() => void>();
function dispatch(action: Parameters<typeof authoringReducer>[1]): void {
  authoringState = authoringReducer(authoringState, action);
  for (const l of listeners) l();
}
const store = {
  getState: () => ({ authoring: authoringState }),
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  dispatch,
};

// ── Map (component 7) — full-bleed and interactive, exactly like the real
// app's authoring screen: drag a marker to fine-tune its position, or click
// an empty spot to drop one exactly there, alongside walking to the spot
// and pressing Drop Waypoint. ──────────────────────────────────────────────
const tourMap = createTourMap(mapHost, {
  interactive: true,
  onWaypointDragEnd: (id, lat, lon) => {
    dispatch(updateWaypoint({ id, changes: { position: { lat, lon } } }));
  },
  onDropWaypointHere: (lat, lon) => {
    const id = session.dropWaypoint({ lat, lon });
    if (id !== null) authoringView.focusWaypoint(id);
  },
  getObscuredBottomPx: () =>
    window.innerWidth > 720 ? 0 : authoringRoot.getBoundingClientRect().height,
})!;
tourMap.show();

function refreshMapWaypoints(): void {
  tourMap.setWaypoints(
    computeMarkerViewModels(authoringState.waypoints, [], null),
  );
}
listeners.add(refreshMapWaypoints);
refreshMapWaypoints();

// AC13 (authoring-app.ts): explicit waiting state until the first live GPS
// fix arrives — Drop Waypoint has nothing to drop at until then.
let hasGpsFix = false;
function updateMapPosition(pos: TourCoord): void {
  if (!hasGpsFix) {
    hasGpsFix = true;
    gpsBadge.className = "map-badge map-badge-live";
    gpsBadge.textContent = "Live";
  }
  tourMap.setGpsPosition(pos.lat, pos.lon);
  tourMap.render(
    buildMapData({ userPosition: { lat: pos.lat, lng: pos.lon } }),
  );
}

const positionSource = createLiveGpsPositionSource();
const withMapSync = {
  subscribe(onPosition: (pos: TourCoord) => void) {
    return positionSource.subscribe((pos) => {
      updateMapPosition(pos);
      onPosition(pos);
    });
  },
};

const filesAssetProvider = createFilesAssetProvider();
const session = createAuthoringSession({
  positionSource: withMapSync,
  dispatch,
  getState: store.getState,
  filesAssetProvider,
});

const authoringView = mountAuthoringView(authoringRoot, {
  session,
  subscribe: store.subscribe,
  getState: store.getState,
  dispatch,
  packAndDownload: async (tour, assetFiles) => {
    const blob = await packTour(tour, new Map(assetFiles));
    // downloadZip resolves `false` (never throws) on a dismissed save
    // dialog — turn that into a rejection so the view's own error handling
    // treats a cancel like any other failure instead of reporting success.
    const saved = await downloadZip(blob, "tour.zip");
    if (!saved) throw new Error("Download cancelled.");
  },
  onExport: () => {
    // No share panel here (that's Goal-2 composition, authoring-app.ts's
    // job) — the view's own status line already reports the export.
  },
});
