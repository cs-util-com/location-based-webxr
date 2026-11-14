// @ts-check
import { expect, test } from "@playwright/test";

import {
  afterFrames,
  answerHosts,
  capture,
  DOCK_PHONE_TABS_PX as TABS_PX,
  dockPhoneGroupPx,
  dockSettled,
  openSampleIn3d,
} from "./editor3d-fixture.js";

/**
 * Why these tests matter: the editor's phone layout was chosen from a
 * prototype (`public/prototypes/editor-docking-1-dockview/`), and "the
 * element is visible" passes a broken layout. These pin where the docked
 * panels stand on a phone - the 3D view and one tabbed group below it
 * held upright, beside it held sideways - how they meet the 3D view, and
 * the way from the list to an element's details and back. Until these
 * panels docked on a phone they were sheets over the map; each test says
 * which of the sheets' promises it now keeps.
 */

// One after another: software-drawn 3D views share the CPU badly.
test.describe.configure({ mode: "default" });

const PORTRAIT = { width: 390, height: 844 };
const SIDEWAYS = { width: 844, height: 390 };
/** The layout's top (below the top bar and its accent line) and foot. */
const viewTop = 40 + 3;
const viewFoot = (/** @type {number} */ height) => height - 24;
/** At most this far apart: two panels beside a splitter. */
const SASH_PX = 2;
/** The phone group's tabs in their order. */
const TAB_NAMES = [
  "List",
  "Details",
  "Files",
  "Problems",
  "History",
  "Map loading",
  "Performance",
];

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
  await dockSettled(page, size.width);
}

const tree = (/** @type {import("@playwright/test").Page} */ page) =>
  page.locator("#shell-tree");
const details = (/** @type {import("@playwright/test").Page} */ page) =>
  page.locator("#shell-inspector");
const canvas = (/** @type {import("@playwright/test").Page} */ page) =>
  page.locator("#view3d .view3d-canvas");
const viewPane = (/** @type {import("@playwright/test").Page} */ page) =>
  page.locator(".dock-host .dock-pane-view");
/** The phone's one group: the one holding the list's tab. */
const group = (/** @type {import("@playwright/test").Page} */ page) =>
  page.locator('.dock-host .dv-groupview:has(.dock-tab[data-panel="list"])');
const strip = (/** @type {import("@playwright/test").Page} */ page) =>
  group(page).locator(".dv-tabs-container");
const tab = (
  /** @type {import("@playwright/test").Page} */ page,
  /** @type {string} */ name,
) =>
  // A badge (a count of problems, a warning) joins the tab's name.
  page
    .locator(".dock-host")
    .getByRole("tab", { name: new RegExp(String.raw`^${name}(\s|$)`) });
const station = (
  /** @type {import("@playwright/test").Page} */ page,
  /** @type {string} */ name,
) => page.locator("#shell-tree .card", { hasText: name }).locator(".pick");

/**
 * The canvas fills the 3D view's pane (it is sized a callback after the
 * layout, so polled).
 * @param {import("@playwright/test").Page} page
 */
async function expectCanvasFillsView(page) {
  await expect
    .poll(async () => {
      const c = await box(canvas(page));
      const v = await box(viewPane(page));
      return Math.max(
        Math.abs(c.x - v.x),
        Math.abs(c.y - v.y),
        Math.abs(c.width - v.width),
        Math.abs(c.height - v.height),
      );
    })
    .toBeLessThan(1.5);
}

/**
 * The tabs of the phone's group by their names (count badges left out),
 * in order, and the shown one.
 * @param {import("@playwright/test").Page} page
 */
function tabsOf(page) {
  return strip(page).evaluate((s) => {
    const all = [...s.querySelectorAll('[role="tab"]')];
    const name = (/** @type {Element} */ t) =>
      t.querySelector(".dock-tab")?.getAttribute("aria-label") ??
      (t.querySelector(".dock-tab-title")?.textContent ?? "").trim();
    return {
      names: all.map(name),
      shown: all
        .filter((t) => t.getAttribute("aria-selected") === "true")
        .map(name),
    };
  });
}

