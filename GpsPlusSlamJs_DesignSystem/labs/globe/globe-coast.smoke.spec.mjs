// @ts-check
/**
 * The globe's coasts under the sun's glint (round-4 plan 2026-09-28-2105
 * DEC-GL4-6).
 *
 * Why this file matters: the owner saw a bright white line along coasts
 * near the sun's reflection on the sea, zoomed in. The glint is the water's
 * low roughness, and WHERE the surface counts as water came from one
 * 2048 px global mask (about 20 km a pixel at the equator), four times
 * coarser than the imagery it is drawn over. So along a coast the water's
 * roughness, and with it the glint, reaches onto the land the imagery
 * shows: bright desert plus a glint is brighter than either the desert or
 * the sea, which is a bright line. Only pixels can show it, measured
 * against the same view with the glint off (the water as rough as the
 * land), so the difference is the glint and nothing else.
 */
import { expect, test } from "@playwright/test";

import { luminance, meanOf, routeCityData } from "./globe-smoke-helpers.mjs";

const ORIGIN = `http://127.0.0.1:${process.env.DS_E2E_PORT ?? "5198"}`;

/**
 * The Namib desert's coast, south of Walvis Bay: bright sand against dark
 * sea, running north to south, so a row of pixels crosses it. The sun is
 * over it at 11:00 UTC on the December solstice (subsolar latitude -23.4°,
 * solar noon at 14.5°E about 11:00 UTC), so the glint is centred under a
 * camera looking straight down.
 */
const COAST = { latitude: -24, longitude: 14.5 };
const NOON = "time=2025-12-21T11:00:00Z";
/**
 * The template material's roughness: water this rough is land, so the
 * glint's own contribution is (glint on) - (glint off).
 */
const LAND_ROUGHNESS = 0.9;

/**
 * The view: held over the coast at `altKm` after a short dive (the pin's,
 * with the hand-over off), clouds off so the sea is seen, drift off.
 */
async function holdOverCoast(page, context, altKm) {
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(COAST);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const hash = `at=${COAST.latitude},${COAST.longitude}&spinMs=0&turnMs=0&${NOON}&cloudDrift=0&cloudOpacity=0&stars=0&atmo=0&diveMs=1000&handOver=0&handOverKm=${altKm}`;
  // The pin press starts the arrival prefetch: its city data is answered here.
  await routeCityData(page);
  await page.goto(`/labs/globe/#${hash}`);
  await page.waitForFunction(() => window.__globeLab?.ready, null, {
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => window.__globeLab.state().phase === "arrived",
    null,
    { timeout: 60_000 },
  );
  await page.locator("#globe-pin").click();
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return s.phase === "landed" && s.pin.phase === "idle";
    },
    null,
    { timeout: 60_000 },
  );
  // Settled: nothing pending and the tile count still for a second.
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      const w = window;
      const key = `${s.loadedTiles}`;
      if (s.pendingTiles !== 0 || s.mapsLoaded !== s.mapsTotal) {
        w.__coastKey = null;
        return false;
      }
      if (w.__coastKey !== key) {
        w.__coastKey = key;
        w.__coastSince = performance.now();
        return false;
      }
      return performance.now() - w.__coastSince >= 1000;
    },
    null,
    { timeout: 90_000, polling: 100 },
  );
  return { errors, hash };
}

/** Luminance along the canvas's middle row, `n` samples edge to edge. */
async function middleRow(page, n) {
  const points = Array.from({ length: n }, (_, i) => [(i + 0.5) / n, 0.5]);
  const px = await page.evaluate(
    (p) => window.__globeLab.readPixels(p),
    points,
  );
  return px.map(luminance);
}

/**
 * The glint's reach onto land, from a row with the glint on and off: the
 * coast is where the glint-off row steps most (smoothed over 5 samples),
 * the land is its brighter side, and the reach is the glint on land
 * farther than `awayPx` from the coast.
 */
function glintOnLand(on, off, awayPx) {
  const smooth = off.map((_, i) =>
    meanOf(off.slice(Math.max(0, i - 2), Math.min(off.length, i + 3))),
  );
  let coast = 1;
  for (let i = 2; i < smooth.length - 1; i++) {
    if (
      Math.abs(smooth[i] - smooth[i - 1]) >
      Math.abs(smooth[coast] - smooth[coast - 1])
    ) {
      coast = i;
    }
  }
  const leftBrighter = meanOf(off.slice(0, coast)) > meanOf(off.slice(coast));
  const glint = on.map((v, i) => v - off[i]);
  const land = glint.filter((_, i) =>
    leftBrighter ? i < coast - awayPx : i > coast + awayPx,
  );
  const sea = glint.filter((_, i) =>
    leftBrighter ? i > coast + awayPx : i < coast - awayPx,
  );
  return {
    coast,
    landMax: Math.max(0, ...land),
    seaMean: meanOf(sea),
    // A sample well out on the sea side, for the sea's own colour.
    seaSample: leftBrighter
      ? Math.min(off.length - 1, coast + 3 * awayPx)
      : Math.max(0, coast - 3 * awayPx),
  };
}

