/**
 * Where a city load's seconds go, the globe lab against OsmDemo (round-4
 * plan 2026-10-11-0122 §5 item 4, R4c step 1): for each place, a COLD load
 * (a fresh browser context: an empty OPFS store and HTTP cache) and a WARM
 * one (the same context reloaded), in both apps, against the REAL network
 * (Overpass and the height tiles).
 *
 * Usage (from GpsPlusSlamJs_DesignSystem/; OsmDemo's dist deps built):
 *   node measure-city-load.mjs [lucerne|bern ...]
 *
 * Output: one markdown block per load on stdout and in
 * shots/city-load-measure.md (gitignored). An eyeball tool, never a gate:
 * it reaches donated Overpass infrastructure (a few res-7 tiles a run, as a
 * user's own visit would), and headless Chromium draws on the CPU, so the
 * seconds are the network's and the parse's, never a phone's frame times.
 *
 * @see measure-city-load.mjs.md
 */
import { chromium } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { AUX_PORT, startAuxServer } from "./start-aux-server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
/** OsmDemo's dev server for this tool: the aux port plus one. */
const DEMO_PORT = AUX_PORT + 1;
const PLACES = {
  lucerne: { lat: 47.0502, lng: 8.3093 },
  bern: { lat: 46.948, lng: 7.4474 },
};
/** A load that has not drawn its city by then is reported as timed out. */
const LOAD_TIMEOUT_MS = 300_000;
/** How often the page's state is read (ms). */
const POLL_MS = 250;

const isOverpass = (url) =>
  /(^|\.)overpass-api\.de$|^overpass\.private\.coffee$|^overpass\.kumi\.systems$/.test(
    url.hostname,
  ) ||
  (url.hostname === "maps.mail.ru" && url.pathname.includes("/overpass/"));
const demOf = (url) => {
  if (url.hostname === "tiles.mapterhorn.com") return "mapterhorn";
  if (
    url.hostname === "s3.amazonaws.com" &&
    url.pathname.startsWith("/elevation-tiles-prod/")
  ) {
    return "aws";
  }
  return null;
};
const zoomOf = (url) =>
  Number(
    url.pathname
      .replace(/\.(png|webp)$/, "")
      .split("/")
      .at(-3),
  );

/** Every Overpass and height request of a load, with its start and end. */
function recordNetwork(context, t0) {
  const log = [];
  const open = new Map();
  context.on("request", (request) => {
    const url = new URL(request.url());
    const dem = demOf(url);
    if (!isOverpass(url) && dem === null) return;
    if (request.method() === "OPTIONS") return;
    const entry = {
      kind: dem === null ? "overpass" : "dem",
      host: url.hostname,
      source: dem,
      zoom: dem === null ? null : zoomOf(url),
      start: Date.now() - t0.at,
      end: null,
      ok: null,
    };
    open.set(request, entry);
    log.push(entry);
  });
  const close = (ok) => (request) => {
    const entry = open.get(request);
    if (!entry) return;
    entry.end = Date.now() - t0.at;
    entry.ok = ok;
    open.delete(request);
  };
  context.on("requestfinished", close(true));
  context.on("requestfailed", close(false));
  return log;
}

/** Long tasks on the page's main thread (PerformanceObserver, buffered). */
const LONG_TASKS = () => {
  window.__longTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__longTasks.push([e.startTime, e.duration]);
      }
    }).observe({ type: "longtask", buffered: true });
  } catch {
    // No long-task timing: the column reads "n/a".
  }
};

const s = (ms) => (ms == null ? "-" : `${(ms / 1000).toFixed(1)} s`);

/** Summary of a request log: count, ok, first start, last end, busy span. */
function summarise(entries) {
  if (entries.length === 0) return "none";
  const ok = entries.filter((e) => e.ok).length;
  const first = Math.min(...entries.map((e) => e.start));
  const last = Math.max(...entries.map((e) => e.end ?? e.start));
  const longest = Math.max(...entries.map((e) => (e.end ?? e.start) - e.start));
  return `${entries.length} (${ok} ok) from ${s(first)} to ${s(last)}, longest ${s(longest)}`;
}

