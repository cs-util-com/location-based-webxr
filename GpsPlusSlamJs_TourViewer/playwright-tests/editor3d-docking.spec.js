// @ts-check
import { expect, test } from "@playwright/test";

import {
  afterFrames,
  answerHosts,
  capture,
  DOCK_TABS_PX as TABS_PX,
  dockBottomPx as bottomPx,
  dockSettled,
  dockWidthsAt as widths,
  openSampleIn3d,
} from "./editor3d-fixture.js";

/**
 * The editor's panels docked around the 3D view at a desk: the list at
 * the left, Details with Files as its second tab at the right, the bottom
 * panel's four tabs below the view when asked for. Found by role (the
 * docking's tabs), measured by their boxes. A phone (at most 700 px wide
 * or 500 px high) docks too, as the 3D view and one tabbed group:
 * `editor3d-phone.spec.js` pins that layout; here only what crosses
 * between the two (a turn, a kept layout, a keyboard).
 */

// One worker for the file, its tests in order: software-drawn 3D views
// side by side are several times slower than one after another.
test.describe.configure({ mode: "default" });

const TOP_PX = 40;
const BAR_PX = 24;
const LINE_PX = 3;
/** At most this far apart: two panels beside a splitter. */
const SASH_PX = 2;
/** A phone's one group's strip by its tabs' names, as `dockState` reads
 *  it (the inactive tabs' titles are hidden from sight, not from it). */
const PHONE_STRIP = "ListDetailsFilesProblemsHistoryMap loadingPerformance";

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
  // A phone held sideways (844 x 390) docks as one group beside the view:
  // `editor3d-phone.spec.js`.
  { width: 1024, height: 600 },
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

// Why: this test said the opposite until the panels docked on a phone:
// "a phone held upright keeps its sheets; narrowing undocks". Now a phone
// held upright docks its panels too, and a window narrowed from a desk's
// width keeps them docked, laid out anew as the phone's one group under
// the 3D view (`editor3d-phone.spec.js` pins that layout). The phone's
// sheets are only the fallback while the docking loads or when it failed
// to, so no panel goes back into the view.
test("a phone held upright docks its panels; narrowing keeps them docked", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  await expect(page.locator(".dock-host")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await dockSettled(page, 390);
  await expect(page.locator(".dock-host")).toHaveCount(1);
  await expect(page.locator("#view3d")).toHaveClass(/docked/);
  for (const id of ["#shell-tree", "#shell-inspector", "#shell-shelf"]) {
    await expect(
      page.locator(`#view3d > ${id}`),
      `${id} not back in the view`,
    ).toHaveCount(0);
  }
  await expect(page.locator(".dock-host #shell-tree")).toHaveCount(1);
  await expect(
    page.locator(".dock-host .dock-pane-view canvas.view3d-canvas"),
  ).toHaveCount(1);
  await expect(page.locator("#shell-panel")).toBeHidden();
  await expect(page.locator("#tree-body")).toBeVisible();
  await expect
    .poll(async () => (await dockState(page)).strips)
    .toEqual([PHONE_STRIP]);
  await capture(page, test.info().outputPath("docked-390x844.png"));
});

/**
 * The docked group holding panel `id`'s tab (its strip hidden or not).
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 */
function groupOf(page, id) {
  return page.locator(
    `.dock-host .dv-groupview:has(.dock-tab[data-panel="${id}"])`,
  );
}

/**
 * The fold button of the group holding panel `id`.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 */
function foldOf(page, id) {
  return groupOf(page, id).locator(".dock-fold");
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

// Why: folding a side to its rail takes its panel out of sight, the
// button pressed with it; a focus left there is lost to the page, so a
// keyboard user would start over from the top after each fold. It goes to
// the rail's unfold button, which keeps it while it unfolds.
test("a docked side folded and unfolded by the keyboard keeps the focus on a fold button", async ({
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
  // The list's group shows no tab strip unfolded: its own head's fold
  // button takes the focus back.
  for (const [own, id, body, back] of [
    ['#inspector-head [data-act="fold"]', "details", "#inspector-body", null],
    ["#tree-fold", "list", "#tree-body", "#tree-fold"],
  ]) {
    const rail = foldOf(page, id);
    await page.locator(own).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(body)).toBeHidden();
    await expect(rail, `${id} folded`).toBeFocused();
    await expect(rail).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Enter");
    await expect(page.locator(body)).toBeVisible();
    await expect(
      back === null ? rail : page.locator(back),
      `${id} unfolded`,
    ).toBeFocused();
  }
});

// Why: the long text writer widens the details while it is open; closed
// while the details are folded, their group must come back at the
// column width, not keep the writer's (a width set on a hidden group is
// a case the docking could drop).
test("the details closed out of their writer while folded unfold at the column width", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  await dockSettled(page, 1440);
  await page
    .locator("#tree-body .card", { hasText: "The old gate" })
    .locator(".pick")
    .click();
  await expect(page.locator("#inspector-body")).toBeVisible();
  const width = async () => (await dockState(page)).boxes["details"]?.[2];
  const column = await width();
  expect(column).toBeDefined();
  // The writer's classes, as the long text dock sets them.
  const writer = (/** @type {boolean} */ on) =>
    page.evaluate((open) => {
      document.getElementById("shell-inspector")?.classList.toggle("lw", open);
    }, on);
  await writer(true);
  await expect.poll(width).toBeGreaterThan((column ?? 0) + 20);
  const fold = page.locator('#inspector-head [data-act="fold"]');
  await fold.click();
  // Folded: their group out of the layout, or a rail.
  await expect.poll(async () => (await width()) ?? 0).toBeLessThan(50);
  await writer(false);
  await afterFrames(page, 3);
  await foldOf(page, "details").click();
  await expect(page.locator("#inspector-body")).toBeVisible();
  await expect
    .poll(async () => Math.abs(((await width()) ?? 0) - (column ?? 0)))
    .toBeLessThanOrEqual(1);
});

