// @ts-check
import { expect, test } from "@playwright/test";

import {
  fileCommand,
  fileItem,
  publish,
  save,
  viewCommand,
  viewItem,
} from "./editor-menus.js";
import {
  answerHosts,
  boxIn,
  capture,
  keepRejections,
  layoutOf,
  openSampleIn3d,
  rejections,
  shownIn,
  styleIn,
  view3d,
} from "./editor3d-fixture.js";
import { useWideFont } from "./wide-font.js";

/**
 * Why these tests matter: the 3D view's studio shell is a layout over the
 * scene - a 40 px top bar, a 3 px accent line right under it, a 24 px
 * bottom bar holding the map's credits at its left, the tree dock flush
 * left and the inspector flush right, both hanging from the line and
 * running down to the bottom bar, the map controls in one row directly
 * left of the inspector (at the right edge without one) - and a presence
 * check passes a broken one. These pin
 * positions, sizes and gaps at a phone, a phone in landscape, a tablet in
 * portrait and a desktop, the narrow-window rule (below 900 px one dock
 * at a time), every top-bar control inside the window, in words, and
 * none over another, the tour's name never squeezed away - also in the
 * bar's most crowded state, at every step it folds, in a wide face; the
 * File, Edit and View menus from the keyboard and by touch, the unsaved
 * mark, the tree from the keyboard alone, File's Add debug data; and the tree's click rule on the sample tour: a
 * click selects, unfolds and flies there, a second click deselects and
 * folds, a quick second click (a double click) does not toggle, and the
 * folds outlive a trip to the map.
 */

// One worker for the file, its tests in order: three software-drawn 3D
// views at a desktop size side by side took about 3 min each, against
// about 12 s one after another.
test.describe.configure({ mode: "default" });

/** A dock folded to its head: the 36 px head and the dock's 1 px top
 *  and bottom edges. */
const FOLDED_PX = 38;

/** The accent line under the top bar (px), and its colour (`--s-accent`). */
const LINE_PX = 3;
const ACCENT = "rgb(233, 162, 59)";

/** Where the docks begin (px from the window's top): directly under the
 *  40 px top bar and the accent line, no gap - in this view as in the
 *  globe view (`editor3d-globe-approach.spec.js`), so both lay out alike. */
const VIEW_TOP_PX = 40;
const DOCK_TOP_PX = VIEW_TOP_PX + LINE_PX;

/** The dialogs' and toasts' dark dress: the shell's `--s-bg1`, `--s-bg2`
 *  and `--s-text`. */
const BG1 = "rgb(31, 32, 35)";
const BG2 = "rgb(38, 40, 44)";
const TEXT = "rgb(217, 219, 224)";

/**
 * The WCAG contrast ratio of two computed colours ("rgb(r, g, b)").
 * @param {string} fg
 * @param {string} bg
 */
