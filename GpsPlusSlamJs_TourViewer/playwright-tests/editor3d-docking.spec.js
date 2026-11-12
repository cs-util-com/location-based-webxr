// @ts-check
import { expect, test } from "@playwright/test";

import { answerHosts, capture, openSampleIn3d } from "./editor3d-fixture.js";

/**
 * The editor's panels docked around the 3D view, from 701 px wide: the
 * list at the left, Details with Files as its second tab at the right,
 * the bottom panel's four tabs below the view when asked for. Found by
 * role (the docking's tabs), measured by their boxes.
 */

// One worker for the file, its tests in order: software-drawn 3D views
// side by side are several times slower than one after another.
test.describe.configure({ mode: "default" });

const TOP_PX = 40;
const BAR_PX = 24;
const LINE_PX = 3;
/** The docking's tab strip (editor-shell.css's theme). */
const TABS_PX = 30;
/** At most this far apart: two panels beside a splitter. */
const SASH_PX = 2;

/** The list's and the right column's first widths (dock-layout.ts). */
function widths(/** @type {number} */ w) {
  return { list: w <= 1100 ? 210 : 248, column: w <= 900 ? 268 : 300 };
}

/** The bottom group's first height (dock-layout.ts): a third of the
 *  layout's height, 90 to 220 px. */
function bottomPx(/** @type {number} */ h) {
  const layout = h - TOP_PX - BAR_PX - LINE_PX;
  return Math.max(90, Math.min(220, Math.floor(layout / 3)));
}

/** @param {import("@playwright/test").Locator} locator */
async function box(locator) {
  const b = await locator.boundingBox();
  if (b === null) throw new Error("no box: the element is not shown");
  return b;
}

/** @param {import("@playwright/test").Page} page */
function tabs(page) {
  return page.locator(".dock-host");
}

/**
 * The canvas's box, once it has its panel's size (the view sizes it from
 * a ResizeObserver, a callback after the layout).
 * @param {import("@playwright/test").Page} page
 * @param {{ x: number, y: number, width: number, height: number }} want
 * @param {string} at
 */
async function expectCanvas(page, want, at) {
  const canvas = page.locator("#view3d canvas.view3d-canvas");
  await expect
    .poll(async () => {
      const b = await box(canvas);
      return Math.max(
        Math.abs(b.x - want.x),
        Math.abs(b.y - want.y),
        Math.abs(b.width - want.width),
        Math.abs(b.height - want.height),
      );
    }, at)
    .toBeLessThan(1.5);
}

/**
 * What lies at the canvas's middle - where the view frames a selection -
 * is the canvas itself: no panel covers it.
 * @param {import("@playwright/test").Page} page
 */
function middleIsCanvas(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("#view3d canvas.view3d-canvas");
    if (canvas === null) return false;
    const r = canvas.getBoundingClientRect();
    const hit = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    );
    return hit === canvas || hit?.closest(".dock-pane-view") !== null;
  });
}

const SIZES = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 844, height: 390 },
];

