// @ts-check
import { expect } from "@playwright/test";

import {
  encodeRgbPng,
  terrariumPng,
} from "../../scripts/e2e/terrarium-png.mjs";
import { startOnMap } from "./editor-menus.js";

/** A 1x1 grey PNG: a map tile the page can decode. Encoded here, not
 *  pasted: a hand-copied one carried a broken checksum, so the browser
 *  refused every map tile the tests answered. */
const MAP_TILE = encodeRgbPng(1, 1, [128, 128, 128]);

/** The sample square's ground over sea level (m): Mapterhorn there, to
 *  within a metre. A flat relief at it puts the sample's stations on the
 *  ground, and a camera above it, as on the real hosts. */
export const SQUARE_GROUND_M = 515.5;

/**
 * Answer the relief's host with a flat ground at the square's height (512 px
 * Terrarium tiles, as Mapterhorn serves them) and the map's with a plain
 * tile; refuse the globe's whole-Earth imagery, counting any ask.
 * @param {import("@playwright/test").Page} page
 */
export async function answerHosts(page) {
  const flat = terrariumPng(512, 512, () => SQUARE_GROUND_M);
  await page.route("https://tiles.mapterhorn.com/**", (route) => {
    if (!/\/\d+\/\d+\/\d+\.webp/.test(route.request().url())) {
      return route.abort();
    }
    return route.fulfill({
      status: 200,
      contentType: "image/png",
      body: flat,
    });
  });
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: MAP_TILE }),
  );
  const imagery = { asks: 0 };
  await page.route("**/globe-assets/**", (route) => {
    imagery.asks++;
    return route.abort();
  });
  return imagery;
}

/**
 * Keep every promise the page leaves rejected, from before its first
 * script runs. The map's and the relief's tiles are decoded inside the
 * tiles library, off the page's own code: a tile that cannot be decoded
 * shows nowhere but here. Read the list with `rejections(page)`.
 * @param {import("@playwright/test").Page} page
 */
export async function keepRejections(page) {
  await page.addInitScript(() => {
    const seen = /** @type {string[]} */ ([]);
    /** @type {any} */ (window).__rejections = seen;
    addEventListener("unhandledrejection", (event) => {
      seen.push(String(event.reason?.message ?? event.reason));
    });
  });
}

/**
 * The rejections `keepRejections` kept so far.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string[]>}
 */
export function rejections(page) {
  return page.evaluate(() => /** @type {any} */ (window).__rejections ?? []);
}

/**
 * The 3D view's stats from the page's test hook, or null while it does
 * not show.
 * @param {import("@playwright/test").Page} page
 */
export function view3d(page) {
  return page.evaluate(() => {
    const hook = /** @type {any} */ (window).__tourEditor;
    return hook.view3d();
  });
}

/**
 * The ceiling on waiting for frames (ms). It is not what a test measures:
 * the view draws every frame, and a check counts frames, not time. A
 * software-drawn view at a desktop size draws only 4 to 8 frames a second
 * (measured 2026-10-23: about 7 locally, about 5 on the CI runner, about 4.5
 * under a 6x CPU throttle), so 30 frames take 4 to 7 s, past a poll's 5 s
 * default - which failed a check on the CI runner while the view drew on.
 * This bounds only a view that stopped drawing: 30 frames in it is 0.5 a
 * second.
 */
const FRAMES_WAIT_MS = 60_000;

/**
 * Wait until the 3D view has drawn more than `n` frames past now.
 * @param {import("@playwright/test").Page} page
 * @param {number} n
 */
export async function afterFrames(page, n) {
  /** @param {any} stats */
  const framesOf = (stats) => /** @type {number} */ (stats?.frames ?? 0);
  const from = framesOf(await view3d(page));
  await expect
    .poll(async () => framesOf(await view3d(page)), {
      timeout: FRAMES_WAIT_MS,
    })
    .toBeGreaterThan(from + n);
}

/**
 * The editor page with the sample tour open on the 2D map (not in the 3D
 * view, the default: `openSampleIn3d`), for a spec that edits on the map
 * first or drives the view switch itself.
 * @param {import("@playwright/test").Page} page
 */
export async function openSample(page) {
  await startOnMap(page.context());
  await page.goto("/edit.html");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  // No tour, nothing to show in 3D: the switch waits for one.
  await expect(page.locator("#view-switch")).toBeDisabled();
  await page.locator("#sample-btn").click();
  await expect(page.locator("#rail .row-title")).toHaveCount(3);
}

/**
 * The editor page with the sample tour open, as a creator gets it: in the
 * 3D view, its three stations placed.
 * @param {import("@playwright/test").Page} page
 */
export async function openSampleIn3d(page) {
  await page.goto("/edit.html");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator("#sample-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 60_000,
  });
  await expect(page.locator("#view-switch")).toHaveText("2D map");
  await expect.poll(async () => (await view3d(page))?.stations).toBe(3);
}
