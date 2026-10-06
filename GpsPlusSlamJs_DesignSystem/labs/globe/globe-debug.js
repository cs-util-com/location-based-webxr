/**
 * The globe lab's Debug panel (round-6 plan 2026-10-04-1050 G6-0,
 * DEC-G6-6): a small button, always there. Opened, it shows the altitude
 * and distance live, records frame times and events while the owner zooms
 * by hand (touches do not void it, unlike `#perf=1`'s scripted runs), and
 * Copy puts the device, the live state, the recording and the event log on
 * the clipboard as one JSON (`globe-debug-log.js`). The frame statistics
 * are the framework's (`globe-perf-stats.js`, DEC-H3). The recorder, its
 * statistics and the share helpers load when the panel first opens, so a
 * page whose panel stays closed never fetches them (`#perf=1` stays the
 * only thing that loads the recorder at boot; globe-perf.smoke).
 *
 * @see globe-debug.js.md
 */
import { formatViewText } from "/globe/globe-target.js";

import { debugExportText } from "./globe-debug-log.js";

/** The thresholds counted (ms), as the recorder's (globe-perf.js). */
const THRESHOLDS_MS = Object.freeze([33, 34, 50, 51, 100]);
/** How often the open panel refreshes its live lines (ms). */
const LIVE_EVERY_MS = 250;

const STYLE = `
  /* The left edge, mid-height: free on a phone (the controls are top
     right, the readout, pin and recorder along the bottom). */
  #globe-debug-toggle { position: fixed; left: 8px; top: 50%; z-index: 60;
    min-width: 48px; min-height: 48px; padding: 0 10px; border-radius: 10px;
    border: 1px solid #5a6b80; background: rgba(10, 14, 22, 0.8); color: #e8eef6;
    font: 600 13px system-ui, sans-serif; }
  #globe-debug { position: fixed; left: 8px; top: calc(50% + 56px); z-index: 60;
    width: min(360px, calc(100vw - 16px)); max-height: calc(50% - 64px); overflow: auto;
    padding: 10px; border-radius: 10px; background: rgba(10, 14, 22, 0.92);
    color: #e8eef6; font: 13px/1.35 system-ui, sans-serif; box-sizing: border-box; }
  #globe-debug .row { display: flex; gap: 8px; margin: 6px 0; }
  #globe-debug button { flex: 1; min-height: 48px; font: 600 15px system-ui, sans-serif;
    border-radius: 8px; border: 1px solid #5a6b80; background: #1e2a3a; color: #fff; }
  #globe-debug pre { margin: 4px 0; white-space: pre-wrap;
    font: 12px/1.3 ui-monospace, monospace; }
  #globe-debug textarea { width: 100%; height: 30vh; box-sizing: border-box;
    font: 11px ui-monospace, monospace; }`;

/** A number with `digits` decimals, or "?" for a non-finite one. */
const fmt = (v, digits = 1) =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "?";

/**
 * The panel for one page. `log` is the page's `createDebugLog()`; `live()`
 * returns the live state (plain numbers and strings); `device()` the device
 * block (`globe-device.js`). Returns the frame hooks the lab calls
 * (`frameStart`, `frameEnd`, `mark`) and `api` for the smokes.
 *
 * @param {{ log: ReturnType<typeof import("./globe-debug-log.js").createDebugLog>,
 *   live: () => Record<string, unknown>, device: () => Record<string, unknown> }} deps
 */