/**
 * The limit on the glint over land, 8-bit luminance, beyond the distance
 * the imagery itself blurs a coast over. The glint over the sea on this
 * view is tens of levels (logged), so a limit of 4 means "none you could
 * see"; the verdict is also reported at 2 and 8.
 */
const LAND_GLINT_MAX = 4;
/** How far from the imagery's coast the land starts counting, in km. */
const AWAY_KM = [2.5, 5, 10];

// WHY (DEC-GL4-6): proven red first on the 2048 px mask (land glint 130
// levels beyond 2.5 km, 57-62 beyond 10 km). The mask at the imagery's
// resolution alone cleared 10 km but still glinted 12-41 levels 5 km
// inland: it marks the mixed sea-and-sand pixel as water, so the tiles'
// water is also required to look like dark sea (Globe `water-alpha.ts`).
// Two altitudes, since the seam's width in pixels scales with the zoom.
for (const altKm of [150, 50]) {
  test(`no glint on the land beside a coast, ${altKm} km up`, async ({
    page,
    context,
  }) => {
    // Well under a 5 min runaway bound: a view settles in 30-50 s under
    // SwiftShader; the waits above cap it.
    test.setTimeout(120_000);
    const { errors, hash } = await holdOverCoast(page, context, altKm);
    const state = await page.evaluate(() => window.__globeLab.state());
    const { height } = await page.evaluate(() => ({
      height: document.getElementById("globe-canvas").height,
    }));
    // Metres per pixel on the ground straight below.
    const mPerPx =
      (2 * state.altitudeM * Math.tan((state.fovY * Math.PI) / 360)) / height;
    const n = 401;
    const width = await page.evaluate(
      () => document.getElementById("globe-canvas").width,
    );
    const mPerSample = (mPerPx * width) / n;
    const on = await middleRow(page, n);
    await page.evaluate((h) => {
      location.hash = h;
    }, `${hash}&waterRoughness=${LAND_ROUGHNESS}`);
    await page.waitForFunction(
      () => window.__globeLab.state().tuning.waterRoughness === 0.9,
    );
    const off = await middleRow(page, n);
    const verdicts = AWAY_KM.map((km) => {
      const r = glintOnLand(on, off, Math.round((km * 1000) / mPerSample));
      return { km, ...r };
    });
    console.log(
      `coast ${altKm} km up (${(mPerSample / 1000).toFixed(3)} km a sample): ` +
        verdicts
          .map(
            (v) =>
              `beyond ${v.km} km: land glint max ${v.landMax.toFixed(1)}, sea glint mean ${v.seaMean.toFixed(1)}, coast at sample ${v.coast} (limit ${LAND_GLINT_MAX}: ` +
              [0.5, 1, 2]
                .map(
                  (k) =>
                    `x${k} ${v.landMax <= LAND_GLINT_MAX * k ? "ok" : "NO"}`,
                )
                .join(" ") +
              ")",
          )
          .join("; "),
    );
    // Review 2026-10-01 m6: at 50 km the view needs level 5 (2.4 km a
    // pixel against 4.9 at level 4), so its tiles are requested; logged at
    // 150 km too.
    console.log(
      `coast ${altKm} km up: tiles per level ${state.tileRequestsByLevel.join("/")}`,
    );
    if (altKm === 50) expect(state.tileRequestsByLevel[5]).toBeGreaterThan(0);
    // The view must show a glint at all, or the check could not fail.
    expect(verdicts[1].seaMean).toBeGreaterThan(3 * LAND_GLINT_MAX);
    expect(verdicts[1].landMax).toBeLessThanOrEqual(LAND_GLINT_MAX);
    // From 150 km the half-texel ramp is under a sample: no land glint
    // beyond 2.5 km either (measured 1.1 levels with level 4, 0.0 with
    // level 5; review B6).
    if (altKm === 150) {
      expect(verdicts[0].landMax).toBeLessThanOrEqual(LAND_GLINT_MAX);
    }
    // WHY (review B7): the water's colour rides UNDER the alpha that
    // carries the mask, and an upload path that premultiplies or clips
    // alpha would zero it, turning the sea black. With the water as rough
    // as land (no glint) and the rim off, a sample well out at sea must
    // still be the imagery's dark blue, not black.
    const n2 = verdicts[2].seaSample;
    const [sea] = await page.evaluate(
      (p) => window.__globeLab.readPixels(p),
      [[(n2 + 0.5) / n, 0.5]],
    );
    console.log(`open sea at sample ${n2}: RGB ${sea.slice(0, 3).join("/")}`);
    expect(sea[2]).toBeGreaterThan(sea[0]);
    expect(Math.max(sea[0], sea[1], sea[2])).toBeGreaterThan(5);
    expect(errors).toEqual([]);
  });
}