// Why: a phone turned between upright and sideways lays its panels out
// anew (each held its own way), which moves the field in use; its focus
// (and with it the keyboard) must stay on it, so the details stay the
// shown tab through the turn.
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
  await dockSettled(page, 390);
  await expect(page.locator(".dock-host #shell-inspector")).toHaveCount(1);
  await expect.poll(fieldIs, { message: "upright" }).toBe(true);
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
// station unfolded and where it was scrolled. A short desk window, so the
// list scrolls: not 500 px or less, where a phone's one group holds the
// list and Files as tabs from the start.
test("the list made a tab beside Files keeps its folds and its scroll across a tab switch", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1024, height: 520 });
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
  expect(room, "the list scrolls at 1024 x 520").not.toBeNull();
  const at = await scrollProbe(page, Math.min(80, room ?? 0));
  expect(at).toBeGreaterThan(0);

  await files.click();
  await expect(page.locator("#shell-shelf")).toBeVisible();
  await expect(page.locator("#tree-body")).toHaveCount(0);
  await list.click();
  await expect(page.locator("#tree-body")).toBeVisible();
  await expect(gateKids).toBeVisible();
  await expect.poll(() => probeScroll(page)).toBe(at);

  // The shelf's toggle with Files apart from Details: pressed, Files shows;
  // pressed again, Files gives way to the list and the toggle lets go.
  const toggle = page.locator("#shelf-toggle");
  await toggle.click();
  await expect(files).toHaveAttribute("aria-selected", "true");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(list).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#shell-shelf")).toHaveCount(0);
});

// Why: a station drawn into the Details while Files shows is drawn out of
// the page; its card pictures must still load once Details shows again,
// not stay blank until the selection changes.
test("pictures drawn into the details behind the Files tab show when Details shows", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  const host = tabs(page);
  const picks = page.locator("#tree-body .card .pick");
  await picks.nth(0).click();
  await expect(page.locator("#inspector-body")).toBeVisible();
  await host.getByRole("tab", { name: "Files", exact: true }).click();
  await expect(page.locator("#shell-inspector")).toHaveCount(0);
  await picks.nth(1).click();
  await picks.nth(2).click();
  // Still out of the page: the picks drew into the detached details.
  await expect(page.locator("#shell-inspector")).toHaveCount(0);
  await host.getByRole("tab", { name: "Details", exact: true }).click();
  const thumbs = page.locator("#inspector-body button.thumb");
  expect(
    await thumbs.count(),
    "the station offers card pictures",
  ).toBeGreaterThan(0);
  await expect
    .poll(() =>
      thumbs.evaluateAll(
        (all) =>
          all.filter((b) => getComputedStyle(b).backgroundImage === "none")
            .length,
      ),
    )
    .toBe(0);
});

/**
 * Each docked pane's box (null while out of the page or hidden), the shown
 * tab strips' count, the selected tabs and whether the layout is
 * maximized.
 * @param {import("@playwright/test").Page} page
 */
function dockState(page) {
  return page.evaluate(() => {
    /** @type {Record<string, number[] | null>} */
    const boxes = {};
    for (const id of ["view", "list", "details", "problems"]) {
      const pane = document.querySelector(`.dock-pane-${id}`);
      const r = pane?.getBoundingClientRect();
      boxes[id] =
        pane === null || r === undefined || r.width === 0 || r.height === 0
          ? null
          : [r.x, r.y, r.width, r.height].map(Math.round);
    }
    // Shown: with an area and not hidden (a hidden group is sized to
    // nothing and `visibility: hidden`, its strip keeping its box).
    const shown = (/** @type {Element} */ e) => {
      const r = e.getBoundingClientRect();
      return (
        r.width > 0 &&
        r.height > 0 &&
        e.checkVisibility({ visibilityProperty: true })
      );
    };
    // Each shown strip by its tabs' names (their count badges left out, a
    // count may come or go meanwhile), so a failure says which.
    const strips = [
      ...document.querySelectorAll(".dock-host .dv-tabs-and-actions-container"),
    ]
      .filter(shown)
      .map((s) => (s.textContent ?? "").replace(/\d+/g, "").trim())
      .sort();
    const selected = [
      ...document.querySelectorAll(
        '.dock-host [role="tab"][aria-selected="true"]',
      ),
    ]
      .filter(shown)
      .map((t) => (t.textContent ?? "").replace(/\d+/g, "").trim())
      .sort();
    const max =
      document
        .querySelector(".dock-host")
        ?.classList.contains("keyboard-max") ?? false;
    return { boxes, strips, selected, max };
  });
}

