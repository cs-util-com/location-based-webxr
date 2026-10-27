/**
 * The globe lab's frame-hitch recorder (globe zoom frame-hitch plan
 * 2026-10-03-2017 §4, PERF-1), loaded only with `#perf=1`: the overlay (Run,
 * Copy, Download, the summary), the two paths that fly the camera (§4.2),
 * the in-page sweep (§4.4), the events of §4.1 marked per frame, the idle
 * refresh calibration and the export. Without `#perf=1` the page never
 * imports this module, so it does no extra work.
 *
 * @see globe-perf.js.md
 */
import {
  PERF_E_CHECK_KM,
  PERF_PATH,
  PERF_PLACES,
  perfStepPath,
  perfWheelDeltaY,
  perfZoomAltitudeM,
} from "/globe/globe-perf-path.js";
import {
  PERF_DEFAULT_CELL,
  perfOverheadVerdict,
  perfSweepCells,
  perfSweepEstimateMs,
} from "/globe/globe-perf-sweep.js";
import { deviceBlock } from "./globe-device.js";
import { createPerfRecorder } from "./globe-perf-recorder.js";
import {
  PERF_VIEWS,
  formatViewTable,
  itemOffsets,
  parsePerfItems,
  perfViewCells,
  perfViewsEstimateMs,
  snapRefreshInterval,
  summariseViewDownloads,
  summariseViewRuns,
  viewRunLabel,
} from "./globe-perf-views.js";
import { createWakeKeeper } from "./globe-perf-wake.js";
import {
  browserShareEnv,
  copyExport,
  downloadExport,
  exportFileName,
} from "./globe-perf-share.js";
import {
  buildFrameExport,
  calibrateRefreshInterval,
  checkFrameTarget,
  createFrameRun,
  formatFrameRunSummary,
} from "./globe-perf-stats.js";

/** The recorder's own constants. */
export const GLOBE_PERF = Object.freeze({
  /** The idle calibration's length (ms, §4.1). */
  calibrateMs: 2_000,
  /** Frames a settle must hold before it counts. */
  settleFrames: 10,
  /** A move to a new place may settle this long before its run (ms). */
  moveSettleMs: 30_000,
  /** The full sweep's pause between its halves (ms, §4.4: heat). */
  pauseMs: 60_000,
  /** The E change at the held checkpoint (§4.2). */
  eCheckStep: 0.1,
  /** At most this many long-animation-frame durations in the export. */
  loafKept: 200,
  /**
   * The thresholds counted (ms): the plan's 33, 50 and 100, and 34 and 51
   * beside them. At 60 and 120 Hz, 33.3 and 50 ms are whole refresh
   * multiples, so one missed vsync already counts as "over 33"; the export
   * carries both readings, and the DEC-PERF-3 verdict keeps the plan's.
   */
  thresholdsMs: Object.freeze([33, 34, 50, 51, 100]),
  /**
   * The fixed-view sweep (`perfItems`, `globe-perf-views.js`): frames
   * held after the items change before a run opens, so a run measures the
   * held view, not the items' first upload and compile; this window is
   * recorded apart, as the run's `itemsWarm` (its frames, worst frame and
   * the programs, textures and geometries made in it).
   */
  itemsWarmMs: 500,
  /**
   * ... and each held run takes at least this many frames after its hold,
   * so a slow device (SwiftShader: seconds a frame) never ends a run empty.
   */
  viewMinFrames: 3,
});

/** The overlay's markup; the styles keep every control usable at 390 px. */
const PANEL_HTML = `
  <style>
    #globe-perf { position: fixed; left: 8px; right: 8px; bottom: 8px; z-index: 50;
      max-width: 420px; max-height: 70vh; overflow: auto; padding: 10px;
      border-radius: 10px; background: rgba(10, 14, 22, 0.9); color: #e8eef6;
      font: 14px/1.35 system-ui, sans-serif; box-sizing: border-box; }
    #globe-perf .row { display: flex; gap: 8px; margin: 6px 0; }
    #globe-perf button { flex: 1; min-height: 48px; font: 600 16px system-ui, sans-serif;
      border-radius: 8px; border: 1px solid #5a6b80; background: #1e2a3a; color: #fff; }
    #globe-perf button:disabled { opacity: 0.5; }
    #globe-perf pre { margin: 6px 0 0; white-space: pre-wrap;
      font: 12px/1.3 ui-monospace, monospace; }
    #globe-perf textarea { width: 100%; height: 30vh; box-sizing: border-box;
      font: 11px ui-monospace, monospace; }
  </style>
  <div data-perf="plan"></div>
  <div class="row">
    <button type="button" data-perf="run">Run</button>
    <button type="button" data-perf="copy" disabled>Copy</button>
    <button type="button" data-perf="download" disabled>Download</button>
  </div>
  <div data-perf="status" role="status"></div>
  <pre data-perf="summary"></pre>
  <textarea data-perf="text" hidden readonly aria-label="The export, to select and copy"></textarea>`;