export function createGlobeDebug({ log, live, device }) {
  /** The recorder and the share helpers, once the panel has opened. */
  let tools = null;
  let loading = null;
  const loadTools = () =>
    (loading ??= Promise.all([
      import("./globe-perf-recorder.js"),
      import("./globe-perf-share.js"),
      import("./globe-perf-stats.js"),
    ]).then(([recorder, shareModule, stats]) => {
      tools = {
        rec: recorder.createPerfRecorder({
          createRun: () =>
            stats.createFrameRun({
              refreshIntervalMs: null,
              thresholdsMs: THRESHOLDS_MS,
            }),
        }),
        share: shareModule.browserShareEnv(showText),
        copyExport: shareModule.copyExport,
        downloadExport: shareModule.downloadExport,
        formatFrameRunSummary: stats.formatFrameRunSummary,
      };
      return tools;
    }));
  /** The last finished recording's result, or null. */
  let recording = null;
  let lastExport = "";

  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.id = "globe-debug-toggle";
  toggle.textContent = "Debug";
  toggle.setAttribute("aria-expanded", "false");
  const panel = document.createElement("div");
  panel.id = "globe-debug";
  panel.hidden = true;
  panel.innerHTML = `
    <pre data-debug="live" aria-live="off"></pre>
    <div class="row">
      <button type="button" data-debug="record">Record</button>
      <button type="button" data-debug="copy">Copy</button>
      <button type="button" data-debug="download">Download</button>
    </div>
    <div data-debug="status" role="status"></div>
    <pre data-debug="summary"></pre>
    <textarea data-debug="text" hidden readonly aria-label="The debug info, to select and copy"></textarea>`;
  document.body.append(toggle, panel);
  const part = (name) => panel.querySelector(`[data-debug="${name}"]`);

  const showText = (text) => {
    const box = part("text");
    box.value = text;
    box.hidden = false;
    box.focus();
    box.select();
  };

  let shownAt = -Infinity;
  const showLive = (now) => {
    if (panel.hidden || now - shownAt < LIVE_EVERY_MS) return;
    shownAt = now;
    const s = live();
    part("live").textContent = [
      `altitude ${fmt(s.altitudeKm)} km, distance ${fmt(s.distanceKm)} km`,
      `at ${fmt(s.lat, 3)}, ${fmt(s.lng, 3)}  heading ${fmt(s.headingDeg, 0)}°  pitch ${fmt(s.pitchDeg, 0)}°`,
      `E ${fmt(s.e, 1)}  band share ${fmt(s.bandShare, 2)}`,
      `globe tiles ${s.globeLoaded ?? "?"} loaded, ${s.globePending ?? "?"} pending, ${fmt(s.globeMiB)} MiB`,
      `relief tiles ${s.reliefVisible ?? "-"} visible, ${s.reliefPending ?? "-"} pending, ${fmt(s.reliefMiB)} MiB`,
      `heights kept ${s.keptHeights?.kept ?? "-"}, ${fmt((s.keptHeights?.keptBytes ?? Number.NaN) / 2 ** 20)} MiB`,
      `events ${log.total()}${tools?.rec.running() ? "  RECORDING" : ""}`,
    ].join("\n");
  };

  /**
   * The page's link with `view=` set to the live pose (volume-cloud plan
   * §16), so an export pasted back opens exactly this view; null without a
   * readable pose.
   */
  const viewLink = (s) => {
    const pose = [s.lat, s.lng, s.altitudeKm, s.headingDeg, s.pitchDeg];
    if (!pose.every(Number.isFinite) || !(s.altitudeKm > 0)) return null;
    const params = new URLSearchParams(location.hash.slice(1));
    params.set("view", formatViewText(s));
    const hash = params
      .toString()
      .replaceAll("%2C", ",")
      .replaceAll("%3A", ":");
    return `${location.origin}${location.pathname}#${hash}`;
  };
  const exportText = () => {
    const s = live();
    return debugExportText({
      device: device(),
      live: s,
      recording,
      events: log.entries(),
      link: viewLink(s),
    });
  };

  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
    shownAt = -Infinity;
    showLive(performance.now());
    if (!panel.hidden) void loadTools();
  });
  part("record").addEventListener("click", async () => {
    const { rec, formatFrameRunSummary } = await loadTools();
    if (rec.running()) {
      const r = rec.stopRun();
      recording = r && {
        frames: r.work.frames,
        summary: r.summary,
        counts: r.counts,
      };
      log.log("debug.record.stop", { frames: r?.work.frames ?? 0 });
      part("record").textContent = "Record";
      part("summary").textContent = r
        ? formatFrameRunSummary("manual", r.summary)
        : "";
      part("status").textContent = "Recording stopped. Copy includes it.";
    } else {
      recording = null;
      rec.startRun("manual");
      log.log("debug.record.start");
      part("record").textContent = "Stop";
      part("summary").textContent = "";
      part("status").textContent = "Recording: zoom and pan as you like.";
    }
  });
  part("copy").addEventListener("click", async () => {
    const { copyExport, share } = await loadTools();
    lastExport = exportText();
    const how = await copyExport(lastExport, share);
    part("status").textContent =
      how === "clipboard"
        ? "Copied. Paste it into the chat."
        : "Copy was refused: select the text below.";
  });
  part("download").addEventListener("click", async () => {
    const { downloadExport, share } = await loadTools();
    lastExport = exportText();
    const stamp = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const how = downloadExport(
      lastExport,
      `globe-debug-${stamp.replaceAll(":", "-")}.json`,
      share,
    );
    part("status").textContent =
      how === "download"
        ? "Saved."
        : "Saving was refused: select the text below.";
  });

  return {
    frameStart(now) {
      tools?.rec.frameStart(now);
      showLive(now);
    },
    frameEnd(now) {
      tools?.rec.frameEnd(now);
    },
    mark(kind, n = 1) {
      if (tools?.rec.running()) tools.rec.mark(kind, n);
    },
    api: {
      /** The export as Copy would produce it now. */
      exportText,
      recording: () => recording,
      lastExport: () => lastExport,
    },
  };
}
