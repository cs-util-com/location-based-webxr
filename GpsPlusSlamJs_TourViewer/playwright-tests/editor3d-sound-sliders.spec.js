// @ts-check
import { expect, test } from "@playwright/test";

import {
  answerHosts,
  dockSettled,
  openSampleIn3d,
} from "./editor3d-fixture.js";
import { save } from "./editor-menus.js";

/**
 * Why these tests matter: a sound's radius, reach and volume are set by
 * feel with sliders in the inspector. Only a browser drags a real thumb:
 * the native slider's events, the two thumbs lying on one track (each must
 * take its own press), a finger-sized row on a phone, and the inspector
 * drawn again under the drag. Each drag, mouse or keyboard, must reach the
 * tour as ONE step that one undo takes back, at a desktop and at a phone
 * held sideways, and the values must be saved.
 */

test.describe.configure({ mode: "default" });

/** The sample's sounds: a narration circle and an ambient zone. */
const SPOT = "column-voice";
const ZONE = "market-sound";

/** @param {import("@playwright/test").Page} page */
function revision(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.editor().revision(),
  );
}

/**
 * The tour's sound `id` as it stands.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 */
async function soundNow(page, id) {
  const tour = await page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.manifest(),
  );
  for (const station of tour.stations) {
    const found = station.children.find((/** @type {any} */ c) => c.id === id);
    if (found !== undefined) return { station: station.id, sound: found };
  }
  throw new Error(`no sound ${id}`);
}

/**
 * The slider of field `name`.
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
function slider(page, name) {
  return page.locator(
    `#shell-inspector input[type="range"][data-act="field-slider:${name}"]`,
  );
}

/**
 * Select the sound `id` by its row in the tree (at a desktop width, where
 * the tree shows), then show the inspector at `size`, unfolded.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 * @param {{ width: number, height: number }} size
 */
async function selectSound(page, id, size) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await dockSettled(page, 1280);
  const { station } = await soundNow(page, id);
  const card = page.locator(`#tree-body .card[data-station="${station}"]`);
  await card.locator(".pick").click();
  await card.locator(`.kid[data-select="${id}"]`).click();
  await expect
    .poll(() =>
      page.evaluate(() => /** @type {any} */ (window).__tourEditor.selected()),
    )
    .toBe(id);
  await page.setViewportSize(size);
  await dockSettled(page, size.width);
  const fold = page.locator('#inspector-head [data-act="fold"]');
  if ((await fold.getAttribute("aria-label")) === "Show the details") {
    await fold.click();
  }
}

/**
 * Drag the slider `name`'s thumb from where it stands to `to` with the
 * mouse, in small moves as a hand does.
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 * @param {number} to
 */
async function mouseDrag(page, name, to) {
  const s = slider(page, name);
  await s.scrollIntoViewIfNeeded();
  const geometry = await s.evaluate((/** @type {HTMLInputElement} */ el) => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      width: r.width,
      y: r.top + r.height / 2,
      min: Number(el.min),
      max: Number(el.max),
      value: Number(el.value),
    };
  });
  // Chromium's thumb is about 16 px wide; its centre travels inside that.
  const xOf = (/** @type {number} */ v) =>
    geometry.left +
    8 +
    ((v - geometry.min) / (geometry.max - geometry.min)) *
      (geometry.width - 16);
  await page.mouse.move(xOf(geometry.value), geometry.y);
  await page.mouse.down();
  await page.mouse.move(xOf(to), geometry.y, { steps: 8 });
  await page.mouse.up();
}

/**
 * One write, then undo: the field back as the tour had it.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 * @param {string} field
 * @param {number} start the revision before the write
 * @param {unknown} before the field before the write
 */
async function oneStepUndone(page, id, field, start, before) {
  await expect.poll(() => revision(page)).toBe(start + 1);
  const written = (await soundNow(page, id)).sound[field];
  expect(written).not.toBe(before);
  await page.locator("#studio-undo").click();
  await expect
    .poll(async () => (await soundNow(page, id)).sound[field])
    .toBe(before);
  return written;
}

