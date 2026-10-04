/**
 * The globe lab's Debug panel (round-6 plan 2026-10-04-1050 G6-0,
 * DEC-G6-6): a small button, always there. Opened, it shows the altitude
 * and distance live, records frame times and events while the owner zooms
 * by hand (touches do not void it, unlike `#perf=1`'s scripted runs), and
 * Copy puts the device, the live state, the recording and the event log on
 * the clipboard as one JSON (`globe-debug-log.js`). The frame statistics
 * are the framework's (`globe-perf-stats.js`, DEC-H3).
 *
 * @see globe-debug.js.md
 */
import { debugExportText } from "./globe-debug-log.js";
import { createPerfRecorder } from "./globe-perf-recorder.js";
import {
  browserShareEnv,
  copyExport,
  downloadExport,
} from "./globe-perf-share.js";
import { createFrameRun, formatFrameRunSummary } from "./globe-perf-stats.js";

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
  const rec = createPerfRecorder({
    createRun: () =>
      createFrameRun({ refreshIntervalMs: null, thresholdsMs: THRESHOLDS_MS }),
  });
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
  const share = browserShareEnv(showText);

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
      `events ${log.total()}${rec.running() ? "  RECORDING" : ""}`,
    ].join("\n");
  };

  const exportText = () =>
    debugExportText({
      device: device(),
      live: live(),
      recording,
      events: log.entries(),
    });

  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
    shownAt = -Infinity;
    showLive(performance.now());
  });
  part("record").addEventListener("click", () => {
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
    lastExport = exportText();
    const how = await copyExport(lastExport, share);
    part("status").textContent =
      how === "clipboard"
        ? "Copied. Paste it into the chat."
        : "Copy was refused: select the text below.";
  });
  part("download").addEventListener("click", () => {
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
      rec.frameStart(now);
      showLive(now);
    },
    frameEnd(now) {
      rec.frameEnd(now);
    },
    mark(kind, n = 1) {
      if (rec.running()) rec.mark(kind, n);
    },
    api: {
      /** The export as Copy would produce it now. */
      exportText,
      recording: () => recording,
      lastExport: () => lastExport,
    },
  };
}