// Was: "on a phone the list is a sheet under the map, the canvas ending at
// its top". Docked, the same promise: the list at the screen's foot, the
// whole width, the 3D view above it to the group's tab strip, the map's
// controls in the view, a row a finger high.
test("on a phone held upright the panels are one tabbed group under the 3D view, the canvas ending at its strip", async ({
  page,
}) => {
  await open(page, PORTRAIT);
  const g = await box(group(page));
  expect(g.x).toBe(0);
  expect(g.width).toBe(390);
  expect(g.y + g.height).toBeCloseTo(viewFoot(844), 0);
  expect(Math.abs(g.height - dockPhoneGroupPx(390, 844))).toBeLessThanOrEqual(
    1,
  );
  const view = await box(viewPane(page));
  expect(view.x).toBe(0);
  expect(view.width).toBe(390);
  expect(view.y).toBeCloseTo(viewTop, 0);
  const gap = g.y - (view.y + view.height);
  expect(gap).toBeGreaterThanOrEqual(-0.5);
  expect(gap).toBeLessThanOrEqual(SASH_PX);
  await expectCanvasFillsView(page);
  // All seven panels are tabs of the one group, the list shown.
  expect(await tabsOf(page)).toEqual({ names: TAB_NAMES, shown: ["List"] });
  // The strip a finger high; the list under it.
  expect((await box(strip(page))).height).toBe(TABS_PX);
  const list = await box(tree(page));
  expect(list.y).toBeCloseTo(g.y + TABS_PX, 0);
  // The map's controls stand in the 3D view, at its foot's right corner.
  const controls = await box(page.locator("#map-controls"));
  expect(controls.x + controls.width).toBe(390 - 12);
  expect(controls.y).toBeGreaterThan(view.y);
  expect(controls.y + controls.height).toBeCloseTo(
    view.y + view.height - 14,
    0,
  );
  // A row takes a finger.
  const row = await box(page.locator("#shell-tree .card > .head").first());
  expect(row.height).toBe(34);
  // The sheets' grip is gone: the splitter sizes the group.
  await expect(page.locator("#shell-tree .sheet-grip")).toBeHidden();
});

// Was: "on a phone a tap turns the sheet into the details, and the arrow
// goes back". Docked, Details is a tab beside the list: a tap shows it in
// the same place, the arrow shows the list again and lets the selection
// go, the close button leaves the 3D view alone and List brings the list.
test("on a phone a tap shows the details in the group, and the arrow goes back to the list", async ({
  page,
}) => {
  await open(page, PORTRAIT);
  const g = await box(group(page));
  const view = await box(viewPane(page));
  await station(page, "The old gate").click();

  await expect(tab(page, "Details")).toHaveAttribute("aria-selected", "true");
  await expect(tree(page)).toHaveCount(0);
  const sheet = await box(details(page));
  expect(sheet.x).toBe(0);
  expect(sheet.width).toBe(390);
  expect(sheet.y).toBeCloseTo(g.y + TABS_PX, 0);
  expect(sheet.y + sheet.height).toBeCloseTo(viewFoot(844), 0);
  expect(await box(group(page))).toEqual(g);
  expect(await box(viewPane(page))).toEqual(view);
  // The back arrow at the head's start, the close button at its end, the
  // fold gone (the group's own fold button is on its strip).
  const back = await box(page.locator('#inspector-head [data-act="back"]'));
  const close = await box(page.locator('#inspector-head [data-act="close"]'));
  expect(back.x).toBeLessThanOrEqual(10);
  expect(close.x + close.width).toBeGreaterThanOrEqual(390 - 10);
  expect(back.y - sheet.y).toBeLessThan(20);
  expect(close.y).toBe(back.y);
  await expect(page.locator('#inspector-head [data-act="fold"]')).toBeHidden();

  await page.locator('#inspector-head [data-act="back"]').click();
  await expect(tab(page, "List")).toHaveAttribute("aria-selected", "true");
  await expect(tree(page)).toBeVisible();
  await expect(page.locator("#shell-tree .card.sel")).toHaveCount(0);

  // The close button leaves the 3D view alone; the details say how to fill
  // them, and List in the top bar shows the list again.
  await station(page, "The old gate").click();
  await page.locator('#inspector-head [data-act="close"]').click();
  await expect(details(page)).toBeHidden();
  await expect(
    page.getByText("Select a station or an item, in the list or in the view."),
  ).toBeVisible();
  expect(await box(viewPane(page))).toEqual(view);
  await page.locator("#studio-list").click();
  await expect(tab(page, "List")).toHaveAttribute("aria-selected", "true");
  expect((await box(tree(page))).y).toBeCloseTo(g.y + TABS_PX, 0);
});