/**
 * An on-screen keyboard of `px` (0: none), by the page's real path: the
 * visual viewport shrinks and the page answers; three frames for the
 * docked layout to follow.
 * @param {import("@playwright/test").Page} page
 * @param {number} px
 */
async function keyboardOf(page, px) {
  await page.evaluate((kb) => {
    const viewport = /** @type {VisualViewport} */ (window.visualViewport);
    if (kb === 0) {
      // @ts-expect-error - the stub, back to the browser's own.
      delete viewport.height;
    } else {
      Object.defineProperty(viewport, "height", {
        value: innerHeight - kb,
        configurable: true,
      });
    }
    viewport.dispatchEvent(new Event("resize"));
  }, px);
  await afterFrames(page, 3);
}

// Why: a keyboard over a short window maximizes the group in use; when it
// goes, the layout must come back as it was (sizes, shown tabs, tab
// strips), or a creator who typed one word is left with a rearranged
// editor. The maximized panel's head (its back and fold buttons) stays in
// reach under the largest keyboard. Measured at a small tablet with the
// bottom group shown, and at a phone held sideways, whose one group
// holds the details (the phone's keyboard, docked).
for (const size of [
  { width: 1024, height: 600 },
  { width: 844, height: 390 },
]) {
  const phone = size.height <= 500;
  const at = `at ${String(size.width)} x ${String(size.height)}`;
  test(`a keyboard maximizes the docked group in use, its head in reach, and gives the layout back when it goes ${at}`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.setViewportSize(size);
    await answerHosts(page);
    await openSampleIn3d(page);
    await dockSettled(page, size.width);
    await page.addStyleTag({ content: ".toast { display: none; }" });
    await page
      .locator("#tree-body .card", { hasText: "The old gate" })
      .locator(".pick")
      .click();
    // On a phone the bottom panel's tabs share the details' group: shown,
    // they would take the details out of the page.
    if (!phone) {
      await page.locator('#shell-toggles [data-tab="problems"]').click();
      await expect(page.locator("#shell-pane-problems")).toBeVisible();
    }
    await expect(page.locator("#inspector-body")).toBeVisible();
    await afterFrames(page, 3);
    const before = await dockState(page);
    expect(before.max).toBe(false);
    expect(before.boxes["problems"] === null).toBe(phone);

    // The largest keyboard the keyboard e2e uses here: the bar and one
    // field's row left.
    const kb = size.height - 116;
    await page.locator('#inspector-body [data-field="title"]').focus();
    await keyboardOf(page, kb);
    const up = await dockState(page);
    expect(up.max).toBe(true);
    expect(up.strips).toEqual([]);
    expect(up.boxes["details"]).not.toBeNull();
    for (const id of ["list", "problems"]) expect(up.boxes[id], id).toBeNull();
    // The head's fold button in sight: below the top bar, above the
    // keyboard, nothing over it.
    const reach = await page.evaluate((px) => {
      const b = document.querySelector('#inspector-head [data-act="fold"]');
      if (b === null) return "no fold button";
      const r = b.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      if (y < 43 || y > innerHeight - px) return `at ${String(Math.round(y))}`;
      const hit = document.elementFromPoint(x, y);
      return hit !== null && b.contains(hit)
        ? "ok"
        : `under ${String(hit?.className)}`;
    }, kb);
    expect(reach).toBe("ok");

    // Maximized, the other groups are hidden and their panels out of the
    // page (they render only while shown), so no field of another group can
    // take the focus: the list's search cannot. Should the panels render
    // always again, this fails, and the move to that group is to be tested.
    const moved = await page.evaluate(() => {
      const search = /** @type {HTMLElement | null} */ (
        document.querySelector("#shell-tree .tsearch input")
      );
      search?.focus();
      return document.activeElement === search;
    });
    expect(moved).toBe(false);

    await keyboardOf(page, 0);
    await expect.poll(async () => (await dockState(page)).max).toBe(false);
    await afterFrames(page, 3);
    const after = await dockState(page);
    expect(after.strips).toEqual(before.strips);
    expect(after.selected).toEqual(before.selected);
    for (const id of ["view", "list", "details", "problems"]) {
      const was = before.boxes[id];
      const now = after.boxes[id];
      expect(now === null, id).toBe(was === null);
      if (was === null || now === null) continue;
      for (const [i, v] of was.entries()) {
        expect(
          Math.abs((now[i] ?? 0) - v),
          `${id} [${String(i)}]`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });
}

// Why: maximized over a keyboard, a panel's scrollers keep the 8 px they
// leave below a field brought into sight, and where the layout runs on
// under the keyboard they reach far enough for their last control to rise
// above it (a margin alone does not lengthen a scroller).
test("maximized over a keyboard, the scrollers keep their margin and their last control rises above the keyboard", async ({
  page,
}) => {
  test.setTimeout(150_000);
  for (const [width, height, kb] of [
    [1024, 600, 300],
    [844, 390, 274],
  ]) {
    const at = `at ${String(width)} x ${String(height)}, keyboard ${String(kb)}`;
    await page.setViewportSize({ width, height });
    if (width === 1024) {
      await answerHosts(page);
      await openSampleIn3d(page);
      await page.addStyleTag({ content: ".toast { display: none; }" });
      await page
        .locator("#tree-body .card", { hasText: "The old gate" })
        .locator(".pick")
        .click();
    }
    await dockSettled(page, width);
    await page.locator('#inspector-body [data-field="title"]').focus();
    await keyboardOf(page, kb);
    expect((await dockState(page)).max, at).toBe(true);
    const reach = await page.evaluate((px) => {
      const body = document.querySelector("#inspector-body");
      if (body === null) return null;
      const under = Number.parseFloat(
        getComputedStyle(
          /** @type {Element} */ (document.querySelector(".dock-host")),
        ).getPropertyValue("--dock-under") || "0",
      );
      const all = [
        ...body.querySelectorAll(
          "button, input, select, textarea, [tabindex]:not([tabindex='-1'])",
        ),
      ].filter((e) => e.getClientRects().length > 0);
      const last = all.at(-1);
      if (last === undefined) return null;
      last.scrollIntoView({ block: "end" });
      return {
        padding: getComputedStyle(body).scrollPaddingBottom,
        under,
        lastFoot: Math.round(last.getBoundingClientRect().bottom),
        keyboardTop: innerHeight - px,
      };
    }, kb);
    expect(reach, at).not.toBeNull();
    if (reach === null) continue;
    expect(reach.padding, at).toBe(`${String(8 + reach.under)}px`);
    expect(reach.lastFoot, at).toBeLessThanOrEqual(reach.keyboardTop);
    await keyboardOf(page, 0);
    await expect.poll(async () => (await dockState(page)).max).toBe(false);
  }
});

// Why: a docking module that fails to load is said once; every resize
// asks for the layout again, and a toast each time would bury the page.
test("a docking that fails to load is said once, not on every resize", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await page.route("**/editor-shell/dock-host.ts*", (route) => route.abort());
  await page.addInitScript(() => {
    const said = { n: 0 };
    /** @type {any} */ (window).__dockFailedSaid = said;
    new MutationObserver((records) => {
      for (const r of records) {
        for (const node of r.addedNodes) {
          if (
            node instanceof HTMLElement &&
            node.textContent?.includes("The panels could not be docked") ===
              true
          ) {
            said.n += 1;
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await openSampleIn3d(page);
  const said = () =>
    page.evaluate(() => /** @type {any} */ (window).__dockFailedSaid.n);
  await expect.poll(said).toBe(1);
  for (const width of [1200, 600, 1300]) {
    await page.setViewportSize({ width, height: 900 });
    await afterFrames(page, 3);
  }
  await expect(page.locator(".dock-host")).toHaveCount(0);
  expect(await said()).toBe(1);
});

// Why: the list's head is a row of buttons; at a narrow list one past the
// list's edge is clipped under the 3D view and cannot be pressed. Measured
// at the list's first width at 1024 px (210 px) and at the least width a
// splitter allows (140 px).
test("the docked list's head buttons stay inside the list at 210 and at 140 px", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1024, height: 768 });
  await answerHosts(page);
  await openSampleIn3d(page);
  await dockSettled(page, 1024);
  const overflow = () =>
    page.evaluate(() => {
      const pane = document.querySelector(".dock-pane-list");
      if (pane === null) return ["no list"];
      const edge = pane.getBoundingClientRect().right;
      const out = [
        `width ${String(Math.round(pane.getBoundingClientRect().width))}`,
      ];
      for (const id of [
        "tree-stations",
        "tree-select",
        "tree-collapse",
        "tree-add",
        "tree-fold",
      ]) {
        const b = document.getElementById(id);
        if (b === null || b.getClientRects().length === 0) continue;
        const r = b.getBoundingClientRect();
        if (r.right > edge + 0.5) {
          out.push(`${id} ends ${String(Math.round(r.right - edge))} px past`);
        }
      }
      // Narrow, Select keeps only its icon so the stations' header keeps
      // a width that can be pressed.
      const select = document.getElementById("tree-select");
      const stations = document.getElementById("tree-stations");
      if (select !== null && select.getBoundingClientRect().width > 26) {
        out.push(
          `select ${String(Math.round(select.getBoundingClientRect().width))} px`,
        );
      }
      if (stations !== null && stations.getBoundingClientRect().width < 24) {
        out.push(
          `stations ${String(Math.round(stations.getBoundingClientRect().width))} px`,
        );
      }
      return out;
    });
  expect(await overflow()).toEqual(["width 210"]);
  // The list's splitter dragged as far left as it goes.
  const list = await box(page.locator(".dock-pane-list"));
  const x = list.x + list.width + 1;
  const y = list.y + list.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 40, y);
  await page.mouse.move(x - 200, y);
  await page.mouse.up();
  await afterFrames(page, 3);
  expect(await overflow()).toEqual(["width 140"]);
});

/** A rail's thickness for a mouse and for a finger (`dock-rail.ts`'s
 *  `RAIL_PX`). */
const RAIL_PX = 34;
const TOUCH_RAIL_PX = 44;

/**
 * Each panel's group's box, by the panel's id: the groups as laid out
 * now, in ONE round trip.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<Record<string, number[]>>}
 */
function groupBoxes(page) {
  return page.evaluate(() => {
    /** @type {Record<string, number[]>} */
    const out = {};
    for (const tab of document.querySelectorAll(".dock-host .dock-tab")) {
      const id = /** @type {HTMLElement} */ (tab).dataset["panel"];
      const group = tab.closest(".dv-groupview");
      if (id === undefined || group === null) continue;
      const r = group.getBoundingClientRect();
      out[id] = [r.x, r.y, r.width, r.height].map(Math.round);
    }
    return out;
  });
}

/**
 * Where Files stands against Details: "below" once dragged into a group
 * of its own under Details, in the right column.
 * @param {import("@playwright/test").Page} page
 */
async function filesBelowDetails(page) {
  const g = await groupBoxes(page);
  const files = g["files"];
  const details = g["details"];
  if (files === undefined || details === undefined) return "a group missing";
  if (files[1] < details[1] + details[3] - SASH_PX) return "not below";
  if (Math.abs(files[0] - details[0]) > 1) return "another column";
  return "below";
}

// At a desk; a phone's one group rearranges by the same drags (a tab
// pulled out of it: `editor3d-phone.spec.js`), but has no Details group
// to drop below and no bottom group to take Problems from.
for (const size of [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
  { width: 1024, height: 600 },
]) {
  const at = `at ${String(size.width)} x ${String(size.height)}`;
  // Why: a creator arranges the panels by dragging their tabs - beside,
  // below or into another group - and the 3D view stays the centre: a
  // tab dropped onto it is refused (it would bury the view behind a
  // tab), and whatever the arrangement the selection stays in sight.
  test(`the panels rearrange by their tabs ${at}, the 3D view refusing a tab`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.setViewportSize(size);
    await answerHosts(page);
    await openSampleIn3d(page);
    await dockSettled(page, size.width);
    const host = tabs(page);
    const files = host.getByRole("tab", { name: "Files", exact: true });

    expect((await dockState(page)).strips, `before ${at}`).toEqual([
      "DetailsFiles",
    ]);
    // Onto the 3D view's middle: refused, nothing moves.
    const view = await box(page.locator(".dock-pane-view"));
    await files.dragTo(page.locator(".dock-pane-view"), {
      targetPosition: { x: view.width / 2, y: view.height / 2 },
    });
    await afterFrames(page, 2);
    expect((await dockState(page)).strips, at).toEqual(["DetailsFiles"]);

    // Files below Details, in the right column.
    // Details stand behind the Files tab: their group is the target.
    const column = await box(groupOf(page, "details"));
    // In the group's bottom zone, clear of the layout's own edge (a drop
    // there runs Files along the whole layout's foot).
    await files.dragTo(groupOf(page, "details"), {
      targetPosition: { x: column.width / 2, y: column.height * 0.85 },
    });
    await expect.poll(() => filesBelowDetails(page), at).toBe("below");

    // Problems, from the bottom group into the Details group as a tab.
    await page.locator('#shell-toggles [data-tab="problems"]').click();
    const problems = host.getByRole("tab", { name: "Problems" });
    await expect(problems).toBeVisible();
    const details = await box(groupOf(page, "details"));
    await problems.dragTo(groupOf(page, "details"), {
      targetPosition: { x: details.width / 2, y: details.height / 2 },
    });
    await expect
      .poll(async () => (await dockState(page)).strips, at)
      .toContain("DetailsProblems");
    await expect(problems).toHaveAttribute("aria-selected", "true");

    // The bottom group left under the view, narrow between two columns:
    // its tabs shorten rather than spill into the overflow menu, and the
    // pane it shows is drawn though Problems now shows elsewhere.
    const bottom = groupOf(page, "perf");
    await expect
      .poll(
        () =>
          bottom
            .locator(".dv-tabs-container")
            .evaluate((e) => e.scrollWidth - e.clientWidth),
        at,
      )
      .toBeLessThanOrEqual(0);
    await expect(bottom.locator("#shell-pane-perf .nums"), at).toBeVisible();
    // Problems' toggle takes Problems out of sight, not its new group:
    // Details shows again there, at its width.
    const toggleProblems = page.locator('#shell-toggles [data-tab="problems"]');
    await expect(toggleProblems).toHaveAttribute("aria-pressed", "true");
    const columnWidth = (await groupBoxes(page))["details"]?.[2] ?? 0;
    await toggleProblems.click();
    await expect(
      host.getByRole("tab", { name: "Details", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(toggleProblems).toHaveAttribute("aria-pressed", "false");
    expect((await groupBoxes(page))["details"]?.[2], at).toBe(columnWidth);

    // The 3D view still the centre, the selection framed in its middle.
    await page
      .locator("#tree-body .card", { hasText: "The old gate" })
      .locator(".pick")
      .click();
    await page.locator("#view3d").focus();
    await page.keyboard.press("f");
    await afterFrames(page, 2);
    expect(await middleIsCanvas(page), at).toBe(true);
    await capture(page, test.info().outputPath(`rearranged-${at}.png`));
  });
}

// At a desk; a phone's one group folds by its strip's fold button
// (`editor3d-phone.spec.js`): it has no list or details side of its own.
for (const size of [
  { width: 1440, height: 900 },
  { width: 1024, height: 600 },
]) {
  const at = `at ${String(size.width)} x ${String(size.height)}`;
  // Why: a side folded to its rail gives its room to the 3D view - a fold
  // that left a gap, or a view that did not grow, would leave the
  // selection framed off its middle - and unfolds at the size it had (at
  // least a usable one).
  test(`each side folds to a rail and back ${at}, the 3D view taking the room`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.setViewportSize(size);
    await answerHosts(page);
    await openSampleIn3d(page);
    await dockSettled(page, size.width);
    await page
      .locator("#tree-body .card", { hasText: "The old gate" })
      .locator(".pick")
      .click();
    await expect(page.locator("#inspector-body")).toBeVisible();
    await capture(page, test.info().outputPath(`default-${at}.png`));
    const want = widths(size.width);
    const top = TOP_PX + LINE_PX;
    const foot = size.height - BAR_PX;
    const framed = async (/** @type {string} */ what) => {
      await page.locator("#view3d").focus();
      await page.keyboard.press("f");
      await afterFrames(page, 2);
      expect(await middleIsCanvas(page), `${what} ${at}`).toBe(true);
    };
    const sizeOf = async (
      /** @type {string} */ id,
      /** @type {number} */ index,
    ) => (await groupBoxes(page))[id]?.[index] ?? 0;
    const viewBox = () => box(page.locator(".dock-pane-view"));

    // The list, by its own head's fold button: a rail at the left edge,
    // the view from its edge.
    await page.locator("#tree-fold").click();
    await expect.poll(() => sizeOf("list", 2), at).toBe(RAIL_PX);
    await expect(groupOf(page, "list").getByRole("tab")).toBeVisible();
    await expect
      .poll(async () => (await viewBox()).x, at)
      .toBeLessThanOrEqual(RAIL_PX + SASH_PX);
    await framed("list folded");
    await capture(page, test.info().outputPath(`folded-left-${at}.png`));
    await foldOf(page, "list").click();
    await expect(page.locator("#tree-body")).toBeVisible();
    await expect
      .poll(
        async () =>
          Math.abs((await sizeOf("list", 2)) - Math.max(200, want.list)),
        at,
      )
      .toBeLessThanOrEqual(1);

    // The details, by their group's fold button: a rail at the right edge.
    await foldOf(page, "details").click();
    await expect(page.locator("#inspector-body")).toBeHidden();
    await expect.poll(() => sizeOf("details", 2), at).toBe(RAIL_PX);
    await expect
      .poll(async () => {
        const v = await viewBox();
        return size.width - RAIL_PX - (v.x + v.width);
      }, at)
      .toBeLessThanOrEqual(SASH_PX);
    await framed("details folded");
    await capture(page, test.info().outputPath(`folded-right-${at}.png`));
    await foldOf(page, "details").click();
    await expect(page.locator("#inspector-body")).toBeVisible();
    await expect
      .poll(
        async () =>
          Math.abs((await sizeOf("details", 2)) - Math.max(200, want.column)),
        at,
      )
      .toBeLessThanOrEqual(1);

    // The bottom group: a rail along the bottom bar.
    await page.locator('#shell-toggles [data-tab="problems"]').click();
    await expect(page.locator("#shell-pane-problems")).toBeVisible();
    const opened = await sizeOf("problems", 3);
    await foldOf(page, "problems").click();
    await expect(page.locator("#shell-pane-problems")).toBeHidden();
    await expect.poll(() => sizeOf("problems", 3), at).toBe(RAIL_PX);
    await expect
      .poll(async () => {
        const v = await viewBox();
        return foot - RAIL_PX - (v.y + v.height);
      }, at)
      .toBeLessThanOrEqual(SASH_PX);
    expect((await viewBox()).y, at).toBeCloseTo(top, 0);
    await framed("bottom folded");
    await capture(page, test.info().outputPath(`folded-bottom-${at}.png`));
    await foldOf(page, "problems").click();
    await expect(page.locator("#shell-pane-problems")).toBeVisible();
    await expect
      .poll(
        async () =>
          Math.abs((await sizeOf("problems", 3)) - Math.max(120, opened)),
        at,
      )
      .toBeLessThanOrEqual(1);
  });
}

test.describe("by touch", () => {
  test.use({ hasTouch: true });

  // Why: on a tablet the panels are arranged and folded by a finger: a
  // tab dragged by touch must move, and a rail must be wide enough for a
  // finger. (A phone's tab pulled out of its group by touch:
  // `editor3d-phone.spec.js`.)
  test("a tab dragged by touch moves, and a tap folds a side to a finger-wide rail", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const size = { width: 1024, height: 600 };
    await page.setViewportSize(size);
    await answerHosts(page);
    await openSampleIn3d(page);
    await dockSettled(page, size.width);
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    ).toBe(true);
    const files = await box(
      tabs(page).getByRole("tab", { name: "Files", exact: true }),
    );
    const column = await box(page.locator(".dock-pane-details"));
    const cdp = await page.context().newCDPSession(page);
    const from = {
      x: files.x + files.width / 2,
      y: files.y + files.height / 2,
    };
    const to = {
      x: column.x + column.width / 2,
      y: column.y + column.height - 6,
    };
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [from],
    });
    for (let step = 1; step <= 12; step++) {
      const t = step / 12;
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
        ],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect.poll(() => filesBelowDetails(page)).toBe("below");

    // Half the column now, the details fold their height (a column folds
    // its width): a rail across the column, a finger high.
    await foldOf(page, "details").tap();
    await expect
      .poll(async () => (await groupBoxes(page))["details"]?.[3])
      .toBe(TOUCH_RAIL_PX);
    await capture(page, test.info().outputPath("touch-folded-1024x600.png"));
  });
});

/**
 * Files dragged below Details, in the right column, as a creator does.
 * @param {import("@playwright/test").Page} page
 */
async function dragFilesBelowDetails(page) {
  const files = tabs(page).getByRole("tab", { name: "Files", exact: true });
  const column = await box(groupOf(page, "details"));
  await files.dragTo(groupOf(page, "details"), {
    targetPosition: { x: column.width / 2, y: column.height * 0.85 },
  });
  await expect.poll(() => filesBelowDetails(page)).toBe("below");
}

/**
 * Whether the layout kept for `formFactor` holds Files in a group of its
 * own: the kept layout once the drag's changes have settled.
 * @param {import("@playwright/test").Page} page
 * @param {string} formFactor
 */
function keptFilesAlone(page, formFactor) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw !== null && raw.includes('"views":["files"]');
  }, `editor-dock-layout:${formFactor}`);
}

