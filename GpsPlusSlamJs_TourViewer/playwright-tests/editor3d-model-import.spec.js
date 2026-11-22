// @ts-check
import { expect, test } from "@playwright/test";

import { encodeRgbPng } from "../../scripts/e2e/terrarium-png.mjs";
import {
  answerHosts,
  dockSettled,
  openSampleIn3d,
} from "./editor3d-fixture.js";
import {
  bustFolder,
  dropOnPage,
  expectConvertedAndOptimized,
} from "./model-import-fixture.js";

/**
 * Why these tests matter: the model import's two ways in that need the
 * shown editor - the shelf's "Add files..." picker, and a drop on a row of
 * the tree - which the no-3D-view specs (editor-model-import.spec.js)
 * cannot press or reach. A picked glTF folder must be one model, as a
 * dropped one is; and the pictures dropped on a row with a model, which
 * the model does not use, must go to that row once it is made.
 */

// One worker for the file, its tests in order: software-drawn 3D views
// side by side are several times slower than one after another.
test.describe.configure({ mode: "default" });

test.beforeEach(async ({ page }) => {
  await answerHosts(page);
  await page.setViewportSize({ width: 1440, height: 900 });
});

/**
 * Shows the asset shelf once the dock has laid out (before that the
 * editor may still show its Details tab over a Files tab clicked early):
 * docked, it is the Files tab beside the details.
 * @param {import("@playwright/test").Page} page
 */
async function showFiles(page) {
  await dockSettled(page, 1440);
  const files = page
    .locator(".dock-host")
    .getByRole("tab", { name: "Files", exact: true });
  if ((await files.count()) > 0) await files.click();
  await expect(page.locator("#shell-shelf")).toBeVisible();
}

test('a glTF folder picked through the shelf\'s "Add files..." is one model, its pictures inside it', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await openSampleIn3d(page);
  await showFiles(page);
  const cards = page.locator("#shell-shelf .as-card");
  const before = await cards.count();
  const chooser = page.waitForEvent("filechooser");
  await page.locator('#shell-shelf [data-act="add"]:visible').first().click();
  await (
    await chooser
  ).setFiles(
    bustFolder().map((f) => ({
      name: f.name,
      mimeType: f.type,
      buffer: Buffer.from(f.bytes),
    })),
  );
  await expectConvertedAndOptimized(page, "bust.gltf");
  await expect(cards).toHaveCount(before + 1);
});

test("a picture dropped on a station's row with a model it is not part of goes to that station once the model is made", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await openSampleIn3d(page);
  const row = '#tree-body [data-select="station:gate"]';
  await expect(page.locator(row)).toHaveCount(1);
  /** @returns {Promise<string[]>} */
  const kindsAtGate = () =>
    page.evaluate(() =>
      /** @type {any} */ (window).__tourEditor
        .manifest()
        .stations.find((/** @type {any} */ s) => s.id === "gate")
        .children.map((/** @type {any} */ c) => c.kind),
    );
  const before = await kindsAtGate();
  const png = encodeRgbPng(4, 3, new Array(4 * 3 * 3).fill(200));
  await dropOnPage(
    page,
    [...bustFolder(), { name: "stray.png", type: "image/png", bytes: png }],
    row,
  );
  // The model, then the picture let go after it, both at the station.
  await expect
    .poll(kindsAtGate, { timeout: 240_000 })
    .toEqual([...before, "model", "picture"]);
  await expect(
    page.locator(".toast", { hasText: 'Added the picture "stray"' }),
  ).toHaveCount(1);
});
