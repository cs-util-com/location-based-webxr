// @ts-check
/**
 * The globe lab (globe plan 2026-09-26-0539 §7.8, M0-M4).
 *
 * Why this file matters: M0 retires the biggest unknown of the globe intro:
 * 3d-tiles-renderer under an import map, served no-build, on SwiftShader.
 * It must boot without an error, draw a lit Earth in the middle of the
 * frame with space in the corners, and never leave this machine: the page
 * promises no backend and no keys (DEC-PRG-3), so every request that is not
 * to 127.0.0.1 is aborted AND recorded, and the record must stay empty.
 */
import { expect, test } from "@playwright/test";

import {
  applyHash,
  arriveAt,
  gridAround,
  luminance,
  meanOf,
  median,
} from "./globe-smoke-helpers.mjs";

/** The smoke server's origin: 5198, or a worktree's `DS_E2E_PORT` (3d/playwright.config.mjs). */
const ORIGIN = `http://127.0.0.1:${process.env.DS_E2E_PORT ?? "5198"}`;
/**
 * The luminance spread (8-bit) a textured centre must exceed. Measured
 * 2026-09-26 (SwiftShader, 7x7 grid over the central 30 %): 38.7 with the
 * Blue Marble imagery, as soon as the first tiles load (M1's camera); 41.5
 * with M2's (fovY 50°, the disc fitted to 90 % of the height); 54.4 with
 * M3's real sun, tone mapping and clouds. A flat colour is
 * about 0 and M0's untextured lit sphere only a smooth shading gradient, a
 * few levels; the bound sits between with 2.5x headroom under the reading.
 */
const TEXTURE_MIN_SPREAD = 15;
/**
 * The M0-M1 checks were measured on this view: over North Africa and
 * Europe, arrived at once (no spin, no turn), so the pixels do not move,
 * at 11:00 UTC on an equinox, when the sun stands over 16.9°E (M3's real sun
 * would otherwise put the view on the night side half the time). The cloud
 * drift is pinned off (`cloudDrift=0`: the clouds where M1-M4 measured
 * them), and so are the procedural stars and the Milky Way (`stars=0`,
 * `milkyWay=0`: the black sky the corner and hole checks were measured
 * on); both have their own checks in `globe-sky.smoke.spec.mjs`.
 */
const FIXED_VIEW =
  "/labs/globe/#at=30,15&spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z&cloudDrift=0&stars=0&milkyWay=0";

test("the globe boots, draws a lit Earth, and stays on this machine", async ({
  page,
}) => {
  // Two settle waits of up to 120 s each: r745's CI runner timed out four
  // globe tests at 60 s (a view settles in 30-50 s locally, slower there).
  test.setTimeout(300_000);
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
  await page.goto(FIXED_VIEW);
  await page.waitForFunction(
    () => window.__globeLab?.ready || window.__globeLab?.error,
    null,
    { timeout: 90_000 },
  );
  expect(await page.evaluate(() => window.__globeLab.error)).toBeNull();
  // The surface arrives as tiles; wait until the one under the centre is
  // drawn. "Some tile has loaded" was not enough: the first may be on the
  // far side, and a warm run once read the centre black that way.
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return s.models > 0 && s.centreLatLon !== null;
    },
    null,
    { timeout: 120_000 },
  );
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
  ).map(luminance);
  const mean = meanOf(lum);
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
  // The async-feedback rule: a loading label while tiles were pending, gone
  // once they have all loaded; and the tile cache within its budget.
  await page.waitForFunction(
    () => window.__globeLab.state().pendingTiles === 0,
    null,
    {
      timeout: 120_000,
    },
  );
  const settled = await page.evaluate(() => window.__globeLab.state());
  expect(settled.loadingShown).toBe(true);
  expect(settled.loadingVisible).toBe(false);
  expect(settled.cachedBytes).toBeGreaterThan(0);
  // What the measure tool reads (measure-globe.mjs) is live, not a stub:
  // some bytes and at most the committed assets, textures on the GPU.
  expect(settled.loadedTiles).toBeGreaterThan(0);
  expect(settled.bytesDownloaded).toBeGreaterThan(0);
  expect(settled.bytesDownloaded).toBeLessThan(20 * 2 ** 20);
  expect(settled.rendererMemory.textures).toBeGreaterThan(0);
  expect(settled.refusedTiles).toBe(0);
  expect(settled.cachedBytes).toBeLessThanOrEqual(settled.cacheBudgetBytes);
  expect(state.radiusM).toBe(6378137);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

