// @ts-check
import { expect, test } from "@playwright/test";

import { answerHosts, openSample, view3d } from "./editor3d-fixture.js";

/**
 * Why these tests matter: the 3D view's studio shell is a layout over the
 * scene - a 40 px top bar, a 24 px bottom bar, the tree dock flush left,
 * the inspector flush right, the map controls at the bottom left - and a
 * presence check passes a broken one. These pin positions, sizes and gaps
 * at a phone, a phone in landscape, a tablet in portrait and a desktop,
 * the narrow-window rule (below 900 px one dock at a time), every top-bar
 * control inside the window and none over another; and the tree's click
 * rule on the sample tour: a click selects, unfolds and flies there, a
 * second click deselects and folds, a quick second click (a double
 * click) does not toggle, and the folds outlive a trip to the map.
 */

// One worker for the file, its tests in order: three software-drawn 3D
// views at a desktop size side by side took about 3 min each, against
// about 12 s one after another.
test.describe.configure({ mode: "default" });

/** A dock folded to its head: the 36 px head and the dock's 1 px
 *  bottom edge. */
const FOLDED_PX = 37;

/** @param {import("@playwright/test").Page} page */
async function open3d(page) {
  await answerHosts(page);
  await openSample(page);
  await page.locator("#view-switch").click();
  await expect(page.locator("#view-switch")).toHaveText("Map view", {
    timeout: 60_000,
  });
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d");
  await expect.poll(async () => (await view3d(page))?.stations).toBe(3);
}

/** @param {import("@playwright/test").Locator} locator */
async function box(locator) {
  const b = await locator.boundingBox();
  if (b === null) throw new Error("no box: the element is not shown");
  return b;
}

/**
 * The layout every viewport shares: the bars, the viewport between them,
 * the map controls, and the top bar's controls in a row inside it.
 * @param {import("@playwright/test").Page} page
 * @param {{ width: number, height: number }} size
 */
async function expectFrame(page, size) {
  const top = await box(page.locator("#topbar"));
  expect(top).toEqual({ x: 0, y: 0, width: size.width, height: 40 });
  const bar = await box(page.locator("#shell-bar"));
  expect(bar).toEqual({
    x: 0,
    y: size.height - 24,
    width: size.width,
    height: 24,
  });
  const scene = await box(page.locator("#view3d"));
  expect(scene).toEqual({
    x: 0,
    y: 40,
    width: size.width,
    height: size.height - 64,
  });
  // The map controls: 12 px from the left, 14 px over the bottom bar, the
  // compass 38 px square, the zoom pill 8 px under it.
  const compass = await box(page.locator("#compass"));
  const zoomIn = await box(page.locator("#zoom-in"));
  const zoomOut = await box(page.locator("#zoom-out"));
  expect(compass.x).toBe(12);
  expect([compass.width, compass.height]).toEqual([38, 38]);
  expect(zoomIn.y - (compass.y + compass.height)).toBe(8);
  // The second button's 1 px divider is inside its 38 px.
  expect(zoomOut.y).toBe(zoomIn.y + 38);
  expect(size.height - 24 - (zoomOut.y + zoomOut.height)).toBe(14);
  // Every top-bar control shown sits inside the bar, left to right, none
  // over the next.
  const shown = [];
  for (const c of await page
    .locator("#topbar :is(button, #save-status, label)")
    .all()) {
    if (await c.isVisible()) shown.push(await box(c));
  }
  shown.sort((a, b) => a.x - b.x);
  for (const [i, b] of shown.entries()) {
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(size.width);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(40);
    const next = shown[i + 1];
    if (next !== undefined) {
      expect(next.x, `control ${String(i + 1)}`).toBeGreaterThanOrEqual(
        b.x + b.width - 0.5,
      );
    }
  }
}

/**
 * The tree's dock: flush left under the top bar, `width` wide, open (its
 * cards shown) or folded to its head.
 * @param {import("@playwright/test").Page} page
 * @param {number} width
 * @param {boolean} open
 */