// Why: a creator's arrangement is theirs - it must come back when the
// editor opens again, and a kept layout that is broken (another version,
// a panel missing) must give the default layout, never an empty or a
// partial one.
test("a rearranged layout comes back when the editor opens again, a broken one gives the default", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  await dockSettled(page, 1440);
  await dragFilesBelowDetails(page);
  await expect.poll(() => keptFilesAlone(page, "desk")).toBe(true);

  await openSampleIn3d(page);
  await dockSettled(page, 1440);
  await expect.poll(() => filesBelowDetails(page)).toBe("below");

  await page.evaluate(() => {
    window.localStorage.setItem(
      "editor-dock-layout:desk",
      JSON.stringify({ v: 1, layout: { grid: {}, panels: {} }, folds: [] }),
    );
  });
  await openSampleIn3d(page);
  await dockSettled(page, 1440);
  expect((await dockState(page)).strips).toEqual(["DetailsFiles"]);
  expect(await filesBelowDetails(page)).not.toBe("below");
});

// Why: a desk's three columns do not fit a phone held sideways, nor its
// arrangement the desk: each form factor keeps its own layout, and the
// window turning from one to the other swaps them (the phone's default
// is its one group).
test("the desk and a phone held sideways keep their own layouts", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  await dockSettled(page, 1440);
  await dragFilesBelowDetails(page);
  await expect.poll(() => keptFilesAlone(page, "desk")).toBe(true);

  await page.setViewportSize({ width: 844, height: 390 });
  await expect
    .poll(async () => (await dockState(page)).strips)
    .toEqual([PHONE_STRIP]);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => filesBelowDetails(page)).toBe("below");
  expect(await keptFilesAlone(page, "sideways")).toBe(false);
});

