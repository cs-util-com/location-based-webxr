// @ts-check
import { expect, test } from "@playwright/test";

import {
  afterFrames,
  answerHosts,
  capture,
  DOCK_TABS_PX,
  dockSettled,
  dockWidthsAt,
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
  // Sideways the panels dock (`dock-layout.ts`): the list at the left,
  // hanging from the accent line, the details at the right under their
  // group's tab strip, the asset shelf that group's other tab (no rail
  // beside the details, so nothing squeezes them).
  await open(page, SIDEWAYS);
  const foot = viewFoot(390);
  const widths = dockWidthsAt(844);
  const list = await box(tree(page));
  expect(list.x).toBe(0);
  expect(list.width).toBe(widths.list);
  expect(list.y).toBe(viewTop + 3);
  expect(list.y + list.height).toBeCloseTo(foot, 0);

  await station(page, "The old gate").click();
  await expect(page.locator("#shell-shelf")).toBeHidden();
  await expect(
    page.locator(".dock-host").getByRole("tab", { name: "Files" }),
  ).toBeVisible();
  const sheet = await box(details(page));
  expect(sheet.x).toBe(844 - widths.column);
  expect(sheet.width).toBe(widths.column);
  expect(sheet.y).toBe(viewTop + 3 + DOCK_TABS_PX);
  expect(sheet.y + sheet.height).toBeCloseTo(foot, 0);
  // The list stays, unfolded, and the map keeps the room between them.
  expect(await box(tree(page))).toEqual(list);
  const map = await box(canvas(page));
  for (const gap of [
    map.x - (list.x + list.width),
    sheet.x - (map.x + map.width),
  ]) {
    expect(gap).toBeGreaterThanOrEqual(-0.5);
    expect(gap).toBeLessThanOrEqual(2);
  }
  const controls = await box(page.locator("#map-controls"));
  expect(controls.x + controls.width).toBeLessThanOrEqual(sheet.x);
  await expect(page.locator('#inspector-head [data-act="back"]')).toBeHidden();
  await expect(page.locator("#studio-list")).toBeHidden();

  // Closed, the details' panel says how to fill it; the list and the map
  // keep their places, the map from the line to the bottom bar.
  await page.locator('#inspector-head [data-act="close"]').click();
  await expect(details(page)).toBeHidden();
  await expect(
    page.getByText("Select a station or an item, in the list or in the view."),
  ).toBeVisible();
  expect(await box(tree(page))).toEqual(list);
  expect((await box(canvas(page))).height).toBe(foot - viewTop - 3);
});

test("on a phone the controls smaller for a mouse take a finger", async ({
  page,
}) => {
  await open(page, PORTRAIT);
  await station(page, "The old gate").click();
  // A row to measure, whatever the sample's station holds, then back.
  await page.locator('#inspector-body [data-act="add-content"]').click();
  await page.locator('#tree-add-menu [data-kind="shortText"]').click();
  await page.locator('#inspector-head [data-act="back"]').click();
  await station(page, "The old gate").click();
  const row = page.locator('#inspector-body [data-act^="goto:"]').first();
  expect((await box(row)).height).toBe(32);
  await page.locator('#inspector-body [data-act="position"]').click();
  const slider = page.locator('#inspector-body [data-act="radius-slider"]');
  expect((await box(slider)).height).toBe(32);
  await page.keyboard.press("Control+k");
  const chip = page.locator("#add-palette .pfil .chip").first();
  expect((await box(chip)).height).toBe(32);
});

/**
 * What an on-screen keyboard leaves at each size, by the page's real path:
 * the visual viewport shrinks and `watchKeyboard` answers. A field counts
 * as in sight when it ends above the keyboard and nothing covers its
 * middle, its scroller's edge included. Every keyboard up to the one that
 * leaves the top bar and a field's row (`FIELD_ROOM_PX`) is measured: a
 * phone on its side, its browser bar showing, has a keyboard of 61-69 % of
 * the height, the case a sheet's share alone does not leave room for.
 */
const KEYBOARD_SIZES = [
  PORTRAIT,
  { width: 360, height: 640 },
  { width: 667, height: 375 },
  // On its side with the browser's bar: 75 px less.
  { width: 667, height: 300 },
  SIDEWAYS,
  { width: 915, height: 412 },
  { width: 1024, height: 600 },
];
const KEYBOARDS = [100, 150, 200, 260, 300, 400];
/** What a keyboard leaves at the most: the bar and one field's row. */
const FIELD_ROOM_PX = 116;
const SHARES = [0.3, 0.66, 0.8];

