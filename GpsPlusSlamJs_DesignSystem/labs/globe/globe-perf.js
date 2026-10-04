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
 * setEOverride(e | null), currentE() }`. Returns the hooks the lab's frame
 * calls (`frameStart`, `drives`, `drive`, `frameEnd`, `mark`, `eStep`) and
 * `api` for the smokes.
 */
export function createGlobePerf(lab) {
  const pageStart = performance.now();
  let refreshIntervalMs = null;
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
  /** Holds until the lab's drawn carriers settle, `settleFrames` in a row. */
  const settle = async (timeoutMs) => {
    const t0 = performance.now();
    let still = 0;
    while (performance.now() - t0 < timeoutMs) {
      await nextFrame();
      still = lab.settled() ? still + 1 : 0;
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

  /** The refresh interval, from 2 s idle at the first place's top (§4.1). */
  async function calibrate(place) {
    driver = { place, altitudeM: PERF_PATH.fromM };
    await settle(GLOBE_PERF.moveSettleMs);
    rec.startIdle();
    await wait(GLOBE_PERF.calibrateMs);
    refreshIntervalMs = calibrateRefreshInterval(rec.stopIdle());
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

  /** Who and what ran (§4.1, DEC-PERF-1): strings, numbers, booleans. */
  function device() {
    return deviceBlock({
      renderer: lab.renderer,
      params: lab.params(),
      relief: Boolean(lab.terrain),
      extra: { longAnimationFrame: loafSupported, refreshIntervalMs },
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
        counts: r.counts,
        samples: r.samples,
        work: { insideMs: Math.round(r.work.insideMs), frames: r.work.frames },
        peaks: r.peaks,
        checkpoints: r.checkpoints ?? null,
        eCheck: r.eCheck ?? null,
      })),
      overhead: overheadVerdict(),
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
  const estimateMs = perfSweepEstimateMs(cells) + pauses * GLOBE_PERF.pauseMs;
  const panel = document.createElement("section");
  panel.id = "globe-perf";
  panel.setAttribute("aria-label", "Frame-time recorder");
  panel.innerHTML = PANEL_HTML;
  document.body.append(panel);
  const part = (name) => panel.querySelector(`[data-perf="${name}"]`);
  const minutes = (ms) => Math.max(1, Math.ceil(ms / 60_000));
  const runs = `${cells.length} run${cells.length === 1 ? "" : "s"}`;
  part("plan").textContent = stepped
    ? `Frame-stepped path, ${runs} (counts only).`
    : `${sweep ?? "One run"}: ${runs}, about ${minutes(estimateMs)} min. Do not touch the screen while it runs.`;
  const setStatus = (text) => {
    status = text;
    part("status").textContent = text;
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
      exportFileName(sweep ?? (stepped ? "step" : "run"), Date.now()),
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
    setStatus("Calibrating the refresh rate...");
    await calibrate(placeOf(cells[0].place));
    for (let i = 0; i < cells.length; i++) {
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
    const lines = finished.map((r) =>
      formatFrameRunSummary(`${r.label}${r.voided ? " VOID" : ""}`, r.summary),
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
    setStatus("Done. Copy or Download the result.");
  }
  part("run").addEventListener("click", () => {
    runAll().catch((error) => {
      driver = null;
      if (rec.running()) rec.stopRun();
      hooksOn = true;
      part("run").disabled = false;
      setStatus(`Failed: ${error?.message ?? error}`);
      console.error(error);
    });
  });

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
      if (target.controls) {
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
    },
  };
}