// Why: a keyboard cannot drag a tab. Shift+F10 on a focused tab offers
// where its panel can go; the move lands there and the focus stays on
// the moved tab, so the creator can go on from it.
test("a tab's Shift+F10 moves its panel by the keyboard, the focus on its tab after", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  await dockSettled(page, 1440);
  const files = tabs(page).getByRole("tab", { name: "Files", exact: true });
  await files.focus();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu", { name: "Move Files to" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Into List",
    "Left of the 3D view",
    "Right of the 3D view",
    "Below the 3D view",
  ]);
  // The docking library's own mouse menu does not open as well.
  await expect(page.locator(".dv-context-menu")).toHaveCount(0);
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(files).toBeFocused();

  await page.keyboard.press("Shift+F10");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect
    .poll(async () => {
      const g = await groupBoxes(page);
      const view = g["view"];
      const moved = g["files"];
      if (view === undefined || moved === undefined) return "missing";
      return moved[1] >= view[1] + view[3] - SASH_PX ? "below" : "elsewhere";
    })
    .toBe("below");
  await expect(files).toBeFocused();
  await expect(files).toHaveAttribute("aria-selected", "true");
});

// Why: a folded group is a rail of its tabs' icons; the Problems tab on
// it carries the tour's problem count, so a creator sees there is
// something to fix without unfolding it.
test("a folded rail shows the problem count on its Problems tab", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  await dockSettled(page, 1440);
  // A new station has no content yet: a note among the tour's problems.
  await page.locator("#tree-add").click();
  await expect(page.locator("#tree-body .card")).toHaveCount(4);
  // Problems into the right column's group by its menu, then the group
  // folded to its rail.
  await page.locator('#shell-toggles [data-tab="problems"]').click();
  const problems = tabs(page).getByRole("tab", { name: /^Problems/ });
  await problems.focus();
  await page.keyboard.press("Shift+F10");
  await page
    .getByRole("menu", { name: "Move Problems to" })
    .getByRole("menuitem", { name: /^Into Details/ })
    .click();
  await expect
    .poll(async () => (await dockState(page)).strips.join("|"))
    .toContain("DetailsFilesProblems");
  await foldOf(page, "problems").click();
  const badge = groupOf(page, "problems").locator(
    '.dock-tab[data-panel="problems"] .dock-badge',
  );
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText(/^\d+$/);
  await expect(badge).toHaveAttribute(
    "aria-label",
    /^\d+ errors?, \d+ warnings?, [1-9]\d* notes?$/,
  );
});