// WHY (owner decision DEC-PRG-14, globe plan §9): when a tile cannot load,
// its PARENT stays drawn over that area; the library alone would leave a
// hole, because it counts a failed child as ready. The recorded pnpm patch
// (patches/3d-tiles-renderer@0.5.3.patch) makes a failed child count as not
// ready. Measured 2026-09-26 with every level 2-3 tile answering 404: 81 of
// 81 probes black (a hole) with the unpatched library, 0 of 81 patched. The
// error box says what happened; the page throws nothing.
test("a tile that fails to load leaves its parent drawn, and says so", async ({
  page,
}) => {
  let failed = 0;
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/blue-marble-4326\/[23]\//.test(url)) {
      failed += 1;
      return route.fulfill({ status: 404, body: "" });
    }
    return route.continue();
  });
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  await page.goto(FIXED_VIEW);
  await page.waitForFunction(() => window.__globeLab?.ready, null, {
    timeout: 90_000,
  });
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return s.tileErrors > 0 && s.pendingTiles === 0 && s.models > 0;
    },
    null,
    { timeout: 120_000 },
  );
  const grid = [];
  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 9; j++) grid.push([0.3 + i * 0.05, 0.3 + j * 0.05]);
  }
  const px = await page.evaluate((g) => window.__globeLab.readPixels(g), grid);
  // A hole shows the black sky exactly. M3's exposure makes deep sea dark
  // too, (0,0,9) and (0,1,7) in this view with or without the failures, so
  // "nearly black" would count sea as holes.
  const holes = px.filter((p) => p[0] + p[1] + p[2] === 0).length;
  const state = await page.evaluate(() => window.__globeLab.state());
  console.log(
    `failed tiles: ${failed} routed, ${state.tileErrors} errors, ${holes} of 81 probes black`,
  );
  expect(failed).toBeGreaterThan(0);
  expect(holes).toBe(0);
  await expect(page.locator("#globe-error")).toContainText("could not load");
  expect(pageErrors).toEqual([]);
  // The library logs each failed tile itself, twice: its own line, then the
  // error (it does not check the HTTP status, so the empty 404 body fails to
  // decode). Nothing else may error.
  const LIBRARY_TILE_FAILURE =
    /TilesRenderer : Failed to load tile|The source image could not be decoded|404|Failed to load resource/;
  expect(consoleErrors.filter((t) => !LIBRARY_TILE_FAILURE.test(t))).toEqual(
    [],
  );
});

/** The great-circle angle between two lat/lng points, in degrees (haversine). */
function angleDeg(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / r;
}

/**
 * How close to the target the centre must land (globe plan §7.8, M2): 0.25°
 * is about 28 km, 2 px at the phone scale, the visual requirement. The gate
 * asserts 0.01° instead: measured 0.0008° for every target (all of it the
 * measuring ray's own offset), and a camera on the geodetic normal instead
 * of the geocentric ray misses by up to 0.19° (0.19° at Cologne), which
 * 0.25° would let through. The verdict is reported across the sweep (owner
 * rule 2026-09-13: a one-value verdict is provisional).
 */
const CENTRE_TOLERANCE_DEG = 0.01;
const CENTRE_SWEEP_DEG = [0.01, 0.1, 0.25, 0.5];