function contrast(fg, bg) {
  const luminance = (/** @type {string} */ css) => {
    const [r = 0, g = 0, b = 0] = (css.match(/[\d.]+/g) ?? []).map((v) => {
      const c = Number(v) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/**
 * @param {{x: number, y: number, width: number, height: number}} a
 * @param {{x: number, y: number, width: number, height: number}} b
 */
function overlaps(a, b) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** @param {import("@playwright/test").Page} page */
async function open3d(page) {
  await answerHosts(page);
  await openSampleIn3d(page);
}

/** @param {import("@playwright/test").Locator} locator */
async function box(locator) {
  const b = await locator.boundingBox();
  if (b === null) throw new Error("no box: the element is not shown");
  return b;
}

/**
 * The narrowest the tour's name may get in the top bar at `width`: the
 * bar folds its other controls before the name goes below this.
 * @param {number} width
 */
function nameFloorPx(width) {
  if (width > 720) return 96;
  if (width > 440) return 56;
  if (width > 375) return 40;
  return 20;
}

/** The parts of the frame `expectFrame` measures. */
const FRAME_PARTS = [
  "#topbar",
  "#shell-bar",
  "#view3d",
  "#load-line",
  "#shell-tree",
  "#tree-body",
  "#shell-inspector",
  "#inspector-body",
  "#shell-shelf",
  "#compass",
  "#zoom-in",
  "#zoom-out",
  "#map-controls",
  "#view3d-credits .view3d-credits-button",
  "#topbar .brand-text",
];

/**
 * Everything `expectFrame` reads, in two round trips to the page: each
 * read through Playwright waits on a main thread busy drawing the 3D view
 * in software, so about 47 separate reads cost seconds per call, and the
 * crowded sweep makes a call per width. The checks then run in the test,
 * on the data.
 * @param {import("@playwright/test").Page} page
 */
async function frameOf(page) {
  await shelfSettled(page);
  const layout = await layoutOf(page, FRAME_PARTS, ["background-color"]);
  const rest = await page.evaluate(() => {
    // A toast (a long one, as wide as a toast gets), put in the toasts' box
    // for the measure and taken out.
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent =
      "Opened a tour with a long name: 12 codes, 4 notes, 30 stations";
    document.getElementById("toasts")?.append(t);
    const r = t.getBoundingClientRect();
    const toast = { x: r.x, y: r.y, width: r.width, height: r.height };
    t.remove();
    // Nothing over the credits: the point at their middle hits them.
    const credits = document.querySelector(
      "#view3d-credits .view3d-credits-button",
    );
    let creditsUncovered = false;
    if (credits !== null) {
      const c = credits.getBoundingClientRect();
      const hit = document.elementFromPoint(
        c.x + c.width / 2,
        c.y + c.height / 2,
      );
      creditsUncovered = hit === credits || credits.contains(hit);
    }
    // The top bar's controls shown (as Playwright's isVisible reads them).
    const controls = [
      ...document.querySelectorAll("#topbar :is(button, .unsaved-mark)"),
    ]
      .map((c) => ({ c, r: c.getBoundingClientRect() }))
      .filter(
        ({ c, r }) =>
          r.width > 0 &&
          r.height > 0 &&
          getComputedStyle(c).visibility !== "hidden",
      )
      .map(({ c, r }) => ({
        id: c.id,
        words: /** @type {HTMLElement} */ (c).innerText.trim(),
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      }));
    return { toast, creditsUncovered, controls };
  });
  return { layout, ...rest };
}

/**
 * Waits out the asset shelf's width transition after a resize: the docks
 * beside it take its new width at once, the shelf's own box only once the
 * transition ends.
 * @param {import("@playwright/test").Page} page
 */
async function shelfSettled(page) {
  await page.waitForFunction(
    () =>
      (document.getElementById("shell-shelf")?.getAnimations().length ?? 0) ===
      0,
  );
}

/**
 * The layout every viewport shares: the bars, the viewport between them,
 * the map controls, and the top bar's controls in a row inside it, the
 * tour's name no narrower than its floor.
 * @param {import("@playwright/test").Page} page
 * @param {{ width: number, height: number }} size
 */
async function expectFrame(page, size) {
  const frame = await frameOf(page);
  const must = (/** @type {string} */ selector) =>
    boxIn(frame.layout, selector);
  const shownNow = (/** @type {string} */ selector) =>
    shownIn(frame.layout, selector);
  const phone = size.width <= 700;
  expect(must("#topbar")).toEqual({
    x: 0,
    y: 0,
    width: size.width,
    height: 40,
  });
  const bar = must("#shell-bar");
  expect(bar).toEqual({
    x: 0,
    y: size.height - 24,
    width: size.width,
    height: 24,
  });
  expect(must("#view3d")).toEqual({
    x: 0,
    y: 40,
    width: size.width,
    height: size.height - 64,
  });
  const at = `at ${String(size.width)} x ${String(size.height)}`;
  // The accent line: the view's full width, 3 px, right under the top bar,
  // in the accent colour (full: the view shows no load of its own).
  expect(must("#load-line"), at).toEqual({
    x: 0,
    y: 40,
    width: size.width,
    height: LINE_PX,
  });
  expect(styleIn(frame.layout, "#load-line", "background-color"), at).toBe(
    ACCENT,
  );
  // Every open dock hangs from the line, no gap, and runs down to the
  // bottom bar; a folded one is its head, hanging from the line too.
  for (const [id, body] of [
    ["#shell-tree", "#tree-body"],
    ["#shell-inspector", "#inspector-body"],
  ]) {
    if (!shownNow(id)) continue;
    const dock = must(id);
    // A phone's sheet stands on the bottom bar, the map above it.
    if (phone) {
      expect([dock.x, dock.width], `${id} ${at}`).toEqual([0, size.width]);
      expect(dock.y + dock.height, `${id} ${at}`).toBeCloseTo(
        size.height - 24,
        0,
      );
      continue;
    }
    expect(dock.y, `${id} ${at}`).toBe(DOCK_TOP_PX);
    if (shownNow(body)) {
      expect(dock.y + dock.height, `${id} ${at}`).toBeCloseTo(
        size.height - 24,
        0,
      );
    } else {
      expect(dock.height, `${id} ${at}`).toBeCloseTo(FOLDED_PX, 0);
    }
  }
  // The map controls: one row 14 px over the bottom bar (on a phone 12 px
  // under the top bar, clear of the sheet), the compass left of + and -, 38 px
  // buttons, the zoom pill 8 px right of the compass, its right edge 12 px
  // left of an open inspector, else of the asset shelf, else 12 px from the
  // window's right. The shelf stands at the window's right, an open
  // inspector against it (a phone's shelf is a sheet of its own).
  const compass = must("#compass");
  const zoomIn = must("#zoom-in");
  const zoomOut = must("#zoom-out");
  expect([compass.width, compass.height]).toEqual([38, 38]);
  expect([zoomIn.y, zoomOut.y], at).toEqual([compass.y, compass.y]);
  expect(zoomIn.x - (compass.x + compass.width), at).toBe(8);
  // The second button's 1 px divider is inside its 38 px.
  expect(zoomOut.x, at).toBe(zoomIn.x + 38);
  if (phone) expect(compass.y, at).toBe(VIEW_TOP_PX + 12);
  else expect(size.height - 24 - (compass.y + compass.height), at).toBe(14);
  const shelf =
    !phone && shownNow("#shell-shelf") ? must("#shell-shelf") : null;
  if (shelf !== null) {
    expect(shelf.x + shelf.width, `the shelf ${at}`).toBeCloseTo(size.width, 0);
  }
  const shelfX = shelf?.x ?? size.width;
  if (shownNow("#shell-inspector") && !phone) {
    const inspector = must("#shell-inspector");
    expect(inspector.x + inspector.width, `#shell-inspector ${at}`).toBeCloseTo(
      shelfX,
      0,
    );
  }
  const rightEdge =
    shownNow("#inspector-body") && !phone
      ? must("#shell-inspector").x - 12
      : shelfX - 12;
  expect(zoomOut.x + zoomOut.width, at).toBeCloseTo(rightEdge, 0);
  const controls = must("#map-controls");
  for (const id of ["#shell-tree", "#shell-inspector", "#shell-shelf"]) {
    if (!shownNow(id)) continue;
    expect(
      overlaps(controls, must(id)),
      `the map controls over ${id} ${at}`,
    ).toBe(false);
  }
  // A toast (a long one, as wide as a toast gets) stands clear of the map
  // controls: centred over the bottom bar it once covered them on a
  // phone.
  const toastBox = frame.toast;
  expect(toastBox.height, at).toBeGreaterThan(0);
  expect(
    overlaps(toastBox, controls),
    `a toast over the map controls ${at}`,
  ).toBe(false);
  // The map's credits: small, at the bottom bar's left, inside it, and
  // nothing over them (they are attribution: always seen, always one
  // click away).
  const c = must("#view3d-credits .view3d-credits-button");
  expect(c.x, at).toBeGreaterThanOrEqual(0);
  expect(c.x, at).toBeLessThan(12);
  expect(c.y, at).toBeGreaterThanOrEqual(bar.y);
  expect(c.y + c.height, at).toBeLessThanOrEqual(bar.y + bar.height);
  expect(frame.creditsUncovered, `the credits uncovered ${at}`).toBe(true);
  // Every top-bar control shown sits inside the bar, left to right, none
  // over the next, and says its words (an icon alone says nothing).
  const shown = [...frame.controls].sort((a, b) => a.x - b.x);
  for (const b of shown) {
    // The unsaved mark may be its dot alone: its words are the bottom
    // bar's status line, and its title.
    if (b.id !== "unsaved-mark") expect(b.words, `${b.id} ${at}`).not.toBe("");
  }
  for (const [i, b] of shown.entries()) {
    expect(b.x, at).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, at).toBeLessThanOrEqual(size.width);
    expect(b.y, at).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height, at).toBeLessThanOrEqual(40);
    const next = shown[i + 1];
    if (next !== undefined) {
      expect(next.x, `control ${String(i + 1)} ${at}`).toBeGreaterThanOrEqual(
        b.x + b.width - 0.5,
      );
    }
  }
  // The name's room: the part of the brand it shows in.
  const name = must("#topbar .brand-text");
  expect(name.width, `the name ${at}`).toBeGreaterThanOrEqual(
    nameFloorPx(size.width),
  );
}

/**
 * The tree's dock: flush left under the accent line, `width` wide, open
 * (its cards shown, down to the bottom bar) or folded to its head.
 * @param {import("@playwright/test").Page} page
 * @param {number} width
 * @param {boolean} open
 */
async function expectTree(page, width, open) {
  const tree = await box(page.locator("#shell-tree"));
  expect(tree.x).toBe(0);
  expect(tree.y).toBe(DOCK_TOP_PX);
  expect(tree.width).toBeCloseTo(width, 0);
  if (open) {
    await expect(page.locator("#tree-body")).toBeVisible();
    const view = page.viewportSize();
    expect(tree.y + tree.height).toBeCloseTo((view?.height ?? 0) - 24, 0);
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
  // About 52 s on CI, 144 s at worst under load.
  test.setTimeout(240_000);
  await useWideFont(page);
  // A phone: the list is a sheet; selecting a station turns it into the
  // details. Where the sheets stand: `editor3d-phone.spec.js`.
  const phone = { width: 390, height: 844 };
  await page.setViewportSize(phone);
  await open3d(page);
  await expectFrame(page, phone);
  await expect(page.locator("#tree-body")).toBeVisible();
  await expect(page.locator("#shell-inspector")).toBeHidden();
  await card(page, "The old gate").locator(".pick").click();
  await expect(page.locator("#inspector-body")).toBeVisible();
  await expect(page.locator("#shell-tree")).toBeHidden();
  await expectFrame(page, phone);
  await capture(page, test.info().outputPath("shell-390x844.png"));

  // Turned, both docks stand, 226 and 268 px, the map controls left of the
  // inspector; folded to its head, it gives the view back.
  const landscape = { width: 844, height: 390 };
  await page.setViewportSize(landscape);
  await expectFrame(page, landscape);
  await expectTree(page, 226, true);
  const turned = await box(page.locator("#shell-inspector"));
  expect(turned.width).toBeCloseTo(268, 0);
  expect(turned.x + turned.width).toBeCloseTo(
    (await box(page.locator("#shell-shelf"))).x,
    0,
  );
  await capture(page, test.info().outputPath("shell-844x390.png"));
  await page.locator('#inspector-head [data-act="fold"]').click();
  await expect(page.locator("#inspector-body")).toBeHidden();
  await expectFrame(page, landscape);
  await page.locator('#inspector-head [data-act="fold"]').click();
  await expect(page.locator("#inspector-body")).toBeVisible();

  // A tablet in portrait: the labels go, the same two docks.
  const tablet = { width: 820, height: 1180 };
  await page.setViewportSize(tablet);
  await expectFrame(page, tablet);
  await expectTree(page, 226, true);
  const tabletInspector = await box(page.locator("#shell-inspector"));
  expect(tabletInspector.width).toBeCloseTo(268, 0);
  await expect(page.locator("#inspector-body")).toBeVisible();

  // A desktop: both docks open side by side, 248 and 290 px, the
  // inspector against the 300 px asset shelf at the window's right, the
  // labels shown, the scene between them 602 px wide.
  const desktop = { width: 1440, height: 900 };
  await page.setViewportSize(desktop);
  await expectFrame(page, desktop);
  await expectTree(page, 248, true);
  const inspector = await box(page.locator("#shell-inspector"));
  const shelf = await box(page.locator("#shell-shelf"));
  expect(shelf.x + shelf.width).toBe(1440);
  expect(shelf.width).toBe(300);
  expect(inspector).toMatchObject({
    x: shelf.x - 290,
    y: DOCK_TOP_PX,
    width: 290,
    height: 900 - 24 - DOCK_TOP_PX,
  });
  await expect(page.locator("#inspector-body")).toBeVisible();
  await expectFrame(page, desktop);
  await capture(page, test.info().outputPath("shell-1440x900.png"));
  // The stations: flush with the dock, one 28 px row each, no gap between
  // them (the explorer's rows); the row runs to the dock's 1 px border.
  const tree = await box(page.locator("#shell-tree"));
  const inner = await page
    .locator("#tree-body")
    .evaluate((el) => el.clientWidth);
  const rows = page.locator("#tree-body .card > .head");
  const first = await box(rows.nth(0));
  const second = await box(rows.nth(1));
  expect(first.x - tree.x).toBe(0);
  expect(first.width).toBe(inner);
  expect(tree.width - inner).toBeLessThanOrEqual(1);
  expect(first.height).toBe(28);
  expect(second.y - (first.y + first.height)).toBe(0);
});

/**
 * The bottom bar's toggles and the bottom panel they open, at one size:
 * the four named toggles side by side, flush with the asset shelf's toggle
 * at the bar's right edge; the panel on the bar, between the open docks
 * (or under both, spanned), left of the asset shelf, its
 * 30 px head with the tabs at its left, the map controls 14 px over it.
 * @param {import("@playwright/test").Page} page
 * @param {{ width: number, height: number }} size
 * @param {number} heightPx the panel's height at this size
 */
async function expectPanel(page, size, heightPx) {
  await shelfSettled(page);
  const at = `at ${String(size.width)} x ${String(size.height)}`;
  const bar = await box(page.locator("#shell-bar"));
  const toggles = page.locator("#shell-toggles .tog");
  await expect(toggles).toHaveCount(4);
  const boxes = [];
  for (const toggle of await toggles.all()) boxes.push(await box(toggle));
  for (const [i, b] of boxes.entries()) {
    expect(b.y, at).toBe(bar.y + 1);
    expect(b.height, at).toBe(23);
    if (i > 0) {
      expect(b.x, at).toBeCloseTo(boxes[i - 1].x + boxes[i - 1].width, 0);
    }
  }
  const last = boxes[boxes.length - 1];
  const assets = await box(page.locator("#shelf-toggle"));
  expect(assets.y, at).toBe(bar.y + 1);
  expect(last.x + last.width, at).toBeCloseTo(assets.x, 0);
  expect(assets.x + assets.width, at).toBeCloseTo(size.width, 0);
  // The credits and the selection's actions keep left of the toggles.
  for (const id of ["#view3d-credits", "#shell-acts"]) {
    const part = page.locator(id);
    if (!(await part.isVisible())) continue;
    const b = await box(part);
    expect(b.x + b.width, `${id} ${at}`).toBeLessThanOrEqual(boxes[0].x);
  }
  const panel = await box(page.locator("#shell-panel"));
  expect(panel.y + panel.height, at).toBeCloseTo(size.height - 24, 0);
  expect(panel.height, at).toBeCloseTo(heightPx, 0);
  const tree = page.locator("#shell-tree");
  const inspector = page.locator("#shell-inspector");
  const phone = size.width <= 700;
  // It pushes the view up: the view's canvas ends at its top, or on a
  // phone at the top of the sheet standing on it. Polled: the canvas takes
  // its size from a ResizeObserver, a callback after the layout the panel's
  // box is read from, which a busy page delays.
  let mapFoot = panel.y;
  if (phone) {
    const sheet = (await inspector.isVisible()) ? inspector : tree;
    if (await sheet.isVisible()) mapFoot = (await box(sheet)).y;
  }
  await expect
    .poll(async () => {
      const canvas = await box(page.locator("#view3d canvas.view3d-canvas"));
      return Math.abs(canvas.y + canvas.height - mapFoot);
    }, at)
    .toBeLessThan(0.5);
  const head = await box(page.locator("#shell-panel .bp-head"));
  expect(head.height, at).toBe(30);
  expect(head.y, at).toBeCloseTo(panel.y + 1, 0);
  const tab = await box(page.locator("#shell-panel .tab").first());
  expect(tab.x, at).toBeCloseTo(panel.x, 0);
  expect(tab.height, at).toBe(29);
  const close = await box(page.locator("#shell-panel .bp-close"));
  expect(close.x + close.width, at).toBeCloseTo(panel.x + panel.width - 4, 0);
  // Between the open docks, or the width on a phone.
  const open = async (/** @type {import("@playwright/test").Locator} */ d) =>
    (await d.isVisible()) &&
    !(await d.evaluate((el) => el.classList.contains("collapsed")));
  const spanned = await page
    .locator("#shell-panel")
    .evaluate((el) => el.classList.contains("span"));
  // The asset shelf at the window's right runs down to the bottom bar
  // beside the panel; spanned, the panel runs under it too (a phone's
  // shelf is a sheet of its own, closed here).
  const shelf = page.locator("#shell-shelf");
  const shelfShown = size.width > 700 && (await shelf.isVisible());
  let left = 0;
  let right = size.width;
  if (shelfShown) {
    const s = await box(shelf);
    expect(s.x + s.width, `the shelf ${at}`).toBeCloseTo(size.width, 0);
    if (!spanned) {
      expect(s.y + s.height, `the shelf ${at}`).toBeCloseTo(
        size.height - 24,
        0,
      );
      right = s.x;
    }
  }
  if (size.width > 700 && !spanned) {
    if (await open(tree)) {
      const t = await box(tree);
      left = t.x + t.width;
    }
    if (await open(inspector)) right = (await box(inspector)).x;
  }
  expect(panel.x, at).toBeCloseTo(left, 0);
  expect(panel.x + panel.width, at).toBeCloseTo(right, 0);
  // A dock the panel lies under ends at its top.
  for (const dock of [tree, inspector, ...(shelfShown ? [shelf] : [])]) {
    if (!(await open(dock))) continue;
    const d = await box(dock);
    const under = d.x < panel.x + panel.width && d.x + d.width > panel.x;
    if (under) expect(d.y + d.height, at).toBeCloseTo(panel.y, 0);
  }
  const compass = await box(page.locator("#compass"));
  if (!phone) {
    expect(panel.y - (compass.y + compass.height), at).toBeCloseTo(14, 0);
  }
}

test("the bottom bar's toggles open the bottom panel between the docks, at a phone, a phone in landscape, two laptop widths and a desktop", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const desktop = { width: 1440, height: 900 };
  await page.setViewportSize(desktop);
  await open3d(page);
  // Nothing to say before an edit: no badge on History.
  await expect(
    page.locator('#shell-toggles [data-tab="history"] .badge'),
  ).toBeHidden();
  await expect(page.locator("#shell-toggles .tog .tl").first()).toBeVisible();
  await card(page, "The old gate").locator(".pick").click();
  await expect(page.locator("#inspector-body")).toBeVisible();
  const problems = page.locator('#shell-toggles [data-tab="problems"]');
  await problems.click();
  await expect(problems).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#shell-panel")).toBeVisible();
  await expectPanel(page, desktop, 220);
  await page.screenshot({ path: test.info().outputPath("panel-1440x900.png") });
  // Spanned, it runs under every dock, which end at its top.
  await page.locator("#shell-panel .bp-span").click();
  await expectPanel(page, desktop, 220);
  await page.locator("#shell-panel .bp-span").click();

  // Two laptop widths: at 1180 px the tree is still 248 px, at 1024 px it
  // is 210 px (the 1100 px step), the panel still between both docks and
  // the toggles still clear of the selection's actions.
  for (const laptop of [
    { width: 1180, height: 820 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(laptop);
    await expectPanel(page, laptop, 220);
  }

  // A phone in landscape: between the two docks.
  const landscape = { width: 844, height: 390 };
  await page.setViewportSize(landscape);
  await expectPanel(page, landscape, 220);
  await page.screenshot({ path: test.info().outputPath("panel-844x390.png") });

  // A phone: the panel takes the width, the toggles keep their icons.
  const phone = { width: 390, height: 844 };
  await page.setViewportSize(phone);
  await expect(page.locator("#shell-toggles .tog .tl").first()).toBeHidden();
  await expectPanel(page, phone, 220);
  await page.screenshot({ path: test.info().outputPath("panel-390x844.png") });

  // Ctrl+J closes it, the map controls still at the map's top.
  await page.locator("#view3d").focus();
  await page.keyboard.press("Control+j");
  await expect(page.locator("#shell-panel")).toBeHidden();
  await expect(problems).toHaveAttribute("aria-pressed", "false");
  const compass = await box(page.locator("#compass"));
  expect(compass.y).toBe(VIEW_TOP_PX + 12);
});

test("a card's click selects, unfolds and flies; a second deselects and folds; a double click does not toggle", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open3d(page);
  const gate = card(page, "The old gate");
  const pick = gate.locator(".pick");
  const settled = async () => {
    await expect.poll(async () => (await view3d(page))?.flying).toBe(false);
  };

  // One click: selected, unfolded (its items listed), flown to.
  await pick.click();
  await expect(gate).toHaveClass(/\bsel\b/);
  await expect(gate.locator(".kids")).toBeVisible();
  await expect(
    page.locator('#shell-inspector [data-field="title"]'),
  ).toHaveValue("The old gate");
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
  await steps.locator(".pick").dblclick();
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
  await steps.locator(".pick").click();
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
  await viewCommand(page, "switch");
  await expect(page.locator("body")).toHaveAttribute("data-view", "2d");
  // Over the map the bottom bar keeps only the save status, said to a
  // screen reader; the panel's toggles are the 3D view's.
  await expect(page.locator("#save-status")).toHaveAttribute("role", "status");
  await expect(page.locator("#shell-toggles")).toBeHidden();
  await viewCommand(page, "switch");
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d");
  await expect(gate.locator(".kids")).toBeVisible();
  await expect(page.locator('#tree-body [data-layer="names"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("View's Top view and the zoom buttons drive the camera", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  // Top view and the zoom steps bring the map's tiles in: each one the
  // hosts answer must decode (a fixture tile that did not left the
  // browser rejecting every one, unseen).
  await keepRejections(page);
  await open3d(page);
  const settled = async () => {
    await expect.poll(async () => (await view3d(page))?.flying).toBe(false);
  };
  await settled();
  await viewCommand(page, "top");
  await expect(viewItem(page, "top")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#view-menu")).toBeHidden();
  await settled();
  expect((await view3d(page)).tiltDeg).toBeLessThan(1);
  await page.locator('#shell-toggles [data-tab="perf"]').click();
  await expect(page.locator("#shell-pane-perf .nums")).toContainText(
    "Top view",
  );
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

  // The Performance tab: the whole frame's draw calls, never 0 with a
  // tour drawn. This is the older 3D view (`openSampleIn3d`: `?globe=0`),
  // whose stats carry no globe; the globe view's whole-frame count against
  // its scene's own render is held in editor3d-globe.spec.js.
  await expect(page.locator("#shell-pane-perf .nums")).toContainText(
    /Draw calls[1-9]/,
  );
  expect((await view3d(page)).osm.requests).toBeGreaterThan(0);
  expect(await rejections(page)).toEqual([]);
});

/**
 * The page's own longest status line (a save that failed because the
 * opened file changed on disk): the line the bar must cut short.
 */
const LONGEST_STATUS =
  "Not saved: the opened file changed on disk and can no longer be read - open it again";

/**
 * The bar's most crowded state: the unsaved mark shown and the longest
 * status line in the bottom bar.
 * @param {import("@playwright/test").Page} page
 */
async function crowdTheBar(page) {
  await page.evaluate((line) => {
    const mark = /** @type {HTMLElement} */ (
      document.getElementById("unsaved-mark")
    );
    mark.hidden = false;
    const status = /** @type {HTMLElement} */ (
      document.getElementById("save-status")
    );
    status.dataset["state"] = "error";
    status.textContent = line;
  }, LONGEST_STATUS);
}

/** Where the top bar folds a step (`editor-shell.css`): each is checked
 *  at its edges. */
const FOLD_STEPS = [820, 720, 560, 420];

test("the top bar holds every control in its most crowded state, at every step it folds", async ({
  page,
}) => {
  // Why: the layout test saw only the sample's clean state, and a long
  // status line once pushed the bar's commands out of the window. The bar
  // folds in steps; each is checked at its edges with the unsaved mark
  // shown and the longest status, in a wide face, and every control shown
  // keeps its words. The crowded bar is the hardest case: without the
  // mark every control only has more room.
  test.setTimeout(300_000);
  await useWideFont(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open3d(page);
  // The page writes the status's words into its title too: cut short on
  // a narrow bar, the whole line still shows on hover.
  const status = page.locator("#save-status");
  await expect(status).toHaveAttribute(
    "title",
    (await status.textContent()) ?? "",
  );
  await crowdTheBar(page);
  // Each fold edge and the width just over it (the tightest the bar is
  // between two edges), and the widths of the two name-minimum edges'
  // band and below it (`editor-shell.css`: 440 and 375 px narrow the
  // name's minimum, so 390 is the tightest checked width under 420). A
  // width strictly inside a band has more room than that band's low end,
  // so 1440, 1280, 900 and 600 showed nothing the edges do not.
  const widths = [390, 320];
  for (const step of FOLD_STEPS) widths.push(step, step + 1);
  for (const width of widths.sort((a, b) => b - a)) {
    const size = { width, height: width < 721 ? 844 : 800 };
    await page.setViewportSize(size);
    await expectFrame(page, size);
    // The status line is said, not shown: it stays visually hidden (a
    // pixel, clipped) and keeps its live role at every width.
    const at = `the status at ${String(width)} px`;
    await expect(status, at).toHaveAttribute("role", "status");
    const hidden = await status.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        small: r.width <= 1 && r.height <= 1,
        clipped: style.clipPath !== "none" || style.clip !== "auto",
      };
    });
    expect(hidden, at).toEqual({ small: true, clipped: true });
  }
});

// Why: a fresh page opens the panel at half the view at most (at least
// 120 px, at most its usual height), as the chosen layout does, so a phone
// in landscape starts at half the view; the resize in the test above keeps
// the height the panel already had. Each size is its own fresh page with
// nothing selected: the screenshots are the side-by-side check against
// the chosen prototype.
test("the bottom panel opens at its start height on a fresh page, at a phone, a phone in landscape and a desktop", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  for (const size of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1440, height: 900 },
  ]) {
    const context = await browser.newContext({ viewport: size });
    const page = await context.newPage();
    await open3d(page);
    await page.locator('#shell-toggles [data-tab="problems"]').click();
    await expect(page.locator("#shell-panel")).toBeVisible();
    const main = await page
      .locator("#view3d")
      .evaluate((el) => el.clientHeight);
    const start = Math.max(
      90,
      Math.min(Math.min(220, Math.max(120, main * 0.5)), main),
    );
    await expectPanel(page, size, start);
    await page.screenshot({
      path: test
        .info()
        .outputPath(
          `panel-fresh-${String(size.width)}x${String(size.height)}.png`,
        ),
    });
    await context.close();
  }
});