// Was: "on a phone a sheet is dragged by its handle, the canvas following
// on release". Docked, the splitter between the 3D view and the group is
// the handle; the canvas holds its size while it moves and fits on
// release. The sheet's "dragged down past the limit, it goes" has no
// docked counterpart (a splitter stops at the group's least height); the
// group's fold button gives the 3D view the height instead.
test("on a phone the group is resized by its splitter, the canvas following on release, and folds to give the view the height", async ({
  page,
}) => {
  await open(page, PORTRAIT);
  const before = await box(group(page));
  const map = await box(canvas(page));
  const sash = await page.evaluate((top) => {
    const all = [...document.querySelectorAll(".dock-host .dv-sash")];
    for (const s of all) {
      const r = s.getBoundingClientRect();
      if (r.width > 200 && Math.abs(r.y + r.height / 2 - top) < 6) {
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
    }
    return null;
  }, before.y);
  if (sash === null) throw new Error("no splitter above the group");
  await page.mouse.move(sash.x, sash.y);
  await page.mouse.down();
  await page.mouse.move(sash.x, sash.y - 100, { steps: 4 });
  expect((await box(canvas(page))).height).toBe(map.height);
  await page.mouse.up();
  await expect
    .poll(async () => (await box(group(page))).height)
    .toBeGreaterThan(before.height + 90);
  await expectCanvasFillsView(page);
  expect((await box(canvas(page))).height).toBeLessThan(map.height - 90);

  // Folded, the group is its strip at the foot and the 3D view runs to it
  // (its height folds, the group being as wide as the window, however tall
  // the drag made it).
  const fold = group(page).locator(".dock-fold");
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(tree(page)).toBeHidden();
  await expect
    .poll(async () => {
      const v = await box(viewPane(page));
      return Math.round(v.y + v.height);
    })
    .toBeGreaterThanOrEqual(viewFoot(844) - TABS_PX - SASH_PX);
  expect((await box(group(page))).width).toBe(390);
  await expectCanvasFillsView(page);
});

// Was: "on a phone the bottom panel stands under the sheet, a problem
// opening its details". Docked, the bottom panel's panes are tabs of the
// same group: its toggle shows its tab there, the 3D view keeps its size,
// and a problem's row still opens its details.
test("on a phone the bottom panel's toggle shows its tab in the group, the 3D view unmoved", async ({
  page,
}) => {
  await open(page, PORTRAIT);
  const g = await box(group(page));
  const view = await box(viewPane(page));
  const problems = page.locator('#shell-toggles [data-tab="problems"]');
  await problems.click();
  await expect(problems).toHaveAttribute("aria-pressed", "true");
  await expect(tab(page, "Problems")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#shell-pane-problems")).toBeVisible();
  await expect(page.locator("#shell-panel")).toBeHidden();
  const pane = await box(page.locator("#shell-pane-problems"));
  expect(pane.x).toBe(0);
  expect(pane.width).toBe(390);
  expect(pane.y).toBeGreaterThanOrEqual(g.y + TABS_PX - 0.5);
  expect(await box(group(page))).toEqual(g);
  expect(await box(viewPane(page))).toEqual(view);
  // Toggled off, the list shows again in its place.
  await problems.click();
  await expect(problems).toHaveAttribute("aria-pressed", "false");
  await expect(tab(page, "Problems")).toHaveAttribute("aria-selected", "false");
});

// Was: "on a phone's side both panels stay, the map between, and the close
// button goes back". Held sideways the phone docks as the prototype: the
// 3D view and the one group at its right. The list and the details share
// that group, so "both panels stay side by side" no longer exists; what
// stays is the 3D view keeping the room beside the group, the details
// under the group's strip, and the close button giving the details' empty
// text with the view unmoved.
test("on a phone's side the panels are one tabbed group beside the 3D view, and the close button goes back", async ({
  page,
}) => {
  await open(page, SIDEWAYS);
  const foot = viewFoot(390);
  const px = dockPhoneGroupPx(844, 390);
  const g = await box(group(page));
  expect(Math.abs(g.x - (844 - px))).toBeLessThanOrEqual(1);
  expect(g.x + g.width).toBe(844);
  expect(g.y).toBeCloseTo(viewTop, 0);
  expect(g.y + g.height).toBeCloseTo(foot, 0);
  const view = await box(viewPane(page));
  expect(view.x).toBe(0);
  expect(view.y).toBeCloseTo(viewTop, 0);
  expect(view.y + view.height).toBeCloseTo(foot, 0);
  const gap = g.x - (view.x + view.width);
  expect(gap).toBeGreaterThanOrEqual(-0.5);
  expect(gap).toBeLessThanOrEqual(SASH_PX);
  await expectCanvasFillsView(page);
  expect(await tabsOf(page)).toEqual({ names: TAB_NAMES, shown: ["List"] });

  await station(page, "The old gate").click();
  await expect(tab(page, "Details")).toHaveAttribute("aria-selected", "true");
  const sheet = await box(details(page));
  expect(sheet.x).toBeCloseTo(g.x, 0);
  expect(sheet.width).toBeCloseTo(g.width, 0);
  expect(sheet.y).toBeCloseTo(viewTop + TABS_PX, 0);
  expect(sheet.y + sheet.height).toBeCloseTo(foot, 0);
  expect(await box(viewPane(page))).toEqual(view);
  const controls = await box(page.locator("#map-controls"));
  expect(controls.x + controls.width).toBeLessThanOrEqual(g.x);
  // Wider than 700 px the top bar and the head are the desk's: the List
  // tab is the way back.
  await expect(page.locator('#inspector-head [data-act="back"]')).toBeHidden();
  await expect(page.locator("#studio-list")).toBeHidden();

  await page.locator('#inspector-head [data-act="close"]').click();
  await expect(details(page)).toBeHidden();
  await expect(
    page.getByText("Select a station or an item, in the list or in the view."),
  ).toBeVisible();
  expect(await box(viewPane(page))).toEqual(view);
  expect((await box(canvas(page))).height).toBeCloseTo(foot - viewTop, 0);
});

test("on a phone the controls smaller for a mouse take a finger", async ({
  page,
}) => {
  await open(page, PORTRAIT);
  await station(page, "The old gate").click();
  // A row to measure, whatever the sample's station holds, then back.
  await page.locator('#inspector-body [data-act="add-content"]').click();
  await page.locator('#tree-add-menu [data-kind="shortText"]').click();
  // Back goes one level up: from the new item to its station's details.
  await page.locator('#inspector-head [data-act="back"]').click();
  await expect(page.locator("#inspector-head")).toContainText("The old gate");
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
 * the height. The panels dock at every size, a phone's included.
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
    async ({ fields, keyboards }) => {
      const viewport = /** @type {VisualViewport} */ (window.visualViewport);
      const lost = [];
      for (const px of keyboards) {
        Object.defineProperty(viewport, "height", {
          value: innerHeight - px,
          configurable: true,
        });
        viewport.dispatchEvent(new Event("resize"));
        for (const selector of fields) {
          const field = /** @type {HTMLElement | null} */ (
            document.querySelector(selector)
          );
          if (field === null) {
            lost.push(
              `${String(innerWidth)}x${String(innerHeight)} keyboard ${String(px)} ${selector} not in the page`,
            );
            continue;
          }
          field.focus();
          // Docked, the panels' contents are placed a frame after their
          // groups are laid out, and the field is brought into sight again
          // two frames later.
          for (let i = 0; i < 3; i += 1) {
            await new Promise((done) => requestAnimationFrame(done));
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
              `${String(innerWidth)}x${String(innerHeight)} keyboard ${String(px)} ${selector} at ${String(Math.round(at.top))}-${String(Math.round(at.bottom))} under ${hit === null ? "nothing" : `${hit.tagName.toLowerCase()}.${String(hit.className)}${hit.id === "" ? "" : `#${hit.id}`}`}`,
            );
          }
        }
      }
      // @ts-expect-error - the stub, back to the browser's own.
      delete viewport.height;
      viewport.dispatchEvent(new Event("resize"));
      return lost;
    },
    { fields, keyboards },
  );
}

// Was: "... at every size and sheet height". Docked on a phone there is no
// sheet height to sweep (the group's own size is what the keyboard
// maximizes); the sizes and keyboards are swept as before, and the phone
// keyboard's watcher (`phone-keyboard.ts`) must keep every field in use in
// sight with the panels docked.
test("over a keyboard every field in use stays in sight, at every size, docked", async ({
  page,
}) => {
  // Seven sizes three times over, each waiting for its layout to settle.
  test.setTimeout(120_000);
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
    // Its panels are moved into the layout a moment after the resize,
    // which is not what this test is about.
    await dockSettled(page, size.width);
    lost.push(...(await outOfSight(page, fields, size)));
  }
  // The list's search: the list shown by the back arrow on the phone.
  await page.setViewportSize(PORTRAIT);
  await dockSettled(page, PORTRAIT.width);
  await page.locator('#inspector-head [data-act="back"]').click();
  for (const size of KEYBOARD_SIZES) {
    await page.setViewportSize(size);
    await dockSettled(page, size.width);
    // A turn lays the phone's layout out again: the list shown by its tab
    // (at the desk the list has a column of its own).
    if (size.width <= 700 || size.height <= 500) {
      await tab(page, "List").click();
    }
    lost.push(
      ...(await outOfSight(page, ["#shell-tree .tsearch input"], size)),
    );
  }
  // A long text's writer, the field a creator types most into: the
  // sample's reading stand at the old gate, picked by its row.
  await page.setViewportSize(PORTRAIT);
  await dockSettled(page, PORTRAIT.width);
  await tab(page, "List").click();
  const writer = page.locator("#inspector-body .lw-writer textarea");
  await station(page, "The old gate").click();
  await page
    .locator('#inspector-body [data-act="goto:market-lectern"]')
    .click();
  await expect(writer).toHaveCount(1);
  for (const size of KEYBOARD_SIZES) {
    await page.setViewportSize(size);
    await dockSettled(page, size.width);
    // A turn lays the phone's layout out again: the details shown by
    // their tab.
    if (size.width <= 700 || size.height <= 500) {
      await tab(page, "Details").click();
    }
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

/**
 * A finger on the page by the browser's own touch input (CDP), so the
 * page gets real pointer events of type "touch": down at `from`, moved
 * by `dx`, `dy` in `steps`, then up. Each event carries its own time,
 * `stepMs` after the one before (as a quick finger's, 16 ms): a loaded
 * machine delivers them far apart, and the strip's rule reads the events'
 * times (the 250 ms hold), so unstamped a busy test machine turned a quick
 * swipe into a held drag.
 * @param {import("@playwright/test").CDPSession} cdp
 * @param {{ x: number, y: number }} from
 * @param {number} dx
 * @param {number} dy
 * @param {number} [steps]
 * @param {number} [stepMs]
 */
async function swipe(cdp, from, dx, dy, steps = 3, stepMs = 16) {
  // CDP takes seconds since the epoch; the page's events get these times.
  const start = Date.now() / 1000;
  const at = (/** @type {number} */ n) => start + (n * stepMs) / 1000;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [from],
    timestamp: at(0),
  });
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from.x + dx * t, y: from.y + dy * t }],
      timestamp: at(step),
    });
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
    timestamp: at(steps + 1),
  });
}

