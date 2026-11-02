// @ts-check
import { expect, test } from "@playwright/test";

import {
  afterFrames,
  answerHosts,
  keepRejections,
  noApproach,
  rejections,
  view3d,
} from "./editor3d-fixture.js";

/**
 * Why these tests matter: a tour opened in the globe view flies in from
 * high above, a full-width bar glued under the menu bar following the
 * camera's fall, "Loading tour" on a tab hanging from its middle. The owner's rules for it:
 * the creator's own input in the 3D view takes the camera at once, where
 * it is; the list and the panel stay usable while it flies (a pick in the
 * list sends the flight there, typing leaves it alone); the box goes a
 * beat after the landing, whatever still loads (he dropped the detail
 * line that used to stay for it); a restored
 * draft goes straight to the tour. A swallowed input or a bar sitting
 * over the docks is exactly what these pin.
 */

/**
 * The approach's state from the view's stats.
 * @param {import("@playwright/test").Page} page
 */
async function approachOf(page) {
  const stats = await view3d(page);
  return stats?.globe?.approach ?? null;
}

/**
 * Set the next approach's length (ms) before the page loads; the arrival
 * keeps its own timings.
 * @param {import("@playwright/test").Page} page
 * @param {number} durationMs
 */
async function approachLasting(page, durationMs) {
  await page.addInitScript(
    (knob) => {
      /** @type {any} */ (window).__tourEditorApproach = knob;
    },
    { durationMs },
  );
}

/**
 * Open the sample tour on the globe view; the approach starts with it.
 * @param {import("@playwright/test").Page} page
 */
async function openSampleOnGlobe(page) {
  await page.goto("/edit.html?globe=1");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator("#sample-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 120_000,
  });
}

/**
 * A box from a locator, or a throw when it is not laid out.
 * @param {import("@playwright/test").Locator} locator
 */
async function box(locator) {
  const b = await locator.boundingBox();
  if (b === null) throw new Error("not laid out");
  return b;
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

/** The top bar's height, the loading bar's, its tab's, and the gap from
 *  the tab down to the docks (`editor-shell.css`). */
const TOP_PX = 40;
const BAR_PX = 5;
const TAB_PX = 22;
const DOCK_GAP_PX = 8;

for (const [width, height] of [
  [1440, 900],
  [1280, 720],
  [1024, 768],
  [844, 390],
  [390, 844],
]) {
  test(`the bar is glued under the menu bar, its tab hanging in the middle, the docks under both at ${width}x${height}`, async ({
    page,
  }) => {
    // Why: the owner asked for a full-width bar glued under the menu bar,
    // thick enough to see, "Loading tour" as a rounded tab hanging from
    // its middle like a bulge, and the rail and the inspector lowered
    // under both with a gap. Positions and gaps are what make that read;
    // a presence check passes a bar floating in the view, a tab off
    // centre, or a dock under the tab. The phone sizes (landscape and
    // portrait) hold the bar and the tab as at a desktop; there one dock
    // shows at a time (`dock-rule.ts`), so only the shown dock is checked.
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height });
    await answerHosts(page, { globeAssets: "serve" });
    await approachLasting(page, 600_000);
    await openSampleOnGlobe(page);
    const approach = page.locator("#view3d .approach");
    await expect(approach).toBeVisible();
    const bar = await box(approach.locator(".approach-track"));
    const tab = await box(approach.locator(".approach-title"));
    await expect(approach.locator(".approach-title")).toHaveText(
      "Loading tour",
    );
    // The bar: the window's full width, right under the menu bar.
    expect(bar).toEqual({ x: 0, y: TOP_PX, width, height: BAR_PX });
    // The tab: hanging from the bar's bottom, centred, rounded below only.
    expect(tab.y).toBeCloseTo(TOP_PX + BAR_PX, 0);
    expect(tab.height).toBeCloseTo(TAB_PX, 0);
    expect(Math.abs(tab.x + tab.width / 2 - width / 2)).toBeLessThanOrEqual(1);
    expect(tab.width).toBeGreaterThan(80);
    expect(tab.width).toBeLessThan(200);
    const corners = await approach.locator(".approach-title").evaluate((el) => {
      const c = getComputedStyle(el);
      return [c.borderTopLeftRadius, c.borderBottomLeftRadius];
    });
    expect(corners[0]).toBe("0px");
    expect(parseFloat(corners[1] ?? "0")).toBeGreaterThan(6);
    // The docks: open the tree, then pick a station (the inspector
    // shows); each shown dock flush with its side, the gap under the tab.
    // Below 820 px a dock takes at most about half the width
    // (`editor-shell.css`, narrow windows).
    if (!(await page.locator("#tree-body").isVisible())) {
      await page.locator("#tree-fold").click();
    }
    await page.locator("#tree-body .card .pick").first().click();
    await expect(page.locator("#inspector-body")).toBeVisible();
    const narrow = width <= 820;
    const docks = [
      {
        id: "#shell-tree",
        body: "#tree-body",
        left: true,
        widthPx: narrow ? Math.min(272, width * 0.56) : 272,
      },
      {
        id: "#shell-inspector",
        body: "#inspector-body",
        left: false,
        widthPx: narrow ? Math.min(290, width * 0.6) : 290,
      },
    ];
    const dockTop = TOP_PX + BAR_PX + TAB_PX + DOCK_GAP_PX;
    let shown = 0;
    for (const dock of docks) {
      if (!(await page.locator(dock.body).isVisible())) continue;
      shown++;
      const d = await box(page.locator(dock.id));
      if (dock.left) expect(d.x, dock.id).toBe(0);
      else expect(d.x + d.width, dock.id).toBeCloseTo(width, 0);
      expect(d.y, dock.id).toBeCloseTo(dockTop, 0);
      expect(d.y - (tab.y + tab.height), dock.id).toBeCloseTo(DOCK_GAP_PX, 0);
      expect(d.width, dock.id).toBeCloseTo(dock.widthPx, 0);
      expect(overlaps(d, bar), dock.id).toBe(false);
      expect(overlaps(d, tab), dock.id).toBe(false);
    }
    // Both from 900 px up (the dock rule's side by side), else one.
    expect(shown).toBe(width >= 900 ? 2 : 1);
    // Neither takes a pointer: a drag that starts on them reaches the view.
    await expect(approach).toHaveCSS("pointer-events", "none");
    await page.screenshot({
      path: test.info().outputPath(`approach-${width}x${height}.png`),
    });
  });
}

