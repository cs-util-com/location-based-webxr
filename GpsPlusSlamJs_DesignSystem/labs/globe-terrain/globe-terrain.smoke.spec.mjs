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

/** Mean and 95th percentile of the per-point colour difference of two reads. */
const compare = (a, b) => {
  const diffs = a
    .map((p, i) => {
      const q = b[i];
      return (
        (Math.abs(p[0] - q[0]) +
          Math.abs(p[1] - q[1]) +
          Math.abs(p[2] - q[2])) /
        3
      );
    })
    .sort((x, y) => x - y);
  return {
    mean: diffs.reduce((s, d) => s + d, 0) / diffs.length,
    p95: diffs[Math.floor(diffs.length * 0.95)] ?? 0,
  };
};
const meanLum = (px) => px.reduce((s, p) => s + lum(p), 0) / px.length;
const readGrid = (grid) => async (page) => ({
  px: await page.evaluate((g) => window.__terrainCarrier.readPixels(g), grid),
  levels: (await page.evaluate(() => window.__terrainCarrier.state()))
    .visibleByLevel,
});

// WHY (F0b; review 2026-10-02-1235 minor 6): the carrier must look like the globe
// where it has no relief to add, flat (height scale 0), against the
// globe's own surface, at 150 km (imagery level 5), where the flight holds
// on the carrier: noon, dusk, night and noon at 70 N. Before the range
// fix the noon imagery came from 20 degrees south (mean 45.9 levels
// apart). Bounds: mean 4 levels, 95th percentile 16 (texture filtering
// and tile levels differ between the two carriers). And the relief must
// show: at E 3 the frame differs from the flat one.
// From 1,000 and 5,000 km the two are MEASURED, not held to the bound:
// there the globe's own surface draws (the altitude band, one-scene plan
// §3.2; globe-relief.smoke.spec.mjs holds the cross-fade continuous).
// Both pages draw with the sky fill off (skyShare=0): since DEC-GL5-14 the
// plain globe takes no fill outside the band while the relief takes it in
// full, so the fill is the one intended difference (19.9 levels at dusk
// in the 2026-10-04 run with the fill on); the globe lab's sky-fill smokes
// check the fill itself.
// The F1 measurement that set the band: at noon from 1,000 km mean 4.31
// levels, the carrier's library tiles coarser over part of the frame
// (levels 2-6, 40 tiles, against the globe's 2-5, 115 tiles).
test("the carrier wears the globe's look at the hold by day, dusk, night and at 70 N", async ({
  browser,
}) => {
  test.setTimeout(2_400_000);
  const grid = denseGrid();
  const MEAN = 4;
  const P95 = 16;
  // Where in the frame the two differ: the grid's upper rows (farther
  // ground) against its lower ones (the ground under the camera).
  const upper = grid.map(([, y]) => y < 0.65);
  const part = (px, keep) => px.filter((_, i) => upper[i] === keep);
  // Every view is measured and logged before any is asserted, so one
  // view's red does not hide the others.
  const results = [];
  for (const [label, view] of [
    ["noon, 150 km", "alt=150&time=11.4"],
    ["dusk, 150 km", "alt=150&time=17.4"],
    ["night, 150 km", "alt=150&time=23.4"],
    ["noon, 1,000 km (measured: the globe draws here)", "alt=1000&time=11.4"],
    ["noon, 5,000 km (measured: the globe draws here)", "alt=5000&time=11.4"],
    ["noon, 150 km at 70 N", "alt=150&time=11.4&lat=70&lng=20"],
  ]) {
    const globe = await measured(
      browser,
      `carrier=globe&${view}&skyShare=0`,
      readGrid(grid),
    );
    const flat = await measured(
      browser,
      `carrier=terrain&${view}&heightScale=0&skyShare=0`,
      readGrid(grid),
    );
    const c = compare(globe.px, flat.px);
    const far = compare(part(globe.px, true), part(flat.px, true));
    const near = compare(part(globe.px, false), part(flat.px, false));
    console.log(
      `look at ${label}, ${grid.length} points: mean |difference| ${below(c.mean, MEAN)}, 95th percentile ${below(c.p95, P95)} (upper rows mean ${far.mean.toFixed(2)}, lower rows ${near.mean.toFixed(2)}); mean luminance globe ${meanLum(globe.px).toFixed(1)}, carrier ${meanLum(flat.px).toFixed(1)}; tiles by level globe ${JSON.stringify(globe.levels)}, carrier ${JSON.stringify(flat.levels)}`,
    );
    results.push({
      label,
      c,
      held: !label.includes("measured"),
      errors: [...globe.errors, ...flat.errors],
    });
  }
  for (const { label, c, held, errors } of results) {
    expect(errors, label).toEqual([]);
    if (!held) continue;
    expect(c.mean, label).toBeLessThanOrEqual(MEAN);
    expect(c.p95, label).toBeLessThanOrEqual(P95);
  }
  const flat = await measured(
    browser,
    "carrier=terrain&alt=150&time=11.4&heightScale=0",
    readGrid(grid),
  );
  const relief = await measured(
    browser,
    "carrier=terrain&alt=150&time=11.4&heightScale=3",
    readGrid(grid),
  );
  const r = compare(flat.px, relief.px);
  console.log(
    `relief at E 3 against flat, 150 km noon: mean |difference| ${r.mean.toFixed(2)} levels (must exceed 1)`,
  );
  expect(r.mean).toBeGreaterThan(1);
});

