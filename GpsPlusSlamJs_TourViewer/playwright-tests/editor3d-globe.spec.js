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
  await page.screenshot({ path: testInfo.outputPath("globe-street.png") });
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
});