test("the bar is a progressbar with a value, under the box's title", async ({
  page,
}) => {
  // Why: a screen reader user hears that the tour is loading and how far.
  test.setTimeout(180_000);
  await answerHosts(page, { globeAssets: "serve" });
  await approachLasting(page, 600_000);
  await openSampleOnGlobe(page);
  const track = page.locator("#view3d .approach-track");
  await expect(track).toHaveAttribute("role", "progressbar");
  await expect(track).toHaveAttribute("aria-valuemin", "0");
  await expect(track).toHaveAttribute("aria-valuemax", "100");
  await expect(track).toHaveAttribute("aria-valuenow", /^\d+$/);
  // The box speaks through its bar alone: the detail line (a live region)
  // is gone. Scoped to the box: the shell's own messages (#shell-said) are
  // another live region in the view.
  const approachBox = page.locator("#view3d .approach");
  await expect(approachBox).toHaveCount(1);
  await expect(approachBox.locator('[role="status"], [aria-live]')).toHaveCount(
    0,
  );
  await expect(page.locator("#view3d .approach-title")).toHaveText(
    "Loading tour",
  );
  const stats = await approachOf(page);
  expect(stats).toMatchObject({ flying: true, durationMs: 600_000 });
});

test("a drag in the 3D view takes the camera where it is; typing in the panel and a pick in the list do not", async ({
  page,
}) => {
  // Why: the creator must never lose an input to the flight. The list
  // and the panel stay usable while it flies: a pick in the list sends
  // the flight to that station, typing in the panel leaves the flight
  // alone, and a drag in the view stops it at once, the camera kept.
  test.setTimeout(240_000);
  await answerHosts(page, { globeAssets: "serve" });
  await keepRejections(page);
  await approachLasting(page, 600_000);
  await openSampleOnGlobe(page);
  await afterFrames(page, 3);
  expect(await approachOf(page)).toMatchObject({ flying: true, retargets: 0 });

  // The rail is a tab while it flies; the creator opens it.
  await page.locator("#tree-fold").click();
  await page.locator("#tree-body .card .pick").first().click();
  await expect.poll(async () => (await approachOf(page))?.retargets).toBe(1);
  expect((await approachOf(page)).flying).toBe(true);

  const description = page
    .locator("#shell-inspector")
    .getByLabel("Description", { exact: true });
  await description.fill("Typed while it flies");
  await afterFrames(page, 2);
  expect((await approachOf(page)).flying).toBe(true);

  const canvas = await box(page.locator("#view3d canvas"));
  const x = canvas.x + canvas.width / 2;
  const y = canvas.y + canvas.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const taken = await view3d(page);
  await page.mouse.move(x + 40, y + 10, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await approachOf(page))?.ended).toBe("taken");
  const after = await approachOf(page);
  expect(after.flying).toBe(false);
  // Kept where it was taken: the camera did not jump to the street.
  expect((await view3d(page)).globe.altitudeM).toBeGreaterThan(
    taken.globe.altitudeM * 0.5,
  );
  await expect(page.locator("#view3d .approach")).toBeHidden();
  expect(await rejections(page)).toEqual([]);
});

