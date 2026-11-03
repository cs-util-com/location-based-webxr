// @ts-check
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import {
  TextReader,
  TextWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import {
  createEmptyTourManifest,
  serializeTourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import { fileCommand, save } from "./editor-menus.js";
import {
  SQUARE_GROUND_M,
  afterFrames,
  answerHosts,
  keepRejections,
  noApproach,
  openZip,
  rejections,
  view3d,
} from "./editor3d-fixture.js";

/**
 * Why these tests matter: the editor on the globe is the editor's 3D view
 * now, opened by `/edit.html` with no switch in the link (`?globe=0` is the
 * temporary way back to the older view). These check what a creator gets
 * from the plain link: the globe; a new, empty tour opening on the whole
 * Earth (it used to refuse the 3D view) with its first station placed by a
 * right click on the ground; a plain page, instead of the 2D map, where the
 * 3D view cannot open, its File actions still working; and the "needs no
 * GPS" setting, which lived only in the map's rail, kept through a save and
 * a reload from the 3D view's Tour details. The viewports are named per
 * test; the screenshots go to the test's output.
 */

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1440, height: 900 },
];

/**
 * A tour with nothing positioned yet: a new tour's manifest.
 * @param {string} title
 */
async function emptyTourZip(title) {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add(
    "tour.json",
    new TextReader(
      serializeTourManifest({ ...createEmptyTourManifest(), title }),
    ),
  );
  return Buffer.from(await writer.close());
}

/**
 * The page without the file pickers: the file input opens a tour and a
 * save goes through the browser's download.
 * @param {import("@playwright/test").Page} page
 */
async function withoutPickers(page) {
  await page.addInitScript(() => {
    // @ts-expect-error - absent in this browser for the test.
    delete window.showOpenFilePicker;
    // @ts-expect-error - as above.
    delete window.showSaveFilePicker;
  });
}

/**
 * The texts of a downloaded tour file.
 * @param {import("@playwright/test").Download} download
 */
async function zipTexts(download) {
  const bytes = new Uint8Array(readFileSync(await download.path()));
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  /** @type {Record<string, string>} */
  const texts = {};
  for (const entry of await reader.getEntries()) {
    if (!entry.directory && entry.getData !== undefined) {
      texts[entry.filename] = await entry.getData(new TextWriter());
    }
  }
  await reader.close();
  return { bytes, texts };
}

test("the plain editor link opens the sample tour on the globe", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await answerHosts(page, { globeAssets: "serve" });
  await keepRejections(page);
  await noApproach(page);
  await page.goto("/edit.html");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator("#sample-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 120_000,
  });
  await expect.poll(async () => (await view3d(page))?.stations).toBe(3);
  const stats = await view3d(page);
  // The globe's own stats: only the globe view reports them.
  expect(stats.globe).toBeDefined();
  expect(stats.globe.altitudeM).toBeLessThan(2_000);
  // Its sky's items in the View menu, which the older view hides.
  await page.locator("#view-menu-btn").click();
  await expect(page.locator("#view-realtime")).toBeVisible();
  await expect(page.locator("#view-clouds")).toBeVisible();
  await page.locator("#view-clouds").click();
  await page.keyboard.press("Escape");
  for (const size of VIEWPORTS) {
    await page.setViewportSize(size);
    await afterFrames(page, 2);
    await page.screenshot({
      path: testInfo.outputPath(
        `default-open-${String(size.width)}x${String(size.height)}.png`,
      ),
    });
  }
  expect(await rejections(page)).toEqual([]);
});