/**
 * @param {import("@playwright/test").Page} page
 * @param {string[]} fields
 * @param {{ width: number, height: number }} size
 * @returns {Promise<string[]>} what is out of sight
 */
function outOfSight(page, fields, size) {
  const most = size.height - FIELD_ROOM_PX;
  const keyboards = [...KEYBOARDS.filter((px) => px < most), most];
  return page.evaluate(
    async ({ fields, keyboards, shares }) => {
      const viewport = /** @type {VisualViewport} */ (window.visualViewport);
      const { style } = document.body;
      const was = style.getPropertyValue("--s-sheet-share");
      const lost = [];
      for (const px of keyboards) {
        for (const share of innerWidth <= 700 ? shares : [Number(was)]) {
          if (innerWidth <= 700) {
            style.setProperty("--s-sheet-share", String(share));
          }
          Object.defineProperty(viewport, "height", {
            value: innerHeight - px,
            configurable: true,
          });
          viewport.dispatchEvent(new Event("resize"));
          for (const selector of fields) {
            const field = /** @type {HTMLElement} */ (
              document.querySelector(selector)
            );
            field.focus();
            // Docked (above 700 px), the panels' contents are placed a frame
            // after their groups are laid out, and the field is brought into
            // sight again two frames later; the undocked styles apply at once.
            if (innerWidth > 700) {
              for (let i = 0; i < 3; i += 1) {
                await new Promise((done) => requestAnimationFrame(done));
              }
            }
            const at = field.getBoundingClientRect();
            const hit = document.elementFromPoint(
              at.x + at.width / 2,
              at.y + at.height / 2,
            );
            const seen =
              at.top >= 40 &&
              at.bottom <= innerHeight - px &&
              hit !== null &&
              field.contains(hit);
            if (!seen) {
              lost.push(
                `${String(innerWidth)}x${String(innerHeight)} keyboard ${String(px)} share ${String(share)} ${selector} at ${String(Math.round(at.top))}-${String(Math.round(at.bottom))} under ${hit === null ? "nothing" : `${hit.tagName.toLowerCase()}.${String(hit.className)}${hit.id === "" ? "" : `#${hit.id}`}`}`,
              );
            }
          }
        }
      }
      // @ts-expect-error - the stub, back to the browser's own.
      delete viewport.height;
      viewport.dispatchEvent(new Event("resize"));
      style.setProperty("--s-sheet-share", was);
      return lost;
    },
    { fields, keyboards, shares: SHARES },
  );
}

test("over a keyboard every field in use stays in sight, at every size and sheet height", async ({
  page,
}) => {
  // Seven sizes three times over, each waiting for its layout to settle.
  test.setTimeout(90_000);
  await open(page, PORTRAIT);
  await station(page, "The old gate").click();
  await page.locator('#inspector-body [data-act="position"]').click();
  // The toast of the opened tour lies over everything for a while, on
  // purpose: not what this test is about.
  await page.addStyleTag({ content: ".toast { display: none; }" });
  const lost = [];
  const fields = ['[data-field="title"]', '[data-field="radius"]'].map(
    (field) => `#inspector-body ${field}`,
  );
  for (const size of KEYBOARD_SIZES) {
    await page.setViewportSize(size);
    // Docked from 701 px: its panels are moved into the layout a moment
    // after the resize, which is not what this test is about.
    await dockSettled(page, size.width);
    lost.push(...(await outOfSight(page, fields, size)));
  }
  // The list's search, the sheet the keyboard opens first.
  await page.setViewportSize(PORTRAIT);
  await page.locator('#inspector-head [data-act="back"]').click();
  for (const size of KEYBOARD_SIZES) {
    await page.setViewportSize(size);
    await dockSettled(page, size.width);
    lost.push(
      ...(await outOfSight(page, ["#shell-tree .tsearch input"], size)),
    );
  }
  // A long text's writer, the field a creator types most into: the
  // sample's reading stand at the old gate, picked by its row.
  await page.setViewportSize(PORTRAIT);
  const writer = page.locator("#inspector-body .lw-writer textarea");
  await station(page, "The old gate").click();
  await page
    .locator('#inspector-body [data-act="goto:market-lectern"]')
    .click();
  await expect(writer).toHaveCount(1);
  for (const size of KEYBOARD_SIZES) {
    await page.setViewportSize(size);
    await dockSettled(page, size.width);
    lost.push(
      ...(await outOfSight(
        page,
        ["#inspector-body .lw-writer textarea"],
        size,
      )),
    );
  }
  expect(lost).toEqual([]);
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
