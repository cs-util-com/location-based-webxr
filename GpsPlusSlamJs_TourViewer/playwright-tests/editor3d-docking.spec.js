// @ts-check
import { expect, test } from "@playwright/test";

import {
  answerHosts,
  capture,
  DOCK_TABS_PX as TABS_PX,
  dockBottomPx as bottomPx,
  dockWidthsAt as widths,
  openSampleIn3d,
} from "./editor3d-fixture.js";

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
/** At most this far apart: two panels beside a splitter. */
const SASH_PX = 2;

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
    if (hit === null) return false;
    return hit === canvas || hit.closest(".dock-pane-view") !== null;
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

    // The tabs: Details shown with Files beside it; the bottom panel's
    // hidden until asked for; the 3D view and the list alone have none
    // (each carries its own head, so nothing is named twice).
    const details = host.getByRole("tab", { name: "Details", exact: true });
    const files = host.getByRole("tab", { name: "Files", exact: true });
    await expect(host.getByRole("tab", { name: "List" })).toHaveCount(0);
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

    // The side panels at their first widths, the list from the accent line,
    // the column under its tab strip; the
    // 3D view between them, at most a splitter apart, from the accent line
    // to the bottom bar, its canvas filling it.
    const want = widths(size.width);
    const tree = await box(page.locator("#shell-tree"));
    expect(tree.x, at).toBeCloseTo(0, 0);
    expect(tree.y, at).toBeCloseTo(TOP_PX + LINE_PX, 0);
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

/**
 * Whether the focus is on the element `selector` finds.
 * @param {import("@playwright/test").Page} page
 * @param {string} selector
 */
function focusOn(page, selector) {
  return page.evaluate(
    (s) => document.activeElement === document.querySelector(s),
    selector,
  );
}

// Why: the docking library closes a tab's panel on Delete or Backspace,
// and the key then reaches the page, which deletes the selection - two
// losses from one key on a tab a click focused. A docked panel is never
// closed, and the key on a tab deletes nothing. The shelf's toggle says
// whether the Files tab shows, for a screen reader too.
test("a docked tab's Delete and Backspace close nothing and delete nothing; the shelf toggle is pressed while Files shows", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  const host = tabs(page);
  const details = host.getByRole("tab", { name: "Details", exact: true });
  const files = host.getByRole("tab", { name: "Files", exact: true });
  const toggle = page.locator("#shelf-toggle");
  const gate = page.locator("#tree-body .card", { hasText: "The old gate" });
  await gate.locator(".pick").click();
  await expect(page.locator("#inspector-body")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  for (const [tab, name] of [
    [files, "Files"],
    [details, "Details"],
  ]) {
    await tab.click();
    expect(
      await page.evaluate(
        () => document.activeElement?.closest(".dv-tab") != null,
      ),
      `the ${name} tab holds the focus`,
    ).toBe(true);
    await expect(toggle).toHaveAttribute(
      "aria-pressed",
      String(name === "Files"),
    );
    for (const key of ["Delete", "Backspace"]) {
      await page.keyboard.press(key);
      await expect(files, `${key} on ${name}`).toHaveCount(1);
      await expect(details, `${key} on ${name}`).toHaveCount(1);
      await expect(gate, `${key} on ${name}`).toHaveCount(1);
    }
  }
  // Both panels still docked: Details shown, Files shown by its tab (a
  // panel behind another tab is out of the page until then).
  await expect(page.locator(".dock-host #shell-inspector")).toHaveCount(1);
  await files.click();
  await expect(page.locator(".dock-host #shell-shelf")).toBeVisible();
});

// Why: folding a side moves its element out of the layout and back; a
// moved element loses the focus to the page, so a keyboard user would
// start over from the top after each fold.
test("a docked side folded and unfolded by the keyboard keeps the focus on its fold button", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  await page
    .locator("#tree-body .card", { hasText: "The old gate" })
    .locator(".pick")
    .click();
  await expect(page.locator("#inspector-body")).toBeVisible();
  const fold = '#inspector-head [data-act="fold"]';
  await page.locator(fold).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#inspector-body")).toBeHidden();
  expect(await focusOn(page, fold), "folded").toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.locator("#inspector-body")).toBeVisible();
  expect(await focusOn(page, fold), "unfolded").toBe(true);
});

// Why: a phone turned between upright and sideways docks or undocks its
// panels, which moves the field in use; its focus (and with it the
// keyboard) must stay on it.
test("a field in use keeps the focus while a phone turns sideways and back", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 844, height: 390 });
  await answerHosts(page);
  await openSampleIn3d(page);
  await page
    .locator("#tree-body .card", { hasText: "The old gate" })
    .locator(".pick")
    .click();
  const field = page.locator("#inspector-body input").first();
  await expect(field).toBeVisible();
  await field.focus();
  const fieldIs = () =>
    page.evaluate(() => {
      const at = document.activeElement;
      return (
        at instanceof HTMLInputElement && at.closest("#inspector-body") !== null
      );
    });
  expect(await fieldIs(), "docked").toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".dock-host")).toHaveCount(0);
  expect(await fieldIs(), "upright").toBe(true);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator(".dock-host #shell-inspector")).toHaveCount(1);
  await expect.poll(fieldIs, { message: "sideways again" }).toBe(true);
});

