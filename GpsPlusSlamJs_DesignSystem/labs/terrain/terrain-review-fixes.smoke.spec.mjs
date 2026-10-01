// @ts-check
/**
 * The terrain lab's fixes from the M2 T1 milestone review (2026-10-01-1650),
 * in the browser: m3 (the imagery styles say why they are dark at night)
 * and m6 (globe-bands draws style B until the drawn region's ramp exists,
 * never black or the previous region's ramp).
 *
 * Why this file matters: both are page behaviour no unit test reaches. A
 * style that opens black at night, or that shows the Alps' colours over
 * the Blue Ridge while the new imagery loads, still draws a plausible map,
 * so only a pixel and a status-line check catch it.
 */
import { expect, test } from "@playwright/test";

import {
  applyHash,
  boot,
  fixtureTile,
  gridAround,
  readPixels,
  routeAll,
  state,
} from "./terrain-smoke-helpers.mjs";

const DAY = "2026-06-21T11:00:00Z";
const NIGHT = "2026-06-21T23:00:00Z";
const VIEW = `alt=300000&tilt=0&head=0&svf=0&tau=0&exag=1&light=1&time=${DAY}`;
/** The canvas points both styles are read at: the middle of the frame. */
const POINTS = gridAround([0.5, 0.5], 0.3, 9);

/** The largest channel difference between two pixel reads. */
const maxDiff = (a, b) =>
  Math.max(
    ...a.flatMap((p, i) => [0, 1, 2].map((c) => Math.abs(p[c] - b[i][c]))),
  );

test("globe-bands draws style B when the imagery cannot load", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await routeAll(page, fixtureTile);
  await page.route("**/globe-assets/**", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await boot(page, `place=alps&${VIEW}&style=globe-bands`);
  await page.waitForFunction(
    () => window.__terrainLab.state().farState === "failed",
    null,
    { timeout: 90_000 },
  );
  const s = await state(page);
  expect(s.shaderStyle).toBe(5);
  expect(s.globeColour.bandsOn).toBe(false);
  const bands = await readPixels(page, POINTS);
  await applyHash(page, `place=alps&${VIEW}&style=natural`);
  const natural = await readPixels(page, POINTS);
  const diff = maxDiff(bands, natural);
  console.log(
    `globe-bands without imagery against style B: max channel diff ${diff}`,
  );
  expect(diff).toBeLessThanOrEqual(1);
});

test("globe-bands never draws the previous region's ramp while the new imagery loads", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await routeAll(page, fixtureTile);
  // The imagery passes until `hold` is set; then it waits for `release`.
  let hold = false;
  /** @type {() => void} */
  let release = () => {};
  const held = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  await page.route("**/globe-assets/**", async (route) => {
    if (hold) await held;
    return route.continue();
  });
  await boot(page, `place=alps&${VIEW}&style=globe-bands`);
  await page.waitForFunction(
    () => window.__terrainLab.state().globeColour.bandsOn,
    null,
    { timeout: 120_000 },
  );
  hold = true;
  await applyHash(page, `place=appalachians&${VIEW}&style=globe-bands`);
  await page.waitForFunction(
    () => {
      const s = window.__terrainLab.state();
      return s.place === "appalachians" && s.hasData === true;
    },
    null,
    { timeout: 120_000 },
  );
  const s = await state(page);
  expect(s.farState).toBe("loading");
  expect(s.globeColour.bandsOn).toBe(false);
  const bands = await readPixels(page, POINTS);
  await applyHash(page, `place=appalachians&${VIEW}&style=natural`);
  const natural = await readPixels(page, POINTS);
  const diff = maxDiff(bands, natural);
  console.log(
    `globe-bands while the new imagery loads against style B: max channel diff ${diff}`,
  );
  expect(diff).toBeLessThanOrEqual(1);
  release();
});

test("an imagery style at night says the sun is down, and stops saying it by day", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await routeAll(page, fixtureTile);
  const errors = await boot(
    page,
    `place=alps&svf=0&style=globe-albedo&time=${NIGHT}`,
  );
  let s = await state(page);
  expect(s.sun.elevationDeg).toBeLessThan(0);
  expect(s.errorText).toContain("below the horizon");
  expect(s.errorText).toContain("2026-06-21 23:00 UTC");
  await expect(page.locator("#terrain-error")).toBeVisible();
  await applyHash(page, `place=alps&svf=0&style=globe-albedo&time=${DAY}`);
  s = await state(page);
  expect(s.sun.elevationDeg).toBeGreaterThan(0);
  expect(s.errorText).not.toContain("below the horizon");
  // The map lights never say it: they are not the sun.
  await applyHash(page, `place=alps&svf=0&style=natural&time=${NIGHT}`);
  s = await state(page);
  expect(s.light).toBe(0);
  expect(s.errorText).not.toContain("below the horizon");
  expect(errors).toEqual([]);
});
