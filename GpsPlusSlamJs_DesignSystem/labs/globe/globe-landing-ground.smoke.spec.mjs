// @ts-check
/**
 * The landing above the GROUND (round-4 plan 2026-10-11-0122 DEC-R4-1, R4b;
 * the owner on r812: "fly much closer to the city, about 100-200 m above
 * the ground, not above sea level"). A `flight=2` link reads its place's
 * ground early (one Terrarium tile at the relief's own zoom), flies the
 * meteor's line to the target lifted to that ground, and lands `landAglM`
 * (150 m) above it, the readout naming the height above the ground.
 *
 * The gating test runs with the relief on and its height tiles synthetic
 * (generated in the page: nothing leaves 127.0.0.1, as the relief smokes
 * do), so the place has a ground of about 1.3 km at Lucerne. The owner's
 * screenshots over the REAL relief at Lucerne and near Pilatus fetch the
 * AWS tiles and are taken only with `GLOBE_LANDING_SHOTS_DIR` set.
 */
import { expect, test } from "@playwright/test";

import { bootGlobe } from "./globe-smoke-helpers.mjs";

const LUCERNE = { lat: 47.0502, lng: 8.3093 };
/**
 * A summit of the synthetic heights (about 2,148 m), the ground falling
 * away within 412 m on every side (a grid search over the field's formula,
 * `synthetic-heights.js`).
 */
const SUMMIT = { lat: 46.9185, lng: 8.136 };
/** Near Pilatus: the slope below the summit, about 1.7 km up. */
const PILATUS = { lat: 46.9726, lng: 8.2574 };
const BASE =
  "spinMs=0&turnMs=0&time=2026-10-05T11:00:00Z&cloudDrift=0&stars=0&milkyWay=0&relief=1&detail=0&cloudVolume=0&cityWarm=0&land=1&flight=2";
/** The landing above the ground (`landAglM`'s default). */
const LANDING_M = 150;
/**
 * The camera's height above the target's ground at the end, against 150 m:
 * the flight lands exactly over the target's ground radius; WGS84 under
 * the camera, 260 m back at 30 degrees, lies up to about 1 m off it, and
 * the relief's own sample may differ from the early read by its lattice
 * (the revision's 25 m margin bounds that).
 */
const TOLERANCE_M = 5;

/**
 * Flies a link to `place` and returns the landed state. `routeCity` false
 * leaves the height tiles to the network (the test routes Overpass).
 */
async function landAt(page, place, hash, routeCity = true) {
  // Up to the flight and the relief's settle: SwiftShader draws the relief
  // at about a frame a second.
  const errors = await bootGlobe(page, `${hash}&at=${place.lat},${place.lng}`, {
    plain: false,
    phase: "landed",
    routeCity,
  });
  await page.waitForFunction(
    () => window.__globeLab.state().pin.phase === "idle",
    null,
    { timeout: 120_000 },
  );
  // The relief's finest tile at the place, and the readout caught up.
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return (
        s.pin.flight?.reliefGroundM !== null &&
        s.relief?.groundUnderCameraM !== null &&
        s.readoutShown === s.readout
      );
    },
    null,
    { timeout: 240_000, polling: 500 },
  );
  return { errors, st: await page.evaluate(() => window.__globeLab.state()) };
}

