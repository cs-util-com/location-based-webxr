// @ts-check
import { expect, test } from "@playwright/test";

import {
  afterFrames,
  answerHosts,
  keepRejections,
  openSampleIn3d,
  rejections,
  view3d,
} from "./editor3d-fixture.js";

/**
 * Why these tests matter: the editor on the globe view opens only behind
 * its link switch (`globe=1`), and the OrbitControls view stays the default.
 * These open the sample tour both ways and check, through the page's test
 * hook (a software-drawn WebGL shows little a screenshot could assert on),
 * that the switch gives the globe view - drawing, at street level, the
 * relief carrying the ground, the three stations in its Earth-centred
 * group - and that without it nothing of the globe loads: no globe stats,
 * no ask for its whole-Earth imagery.
 */

test("opens the sample tour on the globe at street level with ?globe=1", async ({
  page,
}, testInfo) => {
  // The relief loads from its root tile down, every tile a synthetic image
  // on a software-drawn WebGL, with the globe's sky and surface on top.
  test.setTimeout(180_000);
  await answerHosts(page, { globeAssets: "serve" });
  await keepRejections(page);
  await page.goto("/edit.html?globe=1");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator("#sample-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 120_000,
  });
  await expect.poll(async () => (await view3d(page))?.stations).toBe(3);
  await afterFrames(page, 5);

  const stats = await view3d(page);
  expect(stats.globe).toBeDefined();
  // Street level: the relief carries the ground, the camera is an eye
  // height over the square, not in orbit.
  expect(stats.globe.carrier).toBe("relief");
  expect(stats.globe.altitudeM).toBeGreaterThan(0);
  expect(stats.globe.altitudeM).toBeLessThan(2_000);
  // The tour sits in front of the camera, a few tens of metres away.
  expect(stats.distanceM).toBeLessThan(200);
  // The stations are drawn, none hidden as too small this close.
  expect(stats.globe.hiddenStations).toEqual([]);
  // The staged uploads: every station admitted once, a few a frame.
  await expect
    .poll(async () => (await view3d(page))?.globe?.uploads?.pending)
    .toBe(0);
  const staged = (await view3d(page)).globe.uploads;
  expect(staged.ran).toBe(3);
  expect(staged.admitted).toBe(3);
  await page.screenshot({ path: testInfo.outputPath("globe-street.png") });
  // The sky opens in daylight whatever the hour; the View menu's Real time
  // runs the clock at the real time now.
  expect(stats.globe.clock.realTime).toBe(false);
  expect(stats.globe.clock.sunElevationDeg).toBeGreaterThan(0);
  await page.locator("#view-menu-btn").click();
  const realTime = page.locator("#view-realtime");
  await expect(realTime).toBeVisible();
  await realTime.click();
  await expect(realTime).toHaveAttribute("aria-checked", "true");
  await expect
    .poll(async () => (await view3d(page))?.globe?.clock?.realTime)
    .toBe(true);
  const clock = (await view3d(page)).globe.clock;
  expect(Math.abs(clock.sceneMs - Date.now())).toBeLessThan(120_000);
  expect(await rejections(page)).toEqual([]);
});

test("opens the OrbitControls view without the switch, nothing of the globe asked for", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const imagery = await answerHosts(page);
  await openSampleIn3d(page);
  await afterFrames(page, 3);
  const stats = await view3d(page);
  expect(stats.globe).toBeUndefined();
  expect(imagery.asks).toBe(0);
  // No sky of its own: no clock item in the View menu.
  await expect(page.locator("#view-realtime")).toBeHidden();
});

/**
 * The page point of a gizmo part, once it shows.
 * @param {import("@playwright/test").Page} page
 * @param {"middle" | "knob" | "dot"} part
 */
async function handleOnPage(page, part) {
  const ask = () =>
    page.evaluate(
      (p) => /** @type {any} */ (window).__tourEditor.view3dHandle(p),
      part,
    );
  await expect.poll(ask, { timeout: 60_000 }).not.toBeNull();
  const at = await ask();
  const canvas = await page.locator("#view3d canvas").boundingBox();
  if (canvas === null || at === null) throw new Error("no handle on screen");
  return { x: canvas.x + at[0], y: canvas.y + at[1] };
}

// Why: on the globe the camera's controls and the editor's gizmo share the
// pointer. A drag on a handle must be the gizmo's alone - the controls
// leased off, so the globe neither pans nor turns under the pointer - and
// the world frame (which follows the camera) must hold still until the
// release, or the gesture's world points move under it. The drag writes
// one edit, at its end. The sample's stations are locked in place, so the
// drag is of a radius dot (a locked station's gizmo is its dots alone).
test("drags a selected station's radius dot on the globe: one edit, the camera and the frame held still", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await answerHosts(page, { globeAssets: "serve" });
  await keepRejections(page);
  await page.goto("/edit.html?globe=1");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator("#sample-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 120_000,
  });
  await expect.poll(async () => (await view3d(page))?.stations).toBe(3);
  const tourOf = () =>
    page.evaluate(() => /** @type {any} */ (window).__tourEditor.manifest());
  const revision = () =>
    page.evaluate(() =>
      /** @type {any} */ (window).__tourEditor.editor().revision(),
    );
  const first = (await tourOf()).stations[0];
  await page.locator(`#tree-body [data-select="station:${first.id}"]`).click();
  const from = await handleOnPage(page, "dot");
  await afterFrames(page, 5);
  const steps = await revision();
  const before = await view3d(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from.x + i * 8, from.y + i * 2);
  }
  await afterFrames(page, 10);
  const during = await view3d(page);
  expect(during.camera).toEqual(before.camera);
  expect(during.globe.recentres).toBe(before.globe.recentres);
  // Nothing is written while the drag runs.
  expect(await revision()).toBe(steps);
  await page.mouse.up();
  await expect.poll(revision).toBe(steps + 1);
  const moved = (await tourOf()).stations.find(
    (/** @type {any} */ s) => s.id === first.id,
  );
  expect(Math.abs(moved.foundRadiusM - first.foundRadiusM)).toBeGreaterThan(
    0.5,
  );
  // Locked: the drag changed the radius, never the place.
  expect(moved.geo).toEqual(first.geo);
  expect(await rejections(page)).toEqual([]);
});
