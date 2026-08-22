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

import { cellToLatLng, greatCircleDistance, UNITS } from "h3-js";
import {
  describeGeoid,
  enuFrameAt,
  type RacingProviderStats,
  type GeoidModel,
  type LatLng,
} from "gps-plus-slam-osm";

import { DEM_ATTRIBUTION_ENTRIES } from "./dem-provider.js";
import { pickDefaultCategory } from "./default-category.js";
import { type DemoSnapshot } from "./demo-pipeline.js";
import { parseStartPosition } from "./start-position.js";
import {
  browserPlaceUrl,
  parseCameraTarget,
  writeCamera,
  writePlace,
} from "./url-state.js";
import { describeDrawCost } from "./draw-cost.js";
import {
  describeGeoEvent,
  geoEventButtonLabel,
  geoEventReadout,
} from "./event-label.js";
import { describeExtent } from "./fetch-extent.js";
import { probeImmersiveArSupport } from "gps-plus-slam-app-framework/ar";
import { setZeroPos } from "gps-plus-slam-app-framework/state";
// The eight that together mean "the compass has this much say, under these
// experimental conditions" — see `compass-influence.ts` for why silencing it is
// not one setting, and why the last four exist at all.
import {
  setColdStartOverrideEnabled,
  setCompassExperimentEnabled,
  setCompassRotationPriorEnabled,
  setCompassVoteWeight,
  setCompassTrustGateMode,
  setCompassPairSelectionEnabled,
  setCompassTrustAgreeToleranceDeg,
  setCompassWebXRConsistencyEnabled,
} from "gps-plus-slam-app-framework/state";
import { selectZeroReference } from "gps-plus-slam-app-framework/state";

