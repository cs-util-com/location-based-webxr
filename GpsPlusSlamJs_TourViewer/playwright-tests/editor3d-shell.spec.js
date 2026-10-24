// @ts-check
import { expect, test } from "@playwright/test";

import {
  afterFrames,
  answerHosts,
  keepRejections,
  openSample,
  rejections,
  view3d,
} from "./editor3d-fixture.js";
import { useWideFont } from "./wide-font.js";

/**
 * Why these tests matter: the 3D view's studio shell is a layout over the
 * scene - a 40 px top bar, a 24 px bottom bar, the tree dock flush left,
 * the inspector flush right, the map controls at the bottom left - and a
 * presence check passes a broken one. These pin positions, sizes and gaps
 * at a phone, a phone in landscape, a tablet in portrait and a desktop,
 * the narrow-window rule (below 900 px one dock at a time), every top-bar
 * control inside the window and none over another, the tour's name never
 * squeezed away - also in the bar's most crowded state, at every step it
 * folds, in a wide face; the tree from the keyboard alone, the top bar's
 * Add debug data, a flight leaving no coast behind; and the tree's click
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

/**
 * The layout every viewport shares: the bars, the viewport between them,
 * the map controls, and the top bar's controls in a row inside it, the
 * tour's name no narrower than its floor.
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
  // Read in one go (as Playwright's isVisible does: a box, not hidden):
  // the crowded sweep checks 34 frames.
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll("#topbar :is(button, #save-status, label)")]
      .map((c) => ({ c, r: c.getBoundingClientRect() }))
      .filter(
        ({ c, r }) =>
          r.width > 0 &&
          r.height > 0 &&
          getComputedStyle(c).visibility !== "hidden",
      )
      .map(({ r }) => ({ x: r.x, y: r.y, width: r.width, height: r.height })),
  );
  shown.sort((a, b) => a.x - b.x);
  const at = `at ${String(size.width)} px`;
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
  const name = await box(page.locator("#topbar .brand-text"));
  expect(name.width, `the name ${at}`).toBeGreaterThanOrEqual(
    nameFloorPx(size.width),
  );
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
  await useWideFont(page);
  // A phone: the tree starts folded; opening it and selecting a station
  // opens the inspector and folds the tree again.
  const phone = { width: 390, height: 844 };
  await page.setViewportSize(phone);
  await open3d(page);
  await expectFrame(page, phone);
  // Folded, the tree's head keeps clear of where the inspector opens, so
  // its fold arrow can still be tapped while a selection shows.
  const phoneHead = Math.min(272, 0.56 * 390, 390 - Math.min(290, 0.6 * 390));
  await expectTree(page, phoneHead, false);
  await expect(page.locator("#shell-inspector")).toBeHidden();
  await page.locator("#tree-fold").click();
  await expectTree(page, Math.min(272, 0.56 * 390), true);
  await card(page, "The old gate").locator(".hero").click();
  const phoneInspector = await box(page.locator("#shell-inspector"));
  expect(phoneInspector.x + phoneInspector.width).toBeCloseTo(390, 0);
  expect(phoneInspector.y).toBe(40);
  expect(phoneInspector.width).toBeCloseTo(Math.min(290, 0.6 * 390), 0);
  await expectTree(page, phoneHead, false);
  const phoneFold = await box(page.locator("#tree-fold"));
  expect(phoneFold.x + phoneFold.width).toBeLessThanOrEqual(phoneInspector.x);

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
  // Top view and the zoom steps bring the map's tiles in: each one the
  // hosts answer must decode (a fixture tile that did not left the
  // browser rejecting every one, unseen).
  await keepRejections(page);
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
 * The bar's most crowded state: the keep-walk switch shown (a tour opened
 * with its walk) and the longest status line.
 * @param {import("@playwright/test").Page} page
 */
async function crowdTheBar(page) {
  await page.evaluate((line) => {
    const keep = /** @type {HTMLElement} */ (
      document.getElementById("keep-walk")
    );
    keep.hidden = false;
    const status = /** @type {HTMLElement} */ (
      document.getElementById("save-status")
    );
    status.dataset["state"] = "error";
    status.textContent = line;
  }, LONGEST_STATUS);
}