/**
 * The 3D view's canvas against its panel: in it, its box the panel's, its
 * drawing buffer in the box's proportions, its drawing context alive.
 * @param {import("@playwright/test").Page} page
 */
function canvasInPanel(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("#view3d canvas.view3d-canvas");
    const pane = document.querySelector(".dock-host .dock-pane-view");
    if (!(canvas instanceof HTMLCanvasElement) || pane === null) {
      return "missing";
    }
    if (canvas.dataset["mark"] !== "kept") return "another canvas";
    if (!pane.contains(canvas)) return "out of its panel";
    const c = canvas.getBoundingClientRect();
    const p = pane.getBoundingClientRect();
    if (
      Math.max(
        Math.abs(c.left - p.left),
        Math.abs(c.top - p.top),
        Math.abs(c.width - p.width),
        Math.abs(c.height - p.height),
      ) > 1.5
    ) {
      return "not the panel's size";
    }
    const box = c.width / c.height;
    const buffer = canvas.width / canvas.height;
    if (!(Math.abs(box - buffer) / box < 0.03)) return "buffer not fitted";
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (gl === null || gl.isContextLost()) return "context lost";
    return "drawing";
  });
}

// Why: a window turning to another form factor lays the docking out
// again from scratch (that form factor's own layout). The 3D view's
// canvas must come through in its panel, with its drawing context and a
// buffer fitted to its new box, and go on drawing - a canvas left out of
// the page or a lost context would leave the creator a blank view.
test("the 3D view's canvas stays in its panel and draws on while the window turns", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  await dockSettled(page, 1440);
  await page.evaluate(() => {
    const canvas = document.querySelector("#view3d canvas.view3d-canvas");
    if (canvas instanceof HTMLElement) canvas.dataset["mark"] = "kept";
  });
  await expect.poll(() => canvasInPanel(page)).toBe("drawing");
  for (const size of [
    { width: 844, height: 390 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size);
    await dockSettled(page, size.width);
    await expect
      .poll(() => canvasInPanel(page), `at ${String(size.width)}`)
      .toBe("drawing");
    await afterFrames(page, 3);
    expect(await middleIsCanvas(page)).toBe(true);
  }
});