function networkLines(log) {
  const overpass = log.filter((e) => e.kind === "overpass");
  const byDem = {};
  for (const e of log.filter((x) => x.kind === "dem")) {
    const key = `${e.source} z${e.zoom}`;
    (byDem[key] ??= []).push(e);
  }
  return [
    `- Overpass requests: ${summarise(overpass)}`,
    ...Object.entries(byDem)
      .sort()
      .map(([key, entries]) => `- height tiles ${key}: ${summarise(entries)}`),
  ];
}

/** The globe lab's city at a place: from navigation to the city drawn. */
async function loadGlobe(page, place, t0, problems) {
  const hash = [
    "time=2026-10-05T11:00:00Z",
    "spinMs=0",
    "turnMs=0",
    "relief=1",
    `at=${place.lat},${place.lng}`,
    `view=${(place.lat - 0.02).toFixed(4)},${place.lng},3,0,-35`,
  ].join("&");
  t0.at = Date.now();
  await page.goto(`http://127.0.0.1:${AUX_PORT}/labs/globe/#${hash}`);
  const marks = {};
  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => {
      const lab = window.__globeLab;
      if (!lab?.ready) return { error: lab?.error ?? null };
      const s = lab.state();
      return {
        arrival: s.pin?.arrival ?? null,
        city: s.city,
      };
    });
    if (st.error) throw new Error(`page reported: ${st.error}`);
    const at = Date.now() - t0.at;
    if (st.arrival?.outcome && marks.prefetchDone == null) {
      marks.prefetchDone = at;
      marks.prefetch = st.arrival;
    }
    const phase = st.city?.phase;
    if (phase === "loading" && marks.cityAsked == null) marks.cityAsked = at;
    if (phase === "ready" || phase === "failed") {
      marks.cityDone = at;
      last = st;
      break;
    }
    last = st;
    await page.waitForTimeout(POLL_MS);
  }
  if (marks.cityDone == null) problems.push("globe: the city never finished");
  return { marks, last };
}

/** OsmDemo at a place: from navigation to its first and its last ring. */
async function loadDemo(page, place, t0, problems) {
  const lines = [];
  page.on("console", (m) => {
    if (m.type() === "info" && /^click ring|^click /.test(m.text())) {
      lines.push(`${s(Date.now() - t0.at)}: ${m.text()}`);
    }
  });
  t0.at = Date.now();
  await page.goto(
    `http://127.0.0.1:${DEMO_PORT}/?lat=${place.lat}&lng=${place.lng}`,
  );
  const marks = {};
  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  let status = "";
  while (Date.now() < deadline) {
    status = (await page.locator("#status").textContent()) ?? "";
    const at = Date.now() - t0.at;
    if (/\d+ cells/.test(status) && marks.firstCells == null) {
      marks.firstCells = at;
    }
    if (/\d+ volumes/.test(status) && marks.firstCity == null) {
      marks.firstCity = at;
      marks.firstStatus = status;
    }
    if (
      marks.firstCity != null &&
      !status.includes("widening") &&
      /\d+ volumes/.test(status)
    ) {
      marks.lastRing = at;
      break;
    }
    if (/^Failed/.test(status)) {
      problems.push(`demo: ${status}`);
      break;
    }
    await page.waitForTimeout(POLL_MS);
  }
  if (marks.lastRing == null) problems.push("demo: the rings never finished");
  return { marks, status, lines };
}

async function longTasks(page) {
  return page.evaluate(() => window.__longTasks ?? null);
}

function taskLine(tasks, label) {
  if (tasks === null) return `- ${label}: n/a`;
  if (tasks.length === 0) return `- ${label}: none`;
  const durations = tasks.map(([, d]) => d).sort((a, b) => a - b);
  const median = durations[Math.floor(durations.length / 2)];
  return `- ${label}: ${tasks.length} long tasks, longest ${durations.at(-1).toFixed(0)} ms, median ${median.toFixed(0)} ms (SwiftShader frames are long tasks too: compare, never read alone)`;
}

