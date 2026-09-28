// @ts-check
/**
 * The terrain lab's smoke (terrain plan 2026-09-27-0605 §5 T1 and §9
 * findings 4, 7, 13, 14 and 15).
 *
 * Why this file matters: the lab's arithmetic is unit-tested beside it, but
 * only a browser shows that the pieces meet: the tiles are fetched and
 * decoded, the worker's grid reaches the GPU as half floats, the shader's
 * colours are the tested reference's, the exaggeration lifts the land by
 * exactly E, and nothing leaves this machine. Every tile request is served
 * from the committed fixtures or from synthetic tiles written here, and
 * every other request outside 127.0.0.1 is aborted AND recorded, so the
 * "no external request" check cannot pass by never having been asked.
 */
import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { terrariumPng } from "../../../scripts/e2e/terrarium-png.mjs";
import {
  NO_DATA_COLOURS,
  PASTEL_ATLAS,
  hexToRgb,
  landColour,
} from "./terrain-style.js";

/** The smoke server's origin: 5198, or a worktree's `DS_E2E_PORT`. */
const ORIGIN = `http://127.0.0.1:${process.env.DS_E2E_PORT ?? "5198"}`;
/** The tile URL the lab fetches (the Osm library's TERRARIUM_URL_TEMPLATE). */
const TERRARIUM =
  /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png$/;
const FIXTURES = fileURLToPath(
  new URL("./fixtures/terrarium/", import.meta.url),
);
/** The Blue Ridge region's tiles (fixtures/PROVENANCE.md). */
const REGION_TILES = [70, 71, 72].flatMap((x) =>
  [97, 98, 99].map((y) => `8/${x}/${y}`),
);

/**
 * Routes every request: this origin passes, a tile is answered by
 * `serveTile(key, record)` (a body, a status, or a promise of either),
 * anything else is aborted and recorded. Returns the record.
 */
async function routeAll(page, serveTile) {
  const record = { external: [], requested: [], served: 0, missing: [] };
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith(`${ORIGIN}/`)) return route.continue();
    const m = TERRARIUM.exec(url);
    if (!m) {
      record.external.push(url);
      return route.abort();
    }
    const key = `${m[1]}/${m[2]}/${m[3]}`;
    record.requested.push(key);
    const answer = await serveTile(key, record);
    if (answer.status !== 200) {
      return route.fulfill({ status: answer.status, body: "" });
    }
    record.served += 1;
    return route.fulfill({
      status: 200,
      contentType: "image/png",
      body: answer.body,
    });
  });
  return record;
}

/** The committed Blue Ridge tile for a key; a missing one is recorded. */
function fixtureTile(key, record) {
  const file = `${FIXTURES}${key}.png`;
  if (!existsSync(file)) {
    record.missing.push(key);
    return { status: 404 };
  }
  return { status: 200, body: readFileSync(file) };
}

/** Boots the lab at a hash and waits until it has drawn (or failed). */
async function boot(page, hash) {
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/labs/terrain/#${hash}`);
  await page.waitForFunction(
    () => window.__terrainLab?.ready || window.__terrainLab?.error,
    null,
    { timeout: 90_000 },
  );
  expect(await page.evaluate(() => window.__terrainLab.error)).toBeNull();
  return errors;
}

/** Sets the hash and waits until the page has applied it. */
async function applyHash(page, hash) {
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
  await page.waitForFunction(
    (h) => window.__terrainLab.state().appliedHash === h,
    hash,
  );
}

const state = (page) => page.evaluate(() => window.__terrainLab.state());
const luminance = (px) => 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2];

/** An n x n grid of normalised canvas points, `half` either side of `c`. */
const gridAround = (c, half, n) => {
  const points = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      points.push([
        c[0] - half + (2 * half * i) / (n - 1),
        c[1] - half + (2 * half * j) / (n - 1),
      ]);
    }
  }
  return points;
};

