// @ts-check
/**
 * The clip planes over the drawn relief (F2 plan 2026-10-03-1922 F2a, M4).
 *
 * Why this file matters: the relief stands up to 3x its real height above
 * the ellipsoid, and the near plane used to be a fraction of the height
 * over the ELLIPSOID. Held low over a ridge (the clearance keeps the camera
 * 300 m over the drawn ground), that plane lay beyond the ground in front
 * of the camera and cut it away. The planes now come from the drawn ground
 * around the camera and the highest drawn peak. Measured at 5 and 2 km
 * holds over the synthetic ridge (crest about 2.2 km, 6.6 km drawn at E 3):
 *
 * - no background pixel (magenta, `holeColor=1`) in the frame's lower two
 *   thirds, where the ground is (a clipped peak or slope shows there);
 * - two frames 1 mm of camera movement apart differ in at most 1e-3 of the
 *   pixels (z-fighting between the skirts and their neighbours, or the
 *   sea against the globe's tiles, flips pixels at any movement).
 *
 * `reliefPlanes=0` (the planes over the ellipsoid, as before) is the
 * positive control at 2 km: it must show background, or this check could
 * not see a clipped ground.
 */
import { expect, test } from "@playwright/test";

import { bootGlobe } from "./globe-smoke-helpers.mjs";

const ORIGIN = `http://127.0.0.1:${process.env.DS_E2E_PORT ?? "5198"}`;
/** Over the synthetic ridge's crest (globe-relief.smoke's clearance test). */
const TARGET = { latitude: 46.545, longitude: 9.125 };
/**
 * `bandFill=0`: round 6's stencil fill draws the globe into every pixel the
 * relief leaves, so a clipped relief showed the globe, never the clear
 * colour, and the first run read 0 background even for the positive
 * control (2026-10-05). Without the fill a clipped ground is magenta.
 */
const BASE =
  "spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z&cloudDrift=0&stars=0&milkyWay=0&atmo=0&space=0&sky=0&relief=1&reliefHeights=synthetic&diveMs=6000&handOver=0&detail=0&holeColor=1&bandFill=0";
/** The bounds' sweep factors (the owner's rule: a one-value verdict is provisional). */
const SWEEP = [0.5, 1, 2];
/** The share of pixels two frames 1 mm apart may differ in. */
const FLICKER_SHARE = 1e-3;
/** A pixel differs when a channel moves by more than this many levels. */
const FLICKER_LEVELS = 16;

const swept = (value, bound) =>
  `${value.toExponential(2)} (bound ${bound}: ${SWEEP.map((k) => `x${k} ${value <= bound * k ? "ok" : "NO"}`).join(" ")})`;

/** Pins the ridge, holds at `holdKm` and waits for the settled relief. */
async function holdOverRidge(page, context, holdKm, extra = "") {
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(TARGET);
  const errors = await bootGlobe(page, `${BASE}&handOverKm=${holdKm}${extra}`);
  await page.locator("#globe-pin").click();
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return (
        s.phase === "landed" &&
        s.pin.phase === "idle" &&
        (s.relief?.share ?? 0) >= 1 &&
        s.relief?.visibleTiles > 0 &&
        s.relief.settled
      );
    },
    null,
    { timeout: 240_000 },
  );
  return errors;
}

/** The probe at the hold, plus the camera's planes and height. */
const probe = (page) =>
  page.evaluate(
    ({ levels }) => {
      const lab = window.__globeLab;
      const s = lab.state();
      return {
        ...lab.planeProbe({ jitterM: 0.001, levels }),
        altitudeM: s.altitudeM,
        groundM: s.relief.groundUnderCameraM,
        heightScale: s.relief.heightScale,
      };
    },
    { levels: FLICKER_LEVELS },
  );

const report = (label, p) =>
  `${label}: altitude ${(p.altitudeM / 1000).toFixed(2)} km over drawn ground ${(p.groundM / 1000).toFixed(2)} km (E ${p.heightScale}), near ${p.near.toFixed(1)} m, far ${(p.far / 1000).toFixed(0)} km; background in the lower two thirds ${p.backgroundShare.toFixed(4)}; 1 mm apart ${swept(p.changedShare, FLICKER_SHARE)} of ${p.pixels} pixels`;

for (const holdKm of [5, 2]) {
  test(`the planes hold the ridge at a ${holdKm} km hold: no clipped ground, no z-fighting`, async ({
    page,
    context,
  }) => {
    test.setTimeout(420_000);
    const errors = await holdOverRidge(page, context, holdKm);
    const p = await probe(page);
    console.log(report(`planes at a ${holdKm} km hold`, p));
    expect(errors).toEqual([]);
    expect(p.backgroundShare).toBe(0);
    expect(p.changedShare).toBeLessThanOrEqual(FLICKER_SHARE);
  });
}

test("the positive control: the planes over the ellipsoid clip the ridge at a 2 km hold", async ({
  page,
  context,
}) => {
  test.setTimeout(420_000);
  const errors = await holdOverRidge(page, context, 2, "&reliefPlanes=0");
  const p = await probe(page);
  console.log(report("planes over the ellipsoid at a 2 km hold", p));
  expect(errors).toEqual([]);
  expect(p.backgroundShare).toBeGreaterThan(0.01);
});
