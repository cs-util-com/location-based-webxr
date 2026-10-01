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

// DEC-A3 (found by T2, 2026-10-01): the imagery tiles carry the globe's
// water mask in their alpha (0 on water, the colour under it kept). The
// page decoded them through a 2D canvas, which stores premultiplied colour,
// so every water pixel came back BLACK: globe-albedo (C1, the provisional
// default), the far field and style C drew lakes near black where the
// globe draws their dark blue. The globe hands the tiles to the GPU with
// `premultiplyAlpha: "none"`; the lab now reads them back the same way.
/** Lake Constance's Obersee, inside the Alps region and tile 5/33/7. */
const LAKE = { lat: 47.56, lng: 9.42 };
const ALPS_TILE = "/globe-assets/blue-marble-4326/5/33/7.webp";

test("the imagery keeps the water's colour under the mask, and C1 draws a lake in it", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await routeAll(page, fixtureTile);
  const errors = await boot(
    page,
    `place=alps&${VIEW}&style=globe-albedo&detail=0`,
  );
  await page.waitForFunction(
    () => {
      const s = window.__terrainLab.state();
      return s.farState === "ready" && s.globeColour.albedo;
    },
    null,
    { timeout: 120_000 },
  );
  // The lab's decode against a 2D-canvas decode of the same tile: land
  // pixels identical (same bytes, same row order), water pixels coloured
  // where the canvas returns black.
  const check = await page.evaluate(async (url) => {
    const blob = await (await fetch(url)).blob();
    const lab = await window.__terrainLab.decodeRgba(blob);
    const bitmap = await createImageBitmap(blob, {
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
    });
    const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = surface.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const canvas = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let land = 0;
    let landSame = 0;
    let water = 0;
    let waterCanvasBlack = 0;
    let waterLabColoured = 0;
    for (let i = 0; i < canvas.length; i += 4) {
      if (lab.data[i + 3] === 255) {
        land += 1;
        if ([0, 1, 2, 3].every((c) => lab.data[i + c] === canvas[i + c])) {
          landSame += 1;
        }
      } else if (lab.data[i + 3] === 0) {
        water += 1;
        if (canvas[i] + canvas[i + 1] + canvas[i + 2] === 0)
          waterCanvasBlack += 1;
        if (lab.data[i] + lab.data[i + 1] + lab.data[i + 2] > 0) {
          waterLabColoured += 1;
        }
      }
    }
    return {
      width: lab.width,
      land,
      landSame,
      water,
      waterCanvasBlack,
      waterLabColoured,
    };
  }, ALPS_TILE);
  console.log(`decode of ${ALPS_TILE}: ${JSON.stringify(check)}`);
  expect(check.width).toBe(256);
  expect(check.water).toBeGreaterThan(50);
  expect(check.landSame).toBe(check.land);
  expect(check.waterCanvasBlack).toBe(check.water);
  expect(check.waterLabColoured).toBeGreaterThan(0.9 * check.water);
  // The lake in the imagery the page samples, and in C1's pixel there.
  const lake = await page.evaluate(({ lat, lng }) => {
    const e = window.__terrainLab.toEnu(lat, lng);
    return {
      imagery: window.__terrainLab.imageryAt(lat, lng),
      field: window.__terrainLab.fieldAt(e.x, e.y),
      e,
    };
  }, LAKE);
  const s = await state(page);
  const [px] = await readPixels(
    page,
    await page.evaluate(
      (p) => window.__terrainLab.projectAll([p]),
      [lake.e.x, lake.field.heightM - s.datum, -lake.e.y],
    ),
  );
  console.log(
    `Lake Constance: imagery ${lake.imagery.map((v) => v.toFixed(3)).join(", ")}, C1 pixel ${px.slice(0, 3).join(", ")}`,
  );
  // Dark blue, not black: a channel above 15 of 255, blue over red.
  expect(Math.max(...lake.imagery)).toBeGreaterThan(15 / 255);
  expect(lake.imagery[2]).toBeGreaterThan(lake.imagery[0]);
  expect(Math.max(px[0], px[1], px[2])).toBeGreaterThan(15);
  expect(px[2]).toBeGreaterThan(px[0]);
  expect(errors).toEqual([]);
});
