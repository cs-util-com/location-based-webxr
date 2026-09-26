/**
 * The globe lab's memory and download table (globe plan 2026-09-26-0539
 * §7.8, M4): for each error target and viewport, what the lab loads to
 * settle on one view, and at the phone's working set, what a smaller tile
 * cache refuses. Generated, never written by hand, so the progress entry's
 * table can be re-made after any change.
 *
 * Usage (from GpsPlusSlamJs_DesignSystem/):
 *   pnpm run measure:globe
 *
 * Output: a markdown table on stdout and in shots/globe-measure.md
 * (gitignored). Like shoot-3d.mjs it is an eyeball tool, not a gate:
 * headless Chromium, so byte and tile counts are real but no timing means
 * anything for a phone. Console and page errors DO fail it.
 *
 * @see measure-globe.mjs.md
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { AUX_PORT, startAuxServer } from "./start-aux-server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
/** One view for every row: North Africa and Europe, in daylight. */
const VIEW = "at=30,15&spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z";
const DESKTOP = {
  name: "desktop 1280x800 @1",
  width: 1280,
  height: 800,
  scale: 1,
};
const PHONE = { name: "phone 412x915 @2", width: 412, height: 915, scale: 2 };
/**
 * The rows: every error target on both viewports at the lab's defaults, then
 * the phone's finest view under smaller tile caches (a starved cache refuses
 * tiles, and the view looks soft without anything saying so).
 */
const ROWS = [
  ...[DESKTOP, PHONE].flatMap((viewport) =>
    [1, 2, 4, 16].map((errorTarget) => ({
      viewport,
      extra: `errorTarget=${errorTarget}`,
    })),
  ),
  { viewport: PHONE, extra: "errorTarget=1&cacheMiB=48" },
  { viewport: PHONE, extra: "errorTarget=1&cacheMiB=32" },
];
/** A settle counts only once the tile counts have held this long. */
const STABLE_MS = 1000;

/** One row: a fresh context (so the download count starts at zero). */
async function measure(browser, { viewport, extra }, problems) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.scale,
  });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`http://127.0.0.1:${AUX_PORT}/labs/globe/#${VIEW}&${extra}`);
  await page.waitForFunction(
    () => window.__globeLab?.ready || window.__globeLab?.error,
    null,
    { timeout: 90_000 },
  );
  const error = await page.evaluate(() => window.__globeLab.error);
  if (error) throw new Error(`page reported: ${error}`);
  // Children of a just-parsed tile are queued only at the next update, so
  // one poll can see "nothing pending" between two levels: the counts must
  // hold still for STABLE_MS.
  await page.waitForFunction(
    (stableMs) => {
      const s = window.__globeLab.state();
      const settled =
        s.phase === "arrived" &&
        s.pendingTiles === 0 &&
        s.mapsLoaded + s.mapErrors === s.mapsTotal;
      const key = `${s.loadedTiles}/${s.refusedTiles}`;
      const w = window;
      if (!settled || w.__measureKey !== key) {
        w.__measureKey = key;
        w.__measureSince = performance.now();
        return false;
      }
      return performance.now() - w.__measureSince >= stableMs;
    },
    STABLE_MS,
    { timeout: 180_000, polling: 100 },
  );
  const s = await page.evaluate(() => window.__globeLab.state());
  await context.close();
  const mib = (bytes) => (bytes / 2 ** 20).toFixed(1);
  const cap = mib(s.cacheBudgetBytes);
  return `| ${viewport.name} | ${s.errorTarget} | ${s.pixelRatio} | ${cap} | ${s.loadedTiles} | ${s.refusedTiles} | ${mib(s.bytesDownloaded)} | ${mib(s.cachedBytes)} | ${s.rendererMemory.textures} | ${s.rendererMemory.geometries} |`;
}

const server = await startAuxServer();
const browser = await chromium.launch();
const problems = [];
const rows = [
  "| Viewport | Error target (px) | Pixel ratio | Cache cap (MiB) | Tiles loaded | Tiles refused | Downloaded (MiB) | Tile cache (MiB) | GPU textures | GPU geometries |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
];
try {
  for (const row of ROWS) rows.push(await measure(browser, row, problems));
} finally {
  await browser.close();
  server.kill();
}
const table = rows.join("\n");
console.log(table);
mkdirSync(join(here, "shots"), { recursive: true });
writeFileSync(join(here, "shots", "globe-measure.md"), `${table}\n`);
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