// Why: a problem's row redraws the panel as it selects (the selection is
// marked); the focus once fell to the page, where Escape no longer closed
// the panel and the keyboard user lost their place.
test("the bottom panel keeps the keyboard focus through a choice, and Escape closes it", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open3d(page);
  // The sample has no problems; a new station has no content yet, which is
  // one. The first station is selected again so the Enter makes a choice.
  await page.locator("#tree-add").click();
  await expect(page.locator("#tree-body .card")).toHaveCount(4);
  await page.locator("#tree-body .card > .head").first().click();
  const toggle = page.locator('#shell-toggles [data-tab="problems"]');
  await toggle.click();
  const rows = page.locator("#shell-panel .prow");
  await expect(rows.first()).toBeVisible();
  await rows.first().focus();
  const chosen = await rows.first().getAttribute("data-select");
  await page.keyboard.press("Enter");
  await expect(
    page.locator(`#shell-panel .prow[data-select="${chosen ?? ""}"]`),
  ).toHaveClass(/\bsel\b/);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const at = document.activeElement;
        return at instanceof HTMLElement && at.closest("#shell-panel") !== null
          ? (at.dataset["select"] ?? at.className)
          : "outside";
      }),
    )
    .toBe(chosen);
  await page.keyboard.press("Escape");
  await expect(page.locator("#shell-panel")).toBeHidden();
  await expect(toggle).toBeFocused();
});