test("the box goes after the bar's done-hold while tiles are still held", async ({
  page,
}) => {
  // Why: the box used to stay after the landing for as long as the relief
  // still loaded, under a line saying so; the owner dropped the line, and
  // the box's end is now the bar's own (a beat after the landing). The
  // relief's tiles are held here so that loading is still under way when
  // the box must go: a box kept by what loads would stay over the view.
  test.setTimeout(240_000);
  /** @type {(() => void)[]} */
  const held = [];
  let holding = true;
  await answerHosts(page, { globeAssets: "serve" });
  await page.route("https://tiles.mapterhorn.com/**", async (route) => {
    if (holding) {
      await new Promise((resolve) => held.push(() => resolve(undefined)));
    }
    return route.fallback();
  });
  // Every held tile goes through however the checks end: a failed check
  // must not leave route handlers waiting on promises nobody resolves.
  try {
    await approachLasting(page, 3_000);
    await openSampleOnGlobe(page);
    await expect(page.locator("#view3d .approach")).toBeVisible();
    await expect
      .poll(() => held.length, { timeout: 60_000 })
      .toBeGreaterThan(0);
    // The flight lands (the run's stats outlive it, so this reads the
    // landing even after the box is gone), and not by a takeover.
    await expect
      .poll(async () => (await approachOf(page))?.ended ?? null, {
        timeout: 60_000,
      })
      .toBe("landed");
    // Then the box goes within a beat of it (BAR_DONE_MS, 300 ms, plus
    // frames under a loaded machine), not when the held tiles finally load:
    // the wait starts at the landing, so a box kept by what loads fails
    // here rather than passing under a long timeout.
    await expect(page.locator("#view3d .approach")).toBeHidden({
      timeout: 5_000,
    });
    // Still held: the box went while the relief was loading.
    expect(held.length).toBeGreaterThan(0);
    expect(holding).toBe(true);
    const run = await approachOf(page);
    expect(run?.ended).toBe("landed");
  } finally {
    holding = false;
    for (const release of held.splice(0)) release();
  }
  // The stations popped in and their rings went.
  await expect
    .poll(async () => (await view3d(page)).globe.marks.rings, {
      timeout: 60_000,
    })
    .toBe(0);
  await expect.poll(async () => (await view3d(page)).stations).toBe(3);
});

test("the flight lands close to the tour, looking steeply down, and moves the view's frame only by its recentring", async ({
  page,
}) => {
  // Why: the owner's meteor ends close to the tour at its landing angle
  // (50 degrees below the horizon by default, 150 m over the ground: about
  // 196 m from the tour), with no settle or tilt of the editor's own. And
  // the frame: the old approach set the view's frame from the camera's
  // pose every frame, which flickered; now only the view's own recentring
  // moves it (plus the first placement at the tour).
  test.setTimeout(240_000);
  await answerHosts(page, { globeAssets: "serve" });
  await approachLasting(page, 6_000);
  await openSampleOnGlobe(page);
  await expect
    .poll(async () => (await approachOf(page))?.ended ?? null, {
      timeout: 60_000,
    })
    .toBe("landed");
  const landed = await view3d(page);
  expect(landed.distanceM).toBeLessThan(400);
  // Tilt from straight down: 90 less the 50 degrees below the horizon.
  expect(landed.tiltDeg).toBeGreaterThan(35);
  expect(landed.tiltDeg).toBeLessThan(45);
  expect(landed.globe.frameChanges).toBeLessThanOrEqual(
    landed.globe.recentres + 2,
  );
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("there is no flight: the view cuts to the landing", async ({ page }) => {
    // Why: a creator who asked for less motion still gets the tour, in a
    // cut to the flight's end view (no flight at all) and a short arrival.
    test.setTimeout(180_000);
    await answerHosts(page, { globeAssets: "serve" });
    await openSampleOnGlobe(page);
    await expect
      .poll(async () => (await approachOf(page))?.ended ?? null)
      .toBe("landed");
    expect((await approachOf(page))?.durationMs).toBe(0);
    expect((await view3d(page)).distanceM).toBeLessThan(400);
  });

  test("the rail unfolds at the landing without its animation", async ({
    page,
  }) => {
    // Why: reduced motion skips the rail's unfolding animation, never the
    // unfold itself.
    test.setTimeout(180_000);
    await answerHosts(page, { globeAssets: "serve" });
    await recordAnimations(page);
    await openSampleOnGlobe(page);
    await expect
      .poll(async () => (await approachOf(page))?.ended ?? null, {
        timeout: 60_000,
      })
      .toBe("landed");
    await expect(page.locator("#tree-body")).toBeVisible({ timeout: 5_000 });
    expect(await animationsOf(page)).not.toContain("dock-unfold");
  });
});