/**
 * The luminance spread (8-bit) the relief must exceed at the top preset: a
 * constant colour is 0, and the Blue Ridge's greens, ramp and shading give
 * far more. Measured 2026-09-27 (SwiftShader, a 9 x 9 grid over the middle
 * 30 %): 10.0, with the mean at 226.8; the bound sits at a third of that.
 */
const RELIEF_MIN_SPREAD = 3;

test("boots on the committed Blue Ridge tiles, and nothing leaves the machine", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const record = await routeAll(page, fixtureTile);
  const errors = await boot(page, "preset=top");
  await page.waitForFunction(() => window.__terrainLab.state().svfDone, null, {
    timeout: 90_000,
  });
  const s = await state(page);
  console.log(
    `terrain: ${JSON.stringify({ ...s, loadingHistory: s.loadingHistory })}`,
  );
  expect(errors).toEqual([]);
  expect(record.external).toEqual([]);
  expect(record.missing).toEqual([]);
  // Plan §9 finding 4: a POSITIVE count, equal to what was asked for, and
  // every committed tile used (the fixtures are exactly the region's).
  expect(record.served).toBeGreaterThan(0);
  expect(record.served).toBe(record.requested.length);
  expect([...record.requested].sort()).toEqual([...REGION_TILES].sort());
  expect(s.tiles.sort()).toEqual([...REGION_TILES].sort());
  expect(s.hasData).toBe(true);
  expect(s.missing).toBe(0);
  expect(s.errorText).toBe("");
  // The Blue Ridge has well over 500 m of relief across the region.
  expect(s.reliefM).toBeGreaterThan(500);
  // Plan §9 finding 13: half floats and bytes only, no FloatType texture.
  expect(Object.values(s.textureTypes)).not.toContain(s.floatType);
  expect(s.textureTypes.data).toBe(s.halfFloatType);
  // Default: the slider at 2, auto off, so E is exactly 2.
  expect(s.effectiveE).toBe(2);
  expect(s.readout).toContain("Exaggeration 2.0x");
  // Textured, not a flat colour, over the middle of the region.
  const lum = (
    await page.evaluate(
      (points) => window.__terrainLab.readPixels(points),
      gridAround([0.5, 0.5], 0.15, 9),
    )
  ).map(luminance);
  const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
  const spread = Math.sqrt(
    lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length,
  );
  console.log(
    `relief luminance: mean ${mean.toFixed(1)}, spread ${spread.toFixed(2)}`,
  );
  expect(spread).toBeGreaterThan(RELIEF_MIN_SPREAD);
  // The credits name the sources the tile set asks to be credited.
  const credits = await page.locator("#terrain-credits").textContent();
  for (const needed of [
    "courtesy of the U.S. Geological Survey",
    "National Oceanic and Atmospheric Administration",
    "Copernicus",
    "registry.opendata.aws/terrain-tiles",
  ]) {
    expect(credits).toContain(needed);
  }
});

test("shows its progress while tiles load and the relief computes", async ({
  page,
}) => {
  test.setTimeout(180_000);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await routeAll(page, async (key, record) => {
    await held;
    return fixtureTile(key, record);
  });
  await page.goto("/labs/terrain/#preset=top&svf=0");
  // The async-feedback rule: an in-progress state while the tiles are out.
  const label = page.locator("#terrain-loading");
  await expect(label).toBeVisible();
  await expect(label).toHaveText(/Loading elevation tiles: 0 of 9/);
  release();
  await page.waitForFunction(() => window.__terrainLab?.ready, null, {
    timeout: 90_000,
  });
  // ...and a final state once the relief is drawn: the line is gone.
  await expect(label).toBeHidden();
  const s = await state(page);
  expect(s.loadingHistory).toContain("Computing relief...");
  expect(s.loadingHistory.at(-1)).toBe("Computing relief...");
  expect(s.errorText).toBe("");
});