/** One app at one place: a cold load, then the same context reloaded. */
async function measureApp(browser, app, name, place, out, problems) {
  const context = await browser.newContext({
    viewport: { width: 800, height: 600 },
  });
  await context.addInitScript(LONG_TASKS);
  for (const cache of ["cold", "warm"]) {
    const t0 = { at: Date.now() };
    const log = recordNetwork(context, t0);
    const page = await context.newPage();
    page.on("pageerror", (e) => problems.push(`${app}: ${e.message}`));
    const lines = [`### ${app} at ${name}, ${cache}`, ""];
    if (app === "globe") {
      const { marks, last } = await loadGlobe(page, place, t0, problems);
      const p = marks.prefetch;
      lines.push(
        `- prefetch: ${p ? `${p.outcome} at ${s(marks.prefetchDone)}, counts ${JSON.stringify(p.counts)}` : "none"}`,
        `- city asked at ${s(marks.cityAsked)}, ${last?.city?.phase ?? "?"} at ${s(marks.cityDone)}`,
        `- city: ${JSON.stringify(last?.city?.counts ?? null)}${last?.city?.message ? `, "${last.city.message}"` : ""}`,
      );
    } else {
      const {
        marks,
        status,
        lines: rings,
      } = await loadDemo(page, place, t0, problems);
      lines.push(
        `- first cells at ${s(marks.firstCells)}, first city at ${s(marks.firstCity)}, last ring at ${s(marks.lastRing)}`,
        `- status: ${status.slice(0, 240)}`,
        ...rings.map((l) => `  - ${l}`),
      );
    }
    lines.push(...networkLines(log));
    lines.push(taskLine(await longTasks(page), "main thread"));
    lines.push("");
    const block = lines.join("\n");
    console.log(block);
    out.push(block);
    await page.close();
  }
  await context.close();
}

/**
 * Ends a child and everything it started. On Windows the dev server runs as
 * pnpm, cmd and vite in a chain (`shell: true`), and `kill` ends only the
 * first: vite lived on, its pipe kept this script alive, and the browser
 * slot stayed taken for 40 minutes after the last load (2026-10-11).
 */
function stopTree(child) {
  if (process.platform === "win32" && child.pid !== undefined) {
    try {
      execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
      return;
    } catch {
      // Already gone: fall through to the plain kill.
    }
  }
  child.kill();
}

/** OsmDemo's vite dev server on the demo port, resolved once listening. */
function startDemo() {
  const child = spawn(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    [
      "exec",
      "vite",
      "--port",
      String(DEMO_PORT),
      "--strictPort",
      "--host",
      "127.0.0.1",
    ],
    {
      cwd: join(here, "..", "GpsPlusSlamJs_OsmDemo"),
      stdio: ["ignore", "pipe", "inherit"],
      shell: process.platform === "win32",
    },
  );
  return new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes(String(DEMO_PORT))) resolve(child);
    });
    child.on("exit", (code) => reject(new Error(`vite exited ${code}`)));
  });
}

const names = process.argv.slice(2);
const chosen = names.length > 0 ? names : Object.keys(PLACES);
for (const n of chosen) {
  if (!PLACES[n]) throw new Error(`unknown place "${n}"`);
}
const server = await startAuxServer();
const demo = await startDemo();
const browser = await chromium.launch();
const out = [];
const problems = [];
try {
  for (const [i, name] of chosen.entries()) {
    // The order alternates per place, so an Overpass server's own cache
    // never favours the same app twice.
    const apps = i % 2 === 0 ? ["globe", "demo"] : ["demo", "globe"];
    for (const app of apps) {
      await measureApp(browser, app, name, PLACES[name], out, problems);
    }
  }
} finally {
  await browser.close();
  server.kill();
  stopTree(demo);
}
if (problems.length > 0) {
  out.push(`Problems:\n${problems.map((p) => `- ${p}`).join("\n")}`);
  console.log(out.at(-1));
}
mkdirSync(join(here, "shots"), { recursive: true });
writeFileSync(join(here, "shots", "city-load-measure.md"), out.join("\n"));
// Nothing else may hold the process open (a child's pipe would).
process.exit(0);