/** Shares of `scan.pixels` with a neighbour step over each threshold. */
const shares = (scan) => scan.steps.map((n) => n / scan.pixels);
const readScan = async (page) => ({
  scan: await page.evaluate(() => window.__terrainCarrier.seamScan(0)),
  state: await page.evaluate(() => window.__terrainCarrier.state()),
});

// WHY (review 2026-10-02-1235 major 1): looking straight down, no ridge hides another,
// so a step between neighbouring pixels (both axes) beyond the terrain's
// own slope is a seam, and the background (magenta) showing through is a
// crack. Heights are read in two channels (0.125 m a step). Bounds: no
// cracks; steps over 30 m on at most STEP_SHARE (1e-4) of the pixels
// (reported at 10, 30 and 100 m); the frame must span at least 200 m of
// relief. The scan must also FIRE on a positive control (every tile's
// heights offset by up to 50 m), or it proves nothing. The control runs
// at the carrier's default error target (review 2026-10-03-1835 minor 6),
// the configuration the scan validates, and must reach 5 x STEP_SHARE
// over 30 m (reported at 2.5, 5 and 10 x): the planted seams' share
// follows the frame's tile edges (14 tiles at 30 km at the default, 9.96e-4
// measured; 35 tiles and 5.65e-3 at error target 1, also scanned).
test("no cracks and no seams between the relief's tiles, and the scan fires on a planted seam", async ({
  browser,
}) => {
  test.setTimeout(1_200_000);
  const STEP_SHARE = 1e-4;
  for (const [alt, et] of [
    [30, 1],
    [5, 1],
    [30, null],
  ]) {
    const r = await measured(
      browser,
      `carrier=terrain&alt=${alt}&nadir=1&debug=height${et === null ? "" : `&errorTarget=${et}`}`,
      readScan,
    );
    const s = shares(r.scan);
    console.log(
      `seam scan straight down at ${alt} km, error target ${et ?? "default"} (synthetic heights): ${r.scan.pixels} pixels, ${r.state.visibleTiles} tiles at levels ${JSON.stringify(r.state.visibleByLevel)}; heights ${r.scan.heightRangeM.map((v) => v.toFixed(0)).join("-")} m; cracks ${r.scan.holes}; steps over 10/30/100 m ${r.scan.steps.join("/")} (share over 30 m: ${below(s[1] ?? 0, STEP_SHARE)})`,
    );
    expect(r.errors).toEqual([]);
    expect(
      r.scan.heightRangeM[1] - r.scan.heightRangeM[0],
    ).toBeGreaterThanOrEqual(200);
    expect(r.scan.holes).toBe(0);
    expect(s[1]).toBeLessThanOrEqual(STEP_SHARE);
  }
  const control = await measured(
    browser,
    "carrier=terrain&alt=30&nadir=1&debug=height&seamControl=1",
    readScan,
  );
  const c = shares(control.scan);
  console.log(
    `seam scan, POSITIVE CONTROL (tiles offset by up to 50 m, the default error target, ${control.state.visibleTiles} tiles): steps over 10/30/100 m ${control.scan.steps.join("/")} (share over 30 m ${(c[1] ?? 0).toExponential(2)}; must reach 5 x ${STEP_SHARE}: ${[2.5, 5, 10].map((k) => `x${k} ${(c[1] ?? 0) >= k * STEP_SHARE ? "ok" : "NO"}`).join(" ")})`,
  );
  expect(c[1]).toBeGreaterThanOrEqual(5 * STEP_SHARE);
});

