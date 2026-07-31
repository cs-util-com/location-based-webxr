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

import { TERRARIUM_ATTRIBUTION } from "gps-plus-slam-osm";

import { type DemoSnapshot } from "./demo-pipeline.js";
import { parseStartPosition } from "./start-position.js";
import { describeDrawCost } from "./draw-cost.js";
import { describeExtent } from "./fetch-extent.js";
import { MapView } from "./map-view.js";
import { LegendView } from "./legend-view.js";
import { DetailsPanel } from "./details-panel.js";
import { LocateControl } from "./locate-control.js";
import { attachSheetDrag } from "./sheet-drag.js";
import { EMPTY_CELL_MESH } from "./cell-mesh.js";
import { createCellMeshCycle } from "./cell-mesh-cycle.js";
import {
  heightfieldFrom,
  TERRAIN_EXTENT_M,
  type Heightfield,
} from "./heightfield.js";
import { createTerrainCycle } from "./terrain-cycle.js";
import { heatColour, heatScale } from "./heat-colours.js";
import {
  BuildingView,
  TERRAIN_SPACING_M,
  type BuildingStats,
} from "./building-view.js";
import { attachHeaderCollapse } from "./header-collapse.js";
import { createExplainCycle } from "./explain-cycle.js";
import {
  GROUND_MODES,
  groundDebugAvailable,
  groundModeLabel,
  parseGroundMode,
} from "./ground-mode.js";
import { attachLayerToggles } from "./layer-toggles.js";
import { attachSitePicker } from "./site-picker.js";
import { isLayerEnabled } from "./layers.js";
import { meshLayerSelection, wantsAnyMeshLayer } from "./mesh-layers.js";
import { createDemoStore, selectLayers, selectOsmView } from "./osm-store.js";
import { createRefreshCycle, renderSafely } from "./refresh-cycle.js";
import type { TransferableMesh } from "./worker/protocol.js";
import { createRpcClient, workerTransport } from "./worker/rpc-client.js";

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Missing #${id} in index.html`);
  return found as T;
};

/**
 * The worker, and everything expensive with it.
 *
 * `new URL(..., import.meta.url)` is the form Vite understands natively, so this
 * adds no bundler configuration. The data source, the OPFS tile store, the rule
 * table, the affordance index, the mesh build and the DEM sampling all live on
 * the other side of it now — see `worker/demo-worker.ts` for why each one had to
 * move, and note that OPFS is available in workers (with better APIs than on the
 * main thread), so the tile cache moved with the fetching rather than staying
 * behind.
 */
function createWorkerClient(onFatal: (message: string) => void) {
  return createRpcClient(
    workerTransport(
      new Worker(new URL("./worker/demo-worker.ts", import.meta.url), {
        type: "module",
      }),
      onFatal,
    ),
  );
}

