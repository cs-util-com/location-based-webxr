// @ts-check
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import {
  answerHosts,
  capture,
  capturing,
  openSampleIn3d,
} from "./editor3d-fixture.js";
import { stationBlocks } from "./tour-fixture.mjs";

/**
 * Why these tests matter: a video stands free in its station - a screen,
 * a cutout or a porthole - and the creator sets how it starts, whether it
 * starts with its sound and a cutout's background from the inspector's
 * video panel. Only the page shows the station's "+" menu, the file
 * picker, the add, the selection, the panel's chips and the undo working
 * together: a video was refused at a station until it had a free look, so
 * the add itself is the first thing that could break. The loop switch, the
 * typed captions, the width slider and the preview's "Use current frame"
 * each reach the tour only through the page's own wiring, and the preview
 * must read a browser-recorded clip that states no length.
 */

// One worker for the file: software-drawn 3D views side by side are
// several times slower than one after another.
test.describe.configure({ mode: "default" });

const CLIP = readFileSync(
  new URL("./fixtures/tiny-clip.webm", import.meta.url),
);

/** @param {import("@playwright/test").Page} page */
function tourNow(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.manifest(),
  );
}

/** @param {import("@playwright/test").Page} page */
function revision(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.editor().revision(),
  );
}

/**
 * The gate's video, as the tour has it, or undefined.
 * @param {import("@playwright/test").Page} page
 */
async function gateVideo(page) {
  const gate = (await tourNow(page)).stations.find(
    (/** @type {any} */ s) => s.id === "gate",
  );
  return stationBlocks(gate).find((/** @type {any} */ b) => b.kind === "video");
}

/** @param {import("@playwright/test").Page} page @param {string} act */
function chip(page, act) {
  return page.locator(`#shell-inspector .isec.video [data-act="${act}"]`);
}

test("a video added at a station stands there as a screen, and its panel sets its view, its start and its background, one step each", async ({
  page,
}, testInfo) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
  await answerHosts(page);
  await openSampleIn3d(page);
  const gate = page.locator('#tree-body .card[data-station="gate"]');
  await gate.locator(".head").hover();
  await gate.locator(".head .add").click();
  const menu = page.locator("#tree-add-menu");
  await expect(menu).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await menu.locator('[data-kind="video"]').click();
  await (
    await chooser
  ).setFiles({ name: "clip.webm", mimeType: "video/webm", buffer: CLIP });

  // Added free, as a screen with a width, and selected: its panel shows.
  // The add reads the clip's length and mints its poster first, each with
  // its own wait (a recorded WebM states no length): seconds, not frames.
  await expect
    .poll(async () => (await gateVideo(page))?.view, { timeout: 30_000 })
    .toBe("screen");
  const added = await gateVideo(page);
  expect(added.widthM).toBeGreaterThan(0);
  expect(added.pose).toBeDefined();
  await expect(page.locator("#shell-inspector .isec.video")).toBeVisible();
  await expect(chip(page, "video-view:screen")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // An absent start reads as on arrival, an absent sound as muted.
  await expect(chip(page, "video-set:start:enter")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(chip(page, "video-set:sound:off")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // A screen has no background choice: that is a cutout's.
  await expect(chip(page, "video-set:alpha:stacked")).toHaveCount(0);
  await capture(page, testInfo.outputPath("video-1280x800.png"));

  // The start: one step; the chip in use writes nothing. "Starts within"
  // is a near start's distance, so it is listed only once the start is near.
  const within = page.locator('#shell-inspector [data-field="withinM"]');
  await expect(within).toHaveCount(0);
  const start = await revision(page);
  await chip(page, "video-set:start:near").click();
  await expect.poll(async () => (await gateVideo(page))?.start).toBe("near");
  await expect(within).toHaveCount(1);
  expect(await revision(page)).toBe(start + 1);
  await chip(page, "video-set:start:near").click();
  expect(await revision(page)).toBe(start + 1);

  // A cutout: its background choice shows, with the note while as filmed.
  await chip(page, "video-view:cutout").click();
  await expect.poll(async () => (await gateVideo(page))?.view).toBe("cutout");
  await expect(chip(page, "video-set:alpha:none")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const note = page.locator("#shell-inspector .isec.video", {
    hasText: "stacked-alpha",
  });
  await expect(note).toHaveCount(1);
  await chip(page, "video-set:alpha:stacked").click();
  await expect.poll(async () => (await gateVideo(page))?.alpha).toBe("stacked");
  await expect(note).toHaveCount(0);
  expect(await revision(page)).toBe(start + 3);

  // One undo takes the background back; the start and the view stay.
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await gateVideo(page))?.alpha).toBeUndefined();
  const undone = await gateVideo(page);
  expect(undone.view).toBe("cutout");
  expect(undone.start).toBe("near");

  // The loop: one switch, its press writing the other value.
  const loop = page.locator('#shell-inspector .isec.video [role="switch"]');
  await expect(loop).toHaveAttribute("aria-checked", "false");
  await loop.click();
  await expect.poll(async () => (await gateVideo(page))?.loop).toBe("on");
  await expect(loop).toHaveAttribute("aria-checked", "true");

  // Captions typed as WebVTT: the panel says what was read.
  const captions = page.locator('#shell-inspector [data-field="captions"]');
  await captions.fill(
    "WEBVTT\n\n00:00.000 --> 00:01.000\nThe old gate.\n\n00:01.000 --> 00:02.000\nIts arch.\n",
  );
  await captions.press("Tab");
  await expect
    .poll(async () => (await gateVideo(page))?.captions)
    .toContain("The old gate.");
  await expect(
    page.locator("#shell-inspector .isec.video .note", {
      hasText: "Captions:",
    }),
  ).toContainText("2 cues");

  // The width slider beside the number: the keyboard's End is its 6 m.
  const width = page.locator(
    '#shell-inspector input[type="range"][data-act="extent-slider"]',
  );
  await width.focus();
  await page.keyboard.press("End");
  await expect.poll(async () => (await gateVideo(page))?.widthM).toBe(6);

  // The preview reads the recorded clip's length and size, and makes the
  // frame shown the poster.
  const preview = page.locator(
    '#shell-inspector [data-testid="video-preview"]',
  );
  await expect(preview.locator(".vprev-facts")).toHaveText(/^\d+:\d\d · /, {
    timeout: 15_000,
  });
  const posterBefore = (await gateVideo(page)).poster;
  await preview.locator(".vprev-frame").click();
  await expect(preview.locator(".vprev-note")).toHaveText(
    "This frame is the poster now.",
    { timeout: 15_000 },
  );
  const withPoster = await gateVideo(page);
  expect(withPoster.poster).toBeDefined();
  expect(withPoster.poster).not.toBe(posterBefore);
  await capture(page, testInfo.outputPath("video-panel-1280x800.png"));

  if (capturing) {
    for (const [width, height] of [
      [390, 844],
      [844, 390],
    ]) {
      await page.setViewportSize({ width, height });
      await capture(page, testInfo.outputPath(`video-${width}x${height}.png`));
    }
  }
});
