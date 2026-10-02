// @ts-check
/**
 * The relief in the flight (round-5 plan 2026-10-01-0945 §3.5, F1;
 * DEC-GL5-9): with `relief=1` the library's terrain tiles are the surface,
 * exaggerated by altitude, and the pin's dive is the oblique approach.
 *
 * Why this file matters: this is what a viewer sees on the way in. The
 * dive must end at the target, held at the hand-over altitude with the
 * pitch law's depression, the relief drawn and exaggerated as the law says
 * for that altitude, and the ground filling the frame to its top edge
 * (round-5 §3.5's metric); the pitch is swept over the plan's 30-60
 * degrees. Heights are synthetic (generated in the page): nothing leaves
 * 127.0.0.1 (the city data is routed by the helper).
 */
import { expect, test } from "@playwright/test";

import { bootGlobe } from "./globe-smoke-helpers.mjs";

const ORIGIN = `http://127.0.0.1:${process.env.DS_E2E_PORT ?? "5198"}`;
const TARGET = { latitude: 46.5, longitude: 9.0 };
const BASE =
  "spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z&cloudDrift=0&stars=0&milkyWay=0&atmo=0&space=0&relief=1&reliefHeights=synthetic&diveMs=6000&handOver=0";

/** The exaggeration law (globe-flight.ts), for the expected value. */
const exaggerationAt = (altM, near = 3) => {
  const share =
    (Math.log(2_000_000) - Math.log(Math.max(altM, 1))) /
    (Math.log(2_000_000) - Math.log(20_000));
  const x = Math.min(1, Math.max(0, share));
  const s = x * x * (3 - 2 * x);
  return Math.round((1 + (near - 1) * s) / 0.1) * 0.1;
};

/** Grants the target as the position, boots, pins, and waits to land. */
async function diveAndLand(page, context, hash) {
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(TARGET);
  const errors = await bootGlobe(page, hash);
  await page.locator("#globe-pin").click();
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return s.phase === "landed" && s.pin.phase === "idle";
    },
    null,
    { timeout: 120_000 },
  );
  // Let the relief's tiles at the held altitude load.
  await page.waitForFunction(
    () => window.__globeLab.state().relief?.visibleTiles > 0,
    null,
    { timeout: 120_000 },
  );
  return errors;
}

// WHY (§3.5, F1): the oblique approach holds at 150 km looking at the
// target 45 degrees down, with the relief at the law's exaggeration for
// that altitude, and ground filling the frame's top edge.
test("the dive ends over the target, oblique, with the relief exaggerated by altitude", async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  const errors = await diveAndLand(page, context, BASE);
  const s = await page.evaluate(() => window.__globeLab.state());
  const [top] = await page.evaluate(() =>
    window.__globeLab.readPixels([[0.5, 0.02]]),
  );
  const altitudeKm = s.altitudeM / 1000;
  console.log(
    `relief dive: landed ${altitudeKm.toFixed(1)} km up, depression ${s.cameraDepressionDeg.toFixed(2)} deg, centre ${s.centreLatLon?.lat.toFixed(3)},${s.centreLatLon?.lng.toFixed(3)}; relief ${JSON.stringify(s.relief)} (law ${exaggerationAt(s.altitudeM).toFixed(1)}); top-edge pixel ${top.slice(0, 3)}`,
  );
  expect(errors).toEqual([]);
  expect(Math.abs(altitudeKm - 150)).toBeLessThan(1);
  expect(Math.abs(s.cameraDepressionDeg - 45)).toBeLessThan(0.5);
  expect(Math.abs(s.centreLatLon.lat - TARGET.latitude)).toBeLessThan(0.05);
  expect(Math.abs(s.centreLatLon.lng - TARGET.longitude)).toBeLessThan(0.05);
  expect(s.relief.litTiles).toBeGreaterThan(0);
  expect(s.relief.heightScale).toBeCloseTo(exaggerationAt(s.altitudeM), 6);
  expect(s.relief.heightScale).toBeGreaterThan(1);
  // Ground at the top edge: lit, not the black of space.
  expect(Math.max(...top.slice(0, 3))).toBeGreaterThan(10);
});

// WHY (§3.5): the low pitch is swept over the plan's 30-60 degrees; at
// each the hold looks at the target with that depression, and at 150 km
// the ground still reaches the top edge (the horizon's dip there is 12.3
// degrees; with fovY 50 the top ray is pitch - 25 below the horizontal).
test("the pitch law's low pitch, swept over 30, 45 and 60 degrees", async ({
  browser,
}) => {
  test.setTimeout(600_000);
  const rows = [];
  for (const pitch of [30, 45, 60]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await diveAndLand(page, context, `${BASE}&pitchLow=${pitch}`);
    const s = await page.evaluate(() => window.__globeLab.state());
    const [top] = await page.evaluate(() =>
      window.__globeLab.readPixels([[0.5, 0.02]]),
    );
    rows.push({ pitch, depression: s.cameraDepressionDeg, top });
    await context.close();
  }
  console.log(
    `pitch sweep at 150 km: ${rows.map((r) => `${r.pitch}: depression ${r.depression.toFixed(2)}, top ${r.top.slice(0, 3)}`).join("; ")}`,
  );
  for (const r of rows) {
    expect(Math.abs(r.depression - r.pitch)).toBeLessThan(0.5);
    // 30 - 25 = 5 degrees < the 12.3-degree dip: sky at the top edge.
    if (r.pitch - 25 > 12.3)
      expect(Math.max(...r.top.slice(0, 3))).toBeGreaterThan(10);
  }
});
