// @ts-check
import { expect, test } from "@playwright/test";

import {
  answerHosts,
  keepRejections,
  noApproach,
  rejections,
  reliefCarries,
  view3d,
} from "./editor3d-fixture.js";

/**
 * Why this test matters: when the camera comes closer, the relief swaps a
 * drawn tile for its finer children. Before, it swapped at once, and the
 * finer tiles were drawn without the street map until their own map tiles
 * came - with a tile server that refuses or throttles, a mapped square
 * turned into bare relief for minutes. The relief now keeps the drawn
 * tile until its children have their map (the street map's `mapReady`,
 * asked by the patched traversal). On the real page, at a phone's width
 * (the relief's smaller cache budget), the map loads in full, then the
 * tile server refuses every request (429) while the camera comes closer:
 * the finer tiles are asked for and refused, and every tile drawn near the
 * camera must still carry the map. Then the server answers again and the
 * finer tiles get theirs. A unit test runs the patched traversal itself
 * (`GpsPlusSlamJs_Globe/src/globe-osm-map-ready.test.ts`); this one checks
 * the page wires it and the patched build is what it runs.
 */

/** The phone's width: the relief's phone cache budget (under 768 px). */
const PHONE = { width: 390, height: 844 };

/** How long the refusals run while the camera comes closer (ms): under the
 *  street map's give-up (3 failed retries, about 37 s of refusals). */
const REFUSE_MS = 20_000;

/** How long the finer tiles may take to be asked for after the move (ms):
 *  they load a few a frame at the software renderer's 2 to 3 frames a
 *  second first. */
const FIRST_REFUSAL_MS = 240_000;

/** @param {any} osm */
const lockErrorCount = (osm) =>
  Object.values(osm?.lockErrors ?? {}).reduce(
    (sum, n) => sum + /** @type {number} */ (n),
    0,
  );

test("the relief keeps a mapped tile until its finer tiles have their street map", async ({
  page,
}) => {
  // The relief's hand-over (up to 400 frames, `reliefCarries`), the map's
  // first load, the refusals, and the retries' back-off after them.
  test.setTimeout(900_000);
  await page.setViewportSize(PHONE);
  await answerHosts(page, { globeAssets: "serve" });
  await keepRejections(page);
  await noApproach(page);
  /** @type {"answer" | "refuse"} */
  let server = "answer";
  let refused = 0;
  // Matched before `answerHosts`' plain tile (routes added later go first).
  await page.route("https://tile.openstreetmap.org/**", (route) => {
    if (server === "answer") return route.fallback();
    refused++;
    return route.fulfill({ status: 429, body: "Too Many Requests" });
  });
  await page.goto("/edit.html?globe=1");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator("#sample-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 120_000,
  });
  // The heavy clouds off, as in the other globe tests: in this software
  // renderer they hold the frame rate near 1 a second.
  await expect
    .poll(async () => (await view3d(page))?.globe?.air?.clouds?.on)
    .toBe(true);
  await page.locator("#view-menu-btn").click();
  await page.locator("#view-clouds").click();
  await page.keyboard.press("Escape");
  await reliefCarries(page);

  /** @type {any} */
  let osm = null;
  // Every near tile with its map, but for the coarse ones: coarser than
  // the map's coarsest zoom, they never take it (measured: one of ten at
  // 150 m on this phone view).
  const fullyMapped = async () => {
    osm = (await view3d(page))?.osm ?? null;
    const c = osm?.coverage;
    return (
      osm?.active === true && c.withMap > 0 && c.withMap + c.coarse === c.near
    );
  };
  // Farther first: the near tiles coarser, every one with its map. At
  // 150 m the relief is at its finest level already (`EDITOR_MESH_LEVEL`),
  // so coming closer from there asks for no finer tile (measured: no map
  // request at 25 m); from 1200 m it does.
  await page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.view3dDistance(1200),
  );
  await expect
    .poll(fullyMapped, { timeout: 120_000, intervals: [1_000] })
    .toBe(true)
    .catch((/** @type {unknown} */ error) => {
      console.log(`the map never loaded: ${JSON.stringify(osm)}`);
      throw error;
    });

  // Refused from here on, and the camera comes closer: the finer tiles are
  // asked for and refused, and none may be drawn in its parent's place.
  server = "refuse";
  await page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.view3dDistance(25),
  );
  // Sampled each frame until the first refusal (the finer relief tiles load
  // a few a frame first), then for `REFUSE_MS` more.
  const firstRefusalBy = Date.now() + FIRST_REFUSAL_MS;
  let refuseUntil = Number.POSITIVE_INFINITY;
  /** @type {any[]} */
  const bare = [];
  /** @type {any} */
  let last = null;
  while (Date.now() < Math.min(refuseUntil, firstRefusalBy)) {
    const stats = await view3d(page);
    last = stats;
    const c = stats?.osm?.coverage;
    if (stats?.osm?.active && c && c.waiting - c.givenUp > 0) {
      bare.push({ coverage: c, frames: stats.frames });
    }
    if (refused > 0 && refuseUntil === Number.POSITIVE_INFINITY) {
      refuseUntil = Date.now() + REFUSE_MS;
    }
    await expect
      .poll(async () => (await view3d(page))?.frames)
      .toBeGreaterThan(stats?.frames ?? 0);
  }
  const after = JSON.stringify({
    refused,
    osm: last?.osm,
    relief: last?.globe?.relief,
  });
  console.log(`after the refusals: ${after}`);
  // Not vacuous: finer tiles were asked for (and refused) after the move.
  expect(refused, after).toBeGreaterThan(0);
  // The relief's traversal asked the map about its tiles, which only the
  // patched traversal does: an unpatched build cannot pass here.
  expect((await view3d(page))?.osm?.readinessAsks).toBeGreaterThan(0);
  expect(bare).toEqual([]);

  server = "answer";
  await expect
    .poll(fullyMapped, { timeout: 180_000, intervals: [2_000] })
    .toBe(true)
    .catch((/** @type {unknown} */ error) => {
      console.log(`the map never healed: ${JSON.stringify(osm)}`);
      throw error;
    });
  // The refusals show in the map's own diagnostics.
  expect(lockErrorCount(osm)).toBeGreaterThan(0);
  // And the relief's cache near the phone's budget at the end. The budget
  // is the library's soft one: it unloads unused tiles down to it, never
  // drawn ones, and a held parent is drawn with its children loaded
  // (measured 1.01 times the budget at 25 m). A fifth over is the margin.
  const relief = (await view3d(page))?.globe?.relief;
  console.log(
    `relief cache ${relief.cacheBytes} of ${relief.cacheMaxBytes} bytes`,
  );
  expect(relief.cacheBytes).toBeGreaterThan(0);
  expect(relief.cacheBytes).toBeLessThanOrEqual(relief.cacheMaxBytes * 1.2);
  expect(await rejections(page)).toEqual([]);
});
