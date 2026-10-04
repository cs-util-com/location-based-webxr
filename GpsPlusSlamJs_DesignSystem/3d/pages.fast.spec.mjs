// @ts-check
/**
 * The design system's fast browser tier (plan 2026-10-04-1002, DEC-DSE-1):
 * every page opens, reaches its ready signal, compiles the shader variants
 * its switches select, and draws something, with no page error, no console
 * error and no request to a path the dev server does not have. Nothing here
 * measures a look: every pixel statistic, sweep and cost ratio lives in the
 * `*.smoke.spec.mjs` files, the on-demand tier (`DS_E2E_TIER=full`).
 *
 * Why this file matters: it is the design system's default browser gate, so
 * it is what still catches a page that does not start. On 2026-10-04 the
 * terrain colour comparison page failed to resolve "three" and never ran;
 * only a 9.7 min timeout in the long suite showed it.
 */
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { discoverEntries } from "../build-lookdev.mjs";
import {
  fixtureTile,
  routeAll,
} from "../labs/terrain/terrain-smoke-helpers.mjs";
import { STYLE_LIGHT } from "../labs/terrain/terrain-params.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Each page's ready signal: the global its own smokes wait on. A page the
 * deploy builder finds and this table lacks fails the first test, so a new
 * lab must state how it says "ready".
 */
const READY = {
  "/index.html": null,
  "/3d/index.html": "__lookdev",
  "/labs/ar-shadows/index.html": "__arShadowsLab",
  "/labs/globe/index.html": "__globeLab",
  "/labs/globe-terrain/index.html": "__terrainCarrier",
  "/labs/terrain/index.html": "__terrainLab",
  "/labs/terrain/compare.html": "__terrainCompare",
};

/**
 * A screenshot's largest channel standard deviation must exceed this to
 * count as drawn: a blank or single-colour canvas reads 0 (8-bit levels;
 * real pages read 20-70, logged per page).
 */
const DRAWN_MIN_STDEV = 2;

/**
 * Collects page errors, console errors, same-origin 404s and any request
 * that leaves 127.0.0.1 (aborted: the fast tier never touches the network)
 * for `page`.
 */
async function watch(page) {
  const problems = [];
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.protocol === "data:") {
      return route.continue();
    }
    problems.push(`external: ${url.origin}${url.pathname}`);
    return route.abort();
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.status() === 404 && new URL(r.url()).hostname === "127.0.0.1") {
      problems.push(`404: ${new URL(r.url()).pathname}`);
    }
  });
  return problems;
}

/** Resolves after `n` animation frames, so a switch's program compiles and draws. */
const frames = (page, n = 3) =>
  page.evaluate(
    (count) =>
      new Promise((resolve) => {
        let left = count;
        const step = () =>
          --left <= 0 ? resolve(null) : requestAnimationFrame(step);
        requestAnimationFrame(step);
      }),
    n,
  );

/** Waits for `name`'s ready (or error) flag and fails on an error. */
async function ready(page, name) {
  await page.waitForFunction(
    (g) => window[g]?.ready || window[g]?.error,
    name,
    { timeout: 90_000 },
  );
  expect(await page.evaluate((g) => window[g].error ?? null, name)).toBeNull();
}

/** The screenshot's largest channel standard deviation (8-bit levels). */
async function drawnStdev(page) {
  const { channels } = await sharp(await page.screenshot()).stats();
  return Math.max(...channels.slice(0, 3).map((c) => c.stdev));
}

test("every deployable page has a ready signal here", () => {
  const pages = ["/index.html", ...discoverEntries(ROOT)];
  expect(pages.filter((p) => !(p in READY))).toEqual([]);
});

test("the catalog page opens without errors", async ({ page }) => {
  const problems = await watch(page);
  await page.goto("/");
  await expect(page.locator("body")).not.toBeEmpty();
  expect(problems).toEqual([]);
});

/**
 * Opens the look-dev page, applies each switch in turn (each rebuilds the
 * look, so its programs compile), and checks after each that nothing failed
 * and at the end that the page draws. Two tests, so each stays well inside
 * the per-test timeout on SwiftShader.
 */
async function lookdevVariants(page, name, variants) {
  const problems = await watch(page);
  await page.goto("/3d/");
  await ready(page, "__lookdev");
  for (const [label, apply] of variants) {
    await page.evaluate(`(${apply.toString()})(window.__lookdev)`);
    await frames(page);
    expect(problems, label).toEqual([]);
  }
  const stdev = await drawnStdev(page);
  console.log(`look-dev (${name}) drawn: stdev ${stdev.toFixed(1)}`);
  expect(stdev).toBeGreaterThan(DRAWN_MIN_STDEV);
}

test("the look-dev page's cloud modes and scene effects compile and draw without errors", async ({
  page,
}) => {
  await lookdevVariants(page, "clouds and effects", [
    ["cloud mode dome", (d) => d.setCloudMode("dome")],
    ["cloud mode sheet", (d) => d.setCloudMode("sheet")],
    ["cloud mode slab", (d) => d.setCloudMode("slab")],
    ["sun shadows", (d) => d.setShadows(true)],
    ["cloud shadows", (d) => d.setCloudShadows(true)],
    ["ambient occlusion", (d) => d.setAo(true)],
    ["catalog", (d) => d.setCatalog(true)],
  ]);
});