// WHY (DEC-R4-1, the cold review's §6 items 2-4 and 10): the landing is
// measured against the relief's OWN height at the place, not against the
// number the flight was given: the early read (the landing module over the
// Osm library's Terrarium decoder) and the drawn relief must agree, and the
// camera must end 150 m above that ground, the readout saying so. Two
// places of the synthetic field: Lucerne, on a slope (its ridges rise up to
// 0.36 a metre a metre, so the clearance may lift the landing camera over
// the ground behind it: then it sits at the clearance there), and a
// synthetic summit at 2.1 km a few km south-west, where the ground falls
// away on every side within 412 m (searched for it), so nothing lifts and
// the landing itself is measured.
for (const [name, place, mayLift] of [
  ["Lucerne", LUCERNE, true],
  ["a synthetic summit", SUMMIT, false],
]) {
  test(`a link to ${name} lands 150 m above the relief's ground there`, async ({
    page,
  }) => {
    test.setTimeout(600_000);
    const { errors, st } = await landAt(
      page,
      place,
      `${BASE}&reliefHeights=synthetic`,
    );
    const f = st.pin.flight;
    const aboveTarget = st.altitudeM - f.reliefGroundM;
    const aboveCamera = st.altitudeM - st.relief.groundUnderCameraM;
    console.log(
      `${name} (synthetic heights): read ${f.groundM.toFixed(1)} m (${f.groundSource}), relief ${f.reliefGroundM.toFixed(1)} m at the place, revisions ${f.groundRevisions}; landed at ${st.altitudeM.toFixed(1)} m: ${aboveTarget.toFixed(1)} m above the place's ground, ${aboveCamera.toFixed(1)} m above the ground under the camera, clearance lifts ${st.relief.clearanceLifts}; depression ${st.cameraDepressionDeg.toFixed(1)} deg; "${st.readoutShown}"; "${st.pin.status}"`,
    );
    expect(errors).toEqual([]);
    expect(f.groundSource).toBe("tile");
    expect(f.landingM).toBe(LANDING_M);
    // One height source (R13): the early read is the relief's own number.
    expect(Math.abs(f.groundM - f.reliefGroundM)).toBeLessThan(25);
    expect(f.groundRevisions).toBe(0);
    if (!mayLift) expect(st.relief.clearanceLifts).toBe(0);
    // 150 m above the place's ground, unless the clearance had to lift the
    // camera over higher ground under it (then it sits at the clearance).
    if (st.relief.clearanceLifts === 0) {
      expect(Math.abs(aboveTarget - LANDING_M)).toBeLessThan(TOLERANCE_M);
    } else {
      expect(Math.abs(aboveCamera - st.relief.clearanceM)).toBeLessThan(2);
    }
    expect(st.readoutShown).toMatch(/ · d+ m above ground/);
    expect(st.pin.status).toMatch(/^Arrived, 150 m above the ground.$/);
  });
}

// WHY (DEC-R4-1, the cold review's §6 item 10): the relief's blockiness at
// 150 m is something the owner must see before the default ships: the
// landings over the REAL relief at Lucerne and near Pilatus, as images.
// Network: the AWS height tiles (the relief's own source), so only on
// request; the city's Overpass data is answered empty here.
test("the owner's screenshots: landed 150 m up at Lucerne and near Pilatus", async ({
  browser,
}) => {
  const dir = process.env.GLOBE_LANDING_SHOTS_DIR;
  test.skip(!dir, "set GLOBE_LANDING_SHOTS_DIR to take them (AWS tiles)");
  test.setTimeout(1_200_000);
  for (const [name, place] of [
    ["lucerne", LUCERNE],
    ["pilatus", PILATUS],
  ]) {
    // A fresh page each: a hash change alone would not reload the lab.
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route(
      (url) =>
        /overpass/.test(url.hostname + url.pathname) ||
        url.hostname === "tiles.mapterhorn.com",
      (route) =>
        route.request().method() === "OPTIONS"
          ? route.fulfill({
              status: 204,
              headers: { "Access-Control-Allow-Origin": "*" },
            })
          : route.fulfill({
              status: 200,
              headers: {
                "Access-Control-Allow-Origin": "*",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ version: 0.6, elements: [] }),
            }),
    );
    const { st } = await landAt(page, place, BASE, false);
    const f = st.pin.flight;
    await page.evaluate(() => window.__globeLab.timeFrames(3));
    await page.screenshot({ path: `${dir}/r4b-landed-${name}.png` });
    console.log(
      `${name} (AWS heights): read ${f.groundM.toFixed(1)} m (${f.groundSource}), relief ${f.reliefGroundM?.toFixed(1)} m, revisions ${f.groundRevisions}; landed ${st.altitudeM.toFixed(1)} m (${(st.altitudeM - f.reliefGroundM).toFixed(1)} m above the place, ${(st.altitudeM - st.relief.groundUnderCameraM).toFixed(1)} m above the ground under the camera, lifts ${st.relief.clearanceLifts}); "${st.readoutShown}"`,
    );
    await context.close();
  }
});