test("the File, Edit and View menus work from the keyboard and by touch", async ({
  page,
}) => {
  // Why: the bar's commands live in menus now; a menu that only a mouse
  // opens shuts out a keyboard, and one a tap cannot reach shuts out a
  // phone. The menu button pattern: Enter or ArrowDown opens on the first
  // item, the arrows move, Escape closes and gives the focus back.
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open3d(page);
  const fileButton = page.locator("#file-menu-btn");
  await expect(fileButton).toHaveAttribute("aria-haspopup", "menu");
  await expect(fileButton).toHaveAttribute("aria-expanded", "false");
  await fileButton.focus();
  await page.keyboard.press("Enter");
  await expect(fileButton).toHaveAttribute("aria-expanded", "true");
  await expect(fileItem(page, "open")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  // The last usable item: Share and publish (its item is enabled once a
  // tour is open).
  await expect(fileItem(page, "publish")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#file-menu")).toBeHidden();
  await expect(fileButton).toBeFocused();
  // Into View with the arrow: Top view first.
  const viewButton = page.locator("#view-menu-btn");
  await viewButton.focus();
  await page.keyboard.press("ArrowDown");
  await expect(viewItem(page, "top")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(viewItem(page, "top")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#view-menu")).toBeHidden();
  await expect(viewButton).toBeFocused();
  await page.keyboard.press("t");
  await expect(viewItem(page, "top")).toHaveAttribute("aria-checked", "false");
});

test("the credits panel opens above the bottom bar, inside the window, its lines wrapped at 390x844 and 1440x900", async ({
  page,
}) => {
  // Why: the bottom bar keeps its parts on one line (no wrap), and the
  // credits' panel opens out of the bar, so it inherited that: its
  // sources ran off as one long line each, cut or scrolled sideways. A
  // panel that is merely shown passes that; its box, its overflow and
  // its line count do not. One open, resized from a phone to a desktop.
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await open3d(page);
  const panel = page.locator("#view3d-credits .view3d-credits-panel");
  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width, height });
    if (!(await panel.isVisible())) {
      await page.locator("#view3d-credits .view3d-credits-button").click();
    }
    await expect(panel).toBeVisible();
    const at = `at ${String(width)}x${String(height)}`;
    const p = await box(panel);
    const bar = await box(page.locator("#shell-bar"));
    expect(p.y + p.height, at).toBeLessThanOrEqual(bar.y);
    expect(p.x, at).toBeGreaterThanOrEqual(0);
    expect(p.y, at).toBeGreaterThanOrEqual(0);
    expect(p.x + p.width, at).toBeLessThanOrEqual(width);
    const shape = await panel.evaluate((el) => {
      // Each text block's lines: its height over its line height; and
      // how wide its words would run on one line (measured nowrap).
      const blocks = [...el.querySelectorAll("li, p")].map((b) => {
        const style = getComputedStyle(b);
        const lines = Math.round(
          b.getBoundingClientRect().height /
            Number.parseFloat(style.lineHeight),
        );
        const probe = /** @type {HTMLElement} */ (b.cloneNode(true));
        probe.style.cssText =
          "position:absolute;visibility:hidden;white-space:nowrap;width:auto";
        el.append(probe);
        const oneLine = probe.getBoundingClientRect().width;
        probe.remove();
        return { lines, oneLine, room: b.getBoundingClientRect().width };
      });
      return {
        whiteSpace: getComputedStyle(el).whiteSpace,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        blocks,
      };
    });
    expect(shape.whiteSpace, at).toBe("normal");
    expect(shape.scrollWidth, at).toBeLessThanOrEqual(shape.clientWidth);
    // The full text takes more than one line, and every block too long
    // for the panel wraps onto as many lines as its words need.
    expect(
      shape.blocks.reduce((n, b) => n + b.lines, 0),
      JSON.stringify(shape.blocks),
    ).toBeGreaterThan(1);
    for (const b of shape.blocks) {
      if (b.oneLine > b.room + 1) {
        expect(b.lines, JSON.stringify(b)).toBeGreaterThan(1);
      }
    }
    await capture(
      page,
      test.info().outputPath(`credits-${String(width)}x${String(height)}.png`),
    );
  }
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });

  test("at a phone's width the menus open by a tap and Edit holds Undo and Redo", async ({
    page,
  }) => {
    // Why: at a phone's width the bar has no room for Undo and Redo in
    // words; they fold into an Edit menu instead of into bare icons. A tap
    // opens a menu, a tap on an item runs it and closes the menu, a tap
    // outside closes it.
    test.setTimeout(150_000);
    await useWideFont(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await open3d(page);
    await expect(page.locator("#studio-undo")).toBeHidden();
    const editButton = page.locator("#edit-menu-btn");
    await editButton.tap();
    await expect(page.locator("#edit-undo")).toBeVisible();
    await expect(page.locator("#edit-undo")).toBeDisabled();
    await expect(page.locator("#edit-redo")).toBeDisabled();
    // A tap outside closes it.
    await page
      .locator("#view3d canvas")
      .first()
      .tap({
        position: { x: 200, y: 150 },
      });
    await expect(page.locator("#edit-menu")).toBeHidden();
    // An edit through File's Tour details…, then Edit's Undo takes it back.
    await page.locator("#file-menu-btn").tap();
    await fileItem(page, "details").tap();
    await expect(page.locator("#file-menu")).toBeHidden();
    const name = page.locator("#details-name");
    const before = await name.inputValue();
    await name.fill("A renamed tour");
    await page.locator("#details-apply").tap();
    await expect(page.locator("#unsaved-mark")).toBeVisible();
    await editButton.tap();
    await expect(page.locator("#edit-undo")).toBeEnabled();
    await page.locator("#edit-undo").tap();
    await expect(page.locator("#edit-menu")).toBeHidden();
    await expect(page.locator("#tour-name")).toHaveText(before);
    await editButton.tap();
    await expect(page.locator("#edit-redo")).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(page.locator("#edit-menu")).toBeHidden();
  });
});