test("the top bar holds every control in its most crowded state, at every step it folds", async ({
  page,
}) => {
  // Why: the layout test saw only the sample's clean state, and
  // the keep-walk switch or a long status line pushed Done and Open out of
  // the bar at 1024, 900 and 390 px. The bar folds in steps (1420, 1140,
  // 940, 720, 440 and 375 px); each is checked at its edges with the
  // switch shown and the longest status, in a wide face. The crowded bar
  // is the hardest case: without the switch, or with a shorter status,
  // every control only has more room.
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
  for (const width of [
    1440, 1421, 1420, 1141, 1140, 1024, 941, 940, 900, 821, 720, 441, 440, 390,
    376, 375, 320,
  ]) {
    const size = { width, height: width < 721 ? 844 : 800 };
    await page.setViewportSize(size);
    await expectFrame(page, size);
  }
  // Folded to its checkbox, the keep-walk switch keeps its name.
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(
    page.getByRole("checkbox", {
      name: "Keep the debug data in the tour file",
    }),
  ).toBeVisible();
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
  // Tab's starting point there (a blur would leave it at the view switch
  // the 3D view was opened with).
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
          (a.dataset["unfold"] === undefined
            ? a.id
            : `unfold:${a.dataset["unfold"]}`),
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
  expect(bar.map((v) => v.key)).toContain("studio-frame");
  expect(bar.map((v) => v.key)).toContain("open-another");
  for (const [i, v] of bar.entries()) {
    if (i > 0) expect(v.x).toBeGreaterThan(bar[i - 1]?.x ?? 0);
  }
  // The bar is visited first; the next stop is the tree's head (the
  // scene's credits close the view, after the docks).
  expect(visited.findIndex((v) => !v.inBar)).toBe(bar.length);
  expect(keys[bar.length]).toBe("tree-stations");
  // Then the tree: its head, then the first card and its fold arrow.
  expect(keys.slice(-5)).toEqual([
    "tree-stations",
    "tree-fold",
    "station:column",
    "unfold:column",
    "station:gate",
  ]);
  await page.keyboard.press("Enter");
  const gate = card(page, "The old gate");
  await expect(gate).toHaveClass(/\bsel\b/);
  await expect(page.locator("#inspector-head .ttl")).toHaveText("The old gate");
  await expect(gate.locator(".pick")).toBeFocused();
  await expect(gate.locator(".kids")).toBeVisible();
  // Space on the fold arrow folds the card's items away again.
  await page.keyboard.press("Tab");
  await expect(gate.locator(".tw")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(gate.locator(".kids")).toHaveCount(0);
  await expect(gate.locator(".tw")).toBeFocused();
});

test("the top bar's Add debug data opens the same add as the map's panel", async ({
  page,
}) => {
  // Why: the map's debug panel is hidden over the 3D view, so
  // "Add debug data" could not be reached there at all. The top bar's
  // button opens the same file input and runs the same add: a file that
  // is no debug data is refused in the same words, and the button comes
  // back idle.
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open3d(page);
  const add = page.locator("#studio-debug-add");
  await expect(add).toBeVisible();
  await expect(page.locator("#debug-add")).toBeHidden();
  const sample = await (
    await page.request.get("/samples/marienplatz-tour.zip")
  ).body();
  const chooser = page.waitForEvent("filechooser");
  await add.click();
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
  await expect(add).toHaveAttribute("aria-label", "Add debug data…");
});

test("a flight ends the orbit's coast: the camera stays where it lands", async ({
  page,
}) => {
  // Why: the orbit coasts on after a drag; a flight started
  // straight after one must not hand the coast back when it lands, or the
  // camera drifts on from the station it flew to.
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open3d(page);
  const canvas = page.locator("#view3d canvas").first();
  const b = await box(canvas);
  const [cx, cy] = [b.x + b.width / 2, b.y + b.height / 2];
  // A quick drag: it leaves the orbit coasting.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) await page.mouse.move(cx + i * 40, cy);
  await page.mouse.up();
  await card(page, "The old gate").locator(".hero").click();
  await expect.poll(async () => (await view3d(page))?.flying).toBe(false);
  // The coast decays frame by frame (the orbit's damping runs per
  // update), so the check counts drawn frames, not time.
  const { camera: landed } = await view3d(page);
  await afterFrames(page, 30);
  const after = (await view3d(page)).camera;
  expect(Math.hypot(...after.map((v, i) => v - landed[i]))).toBeLessThan(1e-3);
});
