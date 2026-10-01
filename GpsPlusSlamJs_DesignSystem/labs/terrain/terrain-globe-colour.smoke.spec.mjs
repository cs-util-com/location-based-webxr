// @ts-check
/**
 * The terrain lab's relief coloured from the globe imagery, in the browser
 * (globe round-5 plan 2026-10-01-0945 §3.3).
 *
 * Why this file matters: `terrain-globe-colour.test.mjs` proves the colour
 * functions, but only the GPU shows that the shader's branch reads the
 * imagery where the page put it, lights it with the sun term, and adds the
 * detail as a high-pass. A grid read half a texel off, a light left at the
 * map's, or a detail that brightens everything all still draw a plausible
 * map. So each style is held to its reference at real Alps pixels.
 */
import { expect, test } from "@playwright/test";

import {
  boot,
  applyHash,
  fixtureTile,
  luminance,
  readPixels,
  routeAll,
  state,
  sweepLine,
} from "./terrain-smoke-helpers.mjs";
import { bandRampColour } from "./terrain-globe-colour.js";
import { reliefNormal, sunLight, sunLitColour } from "./terrain-sun.js";

const DAY = "2026-06-21T11:00:00Z";
/** The look the references are computed with, pinned in the hash. */
const LOOK = { shade: 1.6, shadow: 0.8 };
const VIEW =
  `place=alps&alt=300000&tilt=0&head=0&svf=0&tau=0&exag=1&light=1&time=${DAY}` +
  `&shade=${LOOK.shade}&shadow=${LOOK.shadow}`;

/** Waits until the imagery and the imagery styles' grids are in. */
const imageryReady = (page) =>
  page.waitForFunction(
    () => {
      const s = window.__terrainLab.state();
      return (
        s.farState === "failed" ||
        (s.farState === "ready" && s.globeColour.albedo && s.globeColour.coarse)
      );
    },
    null,
    { timeout: 90_000 },
  );

/** Ground points over the middle of the region, with the field and the albedo. */
const sampleGround = (page) =>
  page.evaluate(() => {
    const out = [];
    for (let i = 0; i < 25; i++) {
      for (let j = 0; j < 25; j++) {
        const x = -96_000 + 8_000 * i;
        const y = -96_000 + 8_000 * j;
        const f = window.__terrainLab.fieldAt(x, y);
        const albedo = window.__terrainLab.albedoAt(x, y);
        if (f && albedo) out.push({ x, y, ...f, albedo });
      }
    }
    return out;
  });

/**
 * The worst-tolerated mean channel error (8-bit) of C1 at detail 0 against
 * its reference: the GPU's 8-bit grid filtering and the half-float field
 * through the tone curve, as style C's far field measures (3-4 levels).
 * Swept 2-8; the mean, not the worst pixel, so a ridge pixel straddling
 * two slopes does not decide it.
 */
const ALBEDO_MEAN_TOLERANCE = 4;

test("globe-albedo: the imagery under the sun term, and its detail a high-pass", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const record = await routeAll(page, fixtureTile);
  const errors = await boot(page, `${VIEW}&style=globe-albedo&detail=0`);
  expect(record.missing).toEqual([]);
  await imageryReady(page);
  const s = await state(page);
  expect(s.farState).toBe("ready");
  expect(s.shaderStyle).toBe(4);
  expect(s.light).toBe(1);
  expect(s.credits).toContain("Blue Marble");
  console.log(
    `globe-albedo: footprint luminance built in ${Math.round(s.globeColour.coarseMs)} ms`,
  );
  const ground = await sampleGround(page);
  expect(ground.length).toBeGreaterThan(400);
  const at = await page.evaluate(
    (ps) => window.__terrainLab.projectAll(ps),
    ground.map((p) => [p.x, p.heightM - s.datum, -p.y]),
  );
  const px = await readPixels(page, at);
  const gain = LOOK.shade * s.slopeBoost;
  const want = ground.map((p) =>
    sunLitColour(
      p.albedo,
      sunLight(reliefNormal(p.gx, p.gy, gain), s.sun.enu, {
        shadow: LOOK.shadow,
        svf: 1,
      }),
    ),
  );
  const errs = want.flatMap((w, i) =>
    w.map((v, c) => Math.abs(Math.round(v * 255) - px[i][c])),
  );
  const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
  console.log(
    `globe-albedo detail 0 against its reference: mean channel error ${mean.toFixed(2)} ` +
      `(${sweepLine(mean, [2, 3, 4, 6, 8])}), worst ${Math.max(...errs)}`,
  );
  expect(mean).toBeLessThanOrEqual(ALBEDO_MEAN_TOLERANCE);

  // The detail: a luminance high-pass whose mean over a footprint is about
  // 1, so it moves single pixels a lot and the region's mean little.
  const lum0 = px.map(luminance);
  await applyHash(page, `${VIEW}&style=globe-albedo&detail=1`);
  const lum1 = (await readPixels(page, at)).map(luminance);
  const meanOf = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const moved = meanOf(lum1.map((v, i) => Math.abs(v - lum0[i])));
  const shift = meanOf(lum1) - meanOf(lum0);
  console.log(
    `globe-albedo detail 1 against 0: mean per-pixel luminance change ${moved.toFixed(2)}, ` +
      `change of the mean ${shift.toFixed(2)} (8-bit)`,
  );
  // Non-vacuous: the detail does change pixels...
  expect(moved).toBeGreaterThan(2);
  // ...but not the region's brightness as a whole (a third of the change).
  expect(Math.abs(shift)).toBeLessThan(moved / 3);
  expect(errors).toEqual([]);
});