for (const size of SIZES) {
  const at = `at ${String(size.width)} x ${String(size.height)}`;
  // Why: the chosen arrangement must come up at every docked size - a
  // panel missing, a side panel at the wrong width or the canvas under a
  // panel would frame the selection out of sight - and the bottom panel's
  // toggles and keys must show and hide its docked tabs.
  test(`the panels dock around the 3D view ${at}, the selection in sight`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.setViewportSize(size);
    await answerHosts(page);
    await openSampleIn3d(page);
    const host = tabs(page);
    await expect(host).toBeVisible();
    expect(await box(host), at).toEqual({
      x: 0,
      y: TOP_PX + LINE_PX,
      width: size.width,
      height: size.height - TOP_PX - BAR_PX - LINE_PX,
    });

    // The tabs: the list's, Details shown with Files beside it; the
    // bottom panel's hidden until asked for; the 3D view has none.
    const list = host.getByRole("tab", { name: "List", exact: true });
    const details = host.getByRole("tab", { name: "Details", exact: true });
    const files = host.getByRole("tab", { name: "Files", exact: true });
    await expect(list).toBeVisible();
    await expect(details).toBeVisible();
    await expect(files).toBeVisible();
    await expect(details).toHaveAttribute("aria-selected", "true");
    await expect(files).toHaveAttribute("aria-selected", "false");
    // A docked panel is shown or hidden, never closed: no close button.
    await expect(details.locator(".dv-default-tab-action")).toBeHidden();
    await expect(host.getByRole("tab", { name: "3D view" })).toHaveCount(0);
    await expect(host.getByRole("tab", { name: "Problems" })).toBeHidden();
    await expect(page.locator("#shell-panel")).toBeHidden();

    // Nothing selected: the Details panel says how to fill it.
    await expect(page.locator("#shell-inspector")).toBeHidden();
    await expect(
      host.getByText(
        "Select a station or an item, in the list or in the view.",
      ),
    ).toBeVisible();

    // The side panels at their first widths, under their tab strips; the
    // 3D view between them, at most a splitter apart, from the accent line
    // to the bottom bar, its canvas filling it.
    const want = widths(size.width);
    const tree = await box(page.locator("#shell-tree"));
    expect(tree.x, at).toBeCloseTo(0, 0);
    expect(tree.y, at).toBeCloseTo(TOP_PX + LINE_PX + TABS_PX, 0);
    expect(Math.abs(tree.width - want.list), at).toBeLessThanOrEqual(1);
    const column = await box(page.locator(".dock-pane-details"));
    expect(column.x + column.width, at).toBeCloseTo(size.width, 0);
    expect(Math.abs(column.width - want.column), at).toBeLessThanOrEqual(1);
    const top = TOP_PX + LINE_PX;
    const foot = size.height - BAR_PX;
    const view = await box(page.locator(".dock-pane-view"));
    const gapLeft = view.x - (tree.x + tree.width);
    const gapRight = column.x - (view.x + view.width);
    for (const gap of [gapLeft, gapRight]) {
      expect(gap, at).toBeGreaterThanOrEqual(-0.5);
      expect(gap, at).toBeLessThanOrEqual(SASH_PX);
    }
    expect(view.y, at).toBeCloseTo(top, 0);
    expect(view.y + view.height, at).toBeCloseTo(foot, 0);
    await expectCanvas(page, view, at);
    expect(await middleIsCanvas(page), at).toBe(true);

    // A station picked in the list: its details show, Details the shown
    // tab, the selection framed in sight (F frames it at the middle).
    await page
      .locator("#tree-body .card", { hasText: "The old gate" })
      .locator(".pick")
      .click();
    await expect(page.locator("#inspector-body")).toBeVisible();
    await expect(details).toHaveAttribute("aria-selected", "true");
    await page.locator("#view3d").focus();
    await page.keyboard.press("f");
    expect(await middleIsCanvas(page), at).toBe(true);
    await capture(page, test.info().outputPath(`docked-${at}.png`));

    // The bottom bar's Problems toggle shows the docked Problems tab below
    // the view at its first height; the canvas ends at its tab strip.
    const problems = page.locator('#shell-toggles [data-tab="problems"]');
    await problems.click();
    await expect(problems).toHaveAttribute("aria-pressed", "true");
    const problemsTab = host.getByRole("tab", { name: "Problems" });
    await expect(problemsTab).toBeVisible();
    await expect(problemsTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#shell-pane-problems")).toBeVisible();
    await expect(page.locator("#shell-panel")).toBeHidden();
    const pane = await box(page.locator(".dock-pane-problems"));
    expect(pane.y + pane.height, at).toBeCloseTo(foot, 0);
    expect(
      Math.abs(pane.height + TABS_PX - bottomPx(size.height)),
      at,
    ).toBeLessThanOrEqual(2);
    const above = await box(page.locator(".dock-pane-view"));
    const gapBelow = pane.y - TABS_PX - (above.y + above.height);
    expect(gapBelow, at).toBeGreaterThanOrEqual(-0.5);
    expect(gapBelow, at).toBeLessThanOrEqual(SASH_PX);
    await expectCanvas(page, above, at);
    expect(await middleIsCanvas(page), at).toBe(true);

    // Its sibling tabs: Map loading chosen by its tab, the toggle follows.
    await host.getByRole("tab", { name: "Map loading" }).click();
    await expect(page.locator("#shell-pane-tiles")).toBeVisible();
    await expect(
      page.locator('#shell-toggles [data-tab="tiles"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(problems).toHaveAttribute("aria-pressed", "false");

    // Ctrl+J hides the group; the canvas runs to the bottom bar again.
    await page.locator("#view3d").focus();
    await page.keyboard.press("Control+j");
    await expect(problemsTab).toBeHidden();
    await expect(
      page.locator('#shell-toggles [data-tab="tiles"]'),
    ).toHaveAttribute("aria-pressed", "false");
    await expectCanvas(page, { ...view, height: foot - top }, at);

    // The asset shelf's toggle shows the Files tab.
    await page.locator("#shelf-toggle").click();
    await expect(files).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#shell-shelf")).toBeVisible();
    await expect(page.locator("#shell-inspector")).toBeHidden();
  });
}

// Why: below 701 px the phone's sheets stay as they were - nothing docks,
// and a window narrowed from a docked width gives every panel back.
test("a phone held upright keeps its sheets; narrowing undocks", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 844, height: 390 });
  await answerHosts(page);
  await openSampleIn3d(page);
  await expect(page.locator(".dock-host")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".dock-host")).toHaveCount(0);
  await expect(page.locator("#view3d")).not.toHaveClass(/docked/);
  for (const id of ["#shell-tree", "#shell-inspector", "#shell-shelf"]) {
    await expect(
      page.locator(`#view3d > ${id}`),
      `${id} back in the view`,
    ).toHaveCount(1);
  }
  await expect(page.locator("#view3d > canvas.view3d-canvas")).toHaveCount(1);
  await expect(page.locator("#shell-panel #shell-pane-problems")).toHaveCount(
    1,
  );
  await expect(page.locator("#tree-body")).toBeVisible();
  await capture(page, test.info().outputPath("undocked-390x844.png"));
});