test.describe("an empty tour", () => {
  // No summer time there: the zone's longitude (UTC+9, 135 E) is known.
  test.use({ timezoneId: "Asia/Tokyo" });

  test("opens on the whole Earth over the creator's zone, and a right click on the ground places its first station", async ({
    page,
  }, testInfo) => {
    test.setTimeout(420_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await answerHosts(page, { globeAssets: "serve" });
    await keepRejections(page);
    await withoutPickers(page);
    await page.goto("/edit.html");
    await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
    // Opened from a file, as a new tour is: the approach is due, and has
    // nowhere to fly to.
    await openZip(page, await emptyTourZip("Nothing placed yet"), "new.zip");
    await expect(page.locator("#tour-name")).toHaveText("Nothing placed yet");
    await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
      timeout: 120_000,
    });
    // No failure, no line: the globe shows the tour.
    await expect(
      page.locator(".toast", { hasText: "nothing with a position" }),
    ).toHaveCount(0);
    await expect(page.locator("#view3d-failed")).toBeHidden();
    const start = await view3d(page);
    expect(start.stations).toBe(0);
    expect(start.globe.altitudeM).toBeGreaterThan(1_000_000);
    expect(start.globe.pose.lat).toBeCloseTo(30, 0);
    expect(start.globe.pose.lng).toBeCloseTo(135, 0);
    expect(start.globe.pose.pitchDeg).toBeLessThan(-80);
    // The tree is not held folded for an approach that never flies.
    await expect(page.locator("#shell-tree")).toBeVisible();
    for (const size of VIEWPORTS) {
      await page.setViewportSize(size);
      await afterFrames(page, 2);
      await page.screenshot({
        path: testInfo.outputPath(
          `empty-tour-${String(size.width)}x${String(size.height)}.png`,
        ),
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // The heavy clouds off: in this software renderer they hold the frame
    // rate near 1 a second.
    await page.locator("#view-menu-btn").click();
    await page.locator("#view-clouds").click();
    await page.keyboard.press("Escape");
    // Down to about 1 km over the answered ground (at 515.5 m everywhere),
    // looking down, and wait for the relief to carry the ground (its
    // hand-over eases in by frames, and this software renderer draws few:
    // measured about two minutes after the jump down).
    await page.evaluate(() =>
      /** @type {any} */ (window).__tourEditor.view3dDistance(1_500),
    );
    await expect
      .poll(async () => (await view3d(page))?.globe?.carrier, {
        timeout: 210_000,
      })
      .toBe("relief");
    await afterFrames(page, 10);
    const canvas = await page.locator("#view3d canvas").boundingBox();
    if (canvas === null) throw new Error("no canvas");
    const at = {
      x: canvas.x + canvas.width / 2,
      y: canvas.y + canvas.height / 2,
    };
    const item = page.locator("#scene-new-station");
    // The ground under the pointer may still be loading: open the menu
    // again until it offers the station.
    await expect
      .poll(
        async () => {
          await page.keyboard.press("Escape");
          await page.mouse.click(at.x, at.y, { button: "right" });
          await expect(page.locator("#scene-menu")).toBeVisible();
          return item.getAttribute("aria-disabled");
        },
        { timeout: 60_000, intervals: [2_000] },
      )
      .not.toBe("true");
    await item.click();
    await expect
      .poll(async () => (await view3d(page))?.stations, { timeout: 30_000 })
      .toBe(1);
    await expect(
      page.locator(".toast", { hasText: 'Added "Station 1" here' }),
    ).toBeVisible();
    // On the drawn ground, near where the camera looked down.
    const placed = await view3d(page);
    expect(Math.abs(placed.ground[0].drawnM - SQUARE_GROUND_M)).toBeLessThan(2);
    const tour = await page.evaluate(() =>
      /** @type {any} */ (window).__tourEditor.manifest(),
    );
    expect(tour.stations[0].geo.lat).toBeCloseTo(30, 1);
    expect(tour.stations[0].geo.lon).toBeCloseTo(135, 1);
    expect(await rejections(page)).toEqual([]);
  });
});

test.describe("where the 3D view cannot open", () => {
  // Why: without WebGL the 3D view cannot draw; the page says so in plain
  // words over the map, and the tour's File actions stay within reach - a
  // save goes out as a download.
  test("without WebGL a plain page says so, and the tour still saves", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await answerHosts(page, { globeAssets: "serve" });
    await withoutPickers(page);
    await page.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext;
      /** @type {any} */ (HTMLCanvasElement.prototype).getContext = function (
        /** @type {string} */ kind,
        /** @type {unknown[]} */ ...rest
      ) {
        return kind.startsWith("webgl") ? null : real.call(this, kind, ...rest);
      };
    });
    await page.goto("/edit.html");
    await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
    await page.locator("#sample-btn").click();
    const failed = page.locator("#view3d-failed");
    await expect(failed).toBeVisible({ timeout: 60_000 });
    await expect(failed.getByRole("heading")).toHaveText(
      "The 3D view cannot open",
    );
    await expect(failed).toContainText("no WebGL");
    await expect(failed).not.toContainText("map");
    await expect(page.locator("body")).not.toHaveAttribute("data-view", "3d");
    // Said on the page, not in a line that stays.
    await expect(
      page.locator(".toast", { hasText: "cannot draw the 3D view" }),
    ).toHaveCount(0);
    for (const size of VIEWPORTS) {
      await page.setViewportSize(size);
      // Every action on screen, none cut off.
      for (const name of [
        "Try again",
        "Open another tour…",
        "Save",
        "Save a copy…",
        "Tour details…",
      ]) {
        await expect(
          failed.getByRole("button", { name, exact: true }),
        ).toBeInViewport();
      }
      await page.screenshot({
        path: testInfo.outputPath(
          `cannot-open-${String(size.width)}x${String(size.height)}.png`,
        ),
      });
    }
    // What it covers is out of the Tab order meanwhile.
    expect(await page.locator("#map").evaluate((m) => m.inert)).toBe(true);
    const download = page.waitForEvent("download");
    await failed.getByRole("button", { name: "Save a copy…" }).click();
    const { texts } = await zipTexts(await download);
    expect(JSON.parse(texts["tour.json"] ?? "{}").stations).toHaveLength(3);
    // Try again fails the same way, and the page says it again.
    await failed.getByRole("button", { name: "Try again" }).click();
    await expect(failed).toBeVisible();
    await expect(failed).toContainText("no WebGL");
  });

  // Why: the 3D view's code may not arrive (a dropped connection); the page
  // says so, and its Tour details and Open another tour still open.
  test("when its code cannot load the page says so, and its details and open still work", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await answerHosts(page, { globeAssets: "serve" });
    await page.route("**/src/editor3d/editor3d-globe.ts*", (route) =>
      route.abort(),
    );
    await page.goto("/edit.html");
    await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
    await page.locator("#sample-btn").click();
    const failed = page.locator("#view3d-failed");
    await expect(failed).toBeVisible({ timeout: 60_000 });
    await expect(failed).toContainText("could not be loaded");
    await failed.getByRole("button", { name: "Tour details…" }).click();
    await expect(page.locator("#details-modal")).toBeVisible();
    await page.locator("#details-cancel").click();
    await expect(page.locator("#details-modal")).toBeHidden();
    await failed.getByRole("button", { name: "Open another tour…" }).click();
    await expect(page.locator("#open-modal")).toBeVisible();
  });
});