/**
 * C3's mean channel error against its reference: the ramp's 256-texel LUT
 * (20 m a texel) read with linear filtering, against the exact ramp, under
 * the same sun term as C1. Swept 2-8.
 */
const BANDS_MEAN_TOLERANCE = 4;

test("globe-bands: the imagery's colour per height band, and its band-width sweep", async ({
  page,
}) => {
  test.setTimeout(420_000);
  const record = await routeAll(page, fixtureTile);
  const errors = await boot(page, `${VIEW}&style=globe-bands`);
  expect(record.missing).toEqual([]);
  // The place too: a new region clears the old one's bands, and the wait
  // must not pass on them.
  const bandsReady = (place) =>
    page.waitForFunction(
      (want) => {
        const s = window.__terrainLab.state();
        if (s.place !== want) return false;
        return (
          s.farState === "failed" || (s.globeColour.bands?.length ?? 0) > 0
        );
      },
      place,
      { timeout: 120_000 },
    );
  await bandsReady("alps");
  const s = await state(page);
  expect(s.farState).toBe("ready");
  expect(s.shaderStyle).toBe(5);
  console.log(
    `globe-bands on the Alps: ${s.globeColour.samples} imagery pixels paired with their ` +
      `footprint heights in ${Math.round(s.globeColour.samplesMs)} ms; ${s.globeColour.bands.length} bands of ${s.band} m`,
  );
  // The reference ramp from the page's own bands (8-bit colours).
  const ramp = {
    widthM: s.band,
    bands: s.globeColour.bands.map((b) => ({
      heightM: b.heightM,
      count: b.count,
      rgb: b.rgb.map((v) => v / 255),
    })),
    sea: null,
  };
  const ground = (await sampleGround(page)).filter((p) => p.heightM > 0);
  const at = await page.evaluate(
    (ps) => window.__terrainLab.projectAll(ps),
    ground.map((p) => [p.x, p.heightM - s.datum, -p.y]),
  );
  const px = await readPixels(page, at);
  const gain = LOOK.shade * s.slopeBoost;
  const errs = ground.flatMap((p, i) =>
    sunLitColour(
      bandRampColour(ramp, p.heightM),
      sunLight(reliefNormal(p.gx, p.gy, gain), s.sun.enu, {
        shadow: LOOK.shadow,
        svf: 1,
      }),
    ).map((v, c) => Math.abs(Math.round(v * 255) - px[i][c])),
  );
  const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
  console.log(
    `globe-bands against its reference: mean channel error ${mean.toFixed(2)} ` +
      `(${sweepLine(mean, [2, 3, 4, 6, 8])}), worst ${Math.max(...errs)}`,
  );
  expect(mean).toBeLessThanOrEqual(BANDS_MEAN_TOLERANCE);

  // The band-width sweep (plan §3.3: 100-800 m), on two places: logged,
  // not asserted, except that every width gives a ramp.
  for (const place of ["alps", "appalachians"]) {
    if (place !== "alps") {
      await applyHash(
        page,
        `${VIEW.replace("place=alps", `place=${place}`)}&style=globe-bands`,
      );
      await bandsReady(place);
    }
    const rows = await page.evaluate(
      (w) => window.__terrainLab.bandSweep(w),
      [100, 200, 300, 400, 600, 800],
    );
    for (const r of rows) {
      console.log(
        `band sweep ${place} ${r.widthM} m: ${r.bands} bands (least ${r.minCount} pixels), ` +
          `in-sample ΔE ${r.fit.mean.toFixed(2)} (p95 ${r.fit.p95.toFixed(2)}), ` +
          `cross-validated ΔE ${r.cv.mean.toFixed(2)} (p95 ${r.cv.p95.toFixed(2)})`,
      );
      expect(r.bands).toBeGreaterThan(0);
    }
    const best = rows.reduce((a, b) => (b.cv.mean < a.cv.mean ? b : a));
    console.log(
      `band sweep ${place}: least cross-validated error at ${best.widthM} m`,
    );
  }
  expect(errors).toEqual([]);
});
