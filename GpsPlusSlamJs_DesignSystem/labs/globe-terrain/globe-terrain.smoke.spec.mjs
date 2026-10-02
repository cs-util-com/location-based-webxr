// @ts-check
/**
 * The globe's relief carrier, prepared (round-5 plan 2026-10-01-0945 §8
 * DEC-GL5-9, F1a; F0 results 2026-10-02-0307 §7).
 *
 * Why this file matters: the carrier (the tile library's terrain tiles)
 * had three measured defects as it ships: flat relief on devices without
 * float-linear filtering, the library's own look, and imagery from the
 * wrong latitude. Each is held here on the GPU, with its threshold
 * declared and reported at x0.5, x1 and x2; plus the data a descent costs
 * and a dense seam scan. Heights are synthetic (generated in the page), so
 * nothing leaves 127.0.0.1. Under SwiftShader frame costs are relative.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

const SWEEP = [0.5, 1, 2];
/** "value vs bound: x0.5 ok x1 ok x2 NO" for a value that must stay below. */
const below = (value, bound) =>
  `${value.toFixed(2)} (bound ${bound}: ${SWEEP.map((k) => `x${k} ${value <= bound * k ? "ok" : "NO"}`).join(" ")})`;

async function bootCarrier(page, hash) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(`/labs/globe-terrain/#${hash}`);
  await page.waitForFunction(
    () => window.__terrainCarrier?.ready || window.__terrainCarrier?.error,
    null,
    { timeout: 60_000 },
  );
  expect(await page.evaluate(() => window.__terrainCarrier.error)).toBeNull();
  return errors;
}

/** Waits until the view has loaded and stayed settled for 30 frames. */
const settle = (page, timeout = 240_000) =>
  page.waitForFunction(
    () => {
      const w = /** @type {any} */ (window);
      w.__calm = w.__terrainCarrier.settled() ? (w.__calm ?? 0) + 1 : 0;
      return w.__calm > 30;
    },
    null,
    { timeout, polling: "raf" },
  );

/** A fresh page at `hash`, settled, then `read(page)`. */
async function measured(browser, hash, read, contextOptions = {}) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = await bootCarrier(page, hash);
  await settle(page);
  const out = await read(page);
  await context.close();
  return { ...out, errors };
}

// WHY (F0b, DEC-FL-1): as shipped the library's heights read 0 m without
// OES_texture_float_linear; as R16F they must read what the CPU holds.
// Bound: 2 m (one half-float step at 1,000-2,048 m plus the read-back's
// 1 m resolution).
test("the relief's heights read on the GPU without the float-linear extension", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const r = await measured(
    browser,
    "carrier=terrain&alt=30&hideFloatLinear=1",
    async (page) => ({
      probe: await page.evaluate(() => window.__terrainCarrier.probeHeight()),
      state: await page.evaluate(() => window.__terrainCarrier.state()),
    }),
  );
  const off = Math.abs(r.probe.gpuMidwayM - r.probe.cpuMidwayM);
  console.log(
    `heights without float-linear: ${r.probe.internalFormat}, GPU ${r.probe.gpuMidwayM.toFixed(1)} m against CPU ${r.probe.cpuMidwayM.toFixed(1)} m, off ${below(off, 2)}; float-linear visible ${r.state.floatLinear}`,
  );
  expect(r.state.floatLinear).toBe(false);
  expect(r.probe.internalFormat).toBe("R16F");
  expect(r.probe.cpuMidwayM).toBeGreaterThan(100);
  expect(off).toBeLessThanOrEqual(2);
});

/** A dense grid over the frame's lower 65 %, every ~3 % of the width. */
const denseGrid = () => {
  const g = [];
  for (let y = 0.35; y <= 0.985; y += 0.025)
    for (let x = 0.015; x <= 0.985; x += 0.025) g.push([x, y]);
  return g;
};
const lum = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];