// WHY (review 2026-10-02-1235 major 3; one-scene plan §5): exaggerated sea floors sank
// 10-15 km under the water's imagery at E 3. With the synthetic heights
// lowered 1,500 m (a coast: valleys below 0), the drawn heights never go
// below 0, and over the sea the frame at E 3 matches the flat one (the
// sea keeps the globe's surface and colour), while over land it does not.
// Bounds: sea mean 1 level; land must differ by more.
test("the sea stays on the globe's surface at E 3: a coast", async ({
  browser,
}) => {
  test.setTimeout(900_000);
  const view = "carrier=terrain&alt=30&nadir=1&time=11.4&sea=1500";
  const heights = await measured(
    browser,
    `${view}&heightScale=3&debug=height`,
    readScan,
  );
  const grid = [];
  for (let y = 0.02; y <= 0.98; y += 0.02)
    for (let x = 0.02; x <= 0.98; x += 0.02) grid.push([x, y]);
  const height = await measured(
    browser,
    `${view}&heightScale=3&debug=height`,
    readGrid(grid),
  );
  const lit3 = await measured(browser, `${view}&heightScale=3`, readGrid(grid));
  const lit0 = await measured(browser, `${view}&heightScale=0`, readGrid(grid));
  const drawn = height.px.map((p) => (p[0] * 256 + p[1]) / 8 - 1000);
  const sea = drawn.map((h) => Math.abs(h) < 0.2);
  const pick = (px, want) => px.filter((_, i) => sea[i] === want);
  const seaDiff = compare(pick(lit0.px, true), pick(lit3.px, true));
  const landDiff = compare(pick(lit0.px, false), pick(lit3.px, false));
  console.log(
    `coast at E 3, 30 km straight down: drawn heights ${heights.scan.heightRangeM.map((v) => v.toFixed(1)).join(" to ")} m; ${sea.filter(Boolean).length} of ${grid.length} points sea; E 3 against flat: sea mean ${below(seaDiff.mean, 1)}, land mean ${landDiff.mean.toFixed(2)}`,
  );
  expect(heights.scan.heightRangeM[0]).toBeGreaterThanOrEqual(-0.2);
  expect(sea.filter(Boolean).length).toBeGreaterThan(grid.length * 0.05);
  expect(seaDiff.mean).toBeLessThanOrEqual(1);
  expect(landDiff.mean).toBeGreaterThan(seaDiff.mean);
});

// WHY (F0b, the data budget on a phone): how many height tiles one descent
// asks for, at the library's recommended error target (1) and two coarser
// ones, on a 390 x 844 phone at pixel ratio 2. The requests are written
// out; `terrarium-bytes.mjs` sums their real Terrarium sizes. Synthetic
// heights here; the real-height run is the live suite below.
async function descent(browser, heights, errorTarget) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await bootCarrier(
    page,
    `carrier=terrain&alt=1000&errorTarget=${errorTarget}&heights=${heights}`,
  );
  const views = [];
  for (const alt of [1000, 150, 30, 5]) {
    await page.evaluate((a) => window.__terrainCarrier.setAlt(a), alt);
    await settle(page, 600_000);
    const s = await page.evaluate(() => window.__terrainCarrier.state());
    views.push({
      alt,
      requests: s.heightRequests.length,
      visible: s.visibleTiles,
    });
  }
  const s = await page.evaluate(() => window.__terrainCarrier.state());
  await context.close();
  const byLevel = {};
  for (const r of s.heightRequests) {
    const z = r.split("/")[0];
    byLevel[z] = (byLevel[z] ?? 0) + 1;
  }
  mkdirSync("test-results/globe-terrain", { recursive: true });
  writeFileSync(
    `test-results/globe-terrain/requests-${heights}-et${errorTarget}.json`,
    JSON.stringify(s.heightRequests),
  );
  console.log(
    `descent on ${heights} heights at error target ${errorTarget} (drawing buffer ${s.drawingBuffer.join("x")}): ${s.heightRequests.length} height tiles ${JSON.stringify(byLevel)}; cumulative per view ${views.map((v) => `${v.alt} km ${v.requests} (${v.visible} visible)`).join(", ")}`,
  );
  return s.heightRequests.length;
}