/**
 * Record the names of the page's CSS animations as they start.
 * @param {import("@playwright/test").Page} page
 */
async function recordAnimations(page) {
  await page.addInitScript(() => {
    /** @type {any} */ (window).__animations = [];
    document.addEventListener(
      "animationstart",
      (event) => {
        /** @type {any} */ (window).__animations.push(event.animationName);
      },
      true,
    );
  });
}

/**
 * The names of the animations started so far.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string[]>}
 */
async function animationsOf(page) {
  return page.evaluate(() => /** @type {any} */ (window).__animations ?? []);
}

test("the rail is a tab during the flight, unfolds with an animation at the landing and stays open on zoom-out", async ({
  page,
}) => {
  // Why: the owner wants the flight to have the view: the rail is folded
  // while it flies and opens, animated, when the bar finishes. After that
  // it is the creator's: zooming out never folds it again.
  test.setTimeout(240_000);
  await answerHosts(page, { globeAssets: "serve" });
  await recordAnimations(page);
  await approachLasting(page, 6_000);
  await openSampleOnGlobe(page);
  await expect(page.locator("#view3d .approach")).toBeVisible();
  await expect(page.locator("#shell-tree")).toHaveClass(/\bcollapsed\b/);
  await expect(page.locator("#tree-body")).toBeHidden();
  expect(await animationsOf(page)).not.toContain("dock-unfold");
  await expect
    .poll(async () => (await approachOf(page))?.ended ?? null, {
      timeout: 60_000,
    })
    .toBe("landed");
  await expect(page.locator("#tree-body")).toBeVisible({ timeout: 5_000 });
  await expect
    .poll(() => animationsOf(page), { timeout: 5_000 })
    .toContain("dock-unfold");
  const canvas = await box(page.locator("#view3d canvas"));
  await page.mouse.move(
    canvas.x + canvas.width / 2,
    canvas.y + canvas.height / 2,
  );
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 600);
  await afterFrames(page, 10);
  await expect(page.locator("#tree-body")).toBeVisible();
  await expect(page.locator("#shell-tree")).not.toHaveClass(/\bcollapsed\b/);
});

test("a view opened without the approach starts with the rail open", async ({
  page,
}) => {
  // Why: only the approach folds the rail; any other open shows it as
  // the creator left it.
  test.setTimeout(180_000);
  await answerHosts(page, { globeAssets: "serve" });
  await recordAnimations(page);
  await noApproach(page);
  await openSampleOnGlobe(page);
  await expect(page.locator("#tree-body")).toBeVisible();
  await afterFrames(page, 3);
  expect(await animationsOf(page)).not.toContain("dock-unfold");
});

test("a restored draft goes straight to the tour, without the approach", async ({
  page,
  context,
}) => {
  // Why: a creator coming back to unsaved work wants it at once; the
  // flight is for a tour opened afresh.
  test.setTimeout(300_000);
  await answerHosts(page, { globeAssets: "serve" });
  await noApproach(page);
  await openSampleOnGlobe(page);
  await page.locator("#tree-body .card .pick").first().click();
  const description = page
    .locator("#shell-inspector")
    .getByLabel("Description", { exact: true });
  await description.fill("Kept in the browser");
  await description.press("Tab");
  await expect(page.locator("body")).toHaveAttribute("data-draft", "saved");
  await page.close();

  const next = await context.newPage();
  await answerHosts(next, { globeAssets: "serve" });
  await openSampleOnGlobe(next);
  await expect(next.locator(".toast.draft-offer")).toBeVisible();
  await afterFrames(next, 3);
  expect(await approachOf(next)).toBeNull();
  await expect(next.locator("#view3d .approach")).toHaveCount(0);
  expect((await view3d(next)).flying).toBe(false);
});
