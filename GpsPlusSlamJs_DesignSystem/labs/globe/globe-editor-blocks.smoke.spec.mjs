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

/** The synthetic heights' surface (`../globe-terrain/synthetic-heights.js`, seaM 0). */
const syntheticHeightM = (lat, lng) =>
  Math.max(
    0,
    1000 +
      900 *
        Math.sin((2 * Math.PI * lng) / 0.5) *
        Math.sin((2 * Math.PI * lat) / 0.4) +
      300 *
        Math.sin((2 * Math.PI * lng) / 0.07) *
        Math.cos((2 * Math.PI * lat) / 0.06),
  );

/**
 * A fake of both height hosts on the CONTEXT (the page's and the city
 * worker's requests): Mapterhorn answers 512 px synthetic tiles, except a
 * coverage gap (every tile with x + y odd from zoom 10 on: wider than the
 * real one, z13 and finer, so the check does not depend on the depth the
 * view reaches) with a 404; AWS answers 256 px synthetic tiles of the
 * same surface. Returns the requests seen.
 */
async function routeHeightHosts(context, page) {
  const seen = { mapterhorn: 0, gaps: [], aws: [] };
  const cors = { "Access-Control-Allow-Origin": "*" };
  await context.route(
    (url) =>
      url.hostname === "tiles.mapterhorn.com" ||
      (url.hostname === "s3.amazonaws.com" &&
        url.pathname.startsWith("/elevation-tiles-prod/")),
    async (route) => {
      const url = new URL(route.request().url());
      const [z, x, y] = url.pathname
        .replace(/\.(png|webp)$/, "")
        .split("/")
        .slice(-3)
        .map(Number);
      const mapterhorn = url.hostname === "tiles.mapterhorn.com";
      if (mapterhorn) {
        seen.mapterhorn += 1;
        if (z >= 10 && (x + y) % 2 === 1) {
          seen.gaps.push(`${z}/${x}/${y}`);
          return route.fulfill({ status: 404, headers: cors, body: "" });
        }
      } else {
        seen.aws.push(`${z}/${x}/${y}`);
      }
      const b64 = await page.evaluate(
        async ([tz, tx, ty, size, module]) => {
          const { syntheticTile } = await import(module);
          const blob = await syntheticTile(tz, tx, ty, 0, size);
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let s = "";
          for (const b of bytes) s += String.fromCharCode(b);
          return btoa(s);
        },
        [
          z,
          x,
          y,
          mapterhorn ? 512 : 256,
          "/labs/globe-terrain/synthetic-heights.js",
        ],
      );
      return route.fulfill({
        status: 200,
        headers: { ...cors, "Content-Type": "image/png" },
        body: Buffer.from(b64, "base64"),
      });
    },
  );
  return seen;
}

// WHY (G0 spikes 2026-10-17, Q1 and "Coverage"): the 3D editor draws
// Mapterhorn (512 px, national LiDAR at z13-14), which answers 404 outside
// national coverage. On the real page, against a fake of both hosts: the
// relief must load Mapterhorn's tiles at their size, ask AWS for every
// tile Mapterhorn has not got (same z/x/y), draw without an error, stand
// at the surface both serve, and credit both sources with their links.
test("the Mapterhorn relief draws, falls back to AWS where it answers 404, and credits both", async ({
  page,
  context,
}) => {
  test.setTimeout(400_000);
  // The tiles are generated in the lab page itself (its own module).
  const seen = await routeHeightHosts(context, page);
  const errors = await bootGlobe(
    page,
    BASE.replace("&reliefHeights=synthetic", "") +
      `&reliefSource=mapterhorn&view=${LOW_VIEW}`,
    { phase: "user", routeCity: false },
  );
  await page.waitForFunction(
    () => {
      const r = window.__globeLab.state().relief;
      return Boolean(r?.settled && r.fallback?.fallbacks > 0);
    },
    null,
    { timeout: 240_000 },
  );
  await page.evaluate(() => window.__globeLab.timeFrames(3));
  const out = await page.evaluate(() => {
    const s = window.__globeLab.state();
    const live = JSON.parse(window.__globeLab.debug.exportText()).live;
    return {
      relief: s.relief,
      lat: live.lat,
      lng: live.lng,
      credits: document.getElementById("globe-credits").textContent,
      links: [...document.querySelectorAll("#globe-credits a")].map((a) =>
        a.getAttribute("href"),
      ),
    };
  });
  const expected = syntheticHeightM(out.lat, out.lng);
  const gapsAsked = seen.gaps.filter((t) => seen.aws.includes(t)).length;
  console.log(
    `Mapterhorn relief at ${LOW_VIEW}: ${seen.mapterhorn} Mapterhorn requests, ${seen.gaps.length} answered 404, ${gapsAsked} of them asked of AWS (${seen.aws.length} AWS requests); fallback ${JSON.stringify(out.relief.fallback)}; ${out.relief.visibleTiles} tiles visible, ${out.relief.litTiles} lit; ground under the camera ${out.relief.groundUnderCameraM?.toFixed(1)} m against the surface's ${expected.toFixed(1)} m; cache ${JSON.stringify(out.relief.cache)}`,
  );
  expect(errors).toEqual([]);
  expect(out.relief.source).toBe("mapterhorn");
  expect(seen.gaps.length).toBeGreaterThan(0);
  expect(out.relief.fallback.fallbacks).toBeGreaterThan(0);
  expect(out.relief.fallback.failures).toBe(0);
  // AWS was asked only for tiles Mapterhorn has not got, at the same tile.
  expect(seen.aws.every((t) => seen.gaps.includes(t))).toBe(true);
  expect(gapsAsked).toBeGreaterThanOrEqual(out.relief.fallback.fallbacks);
  expect(out.relief.litTiles).toBeGreaterThan(0);
  // The 300 m ripple has a 5 km wavelength: a few metres of mesh error.
  expect(Math.abs(out.relief.groundUnderCameraM - expected)).toBeLessThan(10);
  expect(out.credits).toContain("Elevation data © Mapterhorn");
  expect(out.credits).toContain("Mapzen");
  expect(out.links).toContain("https://mapterhorn.com/attribution");
  expect(out.relief.cache.stalled).toBe(false);
});
