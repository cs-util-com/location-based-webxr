// @ts-check
import { expect, test } from "@playwright/test";

import {
  afterFrames,
  answerHosts,
  capture,
  openSampleIn3d,
} from "./editor3d-fixture.js";

/**
 * Why these tests matter: the editor's phone layout was chosen from a
 * prototype, and "the element is visible" passes a broken layout. These pin
 * where the sheets stand, how they meet the map, and the way from the list
 * to an element's details and back, in portrait and on the phone's side,
 * with the prototype's numbers: the list 62 % and the details 66 % of the
 * height between the 40 px top bar and the 24 px bottom bar.
 */

// One after another: software-drawn 3D views share the CPU badly.
test.describe.configure({ mode: "default" });

const PORTRAIT = { width: 390, height: 844 };
const SIDEWAYS = { width: 844, height: 390 };
/** The view's top and foot on a screen of `height`. */
const viewTop = 40;
const viewFoot = (/** @type {number} */ height) => height - 24;

/**
 * @param {import("@playwright/test").Locator} locator
 */
async function box(locator) {
  const found = await locator.boundingBox();
  if (found === null) throw new Error("no box");
  return found;
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {{ width: number, height: number }} size
 */
async function open(page, size) {
  await page.setViewportSize(size);
  await answerHosts(page);
  await openSampleIn3d(page);
}

const tree = (/** @type {import("@playwright/test").Page} */ page) =>
  page.locator("#shell-tree");
const details = (/** @type {import("@playwright/test").Page} */ page) =>
  page.locator("#shell-inspector");
const canvas = (/** @type {import("@playwright/test").Page} */ page) =>
  page.locator("#view3d .view3d-canvas");
const station = (
  /** @type {import("@playwright/test").Page} */ page,
  /** @type {string} */ name,
) => page.locator("#shell-tree .card", { hasText: name }).locator(".pick");

test("on a phone the list is a sheet under the map, the canvas ending at its top", async ({
  page,
}) => {
  await open(page, PORTRAIT);
  const height = viewFoot(844) - viewTop;
  const sheet = await box(tree(page));
  expect(sheet.x).toBe(0);
  expect(sheet.width).toBe(390);
  expect(sheet.y + sheet.height).toBeCloseTo(viewFoot(844), 0);
  expect(sheet.height).toBeCloseTo(height * 0.62, 0);
  const map = await box(canvas(page));
  expect(map.y + map.height).toBeCloseTo(sheet.y, 0);
  // The map's controls stand at the map's top, clear of the sheet.
  const controls = await box(page.locator("#map-controls"));
  expect(controls.y).toBe(viewTop + 12);
  expect(controls.y + controls.height).toBeLessThan(sheet.y);
  expect(controls.x + controls.width).toBe(390 - 12);
  // A row takes a finger.
  const row = await box(page.locator("#shell-tree .card > .head").first());
  expect(row.height).toBe(34);
  // The handle stands at the sheet's top, centred.
  const grip = await box(page.locator("#shell-tree .sheet-grip"));
  expect(grip.y).toBeCloseTo(sheet.y + 1, 0);
  expect(grip.width).toBe(390);
});

test("on a phone a tap turns the sheet into the details, and the arrow goes back", async ({
  page,
}) => {
  await open(page, PORTRAIT);
  const height = viewFoot(844) - viewTop;
  const list = await box(tree(page));
  await station(page, "The old gate").click();

  await expect(tree(page)).toBeHidden();
  const sheet = await box(details(page));
  expect(sheet.x).toBe(0);
  expect(sheet.width).toBe(390);
  expect(sheet.y + sheet.height).toBeCloseTo(viewFoot(844), 0);
  expect(sheet.height).toBeCloseTo(height * 0.66, 0);
  await expect
    .poll(async () => {
      const map = await box(canvas(page));
      return Math.round(map.y + map.height);
    })
    .toBe(Math.round(sheet.y));
  // The back arrow at the head's start, the close button at its end, the
  // fold gone: the sheet is whole or gone.
  const back = await box(page.locator('#inspector-head [data-act="back"]'));
  const close = await box(page.locator('#inspector-head [data-act="close"]'));
  expect(back.x).toBeLessThanOrEqual(10);
  expect(close.x + close.width).toBeGreaterThanOrEqual(390 - 10);
  expect(back.y - sheet.y).toBeLessThan(20);
  expect(close.y).toBe(back.y);
  await expect(page.locator('#inspector-head [data-act="fold"]')).toBeHidden();

  await page.locator('#inspector-head [data-act="back"]').click();
  await expect(details(page)).toBeHidden();
  expect(await box(tree(page))).toEqual(list);
  await expect(page.locator("#shell-tree .card.sel")).toHaveCount(0);

  // The close button leaves the map alone, and List brings the sheet back.
  await station(page, "The old gate").click();
  await page.locator('#inspector-head [data-act="close"]').click();
  await expect(details(page)).toBeHidden();
  await expect(tree(page)).toBeHidden();
  await expect
    .poll(async () => {
      const map = await box(canvas(page));
      return Math.round(map.y + map.height);
    })
    .toBe(viewFoot(844));
  await page.locator("#studio-list").click();
  expect(await box(tree(page))).toEqual(list);
});

test("on a phone a sheet is dragged by its handle, the canvas following on release", async ({
  page,
}) => {
  await open(page, PORTRAIT);
  const before = await box(tree(page));
  const map = await box(canvas(page));
  const grip = await box(page.locator("#shell-tree .sheet-grip"));
  const at = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x, at.y + 100, { steps: 4 });
  const during = await box(tree(page));
  expect(during.height).toBeCloseTo(before.height - 100, 0);
  expect((await box(canvas(page))).height).toBe(map.height);
  await page.mouse.up();
  await expect
    .poll(async () => (await box(canvas(page))).height)
    .toBeGreaterThan(map.height + 90);
  expect((await box(tree(page))).height).toBeCloseTo(before.height - 100, 0);

  // Down past the limit the sheet goes, and the map takes the height.
  const now = await box(page.locator("#shell-tree .sheet-grip"));
  await page.mouse.move(at.x, now.y + 7);
  await page.mouse.down();
  await page.mouse.move(at.x, 830, { steps: 4 });
  await page.mouse.up();
  await expect(tree(page)).toBeHidden();
  await expect
    .poll(async () => {
      const box2 = await box(canvas(page));
      return Math.round(box2.y + box2.height);
    })
    .toBe(viewFoot(844));
});