// WHY (F0b): the carrier must look like the globe where it has no relief
// to add: at noon, dusk and night, flat (height scale 0), against the
// globe's own surface at 150 km (imagery level 5). Before the range fix
// the noon imagery came from 20 degrees south (mean 45.9 levels apart).
// Bounds: mean 4 levels, 95th percentile 16 (texture filtering and tile
// levels differ between the two carriers).
test("the carrier wears the globe's look at noon, dusk and night", async ({
  browser,
}) => {
  test.setTimeout(1_200_000);
  const grid = denseGrid();
  const MEAN = 4;
  const P95 = 16;
  for (const [label, hour] of [
    ["noon", 11.4],
    ["dusk", 17.4],
    ["night", 23.4],
  ]) {
    const read = async (page) => ({
      px: await page.evaluate(
        (g) => window.__terrainCarrier.readPixels(g),
        grid,
      ),
    });
    const globe = await measured(
      browser,
      `carrier=globe&alt=150&time=${hour}`,
      read,
    );
    const flat = await measured(
      browser,
      `carrier=terrain&alt=150&time=${hour}&heightScale=0`,
      read,
    );
    const diffs = globe.px
      .map((p, i) => {
        const q = flat.px[i];
        return (
          (Math.abs(p[0] - q[0]) +
            Math.abs(p[1] - q[1]) +
            Math.abs(p[2] - q[2])) /
          3
        );
      })
      .sort((a, b) => a - b);
    const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
    const p95 = diffs[Math.floor(diffs.length * 0.95)] ?? 0;
    const meanLum = (px) => px.reduce((s, p) => s + lum(p), 0) / px.length;
    console.log(
      `look at ${label} (${hour} h UTC), 150 km, ${grid.length} points: mean |difference| ${below(mean, MEAN)}, 95th percentile ${below(p95, P95)}; mean luminance globe ${meanLum(globe.px).toFixed(1)}, carrier ${meanLum(flat.px).toFixed(1)}`,
    );
    expect([...globe.errors, ...flat.errors]).toEqual([]);
    expect(mean).toBeLessThanOrEqual(MEAN);
    expect(p95).toBeLessThanOrEqual(P95);
  }
});

// WHY (F0b, the data budget on a phone): how many height tiles one descent
// asks for, at the library's recommended error target (1) and two coarser
// ones, on a 390 x 844 phone at pixel ratio 2. The requests are written
// out so their real Terrarium sizes can be summed (synthetic PNGs are not
// representative); the count is logged here.
test("the data one descent asks for, at three error targets, on a phone", async ({
  browser,
}) => {
  test.setTimeout(1_800_000);
  mkdirSync("test-results/globe-terrain", { recursive: true });
  for (const errorTarget of [1, 2, 4]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await bootCarrier(
      page,
      `carrier=terrain&alt=1000&errorTarget=${errorTarget}`,
    );
    const views = [];
    for (const alt of [1000, 150, 30, 5]) {
      await page.evaluate((a) => window.__terrainCarrier.setAlt(a), alt);
      await settle(page);
      const s = await page.evaluate(() => window.__terrainCarrier.state());
      views.push({
        alt,
        requests: s.heightRequests.length,
        visible: s.visibleTiles,
      });
    }
    const s = await page.evaluate(() => window.__terrainCarrier.state());
    const byLevel = {};
    for (const r of s.heightRequests) {
      const z = r.split("/")[0];
      byLevel[z] = (byLevel[z] ?? 0) + 1;
    }
    writeFileSync(
      `test-results/globe-terrain/requests-et${errorTarget}.json`,
      JSON.stringify(s.heightRequests),
    );
    console.log(
      `descent at error target ${errorTarget} (drawing buffer ${s.drawingBuffer.join("x")}): ${s.heightRequests.length} height tiles ${JSON.stringify(byLevel)}; cumulative per view ${views.map((v) => `${v.alt} km ${v.requests} (${v.visible} visible)`).join(", ")}`,
    );
    expect(s.heightRequests.length).toBeGreaterThan(0);
    await context.close();
  }
});

// WHY (F0b, a dense seam scan): looking straight down, no ridge hides
// another, so every step in the height grey between neighbouring pixels
// beyond what the terrain's own slope gives (under 1.5 levels a pixel for
// these synthetic ridges) is a seam; the background (magenta) showing
// through is a crack. Bounds: no cracks; steps over 6 levels (about 70 m)
// on at most 1e-4 of the pixels; reported at 3, 6 and 12 levels.
test("no cracks and no seams between the relief's tiles", async ({
  browser,
}) => {
  test.setTimeout(900_000);
  const STEP_SHARE = 1e-4;
  for (const alt of [30, 5]) {
    const r = await measured(
      browser,
      `carrier=terrain&alt=${alt}&nadir=1&debug=height`,
      async (page) => ({
        scan: await page.evaluate(() =>
          window.__terrainCarrier.seamScan(0, [3, 6, 12]),
        ),
        state: await page.evaluate(() => window.__terrainCarrier.state()),
      }),
    );
    const share = r.scan.steps.map((n) => n / r.scan.pixels);
    console.log(
      `seam scan straight down at ${alt} km: ${r.scan.pixels} pixels, ${r.state.visibleTiles} tiles ${JSON.stringify(r.state.visibleByDepth)}; grey ${r.scan.greyRange.join("-")} levels; cracks ${r.scan.holes}; steps over 3/6/12 levels ${r.scan.steps.join("/")} (share over 6: ${below(share[1] ?? 0, STEP_SHARE)})`,
    );
    expect(r.errors).toEqual([]);
    // Not vacuous: the frame shows relief (a grey range of at least 20
    // levels, about 235 m), so a step would have something to break.
    expect(r.scan.greyRange[1] - r.scan.greyRange[0]).toBeGreaterThanOrEqual(
      20,
    );
    expect(r.scan.holes).toBe(0);
    expect(share[1]).toBeLessThanOrEqual(STEP_SHARE);
  }
});