// Why: each resize of the 3D view's canvas reallocates its drawing
// buffers, so the canvas holds its size while a splitter is dragged and
// fits its panel once, on release.
test("a splitter drag holds the canvas's size and fits it once on release", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  const column = await box(page.locator(".dock-pane-details"));
  const sashes = await page.locator(".dock-host .dv-sash").all();
  let sash = null;
  for (const candidate of sashes) {
    const b = await candidate.boundingBox();
    if (
      b !== null &&
      b.height > 200 &&
      Math.abs(b.x + b.width / 2 - column.x) < 4
    ) {
      sash = b;
    }
  }
  if (sash === null) throw new Error("no splitter beside the details");
  const canvas = page.locator("#view3d canvas.view3d-canvas");
  const before = await box(canvas);
  const x = sash.x + sash.width / 2;
  const y = sash.y + sash.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (const dx of [-20, -40, -60, -80]) {
    await page.mouse.move(x + dx, y);
    const now = await box(canvas);
    expect(now.width, `held at ${String(dx)}`).toBeCloseTo(before.width, 0);
    expect(now.height, `held at ${String(dx)}`).toBeCloseTo(before.height, 0);
  }
  await page.mouse.up();
  const view = await box(page.locator(".dock-pane-view"));
  expect(view.width).toBeLessThan(before.width - 40);
  await expectCanvas(page, view, "after the release");
});

/**
 * The element under `selector` that scrolls (its content taller than its
 * box), marked for later reads; its scroll offset.
 * @param {import("@playwright/test").Page} page
 * @param {string} selector
 */
function markScroller(page, selector) {
  return page.evaluate((s) => {
    const start = document.querySelector(s);
    if (start === null) return null;
    const all = [start, ...start.querySelectorAll("*")];
    const found = all.find(
      (e) =>
        e.scrollHeight > e.clientHeight + 20 &&
        ["auto", "scroll"].includes(getComputedStyle(e).overflowY),
    );
    if (found === undefined) return null;
    found.setAttribute("data-scroll-probe", "");
    return found.scrollHeight - found.clientHeight;
  }, selector);
}

/** @param {import("@playwright/test").Page} page */
function probeScroll(page) {
  return page.evaluate(
    () => document.querySelector("[data-scroll-probe]")?.scrollTop ?? -1,
  );
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {number} px
 */
async function scrollProbe(page, px) {
  await page.evaluate((top) => {
    const e = document.querySelector("[data-scroll-probe]");
    if (e !== null) e.scrollTop = top;
  }, px);
  return probeScroll(page);
}

/** @param {import("@playwright/test").Page} page */
function gateTitle(page) {
  return page.evaluate(
    () =>
      /** @type {any} */ (window).__tourEditor
        .manifest()
        .stations.find((/** @type {any} */ s) => s.id === "gate")?.title,
  );
}

// Why: a docked panel leaves the page while another tab of its group
// shows (so Tab walks each group's tabs, then its panel). Leaving the page
// must lose nothing: not the details' scroll, not a field half typed, and
// not a file the shelf is optimizing while Files is hidden.
test("a docked panel hidden by its group's other tab keeps its scroll, its half-typed field and its work", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1024, height: 600 });
  await answerHosts(page);
  await openSampleIn3d(page);
  const host = tabs(page);
  const details = host.getByRole("tab", { name: "Details", exact: true });
  const files = host.getByRole("tab", { name: "Files", exact: true });
  await page
    .locator("#tree-body .card", { hasText: "The old gate" })
    .locator(".pick")
    .click();
  const title = page.locator('#shell-inspector [data-field="title"]');
  await expect(title).toHaveValue("The old gate");

  // A field half typed, then the other tab and back: the text is still in
  // the field and in the tour (the switch commits it, as a click anywhere
  // else does).
  await title.click();
  await title.press("End");
  await title.pressSequentially(" north");
  await files.click();
  await expect(page.locator("#shell-shelf")).toBeVisible();
  await details.click();
  await expect(title).toHaveValue("The old gate north");
  await expect.poll(() => gateTitle(page)).toBe("The old gate north");

  // The details scrolled down, the other tab, back: the same offset.
  const room = await markScroller(page, ".dock-pane-details");
  expect(room, "the details scroll at 1024 x 600").not.toBeNull();
  const at = await scrollProbe(page, Math.min(150, room ?? 0));
  expect(at).toBeGreaterThan(0);
  await files.click();
  await expect(page.locator("#shell-shelf")).toBeVisible();
  await details.click();
  await expect(page.locator("#inspector-body")).toBeVisible();
  await expect.poll(() => probeScroll(page)).toBe(at);
});

// Why: the list shares no group at first, but a tab dragged onto it makes
// it one tab of two; shown again after the other, the list must keep the
// station unfolded and where it was scrolled.
test("the list made a tab beside Files keeps its folds and its scroll across a tab switch", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1024, height: 480 });
  await answerHosts(page);
  await openSampleIn3d(page);
  const host = tabs(page);
  for (const id of ["gate", "column"]) {
    const unfold = page.locator(`#tree-body [data-unfold="${id}"]`);
    if ((await unfold.getAttribute("aria-expanded")) !== "true") {
      await unfold.click();
    }
  }
  const gateKids = page.locator('#tree-body .card[data-station="gate"] .kids');
  await expect(gateKids).toBeVisible();

  const files = host.getByRole("tab", { name: "Files", exact: true });
  await files.dragTo(page.locator(".dock-pane-list"));
  const list = host.getByRole("tab", { name: "List", exact: true });
  await expect(list).toBeVisible();

  await list.click();
  await expect(page.locator("#tree-body")).toBeVisible();
  const room = await markScroller(page, ".dock-pane-list");
  expect(room, "the list scrolls at 1024 x 480").not.toBeNull();
  const at = await scrollProbe(page, Math.min(80, room ?? 0));
  expect(at).toBeGreaterThan(0);

  await files.click();
  await expect(page.locator("#shell-shelf")).toBeVisible();
  await expect(page.locator("#tree-body")).toHaveCount(0);
  await list.click();
  await expect(page.locator("#tree-body")).toBeVisible();
  await expect(gateKids).toBeVisible();
  await expect.poll(() => probeScroll(page)).toBe(at);
});
