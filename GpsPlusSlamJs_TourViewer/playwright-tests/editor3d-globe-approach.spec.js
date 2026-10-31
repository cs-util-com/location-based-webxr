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
 * high above, a thin bar at the top following the camera's fall and one
 * quiet line under it naming what still loads. The owner's rules for it:
 * the creator's own input in the 3D view takes the camera at once, where
 * it is; the list and the panel stay usable while it flies (a pick in the
 * list sends the flight there, typing leaves it alone); the line stays
 * after the landing while anything still loads, then goes; a restored
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
 * Set the next approach's length (ms) before the page loads; the line and
 * the arrival keep their own timings.
 * @param {import("@playwright/test").Page} page
 * @param {number} durationMs
 */
async function approachLasting(page, durationMs) {
  await page.addInitScript((ms) => {
    /** @type {any} */ (window).__tourEditorApproach = { durationMs: ms };
  }, durationMs);
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
    const lineBox = await box(bar.locator(".approach-line"));
    const narrow = width <= 820;
    // The fixed title over the bar, the detail line under it.
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
    expect(lineBox.y - (trackBox.y + trackBox.height)).toBeCloseTo(
      narrow ? 3 : 5,
      0,
    );
    for (const dock of ["#shell-tree", "#shell-inspector"]) {
      const d = page.locator(dock);
      if (!(await d.isVisible())) continue;
      expect(overlaps(barBox, await box(d)), dock).toBe(false);
    }
    // It takes no pointer: a drag that starts on it reaches the view.
    await expect(bar).toHaveCSS("pointer-events", "none");
  });
}

test("the bar is a progressbar with a value and the line a polite status", async ({
  page,
}) => {
  // Why: a screen reader user hears that the tour is loading and how far,
  // and the line's change of words without being interrupted.
  test.setTimeout(180_000);
  await answerHosts(page, { globeAssets: "serve" });
  await approachLasting(page, 600_000);
  await openSampleOnGlobe(page);
  const track = page.locator("#view3d .approach-track");
  await expect(track).toHaveAttribute("role", "progressbar");
  await expect(track).toHaveAttribute("aria-valuemin", "0");
  await expect(track).toHaveAttribute("aria-valuemax", "100");
  await expect(track).toHaveAttribute("aria-valuenow", /^\d+$/);
  const line = page.locator("#view3d .approach-line");
  await expect(line).toHaveAttribute("role", "status");
  await expect(line).toHaveAttribute("aria-live", "polite");
  await expect(line).toHaveText(/^(Loading (stations|textures|buildings))?$/);
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
  await expect(page.locator("#view3d .approach-track")).toBeHidden();
  expect(await rejections(page)).toEqual([]);
});

test("after the landing the line stays while the relief still loads, then goes", async ({
  page,
}) => {
  // Why: a blank landing reads as broken; the line says what is still
  // coming until it came, and then leaves the view alone.
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
  await approachLasting(page, 3_000);
  await openSampleOnGlobe(page);
  await expect
    .poll(async () => (await approachOf(page))?.ended, { timeout: 60_000 })
    .toBe("landed");
  await expect(page.locator("#view3d .approach-track")).toBeHidden();
  await expect(page.locator("#view3d .approach-line")).toHaveText(
    "Loading textures",
  );
  await afterFrames(page, 10);
  await expect(page.locator("#view3d .approach-line")).toHaveText(
    "Loading textures",
  );
  holding = false;
  for (const release of held.splice(0)) release();
  await expect(page.locator("#view3d .approach")).toBeHidden({
    timeout: 60_000,
  });
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