test("the data one descent asks for, at three error targets, on a phone", async ({
  browser,
}) => {
  test.setTimeout(1_800_000);
  for (const errorTarget of [1, 2, 4]) {
    expect(await descent(browser, "synthetic", errorTarget)).toBeGreaterThan(0);
  }
});

// ---- Live: the real Terrarium tiles (network, opt-in) ----
// GLOBE_TERRAIN_LIVE=1 runs these (review 2026-10-02-1235 majors 1, 2 and 4); they
// fetch from AWS, so the default gate skips them.
const live = process.env.GLOBE_TERRAIN_LIVE === "1";

test.describe("on the real Terrarium heights (GLOBE_TERRAIN_LIVE=1)", () => {
  test.skip(!live, "network: set GLOBE_TERRAIN_LIVE=1");

  test("the seam scan on real tiles over the Alps", async ({ browser }) => {
    test.setTimeout(1_800_000);
    for (const alt of [30, 5]) {
      const r = await measured(
        browser,
        `carrier=terrain&alt=${alt}&nadir=1&debug=height&heights=terrarium&lat=45.9&lng=7.0`,
        readScan,
      );
      const s = shares(r.scan);
      console.log(
        `seam scan straight down at ${alt} km (REAL heights, 45.9 N 7.0 E): ${r.scan.pixels} pixels, ${r.state.visibleTiles} tiles at levels ${JSON.stringify(r.state.visibleByLevel)}; heights ${r.scan.heightRangeM.map((v) => v.toFixed(0)).join("-")} m; cracks ${r.scan.holes}; steps over 10/30/100 m ${r.scan.steps.join("/")} (share over 30 m: ${below(s[1] ?? 0, 1e-4)})`,
      );
      expect(r.scan.holes).toBe(0);
    }
  });

  // review 2026-10-02-1235 major 2: half-float steps (2-4 m above 2,048 m) against a
  // 26 m texel at E 3 could band the bump shading at a low sun. Measured
  // over Mont Blanc (45.83 N 6.86 E, above 3,000 m), the sun 10 degrees up
  // (16.6 h UTC on the equinox), E 3: R16F against R32F (the extension is
  // there in this browser). Switch to R32F with NEAREST and a manual
  // bilinear (DEC-FL-1) only if the 95th percentile exceeds 6 levels.
  test("half-float against 32-bit heights in the shading at a low sun, above 3,000 m", async ({
    browser,
  }) => {
    test.setTimeout(1_800_000);
    const grid = denseGrid();
    for (const alt of [30, 5]) {
      const view = `carrier=terrain&alt=${alt}&heights=terrarium&lat=45.83&lng=6.86&time=16.6&heightScale=3`;
      const r16 = await measured(browser, view, readGrid(grid));
      const r32 = await measured(
        browser,
        `${view}&heightFormat=r32f`,
        readGrid(grid),
      );
      const c = compare(r16.px, r32.px);
      console.log(
        `R16F against R32F at ${alt} km, sun 10 degrees up, E 3, over Mont Blanc: mean |difference| ${c.mean.toFixed(2)}, 95th percentile ${below(c.p95, 6)}`,
      );
    }
  });

  // review 2026-10-02-1235 major 4: the descent on real heights (sizes summed by
  // terrarium-bytes.mjs), and the error target picked by the look: at E 3,
  // 30 and 5 km, error targets 2 and 4 against 1; the coarsest whose 95th
  // percentile stays within 8 levels.
  test("the descent on real heights, and the error target by the look", async ({
    browser,
  }) => {
    test.setTimeout(3_600_000);
    for (const errorTarget of [1, 2, 4]) {
      await descent(browser, "terrarium", errorTarget);
    }
    const grid = denseGrid();
    for (const alt of [30, 5]) {
      const base = `carrier=terrain&alt=${alt}&heights=terrarium&lat=45.9&lng=7.0&heightScale=3`;
      const ref = await measured(
        browser,
        `${base}&errorTarget=1`,
        readGrid(grid),
      );
      for (const et of [2, 4]) {
        const other = await measured(
          browser,
          `${base}&errorTarget=${et}`,
          readGrid(grid),
        );
        const c = compare(ref.px, other.px);
        console.log(
          `error target ${et} against 1 at ${alt} km, E 3, real heights: mean |difference| ${c.mean.toFixed(2)}, 95th percentile ${below(c.p95, 8)}`,
        );
      }
    }
  });
});
