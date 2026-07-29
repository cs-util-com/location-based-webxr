/**
 * App shell: builds the store, the pipeline and the views, and wires them.
 *
 * DELIBERATELY THIN, AND NOW THINNER. Everything that can be wrong in an
 * interesting way lives in `demo-pipeline.ts` (data), `refresh-cycle.ts` (the
 * async cycle and its two failure kinds), `osm-store.ts` (shared state) and
 * `heat-colours.ts` (presentation of an unbounded quantity) — all pure, all
 * unit-tested. This file is DOM plumbing, and it is short on purpose: when the
 * demo misbehaves, the question should be answerable without reading it.
 *
 * WHAT CHANGED WITH THE STORE. The views used to be driven imperatively from one
 * `doRefresh`, in a fixed order, inside one `try`. They are now subscribers:
 * nothing here decides who draws first, and each view's failure is reported as
 * its own rather than as "the refresh failed" (see `refresh-cycle.ts`).
 *
 * WHAT THIS DEMO IS FOR — three questions no test suite can answer, and one it
 * can only answer on real data:
 *
 * 1. Is `AFFORDANCE_RES = 13` (4.09 m edge) the right grain? Too coarse and a
 *    footpath vanishes; too fine and the grid is noise.
 * 2. Are the unbounded scores practically thresholdable? See `heat-colours.ts`.
 * 3. Do regions land in the right PLACES? The arithmetic has been verified
 *    against the C# oracle; the geography has not.
 * 4. Does the mesh layer produce sane buildings from real footprints?
 *
 * @see main.ts.md
 */

import {
  CachingSource,
  MemoryBlobStore,
  OverpassSource,
  loadRuleTable,
} from "gps-plus-slam-osm";
import {
  OpfsOsmBlobStore,
  openOsmStoreDirectory,
} from "gps-plus-slam-app-framework/osm-bridge";

import { DemoPipeline, type DemoSnapshot } from "./demo-pipeline.js";
import { parseStartPosition } from "./start-position.js";
import { describeExtent } from "./fetch-extent.js";
import { MapView } from "./map-view.js";
import { LegendView } from "./legend-view.js";
import { BuildingView, type BuildingStats } from "./building-view.js";
import { createDemoStore, selectOsmView } from "./osm-store.js";
import { createRefreshCycle, renderSafely } from "./refresh-cycle.js";

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Missing #${id} in index.html`);
  return found as T;
};

/**
 * OPFS where available, memory otherwise.
 *
 * OPFS is the point — a cached res-7 tile is tens of MB and refetching it on
 * every reload would be an abuse of donated infrastructure. But the demo must
 * still run in a browser without it rather than refusing to start.
 */
async function makeStore() {
  try {
    const root = await navigator.storage.getDirectory();
    return new OpfsOsmBlobStore({
      directory: await openOsmStoreDirectory(root),
    });
  } catch {
    return new MemoryBlobStore();
  }
}

