/**
 * Standalone demo for Component 3 — the store contract, no Three.js.
 *
 * Builds the two real store factories (`createViewingStore` /
 * `createAuthoringStore`) in the browser — which also smoke-proves they
 * construct through the framework — and wires a button per action. Each panel
 * re-renders its app slices as formatted JSON on every dispatch via
 * `store.subscribe()`. The framework base slices are intentionally hidden to
 * keep the state readable.
 */

import { createViewingStore } from "../../store/viewing-store.js";
import { createAuthoringStore } from "../../store/authoring-store.js";
import { sampleTour } from "../../store/fixtures/sample-tour.js";
import { loadTour, clearTour } from "../../store/tour-slice.js";
import { markWaypointVisited } from "../../store/tour-progress-slice.js";
import { initZones, setWaypointZone } from "../../store/zones-slice.js";
import {
  setTourMeta,
  addWaypoint,
  attachAsset,
  addBreadcrumbPoint,
  clearAuthoring,
} from "../../store/authoring-slice.js";
import type { ViewingRootState } from "../../store/viewing-store.js";
import type { AuthoringRootState } from "../../store/authoring-store.js";

const viewing = createViewingStore();
const authoring = createAuthoringStore();

const waypointIds = sampleTour.waypoints.map((w) => w.id);
let nextAuthorWp = 1;

interface Action {
  readonly label: string;
  readonly run: () => void;
}

const viewingActions: readonly Action[] = [
  {
    label: "Load sample tour",
    run: () => {
      viewing.dispatch(loadTour(sampleTour));
      viewing.dispatch(initZones(waypointIds));
    },
  },
  { label: "Clear tour", run: () => viewing.dispatch(clearTour()) },
  ...waypointIds.map((id) => ({
    label: `Visit ${id}`,
    run: () => viewing.dispatch(markWaypointVisited(id)),
  })),
  {
    label: "wp-1 → PREFETCHING",
    run: () =>
      viewing.dispatch(setWaypointZone({ id: "wp-1", zone: "PREFETCHING" })),
  },
  {
    label: "wp-1 → ACTIVE",
    run: () =>
      viewing.dispatch(setWaypointZone({ id: "wp-1", zone: "ACTIVE" })),
  },
  {
    label: "wp-1 → IDLE",
    run: () => viewing.dispatch(setWaypointZone({ id: "wp-1", zone: "IDLE" })),
  },
];

const authoringActions: readonly Action[] = [
  {
    label: "Set meta",
    run: () =>
      authoring.dispatch(
        setTourMeta({
          name: "My New Tour",
          description: "Drafted in the demo.",
        }),
      ),
  },
  {
    label: "Add waypoint",
    run: () => {
      const id = `wp-${nextAuthorWp++}`;
      authoring.dispatch(
        addWaypoint({
          id,
          position: { lat: 52.516 + nextAuthorWp * 1e-4, lon: 13.377 },
        }),
      );
    },
  },
  {
    label: "Attach sprite → last waypoint",
    run: () => {
      const last = authoring.getState().authoring.waypoints.at(-1);
      if (!last) return;
      authoring.dispatch(
        attachAsset({
          waypointId: last.id,
          slot: "sprite",
          asset: {
            id: `asset-${last.id}`,
            type: "sprite",
            filename: `assets/asset-${last.id}.png`,
          },
        }),
      );
    },
  },
  {
    label: "Add breadcrumb point",
    run: () =>
      authoring.dispatch(
        addBreadcrumbPoint({ lat: 52.516 + Math.random() * 1e-3, lon: 13.378 }),
      ),
  },
  { label: "Clear authoring", run: () => authoring.dispatch(clearAuthoring()) },
];

function renderButtons(hostId: string, actions: readonly Action[]): void {
  const host = document.getElementById(hostId);
  if (!host) return;
  for (const action of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = action.label;
    btn.addEventListener("click", action.run);
    host.appendChild(btn);
  }
}

function renderViewing(): void {
  const el = document.getElementById("viewing-state");
  if (!el) return;
  const s = viewing.getState() as ViewingRootState;
  el.textContent = JSON.stringify(
    { tour: s.tour, tourProgress: s.tourProgress, zones: s.zones },
    null,
    2,
  );
}

function renderAuthoring(): void {
  const el = document.getElementById("authoring-state");
  if (!el) return;
  const s = authoring.getState() as AuthoringRootState;
  el.textContent = JSON.stringify({ authoring: s.authoring }, null, 2);
}

renderButtons("viewing-buttons", viewingActions);
renderButtons("authoring-buttons", authoringActions);
viewing.subscribe(renderViewing);
authoring.subscribe(renderAuthoring);
renderViewing();
renderAuthoring();