test("a tile that fails shows a no-data hatch and says so", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const FAILING = "8/72/99";
  await routeAll(page, (key, record) =>
    key === FAILING ? { status: 503 } : fixtureTile(key, record),
  );
  await boot(page, "preset=top&svf=0");
  const s = await state(page);
  expect(s.missingTiles).toBe(1);
  expect(s.missing).toBeGreaterThan(0);
  expect(s.missing).toBeLessThan(s.total);
  // Worded by post count (what the hatch shows), with the tile count.
  expect(s.errorText).toContain(
    `${s.missing} of ${s.total} height posts have no data (1 of 9 elevation tiles could not load)`,
  );
  await expect(page.locator("#terrain-error")).toBeVisible();
  // The region's south-east corner lies in that tile: it shows the hatch,
  // never a height colour (the heightfield fills its posts from the mean).
  const at = await page.evaluate(() =>
    window.__terrainLab.project([120_000, 0, 120_000]),
  );
  const px = await page.evaluate(
    (points) => window.__terrainLab.readPixels(points),
    gridAround(at, 0.004, 3),
  );
  const hatch = NO_DATA_COLOURS.map((hex) =>
    hexToRgb(hex).map((v) => Math.round(v * 255)),
  );
  for (const p of px) {
    const nearest = Math.min(
      ...hatch.map((h) => Math.max(...h.map((v, i) => Math.abs(v - p[i])))),
    );
    expect(nearest, `pixel ${p}`).toBeLessThanOrEqual(3);
  }
});

test("with every tile failing, the lab says so instead of drawing sea level", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await routeAll(page, () => ({ status: 503 }));
  await boot(page, "preset=top&svf=0");
  const s = await state(page);
  expect(s.hasData).toBe(false);
  expect(s.errorText).toContain("No elevation tile could load");
  expect(s.loadingVisible).toBe(false);
});

test("the auto switch multiplies the slider by the view's factor", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await routeAll(page, fixtureTile);
  // tau=0: no smoothing, so the factor is the camera's at once.
  await boot(page, "preset=top&svf=0&tau=0");
  expect((await state(page)).effectiveE).toBe(2);
  await applyHash(page, "preset=top&svf=0&tau=0&auto=1");
  let s = await state(page);
  // Plan §9 finding 9: W = 0.43 x 580 km, factor (W / 10 km)^0.3 = 2.62,
  // E = 2 x 2.62 = 5.25 (the product is not capped).
  expect(s.viewWidthM).toBeCloseTo(0.43 * 580_000, -2);
  expect(s.effectiveE).toBeCloseTo(2 * (s.viewWidthM / 10_000) ** 0.3, 3);
  expect(s.readout).toMatch(
    /Exaggeration 5\.[23]x \(slider 2 x auto 2\.6\d at a 249 km view\)/,
  );
  // At the low preset (W 8.6 km) the factor is 1 again.
  await applyHash(page, "preset=low&svf=0&tau=0&auto=1");
  s = await state(page);
  expect(s.autoFactor).toBe(1);
  expect(s.effectiveE).toBe(2);
});

/**
 * The flat-stays-flat tolerance (8-bit, per channel) between a rendered flat
 * pixel and `landColour` (the tested reference the shader mirrors). The LUT
 * quantises the ramp to bytes and interpolates between texels 19.5 m apart;
 * both are well under one level at 500 m. Swept and reported below.
 */
const FLAT_COLOUR_TOLERANCE = 2;

test("a constant-height tile keeps the same colours at every exaggeration", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const FLAT_M = 500;
  const flat = terrariumPng(256, 256, () => FLAT_M);
  await routeAll(page, () => ({ status: 200, body: flat }));
  await boot(page, "preset=top&svf=0&exag=1");
  const points = gridAround([0.5, 0.5], 0.1, 5);
  const expected = landColour(PASTEL_ATLAS, FLAT_M, 0).map((v) =>
    Math.round(v * 255),
  );
  let reference = null;
  for (const e of [1, 2, 5, 10]) {
    await applyHash(page, `preset=top&svf=0&exag=${e}`);
    expect((await state(page)).effectiveE).toBe(e);
    const px = await page.evaluate(
      (p) => window.__terrainLab.readPixels(p),
      points,
    );
    reference ??= px;
    // Identical, pixel for pixel, whatever the exaggeration.
    expect(px).toEqual(reference);
    const worst = Math.max(
      ...px.flatMap((p) => expected.map((v, i) => Math.abs(v - p[i]))),
    );
    const sweep = [0, 1, 2, 3].map(
      (t) => `${t}:${worst <= t ? "pass" : "fail"}`,
    );
    console.log(
      `flat at E=${e}: worst channel error ${worst} (${sweep.join(" ")})`,
    );
    expect(worst).toBeLessThanOrEqual(FLAT_COLOUR_TOLERANCE);
  }
});