async function main(): Promise<void> {
  const status = el("status");
  const categorySelect = el<HTMLSelectElement>("category");

  status.textContent = "Loading the rule table…";
  const loaded = await loadRuleTable({});
  // Which TIER the table came from is worth showing: a demo silently running on
  // the checked-in snapshot looks identical to one running on the live sheet,
  // and they are different claims about what is being judged.
  const tableNote = `rules: ${loaded.tier}${loaded.degradedBecause === undefined ? "" : ` (${loaded.degradedBecause})`}`;

  for (const category of loaded.table.categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    categorySelect.append(option);
  }
  categorySelect.value = loaded.table.categories.includes("walkable")
    ? "walkable"
    : (loaded.table.categories[0] ?? "");

  const source = new CachingSource(
    new OverpassSource({
      userAgent: "gps-plus-slam-osm-demo (github.com/cs-util-com)",
    }),
    await makeStore(),
  );

  const pipeline = new DemoPipeline({ source, table: loaded.table });
  const start = parseStartPosition(window.location.search);
  const mapView = new MapView({ container: el("map"), centre: start });
  const buildingView = new BuildingView({ container: el("scene") });
  const legendView = new LegendView({ container: el("legend") });

  const { store, actions, subscribe } = createDemoStore({
    start,
    category: categorySelect.value,
  });
  const access = { store, actions };
  const refresh = createRefreshCycle({ store, actions, pipeline });

  // --- intent in ----------------------------------------------------------

  // Clicking the map moves the "user", which is how a walk is simulated without
  // a phone — and crossing a res-11 boundary is what exercises the chunk cache.
  mapView.map.on("click", (event: { latlng: { lat: number; lng: number } }) => {
    store.dispatch(
      actions.positionChanged({
        lat: event.latlng.lat,
        lng: event.latlng.lng,
      }),
    );
  });
  categorySelect.addEventListener("change", () => {
    store.dispatch(actions.categoryChanged(categorySelect.value));
  });

  // --- state out ----------------------------------------------------------

  /**
   * The last mesh build's counters, for the status line.
   *
   * Kept here rather than in the store because they are a property of the DRAW,
   * not of the data — the store holds what was scored, and a three.js triangle
   * count is not that.
   */
  let mesh: BuildingStats | undefined;

  function drawMap(snapshot: DemoSnapshot | undefined): void {
    const view = selectOsmView(store.getState());
    if (snapshot === undefined) {
      // A failed refresh must not leave the previous category's cells claiming
      // to be current. Clearing is the whole of W1 — and the legend goes with
      // them, because a legend without a map explains nothing.
      mapView.clear();
      legendView.clear();
      return;
    }
    const scale = mapView.render(
      snapshot.cells,
      snapshot.regions,
      view.category,
      snapshot.threshold,
    );
    // The red box: what Overpass was actually asked for, drawn so "one res-7
    // tile" stops being an abstraction. See `fetch-extent.ts` for why the box
    // and the hexagon differ and why that gap is worth showing.
    mapView.renderFetchTiles(snapshot.loadedTiles);
    // Rendered from the SAME scale the map just painted with, so the two cannot
    // drift — the one way a legend becomes an active lie.
    legendView.render(scale, view.category, view.showBelowThreshold);
  }

  function drawScene(snapshot: DemoSnapshot | undefined): void {
    if (snapshot === undefined) {
      buildingView.clearScene();
      mesh = undefined;
      return;
    }
    mesh = buildingView.render(pipeline.features().values(), snapshot.position);
  }

  function writeStatus(): void {
    const view = selectOsmView(store.getState());
    if (view.loading.phase !== "idle") {
      status.textContent =
        view.loading.phase === "error"
          ? `Failed: ${view.loading.message}`
          : view.loading.message;
      return;
    }
    const snapshot = view.snapshot;
    if (snapshot === undefined) {
      status.textContent = tableNote;
      return;
    }
    status.textContent = [
      `${snapshot.cells.length} cells`,
      `${snapshot.regions.length} ${view.category} regions`,
      `${snapshot.stats.chunksScored} chunks scored / ${snapshot.stats.chunksReused} reused`,
      mesh === undefined
        ? ""
        : `${mesh.volumes} volumes (${mesh.parts} parts, ${mesh.guessedHeights} guessed building heights)`,
      mesh === undefined ? "" : `${mesh.triangles} triangles`,
      describeExtent(snapshot.loadedTiles),
      tableNote,
      snapshot.missingTiles.length > 0
        ? `⚠ ${snapshot.missingTiles.length} tile(s) unavailable`
        : "",
    ]
      .filter((part) => part !== "")
      .join(" · ");
  }

  subscribe(
    (view) => view.snapshot,
    (snapshot) => {
      // Each view draws inside its own guard: a three.js failure must not blank
      // a correct map, and must not stop the next subscriber from running.
      renderSafely(access, "map", () => {
        drawMap(snapshot);
      });
      renderSafely(access, "3D view", () => {
        drawScene(snapshot);
      });
      writeStatus();
    },
  );

  subscribe(
    (view) => view.loading,
    () => {
      writeStatus();
    },
  );

  subscribe(
    (view) => view.position,
    (position) => {
      mapView.setPosition(position);
      void refresh();
    },
  );

  subscribe(
    (view) => view.category,
    () => {
      void refresh();
    },
  );

  await refresh();
}

void main();