test("the look-dev page's tiers, god rays and bloom compile and draw without errors", async ({
  page,
}) => {
  await lookdevVariants(page, "tiers and post", [
    // The god rays draw on a tier without bloom, and their pass renders
    // (and compiles) only while the sun is in view.
    ["phone tier", (d) => d.setTier("phone")],
    ["god rays", (d) => d.setGodRays(true)],
    ["looking at the sun", (d) => d.setView("atsun")],
    // Bloom exists on the desktop tier only.
    ["desktop tier", (d) => d.setTier("desktop")],
    ["bloom", (d) => d.setBloom(true)],
    ["the city view", (d) => d.setView("city")],
  ]);
});

test("the globe lab opens with the relief, the band and the recorder, without errors", async ({
  page,
}) => {
  const problems = await watch(page);
  // The relief on synthetic heights (no network), both carriers drawn at a
  // fixed share of the band, and the frame-hitch recorder's overlay.
  await page.goto(
    "/labs/globe/#relief=1&reliefHeights=synthetic&bandShare=0.5&perf=1&spinMs=0&turnMs=0&stars=0&milkyWay=0",
  );
  await ready(page, "__globeLab");
  await frames(page, 10);
  const relief = await page.evaluate(
    () => window.__globeLab.state().relief?.visibleTiles ?? null,
  );
  console.log(`globe lab: relief tiles visible ${relief}`);
  await expect(page.getByRole("button", { name: /run/i })).toBeVisible();
  expect(problems).toEqual([]);
  const stdev = await drawnStdev(page);
  console.log(`globe lab drawn: stdev ${stdev.toFixed(1)}`);
  expect(stdev).toBeGreaterThan(DRAWN_MIN_STDEV);
  // The Debug panel (round-6 plan G6-0): it opens, records, and Copy
  // produces JSON the owner can paste, with a finite altitude.
  await page.locator("#globe-debug-toggle").click();
  await expect(page.locator("#globe-debug")).toBeVisible();
  await page.locator('[data-debug="record"]').click();
  await frames(page, 10);
  await page.locator('[data-debug="record"]').click();
  await page.locator('[data-debug="copy"]').click();
  await expect(page.locator('[data-debug="status"]')).toContainText(/Cop/);
  const exported = JSON.parse(
    await page.evaluate(() => window.__globeLab.debug.lastExport()),
  );
  expect(exported.format).toBe("globe-debug/1");
  expect(Number.isFinite(exported.live.altitudeKm)).toBe(true);
  expect(exported.recording.frames).toBeGreaterThan(0);
  expect(exported.events.length).toBeGreaterThan(0);
  expect(problems).toEqual([]);
});

test("the globe-terrain carrier lab opens and draws without errors", async ({
  page,
}) => {
  const problems = await watch(page);
  await page.goto("/labs/globe-terrain/");
  await ready(page, "__terrainCarrier");
  await frames(page, 10);
  expect(problems).toEqual([]);
  const stdev = await drawnStdev(page);
  console.log(`globe-terrain lab drawn: stdev ${stdev.toFixed(1)}`);
  expect(stdev).toBeGreaterThan(DRAWN_MIN_STDEV);
});

test("the terrain lab opens in every style without errors", async ({
  page,
}) => {
  const problems = await watch(page);
  const record = await routeAll(page, fixtureTile);
  await page.goto("/labs/terrain/");
  await ready(page, "__terrainLab");
  for (const style of Object.keys(STYLE_LIGHT)) {
    const hash = `style=${style}`;
    await page.evaluate((h) => {
      location.hash = h;
    }, hash);
    await page.waitForFunction(
      (h) => window.__terrainLab.state().appliedHash === h,
      hash,
      { timeout: 30_000 },
    );
    await frames(page);
    expect(problems, style).toEqual([]);
  }
  expect(record.missing).toEqual([]);
  const stdev = await drawnStdev(page);
  console.log(`terrain lab drawn: stdev ${stdev.toFixed(1)}`);
  expect(stdev).toBeGreaterThan(DRAWN_MIN_STDEV);
});

test("the terrain colour comparison page starts and drives the lab", async ({
  page,
}) => {
  const problems = await watch(page);
  await routeAll(page, fixtureTile);
  await page.goto("/labs/terrain/compare.html?quick=1");
  // Its script ran (the page's own results object), and the lab it drives
  // inside its frame became ready.
  await page.waitForFunction(
    () => window.__terrainCompare !== undefined,
    null,
    {
      timeout: 30_000,
    },
  );
  await page.waitForFunction(
    () =>
      window.__terrainCompare.error ||
      document.querySelector("iframe")?.contentWindow?.__terrainLab?.ready,
    null,
    { timeout: 90_000 },
  );
  expect(await page.evaluate(() => window.__terrainCompare.error)).toBeNull();
  expect(problems).toEqual([]);
});

test("the AR shadows lab opens and draws without errors", async ({ page }) => {
  const problems = await watch(page);
  await page.goto("/labs/ar-shadows/");
  await ready(page, "__arShadowsLab");
  await frames(page, 10);
  expect(problems).toEqual([]);
  const stdev = await drawnStdev(page);
  console.log(`AR shadows lab drawn: stdev ${stdev.toFixed(1)}`);
  expect(stdev).toBeGreaterThan(DRAWN_MIN_STDEV);
});
