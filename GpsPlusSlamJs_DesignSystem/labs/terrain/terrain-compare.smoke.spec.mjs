// @ts-check
/**
 * The terrain colour comparison page in the browser (globe round-5 plan
 * 2026-10-01-0945 §3.3 "Judged end to end").
 *
 * Why this file matters: the comparison page's numbers are what the owner
 * picks a colour approach by, and nothing else drives the lab through its
 * whole fly-in in every style. The bounded run (`?quick=1`, two rows, one
 * altitude, one sun) proves the page completes and logs finite numbers on
 * the committed tiles; the numbers themselves are logged, never asserted.
 * `TERRAIN_COMPARE_FULL=1` runs every row, altitude and sun (minutes on a
 * CPU rasteriser) to print the full table.
 */
import { expect, test } from "@playwright/test";

import { fixtureTile, routeAll } from "./terrain-smoke-helpers.mjs";

const FULL = process.env.TERRAIN_COMPARE_FULL === "1";

test("the comparison page drives the lab's fly-in and logs every variant's numbers", async ({
  page,
}) => {
  test.setTimeout(FULL ? 3_600_000 : 600_000);
  const record = await routeAll(page, fixtureTile);
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
    if (m.text().startsWith("compare ")) console.log(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/labs/terrain/compare.html${FULL ? "" : "?quick=1"}`);
  await page.waitForFunction(() => window.__terrainCompare?.done, null, {
    timeout: FULL ? 3_500_000 : 580_000,
    polling: 2000,
  });
  const results = await page.evaluate(() => window.__terrainCompare);
  expect(results.error).toBeNull();
  expect(record.missing).toEqual([]);
  expect(record.external).toEqual([]);
  expect(results.rows.length).toBe(FULL ? 6 : 2);
  for (const row of results.rows) {
    expect(Number.isFinite(row.costRatio), row.id).toBe(true);
    for (const sun of Object.values(row.suns)) {
      expect(Number.isFinite(sun.handOver.mean), row.id).toBe(true);
      expect(sun.handOver.n, row.id).toBeGreaterThan(50);
      for (const c of Object.values(sun.contrast)) {
        expect(c.n, row.id).toBeGreaterThan(20);
      }
    }
  }
  // One thumbnail per row, sun and altitude.
  const thumbs = await page.locator(".compare-thumb").count();
  expect(thumbs).toBe(FULL ? 6 * 2 * 4 : 2);
  expect(errors).toEqual([]);
});
