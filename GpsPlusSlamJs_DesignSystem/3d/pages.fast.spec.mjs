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

test("every deployable page has a ready signal here @pr", () => {
  const pages = ["/index.html", ...discoverEntries(ROOT)];
  expect(pages.filter((p) => !(p in READY))).toEqual([]);
});

test("the catalog page opens without errors @pr", async ({ page }) => {
  const problems = await watch(page);
  await page.goto("/");
  await expect(page.locator("body")).not.toBeEmpty();
  expect(problems).toEqual([]);
});

/**
 * The look-dev page, opened once for its two tests: a cold SwiftShader boot
 * of this page is 33-72 s, the larger share of what each test used to cost.
 * Serial, so a red boot skips the variants and a retry repeats both; the
 * per-PR tier greps only the first test, and `beforeAll` still runs for it.
 */
test.describe("the look-dev page", () => {
  test.describe.configure({ mode: "serial" });
  /** @type {import("@playwright/test").Page} */
  let page;
  /** @type {string[]} */
  let problems;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    problems = await watch(page);
    const started = Date.now();
    await page.goto("/3d/");
    await ready(page, "__lookdev");
    console.log(`look-dev ready in ${Date.now() - started} ms`);
  });
  test.afterAll(async () => {
    await page?.close();
  });

  // Why this test matters: the variants below take minutes on SwiftShader
  // and run only in the full browser run. This one is the per-PR guard that
  // the look-dev page still compiles its default look and draws:
  // `look-presets` and `water-surface-material` have no other importer, and
  // a shader that fails to compile only writes to the console, so without it
  // a broken look would pass every per-PR check.
  test("the look-dev page boots in its default look and draws, without errors @pr", async () => {
    await frames(page);
    expect(problems, "default look").toEqual([]);
    const stdev = await drawnStdev(page);
    console.log(`look-dev (default look) drawn: stdev ${stdev.toFixed(1)}`);
    expect(stdev).toBeGreaterThan(DRAWN_MIN_STDEV);
  });

  // Each switch rebuilds the look, so its programs compile; one list from
  // the default look onward, because on a shared page a second list would
  // start from the first one's switches. These are the variants a shipped
  // package uses (the globe's cloud pass configures slab and dome on the
  // framework's sky, and the cloud shadows are the framework's); the
  // page-only effects (ambient occlusion, the catalog, god rays, bloom, the
  // city) have no importer outside this package and are not checked here.
  test("the look-dev page's cloud modes, shadows and tiers compile and draw without errors", async () => {
    const variants = [
      ["cloud mode dome", (d) => d.setCloudMode("dome")],
      ["cloud mode sheet", (d) => d.setCloudMode("sheet")],
      ["cloud mode slab", (d) => d.setCloudMode("slab")],
      ["sun shadows", (d) => d.setShadows(true)],
      ["cloud shadows", (d) => d.setCloudShadows(true)],
      ["phone tier", (d) => d.setTier("phone")],
      ["desktop tier", (d) => d.setTier("desktop")],
    ];
    for (const [label, apply] of variants) {
      const started = Date.now();
      await page.evaluate(`(${apply.toString()})(window.__lookdev)`);
      await frames(page);
      console.log(`look-dev ${label}: ${Date.now() - started} ms`);
      expect(problems, label).toEqual([]);
    }
    const stdev = await drawnStdev(page);
    console.log(`look-dev (variants) drawn: stdev ${stdev.toFixed(1)}`);
    expect(stdev).toBeGreaterThan(DRAWN_MIN_STDEV);
  });
});

/**
 * The globe lab's boot hash: the relief on synthetic heights (no network),
 * both carriers drawn at a fixed share of the band, and the frame-hitch
 * recorder's overlay.
 */
const GLOBE_BOOT_HASH =
  "relief=1&reliefHeights=synthetic&bandShare=0.5&perf=1&spinMs=0&turnMs=0&stars=0&milkyWay=0";