import { arButtonState, type ArSupport } from "./ar-button-state.js";
import {
  arPressAction,
  shouldOfferAr,
  type ArPressAction,
} from "./ar-entry.js";
import { startArMode, type ArMode } from "./ar-mode.js";
import { autoElevationEnabled } from "./ar-elevation-auto.js";
import { startArWalk, type ArWalk } from "./ar-walk-controller.js";
import { createArToast } from "./ar-toast.js";
import { createToast } from "./toast.js";
import { canEnterAr, terrainReadout } from "./ar-origin.js";
import { createGeoEventCycle } from "./geo-event-cycle.js";
import { GeoEventPicker } from "./geo-event-picker.js";
import { describeGeoEventStats } from "./geo-event-stats.js";
import { describeClickSummary, describeClickTimings } from "./click-timings.js";
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
import L from "leaflet";
import { LocateControl } from "./locate-control.js";
import { createGpsRegistration, toGpsPosition } from "./gps-registration.js";
// THE FRAMEWORK CALLS THE REGISTRATION LOOP NEEDS. Narrow subpaths, not the
// barrel — `osm-store.ts` and `ar-mode.ts` both carry the note about the root
// export pulling in Leaflet at import time.
import { getCurrentArPose } from "gps-plus-slam-app-framework/ar";
import {
  createGpsPositionHandler,
  endSession,
  startSession,
  updateDeviceOrientation,
} from "gps-plus-slam-app-framework/state";
import {
  requestDeviceOrientationPermission,
  startAbsoluteOrientationWatch,
  startOrientationWatch,
  stopAbsoluteOrientationWatch,
  stopOrientationWatch,
} from "gps-plus-slam-app-framework/sensors";
import { attachSheetDrag } from "./sheet-drag.js";
import { EMPTY_CELL_MESH } from "./cell-mesh.js";
import { createCellMeshCycle } from "./cell-mesh-cycle.js";
import {
  heightfieldFrom,
  TERRAIN_EXTENT_M,
  type Heightfield,
} from "./heightfield.js";
import { createTerrainCycle } from "./terrain-cycle.js";
import { fixedScale, heatColour } from "./heat-colours.js";
import {
  BuildingView,
  CAMERA_VFOV_DEG,
  TERRAIN_SPACING_M,
  type BuildingStats,
  type CameraView,
} from "./building-view.js";
import { renderDistanceFor } from "./render-distance.js";
import { cameraDistanceForZoom } from "./map-zoom-to-camera.js";
import { throttle } from "./throttle.js";
import { attachHeaderCollapse } from "./header-collapse.js";
import { createAgentCycle } from "./agent-cycle.js";
import { createExplainCycle } from "./explain-cycle.js";
import { ROUTE_LIFT_M } from "./layer-order.js";
import { latestOnly } from "./latest-only.js";
import type { ScenePoint } from "./pick.js";
import { scenePathOf } from "./route-path.js";
import {
  GROUND_MODES,
  groundModeLabel,
  groundAppearance,
  groundStrategy,
  parseGroundMode,
} from "./ground-mode.js";
import { attachLayerToggles, withLayerBusy } from "./layer-toggles.js";
import { attachSitePicker } from "./site-picker.js";
import { isLayerEnabled, layersNeedingData, type LayerSet } from "./layers.js";
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

  /**
   * Orders the agent to a clicked point (stage 4, DEC-R11-3).
   *
   * A FORWARD REFERENCE, like `reportFatal` above, and for the same reason: the
   * pick handler is declared with the view, while the cycle it calls needs the
   * worker client and the scene anchor, both of which are built below. A no-op
   * until then, so a click during boot is dropped rather than crashing.
   */
  let orderAgentTo: (point: ScenePoint) => void = () => undefined;
  /**
   * The same order, aimed at a drawn cell (stage 3, DEC-R13-6).
   *
   * A SECOND ENTRY POINT RATHER THAN A CONVERSION AT THE CALL SITE, because a
   * cell already knows where it is: `pick.ts` hands back the H3 index, and
   * making the caller manufacture scene coordinates from it — only for
   * `orderAgent` to convert them back to lat/lng — would put two lossy steps
   * either side of a value that was already correct.
   */
  let orderAgentToCell: (cell: string) => void = () => undefined;

  /**
   * Writes where the camera is looking into the URL (DEC-R13-7).
   *
   * A FORWARD REFERENCE like `orderAgentTo`: the view is built before the scene
   * anchor it needs to convert scene coordinates into lat/lng. A no-op until
   * then, so a drag during boot is dropped rather than crashing.
   */
  let reportCameraView: (view: CameraView) => void = () => undefined;

  const buildingView = new BuildingView({
    container: el("scene"),
    onCameraMove: (view) => reportCameraView(view),
    // A cell selection dispatches the SAME action a 2D cell click does: the panel
    // does not know, and must not know, which view the selection came from. A POI
    // selection is a different kind of answer and gets its own action (W12).
    onPick: (picked) => {
      if (picked.kind === "cell") {
        store.dispatch(actions.cellSelected(picked.cell));
        // AND IT ORDERS (stage 3, DEC-R13-6). Before this, a cell hit returned
        // from `pick.ts` and stopped here, so wherever the grid was drawn the
        // agent could not be sent — masked only by the grid being off by
        // default and covering ~250 m, and a real blocker the moment coverage
        // grows. The rejected alternatives were a modifier split (clean, but it
        // hides inspection behind a gesture touch does not have) and making
        // cells unclickable in 3D (removes a feature that works).
        //
        // Accepted cost, stated: every inspection click also moves the agent
        // and re-plans the route. The modifier split is the escape hatch if the
        // next session finds that annoying.
        orderAgentToCell(picked.cell);
      } else if (picked.kind === "region") {
        // Same action a 2D region click dispatches, for the same reason a cell
        // selection is shared: the panel must not know which view produced it.
        store.dispatch(actions.regionSelected(picked.region));
      } else if (picked.kind === "ground") {
        // THE ONE CLICK THAT IS NOT A SELECTION (DEC-R11-17). Open ground is a
        // PLACE rather than a thing, so it has no panel to open — it is where
        // the agent is sent. Every finer claim still wins, and a click on a
        // building resolves to nothing at all, so this does not take a meaning
        // away from any click that already had one.
        orderAgentTo(picked.point);
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
  const questReadout = el("quest-readout");
  /**
   * AR mode's entry point (DEC-12, AR milestone 1).
   *
   * Looked up here with the other controls; the behaviour is wired below, once
   * `buildingView` exists. Its appearance is DERIVED by `arButtonState` and
   * never toggled here — see that module for why the map is not a function of
   * AR support.
   */
  const arButton = el<HTMLButtonElement>("enter-ar");
  // IN LEAFLET'S OWN BOTTOM-RIGHT STACK, above the attribution credit (F3a).
  //
  // THIS COMMENT SAID "ABOVE THE LOCATE BUTTON … Leaflet APPENDS controls to
  // the corner in registration order" AND WAS WRONG ON BOTH COUNTS (PR review
  // of the attribution milestone, finding 3). Leaflet PREPENDS into a bottom
  // corner — `corner.insertBefore(container, corner.firstChild)` — so the
  // FIRST control registered ends up LOWEST. Registration order here is
  // attribution, then AR, then locate, which renders top-to-bottom as
  // locate / AR / attribution.
  //
  // So the locate button is above this one, not below it, and has been since
  // the AR control was added. Left as it renders rather than swapped: the part
  // that is load-bearing is that BOTH sit above the attribution credit, which
  // may not be obstructed, and that is true either way. Which of the two
  // buttons is uppermost is a preference nobody has stated, and inverting it
  // silently inside a review-application commit would be a UI change the owner
  // never asked for. Flagged instead.
  //
  // `disableClickPropagation` for the same reason the locate control needs
  // it: without it a press also reaches the map underneath and reads as
  // "the user clicked here to move", so entering AR would first teleport
  // them to the button's own position.
  /**
   * The wrapper, held so it can be hidden with its button.
   *
   * WHY THE WRAPPER AND NOT JUST THE BUTTON. `.leaflet-bar` carries a border,
   * a corner radius and a drop shadow of its own, and `.ar-control` reserves
   * margin below it — so hiding only the button leaves a small empty box
   * floating above the locate control. That is the state EVERY desktop browser
   * and every iOS Safari is in, because `arButtonState` hides the button
   * outright where `immersive-ar` is unsupported. `LocateControl` never hits
   * this because its button is never hidden.
   */
  let arControlWrapper: HTMLElement | undefined;
  const ArControl = L.Control.extend({
    onAdd: (): HTMLElement => {
      const wrapper = L.DomUtil.create("div", "leaflet-bar ar-control");
      wrapper.append(arButton);
      L.DomEvent.disableClickPropagation(wrapper);
      arControlWrapper = wrapper;
      return wrapper;
    },
  });
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
   * A flag rather than a field on the action because the ANCHORING rule is the
   * demo's alone: the framework's slice is shared with every other app, and
   * `placeChanged` (DEC-R12-8) carries what the STORE needs to know, which is
   * only that the snapshot is no longer about the place in view.
   */
  let placeChangeDeclared = false;
  /**
   * The picker id behind that flag, or `undefined` for travel.
   *
   * Read and cleared alongside it, so the URL is written from the same fact the
   * anchor is: a named place writes `?site=`, anything else writes coordinates
   * (DEC-R12-5).
   */
  let declaredSiteId: string | undefined;

  /** The demo's URL, written on every position change. See `url-state.ts`. */
  const placeUrl = browserPlaceUrl(window);

  attachSitePicker({
    select: el<HTMLSelectElement>("site"),
    onChoose: (place) => {
      mapView.centreOn(place.position);
      declaredSiteId = place.id;
      // A DECLARED place change, not travel. The picker spans Cologne to Tokyo,
      // so the scene anchor must be re-taken regardless of distance — and two
      // entries a few hundred metres apart are still two different scenes.
      // Consumed by the position subscriber below, which is what calls refresh.
      placeChangeDeclared = true;
      // `placeChanged`, NOT `positionChanged` (DEC-R12-6/8). The eighth session
      // jumped New York -> London and watched New York's buildings stay on
      // screen for the whole 20-30 s fetch, under a status line already naming
      // London. This action clears the snapshot and the geo-event; the ordinary
      // one deliberately does not, because a walk moves to a scene about to be
      // mostly identical.
      store.dispatch(actions.placeChanged(place.position));
    },
  });

  /**
   * The last fix's reported horizontal accuracy, for the AR readout (M4).
   *
   * §4 predicts that GPS fix quality, not rendering, is the binding constraint
   * on whether AR feels right — and the plan says every figure that cannot be
   * measured must be reported as unmeasured rather than estimated. This is the
   * one the browser hands over for free, so leaving it off screen would be
   * choosing to guess at the thing the milestone is about.
   *
   * `undefined` until a fix reports one, which is what keeps it off the HUD
   * rather than showing as `0`.
   */
  let lastFixAccuracyM: number | undefined;
  // THE RAW VERTICAL PAIR, kept beside the horizontal one and for the same
  // reason: the readout is about the quality of the fixes arriving. Without
  // these, the HUD can show what the alignment DID to the altitude but not what
  // it was given, and those are the two hypotheses the height residual needs
  // separating.
  let lastAltitudeM: number | undefined;
  let lastAltitudeAccuracyM: number | undefined;
  /**
   * The last RAW fix, for the readout's distance line (M4, r510 review).
   *
   * NOT `selectOsmView(...).position`, which while AR is live only advances on
   * fixes that clear the 100 m gate — so the readout would show `0 m from
   * anchor` for the first ~71 s of walking and then jump. A staircase reading
   * of zero is exactly what `ar-measurements.ts` refuses to print for a missing
   * value, arriving by a different route.
   */
  let lastFixPosition: { lat: number; lng: number } | undefined;
  /**
   * Where the user was last known to be. **Never cleared.**
   *
   * SEPARATE FROM `lastFixPosition` BECAUSE THE TWO WANT OPPOSITE THINGS, and
   * conflating them was a real bug (PR review of P3, finding 2).
   * `lastFixPosition` is cleared on a locate FAILURE, deliberately (r511
   * review): a readout that keeps saying "N m from anchor" after the watch died
   * reads as the user having stopped moving, which is the more misleading half
   * of a stale display.
   *
   * The AR entry gate needs the opposite. It asks "is the app showing where you
   * are", and a failed lookup does not move the user — so reading the cleared
   * variable made ONE failed fix render AR unenterable in a single tap for as
   * long as GPS kept failing, however good the immutable origin was. The
   * readout must forget a dead fix; the gate must remember where you were.
   */
  let lastKnownFixPosition: { lat: number; lng: number } | undefined;
  /**
   * When the last fix arrived, epoch ms.
   *
   * **A STALE FIX AND A FRESH ONE ARE INDISTINGUISHABLE** on every other line of
   * the readout, and a large share of "the alignment drifted" observations are
   * really "no fix has arrived for 40 s". Wall time rather than the frame clock
   * because that is what the fix itself is stamped against.
   */
  let lastFixAtMs: number | undefined;

  /**
   * The loop the 2026-08-14 report found missing: fixes → store → alignment.
   *
   * DECLARED BEFORE `locateControl` because that control's `onLocated` closes
   * over it and a `const` in the temporal dead zone would throw on the first
   * fix. Inert until `startWalking` calls `start()`.
   *
   * The seams are the real framework functions; they are injected rather than
   * imported inside the module because `sensors` and `state` touch browser
   * sensors and module-level caches at import time, and the demo's unit suite
   * runs in Node.
   */
  const gpsRegistration = createGpsRegistration({
    store,
    getArPose: getCurrentArPose,
    seams: {
      createGpsPositionHandler,
      startOrientationWatch,
      stopOrientationWatch,
      updateDeviceOrientation,
      startAbsoluteOrientationWatch,
      stopAbsoluteOrientationWatch,
      requestDeviceOrientationPermission,
      startSession,
      endSession,
    },
  });

  // MOUNTED BEFORE THE LOCATE CONTROL, which puts it ABOVE the attribution
  // credit and BELOW the locate button — see the comment beside `arButton`
  // above for why that is the opposite of what this used to claim. What
  // matters and is true: Leaflet prepends into a bottom corner, the attribution
  // control registers first in `map-view.ts`, and so the credit stays lowest
  // and unobstructed.
  new ArControl({ position: "bottomright" }).addTo(mapView.map);

  const locateControl = new LocateControl({
    map: mapView.map,
    // A real fix moves the "user" through the same action a map click uses, so
    // there is no second refresh path that could disagree with the first.
    onLocated: (position) => {
      // RECORDED BEFORE THE GATE, on every fix. The readout is about the QUALITY
      // of the fixes arriving, so a fix the gate rejects is exactly as
      // informative as one it accepts — arguably more, since a session spent
      // standing still is all rejected fixes.
      lastFixAccuracyM = position.accuracyM;
      // NULL MEANS THE BROWSER OMITTED IT, and the readout distinguishes absent
      // from zero — so null becomes undefined rather than 0. Android commonly
      // reports a null altitudeAccuracy even with a good altitude.
      lastAltitudeM = position.altitude ?? undefined;
      lastAltitudeAccuracyM = position.altitudeAccuracy ?? undefined;
      lastFixPosition = { lat: position.lat, lng: position.lng };
      lastKnownFixPosition = lastFixPosition;
      lastFixAtMs = Date.now();
      // REGISTRATION IS NOT GATED, and that separation is the fix for the
      // 2026-08-14 report ("no automatic updates of the user position … the
      // store … automatic alignments … missing entirely").
      //
      // Every fix feeds the fusion; only REFETCHING waits for 100 m. The two
      // were the same thing while this callback existed to move the map, and
      // conflating them again would mean the alignment is re-solved once per
      // 100 m of walking rather than once per fix — i.e. the city would lurch
      // at each gate opening instead of tracking the user.
      //
      // A no-op outside AR: `onFix` does nothing until `start()`, so a desktop
      // user clicking the locate button never enters the fusion.
      gpsRegistration.onFix(toGpsPosition(position));
      // Recentre on the LOCATE path only. The shared `view.position` subscriber
      // deliberately does not, because a map click already happens where the
      // user is looking and recentring there would yank the map from under
      // them. A fix is usually somewhere else entirely, and at zoom 18 that
      // means off screen.
      //
      // THE AR GATE SITS HERE, ABOVE EVERYTHING (milestone 3, moved up by the
      // r509 review). Under a watch this callback fires ~1 Hz for the whole
      // session, and the first version gated only the fetch at the bottom of
      // the position subscriber — so every fix still dispatched
      // `positionChanged` and still paid for:
      //
      //  - `mapView.centreOn` fighting any pan the user makes on the map DEC-12
      //    keeps beside the AR view,
      //  - `writePlace`'s `history.replaceState`, ~1 800 times per half-hour
      //    walk, since a 10–30 m fix changes the 5-decimal string every time,
      //  - `buildingView.recentre`, which schedules a repaint of the desktop
      //    2.8 km city on a SECOND live GL context at 1 Hz while the XR loop
      //    runs at display rate,
      //  - and, worst, a store position advancing past a position whose terrain
      //    was never loaded — which `demo-worker.ts` states as a safety
      //    invariant, and which strands any later build behind the full 15 s
      //    terrain timeout.
      //
      // The controller dispatches the position change itself for the fixes that
      // pass, so everything below stays exactly as true as it was.
      if (arWalk !== undefined) {
        arWalk.positionChanged(position);
        return;
      }
      mapView.centreOn(position);
      store.dispatch(actions.positionChanged(position));
      // AND THIS IS WHAT MAKES AR REACHABLE AT ALL (AR milestone 1).
      //
      // `zero` is the framework's session anchor and the frame the fusion's
      // alignment matrix is expressed against. NOTHING ELSE IN THIS DEMO SETS
      // IT: the framework's own GPS coordinator returns early unless a
      // recording is in progress, and this demo records nothing — so without
      // this dispatch `selectZeroReference` stays null forever and the AR
      // button sits permanently disabled on "Waiting for a GPS fix".
      //
      // `setZeroPos` is a no-op once set, so first fix wins and the anchor is
      // immutable for the session — which is DEC-R11-6's rule enforced by the
      // reducer rather than by this call site remembering it.
      //
      // A LOCATE FIX, NOT A MAP CLICK. A click is "show me there"; only a real
      // fix is "I am here", and anchoring the AR scene to a place the user
      // merely looked at is the offset this whole path exists to avoid.
      store.dispatch(setZeroPos({ lat: position.lat, lon: position.lng }));
      // AND THE SECOND HALF OF AN AR PRESS, if that is what asked for this fix
      // (DEC-W2). Placed AFTER the dispatches above deliberately: the offer's
      // promise is "pressing AR now works", and `shouldOfferAr` asks
      // `arPressAction` to confirm exactly that — which it can only answer
      // correctly once `zero` and the view position are the ones this fix
      // produced.
      maybeOfferAr();
    },
    // `nonFatalError` rather than `fetchFailed` because the BEHAVIOUR is what
    // matters here: a refused GPS permission says nothing about the data on
    // screen, so it must report without blanking the map. The action's name is
    // narrower than its meaning ("an error that preserves the snapshot") —
    // recorded as a follow-up rather than renamed mid-round, since it is a
    // published framework API.
    onError: (message) => {
      // THE READOUT MUST NOT KEEP SHOWING A DEAD FIX (M4, r510 review). A
      // `watchPosition` outage — indoors, an urban canyon — fires this about
      // once a second while `locationfound` stops arriving, and without this
      // the HUD would display the last good `fix ±N m` for the rest of the
      // session. That is worse than showing nothing, because it is plausible:
      // the number the milestone exists to read would be quietly historical.
      lastFixAccuracyM = undefined;
      lastAltitudeM = undefined;
      lastAltitudeAccuracyM = undefined;
      // AND THE POSITION WITH IT (r511 review). Clearing only the accuracy left
      // half the stale readout on screen: the fix line disappeared while
      // "N m from anchor" kept reporting the last good fix — the more
      // misleading half, because it reads as the user having stopped moving.
      lastFixPosition = undefined;
      // AND THE FIX AGE WITH IT, for the same reason: an age left ticking after
      // the watch failed reads as a fix that is still arriving, which is the
      // opposite of what has happened.
      lastFixAtMs = undefined;
      // BUT NOT `lastKnownFixPosition`, and NOT the AR intent — see below.
      //
      // THE AR PRESS'S INTENT IS SPENT (PR review of P3, finding 1). The
      // operation it asked for has failed, so the offer it was waiting for must
      // never arrive. Without this the flag stayed armed indefinitely: press AR
      // indoors, the one-shot times out, and then a PLAIN GPS PRESS minutes
      // later pops up "Enter AR now" for a press the user never made — which is
      // exactly the failure the plan named as worse than the one being fixed.
      awaitingArFix = false;
      // TO THE SURFACE THE USER CAN ACTUALLY SEE (r511 review). During a
      // session the status line is outside WebXR's dom-overlay root and is not
      // composited at all — which milestone 3 discovered and then left this
      // path pointing at anyway. A GPS failure while immersed is exactly when
      // the user most needs telling: the city stops following them, and without
      // this the only signal is that nothing happens.
      if (arSession !== undefined) arToast.show(message);
      store.dispatch(actions.nonFatalError(message));
    },
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
  // NOT BOUND TO A NAME ANY MORE. The only thing that held it was
  // `revealForError`, retired with DEC-R2-15 (DEC-U10) now that errors have a
  // toast; the collapse behaviour itself is entirely user-driven from here on.
  attachHeaderCollapse({
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
    // THE DATUM THE MESH MUST STAND ON. A getter, not a value: this cycle
    // outlives an AR session and the datum changes with the mode. Reading the
    // one held value here is what keeps the mesh build's declared datum and the
    // terrain load's requested datum identical — the worker's gate compares
    // them, and two independent samples would be two chances to disagree.
    geoidUndulationM: () => arUndulationM,
    // THE CLICK-PATH BREAKDOWN, one line per ring. `console.info` rather than
    // the status bar for the reason `describeGeoEventStats` uses it: this is a
    // developer diagnostic and the status line already carries the cell counts
    // a user reads.
    //
    // ALWAYS ON, not behind a flag (plan §6.2). The alternative risks the
    // numbers existing only when someone remembers to enable them — and the
    // whole reason this instrument exists is that the click path went six weeks
    // unmeasured while looking measured. Three lines per click is the cost.
    onTimings: (timings) => {
      // eslint-disable-next-line no-console -- the breakdown's only output.
      console.info(describeClickTimings(timings));
    },
    // THE CLICK-LEVEL LINE, after the three ring lines. Its `page-residual` is
    // the only place time spent OUTSIDE the worker round trips can appear —
    // the per-ring residual cancels page time out by construction.
    onClickSummary: (summary) => {
      // eslint-disable-next-line no-console -- the breakdown's only output.
      console.info(describeClickSummary(summary));
    },
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
    const view = selectOsmView(store.getState());
    geoEventButton.disabled = busy;
    geoEventButton.textContent = geoEventButtonLabel(busy);
    // THE READOUT, NOT THE BUTTON, CARRIES THE DISTANCE NOW (F4a). Repainted
    // from the same `(position, geoEvent)` the label used to be a function of,
    // which is what makes it re-read as the user walks — F56's recorded win,
    // and the thing a constant label would otherwise have deleted.
    const readout = geoEventReadout(view);
    questReadout.textContent = readout;
    questReadout.hidden = readout === "";
  };

  /**
   * The geo-event search, wired HERE rather than where the button is looked up,
   * because it needs `refresh` — see `geo-event-cycle.ts` for why a successful
   * search republishes at all.
   */
  const runGeoEventSearch = createGeoEventCycle({
    store,
    actions,
    worker,
    setBusy: paintGeoEventButton,
    republish: () => refresh(),
    // THE TWO THINGS THAT REPLACE THE BUTTON'S OLD LABEL (F4a, F4c, DEC-U12).
    //
    // The description used to BE the button, which is why it grew and shrank on
    // every press. It now goes to the toast — where it is a result announcement
    // rather than a control's caption — and the map pans to the winner so the
    // marker is actually on screen, which is what F56's label existed to
    // substitute for.
    //
    // `panTo`, NOT `centreOn`: that one moves the user's own marker first, so
    // reusing it would teleport the user onto the quest.
    onFound: (event) => {
      const view = selectOsmView(store.getState());
      toast.show(describeGeoEvent(view.position, event));
      const nearest = event.picks[0];
      if (nearest !== undefined) mapView.panTo(nearest.position);
    },
    // W7's benchmark line. `console.info` rather than the status bar: it is a
    // developer diagnostic taken once per press, and the status line is already
    // carrying the cell counts a user reads. `describeGeoEventStats` puts the
    // three phase timings first, because which one dominates is what picks the
    // lever DEC-G7 defers to.
    onStats: (stats) => {
      // eslint-disable-next-line no-console -- the benchmark's only output.
      console.info(describeGeoEventStats(stats));
    },
  });

  /**
   * The quest search, COALESCED (DEC-U13).
   *
   * WHY THE WRAPPER EXISTS, and it was claimed before it did. DEC-U13 makes the
   * category picker live while a search runs, so two searches can genuinely be
   * asked for in quick succession — and `worker.call` is a plain id-keyed RPC
   * with no coalescing of its own, so both would resolve and both would
   * dispatch, in completion order. That is the stale-wins race the decision was
   * written to prevent.
   *
   * `latestOnly` gives the three things the decision asked for: at most one
   * search in flight, the newest input winning, and the abandoned run's late
   * result discarded rather than published.
   *
   * **The comment on the button's handler asserted this before it was true.**
   * It named a `latestOnly` "inside `createGeoEventCycle`" that did not exist;
   * what actually discarded a superseded result was a category comparison deep
   * in the cycle, and that only guarded the store publish — not the toast or
   * the map pan. Found by the milestone review.
   */
  const findGeoEvent = latestOnly(async (requested: number | undefined) => {
    await runGeoEventSearch(requested);
  });

  /**
   * The agent's order, wired HERE because it needs the worker and the anchor.
   *
   * WRAPPED IN `latestOnly` for the reason `refresh` is: the scene stays
   * clickable while a route is being planned, and a route search is synchronous
   * inside the worker — an `abort` cannot preempt it, so the honest guarantee is
   * "the newest click wins", not "the superseded one is cancelled". Without the
   * wrapper two clicks would draw two routes in whichever order they settled.
   */
  const planAgentRoute = createAgentCycle({
    worker,
    // WHERE THE AGENT IS, falling back to the user only before it has been
    // anywhere. DEC-R11-3 says "select an agent, click a destination"; with
    // exactly one agent there is nothing to select, so the user's position is
    // where it STARTS — not where it permanently lives.
    //
    // Reading the user's position for both is what shipped first, and it made
    // the agent teleport: a second order without moving planned from the user
    // again, and `followRoute` snapped the cone back to that start before it
    // began walking. Raised in review on #274.
    agentAt: () => {
      const standing = buildingView.agentAt();
      if (standing === undefined)
        return selectOsmView(store.getState()).position;
      // The same scene→ENU→lat/lng conversion the click uses, and deliberately
      // the same expression: two spellings of the north reflection is how they
      // come to disagree.
      return enuFrameAt(anchors.origin).toLatLng({
        x: standing.x,
        y: -standing.z,
      });
    },
    frameOrigin: () => anchors.origin,
    setBusy: (busy) => {
      // ON THE CANVAS, because the canvas is what was clicked — there is no
      // button to relabel. `index.html` turns this into `cursor: progress`, and
      // the e2e reads the attribute for the same reason it reads
      // `data-frame-origin` rather than a screenshot.
      el("scene").dataset["routing"] = String(busy);
    },
    showRoute: (route) => {
      buildingView.followRoute(
        scenePathOf(route, enuFrameAt(anchors.origin), ROUTE_LIFT_M),
      );
    },
    // `nonFatalError`, never `fetchFailed`: a route that could not be planned
    // says nothing about whether the map on screen is good, and `fetchFailed`
    // clears the snapshot and every selection. Same split the geo-event cycle
    // and the locate control already use.
    report: (message) => store.dispatch(actions.nonFatalError(message)),
  });
  // ONE `latestOnly` CHANNEL FOR EVERY WAY OF ORDERING (stage 3, DEC-R13-6).
  // A cell click and a ground click are the same intent — "go there" — so they
  // must supersede each other; two wrappers would let a cell order and a ground
  // order both be in flight, and the loser would draw its route over the winner.
  // Taking a `LatLng` rather than a `ScenePoint` is what makes that possible:
  // the cell branch already knows a position and would otherwise have to invent
  // scene coordinates only for this function to convert them straight back.
  const orderAgent = latestOnly(async (destination: LatLng) => {
    await planAgentRoute(destination);
  });
  orderAgentTo = (point) => {
    // SCENE → ENU → LAT/LNG, through the anchor's own frame. `z` is negated
    // because the scene puts north at `-z`; doing it here rather than in
    // `pick.ts` keeps that module free of the frame, which is re-taken on a
    // teleport and would go stale in a second copy.
    const frame = enuFrameAt(anchors.origin);
    void orderAgent(frame.toLatLng({ x: point.x, y: -point.z }));
  };
  /**
   * How often the moving camera may rewrite the URL.
   *
   * A SAMPLE INTERVAL, NOT A QUIET PERIOD, and that distinction was learned the
   * hard way: this was a 400 ms debounce first, and it never fired once in a
   * real browser. `enableDamping` keeps easing the camera after the pointer is
   * released, and this view renders on demand — so each `change` schedules a
   * frame, the frame updates the controls, and damping fires `change` again,
   * measured at about one event per 200 ms until it converged. A deadline that
   * moved with each event never arrived. See `throttle.ts`.
   *
   * 400 ms is far longer than a frame and far shorter than the pause before
   * anyone reaches for the address bar, so a pan writes a handful of times while
   * it happens and is correct the moment it stops.
   */
  const CAMERA_URL_SAMPLE_MS = 400;

  const writeCameraView = throttle((view: CameraView) => {
    // SCENE → ENU → LAT/LNG, the same conversion `orderAgentTo` makes and for
    // the same reason: `z` is negated because the scene puts north at `-z`, and
    // doing it here keeps the view free of a frame that is re-taken on every
    // teleport. THAT CONVERSION IS ALSO WHAT MAKES THIS SAFE — DEC-R12-5
    // rejected a camera pose because one recorded against a scene anchor is
    // meaningless after a re-anchor, and a lat/lng target has no anchor in it.
    const frame = enuFrameAt(anchors.origin);
    writeCamera(placeUrl, {
      target: frame.toLatLng({ x: view.target.x, y: -view.target.z }),
      distanceM: view.distanceM,
    });
  }, CAMERA_URL_SAMPLE_MS);
  reportCameraView = (view) => writeCameraView(view);

  // H2 — THE MAP'S +/- NOW DRIVE THE 3D CAMERA.
  //
  // `zoomend`, not `zoom`: Leaflet fires `zoom` continuously through a pinch or
  // an animated button press, and re-aiming the camera on every one of those
  // fights the user's gesture and rewrites the shareable camera URL dozens of
  // times per interaction (`writeCameraView` is sampled, but the target moves
  // regardless). `zoomend` is one event per settled zoom.
  //
  // THE TARGET IS KEPT, only the distance changes — `lookAtFrom` is the
  // read/write pair's write side and preserves the camera's direction, so this
  // dollies rather than teleporting. Panning the map deliberately does NOT move
  // the 3D view; the session asked for zoom.
  mapView.map.on("zoomend", () => {
    const canvas = el("scene");
    const height = canvas.clientHeight;
    const distanceM = cameraDistanceForZoom({
      zoom: mapView.map.getZoom(),
      latDeg: mapView.map.getCenter().lat,
      paneWidthPx: mapView.map.getContainer().clientWidth,
      // A zero height would divide to Infinity; the conversion rejects a
      // non-finite aspect and falls back to its clamp, but computing NaN here
      // and relying on that is a worse contract than not producing it.
      aspect: height > 0 ? canvas.clientWidth / height : 1,
      vfovDeg: CAMERA_VFOV_DEG,
    });
    buildingView.lookAtFrom(buildingView.cameraView().target, distanceM);
  });

  // AND THE READ SIDE, WHICH IS THE HALF MOST EASILY FORGOTTEN: a link nothing
  // honours is worse than no link. Applied once, at boot, after the anchor
  // exists — a later application would fight the user's own dragging.
  const startCamera = parseCameraTarget(window.location.search);
  if (startCamera !== undefined) {
    const enu = enuFrameAt(anchors.origin).toEnu(startCamera.target);
    buildingView.lookAtFrom(
      { x: enu.x, y: 0, z: -enu.y },
      startCamera.distanceM,
    );
  }

  orderAgentToCell = (cell) => {
    // THE CELL CENTRE, NOT THE RAYCAST POINT (DEC-R13-6). The cell is what the
    // user aimed at, and the route is planned in cells anyway — using the exact
    // hit would quantise to the same cell in the common case and to the
    // neighbour at a grazing angle, which is a different destination than the
    // one the details panel just opened on.
    const [lat, lng] = cellToLatLng(cell);
    void orderAgent({ lat, lng });
  };

  const geoEventPicker = new GeoEventPicker({
    container: el("geo-event-picker"),
    onSearch: (requested) => void findGeoEvent(requested),
    onClear: () => store.dispatch(actions.geoEventFound(undefined)),
  });

  /**
   * The button's two meanings (G1, DEC-G1).
   *
   * WITH NOTHING FOUND it searches, which keeps the common case one tap. WITH
   * AN EVENT ON THE MAP it opens the picker instead, because a second press
   * used to re-run the identical search — exactly identical, since the event is
   * a pure function of tile and quarter-hour, so within one slot it could not
   * produce anything new. It read as a broken button.
   *
   * The dialog opens on the HELD event's time rather than on now, so the common
   * edit is "the same place two hours later".
   */
  geoEventButton.addEventListener("click", () => {
    // THE PICKER OPENS ON THE FIRST PRESS (F4f, DEC-U13), alongside the search
    // rather than instead of it.
    //
    // It used to take two presses: the first searched, and only a second — with
    // an event already held — opened the picker. That made the second press
    // mean something different from the first, and the owner asked for the
    // choice to be visible immediately.
    //
    // AND IT IS LIVE WHILE THE SEARCH RUNS (DEC-U13), chosen over
    // visible-but-disabled. The picker and the map must agree once things
    // settle, which `latestOnly` around `findGeoEvent` is what delivers — see
    // its definition. The accepted cost is that flipping rapidly on a slow
    // connection completes nothing until you stop.
    //
    // OPENED ONLY WHEN IT IS CLOSED. `open()` refills the date and time inputs
    // from the held quest, so calling it unconditionally would silently discard
    // whatever the user had just typed — press the button after editing the
    // time and your edit is replaced by the old value. The previous two-press
    // design closed on the second press and could not hit this.
    const held = selectOsmView(store.getState()).geoEvent;
    if (!geoEventPicker.isOpen) {
      geoEventPicker.open(new Date(held?.eventTime ?? Date.now()));
    }
    void findGeoEvent(undefined);
  });

  /**
   * AR MODE (DEC-12, AR milestone 1).
   *
   * The button's appearance is DERIVED by `arButtonState` from three facts and
   * repainted whenever any of them changes; nothing here toggles `hidden` or
   * `disabled` directly. That is what keeps DEC-12's rule — the map stays,
   * always — from becoming a function of AR support by accident.
   *
   * THE ORIGIN IS THE FRAMEWORK'S `zero`, not the demo's position. The demo's
   * position moves on every map click; `zero` is taken from the first GPS fix
   * and is what the fusion's alignment matrix is expressed against. Anchoring
   * anywhere else means the camera and the city disagree by however far the
   * two have drifted. See `ar-origin.ts`.
   */
  /**
   * The geoid, decoded once and only if AR is used.
   *
   * LAZY BY DESIGN: the grid is ~170 KB behind its own entry point precisely so
   * an app that never needs absolute heights never pays for it, and the desktop
   * path never does. Owner decision 2026-08-12 chose `egm96Geoid()` over a
   * regional constant -- it is the C# reference sampled to 1 degree, and at
   * Cologne its worst case is 0.59 m against a DEM that is metres out.
   */
  let geoidModel: GeoidModel | undefined;
  /**
   * A DYNAMIC import, which is what makes the claim above true.
   *
   * The first version imported `egm96Geoid` statically and deferred only the
   * decode — so every desktop page load shipped the ~176 KB base64 grid it
   * never uses, while the comment claimed the opposite. `egm96.ts` statically
   * imports the grid module, so nothing short of a dynamic import keeps it out
   * of the main chunk.
   *
   * Awaited on the AR path only, where one module fetch is invisible against a
   * WebXR session start.
   */
  const geoid = async (): Promise<GeoidModel> => {
    if (geoidModel === undefined) {
      const { egm96Geoid } = await import("gps-plus-slam-osm/elevation/egm96");
      geoidModel = egm96Geoid();
    }
    return geoidModel;
  };

  /**
   * The geoid undulation AR is currently using, or `undefined` on the desktop.
   *
   * **THE DEMO'S ONE ANSWER TO "what is the terrain measured from?"**, and it
   * has to be one answer because two consumers now ask: the terrain load, which
   * samples the field against it, and the mesh build, which must declare the
   * same datum so the worker's gate can tell a matching field from a stale one.
   *
   * **Resolved BEFORE the AR entry pass, which is the whole point.** The geoid
   * is a dynamic import; the first version sampled it inline in the terrain
   * request, so the terrain path awaited a module fetch while the mesh build
   * posted immediately — the mesh was therefore built against the desktop
   * field, with its window-centre datum, while the camera was lifted to
   * ellipsoidal height. The owner saw that as flying ~50 m above the buildings
   * on first entry and landing within ~4 m on the second, the second being
   * right only because the AR field was by then already held.
   */
  let arUndulationM: number | undefined;

  let arSupport: ArSupport = "checking";
  let arSession: ArMode | undefined;
  /**
   * Follows the user while AR runs (milestone 3). `undefined` means the
   * position subscriber takes its ordinary, ungated path.
   *
   * SEPARATE FROM `arSession` rather than derived from it, because the two have
   * genuinely different lifetimes at the edges: the session exists for the
   * moment between `startArMode` resolving and `startWalking` being called, and
   * a fix arriving in that window must take the ungated path rather than be
   * dropped.
   */
  let arWalk: ArWalk | undefined;
  /**
   * The only surface a message can reach an immersed user on.
   *
   * INSIDE `#ar-root`, which is what `initAR` hands WebXR as `domOverlay.root`
   * — the browser composites only that subtree over the camera feed. The
   * header's status line is outside it, so anything written there during a
   * session is invisible for exactly as long as it matters (r509 review).
   */
  const arToast = createArToast(el("ar-root"));
  // THE 2D ERROR CHANNEL (N3, DEC-U10). Until this existed every non-AR
  // message went to the header status line, which is why the header had to
  // pop itself open on every error: a message written into a collapsed
  // header is a message nobody sees. This is what lets that rule retire.
  const toast = createToast(el("toast-root"));

  /**
   * Whether an AR press is still waiting for the fix it asked for (DEC-W2).
   *
   * OWNED HERE RATHER THAN IN `ar-entry.ts` because it is the one part of the
   * decision that is a lifetime rather than a rule: it has to be set by the
   * press, read by the fix that follows, and dropped on anything that
   * supersedes the intent. An offer that outlives the user's interest — or one
   * that appears because they pressed the GPS button — is a worse bug than the
   * one this replaces.
   *
   * Cleared on: entering AR, exiting AR, pressing AR again, the offer being
   * taken or dismissed, and **a locate failure** — the operation the press
   * asked for is then spent, so the offer it was waiting for must never come.
   *
   * NOT cleared by a map click or a city jump made DURING the wait, and that is
   * a deliberate gap rather than an oversight: the arriving fix re-centres the
   * view, so `shouldOfferAr` re-asks `arPressAction` at the moment that
   * matters and answers correctly either way. `syncArOffer` covers the same
   * ground once the prompt is actually on screen.
   */
  let awaitingArFix = false;

  const currentPressAction = (): ArPressAction =>
    arPressAction({
      sessionRunning: arSession !== undefined,
      hasOrigin: canEnterAr(selectZeroReference(store.getState())),
      // THE NEVER-CLEARED ONE. See its declaration for why the readout's
      // variable is the wrong one to gate entry on.
      lastFix: lastKnownFixPosition,
      viewPosition: selectOsmView(store.getState()).position,
    });

  /**
   * The last painted state, so the DOM is written only when it CHANGES.
   *
   * This runs on every dispatch, and the demo dispatches a ~931-cell snapshot
   * three times per click. The derivation is four branches and a memoised
   * selector — genuinely cheap — but `textContent =` is not a no-op even when
   * the string is identical: it tears down and recreates the text node and
   * dirties that element's layout. Guarding on the derived state rather than
   * subscribing to one slice is what makes this correct AND cheap, since the
   * button depends on framework state the demo's own change-only `subscribe`
   * helper cannot select.
   */
  let paintedAr = "";

  const paintArButton = (): void => {
    // BEFORE THE CHANGE GUARD BELOW. The offer can go stale while the button's
    // own derived state does not change at all — moving the view away turns
    // "enter" into "locate", which changes `willLocateFirst`, but a later paint
    // with an unchanged key must not leave a stale prompt on screen either.
    syncArOffer();
    const state = arButtonState({
      support: arSupport,
      willLocateFirst: currentPressAction().kind === "locate",
      active: arSession !== undefined,
    });
    const key = `${String(state.hidden)}|${String(state.disabled)}|${state.label}|${state.hint ?? ""}`;
    if (key === paintedAr) return;
    paintedAr = key;

    arButton.hidden = state.hidden;
    if (arControlWrapper !== undefined) arControlWrapper.hidden = state.hidden;
    arButton.disabled = state.disabled;
    // THE GLYPH IS CONSTANT; THE WORDING MOVES TO THE ACCESSIBLE NAME (F3a).
    //
    // The button is a 2 rem square now, and "Exit AR" does not fit one without
    // making it grow — which is the resizing defect being removed elsewhere in
    // this round. So the face always reads "AR" and `aria-label` carries the
    // state, exactly as `.locate-button` does: on touch a `title` never shows,
    // so the accessible name is the only thing that reaches everyone.
    arButton.textContent = "AR";
    // THE HINT GOES IN THE NAME, not only in `title`. "Supported but no GPS
    // fix yet" is the one state `arButtonState` distinguishes hidden from
    // disabled for — and without this its accessible name is just "AR",
    // identical to every other state, so the distinction the whole type exists
    // for never reaches anyone. `title` alone cannot carry it: this file
    // argues three lines up that a title never shows on touch.
    arButton.setAttribute(
      "aria-label",
      state.hint === undefined ? state.label : `${state.label} — ${state.hint}`,
    );
    arButton.dataset["arActive"] = String(arSession !== undefined);
    // Cleared rather than left stale: the hint explains a DISABLED state, and
    // a tooltip surviving into the enabled one describes a condition that no
    // longer holds.
    if (state.hint === undefined) arButton.title = state.label;
    else arButton.title = `${state.label} — ${state.hint}`;
  };

  const arOffer = el("ar-offer");

  /**
   * Takes the offer down.
   *
   * IDEMPOTENT AND CALLED LIBERALLY. The failure mode being designed against is
   * an offer that outlives the intent behind it, so every path that could make
   * it stale calls this rather than reasoning about whether it is showing.
   */
  const clearArOffer = (): void => {
    arOffer.hidden = true;
    awaitingArFix = false;
  };

  /**
   * Offers AR entry, if a press asked for the fix that just arrived.
   *
   * A REAL CONTROL, NOT A TOAST, and the difference is the point. A toast fades
   * on its own; this is the second half of an action the user started, so it
   * has to still be there when they look back at the screen after walking
   * outside to get a fix.
   */
  const maybeOfferAr = (): void => {
    if (
      !shouldOfferAr({
        awaitingFix: awaitingArFix,
        sessionRunning: arSession !== undefined,
        hasOrigin: canEnterAr(selectZeroReference(store.getState())),
        lastFix: lastKnownFixPosition,
        viewPosition: selectOsmView(store.getState()).position,
      })
    ) {
      return;
    }
    arOffer.hidden = false;
    paintArButton();
  };

  /**
   * Takes a showing offer down once it has stopped being true.
   *
   * The offer says "enter AR now", so it may not survive the view being moved
   * somewhere else — a map click or a jump to another city between the fix
   * landing and the user looking at the screen. Asking `arPressAction` again is
   * what keeps the prompt and the button from ever disagreeing.
   */
  const syncArOffer = (): void => {
    if (arOffer.hidden) return;
    if (currentPressAction().kind !== "enter") clearArOffer();
  };

  // The probe is a promise and the button starts hidden, so this resolves into
  // a repaint rather than blocking boot.
  void probeImmersiveArSupport().then((supported) => {
    arSupport = supported ? "supported" : "unsupported";
    paintArButton();
  });
  // A fix can land at any time, and `zero` is set by the framework rather than
  // by anything this file dispatches — so the button follows the STORE, not the
  // locate control's callback.
  store.subscribe(paintArButton);
  paintArButton();

  /**
   * Load terrain with the datum the CURRENT mode needs.
   *
   * ABSOLUTE HEIGHTS WHILE AR IS RUNNING, relief otherwise. Sent as a number
   * because the request crosses a structured clone and a GeoidModel is a
   * function. Sampled at the FRAME ORIGIN rather than per post: N varies about
   * 1 m per 100 km, so one value is uniform to ~5 cm across a 4.8 km city.
   *
   * Desktop keeps the window-centre datum: its camera is framed relative to
   * that same moving surface, so absolute heights there would put the ground
   * metres from where the view expects it.
   */
  const loadTerrainForCurrentMode = async (centre: LatLng): Promise<void> => {
    await loadTerrain({
      centre,
      frameOrigin: anchors.origin,
      // READ FROM THE HELD VALUE rather than re-sampled here (2026-08-14). The
      // mesh build must state the SAME datum in its own request or the worker's
      // gate cannot tell whether the held field matches, and two independent
      // `undulationMetres` calls are two chances to disagree. `arUndulationM`
      // is resolved once on AR entry, before the entry pass runs.
      ...(arUndulationM === undefined
        ? {}
        : { geoidUndulationM: arUndulationM }),
    });
  };

  /**
   * Resample terrain because the MODE changed, not because the user moved.
   *
   * THE DATUM ONLY CHANGES WHEN THE TERRAIN IS RESAMPLED, and entering or
   * leaving AR is exactly when it changes. Every other loadTerrain call is
   * driven by a position change -- and all three dispatchers of one (locate,
   * map click, place picker) need the 2D map, which the immersive overlay
   * replaces. Without this the geoid was plumbed all the way through and never
   * sent, so AR rendered the city ~100 m below the user.
   */
  const reloadTerrainForMode = (): void => {
    void loadTerrainForCurrentMode(selectOsmView(store.getState()).position);
  };

  /**
   * The pass a position change starts: terrain and scoring, from ONE position.
   *
   * **HOISTED OUT OF THE SUBSCRIBER SO THE AR CONTROLLER CAN AWAIT IT** (r509
   * review). The gate reopens when the pass is finished, and nothing else can
   * say when that is: `loading.phase` returns to `idle` after every ring while
   * more are still coming, and the subscriber's old `void` calls threw the
   * handles away.
   *
   * `allSettled`, NOT `all`. `Promise.all` rejects on the FIRST rejection, so a
   * failing terrain load — a dynamic `egm96` import, say — would settle this
   * while the refresh was still running, reopen the gate, and let the next fix
   * abort the run that was about to publish. That is the one thing the gate
   * exists to prevent.
   */
  const runPassFor = async (position: LatLng): Promise<void> => {
    // BOTH AT ONCE (W3). These used to be chained — `loadTerrain(p).finally(()
    // => refresh())` — so a ~55 000-post DEM grid was sampled, transferred and
    // applied before the fetch and the scoring even started. They are
    // independent work on the same worker and the wait was pure latency.
    //
    // The mesh still cannot be built on the wrong ground: the worker joins them
    // on the far side, holding the mesh build until the terrain for THAT
    // POSITION has settled (`worker/terrain-gate.ts`).
    await Promise.allSettled([loadTerrainForCurrentMode(position), refresh()]);
  };

  /**
   * The pass the position subscriber most recently started.
   *
   * How the AR controller awaits work it did not start itself: it dispatches
   * the position change, the subscriber runs synchronously and replaces this,
   * and the controller awaits what came back.
   */
  let currentPass: Promise<void> = Promise.resolve();

  /**
   * Start following the user for this session (AR milestone 3).
   *
   * THE WATCH AND THE CONTROLLER ARE STARTED TOGETHER, and that pairing is the
   * safety property rather than a convenience. A `watch: true` locate with no
   * controller behind it IS the §2.6 starvation bug — ~1 Hz fixes into a
   * `latestOnly` refresh, every run aborted by the next, nothing ever
   * published, and no error to show for it.
   */
  const startWalking = (origin: LatLng): void => {
    arWalk = startArWalk({
      origin,
      // WHERE THE DATA IN THE SCENE ACTUALLY IS, which is NOT `origin` (r509
      // review). `zero` is the first locate fix and immutable; the scene's data
      // was fetched for the store position, which a map click or a picker
      // choice moves without touching `zero`. Seeding from `origin` meant that
      // after "locate, then click 2 km away, then enter AR", every real fix was
      // ~0 m from the seed — the gate never opened and AR showed the city from
      // 2 km away, indefinitely and with no error.
      dataAt: selectOsmView(store.getState()).position,
      // THE CONTROLLER DISPATCHES THE POSITION CHANGE. Everything downstream —
      // the URL, the map marker, the anchor, the camera, the fetch — hangs off
      // that one action, so a gated fix must produce it and a rejected one must
      // not. `currentPass` is what the subscriber just started.
      refetch: async (position) => {
        store.dispatch(actions.positionChanged(position));
        await currentPass;
      },
      warn: (message) => arToast.show(message),
    });
    locateControl.startWatch();
    // AND THE FIXES NOW REACH THE FUSION, not only the fetcher (2026-08-14).
    // Started here rather than in `ar-mode.ts` on purpose: `startWalking` /
    // `stopWalking` already own the watch lifecycle and are already proven to
    // run on the Android back gesture, so the registration cannot outlive the
    // watch that feeds it. Fire-and-forget because the only awaited step is the
    // orientation permission, which must not delay the first fetch pass below.
    void gpsRegistration.start();
    // HIDDEN BUT RESIDENT (§3, M5). The desktop view stops drawing and hides,
    // but keeps its GL context, its compiled programs and its uploaded
    // geometry — so leaving AR is instant rather than a 2.8 km mesh rebuild.
    // Two live contexts on the phone is the accepted cost of that.
    buildingView.suspend();
    // ONE PASS ON ENTRY, AND IT IS NOT OPTIONAL (r509 review). The absolute
    // datum is baked into the building/tree/POI VERTICES by the worker, and
    // that only happens in the `update` handler — the `terrain` handler just
    // replaces the field and settles the gate. So `reloadTerrainForMode()`
    // alone moved the ground plane (which AR does not even draw) and left every
    // building at the window-centre datum: the ~98 m error §2.5 exists to
    // remove, disguised as a fusion bug. Without this the datum would first
    // apply after 100 m of walking, and never for a user who stands still.
    currentPass = runPassFor(selectOsmView(store.getState()).position);
    void currentPass;
  };

  /** Stop following. Idempotent, and safe when AR never started. */
  const stopWalking = (): void => {
    locateControl.stopWatch();
    // PAIRED WITH THE START, in the same function, for the same reason the
    // suspend/resume pair is: the back gesture must not be able to restore one
    // without the other. Ending the session is what stops later desktop locate
    // fixes from dispatching GPS events against a null AR pose — `AnchorStarter`
    // omits this and gets away with it only because it never leaves AR.
    gpsRegistration.stop();
    // BACK TO THE WINDOW-CENTRE DATUM, cleared here so the exit pass below
    // rebuilds against it. Leaving this set would keep the desktop view's
    // buildings at ellipsoidal heights while its camera is framed relative to a
    // moving surface — the mirror of the AR-entry bug, and the gate now catches
    // it because the datum is part of the field's identity.
    arUndulationM = undefined;
    // Paired with the `suspend` in `startWalking`, and in the same function, so
    // the back gesture cannot restore one without the other — leaving the
    // desktop pane hidden after a session is a blank map with no error.
    buildingView.resume();
    arWalk?.dispose();
    arWalk = undefined;
    arToast.clear();
  };

  const enterAr = (): void => {
    awaitingArFix = false;
    clearArOffer();
    // IN THE GESTURE, not after an await: the permission prompts WebXR raises
    // are only allowed synchronously from a user gesture.
    //
    // THE OFFER'S BUTTON IS A SECOND, FRESH GESTURE, which is what keeps that
    // true on the locate-first path as well (DEC-W2). Nothing calls this from a
    // timer or from the fix callback — the offer is shown there, and the user
    // presses it.
    void startArMode({
      container: el("ar-root"),
      store,
      buildingView,
      origin: selectZeroReference(store.getState()),
      // The CITY's frame, distinct from the GPS origin above — the mesh is
      // authored about the scene anchor and `ar-mode.ts` applies the offset.
      sceneAnchor: anchors.origin,
      enuFrameAt,
      onError: (message) => store.dispatch(actions.nonFatalError(message)),
      // THE AUTO ELEVATION OFFSET (plan §2.6). Presence is the switch: the
      // whole group is omitted when the URL kill switch (`?autoElevation=off`)
      // is set, read HERE at entry so a field A/B is one reload. The sampler
      // shares `terrainReadout`'s two gates with the HUD's terrain line — the
      // datum gate matters most, because between AR entry and the entry pass
      // landing the held field is the DESKTOP one, whose `heightAt` returns
      // relief rather than an ellipsoidal height. `terrain`/`arUndulationM`
      // are read per call, like `liveMeasurements` below and safely for the
      // same reason: the closure only runs long after this body evaluated.
      ...(autoElevationEnabled(window.location.search)
        ? {
            autoElevation: {
              terrainHeightM: (enu: { x: number; y: number }) =>
                terrainReadout(terrain, enu, arUndulationM).terrainHeightM,
            },
          }
        : {}),
      // M4. Pulled at the readout's own cadence rather than pushed, because
      // fixes arrive ~1 Hz while draw cost changes every frame.
      //
      // MEASURED FROM `zero`, the same point the far-travel warning uses: the
      // number worth watching is the drift from the frame the alignment matrix
      // is expressed against, not from the scene anchor.
      liveMeasurements: () => {
        const zero = selectZeroReference(store.getState());
        const here = lastFixPosition;
        // THE DEM UNDER THE USER (DEC-H1). `terrain` is declared further down
        // this function body, which is safe because this closure only ever RUNS
        // from a frame callback — long after the whole body has been evaluated.
        // Sampling costs one bilinear array read, twice a second — and it is
        // ACTUALLY twice a second only since the PR review of P4/P5. This
        // closure used to be called on every XR frame, with `sample` throwing
        // ~29 of every 30 results away; `ar-mode.ts` now asks the HUD whether
        // it is `due` before building any of this. The sentence above was in
        // the file, describing a cadence the code did not have, the whole time.
        //
        // `hasData` is passed through rather than folded in: `heightfieldFrom`
        // samples FLAT ZERO for a failed load, so the height alone cannot
        // distinguish "sea level" from "no DEM" and the readout must.
        const field = terrain;
        const enuHere =
          here === undefined
            ? undefined
            : enuFrameAt(anchors.origin).toEnu({
                lat: here.lat,
                lng: here.lng,
              });
        return {
          fixAccuracyM: lastFixAccuracyM,
          altitudeM: lastAltitudeM,
          altitudeAccuracyM: lastAltitudeAccuracyM,
          // TWO GATES, NOT ONE — see `terrainReadout`, which owns the reason
          // and the tests. The height keeps the datum gate from PR #311's
          // finding 3; `terrainHasData` deliberately does NOT, because a failed
          // load is `flat()` whose datum is 0 whatever undulation was asked
          // for, so gating it hid `no DEM` for exactly the fields it describes
          // (PR #312 review).
          ...terrainReadout(field, enuHere, arUndulationM),
          // THE COMPOSITION'S IDENTITY, not per-sample provenance — the
          // provider seam cannot say which member answered a given post, so
          // the readout names what was asked. See `ar-measurements.ts`.
          ...(demSourceId === undefined ? {} : { demSourceId }),
          // AND WHAT ANSWERED, in aggregate: the worker's snapshot of the
          // provider's serving counters, applied atomically with the field.
          // The HUD renders the primary's share from this.
          ...(demStats === undefined ? {} : { demStats }),
          // THE SESSION CONSTANT that makes the ZERO_GEOID trap visible. It does
          // not move while walking; it is on screen so that a `0` announces
          // itself rather than putting the whole scene ~46 m out in silence.
          ...(arUndulationM === undefined
            ? {}
            : { geoidUndulationM: arUndulationM }),
          // WHICH MODEL PRODUCED THAT NUMBER (H7). The undulation alone cannot
          // expose the `ZERO_GEOID` trap the line above exists for: a zero
          // undulation from a real model and a zero from "no geoid loaded" print
          // identically, and only the second puts the whole scene tens of metres
          // out. `describeGeoid` is the library's own answer, and for
          // `ZERO_GEOID` it returns a full warning SENTENCE rather than an id —
          // which is deliberate on its side and is why this line can never be
          // merged with another.
          //
          // Read from the resolved model, never re-derived: `geoidModel` is
          // populated by the same lazy import that produced `arUndulationM`, so
          // an absent model here means the readout says nothing rather than
          // naming a model that did not serve.
          ...(geoidModel === undefined
            ? {}
            : { geoidModelId: describeGeoid(geoidModel) }),
          ...(here === undefined
            ? {}
            : { position: { lat: here.lat, lng: here.lng } }),
          ...(lastFixAtMs === undefined
            ? {}
            : { fixAgeMs: Date.now() - lastFixAtMs }),
          metresFromAnchor:
            zero === null || here === undefined
              ? undefined
              : greatCircleDistance(
                  [zero.lat, zero.lon],
                  [here.lat, here.lng],
                  UNITS.m,
                ),
        };
      },
      // FOUR DISPATCHES, NOT ONE (DEC-E2). `compass-influence.ts` holds why:
      // "influence 0" is not "vote weight 0" — at weight 0 the steady-state
      // formula is `1 − observability`, a FULL override exactly when yaw is
      // poorly observable, and switching the prior off falls through to the
      // cold-start override, whose curve is identical and which is on by
      // default. Silencing the compass takes all of these together.
      onCompassSettings: (settings) => {
        // EIGHT DISPATCHES, NOT ONE (DEC-E2, extended round four).
        // `compass-influence.ts` holds why the first four cannot be collapsed:
        // "influence 0" is not "vote weight 0" — at weight 0 the steady-state
        // formula is `1 − observability`, a FULL override exactly when yaw is
        // poorly observable, and switching the prior off falls through to the
        // cold-start override, whose curve is identical.
        //
        // THE ORDER MATTERS FOR THE LAST THREE. `setCompassExperimentEnabled`
        // maps a fixed published combo — rotation prior, tolerance 15, pair
        // selection on — so the standalone setters must come AFTER it or the
        // combo would overwrite the toggles the gear panel just changed. The
        // library's own mapping applies groups in the same order and pins it
        // with a test; this is the consumer-side half of that contract.
        store.dispatch(
          setCompassRotationPriorEnabled(settings.rotationPriorEnabled),
        );
        store.dispatch(
          setColdStartOverrideEnabled(settings.coldStartOverrideEnabled),
        );
        store.dispatch(setCompassExperimentEnabled(settings.experimentEnabled));
        store.dispatch(setCompassVoteWeight(settings.voteWeight));
        store.dispatch(setCompassTrustGateMode(settings.trustGateMode));
        store.dispatch(
          setCompassPairSelectionEnabled(settings.pairSelectionEnabled),
        );
        store.dispatch(
          setCompassTrustAgreeToleranceDeg(settings.trustToleranceDeg),
        );
        store.dispatch(
          setCompassWebXRConsistencyEnabled(settings.webXRConsistencyEnabled),
        );
      },
      onEnded: () => {
        // Fires for the Android back gesture too, where nothing called
        // `dispose()` — so the button has to be repainted from here as well as
        // from the click handler above.
        arSession = undefined;
        // AND THE WATCH STOPPED FROM HERE TOO. The back gesture is the whole
        // reason this is not only in the click handler: a GPS watch left
        // running after the session would keep draining the battery and keep
        // resampling terrain against an AR datum the desktop view no longer
        // uses.
        stopWalking();
        paintArButton();
        // A FULL PASS, NOT A TERRAIN RELOAD. Leaving AR changes the datum back,
        // and the datum is baked into the building/tree/POI VERTICES by the
        // worker's `update` handler — the `terrain` handler only replaces the
        // field. `reloadTerrainForMode()` here moved the ground plane and left
        // every building at the AR datum (r509 review).
        currentPass = runPassFor(selectOsmView(store.getState()).position);
        void currentPass;
      },
    }).then(async (mode) => {
      // ONLY IF A SESSION ACTUALLY STARTED. `startArMode` resolves to an inert
      // handle on a refused permission or a missing scene — assigning that
      // unconditionally left the user looking at an error toast AND a button
      // reading "Exit AR" with no session behind it, which is a state nobody
      // designed and exactly what `ar-button-state.ts` exists to prevent.
      //
      // `started` is the handle's own answer rather than a second flag here,
      // so the two cannot disagree.
      if (mode.started) arSession = mode;
      paintArButton();
      // WALKING STARTS ONLY WITH A REAL SESSION, and it is anchored to the same
      // `zero` the scene is — not to `anchors.origin`. The far-travel warning
      // is about drift from the GPS frame the alignment is expressed against,
      // which is the framework's `zero`; the scene anchor is a different point
      // and using it would report the wrong distance.
      //
      // Non-null whenever `started` is true: `canEnterAr` refused otherwise.
      //
      // `startWalking` ALSO RUNS THE ENTRY PASS that applies the AR datum —
      // which is why the old `reloadTerrainForMode()` is gone from here rather
      // than sitting alongside it. See the note there: a terrain load on its
      // own never rebuilds the building geometry the datum is baked into.
      const zero = selectZeroReference(store.getState());
      if (mode.started && zero !== null) {
        // THE DATUM IS RESOLVED BEFORE THE ENTRY PASS, not during it. Awaiting
        // the geoid here — once, on a path that has just started a WebXR
        // session — is invisible; awaiting it inside the terrain request let
        // the mesh build overtake it and stand on the desktop field. See
        // `arUndulationM`.
        // A REJECTED IMPORT MUST NOT LEAVE A LIVE SESSION WITH NO WALK
        // (r517 review). `geoid()` is `await import(...)` of a ~176 KB chunk
        // over whatever mobile data the phone has — the one runtime this mode
        // runs on, on the one entry the comment above calls "a cold cache". An
        // unhandled rejection here skips `startWalking` entirely while
        // `arSession = mode` and the "Exit AR" repaint have already happened:
        // no GPS registration, so `recordGpsEvent` never fires, so the
        // alignment never leaves identity. That is the ORIGINAL bug this whole
        // change set fixed, reintroduced through a network failure.
        //
        // REPORTED AND REFUSED rather than degraded: without the geoid the
        // terrain datum cannot be computed, and continuing would draw the city
        // ~47 m out vertically — a confidently wrong placement, which is the
        // one outcome this demo consistently refuses (see the alignment gate
        // and the DEM-outage policy). Ending the session is honest and the
        // user can simply re-enter.
        let undulation: number;
        try {
          undulation = (await geoid()).undulationMetres(anchors.origin);
        } catch {
          arToast.show(
            "Could not load the elevation reference. Leaving AR — please try again.",
          );
          arSession?.dispose();
          return;
        }
        // THE SESSION CAN END INSIDE THAT AWAIT, and before this guard it did
        // not have to be a rare race (r515 review). The geoid is a ~176 KB
        // dynamic import, this is the first AR entry on a cold cache, and
        // `onSessionEnd` is armed strictly before `startArMode` resolves — so
        // the Android back gesture, the headset coming off, or ARCore dropping
        // the session all land in the gap.
        //
        // Resuming blind would run `startWalking` AFTER its own teardown:
        // `buildingView.suspend()` with nothing to resume it — the "blank map
        // with no error" `stopWalking` names — plus a locate watch and a GPS
        // registration started after their stop, an `arWalk` nothing will
        // dispose, and the AR datum left applied to the desktop view.
        //
        // `arSession !== mode` is the honest test rather than a new flag: the
        // teardown clears it, so this asks "is the session I started still the
        // live one?" and cannot drift from what `onEnded` actually does.
        if (arSession !== mode) return;
        arUndulationM = undulation;
        startWalking({ lat: zero.lat, lng: zero.lon });
      } else {
        // The session did not start, so nothing changed the datum — but the
        // entry attempt may still have raised an error worth leaving on screen,
        // and the desktop view is still the live one. Resample only.
        reloadTerrainForMode();
      }
    });
  };

  arButton.addEventListener("click", () => {
    const action = currentPressAction();

    if (action.kind === "exit") {
      arSession?.dispose();
      arSession = undefined;
      stopWalking();
      awaitingArFix = false;
      clearArOffer();
      paintArButton();
      return;
    }

    if (action.kind === "locate") {
      // THE PRESS BECOMES THE GPS BUTTON (G6, DEC-W2). The app does not
      // currently show where the user is — either no fix has ever arrived, or
      // the view has been moved away from the last one — and AR anchored to a
      // place they are not is half of what was reported. When the fix lands,
      // `maybeOfferAr` offers entry, so the second tap is offered rather than
      // remembered.
      //
      // NOT BOTH AT ONCE, which was planned first and abandoned: `startArMode`
      // refuses without an origin, so "both" would have been locate plus
      // nothing. See `ar-entry.ts` for the three invariants that rule out the
      // alternative of re-anchoring afterwards.
      // CLEARED FIRST, THEN ARMED — and the order is load-bearing, because
      // `clearArOffer` drops the intent as well as hiding the prompt. Armed
      // first, the clear immediately disarmed it and the offer never came.
      clearArOffer();
      awaitingArFix = true;
      // THE IN-PROGRESS STATE IS THE LOCATE BUTTON'S OWN, not a second one
      // invented here. `locateControl.start()` moves it to "Locating…" and back,
      // and that control is the thing actually working — a spinner on the AR
      // button as well would be two indicators for one operation.
      locateControl.start();
      paintArButton();
      return;
    }

    enterAr();
  });

  // THE OFFER'S OWN GESTURE. This click is what carries the transient user
  // activation `navigator.xr.requestSession()` needs — which is the reason the
  // "press AR, it locates, then offers" shape works where "do both at once"
  // could not: the session is requested from a fresh press, not from a fix
  // callback, and no permission prompt is ever raised inside a running session.
  el("ar-offer-enter").addEventListener("click", () => {
    enterAr();
  });
  el("ar-offer-dismiss").addEventListener("click", () => {
    clearArOffer();
    paintArButton();
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
    //
    // `show-below` joins the AFFORDANCE group the same way (DEC-R6b-5). It is
    // not a layer either — it changes which cells an existing layer draws — but
    // it is a property of the affordance heat grid and belongs with its
    // switches. Being a real child of `#layer-group-overlays` rather than a
    // sibling styled to look adjacent is what makes it collapse and expand with
    // that block, which is the behaviour the sixth session asked for.
    //
    // THE CATEGORY PICKER FIRST (F3d) — and as of round three that is true
    // rather than merely claimed. The group is captioned `Category`, so the
    // control it names belongs at the top of it rather than below the switches
    // that describe what to draw for it. This comment sat here for a day over a
    // seam that could only append, so the bar rendered
    // `Category · cells · areas · ‹select›`; the seam now takes a position and
    // `layer-toggles.test.ts` holds the order to the screen.
    extrasBefore: {
      overlays: [el("category")],
    },
    extrasAfter: {
      diagnostics: [el("perf-stats-label"), el("render-distance-label")],
      // LAST, after the two switches: it changes which cells `cells` draws, so
      // it reads as a qualifier on the switch above it rather than a third peer.
      overlays: [showBelowLabel],
      // THE GROUND PICKER JOINS `world` (J2, DEC-J5). It was a loose `<label>`
      // sitting as a direct header child, and J2 puts every control in a block —
      // so left alone it would be the ONE bare thing on a now-transparent bar,
      // i.e. the next session's finding.
      //
      // `world` rather than a block of its own: the group answers "what is in
      // the world", and the ground mode chooses which surface is drawn as the
      // ground. It is not a layer (`ALL_LAYERS` means things drawn
      // independently; this is one thing drawn three ways and is exclusive),
      // which is exactly why it needs the extras seam rather than the registry.
      world: [el("ground-mode-label")],
    },
  });
  /**
   * DEC-U9: the below-threshold checkbox is hidden while `cells` is off.
   *
   * ITS OWN FUNCTION BECAUSE THE SUBSCRIBER IS NOT ENOUGH, and the first
   * version of this shipped that bug. `subscribe` captures the current value at
   * registration and fires only when it CHANGES, so a control painted only from
   * there is never painted at all until the user touches something — and
   * `cells` is OFF in `DEFAULT_LAYERS`, which is precisely the state that should
   * hide this. The checkbox was therefore visible on every fresh load, in the
   * one configuration DEC-U9 exists to cover.
   */
  const paintShowBelow = (layers: LayerSet): void => {
    showBelowLabel.hidden = !layers.cells;
  };

  layerToggles.render(selectLayers(store.getState()));

  /**
   * The render-distance dial (r541 Q9/Q10, owner decision 2026-08-21).
   *
   * THE ARITHMETIC LIVES HERE, NOT IN THE VIEW, and the import direction is
   * why: `render-distance.ts` reads `FAR_PLANE_M` from `building-view.ts`, so
   * the view importing it back would be a cycle and `check:cycles` would
   * reject it. `BuildingView.setFarPlane` therefore takes plain metres.
   *
   * THE READOUT IS PAINTED FROM THE CAMERA (`farPlaneM()`, `fogNearM()`),
   * never from the slider, so it cannot report a distance the projection
   * matrix does not have.
   */
  const renderDistanceInput = el<HTMLInputElement>("render-distance");
  const renderDistanceValue = el("render-distance-value");
  const paintRenderDistance = (): void => {
    renderDistanceValue.textContent = `draw ${Math.round(
      buildingView.farPlaneM(),
    )} m · haze ${Math.round(buildingView.fogNearM())} m`;
  };
  renderDistanceInput.addEventListener("input", () => {
    const multiplier = Number.parseFloat(renderDistanceInput.value);
    buildingView.setFarPlane(renderDistanceFor(multiplier).farPlaneM);
    paintRenderDistance();
  });
  // PAINTED ONCE AT BOOT, so the readout is not stale before the first drag.
  paintRenderDistance();
  paintShowBelow(selectLayers(store.getState()));
  // THE SAME FIRST-PAINT GAP AS `paintShowBelow`, one control over. The readout
  // is written only by `paintGeoEventButton`, which is reached from
  // change-subscribers and from `setBusy` — so before the first press it was
  // present, empty and visible, holding open a gap in the header's flex row.
  paintGeoEventButton();

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
  // Which DEM composition sampled `terrain` — the worker's own `sourceId`,
  // applied atomically with the field so the AR readout can never label a
  // field with a provider that did not produce it.
  let demSourceId: string | undefined;
  // Which member of that composition actually SERVED, as position counts —
  // applied atomically with the field for the same reason. The HUD derives
  // the primary's share from this; absent keeps the composed-id-only label.
  let demStats: RacingProviderStats | undefined;

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
    apply: ({
      field,
      note,
      centreEnu,
      demSourceId: loadedSourceId,
      demStats: loadedStats,
      meshOutdated,
    }) => {
      terrain = field === undefined ? undefined : heightfieldFrom(field);
      terrainNote = note;
      demSourceId = loadedSourceId;
      demStats = loadedStats;
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
      // BOTH sources, unconditionally: the composition falls back per tile, so
      // any session may be standing on either DEM. See `dem-provider.ts` for
      // why the credit is a constant rather than the provider's own field.
      // AN EMPTY LIST, not `undefined`, when there is no terrain — the line
      // simply stops naming the elevation sources. The OSM credit is not this
      // caller's to add or remove; `MapView` always carries it.
      mapView.setTerrainAttribution(
        terrain === undefined ? [] : DEM_ATTRIBUTION_ENTRIES,
      );
      // THE REPORTED CENTRE, not the field's — they are the same on a good
      // load, and only the former exists during an outage.
      publishFrameState(anchors.origin, centreEnu);
      // THE LATE-TERRAIN REBUILD (F1d). The worker owns the decision — it is
      // the only side that knows the terrain stamp and what the standing mesh
      // was built against (see `worker/terrain-arrival.ts`); all that is left
      // here is to act on it.
      //
      // THE `busy` CHECK IS NOT BELT AND BRACES, even though the worker already
      // suppresses the signal while an update is in flight. The two guards
      // watch different windows: the worker's closes when the update handler's
      // reply is posted, this one when the page has finished applying it. A
      // terrain reply delivered in that gap would otherwise call a `latestOnly`
      // `refresh` mid-run and abort the Overpass fetch it is waiting on — the
      // regression this whole milestone was re-planned to avoid.
      if (meshOutdated === true && !refresh.busy) void refresh();
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
    // NOW A CONSTANT (DEC-H5). It used to be the maximum score on screen, so a
    // cell's colour depended on cells the user could not see — walk far enough
    // and everything brightened with no change in its own data. The snapshot
    // still reports `observedMax`, but only so the legend can describe the
    // data; nothing colours by it.
    //
    // The category-mismatch hazard this comment used to describe is much
    // narrower, not gone — and the first version of this sentence said "gone",
    // which overreached (r513 review).
    //
    // `fixedScale` fixes the ramp's TOP. Its BOTTOM is still
    // `thresholdFor(table, category)`, filled per column from the live sheet, so
    // a `__threshold__` row would give categories different ramps again and the
    // stale-snapshot window would matter again. The shipped table has no such
    // row, so every category sits at `DEFAULT_THRESHOLD` and the mismatch is
    // currently impossible **by accident of the sheet** — which is exactly the
    // shape of the `max <= threshold` test this same change had to replace,
    // because that one "only ever worked BECAUSE the max was observed".
    //
    // Reading the threshold from the SNAPSHOT rather than from `view.category`
    // is what keeps it structural rather than accidental, and that is why it
    // stays.
    return fixedScale(snapshot.threshold);
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
    // The counts come from the SNAPSHOT, not from what this view drew — same
    // rule as `scaleFor`. Deriving them from the filtered cell array made
    // switching the `cells` layer off collapse the legend, which is the defect
    // W12 fixed; the fixed ramp does not reintroduce it, and neither does this.
    legendView.render(scale, drawnCategory, view.showBelowThreshold, {
      aboveThresholdCount: snapshot.aboveThresholdCount,
      observedMax: snapshot.observedMax,
    });
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
      // second scale here from the same snapshot — agreeing with the map's
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
    // THE ERROR PHASE IS NOT RENDERED HERE ANY MORE (DEC-U10). Errors go to
    // the toast, which is visible whether or not the header is collapsed.
    // Writing them here as well would be the second channel DEC-R2-15
    // existed to prevent, and it is what forced the header to expand itself.
    //
    // The line falls through to the ordinary summary instead of blanking:
    // during a failed refetch the previous snapshot is still what is on
    // screen, so describing it is accurate. A blank line would read as
    // 'nothing loaded', which is a stronger claim than the failure supports.
    if (view.loading.phase !== "idle" && view.loading.phase !== "error") {
      status.textContent = view.loading.message;
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
      // Reported only when there are some, like the plate and POI counts: a
      // zero would be noise at every site with no mapped walls, and the
      // interesting reading is "this walled site drew none".
      mesh === undefined || mesh.barriers === 0
        ? ""
        : `${mesh.barriers} barriers`,
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
      // ERRORS GO TO THE TOAST, AND DEC-R2-15 IS RETIRED (DEC-U10).
      //
      // That rule expanded the header on every error, because the status
      // line inside it was the only channel available and a message written
      // into a collapsed header is invisible. The owner reported the
      // self-expanding header as a bug; it was the demo telling the truth
      // about failures they were independently investigating.
      //
      // BOTH HALVES MOVE TOGETHER, and that is not tidiness. Retiring the
      // expand while errors still wrote to the status line would leave the
      // message in a collapsed header AND in a toast - the two-channel state
      // DEC-R2-15 rejected a toast in order to avoid. So `writeStatus` no
      // longer renders the error phase either; see its comment.
      //
      // ACCEPTED COST: a toast is transient where the header stayed open
      // until dismissed, so an error can now be missed by looking away. The
      // owner chose that knowingly.
      if (loading.phase === "error") toast.show(loading.message);
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
      const siteId = declaredSiteId;
      placeChangeDeclared = false;
      declaredSiteId = undefined;
      // THE URL IS WRITTEN HERE AND NOWHERE ELSE (DEC-R12-5), because this is
      // the one place every way of moving converges — picker, map click, locate
      // button. Writing it at each call site would be three writers racing to
      // describe one position, and the site jump would be overwritten by the
      // coordinates of the same jump.
      writePlace(placeUrl, { position, siteId });
      // `frozen` WHILE AR IS LIVE, and it is not the same as leaving `declared`
      // unset (§2.4, AR milestone 3). `nextAnchor` re-anchors on DISTANCE
      // independently past 5 km, so a long walk or one wild fix would move the
      // scene frame while the framework's `zero` — which is immutable for the
      // session — stayed put. Two disagreeing origins is the exact failure the
      // fixed-origin work removed, and the city would jump by kilometres.
      const anchor = anchors.advance(position, {
        declared,
        frozen: arSession !== undefined,
      });
      // A RE-ANCHOR INVALIDATES THE ROUTE, AND ONLY A RE-ANCHOR DOES (stage 4).
      // Every point on the drawn polyline is expressed in the scene's ENU
      // frame; an ordinary step leaves that frame alone — that is round 5B's
      // whole guarantee — so the route survives a walk across the map and is
      // taken down exactly when its coordinates stop meaning anything.
      //
      // The agent goes with it. It is standing where the user WAS, and after a
      // teleport that is a different city.
      if (anchor.reanchored) buildingView.clearRoute();
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
      //
      // NOT GATED HERE, and the first version of milestone 3 had it here (r509
      // review). Gating at the BOTTOM of this subscriber let every fix dispatch
      // `positionChanged` and then skip the fetch — which advances the store
      // position past a position whose terrain was never loaded, and
      // `demo-worker.ts` states the opposite as a safety invariant. The gate
      // moved up into `onLocated`, so a rejected fix never becomes a position
      // change at all and everything above stays true.
      currentPass = runPassFor(position);
      void currentPass;
    },
  );

  subscribe(
    (view) => view.category,
    () => {
      void refresh();
      // THE RESTART HALF OF DEC-U13. The decision is "cancel and restart", and
      // only the cancel half existed: the cycle refuses to publish a result
      // whose category has moved on, which leaves the user with no quest AND
      // no running search — the picker live, the map empty, and nothing
      // happening until they press again.
      //
      // Gated on `busy` so a category change with no search in flight does not
      // start one uninvited; the search is a real cost (it can score hundreds
      // of chunks and download a tile), which is why it is a button in the
      // first place.
      if (findGeoEvent.busy) void findGeoEvent(undefined);
    },
  );

  subscribe(
    (view) => view.layers,
    (layers, previousLayers) => {
      layerToggles.render(layers);
      // HIDDEN, NOT DIMMED (DEC-U9), and that reverses two recorded decisions.
      //
      // `.layer-toggle.layer-busy` says "dimmed and non-interactive, never
      // hidden — a control that disappears reads as a bug", and `index.html`
      // separately records `show-below` being moved INTO this group so that it
      // stays visible, after the sixth session complained it was the only
      // setting that collapsed. The owner chose hidden knowing both.
      //
      // WHAT MAKES THAT DEFENSIBLE is that the triggers differ. The sixth
      // session's complaint was about COLLAPSE hiding a setting that still
      // applied; this hides one that does not apply at all, and collapsing
      // still keeps it while `cells` is on. The `.layer-busy` comment is
      // narrowed to say exactly that — busy stays visible, inapplicable goes.
      paintShowBelow(layers);
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
   * in the worker; answering it here would mean shipping ~21 MB of features
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