/**
 * The tilted-plane tolerance (8-bit, per channel): a ground point's colour
 * across E, read where the page projects that point LIFTED by E. The
 * flat-tile check above cannot see the shading (a flat normal is flat at
 * any E); this one can: the plane faces east, into the shadow side of the
 * four lights, so a shading normal that followed E would darken it with E.
 * Sub-pixel placement of the projected point moves the ramp by under half a
 * level. Swept 0-3 and reported.
 */
const TILT_COLOUR_TOLERANCE = 2;

test("a tilted plane keeps each point's colour at every exaggeration (E is not in the normal)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  // Falling 2000 m per degree of longitude to the east, 3000 m at the
  // centre: 1200-4800 m over the sampled points, all land, on a 2.3 %
  // slope (7 % after the top view's slope boost).
  const LNG0 = -79.2;
  const heightAt = (lng) => 3000 - 2000 * (lng - LNG0);
  const lngOf = (x, col) => ((x * 256 + col + 0.5) / 65_536) * 360 - 180;
  const cache = new Map();
  await routeAll(page, (key) => {
    const x = Number(key.split("/")[1]);
    if (!cache.has(x)) {
      cache.set(
        x,
        terrariumPng(256, 256, (col) => heightAt(lngOf(x, col))),
      );
    }
    return { status: 200, body: cache.get(x) };
  });
  await boot(page, "preset=top&svf=0&tau=0&exag=1");
  const { datum } = await state(page);
  expect(datum).toBeCloseTo(heightAt(LNG0), 0);
  const lngs = [-0.9, -0.45, 0.2, 0.6, 0.9].map((d) => LNG0 + d);
  const xs = await page.evaluate(
    (ls) => ls.map((lng) => window.__terrainLab.toEnu(37.9, lng).x),
    lngs,
  );
  let reference = null;
  let worst = 0;
  for (const e of [1, 2, 5, 10]) {
    await applyHash(page, `preset=top&svf=0&tau=0&exag=${e}`);
    expect((await state(page)).effectiveE).toBe(e);
    const px = await page.evaluate(
      ({ points }) =>
        window.__terrainLab.readPixels(
          points.map((p) => window.__terrainLab.project(p)),
        ),
      { points: xs.map((x, i) => [x, e * (heightAt(lngs[i]) - datum), 0]) },
    );
    reference ??= px;
    const diff = Math.max(
      ...px.flatMap((p, i) =>
        [0, 1, 2].map((c) => Math.abs(p[c] - reference[i][c])),
      ),
    );
    worst = Math.max(worst, diff);
    const sweep = [0, 1, 2, 3].map(
      (t) => `${t}:${diff <= t ? "pass" : "fail"}`,
    );
    console.log(
      `tilted plane at E=${e}: worst channel change ${diff} (${sweep.join(" ")})`,
    );
  }
  expect(worst).toBeLessThanOrEqual(TILT_COLOUR_TOLERANCE);
});