for (const size of [
  { width: 1280, height: 800 },
  { width: 844, height: 390 },
]) {
  test(`a sound's radius, reach and volume are dragged by mouse and by keyboard at ${String(size.width)}x${String(size.height)}: one step each, undone`, async ({
    page,
  }) => {
    test.slow();
    await answerHosts(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await openSampleIn3d(page);

    // The narration circle's radius: 6 m on a 2-15 m track by 0.5.
    await selectSound(page, SPOT, size);
    await expect(slider(page, "radiusM")).toBeVisible();
    await expect(slider(page, "radiusM")).toHaveValue("6");
    let start = await revision(page);
    await mouseDrag(page, "radiusM", 10);
    const dragged = await oneStepUndone(page, SPOT, "radiusM", start, 6);
    expect(dragged).toBeGreaterThan(8);
    await expect(slider(page, "radiusM")).toHaveValue("6");

    start = await revision(page);
    await slider(page, "radiusM").focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => (await soundNow(page, SPOT)).sound.radiusM)
      .toBe(6.5);
    await oneStepUndone(page, SPOT, "radiusM", start, 6);

    // The zone: its reach (20 m) and its full-volume edge (4 m) are two
    // thumbs on one track; its volume (50 %) has a curve under it.
    await selectSound(page, ZONE, size);
    await expect(slider(page, "maxM")).toBeVisible();
    await expect(page.locator("#shell-inspector svg.loudness")).toBeVisible();

    start = await revision(page);
    await mouseDrag(page, "maxM", 35);
    expect(await oneStepUndone(page, ZONE, "maxM", start, 20)).toBeGreaterThan(
      25,
    );

    start = await revision(page);
    await mouseDrag(page, "minM", 10);
    expect(await oneStepUndone(page, ZONE, "minM", start, 4)).toBeGreaterThan(
      6,
    );

    start = await revision(page);
    await slider(page, "minM").focus();
    await page.keyboard.press("ArrowLeft");
    await expect
      .poll(async () => (await soundNow(page, ZONE)).sound.minM)
      .toBe(3);
    await oneStepUndone(page, ZONE, "minM", start, 4);

    start = await revision(page);
    await mouseDrag(page, "volume", 80);
    const volume = await oneStepUndone(page, ZONE, "volume", start, 0.5);
    expect(volume).toBeGreaterThan(0.65);

    start = await revision(page);
    await slider(page, "volume").focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => (await soundNow(page, ZONE)).sound.volume)
      .toBe(0.51);
    await expect(
      page.locator('#shell-inspector input[data-field="volume"]'),
    ).toHaveValue("51");
    expect(await revision(page)).toBe(start + 1);
  });
}

test("a slider's value is saved in the tour's file", async ({ page }) => {
  test.slow();
  await page.context().addInitScript(() => {
    // @ts-expect-error - absent in this browser for the test.
    delete window.showSaveFilePicker;
  });
  await answerHosts(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openSampleIn3d(page);
  await selectSound(page, ZONE, { width: 1280, height: 800 });
  await slider(page, "maxM").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => (await soundNow(page, ZONE)).sound.maxM)
    .toBe(22);
  const download = page.waitForEvent("download");
  await save(page);
  const path = await (await download).path();
  const { readFileSync } = await import("node:fs");
  const { ZipReader, Uint8ArrayReader, TextWriter } =
    await import("@zip.js/zip.js");
  const reader = new ZipReader(
    new Uint8ArrayReader(new Uint8Array(readFileSync(path))),
  );
  const entry = (await reader.getEntries()).find(
    (e) => e.filename === "tour.json",
  );
  const tour = JSON.parse((await entry?.getData?.(new TextWriter())) ?? "{}");
  await reader.close();
  const sound = tour.stations
    .flatMap((/** @type {any} */ s) => s.children)
    .find((/** @type {any} */ c) => c.id === ZONE);
  expect(sound).toMatchObject({ maxM: 22, minM: 4, volume: 0.5 });
});