/**
 * The globe lab, opened once for its two tests, ten frames drawn. On
 * SwiftShader a frame of this page takes about 1-2 s, so one test doing
 * every part once sat at its 180 s budget (2026-11-02); a serial group keeps
 * one budget per test and moves only the boot (36-52 s) into `beforeAll`.
 * The space-shell test is last: it is the only one that moves the camera
 * and changes the hash.
 */
test.describe("the globe lab", () => {
  test.describe.configure({ mode: "serial" });
  /** @type {import("@playwright/test").Page} */
  let page;
  /** @type {string[]} */
  let problems;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    problems = await watch(page);
    const started = Date.now();
    await page.goto(`/labs/globe/#${GLOBE_BOOT_HASH}`);
    await ready(page, "__globeLab");
    await frames(page, 10);
    console.log(`globe lab ready in ${Date.now() - started} ms`);
  });
  test.afterAll(async () => {
    await page?.close();
  });

  test("the globe lab opens with the relief and the band, and draws, without errors @pr", async () => {
    const relief = await page.evaluate(
      () => window.__globeLab.state().relief?.visibleTiles ?? null,
    );
    console.log(`globe lab: relief tiles visible ${relief}`);
    await expect(page.getByRole("button", { name: /run/i })).toBeVisible();
    expect(problems).toEqual([]);
    const stdev = await drawnStdev(page);
    console.log(`globe lab drawn: stdev ${stdev.toFixed(1)}`);
    expect(stdev).toBeGreaterThan(DRAWN_MIN_STDEV);
  });

  test("the globe lab keeps the space shell at x1 low down across hash changes, without errors", async () => {
    // The space pass's shell is x1 at or below 300 km, and a later hash
    // change keeps it so. Why: the lab once wrote the page's whole look,
    // the far x6 included, on every hash change, and the shell's ramp writes
    // only when its own value changes, so the shell stayed x6 at low
    // altitude until the camera moved. The globe smokes do not run in CI;
    // this does. Two hash changes: the first moves the camera to 100 km
    // (the ramp then writes x1 itself), the second is the one that used to
    // put x6 back. Built from the boot hash, not the page's current one, so
    // it does not depend on what ran before it on this page.
    const thicknessAfter = async (hash) => {
      await page.evaluate((h) => {
        location.hash = h;
      }, hash);
      await frames(page, 5);
      return page.evaluate(() => {
        const s = window.__globeLab.state();
        return {
          km: s.groundSky.observerAltitudeKm,
          thickness: s.atmosphere.thickness,
          applied: s.appliedHash,
        };
      });
    };
    const low = `${GLOBE_BOOT_HASH}&view=44.94871,6.85455,100.000,353.1,-9.2`;
    const moved = await thicknessAfter(low);
    expect(moved.km).toBeLessThanOrEqual(300);
    expect(moved.thickness).toBe(1);
    const changed = await thicknessAfter(`${low}&atmoThickness=6`);
    // The lab must have applied the second change, or the x1 below proves
    // nothing: a hash change the lab never handled leaves x1 too.
    expect(changed.applied).toContain("atmoThickness=6");
    expect(changed.km).toBeLessThanOrEqual(300);
    expect(changed.thickness).toBe(1);
    expect(problems).toEqual([]);
  });
});

test("the globe-terrain carrier lab opens and draws without errors @pr", async ({
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

test("the terrain colour comparison page starts and drives the lab @pr", async ({
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

test("the AR shadows lab opens and draws without errors @pr", async ({
  page,
}) => {
  const problems = await watch(page);
  await page.goto("/labs/ar-shadows/");
  await ready(page, "__arShadowsLab");
  await frames(page, 10);
  expect(problems).toEqual([]);
  const stdev = await drawnStdev(page);
  console.log(`AR shadows lab drawn: stdev ${stdev.toFixed(1)}`);
  expect(stdev).toBeGreaterThan(DRAWN_MIN_STDEV);
});