test("a drag writes the pose to the hash once the damping has settled", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await routeAll(page, fixtureTile);
  await boot(page, "preset=oblique&svf=0");
  const box = await page.locator("#terrain-canvas").boundingBox();
  const cx = box.x + box.width * 0.4;
  const cy = box.y + box.height * 0.5;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy + 12, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(
    () => /(^|&)alt=/.test(location.hash.slice(1)),
    null,
    {
      timeout: 120_000,
    },
  );
  // Let any remaining motion run out: the pose must then hold still.
  await page.waitForFunction(
    () => {
      const p = window.__terrainLab.state().pose;
      // At the hash's resolution: the damping's last sub-millimetre steps
      // run on for seconds and are not what a link can express.
      const key = [
        p.altitudeM.toFixed(0),
        p.tiltDeg.toFixed(2),
        p.headingDeg.toFixed(2),
      ].join();
      const w = window;
      if (w.__poseKey !== key) {
        w.__poseKey = key;
        w.__poseSince = performance.now();
        return false;
      }
      return performance.now() - w.__poseSince > 1500;
    },
    null,
    { timeout: 60_000, polling: 100 },
  );
  const { hash, pose } = await page.evaluate(() => ({
    hash: Object.fromEntries(new URLSearchParams(location.hash.slice(1))),
    pose: window.__terrainLab.state().pose,
  }));
  console.log(
    `drag: hash ${JSON.stringify(hash)}, settled pose ${JSON.stringify(pose)}`,
  );
  // The link opens the view the camera stopped at, to the hash's resolution.
  expect(Math.abs(Number(hash.alt) - pose.altitudeM)).toBeLessThanOrEqual(1);
  expect(Math.abs(Number(hash.tilt) - pose.tiltDeg)).toBeLessThanOrEqual(0.02);
  const dh =
    ((((Number(hash.head) - pose.headingDeg) % 360) + 540) % 360) - 180;
  expect(Math.abs(dh)).toBeLessThanOrEqual(0.02);
  expect(hash.preset).toBeUndefined();
});

/**
 * The ridge-proportionality tolerance: the measured silhouette's error
 * against the page's own projection of the crest lifted by E, as a fraction
 * of the ridge's projected height. Swept over 2-10 % (plan §9 finding 7)
 * and reported; asserted at the declared value. Measured 2026-09-27: 0.7,
 * 0.7 and 0.3 px off (1.4 %, 0.6 %, 0.1 %) at E = 1, 2, 5, passing at every
 * tolerance of the sweep; the projected heights ran 1.00 : 2.00 : 5.02.
 */
const RIDGE_TOLERANCE = 0.05;
const RIDGE_TOLERANCE_SWEEP = [0.02, 0.04, 0.06, 0.08, 0.1];