async function main(): Promise<void> {
  const status = el("status");
  const categorySelect = el<HTMLSelectElement>("category");
  const showBelow = el<HTMLInputElement>("show-below");

  status.textContent = "Loading the rule table…";

  /**
   * Where a worker-level failure goes.
   *
   * Indirected through a mutable holder because the worker has to exist before
   * the store does — the store's initial category comes from the rule table,
   * which the worker loads. Until the store exists the status line is the only
   * channel there is; afterwards it becomes `fetchFailed`, because a dead worker
   * means no data at all and anything still drawn is a claim nothing supports.
   */
  let reportFatal = (message: string): void => {
    status.textContent = `Failed: ${message}`;
  };
  const worker = createWorkerClient((message) => {
    // BOTH, and both are needed. `worker.fail` rejects every call already in
    // flight — a dead worker replies to nothing, so without it `latestOnly` never
    // settles, its `busy` stays true, and every cycle chaining off it stops running
    // (raised in review on #228). `reportFatal` is what the user sees.
    worker.fail(message);
    reportFatal(message);
  });
  // The rule table is loaded INSIDE the worker, so what comes back is only what
  // the UI needs: the category list for the picker and the provenance tier. The
  // table itself stays over there, next to the scorer and `explainCell`, which
  // are the only things that read it.
  const loaded = await worker.call("init", {});
  // Which TIER the table came from is worth showing: a demo silently running on
  // the checked-in snapshot looks identical to one running on the live sheet,
  // and they are different claims about what is being judged.
  const tableNote = `rules: ${loaded.tier}${loaded.degradedBecause === undefined ? "" : ` (${loaded.degradedBecause})`}`;

  for (const category of loaded.categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    categorySelect.append(option);
  }
  categorySelect.value = loaded.categories.includes("walkable")
    ? "walkable"
    : (loaded.categories[0] ?? "");

  const start = parseStartPosition(window.location.search);

  const { store, actions, subscribe } = createDemoStore({
    start,
    category: categorySelect.value,
  });
  reportFatal = (message) => {
    store.dispatch(actions.fetchFailed(`the worker failed: ${message}`));
  };

  const mapView = new MapView({
    container: el("map"),
    centre: start,
    // The map reports a selection; it does not know the panel exists.
    onCellClick: (cell) => store.dispatch(actions.cellSelected(cell)),
  });
  const buildingView = new BuildingView({
    container: el("scene"),
    // A cell selection dispatches the SAME action a 2D cell click does: the panel
    // does not know, and must not know, which view the selection came from. A POI
    // selection is a different kind of answer and gets its own action (W12).
    onPick: (picked) => {
      if (picked.kind === "cell") {
        store.dispatch(actions.cellSelected(picked.cell));
      } else {
        store.dispatch(actions.featureSelected(picked.marker));
      }
    },
  });
  // THE GROUND PICKER (W11, DEC-R3-3). Three exclusive states rather than W23's
  // checkbox: the CPU path, the GPU path, and none at all — the last of which is
  // what makes the OSM ground areas inspectable on their own, since `plates`
  // stays an ordinary layer. Options come from `GROUND_MODES`, so the picker
  // cannot drift from the union.
  const groundPicker = el<HTMLSelectElement>("ground-mode");
  for (const mode of GROUND_MODES) {
    const option = document.createElement("option");
    option.value = mode;
    option.textContent = groundModeLabel(mode);
    groundPicker.append(option);
  }
  groundPicker.addEventListener("change", () => {
    store.dispatch(actions.groundModeChanged(groundPicker.value));
  });

  // THE PERF PANELS (W14, DEC-R3-18). Its own switch rather than a layer — it
  // draws nothing in the scene — and off by default, so the demo's default
  // picture is unchanged. A switch rather than a URL parameter because the
  // comparison it exists for happens on the phone, where a query string is
  // unusable. Local rather than in the store: nothing else has to agree about
  // it, unlike the ground mode, which the layer switches also read.
  const perfToggle = el<HTMLInputElement>("perf-stats");
  perfToggle.addEventListener("change", () => {
    buildingView.setPerfOverlay(perfToggle.checked);
  });

  const legendView = new LegendView({ container: el("legend") });
  const detailsPanel = new DetailsPanel({
    container: el("details"),
    onClose: () => store.dispatch(actions.cellSelected(undefined)),
  });

  // THE EXAMPLE-LOCATION PICKER (W5, DEC-R4-11). Choosing a site is the same
  // intent as clicking the map or pressing locate — "the user is here" — so all
  // three go through ONE action and there is no second refresh path to disagree
  // with the first. It recentres the map for the same reason the locate path
  // does: this is a request to GO somewhere, unlike a map click, which already
  // happens where the user is looking.
  attachSitePicker({
    select: el<HTMLSelectElement>("site"),
    onChoose: (position) => {
      mapView.centreOn(position);
      store.dispatch(actions.positionChanged(position));
    },
  });

  new LocateControl({
    map: mapView.map,
    // A real fix moves the "user" through the same action a map click uses, so
    // there is no second refresh path that could disagree with the first.
    onLocated: (position) => {
      // Recentre on the LOCATE path only. The shared `view.position` subscriber
      // deliberately does not, because a map click already happens where the
      // user is looking and recentring there would yank the map from under
      // them. A fix is usually somewhere else entirely, and at zoom 18 that
      // means off screen.
      mapView.centreOn(position);
      store.dispatch(actions.positionChanged(position));
    },
    // `nonFatalError` rather than `fetchFailed` because the BEHAVIOUR is what
    // matters here: a refused GPS permission says nothing about the data on
    // screen, so it must report without blanking the map. The action's name is
    // narrower than its meaning ("an error that preserves the snapshot") —
    // recorded as a follow-up rather than renamed mid-round, since it is a
    // published framework API.
    onError: (message) => store.dispatch(actions.nonFatalError(message)),
  });

  // Dragging the map sheet is mobile-only in CSS, but wiring it unconditionally
  // costs three listeners on an element that is `display: none` on desktop —
  // cheaper than a breakpoint check here that could disagree with the one in
  // the stylesheet.
  attachSheetDrag({
    handle: el("sheet-handle"),
    bounds: el("sheet-handle").parentElement ?? document.body,
    onResize: () => {
      // Both canvases size themselves from their container, and neither notices
      // a container that changed without a window resize.
      mapView.map.invalidateSize();
      buildingView.resize();
    },
  });

  // Collapsing hands the header's height back to the 3D view (it is a grid ROW,
  // not an overlay — see `header-collapse.ts`), so both canvases have to be
  // resized and the 3D one repainted. `BuildingView.resize()` schedules its own
  // frame since finding R2-3, so calling it is enough.
  const headerCollapse = attachHeaderCollapse({
    header: el("header-bar"),
    toggle: el("header-toggle"),
    onToggle: () => {
      mapView.map.invalidateSize();
      buildingView.resize();
    },
  });

  const access = { store, actions };
  const refresh = createRefreshCycle({
    store,
    actions,
    worker,
    // A pass either rebuilds the geometry or re-sends only the region slabs
    // (W6). The slabs are the one layer a widening ring changes; everything else
    // depends on the features, the terrain and the frame origin, none of which a
    // wider radius touches.
    //
    // MERGED INTO THE HELD MESH rather than replacing it, and the guard matters:
    // a regions-only reply with no mesh behind it can only happen if the worker
    // decided nothing changed since a full build this side never received, which
    // would be a protocol bug. Dropping the update is the safe reading — the next
    // full build repairs it — and drawing slabs over no city is not.
    onMesh: (built) => {
      if (built.kind === "full") {
        latestMesh = built.mesh;
        return;
      }
      if (latestMesh === undefined) return;
      latestMesh = { ...latestMesh, regions: built.regions };
    },
  });

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
  showBelow.addEventListener("change", () => {
    store.dispatch(actions.showBelowThresholdChanged(showBelow.checked));
  });
  // The switches report a whole next set; `toggleLayer` is the only thing that
  // knows how to build a valid one (see `osm-view-slice.ts` for why the action
  // replaces the set rather than patching one layer).
  const layerToggles = attachLayerToggles({
    container: el("layers"),
    onChange: (next) => store.dispatch(actions.layersChanged(next)),
    // The perf panel is a diagnostic and belongs beside the height ramp, but it
    // draws nothing in the scene so it is deliberately not a layer (W15,
    // DEC-R3-18). Handing the element over puts it in the right group without a
    // second registry or DOM moved after the fact.
    extras: { diagnostics: [el("perf-stats-label")] },
  });
  layerToggles.render(selectLayers(store.getState()));

  // --- state out ----------------------------------------------------------

  /**
   * The last mesh build's counters, for the status line.
   *
   * Kept here rather than in the store because they are a property of the DRAW,
   * not of the data — the store holds what was scored, and a three.js triangle
   * count is not that.
   */
  let mesh: BuildingStats | undefined;

  /**
   * The most recent geometry the worker built, awaiting a draw.
   *
   * Not in the store: it is `Float32Array` vertex data, which RTK's
   * serialisability scan rejects and devtools would try to serialise on every
   * action. Set by the refresh cycle immediately BEFORE `snapshotReady` is
   * dispatched, so the 3D view's snapshot subscriber never draws a snapshot
   * against the previous position's buildings.
   */
  let latestMesh: TransferableMesh | undefined;

  /**
   * Terrain under the current position, or `undefined` while it is flat.
   *
   * Loaded once per position rather than per render: the DEM does not change
   * when the category does, and re-fetching it on every category switch would
   * be tiles requested for ground that has not moved.
   */
  let terrain: Heightfield | undefined;
  let terrainNote = "";

  // Coalesced, exactly like `refresh` — the two are driven by the same click and
  // must agree about which position is current. See `terrain-cycle.ts` for the
  // interleaving that made an older heightfield win.
  //
  // The SAMPLING happens in the worker; what comes back is `HeightfieldData`, and
  // `heightfieldFrom` rebuilds the synchronous sampler here. The worker keeps its
  // own copy because the mesh build needs it — one owner per side, and the same
  // numbers on both, so the surface the buildings stand on cannot disagree with
  // the surface the ground plane draws.
  const loadTerrain = createTerrainCycle({
    worker,
    extentM: TERRAIN_EXTENT_M,
    spacingM: TERRAIN_SPACING_M,
    apply: ({ field, note }) => {
      terrain = field === undefined ? undefined : heightfieldFrom(field);
      terrainNote = note;
      buildingView.setTerrain(terrain);
      // Attribution is REQUIRED wherever the data is shown, the same as the OSM
      // one — and only shown while the data is actually in use, because
      // crediting a source whose tiles all failed would be a claim about what
      // is on screen.
      //
      // INTO LEAFLET S ATTRIBUTION CONTROL, not the header (DEC-R2-4). The
      // header is collapsible now, and attribution may not be collapsed away.
      // The control is always visible and is where a credit conventionally
      // belongs, so it is the ONLY place this is shown — a second copy in the
      // header would be the copy that does not satisfy the obligation, sitting
      // next to the one that does.
      mapView.setTerrainAttribution(
        terrain === undefined ? undefined : TERRARIUM_ATTRIBUTION,
      );
    },
  });

  /**
   * The heat scale for a snapshot — the ONE derivation both views read.
   *
   * The map returns its scale so the legend can paint the same ramp; the 3D
   * view needs it too, for W14's region slabs. Deriving it twice is the shape of
   * defect this demo keeps finding: two computations that agree today and have
   * nothing asserting they always will.
   */
  function scaleFor(snapshot: DemoSnapshot, category: string) {
    return heatScale(
      snapshot.cells.map((cell) => cell.scores[category] ?? 1),
      snapshot.threshold,
    );
  }

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
    const layers = selectLayers(store.getState());
    // DERIVED FROM THE WHOLE SNAPSHOT, not from what this view happens to draw
    // (W12). The cells handed to the map are filtered by the layer switch, and
    // deriving the scale from them made switching `cells` off collapse the legend
    // to "1 to 1" and colour the 2D regions on an empty ramp while the 3D slabs
    // used a different one.
    const scale = scaleFor(snapshot, view.category);
    // THE REGISTRY REACHES BOTH VIEWS. Gating only the 3D side would leave the map
    // drawing a layer the store says is off — the cross-view disagreement the store
    // exists to prevent, reintroduced by the mechanism meant to prevent it.
    mapView.render(
      isLayerEnabled(layers, "cells") ? snapshot.cells : [],
      snapshot.regions,
      view.category,
      snapshot.threshold,
      scale,
      view.showBelowThreshold,
      // W15: the same switch that draws the 3D slabs. One claim, both views.
      isLayerEnabled(layers, "areas"),
    );
    // The red box: what Overpass was actually asked for, drawn so "one res-7
    // tile" stops being an abstraction. See `fetch-extent.ts` for why the box
    // and the hexagon differ and why that gap is worth showing.
    mapView.renderFetchTiles(snapshot.loadedTiles);
    // Rendered from the SAME scale the map just painted with, so the two cannot
    // drift — the one way a legend becomes an active lie.
    legendView.render(scale, view.category, view.showBelowThreshold);
  }

  /**
   * The grid build, coalesced (W8).
   *
   * Declared here rather than beside the other cycles because it is the only one
   * whose input is assembled inside `drawScene` — five different triggers rebuild
   * the grid and three of them are a checkbox, so `latestOnly` is what stops an
   * older build landing last and painting a grid the store no longer describes.
   */
  const buildGrid = createCellMeshCycle({
    worker,
    apply: (grid) => {
      renderSafely(access, "3D view", () => {
        buildingView.renderCells(grid);
      });
    },
  });

  function drawScene(snapshot: DemoSnapshot | undefined): void {
    if (snapshot === undefined) {
      buildingView.clearScene();
      buildingView.renderCells(EMPTY_CELL_MESH);
      mesh = undefined;
      latestMesh = undefined;
      return;
    }
    const view = selectOsmView(store.getState());
    const layers = selectLayers(store.getState());
    // EVERY LAYER GOES THROUGH THE REGISTRY (W10). The two that already existed —
    // buildings and trees — are routed through it here BEFORE any new builder is
    // written, which is the only way the migration is verifiable: the default set
    // reproduces the previous picture exactly, so the e2e that passed before must
    // still pass.
    //
    // `latestMesh` IS DELIBERATELY NEVER CLEARED, and an earlier version of this
    // comment was wrong about it. It claimed the `undefined` branch handled a
    // category switch and the below-threshold toggle — but nothing clears the
    // variable, so once the first fetch has succeeded that branch is unreachable.
    // A reviewer spotted the dead claim and suggested clearing on consumption
    // (#228); that would have been right at the time and is wrong now.
    //
    // It has to persist, because a LAYER change has no new snapshot behind it and
    // still needs the geometry rebuilt — switching plates on must re-render from
    // the mesh the last refresh produced. Clearing it would make the layer toggles
    // silently no-ops on everything except the affordance grid.
    //
    // KNOWN COST, recorded rather than hidden: a below-threshold toggle now
    // rebuilds the building and tree geometry it did not need to. Distinguishing
    // "layers changed" from "only the draw filter changed" would avoid it and is a
    // follow-up, not a correctness issue.
    // Applied before the mesh, and unconditionally: the ramp re-colours the
    // GROUND PLANE, which exists whether or not any mesh layer is on. Putting it
    // behind `wantsMeshLayers` would make switching every other layer off also
    // silently switch off the diagnostic.
    buildingView.setGroundDebug(isLayerEnabled(layers, "terrainDebug"));
    // ASKED OF THE TABLE, not hand-listed. Both of these used to enumerate the
    // three mesh layers by name, so adding one meant remembering two places and
    // forgetting either gave a layer that toggles in the UI but never draws.
    const wantsMeshLayers = wantsAnyMeshLayer(layers);
    if (latestMesh !== undefined && wantsMeshLayers) {
      // ONE SCALE, BOTH VIEWS, and DERIVED IN ONE PLACE. W14 first computed a
      // second `heatScale` here from the same snapshot — agreeing with the map's
      // by construction, but by construction is not the same as by design: two
      // derivations of the identical thing is how they eventually differ, and
      // the failure would be silent because each view stays self-consistent.
      const scale = scaleFor(snapshot, view.category);
      mesh = buildingView.render(latestMesh, meshLayerSelection(layers), {
        colourForScore: (score) => {
          const { r, g, b } = heatColour(score, scale);
          return (r << 16) | (g << 8) | b;
        },
      });
    } else if (!wantsMeshLayers) {
      buildingView.clearScene();
      mesh = undefined;
    }
    // THE GRID IS BUILT IN THE WORKER NOW (W8). It was `buildCellMesh` inline —
    // one `cellToBoundary` per drawn cell, thousands of H3 calls on the thread
    // that also has to stay responsive, on every publish. The builder itself is
    // unchanged and unmoved in spirit: the same cells, bands and colours the map
    // just drew, from the same functions, so the two views cannot disagree about
    // what a cell scores (finding M3).
    //
    // Switching the layer OFF is synchronous, deliberately. An empty grid needs
    // no arithmetic, and routing it through the RPC would leave the old grid on
    // screen until a round trip completed — a checkbox that visibly lags.
    if (!isLayerEnabled(layers, "cells")) {
      buildingView.renderCells(EMPTY_CELL_MESH);
    } else {
      void buildGrid({
        cells: snapshot.cells.map((cell) => ({
          cell: cell.cell,
          // Resolved HERE rather than in the worker: the category is already
          // known on this side, and sending every category's score for every
          // cell would be most of the payload for data the grid cannot use.
          score: cell.scores[view.category] ?? 1,
        })),
        centre: snapshot.position,
        threshold: snapshot.threshold,
        // THE SAME DERIVATION AS THE MAP AND THE LEGEND (W12). This was a third
        // copy of the same expression; three copies agreeing today is three
        // chances to disagree tomorrow, and the disagreement would be silent
        // because each view stays self-consistent.
        scale: scaleFor(snapshot, view.category),
        showBelowThreshold: view.showBelowThreshold,
      });
    }
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
    const terrainCost = buildingView.terrainCost();
    status.textContent = [
      `${snapshot.cells.length} cells`,
      `${snapshot.regions.length} ${view.category} regions`,
      `${snapshot.stats.chunksScored} chunks scored / ${snapshot.stats.chunksReused} reused`,
      mesh === undefined
        ? ""
        : `${mesh.volumes} volumes (${mesh.parts} parts, ${mesh.guessedHeights} guessed building heights)`,
      mesh === undefined ? "" : `${mesh.triangles} triangles`,
      mesh === undefined || mesh.plates === 0
        ? ""
        : `${mesh.plates} ground areas (${mesh.plateTriangles} tri)`,
      // Reported for the same reason as the plate count: a layer switched on that
      // silently produces nothing is indistinguishable from one that produced
      // nothing because there is nothing there.
      mesh === undefined || mesh.poi === 0 ? "" : `${mesh.poi} POI`,
      mesh === undefined || mesh.roads === 0
        ? ""
        : `${mesh.roads} roads (${mesh.roadTriangles} tri)`,
      mesh === undefined || mesh.areas === 0 ? "" : `${mesh.areas} area slabs`,
      // W23's comparison, as a NUMBER. Both displacement paths ship precisely so
      // they can be measured against each other on a phone, and "it feels about
      // the same" is not a measurement — this repo has already had one constant
      // justified by a remembered figure that did not reproduce.
      `ground ${terrainCost.mode} ${terrainCost.ms} ms`,
      // W10 (N5). Every other counter here describes what was BUILT; this is
      // what the GPU was actually asked to do, which is the number R4-17's
      // "are the meshes as efficient as possible" turns on and the one Stage 3
      // trades against when it chunks the geometry for culling.
      describeDrawCost(buildingView.drawCost()),
      describeExtent(snapshot.loadedTiles),
      terrainNote,
      tableNote,
      snapshot.missingTiles.length > 0
        ? `⚠ ${snapshot.missingTiles.length} tile(s) unavailable`
        : "",
    ]
      .filter((part) => part !== "")
      .join(" · ");
  }

  /**
   * Redraws both views from the snapshot already in hand.
   *
   * PRESENTATION-ONLY CHANGES USE THIS: the layer toggles and the
   * below-threshold checkbox change WHAT IS DRAWN, not what was scored, so there
   * is no refetch and no rescore. Redrawing from the held snapshot is the whole
   * benefit of keeping it in the store.
   *
   * Shared rather than repeated per subscriber: two copies is what `check:dup`
   * caught when the layer subscriber was added, and the duplication mattered —
   * both copies wrap each view in its own `renderSafely`, and a future edit that
   * fixed the guard in one place only would silently let a throwing 3D view take
   * the map down with it.
   */
  function redrawFromSnapshot(): void {
    const snapshot = selectOsmView(store.getState()).snapshot;
    renderSafely(access, "map", () => {
      drawMap(snapshot);
    });
    renderSafely(access, "3D view", () => {
      drawScene(snapshot);
    });
    // THE STATUS LINE HAS TO FOLLOW. Its mesh counters describe what was drawn, so
    // leaving it stale after a layer switch would have it reporting 21 volumes over
    // a scene with no buildings in it — the status line contradicting the picture,
    // which is the exact defect round 1 was about. A test caught this.
    writeStatus();
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
    (loading) => {
      writeStatus();
      // DEC-R2-15. The status line lives inside the header, and a collapsed
      // header hides it — so an error would otherwise be written into something
      // invisible, and the demo would look like it did nothing. Expanding on
      // error keeps ONE error channel instead of growing a second one, and it
      // covers every reporter (fetch, either view, the locate button, a dead
      // worker) rather than just the one that prompted the rule.
      if (loading.phase === "error") headerCollapse.revealForError();
    },
  );

  subscribe(
    (view) => view.position,
    (position) => {
      mapView.setPosition(position);
      // W11 (R4-12). Every refresh rebuilds the world in a frame centred on the
      // new position, so the place the user chose is at the scene origin — but
      // the camera is only LOOKING at the origin until the first pan, after
      // which the clicked point renders off-centre or off screen and the 3D view
      // appears to have ignored the click. Translation only: the camera is never
      // rotated, which is the invariant the feedback states outright.
      buildingView.recentre();
      // BOTH AT ONCE (W3). These used to be chained — `loadTerrain(p).finally(()
      // => refresh())` — so a ~55 000-post DEM grid was sampled, transferred and
      // applied before the fetch and the scoring even started. They are
      // independent work on the same worker and the wait was pure latency.
      //
      // The mesh still cannot be built on the wrong ground: the worker joins
      // them on the far side, holding the mesh build until the terrain for THAT
      // POSITION has settled (`worker/terrain-gate.ts`). The join is keyed on the
      // position rather than on the order these two calls post, because
      // `loadTerrain` is coalesced and only QUEUES while a load is in flight —
      // so `refresh` can genuinely reach the worker first.
      void loadTerrain(position);
      void refresh();
    },
  );

  subscribe(
    (view) => view.category,
    () => {
      void refresh();
    },
  );

  subscribe(
    (view) => view.layers,
    () => {
      layerToggles.render(selectLayers(store.getState()));
      redrawFromSnapshot();
    },
  );

  subscribe((view) => view.showBelowThreshold, redrawFromSnapshot);

  subscribe(
    (view) => view.groundMode,
    (mode) => {
      const ground = parseGroundMode(mode);
      groundPicker.value = ground;
      buildingView.setGroundDisplacement(ground);
      // DEC-R3-17: the height ramp re-colours the ground plane IN PLACE, so with
      // no plane it is a switch that does nothing. Disabled rather than hidden,
      // and its stored value is untouched, so the choice survives the return.
      layerToggles.setAvailable("terrainDebug", groundDebugAvailable(ground));
      // The status line reports `ground <mode> <ms>`, which is W23's whole
      // measurement — it has to follow the picker rather than the last terrain
      // load.
      writeStatus();
    },
  );

  /**
   * The details panel follows the selection, from whichever view produced it.
   *
   * The explanation is recomputed on demand rather than stored: the per-tag
   * breakdown for every (cell, feature, category) would multiply the index's
   * memory by the average tag count and be paid on every cell whether or not
   * anyone looks (DEC-6). The covering feature set comes from the provenance
   * map, never re-derived from geometry — see `explain-cell.ts.md`.
   *
   * IT IS NOW AN RPC, and that is the point rather than an inconvenience. The
   * explanation needs the merged features and the rule table, both of which live
   * in the worker; answering it here would mean shipping 28–68 MB of features
   * across the boundary to explain one cell. Asking the side that already holds
   * them is the whole reason the split is worth having.
   *
   * Fire-and-forget with a guard: by the time the answer arrives the user may
   * have selected something else, and rendering a stale explanation into the
   * panel is exactly the kind of quiet disagreement the store exists to prevent.
   */
  const explainSelected = createExplainCycle({
    store,
    actions,
    worker,
    // Wrapped so a throwing panel reports as a view failure rather than
    // escaping into the store subscriber that called it.
    render: (explanation) => {
      renderSafely(access, "details panel", () => {
        detailsPanel.render(explanation);
      });
    },
    clear: () => {
      detailsPanel.clear();
    },
  });

  subscribe(
    (view) => view.selectedCell,
    (cell) => void explainSelected(cell),
  );
  // The FEATURE half of the same panel (W12). Two subscribers rather than one
  // over a union, because the two selections are mutually exclusive in the
  // reducer — selecting either clears the other — so each subscriber only ever
  // has to handle "mine arrived" and "mine went away". A single subscriber over
  // both would have to re-derive which one won, which is where the two could
  // disagree with the store.
  subscribe(
    (view) => view.selectedFeature,
    (feature) => {
      if (feature === undefined) {
        // Only clear if no cell took over, or a cell selection would blank the
        // panel it just filled: both subscribers fire on the same dispatch.
        if (selectOsmView(store.getState()).selectedCell === undefined) {
          detailsPanel.clear();
        }
        return;
      }
      detailsPanel.renderFeature(feature);
    },
  );
  // A new snapshot or a new category re-explains whatever is still selected,
  // so the panel can never describe a cell in a category the map is no longer
  // showing — the disagreement the store exists to make impossible.
  subscribe(
    (view) => view.snapshot,
    () => {
      void explainSelected(selectOsmView(store.getState()).selectedCell);
    },
  );
  subscribe(
    (view) => view.category,
    () => {
      void explainSelected(selectOsmView(store.getState()).selectedCell);
    },
  );

  // Concurrent at boot too, for the same reason and with the same guarantee: the
  // worker holds the first mesh build until the start position's terrain has
  // settled. `Promise.all` rather than two bare `void`s because `main` should not
  // resolve while the first picture is still being assembled.
  await Promise.all([loadTerrain(start), refresh()]);
}

// THE ONLY FAILURE CHANNEL BEFORE THE STORE EXISTS (raised in review on #233).
//
// `reportFatal` is installed inside `main`, and the worker's `onFatal` only
// covers worker-LEVEL failures — an `error` event from a module that would not
// load. A throw inside the `init` handler is different: the worker catches it and
// replies `ok: false`, which rejects that one call. With a bare `void main()`
// that rejection had nowhere to go, so the status line sat on "Loading the rule
// table…" forever and the demo looked like a slow network rather than a failure.
//
// Written straight to the DOM because the store, and therefore the error action,
// may not exist yet — that is precisely the window this covers.
void main().catch((error: unknown) => {
  const status = document.getElementById("status");
  if (status === null) return;
  status.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`;
});
