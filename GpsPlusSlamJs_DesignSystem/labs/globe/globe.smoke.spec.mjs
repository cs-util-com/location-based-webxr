// @ts-check
/**
 * The globe lab (globe plan 2026-09-26-0539 §7.8, M0-M2).
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
/**
 * The luminance spread (8-bit) a textured centre must exceed. Measured
 * 2026-09-26 (SwiftShader, 7x7 grid over the central 30 %): 38.7 with the
 * Blue Marble imagery, as soon as the first tiles load (M1's camera); 41.5
 * with M2's (fovY 50°, the disc fitted to 90 % of the height). A flat colour is
 * about 0 and M0's untextured lit sphere only a smooth shading gradient, a
 * few levels; the bound sits between with 2.5x headroom under the reading.
 */
const TEXTURE_MIN_SPREAD = 15;
/**
 * The M0-M1 checks were measured on this view: over North Africa and
 * Europe, arrived at once (no spin, no turn), so the pixels do not move.
 */
const FIXED_VIEW = "/labs/globe/#at=30,15&spinMs=0&turnMs=0";

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
    { timeout: 60_000 },
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
  ).map((px) => 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]);
  const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
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
      timeout: 60_000,
    },
  );
  const settled = await page.evaluate(() => window.__globeLab.state());
  expect(settled.loadingShown).toBe(true);
  expect(settled.loadingVisible).toBe(false);
  expect(settled.cachedBytes).toBeGreaterThan(0);
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
    { timeout: 60_000 },
  );
  const grid = [];
  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 9; j++) grid.push([0.3 + i * 0.05, 0.3 + j * 0.05]);
  }
  const px = await page.evaluate((g) => window.__globeLab.readPixels(g), grid);
  const holes = px.filter((p) => p[0] + p[1] + p[2] < 10).length;
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

/** Waits until the page has arrived at `target` and its tiles have settled. */
async function arriveAt(page, target) {
  await page.waitForFunction(
    ({ lat, lng }) => {
      const s = window.__globeLab.state();
      return (
        s.phase === "arrived" &&
        s.target?.lat === lat &&
        s.target?.lng === lng &&
        s.pendingTiles === 0 &&
        s.centreLatLon !== null
      );
    },
    target,
    { timeout: 60_000 },
  );
  return page.evaluate(() => window.__globeLab.state());
}

// WHY (globe plan §7.8, M2): the intro ends with the viewer's place at the
// centre of the screen. The unit tests prove the camera math; this proves
// it through the library's own frame (a ray against the drawn tiles,
// converted by the tiles' ellipsoid), for the awkward places too: the
// antimeridian, the Arctic, and the start's antipode, the longest turn.
// (Not the exact-antipode branch: the spin has moved a fraction of a degree
// by the first frame, so the turn follows the great circle that offset
// picks; the branch itself is unit-tested.)
test("turns to any target and holds it at the centre", async ({ page }) => {
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