test("on a phone the bottom panel stands under the sheet, a problem opening its details", async ({
  page,
}) => {
  await open(page, PORTRAIT);
  await page.locator("#shell-toggles .tog").first().click();
  const panel = await box(page.locator("#shell-panel"));
  expect(panel.x).toBe(0);
  expect(panel.width).toBe(390);
  await expect
    .poll(async () => {
      const sheet = await box(tree(page));
      return Math.round(sheet.y + sheet.height);
    })
    .toBe(Math.round(panel.y));
  const sheet = await box(tree(page));
  const map = await box(canvas(page));
  // The map keeps its share of what the panel left.
  expect(map.height).toBeCloseTo((panel.y - viewTop) * 0.38, 0);
  expect(map.y + map.height).toBeCloseTo(sheet.y, 0);
});

test("on a phone's side both panels stay, the map between, and the close button goes back", async ({
  page,
}) => {
  await open(page, SIDEWAYS);
  const foot = viewFoot(390);
  const list = await box(tree(page));
  expect(list.x).toBe(0);
  expect(list.width).toBe(226);
  expect(list.y).toBeLessThanOrEqual(viewTop + 3);
  expect(list.y + list.height).toBeCloseTo(foot, 0);

  await station(page, "The old gate").click();
  const sheet = await box(details(page));
  expect(sheet.x).toBe(844 - 268);
  expect(sheet.width).toBe(268);
  expect(sheet.y + sheet.height).toBeCloseTo(foot, 0);
  // The list stays, unfolded, and the map keeps the room between them.
  expect(await box(tree(page))).toEqual(list);
  expect(sheet.x - (list.x + list.width)).toBe(350);
  const controls = await box(page.locator("#map-controls"));
  expect(controls.x + controls.width).toBeLessThanOrEqual(sheet.x);
  await expect(page.locator('#inspector-head [data-act="back"]')).toBeHidden();
  await expect(page.locator("#studio-list")).toBeHidden();

  await page.locator('#inspector-head [data-act="close"]').click();
  await expect(details(page)).toBeHidden();
  expect(await box(tree(page))).toEqual(list);
  expect((await box(canvas(page))).height).toBe(foot - viewTop);
});

test("the radius slider writes its number, one step in the history", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  await page.locator("#shell-tree .card .pick").first().click();
  await page.locator('#inspector-body [data-act="position"]').click();
  const slider = page.locator('#inspector-body [data-act="radius-slider"]');
  const number = page.locator('#inspector-body [data-field="radius"]');
  await slider.focus();
  const before = await number.inputValue();
  await slider.press("ArrowRight");
  const moved = await number.inputValue();
  expect(moved).not.toBe(before);
  await expect(slider).toBeFocused();
  await afterFrames(page, 2);
  await capture(page, test.info().outputPath("radius-1440x900.png"));
  await expect(number).toHaveValue(moved);
  await expect(page.locator("#studio-undo")).toBeEnabled();
});