// Why: a change made just before the window turns (a drop, then the
// phone turned at once) belongs to the form factor it was made in. It is
// written only once its changes settle, and the turn must write it then
// rather than drop it.
test("a change made just before the window turns is kept for the form factor it was made in", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  await dockSettled(page, 1440);
  const files = tabs(page).getByRole("tab", { name: "Files", exact: true });
  const column = await box(groupOf(page, "details"));
  await files.dragTo(groupOf(page, "details"), {
    targetPosition: { x: column.width / 2, y: column.height * 0.85 },
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect
    .poll(async () => (await dockState(page)).strips)
    .toEqual([PHONE_STRIP]);
  expect(await keptFilesAlone(page, "desk")).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => filesBelowDetails(page)).toBe("below");
});

/**
 * The docked list's and the right column's widths, rounded.
 * @param {import("@playwright/test").Page} page
 */
function sideWidths(page) {
  return page.evaluate(() => {
    const widthOf = (/** @type {string} */ selector) =>
      Math.round(
        document
          .querySelector(selector)
          ?.closest(".dv-groupview")
          ?.getBoundingClientRect().width ?? 0,
      );
    return {
      list: widthOf(".dock-host .dock-pane-list"),
      column: widthOf(".dock-host .dock-pane-details"),
    };
  });
}

// Why: a kept layout's sizes are the creator's at the window it was kept
// at. Opened in a wider window it is fitted as after a window resize -
// the side groups at that window's widths, the 3D view taking the rest -
// not scaled in proportion, which would widen the list and the column by
// half again from a 1280 px window to a 1920 px one.
test("a kept layout opened in a wider window takes that window's side widths", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const before = widths(1280);
  const after = widths(1920);
  // The test tells the two rules apart only while they differ.
  expect(Math.abs(after.column - before.column * 1.5)).toBeGreaterThan(4);
  await page.setViewportSize({ width: 1280, height: 800 });
  await answerHosts(page);
  await openSampleIn3d(page);
  await dockSettled(page, 1280);
  await dragFilesBelowDetails(page);
  await expect.poll(() => keptFilesAlone(page, "desk")).toBe(true);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await openSampleIn3d(page);
  await dockSettled(page, 1920);
  await expect.poll(() => filesBelowDetails(page)).toBe("below");
  await expect
    .poll(() => sideWidths(page))
    .toEqual({ list: after.list, column: after.column });
});