test("the exaggeration raises a ridge's screen height in proportion", async ({
  page,
}) => {
  test.setTimeout(240_000);
  // A north-south ridge 22 km west of the centre, on a 300 m plain: the
  // plain is the datum, so the crest stands PEAK_M above it at E = 1. The
  // tile's pixel centre longitude is linear in its world pixel (z8).
  const BASE_M = 300;
  const PEAK_M = 2500;
  const RIDGE_LNG = -79.2 - 0.25;
  const SIGMA_DEG = 0.05;
  const lngOf = (x, col) => ((x * 256 + col + 0.5) / 65_536) * 360 - 180;
  const ridge = (x) =>
    terrariumPng(256, 256, (col) => {
      const d = (lngOf(x, col) - RIDGE_LNG) / SIGMA_DEG;
      return BASE_M + PEAK_M * Math.exp(-0.5 * d * d);
    });
  const cache = new Map();
  await routeAll(page, (key) => {
    const x = Number(key.split("/")[1]);
    if (!cache.has(x)) cache.set(x, ridge(x));
    return { status: 200, body: cache.get(x) };
  });
  // A side view: 300 m up, 1° below the horizontal, looking west at the
  // ridge from the east, so the crest stands against the page's background.
  const view = "svf=0&tau=0&alt=300&tilt=89&head=270";
  await boot(page, `${view}&exag=1`);
  const { datum } = await state(page);
  expect(datum).toBeCloseTo(BASE_M, 0);
  const ridgeX = (
    await page.evaluate(
      (lng) => window.__terrainLab.toEnu(37.9, lng),
      RIDGE_LNG,
    )
  ).x;
  // The scan keys on the background colour: a top corner (open sky) must
  // read as it, or every row would "differ" and the scan stop at row 0
  // (which is how the first version of this check failed).
  const [corner] = await page.evaluate(() =>
    window.__terrainLab.readPixels([[0.02, 0.02]]),
  );
  const bg = await page.evaluate(() => window.__terrainLab.background);
  for (const c of [0, 1, 2]) {
    expect(Math.abs(corner[c] - bg[c])).toBeLessThanOrEqual(2);
  }
  const columns = [0.45, 0.5, 0.55];
  // Normalised canvas units to CSS pixels: the canvas's own height, not
  // the viewport's assumed 800.
  const canvasPx = await page.evaluate(
    () => document.getElementById("terrain-canvas").clientHeight,
  );
  const results = [];
  for (const e of [1, 2, 5]) {
    await applyHash(page, `${view}&exag=${e}`);
    const [crest, foot, measured] = await page.evaluate(
      ({ x, lift, cols }) => [
        window.__terrainLab.project([x, lift, 0]),
        window.__terrainLab.project([x, 0, 0]),
        window.__terrainLab.silhouette(cols),
      ],
      { x: ridgeX, lift: e * (BASE_M + PEAK_M - datum), cols: columns },
    );
    const top = [...measured].sort((a, b) => a - b)[1]; // the median column
    const heightPx = (foot[1] - crest[1]) * canvasPx;
    const measuredPx = (foot[1] - top) * canvasPx;
    const errorPx = Math.abs(top - crest[1]) * canvasPx;
    results.push({
      e,
      heightPx,
      measuredPx,
      errorPx,
      relative: errorPx / heightPx,
    });
  }
  const base = results[0].measuredPx;
  for (const r of results) {
    const sweep = RIDGE_TOLERANCE_SWEEP.map(
      (t) => `${t * 100}%:${r.relative <= t ? "pass" : "fail"}`,
    );
    console.log(
      `ridge E=${r.e}: projected ${r.heightPx.toFixed(1)} px, measured ${r.measuredPx.toFixed(1)} px (${(r.measuredPx / base).toFixed(2)}x E=1), ` +
        `silhouette off by ${r.errorPx.toFixed(1)} px = ${(100 * r.relative).toFixed(1)}% (${sweep.join(" ")})`,
    );
  }
  // The one assertion: the RENDERED crest is where E x its height projects,
  // at every E (the projection's perspective, not the lab, bends the ratio
  // off exactly E). A ratio of the projected heights alone could not fail:
  // both sides would be the test's own arithmetic.
  for (const r of results)
    expect(r.relative).toBeLessThanOrEqual(RIDGE_TOLERANCE);
});

test("the fly-in descends from 600 km to 20 km", async ({ page }) => {
  test.setTimeout(180_000);
  await routeAll(page, fixtureTile);
  await boot(page, "preset=fly&flyMs=2000&svf=0");
  await page.waitForFunction(
    () => window.__terrainLab.state().flight.phase === "done",
    null,
    { timeout: 60_000 },
  );
  const { flight, altitudeM } = await state(page);
  expect(flight.samples[0]).toBeGreaterThan(550_000);
  expect(flight.samples.at(-1)).toBe(20_000);
  for (let i = 1; i < flight.samples.length; i++) {
    expect(flight.samples[i]).toBeLessThanOrEqual(flight.samples[i - 1]);
  }
  expect(altitudeM).toBeCloseTo(20_000, -1);
});

test("the plate writes the hash, and the link restores the view", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await routeAll(page, fixtureTile);
  await boot(page, "preset=top&svf=0");
  await page.locator('input[data-hash-key="exag"]').fill("4.5");
  await page.locator('select[data-hash-key="auto"]').selectOption("1");
  await page.waitForFunction(() => /exag=4\.5/.test(location.hash));
  const hash = await page.evaluate(() => location.hash.slice(1));
  expect(hash).toContain("auto=1");
  expect((await state(page)).exag).toBe(4.5);
  await page.goto("about:blank");
  await boot(page, hash);
  expect(await page.locator('input[data-hash-key="exag"]').inputValue()).toBe(
    "4.5",
  );
  expect(await page.locator('select[data-hash-key="auto"]').inputValue()).toBe(
    "1",
  );
  const s = await state(page);
  expect(s.exag).toBe(4.5);
  expect(s.readout).toContain("slider 4.5");
});
