// @ts-check
import { expect, test } from "@playwright/test";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import {
  createEmptyTourManifest,
  serializeTourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import { viewCommand } from "./editor-menus.js";
import {
  answerHosts,
  openSample,
  openSampleIn3d,
  view3d,
} from "./editor3d-fixture.js";

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

const LOADING = "Loading 3D view…";

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
  await viewCommand(page, "switch");
  await expect(button).toHaveText(LOADING);
  await expect(button).toBeDisabled();
  // The menu closed with the click: the bottom bar says it loads.
  await expect(page.locator("#view-loading")).toBeVisible();
  await expect(page.locator("#view-loading")).toHaveText(LOADING);
  await expect(page.locator("#view3d")).toBeHidden();
  release();

  await expect(button).toHaveText("2D map");
  await expect(button).toBeEnabled();
  await expect(page.locator("#view-loading")).toBeHidden();
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

  await viewCommand(page, "switch");
  await expect(button).toHaveText("3D view");
  await expect(page.locator("#view3d")).toBeHidden();
  expect(await view3d(page)).toBeNull();
  // The same tour, the same selection, nothing changed.
  await expect(page.locator("#card")).toBeVisible();
  await expect(page.locator("#card")).toContainText("The old gate");
  await expect(page.locator("#save-status")).toHaveText(status ?? "");
  expect(imagery.asks).toBe(0);
});

// Why: the 3D view is where a creator starts - a tour opens in it, and
// the map is a step away under View.
test("a tour opens in the 3D view, and View leads to the 2D map", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await answerHosts(page);
  await openSampleIn3d(page);
  await expect(page.locator("#view3d canvas")).toBeVisible();
  await expect(page.locator("#view-menu-btn")).toBeVisible();
  await viewCommand(page, "switch");
  await expect(page.locator("body")).toHaveAttribute("data-view", "2d");
  await expect(page.locator("#view-switch")).toHaveText("3D view");
  await expect(page.locator(".mk-station")).toHaveCount(3);
});

