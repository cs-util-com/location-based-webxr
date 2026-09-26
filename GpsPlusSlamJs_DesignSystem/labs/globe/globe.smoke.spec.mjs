// @ts-check
/**
 * The globe lab (globe plan 2026-09-26-0539 §7.8, M0).
 *
 * Why this file matters: M0 retires the biggest unknown of the globe intro:
 * 3d-tiles-renderer under an import map, served no-build, on SwiftShader.
 * It must boot without an error, draw a lit Earth in the middle of the
 * frame with space in the corners, and never leave this machine: the page
 * promises no backend and no keys (DEC-PRG-3), so every request that is not
 * to 127.0.0.1 is aborted AND recorded, and the record must stay empty.
 */
import { expect, test } from "@playwright/test";

const ORIGIN = "http://127.0.0.1:5198";
/**
 * The luminance spread (8-bit) a textured centre must exceed. Measured
 * 2026-09-26 (SwiftShader, 7x7 grid over the central 30 %): 38.7 with the
 * Blue Marble imagery, as soon as the first tiles load. A flat colour is
 * about 0 and M0's untextured lit sphere only a smooth shading gradient, a
 * few levels; the bound sits between with 2.5x headroom under the reading.
 */
const TEXTURE_MIN_SPREAD = 15;

test("the globe boots, draws a lit Earth, and stays on this machine", async ({
  page,
}) => {
  const external = [];
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(`${ORIGIN}/`)) return route.continue();
    external.push(url);
    return route.abort();
  });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/labs/globe/");
  await page.waitForFunction(
    () => window.__globeLab?.ready || window.__globeLab?.error,
    null,
    { timeout: 90_000 },
  );
  expect(await page.evaluate(() => window.__globeLab.error)).toBeNull();
  // The surface arrives as tiles; wait until some have loaded.
  await page.waitForFunction(() => window.__globeLab.state().models > 0, null, {
    timeout: 60_000,
  });
  const [centre, ...corners] = await page.evaluate(() =>
    window.__globeLab.readPixels([
      [0.5, 0.5],
      [0.02, 0.02],
      [0.98, 0.02],
      [0.02, 0.98],
      [0.98, 0.98],
    ]),
  );
  const state = await page.evaluate(() => window.__globeLab.state());
  console.log(
    `globe: ${JSON.stringify(state)}, centre ${centre}, corners ${JSON.stringify(corners)}`,
  );
  const sum = (px) => px[0] + px[1] + px[2];
  expect(sum(centre)).toBeGreaterThan(60);
  for (const corner of corners) expect(sum(corner)).toBeLessThan(6);
  // M1: textured, not a flat colour. The luminance spread over a grid
  // around the centre (the Sahara and the Mediterranean in this view).
  const grid = [];
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 7; j++) grid.push([0.35 + i * 0.05, 0.35 + j * 0.05]);
  }
  const lum = (
    await page.evaluate((points) => window.__globeLab.readPixels(points), grid)
  ).map((px) => 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]);
  const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
  const spread = Math.sqrt(
    lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length,
  );
  console.log(
    `globe texture: mean luminance ${mean.toFixed(1)}, spread ${spread.toFixed(1)}`,
  );
  expect(spread).toBeGreaterThan(TEXTURE_MIN_SPREAD);
  // The credits line names every source on screen.
  const credits = await page.locator("#globe-credits").textContent();
  for (const short of state.creditShorts) expect(credits).toContain(short);
  expect(state.activeSources).toContain("blue-marble");
  expect(state.tileErrors).toBe(0);
  expect(state.radiusM).toBe(6378137);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