/**
 * The recorder for one page. `lab` is the lab's handle:
 * `{ renderer, canvas, globe, terrain, params(), counts(), placeCamera(place,
 * altitudeM), updateControls(), altitudeM(), wheelZoom(deltaY), settled(),
 * setFactors(cell | null),
 * setEOverride(e | null), currentE() }`, optionally `setPaused(bool)` (the
 * frame does no work while paused: the refresh calibration), and for the
 * fixed-view sweep `viewPlace()` (the link's place or null), `eyeMode`
 * (street level needs it), `viewReadiness()` (`{ band, release, city, osm }`,
 * each true when that part is ready), `placeView(place, view)`,
 * `setItems(offsets, place)` (`itemOffsets`: metres east and north of the
 * place) and `bytesDownloaded()`. Returns the hooks the lab's frame
 * calls (`frameStart`, `drives`, `drive`, `frameEnd`, `mark`, `eStep`) and
 * `api` for the smokes.
 */
export function createGlobePerf(lab) {
  const pageStart = performance.now();
  /** The display's interval the dropped-frame counts divide by (snapped). */
  let refreshIntervalMs = null;
  /** The calibration snapped (`snapRefreshInterval`), or null. */
  let refresh = null;
  /** The screen wake lock for a run (`globe-perf-wake.js`). */
  const wake = createWakeKeeper({
    wakeLock: navigator.wakeLock,
    doc: document,
  });
  /** A line every status carries while the screen is not kept awake. */
  let statusNote = "";
  const rec = createPerfRecorder({
    createRun: () =>
      createFrameRun({
        refreshIntervalMs,
        thresholdsMs: GLOBE_PERF.thresholdsMs,
      }),
  });
  /** The current cell's hooks: off records frame intervals only. */
  let hooksOn = true;
  const mark = (kind, n = 1) => {
    if (hooksOn && rec.running()) rec.mark(kind, n);
  };
  /** Resolvers waiting for the next frame. */
  let waiters = [];
  /** The camera's target: `{ place, altitudeM }`, a function of now, or null. */
  let driver = null;
  const finished = [];
  let status = "idle";
  let voided = false;
  let nodesWalkPending = false;
  let lastPrograms = lab.renderer.info.programs?.length ?? 0;
  let lastTextures = lab.renderer.info.memory.textures;
  let lastGeometries = lab.renderer.info.memory.geometries;
  /** Per-run peaks of what §4.1 lists per carrier (cache MiB, pending). */
  let peaks = null;
  const loafDurations = [];

  // Tile arrival and disposal per carrier (H3, H4).
  const listen = (tiles, prefix) => {
    tiles.addEventListener("load-model", () => mark(`${prefix}.load`));
    tiles.addEventListener("dispose-model", () => mark(`${prefix}.dispose`));
  };
  listen(lab.globe.tiles, "globe");
  if (lab.terrain) {
    listen(lab.terrain.tiles, "relief");
    // The relief plugin's raycast (H5), counted while the recorder is on.
    const plugin = lab.terrain.plugin;
    if (typeof plugin.raycastTile === "function") {
      const raycastTile = plugin.raycastTile;
      plugin.raycastTile = function counted(...args) {
        mark("raycast");
        return raycastTile.apply(this, args);
      };
    }
  }
  // Long animation frames (Chrome 123+, not Safari): blind under 50 ms.
  const loafSupported =
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes?.includes(
      "long-animation-frame",
    ) === true;
  if (loafSupported) {
    new PerformanceObserver((list) => {
      if (!rec.running() || !hooksOn) return;
      for (const entry of list.getEntries()) {
        mark("loaf");
        if (loafDurations.length < GLOBE_PERF.loafKept) {
          loafDurations.push(Math.round(entry.duration));
        }
      }
    }).observe({ type: "long-animation-frame" });
  }
  // Memory pressure on a phone (H6), a page that leaves the screen and a
  // touch (§4.2: the run is not touched) void the run in progress.
  const voidRun = (kind) => {
    if (!rec.running()) return;
    rec.mark(kind);
    voided = true;
  };
  lab.canvas.addEventListener("webglcontextlost", () =>
    voidRun("context.lost"),
  );
  lab.canvas.addEventListener("webglcontextrestored", () =>
    voidRun("context.restored"),
  );
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") voidRun("hidden");
  });
  lab.canvas.addEventListener("pointerdown", () => voidRun("touch"));

  const nextFrame = () => new Promise((resolve) => waiters.push(resolve));
  const wait = async (ms) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) await nextFrame();
  };
  /**
   * Holds until the lab's drawn carriers settle, `settleFrames` in a row,
   * and `also()` holds too.
   */
  const settle = async (timeoutMs, also = () => true) => {
    const t0 = performance.now();
    let still = 0;
    while (performance.now() - t0 < timeoutMs) {
      await nextFrame();
      still = lab.settled() && also() ? still + 1 : 0;
      if (still >= GLOBE_PERF.settleFrames) return true;
    }
    return false;
  };
  const placeOf = (id) =>
    PERF_PLACES.find((p) => p.id === id) ?? PERF_PLACES[1];
  const settleTimeoutMs = () => lab.params().perfSettleS * 1000;

  /**
   * The counts taken at a checkpoint (§4.3: decided on counts), at the
   * path's altitude `targetM`. The camera's own altitude above the
   * ellipsoid is beside it: below the pitch law's 90 degrees the camera
   * stands back from the point it looks at, over ground of another radius
   * (about 4 km lower at the Alps in the band).
   */
  const checkpointCounts = (targetM) => {
    const s = lab.counts();
    const r = s.relief;
    return {
      altitudeKm: Math.round(targetM / 1000),
      cameraAltitudeKm: +(s.altitudeM / 1000).toFixed(1),
      programs: lab.renderer.info.programs?.length ?? null,
      textures: lab.renderer.info.memory.textures,
      geometries: lab.renderer.info.memory.geometries,
      globePending: s.pendingTiles,
      globeLoaded: s.loadedTiles,
      globeRefused: s.refusedTiles,
      share: r?.share ?? null,
      e: r?.heightScale ?? null,
      reliefVisible: r?.visibleTiles ?? null,
      reliefLoaded: r?.stats.loaded ?? null,
      reliefPending: r
        ? r.stats.queued + r.stats.downloading + r.stats.parsing
        : null,
      reliefCacheMiB: r ? +(r.cachedBytes / 2 ** 20).toFixed(1) : null,
      globeCacheMiB: r ? +(r.globeCachedBytes / 2 ** 20).toFixed(1) : null,
    };
  };

  /**
   * The display's refresh interval (§4.1), from 2 s of frames with the
   * lab's frame doing no work (`lab.setPaused`), so it measures the display
   * and not the scene, snapped to a display rate (`snapRefreshInterval`;
   * a measurement that fits none is flagged in the export). The first
   * frame after the pause starts is left out: it may still be a full one.
   */
  async function calibrate() {
    lab.setPaused?.(true);
    try {
      await nextFrame();
      rec.startIdle();
      await wait(GLOBE_PERF.calibrateMs);
      refresh = snapRefreshInterval(calibrateRefreshInterval(rec.stopIdle()));
    } finally {
      lab.setPaused?.(false);
    }
    refreshIntervalMs = refresh?.intervalMs ?? null;
  }

  const startRun = (cell, label) => {
    hooksOn = cell.hooks !== false;
    voided = false;
    peaks = {
      globeCacheMiB: 0,
      reliefCacheMiB: 0,
      globePending: 0,
      lowestKm: Infinity,
    };
    rec.startRun(label);
    return { index: finished.length, at: performance.now() };
  };
  const endRun = (cell, started, extra) => {
    const run = rec.stopRun();
    finished.push({
      ...run,
      cell,
      index: started.index,
      // Heat (§4.1): a later run on a warmer phone.
      sincePageLoadMs: Math.round(started.at - pageStart),
      voided,
      hooks: hooksOn,
      peaks: {
        globePending: peaks.globePending,
        globeCacheMiB: +peaks.globeCacheMiB.toFixed(1),
        reliefCacheMiB: +peaks.reliefCacheMiB.toFixed(1),
        lowestKm: +peaks.lowestKm.toFixed(1),
      },
      ...extra,
    });
    hooksOn = true;
    peaks = null;
  };

  /** One time-driven run (§4.2), at the cell's speed. */
  async function runZoom(cell, label) {
    const place = placeOf(cell.place);
    lab.setFactors(cell);
    driver = { place, altitudeM: PERF_PATH.fromM };
    const settledBefore = await settle(GLOBE_PERF.moveSettleMs);
    let start = null;
    let done = false;
    const controls = cell.drive === "controls";
    driver = (now) => {
      start ??= now;
      const z = perfZoomAltitudeM(now - start, cell);
      done = z.done;
      return { place, altitudeM: z.altitudeM, controls };
    };
    const started = startRun(cell, label);
    while (!done) await nextFrame();
    await nextFrame();
    endRun(cell, started, { settledBefore });
    driver = { place, altitudeM: PERF_PATH.fromM };
  }

  /** The frame-stepped path (§4.2): counts only, never milliseconds. */
  async function runSteps(cell, label) {
    const place = placeOf(cell.place);
    lab.setFactors(cell);
    const path = perfStepPath({ stepsPerDecade: lab.params().perfSteps });
    const checkpoints = [];
    let eCheck = null;
    driver = { place, altitudeM: path[0].altitudeM };
    const settledBefore = await settle(GLOBE_PERF.moveSettleMs);
    const started = startRun(cell, label);
    const eCheckM = PERF_E_CHECK_KM * 1000;
    for (let i = 0; i < path.length; i++) {
      const step = path[i];
      const prev = path[i - 1];
      // The one E change, at the held 1,000 km on the way down (§4.2: H1's
      // load wave with nothing else moving).
      if (
        eCheck === null &&
        lab.terrain &&
        step.leg === "down" &&
        prev &&
        prev.altitudeM > eCheckM &&
        step.altitudeM <= eCheckM
      ) {
        driver = { place, altitudeM: eCheckM };
        const settledBeforeE = await settle(settleTimeoutMs());
        const before = checkpointCounts(eCheckM);
        const e = lab.currentE();
        lab.setEOverride(e + GLOBE_PERF.eCheckStep);
        const settledAfterE = await settle(settleTimeoutMs());
        const after = checkpointCounts(eCheckM);
        lab.setEOverride(null);
        eCheck = {
          eFrom: e,
          eTo: e + GLOBE_PERF.eCheckStep,
          settledBefore: settledBeforeE,
          settledAfter: settledAfterE,
          reliefLoads: (after.reliefLoaded ?? 0) - (before.reliefLoaded ?? 0),
          before,
          after,
        };
      }
      driver = { place, altitudeM: step.altitudeM };
      await nextFrame();
      if (step.checkpoint) {
        const settled = await settle(settleTimeoutMs());
        checkpoints.push({ settled, ...checkpointCounts(step.altitudeM) });
      }
    }
    await nextFrame();
    endRun(cell, started, {
      settledBefore,
      checkpoints,
      eCheck,
      stepped: true,
    });
  }

  /**
   * The move whose settle gave up on the city (null: none). The city comes
   * from public Overpass servers; one that delivered nothing by a move's
   * timeout may never come, and waiting on it would leave every run timed
   * out. The sweep then measures without it, and a run the city lands in
   * is void (`city.arrived`).
   */
  let cityGaveUp = null;
  /** The parts of the view that are not ready yet (`lab.viewReadiness`). */
  const notReady = () => {
    const r = lab.viewReadiness();
    const parts = Object.keys(r).filter(
      (k) =>
        !r[k] &&
        // Once it delivers, the city is waited for again (its fade).
        !(k === "city" && cityGaveUp !== null && lab.cityDelivered() === 0),
    );
    return lab.settled() ? parts : ["carriers", ...parts];
  };
  const viewReady = () => notReady().length === 0;
  const gpuCounts = () => ({
    programs: lab.renderer.info.programs?.length ?? 0,
    textures: lab.renderer.info.memory.textures,
    geometries: lab.renderer.info.memory.geometries,
  });

  /**
   * The items set for a cell and their warm-up (`itemsWarmMs`), recorded:
   * the frames, the worst frame (the first one carries the build, the
   * upload and any shader compile) and the GPU objects made in it.
   */
  async function warmItems(cell, place) {
    const before = gpuCounts();
    let last = performance.now();
    lab.setItems(itemOffsets(cell.items), place);
    const t0 = last;
    let frames = 0;
    let maxFrameMs = 0;
    while (performance.now() - t0 < GLOBE_PERF.itemsWarmMs) {
      await nextFrame();
      const now = performance.now();
      maxFrameMs = Math.max(maxFrameMs, now - last);
      last = now;
      frames += 1;
    }
    const after = gpuCounts();
    return {
      frames,
      maxFrameMs: +maxFrameMs.toFixed(1),
      programs: after.programs - before.programs,
      textures: after.textures - before.textures,
      geometries: after.geometries - before.geometries,
    };
  }

  /**
   * The fixed-view sweep (`globe-perf-views.js`): for each move (a view in
   * a repeat, the warm-up pass first) the camera placed and a settle of at
   * most `perfViewSettleS` until the view is ready (`viewReady`: the drawn
   * carriers idle, the band at its share, no cache release pending or
   * draining, the city and the OSM map loaded), then for each item count
   * the items set on the ground as it is now (after the settle, so on the
   * refined relief), their warm-up recorded, a wait of at most `perfQuietS`
   * for the view to be ready again, and a held run. What decides is the
   * view right before the run: a run whose quiet wait timed out says so
   * (`settledBefore: false`, with what was not ready) and the table keeps
   * it out; a move whose settle timed out but whose view was ready by the
   * run is kept (`settle.move` says it was slow). The camera is placed every frame,
   * so the street view follows the ground as the relief refines under it.
   */
  async function runViews(viewCells, label) {
    const place = lab.viewPlace() ?? placeOf(lab.params().perfPlace);
    const settleMs = lab.params().perfViewSettleS * 1000;
    const holdMs = lab.params().perfHoldS * 1000;
    let move = null;
    let moveSettled = false;
    let moveNotReady = [];
    let bytesAtMove = 0;
    for (const cell of viewCells) {
      const view = PERF_VIEWS.find((v) => v.id === cell.view);
      if (move !== `${cell.repeat}/${cell.view}`) {
        move = `${cell.repeat}/${cell.view}`;
        label(cell);
        bytesAtMove = lab.bytesDownloaded();
        driver = { place, view };
        moveSettled = await settle(settleMs, viewReady);
        moveNotReady = moveSettled ? [] : notReady();
        if (
          cityGaveUp === null &&
          moveNotReady.includes("city") &&
          lab.cityDelivered() === 0
        ) {
          cityGaveUp = viewRunLabel(cell);
        }
      }
      const itemsWarm = await warmItems(cell, place);
      const quiet = await settle(lab.params().perfQuietS * 1000, viewReady);
      const quietNotReady = quiet ? [] : notReady();
      const cityBefore = lab.cityDelivered();
      const started = startRun(cell, viewRunLabel(cell));
      await wait(holdMs);
      for (let k = 0; k < GLOBE_PERF.viewMinFrames; k++) await nextFrame();
      if (lab.cityDelivered() !== cityBefore) voidRun("city.arrived");
      endRun(cell, started, {
        settledBefore: quiet,
        settle: {
          move: moveSettled,
          moveNotReady,
          quiet,
          notReady: quietNotReady,
        },
        itemsWarm,
        bytesAtMove,
        bytes: lab.bytesDownloaded(),
        requests: performance.getEntriesByType("resource").length,
      });
    }
    lab.setItems([], place);
  }

  /** Who and what ran (§4.1, DEC-PERF-1): strings, numbers, booleans. */
  function device() {
    return deviceBlock({
      renderer: lab.renderer,
      params: lab.params(),
      relief: Boolean(lab.terrain),
      extra: {
        longAnimationFrame: loafSupported,
        refreshIntervalMs,
        refreshMeasuredMs: refresh?.measuredMs ?? null,
        refreshHz: refresh?.hz ?? null,
        refreshMismatch: refresh?.mismatch ?? null,
      },
    });
  }

  const overheadVerdict = () =>
    perfOverheadVerdict(
      finished
        .filter((r) => !r.voided && !r.stepped)
        .map((r) => ({
          hooks: r.hooks,
          p50Ms: r.summary.stats.p50Ms,
          p95Ms: r.summary.stats.p95Ms,
        })),
    );

  /** The export: the framework's, plus the lab's counts per run (§4.3). */
  function exportText() {
    const base = buildFrameExport({
      device: device(),
      runs: finished.map((r) => ({
        label: `${r.label}${r.voided ? " VOID" : ""}`,
        summary: r.summary,
      })),
    });
    return JSON.stringify({
      ...base,
      lab: finished.map((r) => ({
        label: r.label,
        index: r.index,
        sincePageLoadMs: r.sincePageLoadMs,
        cell: r.cell,
        hooks: r.hooks,
        voided: r.voided,
        settledBefore: r.settledBefore,
        settle: r.settle ?? null,
        itemsWarm: r.itemsWarm ?? null,
        bytesAtMove: r.bytesAtMove ?? null,
        counts: r.counts,
        samples: r.samples,
        work: { insideMs: Math.round(r.work.insideMs), frames: r.work.frames },
        peaks: r.peaks,
        checkpoints: r.checkpoints ?? null,
        eCheck: r.eCheck ?? null,
        bytes: r.bytes ?? null,
        requests: r.requests ?? null,
      })),
      overhead: overheadVerdict(),
      // The fixed-view sweep's table and each move's download (MiB of the
      // globe lab's assets, `/globe-assets/` only), null without it.
      views: viewCells ? summariseViewRuns(finished) : null,
      viewDownloads: viewCells ? summariseViewDownloads(finished) : null,
      viewsSkipped,
      // The move after which the sweep stopped waiting for the city (null:
      // it never did).
      cityGaveUp,
      refresh,
      wakeLock: wake.report(),
      longAnimationFrameMs: loafDurations,
    });
  }

  // ---- The overlay (§4.1: usable at phone width, DEC-PERF-1) ----
  const params = lab.params();
  const sweep = params.perfSweep;
  const stepped = params.perfStep === 1;
  const baseCells =
    sweep === null
      ? [
          {
            ...PERF_DEFAULT_CELL,
            place: params.perfPlace,
            repeat: 1,
            heatCheck: false,
            pauseBefore: false,
            hooks: true,
            drive: "place",
          },
        ]
      : perfSweepCells(sweep);
  // A speed in the hash replaces every cell's (short runs for the smokes),
  // and `perfDrive=controls` drives every run through the controls.
  const cells = baseCells.map((c) => ({
    ...c,
    ...(params.perfSpeed === null ? {} : { decadesPerS: params.perfSpeed }),
    ...(params.perfDrive === null ? {} : { drive: params.perfDrive }),
  }));
  const pauses = cells.filter((c) => c.pauseBefore).length;
  // The fixed-view sweep (`perfItems`) replaces the zoom's cells.
  const itemCounts = parsePerfItems(params.perfItems);
  // Street level stands at an eye height: without eye mode the controls
  // keep the camera 100 m up, so the view is left out, never measured
  // somewhere else under its name.
  const views = lab.eyeMode ? PERF_VIEWS : PERF_VIEWS.filter((v) => !v.street);
  const viewsSkipped = lab.eyeMode ? [] : ["street"];
  const viewCells =
    itemCounts === null
      ? null
      : perfViewCells({
          items: itemCounts,
          repeats: params.perfRepeats,
          views,
          warmup: params.perfWarmup === 1,
        });
  const estimateMs = viewCells
    ? perfViewsEstimateMs(viewCells, {
        holdMs: params.perfHoldS * 1000 + GLOBE_PERF.itemsWarmMs,
        settleMs: params.perfViewSettleS * 1000,
        calibrateMs: GLOBE_PERF.calibrateMs,
      })
    : perfSweepEstimateMs(cells) +
      pauses * GLOBE_PERF.pauseMs +
      GLOBE_PERF.calibrateMs;
  const panel = document.createElement("section");
  panel.id = "globe-perf";
  panel.setAttribute("aria-label", "Frame-time recorder");
  panel.innerHTML = PANEL_HTML;
  document.body.append(panel);
  const part = (name) => panel.querySelector(`[data-perf="${name}"]`);
  const minutes = (ms) => Math.max(1, Math.ceil(ms / 60_000));
  const runCount = viewCells?.length ?? cells.length;
  const runs = `${runCount} run${runCount === 1 ? "" : "s"}`;
  part("plan").textContent = viewCells
    ? `Views with items ${itemCounts.join(", ")}: ${runs}, about ${minutes(estimateMs)} min.${viewsSkipped.length ? " Street level left out: it needs eye=1." : ""} Do not touch the screen while it runs.`
    : stepped
      ? `Frame-stepped path, ${runs} (counts only).`
      : `${sweep ?? "One run"}: ${runs}, about ${minutes(estimateMs)} min. Do not touch the screen while it runs.`;
  const setStatus = (text) => {
    status = statusNote ? `${text} ${statusNote}` : text;
    part("status").textContent = status;
  };
  const showText = (text) => {
    const box = part("text");
    box.hidden = false;
    box.value = text;
    box.focus();
    box.select();
  };
  const share = browserShareEnv(showText);
  part("copy").addEventListener("click", async () => {
    const how = await copyExport(exportText(), share);
    setStatus(
      how === "clipboard" ? "Copied." : "Select the text below and copy it.",
    );
  });
  part("download").addEventListener("click", () => {
    const how = downloadExport(
      exportText(),
      exportFileName(
        viewCells ? "views" : (sweep ?? (stepped ? "step" : "run")),
        Date.now(),
      ),
      share,
    );
    setStatus(
      how === "download" ? "Downloaded." : "Select the text below and copy it.",
    );
  });

  const runLabel = (cell) => {
    const varied = Object.keys(PERF_DEFAULT_CELL)
      .filter((k) => cell[k] !== PERF_DEFAULT_CELL[k])
      .map((k) => `${k}=${cell[k]}`);
    return [
      cell.place,
      cell.heatCheck ? "heat" : `r${cell.repeat}`,
      ...(cell.hooks === false ? ["hooks-off"] : []),
      ...(cell.drive === "controls" ? ["controls"] : []),
      ...varied,
    ].join(" ");
  };

  /** Every cell, then the summary; the overlay shows what is left. */
  async function runAll() {
    part("run").disabled = true;
    part("copy").disabled = true;
    part("download").disabled = true;
    finished.length = 0;
    loafDurations.length = 0;
    const t0 = performance.now();
    const left = () =>
      minutes(Math.max(0, estimateMs - (performance.now() - t0)));
    // The screen kept on for the whole run (a phone locks after 30 s to
    // 2 min, which hides the page and voids the run in progress).
    cityGaveUp = null;
    const awake = await wake.start();
    statusNote = awake
      ? ""
      : "The screen cannot be kept on: set the screen's auto-lock to Never.";
    setStatus("Calibrating the refresh rate...");
    await calibrate();
    if (viewCells) {
      await runViews(viewCells, (cell) =>
        setStatus(
          cell.warmup
            ? `Warm-up: ${cell.view}. About ${left()} min left.`
            : `Repeat ${cell.repeat} of ${params.perfRepeats}: ${cell.view}. About ${left()} min left.`,
        ),
      );
    }
    for (let i = 0; i < (viewCells ? 0 : cells.length); i++) {
      const cell = cells[i];
      if (cell.pauseBefore) {
        setStatus(`Pause against heat, 1 min. About ${left()} min left.`);
        await wait(GLOBE_PERF.pauseMs);
      }
      setStatus(
        `Run ${i + 1} of ${cells.length}: ${cell.place}. About ${left()} min left.`,
      );
      if (stepped) await runSteps(cell, runLabel(cell));
      else await runZoom(cell, runLabel(cell));
    }
    driver = null;
    lab.setFactors(null);
    const awakeReport = wake.report();
    await wake.stop();
    const lines = viewCells
      ? [
          formatViewTable(summariseViewRuns(finished), {
            refresh,
            downloads: summariseViewDownloads(finished),
          }),
          awakeReport.heldThroughout
            ? "screen kept on throughout"
            : `screen NOT kept on throughout (lost ${awakeReport.lost}, refused ${awakeReport.refused.length})`,
          ...(cityGaveUp === null
            ? []
            : [
                `the city did not load by ${cityGaveUp}: measured without it from there`,
              ]),
        ]
      : finished.map((r) =>
          formatFrameRunSummary(
            `${r.label}${r.voided ? " VOID" : ""}`,
            r.summary,
          ),
        );
    const timed = finished.filter((r) => !r.voided && !r.stepped && r.hooks);
    if (timed.length > 1) {
      const passed = timed.filter(
        (r) => checkFrameTarget(r.summary.stats.over).pass,
      ).length;
      lines.push(`target met in ${passed} of ${timed.length} runs`);
    }
    const overhead = overheadVerdict();
    if (overhead) {
      lines.push(
        [
          `recorder cost ${overhead.pass ? "within" : "OVER"} noise`,
          `p50 +${overhead.diff.p50.toFixed(2)} / ${overhead.offSpread.p50.toFixed(2)} ms`,
          `p95 +${overhead.diff.p95.toFixed(2)} / ${overhead.offSpread.p95.toFixed(2)} ms`,
        ].join("\n"),
      );
    }
    part("summary").textContent = lines.join("\n\n");
    part("copy").disabled = false;
    part("download").disabled = false;
    part("run").disabled = false;
    statusNote = "";
    setStatus("Done. Copy or Download the result.");
  }
  const start = () =>
    runAll().catch((error) => {
      driver = null;
      if (rec.running()) rec.stopRun();
      hooksOn = true;
      // A failed sweep leaves nothing of its own behind: no items in the
      // scene, the frame working again, the screen free to lock.
      if (viewCells) lab.setItems([], null);
      lab.setPaused?.(false);
      void wake.stop();
      statusNote = "";
      part("run").disabled = false;
      setStatus(`Failed: ${error?.message ?? error}`);
      console.error(error);
    });
  part("run").addEventListener("click", start);
  // `perfAuto=1`: the run starts by itself, so one link is the whole test.
  if (params.perfAuto === 1) start();

  return {
    /**
     * The frame's start. The GPU objects created since the last start were
     * made inside the frame this closes (its render, or a tile landing in
     * its gap), so they are marked before it closes.
     */
    frameStart(now) {
      const info = lab.renderer.info;
      const programs = info.programs?.length ?? 0;
      const { textures, geometries } = info.memory;
      // Programs and GPU objects created (H2, H3).
      if (programs > lastPrograms) mark("program.new", programs - lastPrograms);
      if (textures > lastTextures) mark("texture.new", textures - lastTextures);
      if (geometries > lastGeometries) {
        mark("geometry.new", geometries - lastGeometries);
      }
      lastPrograms = programs;
      lastTextures = textures;
      lastGeometries = geometries;
      rec.frameStart(now);
      if (rec.running() && hooksOn) {
        // The relief's preprocessed nodes, on a frame after the E step, so
        // the walk never lands in the step's own frame (§4.1).
        if (nodesWalkPending && lab.terrain) {
          nodesWalkPending = false;
          let nodes = 0;
          lab.terrain.tiles.traverse(
            () => {
              nodes += 1;
              return false;
            },
            null,
            false,
          );
          mark("nodes.walk");
          rec.sample("relief.nodes", nodes);
        }
        peaks.lowestKm = Math.min(peaks.lowestKm, lab.altitudeM() / 1000);
        peaks.globePending = Math.max(
          peaks.globePending,
          lab.globe.state().pendingTiles,
        );
        peaks.globeCacheMiB = Math.max(
          peaks.globeCacheMiB,
          lab.globe.tiles.lruCache.cachedBytes / 2 ** 20,
        );
        if (lab.terrain) {
          peaks.reliefCacheMiB = Math.max(
            peaks.reliefCacheMiB,
            lab.terrain.tiles.lruCache.cachedBytes / 2 ** 20,
          );
        }
      }
      const ready = waiters;
      waiters = [];
      for (const resolve of ready) resolve();
    },
    /** The lab's own work for the frame is done (the rest is the gap). */
    frameEnd(now) {
      rec.frameEnd(now);
    },
    /** Whether the recorder owns the camera this frame. */
    drives: () => driver !== null,
    /**
     * Places the camera and runs the controls' update (their height
     * raycasts), or, driven through the controls, feeds their wheel input
     * toward the path's altitude (their zoom-point raycasts too).
     */
    drive(now) {
      const target = typeof driver === "function" ? driver(now) : driver;
      if (target.view) {
        lab.placeView(target.place, target.view);
        lab.updateControls();
      } else if (target.controls) {
        lab.wheelZoom(
          perfWheelDeltaY(Math.max(1, lab.altitudeM()), target.altitudeM),
        );
      } else {
        lab.placeCamera(target.place, target.altitudeM);
        lab.updateControls();
      }
    },
    mark,
    /** An E step: the `heightScale` assignment took `spanMs` (H1). */
    eStep(spanMs) {
      if (!hooksOn || !rec.running()) return;
      mark("e.step");
      rec.sample("e.step.ms", +spanMs.toFixed(2));
      nodesWalkPending = true;
    },
    api: {
      run: () => runAll(),
      status: () => status,
      runs: () => finished.length,
      exportText,
      estimateMs: () => estimateMs,
      refreshIntervalMs: () => refreshIntervalMs,
      refresh: () => refresh,
      wakeLock: () => wake.report(),
    },
  };
}
