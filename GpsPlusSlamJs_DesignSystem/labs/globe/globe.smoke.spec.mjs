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
  expect(state.tileErrors).toBe(0);
  expect(state.radiusM).toBe(6378137);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
