// @ts-check
import { expect, test } from "@playwright/test";

import {
  answerHosts,
  keepRejections,
  noApproach,
  noClouds,
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

/** How many frames the refusals are sampled for after the first one: at
 *  the software renderer's 2 to 3 frames a second about 15 to 20 s, under
 *  the street map's give-up (3 failed retries, about 37 s of refusals). */
const REFUSE_FRAMES = 40;

/** How many frames the finer tiles may take to be asked for after the
 *  move: they load a few a frame first (measured: within the minute). */
const FIRST_REFUSAL_FRAMES = 600;

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
  // The heavy clouds off: in this software renderer they hold the frame
  // rate near 1 a second.
  await noClouds(page);
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
  // a few a frame first), then for `REFUSE_FRAMES` more: counted in
  // frames, as the relief loads by frames, not by time.
  /** @param {any} stats */
  const framesOf = (stats) => /** @type {number} */ (stats?.frames ?? 0);
  const movedAt = framesOf(await view3d(page));
  let refuseUntil = Number.POSITIVE_INFINITY;
  /** @type {any[]} */
  const bare = [];
  /** @type {any} */
  let last;
  // The relief's cache at its fullest while the refusals hold the parents
  // (each held parent is drawn with its children loaded), not after.
  let cacheMax = 0;
  let cacheBudget = 0;
  for (;;) {
    const stats = await view3d(page);
    last = stats;
    const frame = framesOf(stats);
    cacheMax = Math.max(cacheMax, stats?.globe?.relief?.cacheBytes ?? 0);
    cacheBudget = stats?.globe?.relief?.cacheMaxBytes ?? cacheBudget;
    if (frame >= Math.min(refuseUntil, movedAt + FIRST_REFUSAL_FRAMES)) break;
    const c = stats?.osm?.coverage;
    if (stats?.osm?.active && c && c.waiting - c.givenUp > 0) {
      bare.push({ coverage: c, frames: frame });
    }
    if (refused > 0 && refuseUntil === Number.POSITIVE_INFINITY) {
      refuseUntil = frame + REFUSE_FRAMES;
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
  // And the relief's cache near the phone's budget at its fullest, while
  // the refusals held the parents. The budget is the library's soft one:
  // it unloads unused tiles down to it, never drawn ones, and a held
  // parent is drawn with its children loaded (measured 1.01 times the
  // budget at 25 m after the recovery). A fifth over is the margin.
  console.log(`relief cache at most ${cacheMax} of ${cacheBudget} bytes`);
  expect(cacheMax).toBeGreaterThan(0);
  expect(cacheMax).toBeLessThanOrEqual(cacheBudget * 1.2);
  expect(await rejections(page)).toEqual([]);
});

/** The zoom-in's steps (m from the tour): 3000 m to 25 m, evenly in the
 *  distance's logarithm. */
const ZOOM_STEPS = Array.from({ length: 10 }, (_, i) =>
  Math.round(3000 * (25 / 3000) ** (i / 9)),
);

/** At most this many frames per step for the map to load in full. */
const STEP_FRAMES = 200;

test("a zoom-in in steps never draws a tile bare in place of a mapped one", async ({
  page,
}, testInfo) => {
  // Why: the hold reached only the fade's start (0.7 of the fade) while
  // the map is asked for, and drawn at about 90 %, out to the fade's end:
  // on a zoom-in, children finishing between the two replaced a mapped
  // parent bare. With the server answering, at every frame of a zoom-in
  // from 3000 m to 25 m no drawn tile in the map's reach may be bare under
  // a parent that has its map (`coverage.bareUnderMap`).
  test.setTimeout(900_000);
  await page.setViewportSize(PHONE);
  await answerHosts(page, { globeAssets: "serve" });
  await keepRejections(page);
  await noApproach(page);
  await noClouds(page);
  await page.goto("/edit.html?globe=1");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator("#sample-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 120_000,
  });
  await reliefCarries(page);
  /** @type {{ distanceM: number, frames: number, bareUnderMap: number, mapped: boolean }[]} */
  const steps = [];
  /** @type {any[]} */
  const bare = [];
  for (const distanceM of ZOOM_STEPS) {
    await page.evaluate(
      (m) => /** @type {any} */ (window).__tourEditor.view3dDistance(m),
      distanceM,
    );
    const from = (await view3d(page))?.frames ?? 0;
    let mapped = false;
    let worst = 0;
    /** @type {number} */
    let frames;
    for (;;) {
      const stats = await view3d(page);
      frames = (stats?.frames ?? 0) - from;
      const c = stats?.osm?.coverage;
      if (stats?.osm?.active && c) {
        worst = Math.max(worst, c.bareUnderMap);
        if (c.bareUnderMap > 0) bare.push({ distanceM, frames, coverage: c });
        mapped = c.withMap > 0 && c.withMap + c.coarse === c.near;
      }
      if (mapped || frames >= STEP_FRAMES) break;
      await expect
        .poll(async () => (await view3d(page))?.frames)
        .toBeGreaterThan(stats?.frames ?? 0);
    }
    steps.push({ distanceM, frames, bareUnderMap: worst, mapped });
  }
  const reading = JSON.stringify(steps);
  testInfo.annotations.push({ type: "zoom-in steps", description: reading });
  console.log(`zoom-in steps ${reading}`);
  // Not vacuous: the map was on and loaded in full on the way in.
  expect(steps.some((s) => s.mapped)).toBe(true);
  expect(bare).toEqual([]);
  expect(await rejections(page)).toEqual([]);
});