async function expectTree(page, width, open) {
  const tree = await box(page.locator("#shell-tree"));
  expect(tree.x).toBe(0);
  expect(tree.y).toBe(40);
  expect(tree.width).toBeCloseTo(width, 0);
  if (open) {
    await expect(page.locator("#tree-body")).toBeVisible();
    expect(tree.height).toBeGreaterThan(36);
  } else {
    await expect(page.locator("#tree-body")).toBeHidden();
    expect(tree.height).toBeCloseTo(FOLDED_PX, 0);
  }
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
function card(page, name) {
  return page.locator("#tree-body .card", { hasText: name });
}

test("the shell's layout at a phone, a phone in landscape, a tablet and a desktop", async ({
  page,
}) => {
  test.setTimeout(150_000);
  // A phone: the tree starts folded; opening it and selecting a station
  // opens the inspector and folds the tree again.
  const phone = { width: 390, height: 844 };
  await page.setViewportSize(phone);
  await open3d(page);
  await expectFrame(page, phone);
  await expectTree(page, Math.min(272, 0.56 * 390), false);
  await expect(page.locator("#shell-inspector")).toBeHidden();
  await page.locator("#tree-fold").click();
  await expectTree(page, Math.min(272, 0.56 * 390), true);
  await card(page, "The old gate").locator(".hero").click();
  const phoneInspector = await box(page.locator("#shell-inspector"));
  expect(phoneInspector.x + phoneInspector.width).toBeCloseTo(390, 0);
  expect(phoneInspector.y).toBe(40);
  expect(phoneInspector.width).toBeCloseTo(Math.min(290, 0.6 * 390), 0);
  await expectTree(page, Math.min(272, 0.56 * 390), false);

  // A phone in landscape (under 900 px): still one dock at a time;
  // unfolding the tree folds the inspector to its head.
  const landscape = { width: 844, height: 390 };
  await page.setViewportSize(landscape);
  await expectFrame(page, landscape);
  await page.locator("#tree-fold").click();
  await expectTree(page, 272, true);
  const folded = await box(page.locator("#shell-inspector"));
  expect(folded.height).toBeCloseTo(FOLDED_PX, 0);
  expect(folded.x + folded.width).toBeCloseTo(844, 0);
  await expect(page.locator("#inspector-body")).toBeHidden();

  // A tablet in portrait: the labels go, the docks shrink to 56 % and
  // 60 % of the width where that is less, and unfolding the inspector
  // folds the tree.
  const tablet = { width: 820, height: 1180 };
  await page.setViewportSize(tablet);
  await expectFrame(page, tablet);
  await expect(page.locator("#studio-frame .lbl")).toBeHidden();
  await page.locator('#inspector-head [data-act="fold"]').click();
  await expectTree(page, Math.min(272, 0.56 * 820), false);
  const tabletInspector = await box(page.locator("#shell-inspector"));
  expect(tabletInspector.width).toBeCloseTo(Math.min(290, 0.6 * 820), 0);
  await expect(page.locator("#inspector-body")).toBeVisible();

  // A desktop: both docks open side by side, 272 and 290 px, the labels
  // shown, the scene between them 878 px wide.
  const desktop = { width: 1440, height: 900 };
  await page.setViewportSize(desktop);
  await expectFrame(page, desktop);
  await page.locator("#tree-fold").click();
  await expectTree(page, 272, true);
  const inspector = await box(page.locator("#shell-inspector"));
  expect(inspector).toMatchObject({ x: 1440 - 290, y: 40, width: 290 });
  await expect(page.locator("#inspector-body")).toBeVisible();
  await expect(page.locator("#studio-frame .lbl")).toBeVisible();
  // The cards: 8 px in from the dock, 6 px apart, 62 px pictures.
  const tree = await box(page.locator("#shell-tree"));
  const heroes = page.locator("#tree-body .hero");
  const first = await box(heroes.nth(0));
  const second = await box(heroes.nth(1));
  expect(first.x - tree.x).toBe(9);
  expect(first.height).toBe(62);
  expect(second.y - (first.y + first.height)).toBe(8);
});

test("a card's click selects, unfolds and flies; a second deselects and folds; a double click does not toggle", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open3d(page);
  const gate = card(page, "The old gate");
  const hero = gate.locator(".hero");
  const settled = async () => {
    await expect.poll(async () => (await view3d(page))?.flying).toBe(false);
  };

  // One click: selected, unfolded (its items listed), flown to.
  await hero.click();
  await expect(gate).toHaveClass(/\bsel\b/);
  await expect(gate.locator(".kids")).toBeVisible();
  await expect(page.locator("#inspector-head .ttl")).toHaveText("The old gate");
  await expect(page.locator("#inspector-body .sub")).toHaveText(
    "Station 2 of 3",
  );
  await settled();
  const at = await page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.view3dPointOf("station:gate"),
  );
  const target = (await view3d(page)).target;
  expect(Math.hypot(...target.map((v, i) => v - at[i]))).toBeLessThan(0.5);

  // A double click on another card: selected once, not toggled back.
  const steps = card(page, "The town hall steps");
  await steps.locator(".hero").dblclick();
  await expect(steps).toHaveClass(/\bsel\b/);
  await expect(steps.locator(".kids")).toBeVisible();
  await expect(gate).not.toHaveClass(/\bsel\b/);

  // A second click once the double-click interval has passed: deselected
  // and folded; the camera stays where the flight left it.
  await settled();
  const before = (await view3d(page)).target;
  const clickedAt = await page.evaluate(() => performance.now());
  await expect
    .poll(() => page.evaluate(() => performance.now()))
    .toBeGreaterThan(clickedAt + 600);
  await steps.locator(".hero").click();
  await expect(steps).not.toHaveClass(/\bsel\b/);
  await expect(steps.locator(".kids")).toHaveCount(0);
  await expect(page.locator("#shell-inspector")).toBeHidden();
  const after = (await view3d(page)).target;
  expect(Math.hypot(...after.map((v, i) => v - before[i]))).toBeLessThan(1e-3);

  // The folds are the page's state: a trip to the map and back keeps the
  // old gate unfolded and the station names' chip off.
  await page.locator('#tree-body [data-layer="names"]').click();
  await expect(page.locator('#tree-body [data-layer="names"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.locator("#view-switch").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "2d");
  await expect(page.locator("#shell-bar")).toBeHidden();
  await page.locator("#view-switch").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d");
  await expect(gate.locator(".kids")).toBeVisible();
  await expect(page.locator('#tree-body [data-layer="names"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("the top bar's Top view and the zoom buttons drive the camera", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open3d(page);
  const settled = async () => {
    await expect.poll(async () => (await view3d(page))?.flying).toBe(false);
  };
  await settled();
  await page.locator("#studio-top").click();
  await expect(page.locator("#studio-top")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await settled();
  expect((await view3d(page)).tiltDeg).toBeLessThan(1);
  await expect(page.locator("#shell-view")).toHaveText("Top view");
  await page.keyboard.press("t");
  await settled();
  expect((await view3d(page)).tiltDeg).toBeGreaterThan(30);

  const far = (await view3d(page)).distanceM;
  await page.locator("#zoom-in").click();
  await settled();
  expect((await view3d(page)).distanceM).toBeCloseTo(far / 1.6, 0);
  await page.locator("#zoom-out").click();
  await settled();
  expect((await view3d(page)).distanceM).toBeCloseTo(far, 0);

  // The debug readout: hidden, then shown with its draw calls.
  await expect(page.locator("#shell-calls")).toBeHidden();
  await page.locator("#shell-debug").click();
  await expect(page.locator("#shell-calls")).toContainText("draw calls");
});
