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
import { COMPARE_VARIANTS } from "./terrain-compare.js";

const FULL = process.env.TERRAIN_COMPARE_FULL === "1";
/**
 * `TERRAIN_COMPARE_ROWS=A,C2` (with FULL) runs those rows only (the page's
 * `?rows=`; keep the first row A, the frame cost's reference).
 */
const PICKED = (process.env.TERRAIN_COMPARE_ROWS ?? "")
  .split(",")
  .filter(Boolean);
/**
 * `TERRAIN_COMPARE_SKY=0,0.5,1` (with FULL) repeats every row at each sky
 * floor (the page's `?sky=`, DEC-GL5-11); `TERRAIN_COMPARE_ALTS=30,10`
 * captures those altitudes only (the page's `?alts=`).
 */
const SKIES = (process.env.TERRAIN_COMPARE_SKY ?? "")
  .split(",")
  .filter(Boolean);
const ALTS = (process.env.TERRAIN_COMPARE_ALTS ?? "")
  .split(",")
  .filter(Boolean);
/** The full table's rows: every `COMPARE_VARIANTS` entry, or the picked. */
const ROWS =
  (PICKED.length > 0 ? PICKED.length : COMPARE_VARIANTS.length) *
  Math.max(1, SKIES.length);

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
  const keys = new URLSearchParams();
  if (!FULL) keys.set("quick", "1");
  if (FULL && PICKED.length > 0) keys.set("rows", PICKED.join(","));
  if (FULL && SKIES.length > 0) keys.set("sky", SKIES.join(","));
  if (FULL && ALTS.length > 0) keys.set("alts", ALTS.join(","));
  const query = keys.size > 0 ? `?${keys.toString()}` : "";
  await page.goto(`/labs/terrain/compare.html${query}`);
  await page.waitForFunction(() => window.__terrainCompare?.done, null, {
    timeout: FULL ? 3_500_000 : 580_000,
    polling: 2000,
  });
  const results = await page.evaluate(() => window.__terrainCompare);
  expect(results.error).toBeNull();
  expect(record.missing).toEqual([]);
  expect(record.external).toEqual([]);
  // Review 2026-10-01-1650 M1: the contrast is read from pixels, so the
  // buffer must be the frame's 800 x 500 whatever the screen's ratio.
  expect(results.pixelRatio).toBe(1);
  expect(results.buffer).toEqual({ width: 800, height: 500 });
  expect(results.rows.length).toBe(FULL ? ROWS : 2);
  for (const row of results.rows) {
    expect(Number.isFinite(row.costRatio), row.id).toBe(true);
    for (const sun of Object.values(row.suns)) {
      expect(Number.isFinite(sun.handOver.point.mean), row.id).toBe(true);
      expect(sun.handOver.point.n, row.id).toBeGreaterThan(50);
      // The footprint-averaged difference (M2) has its own footprints.
      expect(Number.isFinite(sun.handOver.footprint.mean), row.id).toBe(true);
      expect(sun.handOver.footprint.n, row.id).toBeGreaterThan(50);
      for (const c of Object.values(sun.contrast)) {
        expect(c.n, row.id).toBeGreaterThan(20);
        // The measured post spacing honours the 3 px rule (a little under
        // it where the relief's lift foreshortens a post pair).
        expect(c.postPx, row.id).toBeGreaterThan(2);
        // The darkest tenth is read (DEC-GL5-11).
        expect(c.dark.n, row.id).toBeGreaterThan(1);
        expect(Number.isFinite(c.dark.p), row.id).toBe(true);
      }
    }
  }
  // One thumbnail per row, sun and capture altitude.
  const thumbs = await page.locator(".compare-thumb").count();
  const shots = results.rows.reduce(
    (sum, row) =>
      sum +
      Object.values(row.suns).reduce(
        (k, sun) => k + Object.keys(sun.contrast).length,
        0,
      ),
    0,
  );
  expect(thumbs).toBe(shots);
  // Every row at every sun and altitude (four, unless `ALTS` narrows them).
  if (ALTS.length === 0) expect(thumbs).toBe(FULL ? ROWS * 2 * 4 : 2);
  expect(errors).toEqual([]);
});
