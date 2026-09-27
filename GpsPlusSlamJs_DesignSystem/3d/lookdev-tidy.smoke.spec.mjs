// @ts-check
/**
 * The look-dev page's round-3 tidy (plan 2026-09-27-0532, stream A): the
 * catalog labels at the owner's distance, the old white and gold ramp as a
 * catalog row, and the city's varied materials with their cost.
 *
 * Why this file matters: each claim here is something the owner asked for
 * in words ("labels from about twice the distance", "one set of spheres",
 * "does a mix of matte and shiny cost more?"), and each can silently not
 * happen: a label rule nobody reads, a row that lands off the grid, a
 * switch that builds the same two meshes. Costs are logged as ratios within
 * one page load (SwiftShader timings are relative only).
 */
import { expect, test } from "@playwright/test";

import { boot } from "./smoke-boot.mjs";

/** The label-cap sweep (plan §8 finding 16). */
const K_SWEEP = [16, 24, 41];
/** The owner's fade (DEC round 3): full to 50 m, gone at 140 m. */
const FADE = { near: 50, far: 140 };

// WHY (owner feedback round 3, item 5): the labels appeared too close; the
// owner asked for about twice the distance, so the fade runs 50-140 m (was
// 25-70 m). From 100 m a label must show (the old rule hid it at 70 m), and
// from past 140 m none. And K, the nearest-labels cap, now decides more than
// the fade: at the catalog view every sphere is inside 140 m, so the count
// shown is exactly min(K, spheres). The sweep over K is logged per view for
// the owner (which labels each K shows).
test("catalog labels show from about twice the old distance, and K caps them (K sweep logged)", async ({
  page,
}) => {
  const errors = await boot(page, "preset=noon&tone=neutral&city=0&catalog=1");
  const result = await page.evaluate(
    ([ks, fade]) => {
      const d = window.__lookdev;
      d.pauseLoop(true);
      d.setCloudCover(0);
      const spheres = d.catalogSpheres();
      // Stand straight back (+z) from the nearest row's middle sphere, at its
      // height, so the nearest sphere is exactly `m` metres away.
      const lastZ = Math.max(...spheres.map((s) => s.z));
      const row = spheres.filter((s) => s.z === lastZ);
      const mid = row[Math.floor(row.length / 2)];
      const labelsFrom = (m) => {
        d.placeCameraAt([mid.x, mid.y, mid.z + m], [mid.x, mid.y, mid.z]);
        d.readPixels([[0.5, 0.5]]);
        return d.catalogInfo().labelIds.length;
      };
      const byDistance = {
        100: labelsFrom(100),
        [fade.far + 5]: labelsFrom(fade.far + 5),
      };
      const sweep = {};
      for (const view of ["catalog", "city", "lake", "sun", "antisun"]) {
        sweep[view] = {};
        d.setView(view);
        for (const k of ks) {
          d.setLabelRule({ k });
          d.readPixels([[0.5, 0.5]]);
          sweep[view][k] = d.catalogInfo().labelIds;
        }
      }
      d.setLabelRule({ k: 16 });
      return { byDistance, sweep, entries: spheres.length };
    },
    [K_SWEEP, FADE],
  );
  for (const [view, byK] of Object.entries(result.sweep)) {
    for (const [k, ids] of Object.entries(byK)) {
      console.log(`labels ${view} K=${k}: ${ids.length} [${ids.join(", ")}]`);
    }
  }
  console.log(`labels by distance: ${JSON.stringify(result.byDistance)}`);
  expect(result.byDistance[100]).toBeGreaterThan(0);
  expect(result.byDistance[FADE.far + 5]).toBe(0);
  for (const k of K_SWEEP) {
    expect(result.sweep.catalog[k]).toHaveLength(Math.min(k, result.entries));
  }
  expect(errors).toEqual([]);
});