/**
 * The phone group's strip: how far it scrolls, how far it can, the shown
 * tab, the groups' count and each tab's left and right in the page.
 * @param {import("@playwright/test").Page} page
 */
function stripState(page) {
  return strip(page).evaluate((s) => {
    const tabs = [...s.querySelectorAll('[role="tab"]')];
    const name = (/** @type {Element} */ t) =>
      t.querySelector(".dock-tab")?.getAttribute("aria-label") ??
      (t.querySelector(".dock-tab-title")?.textContent ?? "").trim();
    const r = s.getBoundingClientRect();
    return {
      scroll: Math.round(s.scrollLeft),
      room: s.scrollWidth - s.clientWidth,
      left: r.left,
      right: r.left + s.clientWidth,
      shown: tabs
        .filter((t) => t.getAttribute("aria-selected") === "true")
        .map(name),
      groups: document.querySelectorAll(".dock-host .dv-groupview").length,
      tabs: Object.fromEntries(
        tabs.map((t) => {
          const b = t.getBoundingClientRect();
          return [name(t), [b.left, b.right]];
        }),
      ),
    };
  });
}

test.describe("by touch", () => {
  test.use({ hasTouch: true });

  // Why: a phone's group holds seven tabs, more than its strip shows, so
  // the strip scrolls sideways. A finger's swipe along it must scroll it
  // and never tear a tab out (the docking library makes any flick on a
  // tab a drag), a tap must still show its tab, and a pull across the
  // strip must still drag the tab. The swipe is swept over distances
  // either side of the slop (`dock-strip.ts`'s 10 px).
  test("a finger swipes the phone's tab strip sideways, taps a tab, and pulls one out", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await open(page, PORTRAIT);
    // The longest title shown, so the strip surely overflows.
    await tab(page, "Performance").click();
    await afterFrames(page, 3);
    const start = await stripState(page);
    expect(start.room, "the strip overflows").toBeGreaterThan(20);
    const cdp = await page.context().newCDPSession(page);
    const middle = async (/** @type {string} */ name) => {
      const b = await box(tab(page, name));
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    const resetTo = async (/** @type {number} */ px) => {
      await strip(page).evaluate((s, at) => {
        s.scrollLeft = at;
      }, px);
    };

    for (const dx of [12, 40, 120]) {
      await resetTo(0);
      const at = await middle("Files");
      await swipe(cdp, at, -dx, 2);
      await afterFrames(page, 2);
      const now = await stripState(page);
      expect(
        Math.abs(now.scroll - Math.min(start.room, dx)),
        `swiped ${String(dx)} px`,
      ).toBeLessThanOrEqual(2);
      expect(now.shown, `swiped ${String(dx)} px`).toEqual(["Performance"]);
      expect(now.groups, `swiped ${String(dx)} px`).toBe(start.groups);
    }
    // Back the other way, from the end.
    await resetTo(start.room);
    await swipe(cdp, await middle("History"), 40, 0);
    await afterFrames(page, 2);
    expect(
      Math.abs((await stripState(page)).scroll - Math.max(0, start.room - 40)),
    ).toBeLessThanOrEqual(2);

    // Under the slop, a tap: it shows its tab, the strip unmoved by it
    // (beyond bringing that tab into sight).
    await resetTo(0);
    await swipe(cdp, await middle("Files"), -6, 0, 2);
    await expect(tab(page, "Files")).toHaveAttribute("aria-selected", "true");
    expect((await stripState(page)).groups).toBe(start.groups);

    // Pulled across the strip, up into the 3D view's left edge: the
    // library's tab drag, Files in a group of its own there.
    const view = await box(viewPane(page));
    const from = await middle("Files");
    await swipe(
      cdp,
      from,
      view.x + 12 - from.x,
      view.y + view.height / 2 - from.y,
      12,
    );
    await expect
      .poll(async () => (await stripState(page)).groups)
      .toBe(start.groups + 1);
    expect((await stripState(page)).tabs["Files"]).toBeUndefined();
  });

  // Why: the shown tab must be in sight wherever the strip was scrolled
  // (a tab shown by a toggle or the back arrow out of sight would look as
  // if nothing happened), and so must a tab the keyboard moves to.
  test("the shown tab and a tab the keyboard focuses are scrolled into sight", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await open(page, PORTRAIT);
    await tab(page, "Performance").click();
    await afterFrames(page, 3);
    const inSight = async (/** @type {string} */ name) => {
      const s = await stripState(page);
      const t = s.tabs[name];
      if (t === undefined) return `no ${name} tab`;
      return t[0] >= s.left - 1 && t[1] <= s.right + 1
        ? "in sight"
        : `${name} at ${String(Math.round(t[0]))}-${String(Math.round(t[1]))} of ${String(Math.round(s.left))}-${String(Math.round(s.right))}`;
    };
    await expect.poll(() => inSight("Performance")).toBe("in sight");
    // The list shown by the top bar's List, the strip scrolled to its end.
    await strip(page).evaluate((s) => {
      s.scrollLeft = s.scrollWidth;
    });
    await page.locator("#studio-list").click();
    await expect(tab(page, "List")).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => inSight("List")).toBe("in sight");
    // The keyboard's focus moved to the last tab, the strip at its start.
    await strip(page).evaluate((s) => {
      s.scrollLeft = 0;
    });
    await tab(page, "Performance").focus();
    await expect.poll(() => inSight("Performance")).toBe("in sight");
  });

  // Why: on a phone a group floats over the 3D view and docks back by a
  // button on its strip (the prototype's Float and Dock), since a phone
  // has no Shift to float a group with.
  test("a phone's group floats over the 3D view and docks back by its buttons", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await open(page, PORTRAIT);
    const g = await box(group(page));
    const float = group(page).locator(".dock-float");
    await expect(float).toHaveAttribute("aria-label", "Float List");
    await float.tap();
    await expect
      .poll(() =>
        group(page).evaluate((e) => e.closest(".dv-resize-container") !== null),
      )
      .toBe(true);
    const host = await box(page.locator(".dock-host"));
    // The 3D view takes the whole layout; the group floats inside it.
    await expect
      .poll(async () => Math.round((await box(viewPane(page))).height))
      .toBeGreaterThanOrEqual(Math.round(host.height) - 1);
    const floating = await box(group(page));
    expect(floating.x).toBeGreaterThanOrEqual(host.x);
    expect(floating.x + floating.width).toBeLessThanOrEqual(
      host.x + host.width,
    );
    expect(floating.y).toBeGreaterThanOrEqual(host.y);
    await expectCanvasFillsView(page);
    const dockBack = group(page).locator(".dock-float");
    await expect(dockBack).toHaveAttribute("aria-label", "Dock List");
    await expect(dockBack).toHaveAttribute("title", "Dock below the 3D view");
    await dockBack.tap();
    await expect
      .poll(() =>
        group(page).evaluate((e) => e.closest(".dv-resize-container") !== null),
      )
      .toBe(false);
    const docked = await box(group(page));
    const view = await box(viewPane(page));
    expect(docked.x).toBe(0);
    expect(docked.width).toBe(390);
    expect(docked.y + docked.height).toBeCloseTo(g.y + g.height, 0);
    expect(docked.y).toBeGreaterThanOrEqual(view.y + view.height - 0.5);
  });

  for (const size of [PORTRAIT, SIDEWAYS]) {
    const at = `${String(size.width)}x${String(size.height)}`;
    // Why: the phone's measures were chosen in the prototype for a finger;
    // a layout that only checks presence passes a strip, a button or a
    // splitter too small to take. Pinned: the strip's height, a tab's and
    // a button's size, the icon-only inactive tabs, the splitter's grip
    // and the gaps between the 3D view and the group.
    test(`a phone's docked layout keeps the prototype's measures at ${at}`, async ({
      page,
    }) => {
      test.setTimeout(150_000);
      await open(page, size);
      const m = await page.evaluate(() => {
        const host = /** @type {Element} */ (
          document.querySelector(".dock-host")
        );
        const g = host.querySelector(
          '.dv-groupview:has(.dock-tab[data-panel="list"])',
        );
        const rect = (/** @type {Element | null | undefined} */ e) => {
          const r = e?.getBoundingClientRect();
          return r === undefined
            ? null
            : [r.x, r.y, r.width, r.height].map(Math.round);
        };
        const tabs = [...(g?.querySelectorAll('[role="tab"]') ?? [])];
        const shown = tabs.find(
          (t) => t.getAttribute("aria-selected") === "true",
        );
        const hidden = tabs.filter((t) => t !== shown);
        const sashGrip = [...host.querySelectorAll(".dv-sash")]
          .map((s) => getComputedStyle(s, "::after"))
          .find((s) => s.content !== "none" && s.content !== "normal");
        return {
          phone: host.classList.contains("dock-phone"),
          upright: host.classList.contains("dock-upright"),
          strip: rect(g?.querySelector(".dv-tabs-and-actions-container")),
          shownTab: rect(shown),
          shownTitle: rect(shown?.querySelector(".dock-tab-title")),
          hiddenTitles: hidden.map(
            (t) => rect(t.querySelector(".dock-tab-title"))?.[2] ?? -1,
          ),
          hiddenTabs: hidden.map((t) => rect(t)?.[3] ?? -1),
          fold: rect(g?.querySelector(".dock-fold")),
          float: rect(g?.querySelector(".dock-float")),
          grip:
            sashGrip === undefined
              ? null
              : [sashGrip.width, sashGrip.height].sort().join(" "),
        };
      });
      expect(m.phone, at).toBe(true);
      expect(m.upright, at).toBe(size.width < size.height);
      expect(m.strip?.[3], at).toBe(TABS_PX);
      expect(m.shownTab?.[3], at).toBe(TABS_PX);
      expect(m.shownTitle?.[2], at).toBeGreaterThan(10);
      // A tab not shown keeps its icon only, a finger wide and high.
      for (const w of m.hiddenTitles) expect(w, at).toBeLessThanOrEqual(1);
      for (const h of m.hiddenTabs) expect(h, at).toBe(TABS_PX);
      // The fold and the float buttons: 40 px, side by side on the strip.
      expect(m.fold?.slice(2), at).toEqual([40, 40]);
      expect(m.float?.slice(2), at).toEqual([40, 40]);
      expect(Math.abs((m.float?.[0] ?? 0) - (m.fold?.[0] ?? 0)), at).toBe(40);
      // The splitter's grip: 4 x 28 px.
      expect(m.grip, at).toBe("28px 4px");
      await capture(page, test.info().outputPath(`phone-docked-${at}.png`));
    });
  }
});