// WHY (globe plan §7.8, M2): the intro ends with the viewer's place at the
// centre of the screen. The unit tests prove the camera math; this proves
// it through the library's own frame (a ray against the drawn tiles,
// converted by the tiles' ellipsoid), for the awkward places too: the
// antimeridian, the Arctic, and the start's antipode, the longest turn.
// (Not the exact-antipode branch: the spin has moved a fraction of a degree
// by the first frame, so the turn follows the great circle that offset
// picks; the branch itself is unit-tested.)
test("turns to any target and holds it at the centre", async ({ page }) => {
  // Five settled views of up to 120 s each (see arriveAt).
  test.setTimeout(600_000);
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  const targets = [
    ["Cologne", { lat: 50.94, lng: 6.96 }],
    ["Tokyo", { lat: 35.68, lng: 139.77 }],
    ["the antimeridian", { lat: 0, lng: 179.9 }],
    ["the Arctic", { lat: 80, lng: -40 }],
    ["the spin start's antipode", { lat: -30, lng: -165 }],
  ];
  const at = ({ lat, lng }) => `at=${lat},${lng}&spinMs=0&turnMs=300`;
  await page.goto(`/labs/globe/#${at(targets[0][1])}`);
  await page.waitForFunction(() => window.__globeLab?.ready, null, {
    timeout: 90_000,
  });
  const misses = [];
  for (const [name, target] of targets) {
    await page.evaluate((hash) => {
      location.hash = hash;
    }, at(target));
    const state = await arriveAt(page, target);
    const miss = angleDeg(state.centreLatLon, target);
    misses.push([name, miss]);
    expect(state.source).toBe("url");
    expect(state.history.map((h) => h.phase)).toEqual([
      "spin",
      "turning",
      "arrived",
    ]);
  }
  const sweep = CENTRE_SWEEP_DEG.map(
    (tol) =>
      `${tol}°: ${misses.filter(([, m]) => m <= tol).length}/${misses.length}`,
  ).join(", ");
  console.log(
    `centre misses: ${misses.map(([n, m]) => `${n} ${m.toFixed(4)}°`).join(", ")}; within ${sweep}`,
  );
  for (const [, miss] of misses) {
    expect(miss).toBeLessThan(CENTRE_TOLERANCE_DEG);
  }
  expect(errors).toEqual([]);
});

// WHY (globe plan §7.5, DEC-PRG-10): with no target in the URL and no GPS in
// phase 1, the page must keep spinning while it waits, and only then fall
// back to OsmDemo's opening frame. Falling back at once would hide the wait
// the real page needs; never falling back would spin forever. The replay
// button runs the same sequence again.
test("waits for a fix, then falls back to Central Park; replay runs it again", async ({
  page,
}) => {
  // Two settled arrivals at a new view (see arriveAt).
  test.setTimeout(300_000);
  const spinMs = 400;
  await page.goto(`/labs/globe/#spinMs=${spinMs}&turnMs=300`);
  await page.waitForFunction(() => window.__globeLab?.ready, null, {
    timeout: 90_000,
  });
  const centralPark = { lat: 40.7677, lng: -73.9807 };
  const state = await arriveAt(page, centralPark);
  expect(state.history.map((h) => [h.phase, h.source])).toEqual([
    ["spin", "waiting"],
    ["turning", "fallback"],
    ["arrived", "fallback"],
  ]);
  expect(state.history[1].atMs).toBeGreaterThanOrEqual(spinMs);
  expect(angleDeg(state.centreLatLon, centralPark)).toBeLessThan(
    CENTRE_TOLERANCE_DEG,
  );
  expect(state.runs).toBe(1);
  await page.getByRole("button", { name: "Replay the turn" }).click();
  await page.waitForFunction(() => window.__globeLab.state().runs === 2);
  const replayed = await arriveAt(page, centralPark);
  expect(replayed.history.map((h) => h.source)).toEqual([
    "waiting",
    "fallback",
    "fallback",
  ]);
});

/**
 * The M3 checks' floors, from the first measured run (2026-09-26,
 * SwiftShader) and reported against that run:
 * - day: the mean luminance over the central 30 % at the subsolar point,
 *   measured 90.4 (an unlit or night globe is about 0);
 * - night: the brightest pixel over the central 20 % above Tokyo at 21:00
 *   local, measured 222 (with the night lights off, 0);
 * - glint: the median over a small grid at the specular point with the
 *   clouds off, measured 117 (matte water, roughness 1, 6.4);
 * - seam: per row, the jump across the 180° line against the largest
 *   ordinary jump on that row, the worst row (see the seam test).
 * The verdicts are reported across ±50 % of each floor (owner rule
 * 2026-09-13).
 */