// Why: "This tour needs no GPS" lived only in the map's rail; in the 3D
// view it is in Tour details, and it must reach the file and come back.
test("'needs no GPS' is set in the 3D view's Tour details, saved, and read back", async ({
  page,
}) => {
  test.setTimeout(360_000);
  await answerHosts(page, { globeAssets: "serve" });
  await noApproach(page);
  await withoutPickers(page);
  await page.goto("/edit.html");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator("#sample-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 120_000,
  });
  await fileCommand(page, "details");
  const setting = page.locator("#details-no-gps");
  await expect(setting).not.toBeChecked();
  await expect(page.locator("#details-no-gps-warnings")).toBeEmpty();
  await setting.check();
  // The sample's codes cannot place it: the dialog says what that means
  // before it is applied.
  await expect(page.locator("#details-no-gps-warnings")).toContainText(
    "visitors will be asked for their location anyway",
  );
  await page.locator("#details-apply").click();
  await expect(page.locator("#details-modal")).toBeHidden();
  await expect(page.locator("#save-status")).toContainText("not saved");
  const download = page.waitForEvent("download");
  await save(page);
  const { bytes, texts } = await zipTexts(await download);
  expect(JSON.parse(texts["tour.json"] ?? "{}").needsNoGps).toBe(true);

  // The saved file opened again: the setting is read back, in the dialog.
  // A download is no save in place, so File, Open asks before leaving the
  // tour (its unsaved-work guard): answered yes.
  page.once("dialog", (dialog) => void dialog.accept());
  await fileCommand(page, "open");
  await openZip(page, Buffer.from(bytes), "saved.zip");
  // The view was in 3D already: wait for the open itself to end.
  await expect(page.locator("#open-modal")).toBeHidden({ timeout: 120_000 });
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 120_000,
  });
  await fileCommand(page, "details");
  await expect(page.locator("#details-no-gps")).toBeChecked();
  // Off again, applied: the file would be written without it.
  await page.locator("#details-no-gps").uncheck();
  await page.locator("#details-apply").click();
  await expect(page.locator("#details-modal")).toBeHidden();
  await fileCommand(page, "details");
  await expect(page.locator("#details-no-gps")).not.toBeChecked();
});