test("the unsaved mark shows beside File after an edit and goes with a save", async ({
  page,
}) => {
  // Why: the save status's words moved to the bottom bar; where a tour
  // lives only in the browser the top bar's mark is the one warning in
  // sight that work can be lost. It must come with the first edit and go
  // once the changes are saved.
  test.setTimeout(150_000);
  await page.addInitScript(() => {
    // @ts-expect-error - the save goes to a download the test waits for.
    delete window.showSaveFilePicker;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await open3d(page);
  const mark = page.locator("#unsaved-mark");
  await expect(mark).toBeHidden();
  // An edit: the tour's name, through the name's own button.
  await page.locator("#tour-name").click();
  await page.locator("#details-name").fill("A renamed tour");
  await page.locator("#details-apply").click();
  await expect(mark).toBeVisible();
  await expect(mark).toHaveAttribute(
    "title",
    (await page.locator("#save-status").textContent()) ?? "",
  );
  const mb = await box(mark);
  const fb = await box(page.locator("#file-menu-btn"));
  expect(mb.x).toBeGreaterThanOrEqual(fb.x + fb.width - 0.5);
  expect(mb.x - (fb.x + fb.width)).toBeLessThan(12);
  // The sample has no file of its own, and without a save dialog the
  // save downloads one.
  const download = page.waitForEvent("download");
  await save(page);
  await download;
  await expect(mark).toBeHidden({ timeout: 30_000 });
  await expect(page.locator("#save-status")).not.toHaveAttribute(
    "data-state",
    "pending",
  );
});

test("the tree can be used from the keyboard alone", async ({ page }) => {
  // Why: the cards and rows were plain boxes, out of the tab
  // order; a keyboard user could not select a station at all. Tab walks
  // the top bar left to right, then the tree's head and its cards; Enter
  // selects and flies, and the focus stays on the card it pressed.
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open3d(page);
  // From the start of the page: a click on the bar's empty corner puts
  // Tab's starting point there.
  await page.mouse.click(2, 2);
  const visited = [];
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press("Tab");
    const at = await page.evaluate(() => {
      const a = /** @type {HTMLElement} */ (document.activeElement);
      const b = a.getBoundingClientRect();
      return {
        key:
          a.dataset["select"] ??
          (a.dataset["unfold"] !== undefined
            ? `unfold:${a.dataset["unfold"]}`
            : a.dataset["add"] !== undefined
              ? `add:${a.dataset["add"]}`
              : a.id),
        inBar: a.closest("#topbar") !== null,
        x: b.x,
      };
    });
    visited.push(at);
    if (at.key === "station:gate") break;
  }
  const keys = visited.map((v) => v.key);
  expect(keys.at(-1)).toBe("station:gate");
  // The top bar first, left to right.
  const bar = visited.filter((v) => v.inBar);
  // The menus' buttons, not their items (a menu's items are reached with
  // the arrows inside it), then the studio's buttons and Help.
  expect(bar.map((v) => v.key)).toEqual(
    expect.arrayContaining([
      "file-menu-btn",
      "view-menu-btn",
      "tour-name",
      "studio-help",
    ]),
  );
  for (const v of bar)
    expect(v.key).not.toMatch(/^(file|view|edit)-(?!menu-btn)/);
  for (const [i, v] of bar.entries()) {
    if (i > 0) expect(v.x).toBeGreaterThan(bar[i - 1]?.x ?? 0);
  }
  // The bar is visited first; the next stop is the tree's head (the
  // scene's Credits button closes the view, after the docks).
  expect(visited.findIndex((v) => !v.inBar)).toBe(bar.length);
  expect(keys[bar.length]).toBe("tree-stations");
  // Then the tree: its head ("Stations", "Select", "Fold every station",
  // "+", the fold arrow), its search, then each card's fold arrow, its row
  // and its "+".
  expect(keys.slice(-11)).toEqual([
    "tree-stations",
    "tree-select",
    "tree-collapse",
    "tree-add",
    "tree-fold",
    "tree-search",
    "unfold:column",
    "station:column",
    "add:column",
    "unfold:gate",
    "station:gate",
  ]);
  await page.keyboard.press("Enter");
  const gate = card(page, "The old gate");
  await expect(gate).toHaveClass(/\bsel\b/);
  await expect(
    page.locator('#shell-inspector [data-field="title"]'),
  ).toHaveValue("The old gate");
  await expect(gate.locator(".pick")).toBeFocused();
  await expect(gate.locator(".kids")).toBeVisible();
  // The row's "+" is next; the fold arrow is before the row, and Space
  // on it folds the card's items away again.
  await page.keyboard.press("Tab");
  await expect(gate.locator(".head .add")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(gate.locator(".head .tw")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(gate.locator(".kids")).toHaveCount(0);
  await expect(gate.locator(".head .tw")).toBeFocused();
});

test("File's Add debug data opens the same add as the map's panel", async ({
  page,
}) => {
  // Why: the map's debug panel is hidden over the 3D view, so
  // "Add debug data" could not be reached there at all. File's item opens
  // the same file input and runs the same add: a file that is no debug
  // data is refused in the same words, and the item comes back idle.
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open3d(page);
  const add = fileItem(page, "debugAdd");
  await expect(page.locator("#debug-add")).toBeHidden();
  const sample = await (
    await page.request.get("/samples/marienplatz-tour.zip")
  ).body();
  const chooser = page.waitForEvent("filechooser");
  await fileCommand(page, "debugAdd");
  await (
    await chooser
  ).setFiles({
    name: "plain.zip",
    mimeType: "application/zip",
    buffer: sample,
  });
  await expect(
    page.locator(".toast", {
      hasText:
        "Not added: This file carries no recording: it is neither debug data nor a Recorder zip.",
    }),
  ).toBeVisible();
  await expect(add).toBeEnabled();
  await expect(add).toHaveText("Add debug data…");
});

test("a tap on the folded tree's Stations header opens the dock with its stations shown", async ({
  page,
}) => {
  // Why: the folded head's "Stations" header is the larger target. A tap
  // on it unfolded the dock and also closed the Stations section, so the
  // tree came back with every station hidden and seemed to have collapsed;
  // the next tap opened it. On a folded dock the header only unfolds.
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open3d(page);
  await page.locator("#tree-fold").click();
  await expect(page.locator("#shell-tree")).toHaveClass(/\bcollapsed\b/);
  await expect(page.locator("#tree-stations")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.locator("#tree-stations").click();
  await expect(page.locator("#shell-tree")).not.toHaveClass(/\bcollapsed\b/);
  await expect(page.locator("#tree-stations")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(card(page, "The old gate")).toBeVisible();
  // On an open dock the header still folds its section, as before.
  await page.locator("#tree-stations").click();
  await expect(page.locator("#tree-stations")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(card(page, "The old gate")).toHaveCount(0);
});

test("the tour's name carries a pen that opens its details, with no Details button and no mark", async ({
  page,
}) => {
  // Why: Details was a second copy of what the tour's name
  // already opens, and the "T" mark mere decoration. Both went; a pen
  // right of the name says it can be clicked, in both views (they share
  // the top bar). A pen elsewhere, or a Details button left behind, is
  // what this pins.
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await openSampleIn3d(page);
  await expect(page.locator("#studio-details")).toHaveCount(0);
  await expect(page.locator("#topbar .brand-mark")).toHaveCount(0);
  const name = page.locator("#tour-name");
  const text = await box(name.locator(".tour-name-text"));
  const pen = name.locator(".tour-name-pen svg.i");
  await expect(pen).toBeVisible();
  const penBox = await box(pen);
  // Right of the name, close beside it, on its line.
  expect(penBox.x).toBeGreaterThanOrEqual(text.x + text.width - 0.5);
  expect(penBox.x - (text.x + text.width)).toBeLessThan(12);
  expect(
    Math.abs(penBox.y + penBox.height / 2 - (text.y + text.height / 2)),
  ).toBeLessThanOrEqual(3);
  // The name is the button's words: the pen adds none.
  await expect(name).toHaveAccessibleName(
    (await name.locator(".tour-name-text").textContent()) ?? "",
  );
  // Hovered, the name does not underline: the studio's top bar (3D)
  // marks a hover by the pen alone, as its other controls.
  await name.hover();
  await expect(name.locator(".tour-name-text")).toHaveCSS(
    "text-decoration-line",
    "none",
  );
  await pen.click();
  await expect(page.locator("#details-modal")).toBeVisible();
});

test("the dialogs, their fields and the toasts wear the studio's dark dress; an item's name shows its pen and a dotted underline at rest", async ({
  page,
}) => {
  // Why: File > Tour details opened white over the dark editor (seen in
  // a field test), as did the open and the share dialogs: they took
  // the 2D map's paper tokens. A colour read on each dialog, a field in
  // it, its buttons and a toast is what tells a dark dress from a white
  // one; a presence check passes either. And an item's name in the
  // inspector's head is typed in place, but showed its box only on hover:
  // at rest it must say it can be edited (a pen and a dotted underline,
  // like the tour's name).
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await answerHosts(page);
  await page.goto("/edit.html?globe=0");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  // The open dialog, the editor's first screen.
  const openModal = page.locator("#open-modal .modal");
  await expect(openModal).toBeVisible();
  await expect(openModal).toHaveCSS("background-color", BG1);
  await expect(openModal).toHaveCSS("color", TEXT);
  await expect(page.locator("#link-input")).toHaveCSS("background-color", BG2);
  await expect(page.locator("#link-input")).toHaveCSS("color", TEXT);
  await expect(page.locator("#drop")).toHaveCSS("background-color", BG2);
  await expect(page.locator("#sample-btn")).toHaveCSS("color", TEXT);
  await openSampleIn3d(page);

  // Tour details, from the tour's name in the top bar.
  await page.locator("#tour-name").click();
  const details = page.locator("#details-modal .modal");
  await expect(details).toBeVisible();
  await expect(details).toHaveCSS("background-color", BG1);
  for (const field of ["#details-name", "#details-description"]) {
    await expect(page.locator(field)).toHaveCSS("background-color", BG2);
    await expect(page.locator(field)).toHaveCSS("color", TEXT);
  }
  // A cover choice is a dark field; the chosen one wears the accent's
  // soft wash instead (the first is chosen when the tour has a cover).
  await expect(
    page.locator(".cover-choice:not(:has(input:checked))").first(),
  ).toHaveCSS("background-color", BG2);
  await expect(page.locator(".cover-choice:has(input:checked)")).toHaveCSS(
    "background-color",
    "rgba(233, 162, 59, 0.14)",
  );
  await expect(page.locator("#details-cancel")).toHaveCSS(
    "background-color",
    BG2,
  );
  await expect(page.locator("#details-apply")).toHaveCSS(
    "background-color",
    ACCENT,
  );
  // The "No cover" words on their grey tile read at AA (4.5:1, small
  // text): they were about 4.0:1.
  const noCover = page.locator(".cover-thumb", { hasText: "No cover" });
  const noCoverColours = await noCover.evaluate((el) => {
    const c = getComputedStyle(el);
    return { fg: c.color, bg: c.backgroundColor };
  });
  expect(
    contrast(noCoverColours.fg, noCoverColours.bg),
    JSON.stringify(noCoverColours),
  ).toBeGreaterThanOrEqual(4.5);
  await capture(page, test.info().outputPath("details-dark.png"));
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();

  // Share and publish.
  await publish(page);
  const done = page.locator("#done-modal .modal");
  await expect(done).toBeVisible();
  await expect(done).toHaveCSS("background-color", BG1);
  await expect(page.locator("#done-host")).toHaveCSS("background-color", BG2);
  await page.locator("#done-close").click();
  await expect(done).toBeHidden();

  // A new pin: its toast dark, its name typed in the head, with the pen
  // and the dotted underline at rest.
  await card(page, "The old gate").locator(".pick").click();
  await card(page, "The old gate").locator(".head .add").click();
  await page.locator('#tree-add-menu [data-kind="shortText"]').click();
  const toast = page.locator(".toast", { hasText: "Added a pin" });
  await expect(toast).toBeVisible();
  await expect(toast).toHaveCSS("background-color", BG1);
  await expect(toast).toHaveCSS("color", TEXT);
  const name = page.locator("#shell-inspector .ttlin");
  await expect(name).toBeVisible();
  await capture(page, test.info().outputPath("pin-toast.png"));
  await name.evaluate((el) => /** @type {HTMLElement} */ (el).blur());
  await page.mouse.move(700, 450);
  const rest = await name.evaluate((el) => {
    const c = getComputedStyle(el);
    return {
      line: c.textDecorationLine,
      style: c.textDecorationStyle,
      pen: c.backgroundImage,
      padRight: Number.parseFloat(c.paddingRight),
    };
  });
  expect(rest.line).toBe("underline");
  expect(rest.style).toBe("dotted");
  expect(rest.pen).toMatch(/^url\("data:image\/svg\+xml/);
  // The pen sits in the field's right padding, clear of the text.
  expect(rest.padRight).toBeGreaterThanOrEqual(18);
  // Typing in it, only the field's own frame shows: no pen, no underline.
  await name.focus();
  const typing = await name.evaluate((el) => {
    const c = getComputedStyle(el);
    return { line: c.textDecorationLine, pen: c.backgroundImage };
  });
  expect(typing).toEqual({ line: "none", pen: "none" });
});