const M3 = { day: 30, night: 40, glint: 40, seamRatio: 1.5 };
const SWEEP = [0.5, 1, 1.5];
const EQUINOX_NOON = "time=2026-03-20T12:00:00Z";

/**
 * Goes to `lat,lng` with the given extra hash, arrived and settled; the
 * cloud drift pinned off, so the clouds sit where M3 measured them.
 */
async function viewAt(page, lat, lng, extra) {
  await applyHash(
    page,
    `at=${lat},${lng}&spinMs=0&turnMs=0&cloudDrift=0&${extra}`,
  );
  return arriveAt(page, { lat, lng });
}

const readAt = (page, points) =>
  page.evaluate((p) => window.__globeLab.readPixels(p), points);

// WHY (globe plan §7.3, §7.8 M3): the Earth is lit by the real sun of the
// instant, and three terms ride on it: night lights on the dark side, a
// glint on smooth water, clouds. Each check below is also run once with its
// own term switched off through the hash, and must then FAIL: that is what
// proves the check can see its term, not merely that the page renders.
test("the real sun: a lit day side, night lights, and a water glint", async ({
  page,
}) => {
  // Nine settled views under SwiftShader: 1.3 min measured, near the
  // default 3 min limit on a loaded machine.
  test.setTimeout(300_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/labs/globe/#at=0,0&spinMs=0&turnMs=0&${EQUINOX_NOON}`);
  await page.waitForFunction(() => window.__globeLab?.ready, null, {
    timeout: 90_000,
  });
  const report = [];
  const check = (name, value, floor, off) => {
    report.push(
      `${name} ${value.toFixed(1)} (off ${off.toFixed(1)}; floor ${floor}: ` +
        SWEEP.map(
          (k) => `x${k} ${value > floor * k && off <= floor * k ? "ok" : "NO"}`,
        ).join(" ") +
        ")",
    );
    expect(value).toBeGreaterThan(floor);
    expect(off).toBeLessThanOrEqual(floor);
  };

  // The day side, centred on the subsolar point (the sun stands over about
  // 1.9°E at 12:00 UTC on the equinox); "off" is the same view at midnight.
  await viewAt(page, 0, 0, EQUINOX_NOON);
  const dayMean = (points) => meanOf(points.map(luminance));
  const day = dayMean(await readAt(page, gridAround([0.5, 0.5], 0.15, 7)));
  await viewAt(page, 0, 0, "time=2026-03-20T00:00:00Z");
  const dayOff = dayMean(await readAt(page, gridAround([0.5, 0.5], 0.15, 7)));
  check("day", day, M3.day, dayOff);

  // Tokyo at 21:00 local.
  const nightMax = async (extra) => {
    await viewAt(page, 35.68, 139.77, `${EQUINOX_NOON}${extra}`);
    const px = await readAt(page, gridAround([0.5, 0.5], 0.1, 9));
    return Math.max(...px.map(luminance));
  };
  check("night", await nightMax(""), M3.night, await nightMax("&nightGain=0"));
  // ...and none on the day side: Tokyo at noon local looks the same with the
  // night lights on and off (a lost terminator fade would light it).
  const tokyoNoon = async (extra) => {
    await viewAt(page, 35.68, 139.77, `time=2026-03-20T03:00:00Z${extra}`);
    return meanOf(
      (await readAt(page, gridAround([0.5, 0.5], 0.1, 9))).map(luminance),
    );
  };
  // Measured 0.00; 3.35 with the terminator fade removed (a one-time source
  // mutant), against a limit of 1.
  const noonLights = (await tokyoNoon("")) - (await tokyoNoon("&nightGain=0"));
  report.push(`night lights at noon ${noonLights.toFixed(2)}`);
  expect(Math.abs(noonLights)).toBeLessThan(1);

  // The specular point: half way between the camera (over 0,0) and the sun.
  // Clouds off, so the check sees the water, not a cloud above it.
  const glint = async (extra) => {
    const state = await viewAt(
      page,
      0,
      0,
      `${EQUINOX_NOON}&cloudOpacity=0${extra}`,
    );
    const [sx, sy, sz] = state.sunEcef;
    const n = Math.hypot(1 + sx, sy, sz);
    const lat = (Math.asin(sz / n) * 180) / Math.PI;
    const lng = (Math.atan2(sy, 1 + sx) * 180) / Math.PI;
    const at = await page.evaluate(
      ([a, b]) => window.__globeLab.project(a, b),
      [lat, lng],
    );
    return median((await readAt(page, gridAround(at, 0.01, 5))).map(luminance));
  };
  check("glint", await glint(""), M3.glint, await glint("&waterRoughness=1"));
  // The whole sun chain (solarPosition, then sunDirectionEcef) puts the sun
  // where the equation of time says: over 1.86°E at 12:00 UTC on this day
  // (it runs 7.45 min fast), so 91.86°E at 06:00. A mirrored chain would
  // put it over 91.9°W while every lit probe above still passed.
  await applyHash(page, "at=0,0&spinMs=0&turnMs=0&time=2026-03-20T06:00:00Z");
  const [x, y, z] = (await page.evaluate(() => window.__globeLab.state()))
    .sunEcef;
  const sunLng = (Math.atan2(y, x) * 180) / Math.PI;
  const sunLat = (Math.asin(z) * 180) / Math.PI;
  report.push(`sun at 06:00 over ${sunLat.toFixed(2)}, ${sunLng.toFixed(2)}`);
  expect(Math.abs(sunLng - 91.86)).toBeLessThan(0.5);
  expect(Math.abs(sunLat)).toBeLessThan(0.5);
  console.log(`M3 terms: ${report.join("; ")}`);
  expect(errors).toEqual([]);
});

// WHY (globe plan §7.3): the longitude wraps at 180°, and a texture read
// there with the raw derivative picks the coarsest mip, drawing a 1-px line
// down the Pacific. The line shows only where a 2x2 pixel quad straddles
// 180°: centred ON 180° it falls on a quad boundary and the image is the
// same with and without the fix. So the view is centred 1 px west of it
// (179.894° at 9.45 px per degree, 1280x800, fovY 50°), which puts the line
// in the middle of a quad with half a pixel to spare either way, and the
// test asserts that precondition rather than trusting it. The image is
// deterministic (committed maps, a pinned time). Measured: the worst row's
// jump across 180° is 0.67x the largest ordinary jump on that row, and
// 4.02x with the seam fix removed (a one-time source mutant).
const SEAM_VIEW_LNG = 179.894;
test("no seam at the 180° line", async ({ page }) => {
  await page.goto(
    `/labs/globe/#at=0,${SEAM_VIEW_LNG}&spinMs=0&turnMs=0&time=2026-03-20T00:00:00Z&cloudDrift=0`,
  );
  await page.waitForFunction(() => window.__globeLab?.ready, null, {
    timeout: 90_000,
  });
  await arriveAt(page, { lat: 0, lng: SEAM_VIEW_LNG });
  const width = await page.evaluate(
    () => document.getElementById("globe-canvas").width,
  );
  // Per row: the jump across 180° against the largest ordinary jump on the
  // SAME row, and the worst row counts. (Pooling rows let a real cloud edge
  // in one row hide the seam in another: measured, 1.48 without the fix.)
  const rows = [];
  for (const lat of [-3, 0, 3]) {
    const [u, v] = await page.evaluate(
      ([a, b]) => window.__globeLab.project(a, b),
      [lat, 180],
    );
    // The precondition: the pixels either side of the line (centres at
    // k + 0.5 and k + 1.5) share a quad, so k is even. Otherwise the test
    // could not fail.
    const k = Math.floor(u * width - 0.5);
    expect(k % 2, `180° at x = ${(u * width).toFixed(2)}`).toBe(0);
    const row = [];
    for (let i = -40; i <= 40; i++) row.push([u + i / width, v]);
    const lum = (await readAt(page, row)).map(luminance);
    const jumps = lum.slice(1).map((x, i) => Math.abs(x - lum[i]));
    const seam = Math.max(...jumps.slice(37, 43));
    const elsewhere = Math.max(...jumps.slice(0, 35), ...jumps.slice(45));
    rows.push({ lat, seam, elsewhere, ratio: seam / Math.max(elsewhere, 1) });
  }
  const ratio = Math.max(...rows.map((r) => r.ratio));
  console.log(
    `seam: ${rows.map((r) => `lat ${r.lat} ${r.seam.toFixed(1)}/${r.elsewhere.toFixed(1)}`).join(", ")}; worst ratio ${ratio.toFixed(2)}; ` +
      SWEEP.map((k) => `x${k} ${ratio < M3.seamRatio * k ? "ok" : "NO"}`).join(
        " ",
      ),
  );
  expect(ratio).toBeLessThan(M3.seamRatio);
});

// WHY (the async-feedback rule, globe plan §7.8): the three global maps load
// beside the tiles, the clouds being the largest single file. One that
// cannot load must say so in the error box, the loading label must still
// end, and the globe must still draw (the map reads as empty: no clouds).
test("a global map that fails to load is reported, and the globe still draws", async ({
  page,
}) => {
  await page.route("**/globe-assets/equirect/clouds-2048.jpg", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  await page.goto(FIXED_VIEW);
  await page.waitForFunction(() => window.__globeLab?.ready, null, {
    timeout: 90_000,
  });
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return (
        s.mapErrors === 1 &&
        s.mapsLoaded === 2 &&
        s.pendingTiles === 0 &&
        s.centreLatLon !== null
      );
    },
    null,
    { timeout: 120_000 },
  );
  await expect(page.locator("#globe-error")).toContainText(
    "maps could not load",
  );
  await expect(page.locator("#globe-loading")).toBeHidden();
  const [centre] = await readAt(page, [[0.5, 0.5]]);
  expect(luminance(centre)).toBeGreaterThan(20);
  expect(pageErrors).toEqual([]);
  expect(
    consoleErrors.filter((t) => !/404|Failed to load resource/.test(t)),
  ).toEqual([]);
});

