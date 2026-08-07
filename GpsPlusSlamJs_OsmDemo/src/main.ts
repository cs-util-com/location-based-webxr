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

import { TERRARIUM_ATTRIBUTION, enuFrameAt } from "gps-plus-slam-osm";

import { pickDefaultCategory } from "./default-category.js";
import { type DemoSnapshot } from "./demo-pipeline.js";
import { parseStartPosition } from "./start-position.js";
import { describeDrawCost } from "./draw-cost.js";
import { geoEventButtonLabel } from "./event-label.js";
import { describeExtent } from "./fetch-extent.js";
import { createGeoEventCycle } from "./geo-event-cycle.js";
import {
  DEFAULT_CELL_PRESET,
  cellPreset,
  needsMeshRebuild,
  nextCellPreset,
} from "./cell-presets.js";
import { HotkeyRegistry } from "./hotkeys.js";
import { MapView } from "./map-view.js";
import { LegendView } from "./legend-view.js";
import { DetailsPanel } from "./details-panel.js";
import { summariseRegion } from "./region-summary.js";
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
import { heatColour } from "./heat-colours.js";
import {
  BuildingView,
  TERRAIN_SPACING_M,
  type BuildingStats,
} from "./building-view.js";
import { attachHeaderCollapse } from "./header-collapse.js";
import { createExplainCycle } from "./explain-cycle.js";
import {
  GROUND_MODES,
  groundModeLabel,
  groundAppearance,
  groundStrategy,
  parseGroundMode,
} from "./ground-mode.js";
import { attachLayerToggles, withLayerBusy } from "./layer-toggles.js";
import { attachSitePicker } from "./site-picker.js";
import { isLayerEnabled, layersNeedingData } from "./layers.js";
import { meshLayerSelection, wantsAnyMeshLayer } from "./mesh-layers.js";
import { createDemoStore, selectLayers, selectOsmView } from "./osm-store.js";
import {
  createRefreshCycle,
  isFinalRing,
  renderSafely,
} from "./refresh-cycle.js";
import { createAnchorHolder } from "./scene-anchor.js";
import type { TransferableMesh } from "./worker/protocol.js";
import { createRpcClient, workerTransport } from "./worker/rpc-client.js";

/**
 * How far one press of the time key moves the sun, as a fraction of the day.
 *
 * 1/24 — an hour a press, so a full day is 24 presses and holding the key sweeps
 * it in a few seconds. Small enough that the golden-hour band can be found, large
 * enough that reaching noon is not a chore.
 */
