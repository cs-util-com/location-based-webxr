// @ts-check
import { expect } from "@playwright/test";

import {
  encodeRgbPng,
  terrariumPng,
} from "../../scripts/e2e/terrarium-png.mjs";

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
 * The editor page with the sample tour open on the map.
 * @param {import("@playwright/test").Page} page
 */
export async function openSample(page) {
  await page.goto("/edit.html");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  // No tour, nothing to show in 3D: the switch waits for one.
  await expect(page.locator("#view-switch")).toBeDisabled();
  await page.locator("#sample-btn").click();
  await expect(page.locator("#rail .row-title")).toHaveCount(3);
}