// WHY (globe plan §7.8, M4): every tunable sits on the plate and in the
// hash, so a sweep link reproduces a view. Each control is driven once: it
// must write its key, the page must apply it without an error, and changing
// the time or the tuning must NOT restart the intro (only a new target or
// timing does), or every slider drag would replay the turn.
test("every control on the plate writes the hash and applies", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(FIXED_VIEW);
  await page.waitForFunction(() => window.__globeLab?.ready, null, {
    timeout: 90_000,
  });
  const keys = await page.evaluate(() =>
    [...document.querySelectorAll("[data-hash-key]")].map(
      (el) => el.dataset.hashKey,
    ),
  );
  expect(keys.sort()).toEqual(
    [
      "cacheMiB",
      "cloudDrift",
      "cloudOpacity",
      "errorTarget",
      "fovY",
      "milkyWay",
      "nightGain",
      "pixelRatio",
      "sky",
      "spinMs",
      "starGain",
      "starMag",
      "stars",
      "sunGlow",
      "sunIntensity",
      "sunSize",
      "timeScale",
      "turnMs",
      "waterRoughness",
    ].sort(),
  );
  const before = await page.evaluate(() => ({
    ...window.__globeLab.state(),
    historyLength: history.length,
  }));
  const runsBefore = before.runs;
  for (const key of keys) {
    // A select's first option that differs from its value; a slider's top.
    const value = await page.evaluate((k) => {
      const el = document.querySelector(`[data-hash-key="${k}"]`);
      el.value =
        el.tagName === "SELECT"
          ? [...el.options].find((o) => o.value !== el.value).value
          : el.max;
      el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input"));
      return el.value;
    }, key);
    await page.waitForFunction(
      ([k, v]) =>
        new URLSearchParams(window.__globeLab.state().appliedHash).get(k) === v,
      [key, value],
    );
  }
  const state = await page.evaluate(() => window.__globeLab.state());
  expect(state.sunIntensity).toBe(8);
  expect(state.fovY).toBe(80);
  expect(state.tuning).toEqual({
    nightGain: 4,
    waterRoughness: 1,
    cloudOpacity: 1,
  });
  expect(state.errorTarget).toBe(2);
  expect(state.cacheBudgetBytes).toBe(32 * 2 ** 20);
  expect(state.cacheFloorBytes).toBe(24 * 2 ** 20);
  expect(new URLSearchParams(state.appliedHash).get("pixelRatio")).toBe("1");
  // A wider field of view refits the camera closer.
  expect(state.distance).toBeLessThan(before.distance);
  // Only the two timing sliders restarted the intro, once each.
  expect(state.runs).toBe(runsBefore + 2);
  // Controls replace the history entry: ten changes, no back-button steps.
  expect(await page.evaluate(() => history.length)).toBe(before.historyLength);
  // The panel follows an edited hash (a pasted link): the slider and its
  // label show the new value.
  await applyHash(
    page,
    "at=30,15&spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z&nightGain=2.5",
  );
  expect(
    await page.evaluate(() => [
      document.querySelector('[data-hash-key="nightGain"]').value,
      document.querySelector('output[data-for="nightGain"]').textContent,
    ]),
  ).toEqual(["2.5", "2.5"]);
  // The hour sets #time= (UTC); "Now" removes it.
  await page.evaluate(() => {
    const hour = document.querySelector("[data-time-hour]");
    hour.value = "6";
    hour.dispatchEvent(new Event("input"));
  });
  await page.waitForFunction(() =>
    /T06:00:00/.test(
      new URLSearchParams(window.__globeLab.state().appliedHash).get("time") ??
        "",
    ),
  );
  await page.locator("[data-time-now]").click();
  await page.waitForFunction(
    () =>
      !new URLSearchParams(window.__globeLab.state().appliedHash).has("time"),
  );
  expect(errors).toEqual([]);
});

