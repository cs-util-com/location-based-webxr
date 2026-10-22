// @ts-check
import { expect, test } from "@playwright/test";

import { terrariumPng } from "../../scripts/e2e/terrarium-png.mjs";

/**
 * Why these tests matter: the desktop editor's view switch opens the tour
 * in 3D over the map, and the 3D view loads three ways (its code, its
 * ground, WebGL). These drive the real switch on the sample tour, with the
 * relief's and the map's hosts answered here (a flat ground at the sample
 * square's own height, a plain map tile), and check what a creator sees: the button
 * saying it loads while the 3D view's code is held back, then the view
 * with its credits and the map asked for at the start view, the morph
 * flat looking down and upright tilted, and the map again with the
 * selection and the save status as they were. A 3D view whose code cannot
 * load lands back on the map with the reason said; and nothing asks for
 * the globe's whole-Earth imagery.
 */

/** 1x1 grey PNG: a map tile the page can decode. */
const MAP_TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mN4+vQpAAWwAteyYcjKAAAAAElFTkSuQmCC",
  "base64",
);

const LOADING = "Loading 3D view…";

/** The sample square's ground over sea level (m): Mapterhorn there, to
 *  within a metre. A flat relief at it puts the sample's stations on the
 *  ground, and a camera above it, as on the real hosts. */
const SQUARE_GROUND_M = 515.5;

/**
 * Answer the relief's host with a flat ground at the square's height (512 px
 * Terrarium tiles, as Mapterhorn serves them) and the map's with a plain
 * tile; refuse the globe's whole-Earth imagery, counting any ask.
 * @param {import("@playwright/test").Page} page
 */
async function answerHosts(page) {
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

/** @param {import("@playwright/test").Page} page */
function view3d(page) {
  return page.evaluate(() => {
    const hook = /** @type {any} */ (window).__tourEditor;
    return hook.view3d();
  });
}

/** @param {import("@playwright/test").Page} page */
async function openSample(page) {
  await page.goto("/edit.html");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  // No tour, nothing to show in 3D: the switch waits for one.
  await expect(page.locator("#view-switch")).toBeDisabled();
  await page.locator("#sample-btn").click();
  await expect(page.locator("#rail .row-title")).toHaveCount(3);
}

test("opens the sample tour in 3D after a loading state, and back to the map with the selection kept", async ({
  page,
}) => {
  // The relief loads from its root tile down to the street level, every
  // tile a 512 px synthetic image made here, on a software-drawn WebGL:
  // the map is asked for only once the street-level tiles are in.
  test.setTimeout(120_000);
  const imagery = await answerHosts(page);
  // The 3D view's code is held until the loading state has been seen.
  /** @type {() => void} */
  let release = () => undefined;
  const held = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  await page.route("**/src/editor3d/editor3d-scene.ts*", async (route) => {
    await held;
    await route.continue();
  });
  await openSample(page);
  await page.locator("#rail .row-title", { hasText: "The old gate" }).click();
  await expect(page.locator("#card")).toBeVisible();
  const status = await page.locator("#save-status").textContent();

  const button = page.locator("#view-switch");
  await expect(button).toHaveText("3D view");
  await button.click();
  await expect(button).toHaveText(LOADING);
  await expect(button).toBeDisabled();
  await expect(page.locator("#view3d")).toBeHidden();
  release();

  await expect(button).toHaveText("Map view");
  await expect(button).toBeEnabled();
  await expect(page.locator("#view3d")).toBeVisible();
  await expect(page.locator("#view3d canvas")).toBeVisible();
  await expect(page.locator("#view3d-credits")).toContainText("Mapterhorn");
  await expect(page.locator("#view3d-credits")).toContainText("OpenStreetMap");
  // The card points at the map's marker: not over the 3D view.
  await expect(page.locator("#card")).toBeHidden();

  // Every station placed, all three near the centre, and the map asked
  // for at the start view (the editor's gate, not the flight's).
  await expect.poll(async () => (await view3d(page))?.stations).toBe(3);
  await expect
    .poll(async () => [...((await view3d(page))?.shown ?? [])].sort())
    .toEqual(["column", "gate", "steps"]);
  await expect
    .poll(async () => (await view3d(page))?.osm.requests, { timeout: 90_000 })
    .toBeGreaterThan(0);
  const start = await view3d(page);
  expect(start.tiltDeg).toBeGreaterThan(42);
  expect(start.standing).toBe(1);
  // The clip planes follow the camera's own height over the ground
  // (about 210 m at the start, 0.3 of it): a near plane at its 0.2 m
  // floor there leaves the depth buffer no precision for rings and codes
  // on the ground, and one taken from anywhere else clips what is in
  // front of a camera brought close.
  // Every station on the drawn ground, within 2 m.
  for (const s of start.ground) {
    expect(Math.abs(s.drawnM - s.groundM), s.id).toBeLessThan(2);
  }
  expect(start.near).toBeGreaterThan(1);
  expect(start.near).toBeLessThan(0.3 * 260);
  /** @param {number} m */
  const orbitAt = async (m) => {
    await page.evaluate((d) => {
      /** @type {any} */ (window).__tourEditor.view3dDistance(d);
    }, m);
  };
  // Further out at the orbit's far end,
  await orbitAt(1100);
  await expect
    .poll(async () => (await view3d(page))?.near)
    .toBeGreaterThan(start.near * 2);
  // and down to centimetres beside a station.
  await orbitAt(5);
  await expect.poll(async () => (await view3d(page))?.near).toBeLessThan(2);
  await orbitAt(312);

  // The morph: flat looking down, upright tilted (the band 8-42).
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourEditor.view3dTilt(8);
  });
  await expect
    .poll(async () => (await view3d(page))?.standing)
    .toBeLessThan(1e-9);
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourEditor.view3dTilt(42);
  });
  await expect
    .poll(async () => (await view3d(page))?.standing)
    .toBeGreaterThan(1 - 1e-9);

  await button.click();
  await expect(button).toHaveText("3D view");
  await expect(page.locator("#view3d")).toBeHidden();
  expect(await view3d(page)).toBeNull();
  // The same tour, the same selection, nothing changed.
  await expect(page.locator("#card")).toBeVisible();
  await expect(page.locator("#card")).toContainText("The old gate");
  await expect(page.locator("#save-status")).toHaveText(status ?? "");
  expect(imagery.asks).toBe(0);
});

test("a 3D view whose code cannot load lands back on the map, said", async ({
  page,
}) => {
  await answerHosts(page);
  await page.route("**/src/editor3d/editor3d-scene.ts*", (route) =>
    route.abort(),
  );
  await openSample(page);
  const button = page.locator("#view-switch");
  await button.click();
  await expect(
    page.locator(".toast", { hasText: "The 3D view could not be loaded" }),
  ).toBeVisible();
  await expect(button).toHaveText("3D view");
  await expect(button).toBeEnabled();
  await expect(page.locator("#view3d")).toBeHidden();
  await expect(page.locator(".mk-station")).toHaveCount(3);
});
