// @ts-check
/**
 * The globe's building blocks for the 3D tour editor (tour editor plan
 * 2026-10-17-1816 §13, milestone G1), in the globe lab: what the G0 spikes
 * found missing or broken, held on the real page.
 *
 * Why this file matters: each block is unit-tested in the Globe package,
 * but the G0 spikes' failures were all ones only the page shows (a cache
 * that stalls silently, a relief that vanishes when a second overlay is
 * added, a near plane that clips the ground at eye height). Heights are
 * synthetic and every tile server is routed: nothing leaves 127.0.0.1.
 */
import { expect, test } from "@playwright/test";

import { bootGlobe } from "./globe-smoke-helpers.mjs";

const BASE =
  "spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z&cloudDrift=0&stars=0&milkyWay=0&relief=1&reliefHeights=synthetic&detail=0&cloudShell=0&cloudVolume=0";

/** A low oblique view over the synthetic Alps: many relief tiles wanted. */
const LOW_VIEW = "46.5,9.0,3,0,-20";

// WHY (G0 spikes 2026-10-17, the headline finding): with 512 px heights the
// relief cache filled and the tree stopped refining, with nothing on the
// page saying so. The page must SAY it: a cache too small for the view
// reads `stalled` in the lab's state (and the Debug panel's line), and the
// same view with the default budget does not. Swept over two budgets (8
// MiB, the lab's floor, and the default 64), the verdict read at both.
test("a relief cache too small for the view reads stalled; the default does not", async ({
  page,
}) => {
  test.setTimeout(400_000);
  const results = [];
  for (const mib of [8, 64]) {
    const errors = await bootGlobe(
      page,
      `${BASE}&reliefCacheMiB=${mib}&view=${LOW_VIEW}`,
      { phase: "user" },
    );
    // Either the refusals arrive, or the relief settles with room to spare.
    await page.waitForFunction(
      () => {
        const r = window.__globeLab.state().relief;
        const c = r?.cache;
        return Boolean(
          c && (c.refusedRequests + c.refusedLoads > 0 || r.settled),
        );
      },
      null,
      { timeout: 180_000 },
    );
    await page.evaluate(() => window.__globeLab.timeFrames(3));
    const cache = await page.evaluate(
      () => window.__globeLab.state().relief.cache,
    );
    results.push({ mib, cache, errors });
  }
  console.log(
    `relief cache at ${LOW_VIEW}: ${results
      .map(
        ({ mib, cache: c }) =>
          `${mib} MiB: ${(c.usedBytes / 2 ** 20).toFixed(1)} of ${(c.maxBytes / 2 ** 20).toFixed(1)} MiB, full ${c.full}, refused ${c.refusedRequests} requests and ${c.refusedLoads} loads, stalled ${c.stalled}`,
      )
      .join("; ")}`,
  );
  const [small, normal] = results;
  expect(small.errors).toEqual([]);
  expect(normal.errors).toEqual([]);
  expect(small.cache.maxBytes).toBe(8 * 2 ** 20);
  expect(
    small.cache.refusedRequests + small.cache.refusedLoads,
  ).toBeGreaterThan(0);
  expect(normal.cache.maxBytes).toBe(64 * 2 ** 20);
  expect(normal.cache.refusedRequests + normal.cache.refusedLoads).toBe(0);
  expect(normal.cache.stalled).toBe(false);
});