// WHY (globe plan §7.2, M4 review): the pixel-ratio cap decides how sharp
// the tiles refine on a phone, and a DPR-1 test browser cannot see the cap
// act at all (min(1, cap) is 1). So a DPR-2 context: the default cap of 2
// renders at 2, and the plate's lower cap takes effect.
test.describe("on a DPR-2 screen", () => {
  test.use({ deviceScaleFactor: 2 });
  test("the pixel-ratio cap defaults to 2 and the plate lowers it", async ({
    page,
  }) => {
    await page.goto(FIXED_VIEW);
    await page.waitForFunction(() => window.__globeLab?.ready, null, {
      timeout: 90_000,
    });
    expect(
      await page.evaluate(() => window.__globeLab.state().pixelRatio),
    ).toBe(2);
    await page.locator('[data-hash-key="pixelRatio"]').selectOption("1.5");
    await page.waitForFunction(
      () => window.__globeLab.state().pixelRatio === 1.5,
    );
  });
});

// WHY (the async-feedback rule, M4 review): on a phone the plate spans
// nearly the whole width, so it must not cover the loading and error lines
// that report the imagery. Checked at a phone's size with an error showing.
test.describe("on a phone-width screen", () => {
  test.use({ viewport: { width: 412, height: 915 } });
  test("the status lines sit below the folded plate", async ({ page }) => {
    await page.route("**/globe-assets/equirect/clouds-2048.jpg", (route) =>
      route.fulfill({ status: 404, body: "" }),
    );
    await page.goto(FIXED_VIEW);
    await page.waitForFunction(
      () =>
        window.__globeLab?.ready && window.__globeLab.state().mapErrors === 1,
      null,
      { timeout: 90_000 },
    );
    const rects = await page.evaluate(() => {
      const box = (el) => el.getBoundingClientRect().toJSON();
      return {
        plate: box(document.querySelector(".lookdev-panel")),
        error: box(document.getElementById("globe-error")),
        loadingTop: parseFloat(
          getComputedStyle(document.getElementById("globe-loading")).top,
        ),
        folded: document
          .querySelector(".lookdev-head")
          .getAttribute("aria-expanded"),
      };
    });
    expect(rects.folded).toBe("false");
    expect(rects.error.height).toBeGreaterThan(0);
    expect(rects.error.top).toBeGreaterThanOrEqual(rects.plate.bottom);
    expect(rects.loadingTop).toBeGreaterThanOrEqual(rects.plate.bottom);
  });
});