// Why: the map is the fallback - a tour opened where the 3D view cannot
// load is still edited, on the map, with the reason said.
test("a tour whose 3D view cannot load opens on the 2D map, said", async ({
  page,
}) => {
  await answerHosts(page);
  await page.route("**/src/editor3d/editor3d-scene.ts*", (route) =>
    route.abort(),
  );
  await page.goto("/edit.html");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator("#sample-btn").click();
  await expect(
    page.locator(".toast", { hasText: "The 3D view could not be loaded" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toHaveAttribute("data-view", "3d");
  await expect(page.locator("#view-switch")).toHaveText("3D view");
  await expect(page.locator(".mk-station")).toHaveCount(3);
  await expect(page.locator("#rail .row-title")).toHaveCount(3);
});

// Why: a new tour, or one of notes alone, has nothing with a position to
// show in 3D. That is no failure: such a tour opens on the map, which
// shows it, and a line that stays until it is closed - the failures' way -
// made a plain open look broken. At most a passing line says it.
test("a tour with nothing positioned opens on the 2D map quietly: a passing line at most", async ({
  page,
}) => {
  await answerHosts(page);
  await page.addInitScript(() => {
    // @ts-expect-error - the e2e opens through the file input.
    delete window.showOpenFilePicker;
  });
  await page.goto("/edit.html");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add(
    "tour.json",
    new TextReader(
      serializeTourManifest({
        ...createEmptyTourManifest(),
        title: "Nothing placed yet",
      }),
    ),
  );
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#drop").click();
  await (
    await chooser
  ).setFiles({
    name: "nothing-placed.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(await writer.close()),
  });
  await expect(page.locator("#tour-name")).toHaveText("Nothing placed yet");
  await expect(page.locator("#view-switch")).toHaveText("3D view");
  await expect(page.locator("body")).not.toHaveAttribute("data-view", "3d");
  const line = page.locator(".toast", {
    hasText: "nothing with a position to show in 3D",
  });
  // Nothing to close: the line goes by itself.
  await expect(line.getByRole("button", { name: "Close" })).toHaveCount(0);
  await expect(line).toHaveCount(0, { timeout: 20_000 });
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
  await viewCommand(page, "switch");
  await expect(
    page.locator(".toast", { hasText: "The 3D view could not be loaded" }),
  ).toBeVisible();
  await expect(button).toHaveText("3D view");
  await expect(button).toBeEnabled();
  await expect(page.locator("#view3d")).toBeHidden();
  await expect(page.locator(".mk-station")).toHaveCount(3);
});

// Why: a failure's line stays until closed (the creator asked for
// something that did not happen) - but once a later open shows the view
// it says what is no longer so, and must go. The first open fails for want
// of WebGL (the page refuses one WebGL context); the second shows. (A chunk
// that failed cannot stand in: the browser keeps a failed import's answer
// for the page's life.)
test("a later open that shows the 3D view takes the earlier failure's line away", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await answerHosts(page);
  await openSample(page);
  await page.evaluate(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    let refused = false;
    /** @type {any} */ (HTMLCanvasElement.prototype).getContext = function (
      /** @type {string} */ kind,
      /** @type {unknown[]} */ ...rest
    ) {
      if (!refused && kind.startsWith("webgl")) {
        refused = true;
        return null;
      }
      return real.call(this, kind, ...rest);
    };
  });
  const button = page.locator("#view-switch");
  const line = page.locator(".toast", { hasText: "cannot draw the 3D view" });
  await viewCommand(page, "switch");
  await expect(line).toBeVisible();
  await expect(button).toHaveText("3D view");
  await expect(page.locator("#view3d canvas")).toHaveCount(0);
  await viewCommand(page, "switch");
  await expect(button).toHaveText("2D map", { timeout: 60_000 });
  await expect(line).toHaveCount(0);
  await expect(page.locator("#view3d canvas")).toHaveCount(1);
});

// Why: an error inside the 3D view's frame loop before its first frame
// left the open waiting for a frame that never came - the button stuck on
// "Loading 3D view…" - and a failure after the renderer was made left its
// canvas in the box (a second one on the next open). The open must end on
// the map with the reason said and nothing of the view left behind. The
// page's WebGL draw calls throw once, inside three's render.
test("a 3D view whose first frame fails lands back on the map, said, with nothing left", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await answerHosts(page);
  await openSample(page);
  await page.evaluate(() => {
    let thrown = false;
    for (const proto of [
      WebGL2RenderingContext.prototype,
      WebGLRenderingContext.prototype,
    ]) {
      for (const name of /** @type {const} */ ([
        "drawElements",
        "drawArrays",
      ])) {
        const real = /** @type {any} */ (proto)[name];
        /** @type {any} */ (proto)[name] = function (
          /** @type {unknown[]} */ ...args
        ) {
          if (!thrown) {
            thrown = true;
            throw new Error("a draw call failed (test)");
          }
          return real.apply(this, args);
        };
      }
    }
  });
  const button = page.locator("#view-switch");
  await viewCommand(page, "switch");
  await expect(
    page.locator(".toast", { hasText: "stopped on an error" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(button).toHaveText("3D view");
  await expect(button).toBeEnabled();
  await expect(page.locator("#view3d")).toBeHidden();
  await expect(page.locator("#view3d canvas")).toHaveCount(0);
  await expect(page.locator("#view3d-credits")).toBeEmpty();
});

// Why: each open makes a WebGL renderer, and a renderer's dispose() does
// not give its context back; anything still holding the renderer (the
// code squares' shared face texture did, through its dispose listener)
// keeps it alive too. A creator switching back and forth would reach the
// browser's limit (16 in Chromium), which then drops the oldest context -
// the map's markers or the next 3D view among them. Twenty switches must
// never warn of too many contexts.
test("switching to 3D and back twenty times keeps the browser's WebGL contexts free", async ({
  page,
}) => {
  test.setTimeout(240_000);
  /** @type {string[]} */
  const warnings = [];
  page.on("console", (message) => {
    if (/too many active webgl contexts/i.test(message.text())) {
      warnings.push(message.text());
    }
  });
  await answerHosts(page);
  await openSample(page);
  const button = page.locator("#view-switch");
  for (let i = 0; i < 20; i++) {
    await viewCommand(page, "switch");
    await expect(button).toHaveText("2D map", { timeout: 60_000 });
    await viewCommand(page, "switch");
    await expect(button).toHaveText("3D view");
  }
  expect(warnings).toEqual([]);
  await expect(page.locator("#view3d canvas")).toHaveCount(0);
});
