// @ts-check
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import {
  TextWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
} from "@zip.js/zip.js";

import {
  installTourViewerArFakes,
  lockFixtureCode,
  seedAlignment,
  standAt,
  worldManifest,
} from "./ar-fakes.js";
import { save, startOnMap } from "./editor-menus.js";

/**
 * A tour whose station stands every kind of free block in the world (the
 * archive server's `/ranges-ok/blocks-tour.zip`: the stations tour, its
 * gate also holding a captured photo with its own image asset, a picture
 * of the tour's knight image and a placed arch), end to end: the visitor
 * draws the pin, both pictures and the placed model (B2b), and
 * the desktop editor opens it, edits the pin, saves, and the saved file
 * opens again with every block, its story and its assets.
 */

const BLOCKS_ARCHIVE = "http://127.0.0.1:5197/ranges-ok/blocks-tour.zip";

/** The object ids drawn under one station's group, however deep. */
function drawnIdsIn(page, group) {
  return page.evaluate((name) => {
    /** @param {any} o @returns {string[]} */
    const ids = (o) => [
      ...(typeof o.userData?.objectId === "string"
        ? [o.userData.objectId]
        : []),
      ...(o.children ?? []).flatMap(ids),
    ];
    const root = /** @type {any} */ (
      window
    ).__tourViewerTest.fakeScene.children.find(
      (/** @type {any} */ c) => c.name === name,
    );
    return root === undefined ? [] : [...new Set(ids(root))].sort();
  }, group);
}

test("the visitor sees a station's pin, its captured photo, its picture and its placed model in the world", async ({
  page,
}) => {
  // Why this test matters: a free block is drawn by its view - a pin as a
  // label, a picture as a plane whose file is the tour's asset of its
  // image, whether the picture's own (a captured photo) or another of the
  // tour's images. A picture read through the wrong path would be skipped
  // without a word in the scene. A placed model is drawn since B2b (it
  // was left out before): at its size, under its station's group.
  await installTourViewerArFakes(page);
  await page.goto(`/?qr=${encodeURIComponent(BLOCKS_ARCHIVE)}`);
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    { timeout: 15000 },
  );
  const button = page.getByTestId("enter-ar");
  await expect(button).toBeEnabled({ timeout: 10000 });
  await button.click();
  await seedAlignment(page);
  await standAt(page, 0, 0, 0);
  await lockFixtureCode(page);
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        return drawnIdsIn(page, "station-content:gate");
      },
      { timeout: 20000 },
    )
    .toEqual(["gate-arch", "gate-knight", "gate-photo", "gate-pin"]);
});

/**
 * The saved zip's entries and its tour, read from the download.
 * @param {import("@playwright/test").Page} page
 */
async function savedTour(page) {
  const download = page.waitForEvent("download");
  await save(page);
  const file = await download;
  const bytes = new Uint8Array(readFileSync(await file.path()));
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  /** @type {Record<string, string>} */
  const texts = {};
  /** @type {Record<string, number>} */
  const sizes = {};
  for (const entry of await reader.getEntries()) {
    if (entry.directory || entry.getData === undefined) continue;
    if (entry.filename.endsWith(".json")) {
      texts[entry.filename] = await entry.getData(new TextWriter());
    }
    sizes[entry.filename] = (
      await entry.getData(new Uint8ArrayWriter())
    ).length;
  }
  await reader.close();
  return {
    bytes: Buffer.from(bytes),
    json: JSON.parse(texts["tour.json"] ?? "{}"),
    world: worldManifest(texts["tour.json"] ?? "{}"),
    sizes,
  };
}

/**
 * Open `zip` through the editor's file chooser and wait for its rail.
 * @param {import("@playwright/test").Page} page
 * @param {Buffer} zip
 */
async function openInEditor(page, zip) {
  await page.addInitScript(() => {
    // @ts-expect-error - the e2e takes the pickers away on purpose: the
    // file input opens, the save downloads.
    delete window.showOpenFilePicker;
    // @ts-expect-error - as above.
    delete window.showSaveFilePicker;
  });
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.goto("/edit.html");
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#drop").click();
  await (
    await chooser
  ).setFiles({
    name: "blocks-tour.zip",
    mimeType: "application/zip",
    buffer: zip,
  });
  await expect(page.locator("#tour-name")).toHaveText("E2E castle");
}

test("the editor opens a tour of every free block, edits its pin, saves it whole, and the saved file opens again", async ({
  page,
  context,
}) => {
  // Why this test matters: the editor reads the stations' free blocks as
  // objects in the world and writes them back beside the stations'
  // stories. A save that dropped a block it does not list (the placed
  // model), a story block, or the image asset a captured photo owns would
  // lose the creator's work without a word.
  await startOnMap(context);
  const zip = Buffer.from(await (await fetch(BLOCKS_ARCHIVE)).arrayBuffer());
  await openInEditor(page, zip);
  await page.locator("#rail .row", { hasText: "Gate sign" }).click();
  const field = page.locator("#card textarea");
  await field.fill("Gate sign, renamed");
  await field.blur();
  // Opened through the chooser, so there is no file to save into by
  // itself: the line says the browser's draft keeps the change (E2c).
  await expect(page.locator("#save-status")).toHaveText(
    "1 change not saved - kept in this browser until you save",
  );
  const saved = await savedTour(page);

  expect(saved.json).toMatchObject({ version: 4, minor: 0 });
  const byId = Object.fromEntries(
    saved.world.objects.map((/** @type {any} */ o) => [o.id, o]),
  );
  expect(byId["gate-pin"]).toMatchObject({
    kind: "shortText",
    view: "pin",
    caption: "Gate sign, renamed",
  });
  expect(byId["gate-photo"]).toMatchObject({
    kind: "picture",
    image: "gate-photo",
    caption: "The gate at dusk",
    imageAsset: { path: "content/gate-photo.png" },
  });
  expect(byId["gate-knight"]).toMatchObject({
    kind: "picture",
    image: "knight",
    widthM: 0.5,
  });
  expect(byId["gate-arch"]).toMatchObject({
    kind: "model",
    view: "placed",
    asset: "arch",
    sizeM: 2,
  });
  // The story stays as it was: its blocks and the steps that show them.
  const gate = saved.json.stations.find(
    (/** @type {any} */ s) => s.id === "gate",
  );
  expect(gate.steps.map((/** @type {any} */ s) => s.id)).toEqual([
    "knight",
    "ask",
    "farewell",
    "welcome",
  ]);
  expect(gate.blocks.map((/** @type {any} */ b) => b.id)).toContain("sir-kay");
  // Every asset the blocks name is listed, and its file rides along.
  expect(saved.json.assets.map((/** @type {any} */ a) => a.id).sort()).toEqual([
    "arch",
    "gate-photo",
    "knight",
    "voice",
  ]);
  for (const path of [
    "content/gate-photo.png",
    "content/knight.png",
    "content/arch.glb",
    "content/voice.mp3",
  ]) {
    expect(saved.sizes[path], path).toBeGreaterThan(0);
  }

  // Opened again, the saved file shows the edit and changes nothing more.
  const again = await context.newPage();
  await openInEditor(again, saved.bytes);
  await expect(
    again.locator("#rail .row", { hasText: "Gate sign, renamed" }),
  ).toHaveCount(1);
  await expect(again.locator("#save-status")).not.toContainText("not saved");
});