const TIME_STEP = 1 / 24;

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
  // The label around it, handed to `attachLayerToggles` as an affordance-group
  // extra (DEC-R6b-5) so the checkbox lives inside the block it belongs to.
  const showBelowLabel = el("show-below-label");

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
  categorySelect.value = pickDefaultCategory(loaded.categories);

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
    onRegionClick: (region) => store.dispatch(actions.regionSelected(region)),
  });
  // ONE REGISTRY FOR THE WHOLE DEMO (§1.4 step 5). Built here so §3's look
  // presets and §6's event clock reuse it rather than each attaching their own
  // listener — a duplicate key would otherwise be silent. See `hotkeys.ts`.
  const hotkeys = new HotkeyRegistry(document);
  /**
   * Which affordance-tile look is showing (§3, DEC-R6-10).
   *
   * A local `let` rather than store state, for the same reason the perf overlay
   * is: nothing else has to agree about it. It starts at the DEFAULT, which is
   * the look that shipped and the one the e2e suite pins — so the hotkey walks
   * away from what was reviewed rather than towards it.
   */
  let activePreset = cellPreset(DEFAULT_CELL_PRESET);

  const buildingView = new BuildingView({
    container: el("scene"),
    // A cell selection dispatches the SAME action a 2D cell click does: the panel
    // does not know, and must not know, which view the selection came from. A POI
    // selection is a different kind of answer and gets its own action (W12).
    onPick: (picked) => {
      if (picked.kind === "cell") {
        store.dispatch(actions.cellSelected(picked.cell));
      } else if (picked.kind === "region") {
        // Same action a 2D region click dispatches, for the same reason a cell
        // selection is shared: the panel must not know which view produced it.
        store.dispatch(actions.regionSelected(picked.region));
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

  // THE TIME OF DAY (§1, DEC-R6-3). A HOTKEY rather than a control in the
  // header, and the reason is the header itself: round 5's feedback already
  // calls it busy, and DEC-R6-16 has just committed to a seven-entry ground
  // picker there. A shortcut costs no layout.
  //
  // The sun is physical now, so this is the only thing that moves it — and
  // each press regenerates the environment map, which is a render pass. That is
  // affordable precisely because it is a deliberate press rather than something
  // a drag triggers; see `sun-position.ts`.
  const stepTime = (by: number) => () => {
    // WRAPPED, not clamped, so holding the key walks through a whole day and
    // comes back. `sunAt` clamps its input, so an unwrapped step would park the
    // sun at midnight and look broken.
    const next = (buildingView.timeOfDayValue() + by + 1) % 1;
    buildingView.setTimeOfDay(next);
  };
  hotkeys.add({
    key: "t",
    description: "step the sun forward (time of day)",
    handler: stepTime(TIME_STEP),
  });
  hotkeys.add({
    key: "T",
    description: "step the sun back",
    handler: stepTime(-TIME_STEP),
  });

  // THE LOOK PRESETS (§3, DEC-R6-9/10). One key cycles whole looks rather than
  // four keys toggling four axes: sixteen combinations means no combination is
  // tested, the e2e suite can only pin one, and these axes interact — opacity
  // changes what the bevel is worth, height changes what opacity is worth.
  //
  // LOCAL, not in the store, like the perf overlay: nothing else has to agree
  // about it. The ground mode is in the store because the layer switches read
  // it too.
  hotkeys.add({
    key: "p",
    description: "cycle the affordance-tile look preset",
    handler: () => {
      const previous = activePreset;
      activePreset = cellPreset(nextCellPreset(activePreset.name));
      buildingView.setCellPreset(activePreset);
      // ONLY WHEN THE BUFFERS ACTUALLY CHANGE. Opacity, fog and lift are
      // material and transform settings the view applies itself; republishing
      // for them would make every press wait on the worker over up to ~2 989
      // cells, and the hotkey would feel broken.
      if (needsMeshRebuild(previous, activePreset)) redrawFromSnapshot();
      writeStatus();
    },
  });

  // DISCOVERABILITY, and it is rendered FROM the registry rather than written
  // out by hand: a help list that can disagree with the actual bindings is
  // worse than no list at all, because it is believed.
  const hotkeyHelp = el("hotkey-help");
  hotkeys.add({
    key: "?",
    description: "show or hide this list",
    handler: () => {
      if (hotkeyHelp.hidden) {
        hotkeyHelp.replaceChildren(
          ...hotkeys.bindings().map((binding) => {
            const row = document.createElement("div");
            const key = document.createElement("kbd");
            key.textContent = binding.key;
            row.append(key, ` ${binding.description}`);
            return row;
          }),
        );
      }
      hotkeyHelp.hidden = !hotkeyHelp.hidden;
    },
  });

  const legendView = new LegendView({ container: el("legend") });
  /**
   * The geo-event trigger (DEC-R9-13).
   *
   * A BUTTON, not a position subscriber: computing an event scores hundreds of
   * chunks and may download a tile, and clicking around the map is this demo's
   * primary interaction. It also makes WHEN it ran visible, which matters on a
   * diagnostic surface.
   *
   * The element is looked up here with the other controls; the behaviour is
   * wired further down, once `refresh` exists — see `geo-event-cycle.ts`.
   */
  const geoEventButton = el<HTMLButtonElement>("geo-event");
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
  /**
   * Set by the site picker, read once by the position subscriber.
   *
   * A flag rather than a field on the action because the action comes from the
   * framework's state slice, shared with every other app — widening it for one
   * demo's anchoring rule would be the wrong place to put this.
   */
  let placeChangeDeclared = false;

  attachSitePicker({
    select: el<HTMLSelectElement>("site"),
    onChoose: (position) => {
      mapView.centreOn(position);
      // A DECLARED place change, not travel. The picker spans Cologne to Tokyo,
      // so the scene anchor must be re-taken regardless of distance — and two
      // entries a few hundred metres apart are still two different scenes.
      // Consumed by the position subscriber below, which is what calls refresh.
      placeChangeDeclared = true;
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
  // WHERE THE SCENE IS ANCHORED — one holder, read by everything downstream.
  //
  // THE ANCHOR IS ADVANCED EXACTLY ONCE PER POSITION CHANGE, at the top of the
  // subscriber below, BEFORE the camera, the terrain load or the refresh read
  // it. It used to be decided inside the refresh cycle, which runs last of the
  // three — so on a re-anchor the other two used the outgoing frame, and after a
  // Cologne→Tokyo pick the camera pivoted ~9 000 km from the scene it was
  // looking at. See `scene-anchor.ts`.
  const anchors = createAnchorHolder(start);

  const refresh = createRefreshCycle({
    store,
    actions,
    worker,
    anchors,
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
      // The outlines merge like the slabs, and for the same reason: both change
      // without the features or the frame changing, so the cheap reply carries
      // both or the layer stays empty until something unrelated forces a full
      // rebuild.
      latestMesh = {
        ...latestMesh,
        regions: built.regions,
        underground: built.underground,
      };
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
  /**
   * Puts the geo-event button in line with the state, plus the one thing that
   * is not state: whether a search is in flight.
   *
   * DERIVED, NOT WRITTEN AT THE CALL SITE. The label used to be assigned on
   * success and reset on failure, so it could describe markers that were no
   * longer there and vice versa. Reading it from `(busy, position, geoEvent)`
   * also makes the distance re-read as the user walks, which is the behaviour
   * F56 wanted and a frozen string could not give.
   */
  const paintGeoEventButton = (busy = geoEventButton.disabled): void => {
    geoEventButton.disabled = busy;
    geoEventButton.textContent = geoEventButtonLabel(
      selectOsmView(store.getState()),
      busy,
    );
  };

  /**
   * The geo-event search, wired HERE rather than where the button is looked up,
   * because it needs `refresh` — see `geo-event-cycle.ts` for why a successful
   * search republishes at all.
   */
  const findGeoEvent = createGeoEventCycle({
    store,
    actions,
    worker,
    setBusy: paintGeoEventButton,
    republish: () => refresh(),
  });
  geoEventButton.addEventListener("click", () => void findGeoEvent());
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
    //
    // `show-below` joins the AFFORDANCE group the same way (DEC-R6b-5). It is
    // not a layer either — it changes which cells an existing layer draws — but
    // it is a property of the affordance heat grid and belongs with its
    // switches. Being a real child of `#layer-group-overlays` rather than a
    // sibling styled to look adjacent is what makes it collapse and expand with
    // that block, which is the behaviour the sixth session asked for.
    extras: {
      diagnostics: [el("perf-stats-label")],
      overlays: [showBelowLabel],
    },
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
  /**
   * Publishes the scene's frame state onto `#scene`, for the e2e to read.
   *
   * WHY THIS EXISTS. "The scene does not jump" needs a MACHINE-READABLE
   * definition, and the obvious ones do not work: a screenshot diff also passes
   * for a scene that renders nothing, and comparing full canvases across a
   * position change is wrong by construction — the user moved, so the picture
   * must change. What must NOT change is the frame those pixels are expressed
   * in, and that is not otherwise observable from outside.
   *
   * Two values, because they answer opposite halves of the same question:
   *
   * - `data-frame-origin` must be UNCHANGED across a step. Every published
   *   vertex is expressed in this frame, so if it holds, nothing moved
   *   underneath the user.
   * - `data-ground-centre` must FOLLOW the user. Without this counterweight
   *   "the frame never moves" would also pass for a scene that stopped
   *   sampling the ground the user is standing on.
   *
   * Attributes rather than a `window` global: this app already uses `data-*` to
   * expose state the e2e asserts on (`data-state` on the locate button,
   * `data-collapsed` on the header), and an attribute cannot be read before it
   * is written by mistake.
   */
  const publishFrameState = (
    origin: { lat: number; lng: number },
    centreEnu: { x: number; y: number } | undefined,
  ): void => {
    const scene = document.querySelector("#scene");
    if (!(scene instanceof HTMLElement)) return;
    scene.dataset["frameOrigin"] =
      `${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}`;
    // Whole metres: the assertion is about hundreds of metres of drift, and a
    // full-precision float would make the attribute churn on every repaint.
    scene.dataset["groundCentre"] =
      centreEnu === undefined
        ? "none"
        : `${Math.round(centreEnu.x)},${Math.round(centreEnu.y)}`;
  };

  const loadTerrain = createTerrainCycle({
    worker,
    extentM: TERRAIN_EXTENT_M,
    spacingM: TERRAIN_SPACING_M,
    apply: ({ field, note, centreEnu }) => {
      terrain = field === undefined ? undefined : heightfieldFrom(field);
      terrainNote = note;
      // `centreEnu` PASSED SEPARATELY, because a DEM outage leaves `field`
      // undefined while the window still has a place — and the ground plane has
      // to follow it either way, or a walk during an outage takes the user off
      // the edge of a finite plane.
      buildingView.setTerrain(terrain, centreEnu);
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
      // THE REPORTED CENTRE, not the field's — they are the same on a good
      // load, and only the former exists during an outage.
      publishFrameState(anchors.origin, centreEnu);
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
  function scaleFor(snapshot: DemoSnapshot) {
    // READ, NOT DERIVED (round 10, stage B). This used to map every cell's
    // score and take the maximum — which is the ONLY thing the default
    // configuration did with the cell array, since the `cells` layer is off and
    // the regions are computed in the worker. So ~24 000 cells crossed the
    // boundary, three times per move at a measured 27–35 ms each, to produce
    // one number. The worker now sends the number.
    //
    // Still the ONE derivation both views read; it simply arrives instead of
    // being recomputed here.
    return { threshold: snapshot.threshold, max: snapshot.heatMax };
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
    // EVERYTHING DRAWN COMES FROM ONE SNAPSHOT (raised in review on #254).
    // `heatMax` is computed for `snapshot.category`, so colouring by
    // `view.category` mismatches the ramp in one real window: a category change
    // dispatches `categoryChanged`, which fires `refresh()` and leaves the
    // PREVIOUS snapshot in the store for the length of the fetch -- up to 18 s.
    // Toggling a layer or `showBelowThreshold` in that window would colour the
    // new category's scores against the old category's ramp.
    //
    // Reading it from the snapshot makes the consistency structural rather than
    // timing-dependent. Before stage B this was masked, because `scaleFor` took
    // the category and recomputed the max from the cell array every draw.
    const drawnCategory = snapshot.category;
    const scale = scaleFor(snapshot);
    // THE REGISTRY REACHES BOTH VIEWS. Gating only the 3D side would leave the map
    // drawing a layer the store says is off — the cross-view disagreement the store
    // exists to prevent, reintroduced by the mechanism meant to prevent it.
    mapView.render(
      isLayerEnabled(layers, "cells") ? snapshot.cells : [],
      snapshot.regions,
      drawnCategory,
      snapshot.threshold,
      scale,
      view.showBelowThreshold,
      // W15: the same switch that draws the 3D slabs. One claim, both views.
      isLayerEnabled(layers, "areas"),
    );
    // The excluded features, so a reader can judge WHICH 13 % vanished rather
    // than only how many. Gated like every other layer: the registry reaches
    // both views or neither.
    mapView.renderUnderground(
      isLayerEnabled(layers, "underground") ? snapshot.undergroundOutlines : [],
    );
    // The red box: what Overpass was actually asked for, drawn so "one res-7
    // tile" stops being an abstraction. See `fetch-extent.ts` for why the box
    // and the hexagon differ and why that gap is worth showing.
    mapView.renderFetchTiles(snapshot.loadedTiles);
    // Rendered from the SAME scale the map just painted with, so the two cannot
    // drift — the one way a legend becomes an active lie.
    legendView.render(scale, drawnCategory, view.showBelowThreshold);
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
    // The height ramp USED TO BE APPLIED HERE, from the layer set. It is now an
    // appearance of the ground mode (W6, DEC-R5-4), so it is driven by the ground
    // subscription below — which is also the only place that knows whether there
    // is a plane to colour at all.
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
      const scale = scaleFor(snapshot);
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

    // The below-surface outlines, in ENU, packed by the worker alongside every
    // other piece of scene geometry. Gated on the SAME switch the map reads, or
    // the two views would disagree about what was excluded — the cross-view
    // divergence the layer registry exists to prevent.
    //
    // OUTSIDE the `wantsMeshLayers` branch: this is a diagnostic about what is
    // NOT in the scene, so it must still draw when every world layer is off.
    buildingView.renderUnderground(
      isLayerEnabled(layers, "underground") && latestMesh !== undefined
        ? latestMesh.underground
        : [],
    );
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
          // THE SNAPSHOT'S category, not the view's -- the scores being read
          // are this snapshot's, and during a category change the store holds
          // the previous one for the length of the fetch (#254).
          score: cell.scores[snapshot.category] ?? 1,
        })),
        centre: snapshot.position,
        // THE SCENE'S ANCHOR, not the user. The grid is the fourth thing built
        // through the worker's `meshOptions`, and the one missed when the frame
        // was fixed — so the overlay stayed pinned to the user while the
        // buildings under it did not, the two sliding apart by the walked
        // distance.
        frameOrigin: anchors.origin,
        threshold: snapshot.threshold,
        // THE SAME DERIVATION AS THE MAP AND THE LEGEND (W12). This was a third
        // copy of the same expression; three copies agreeing today is three
        // chances to disagree tomorrow, and the disagreement would be silent
        // because each view stays self-consistent.
        scale: scaleFor(snapshot),
        showBelowThreshold: view.showBelowThreshold,
        // THE TWO GEOMETRY AXES OF THE LOOK PRESET (§3). Read from the module
        // holder rather than the store: the preset is a local experiment
        // control, like the perf overlay, and nothing else has to agree about
        // it. If it ever becomes a shared setting it moves to the store, as the
        // ground mode did.
        extrude: activePreset.extrude,
        heightByScore: activePreset.heightByScore,
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
      // FIRST, because it qualifies every count after it (F42). Scoring widens
      // over three rings and publishes after each, and `snapshotReady` sets
      // `loading: idle` every time — so this line used to present ring 2's cell,
      // region and triangle counts exactly as it presents the final ones, and a
      // user watched a settled-looking answer silently change twice with no
      // indication that more was coming. The numbers were never wrong; the
      // impression that they were final was.
      isFinalRing(snapshot.radius) ? "" : "widening…",
      `${snapshot.cellCount} cells`,
      // ALWAYS SHOWN, even with the layer off: the exclusion is otherwise
      // invisible, and an absurd count is the cheapest signal that the
      // predicate has become too eager — the mirror bug, where nothing looks
      // broken and there is simply less map.
      `${snapshot.undergroundCount} underground`,
      // The snapshot's category: these ARE its regions, counted for it.
      `${snapshot.regions.length} ${snapshot.category} regions`,
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
      // WHICH LOOK IS ACTIVE (§3). Reported for the same reason the ground mode
      // is: an experiment you cannot name is an experiment whose result you
      // cannot record. It also lets the e2e assert WHICH preset is showing
      // separately from whether it reached the screen — conflating the two
      // would make a failure ambiguous.
      `tiles ${activePreset.name}`,
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
      // THE ANCHOR MOVES FIRST, AND EXACTLY ONCE. Everything below reads the
      // holder, so all three consumers of the frame — the camera, the terrain
      // load and the refresh — necessarily agree about which frame this position
      // is drawn in. While the refresh owned this decision it ran LAST, and the
      // two above it used the outgoing anchor on every re-anchor.
      //
      // READ AND CLEARED, so a declared place change re-anchors exactly once and
      // the next ordinary step is treated as travel again.
      const declared = placeChangeDeclared;
      placeChangeDeclared = false;
      anchors.advance(position, { declared });
      // W11 (R4-12). A click must bring the chosen point back to the middle of
      // the 3D view without spinning it: `MapControls` pans camera and target
      // together, so after any pan the pivot is somewhere else entirely and the
      // clicked point renders off-centre or off screen. Translation only — the
      // camera is never rotated, which is the invariant the feedback states
      // outright.
      //
      // ON THE USER, not on the origin. Those were the same point while the ENU
      // frame was rebuilt at the user on every publish; `scene-anchor.ts` fixed
      // the frame, so recentring on the origin would drag the camera back to the
      // session start on every step.
      buildingView.recentre(
        enuFrameAt(anchors.origin).toEnu(
          selectOsmView(store.getState()).position,
        ),
      );
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
      void loadTerrain({ centre: position, frameOrigin: anchors.origin });
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
    (layers, previousLayers) => {
      layerToggles.render(layers);
      // TURNING THE CELL LAYER ON HAS TO FETCH THE CELLS (round 10, stage B).
      // Every other layer only changes what is drawn from data already held, so
      // a redraw is enough; `cells` is different because the snapshot
      // deliberately arrives WITHOUT the array while that layer is off.
      //
      // HERE RATHER THAN IN THE TOGGLE CALLBACK, and that is the point of
      // extracting the rule at all. This subscriber fires on EVERY
      // `layersChanged` dispatch and is handed `(current, previous)` -- exactly
      // `needsRefetch`s signature -- so a future dispatcher (URL sync, a
      // preset, a site-picker default) cannot reintroduce the defect by
      // forgetting to ask. The toggle callback owned it for one commit, which
      // left the transition unowned again the moment a second dispatcher
      // appeared. Raised in review on #254.
      // ...AND ONLY IF WE DO NOT ALREADY HOLD THEM. Switching `cells` OFF does
      // not refetch (the rule is one-way) and dispatches nothing that replaces
      // the snapshot, so the held array survives. Without this an off/on flick
      // within one position pays a whole progressive refresh -- three rings, a
      // worker mesh build, up to 18 s -- to arrive at data already in hand,
      // where before stage B it was an instant redraw.
      //
      // AT THE CALL SITE rather than inside `needsRefetch`, which keeps the
      // layer rule pure: the rule answers "does this change need data", the
      // caller answers "and do we lack it". Raised in review on #254.
      const heldSnapshot = selectOsmView(store.getState()).snapshot;
      // `?? 0` because NO SNAPSHOT means nothing is held -- the strongest case
      // for refetching, not the weakest. An earlier version read
      // `snapshot?.cells.length === 0`, i.e. `undefined === 0`, i.e. false, so a
      // dead worker or an Overpass 429 left the toggle doing nothing at all.
      const needData =
        previousLayers === undefined
          ? []
          : layersNeedingData(previousLayers, layers, {
              cells: heldSnapshot?.cells.length ?? 0,
              underground: heldSnapshot?.undergroundOutlines.length ?? 0,
            });
      if (needData.length > 0) {
        // IN PROGRESS, because this is not a redraw. Measured at 1880 ms with
        // the tiles already held (F58), so without a cue the switch looks inert
        // for close to two seconds -- which the root CLAUDE.md requires feedback
        // for, and which the round-10 summary wrongly estimated was under the
        // threshold.
        //
        // EVERY LAYER THAT NEEDS THE FETCH, not a hard-coded name.
        // `layersNeedingData` returns names rather than a boolean precisely so
        // the caller can say WHICH — and while `cells` was the only gated layer
        // the literal was indistinguishable from the right answer.
        void withLayerBusy(layerToggles, needData, refresh);
      }
      redrawFromSnapshot();
    },
  );

  subscribe((view) => view.showBelowThreshold, redrawFromSnapshot);

  /**
   * The geo-event markers, drawn like every other overlay: from the store.
   *
   * They used to go straight from the worker into `mapView`'s event layer,
   * which made them the ONE overlay here that was not a projection of state —
   * so a category switch left the previous category's events sitting over the
   * new category's cells, a failed refresh blanked everything except them, and
   * no control could take them down. Now `geoEventFound` is the only way in and
   * `categoryChanged` / `fetchFailed` are the ways out.
   */
  subscribe(
    (view) => view.geoEvent,
    (event) => {
      mapView.renderGeoEvent(event);
      paintGeoEventButton();
    },
  );
  // The label's distance is measured from where the user is NOW, so walking
  // towards an event counts it down instead of leaving a stale "640 m NE" up.
  subscribe(
    (view) => view.position,
    () => paintGeoEventButton(),
  );

  /**
   * Puts the view in line with a ground mode. Both axes, from one value.
   *
   * `setGroundDisplacement` takes the STRATEGY only — the ramp is a material swap
   * on the same plane and both materials carry the displacement, so an
   * appearance change must not re-apply the terrain.
   */
  const applyGroundMode = (mode: string): void => {
    const ground = parseGroundMode(mode);
    groundPicker.value = ground;
    buildingView.setGroundDisplacement(groundStrategy(ground));
    // THE APPEARANCE, not a boolean (§2, DEC-R6-16). There are three of them
    // now — plain, slope, ramp — and `setGroundDebug(boolean)` could only ever
    // express two, so a `cpu-slope` mode would silently have rendered plain.
    buildingView.setGroundAppearance(groundAppearance(ground));
    // The status line reports `ground <mode> <ms>`, which is W23's whole
    // measurement — it has to follow the picker rather than the last terrain
    // load.
    writeStatus();
  };

  subscribe((view) => view.groundMode, applyGroundMode);

  // AND ONCE AT BOOT, which is new and is a defect fix rather than tidiness (W6).
  // `subscribe` fires on CHANGE only, so nothing ever applied the initial mode —
  // it worked because three independent defaults happened to agree: the store's
  // seed, `GROUND_MODES[0]` (which is what a `<select>` shows when nothing sets
  // its value) and `building-view`'s own initial field. DEC-R5-4 makes the
  // default `cpu-ramp`, which is not `GROUND_MODES[0]`, so the coincidence
  // breaks: the picker would have read "CPU ground" over a ramped scene.
  applyGroundMode(selectOsmView(store.getState()).groundMode);

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
    // Wrapped like `render` above, and for the same reason: this one also
    // builds DOM, so a throw here must report as a view failure rather than
    // escape into the store subscriber that called it.
    unavailable: (cell) => {
      renderSafely(access, "details panel", () => {
        detailsPanel.renderUnavailable(cell);
      });
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
  /**
   * The REGION half of the same panel (DEC-R7b-3a).
   *
   * A third subscriber, for the reason the second one gives: the three
   * selections are mutually exclusive in the reducer, so each subscriber only
   * ever handles "mine arrived" and "mine went away".
   *
   * WHY IT RESOLVES THE ID RATHER THAN HOLDING THE REGION. A region id is the
   * lowest-sorting cell in it, and `region-builder.ts` documents that two
   * regions merging as more data loads changes BOTH their ids. The store holds
   * the id; the panel is rendered from whatever the CURRENT snapshot says that
   * id means. When the id is gone — merged away, or scored out — the selection
   * is dropped rather than left showing numbers for a region that no longer
   * exists. Stale numbers in a details panel are worse than no panel, because
   * they look authoritative.
   */
  const showRegion = (id: string | undefined): void => {
    if (id === undefined) {
      const view = selectOsmView(store.getState());
      // Only clear if nothing else took over: all three subscribers fire on the
      // same dispatch.
      if (
        view.selectedCell === undefined &&
        view.selectedFeature === undefined
      ) {
        detailsPanel.clear();
      }
      return;
    }
    const snapshot = selectOsmView(store.getState()).snapshot;
    const region = snapshot?.regions.find((candidate) => candidate.id === id);
    if (region === undefined) {
      store.dispatch(actions.regionSelected(undefined));
      return;
    }
    detailsPanel.renderRegion(summariseRegion(region));
  };
  subscribe(
    (view) => view.selectedRegion,
    (id) => {
      showRegion(id);
    },
  );
  // A new snapshot or a new category re-explains whatever is still selected,
  // so the panel can never describe a cell in a category the map is no longer
  // showing — the disagreement the store exists to make impossible.
  subscribe(
    (view) => view.snapshot,
    () => {
      void explainSelected(selectOsmView(store.getState()).selectedCell);
      // A region's id can change under it when regions merge, so the selection
      // is re-resolved rather than assumed still valid.
      showRegion(selectOsmView(store.getState()).selectedRegion);
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
  // The holder was seeded with `start`, so this reads the same origin the first
  // refresh will send — the two cannot disagree about the opening scene.
  await Promise.all([
    loadTerrain({ centre: start, frameOrigin: anchors.origin }),
    refresh(),
  ]);
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
