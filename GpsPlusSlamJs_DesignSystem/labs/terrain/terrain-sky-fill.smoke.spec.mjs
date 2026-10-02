// @ts-check
/**
 * The sun light's sky fill in the browser (DEC-GL5-11, globe round-5 plan
 * 2026-10-01-0945 §8).
 *
 * Why this file matters: `terrain-sun.test.mjs` proves `skyLevel` and
 * `sunLight`, but only the GPU shows that the shader's copy reads the
 * page's floor (the hash's `sky` key through `uSkyFloor`) and lights the
 * imagery with it. A uniform never set, a floor applied to the direct term
 * instead of the sky, or a twilight constant off by a sign all still draw a
 * plausible relief. So `globe-albedo` is held to its reference at a low sun
 * for several floors, and the day render must not move with the floor.
 */
import { expect, test } from "@playwright/test";

import {
  applyHash,
  boot,
  fixtureTile,
  luminance,
  readPixels,
  routeAll,
  state,
  sweepLine,
} from "./terrain-smoke-helpers.mjs";
import { COMPARE_PLAN } from "./terrain-compare.js";
import {
  reliefNormal,
  sunDirect,
  sunLight,
  sunLitColour,
} from "./terrain-sun.js";

const DAY = COMPARE_PLAN.suns[0].time;
const LOW = COMPARE_PLAN.suns[1].time;
/** The look the references are computed with, pinned in the hash. */
const LOOK = { shade: 1.6, shadow: 0.8 };
const VIEW =
  "place=alps&alt=300000&tilt=0&head=0&svf=0&tau=0&exag=1&light=1" +
  `&shade=${LOOK.shade}&shadow=${LOOK.shadow}&style=globe-albedo&detail=0`;
/** The floors the shader is held to its reference at (0 is the old fill). */
const FLOORS = [0, 0.25, 0.5, 1];
/**
 * The worst-tolerated mean channel error (8-bit) against the reference: the
 * globe-albedo smoke's own (the GPU's 8-bit grid filtering and the
 * half-float field through the tone curve); swept 2-8 in the log.
 */
const MEAN_TOLERANCE = 4;

test("the shader's sky fill follows the page's floor at a low sun and leaves the day alone", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const record = await routeAll(page, fixtureTile);
  const errors = await boot(page, `${VIEW}&time=${LOW}&sky=0`);
  expect(record.missing).toEqual([]);
  await page.waitForFunction(
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
  let s = await state(page);
  expect(s.farState).toBe("ready");
  expect(s.shaderStyle).toBe(4);
  expect(s.sky).toBe(0);
  const ground = await page.evaluate(() => {
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
  expect(ground.length).toBeGreaterThan(400);
  const at = await page.evaluate(
    (ps) => window.__terrainLab.projectAll(ps),
    ground.map((p) => [p.x, p.heightM - s.datum, -p.y]),
  );
  const gain = LOOK.shade * s.slopeBoost;
  const sun = s.sun.enu;
  console.log(`sky fill: low sun at ${s.sun.elevationDeg.toFixed(2)}°`);
  // The faces the low sun does not reach: only the sky lights them.
  const shaded = ground
    .map((p, i) => ({ i, d: sunDirect(reliefNormal(p.gx, p.gy, gain), sun) }))
    .filter((q) => q.d === 0)
    .map((q) => q.i);
  expect(shaded.length).toBeGreaterThan(20);

  const shadedMean = [];
  for (const sky of FLOORS) {
    await applyHash(page, `${VIEW}&time=${LOW}&sky=${sky}`);
    s = await state(page);
    expect(s.sky).toBe(sky);
    const px = await readPixels(page, at);
    const errs = ground.flatMap((p, i) =>
      sunLitColour(
        p.albedo,
        sunLight(reliefNormal(p.gx, p.gy, gain), sun, {
          shadow: LOOK.shadow,
          svf: 1,
          skyFloor: sky,
        }),
      ).map((v, c) => Math.abs(Math.round(v * 255) - px[i][c])),
    );
    const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
    const lum = shaded.map((i) => luminance(px[i]));
    shadedMean.push(lum.reduce((a, b) => a + b, 0) / lum.length);
    console.log(
      `sky fill ${sky} at the low sun: mean channel error ${mean.toFixed(2)} ` +
        `(${sweepLine(mean, [2, 3, 4, 6, 8])}), worst ${Math.max(...errs)}; ` +
        `the ${shaded.length} faces in shadow: luminance ${shadedMean.at(-1).toFixed(1)}`,
    );
    expect(mean).toBeLessThanOrEqual(MEAN_TOLERANCE);
  }
  // A stronger floor lifts the faces in shadow, every step.
  for (let k = 1; k < shadedMean.length; k++) {
    expect(shadedMean[k]).toBeGreaterThan(shadedMean[k - 1]);
  }

  // By day the sun stands above every floor up to sin 66°: no pixel moves.
  await applyHash(page, `${VIEW}&time=${DAY}&sky=0`);
  const day0 = await readPixels(page, at);
  await applyHash(page, `${VIEW}&time=${DAY}&sky=0.8`);
  const day8 = await readPixels(page, at);
  const dayDiff = Math.max(
    ...day0.flatMap((px, i) => px.map((v, c) => Math.abs(v - day8[i][c]))),
  );
  console.log(`sky fill 0 against 0.8 by day: max channel diff ${dayDiff}`);
  expect(dayDiff).toBe(0);
  expect(errors).toEqual([]);
});
