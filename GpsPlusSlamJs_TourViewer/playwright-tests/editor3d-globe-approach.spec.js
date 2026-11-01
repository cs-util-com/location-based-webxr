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
 * high above, "Loading tour" over a thin bar at the top following the
 * camera's fall. The owner's rules for it:
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

for (const [width, height] of [
  [1440, 900],
  [1024, 768],
  [844, 390],
  [390, 844],
]) {
  test(`the bar sits at the top of the view between the docks at ${width}x${height}`, async ({
    page,
  }) => {
    // Why: the owner chose a minimal bar at the top of the view, never a
    // modal over the chrome. Its place, its gaps and its distance from
    // the docks are what made the prototype read as quiet; a bar over a
    // dock hides the list a creator may use while it flies.
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height });
    await answerHosts(page, { globeAssets: "serve" });
    await approachLasting(page, 600_000);
    await openSampleOnGlobe(page);
    const bar = page.locator("#view3d .approach");
    await expect(bar).toBeVisible();
    const viewBox = await box(page.locator("#view3d"));
    const barBox = await box(bar);
    const titleBox = await box(bar.locator(".approach-title"));
    const trackBox = await box(bar.locator(".approach-track"));
    const narrow = width <= 820;
    // The fixed title over the bar, and nothing under it.
    await expect(bar.locator(".approach-title")).toHaveText("Loading tour");
    expect(trackBox.y - (titleBox.y + titleBox.height)).toBeCloseTo(
      narrow ? 3 : 4,
      0,
    );
    expect(barBox.y - viewBox.y).toBeCloseTo(narrow ? 42 : 10, 0);
    expect(
      Math.abs(barBox.x + barBox.width / 2 - (viewBox.x + viewBox.width / 2)),
    ).toBeLessThanOrEqual(1);
    expect(trackBox.height).toBeCloseTo(4, 0);
    await expect(bar.locator(".approach-line")).toHaveCount(0);
    for (const dock of ["#shell-tree", "#shell-inspector"]) {
      const d = page.locator(dock);
      if (!(await d.isVisible())) continue;
      expect(overlaps(barBox, await box(d)), dock).toBe(false);
    }
    // It takes no pointer: a drag that starts on it reaches the view.
    await expect(bar).toHaveCSS("pointer-events", "none");
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

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the flight is short", async ({ page }) => {
    // Why: a creator who asked for less motion still gets the tour, in a
    // short flight and a short arrival.
    test.setTimeout(180_000);
    await answerHosts(page, { globeAssets: "serve" });
    await openSampleOnGlobe(page);
    await expect
      .poll(async () => (await approachOf(page))?.durationMs)
      .toBe(2_000);
  });
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
