// @ts-check
/**
 * The world frame at the target (F2 plan 2026-10-03-1922 F2a, M3).
 *
 * Why this file matters: the globe is drawn in a local frame at the target
 * (x east, y up) once the pin has a fix, so the framework's sky, haze and
 * cloud slab can work below the band. The frame switches at the press, at
 * a pose the camera already has; if any camera writer or reader still
 * assumed world = ECEF, the view would jump or the camera would land on
 * the far side of the Earth. Measured: the frame and the camera's ECEF
 * pose just before and just after a switch at a fixed pose, and the state
 * a whole dive leaves in the target's frame.
 */
import { expect, test } from "@playwright/test";

import { bootGlobe } from "./globe-smoke-helpers.mjs";

const ORIGIN = `http://127.0.0.1:${process.env.DS_E2E_PORT ?? "5198"}`;
const TARGET = { latitude: 46.5, longitude: 9.0 };
const BASE =
  "spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z&cloudDrift=0&relief=1&reliefHeights=synthetic&diveMs=6000&handOver=0&detail=0";
/** The bounds' sweep factors (the owner's rule: a one-value verdict is provisional). */
const SWEEP = [0.5, 1, 2];

function grid() {
  const g = [];
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 8; j++) g.push([0.05 + i * 0.065, 0.3 + j * 0.085]);
  }
  return g;
}

function compare(a, b) {
  const d = a.map((p, i) =>
    Math.max(
      Math.abs(p[0] - b[i][0]),
      Math.abs(p[1] - b[i][1]),
      Math.abs(p[2] - b[i][2]),
    ),
  );
  const sorted = [...d].sort((x, y) => x - y);
  return {
    mean: d.reduce((s, v) => s + v, 0) / d.length,
    p95: sorted[Math.floor(0.95 * (sorted.length - 1))],
  };
}

const swept = (value, bound) =>
  `${value.toFixed(2)} (bound ${bound}: ${SWEEP.map((k) => `x${k} ${value <= bound * k ? "ok" : "NO"}`).join(" ")})`;

test("the world frame switches without moving the view, and a dive lands in the target's frame", async ({
  page,
  context,
}) => {
  test.setTimeout(600_000);
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(TARGET);
  const errors = await bootGlobe(page, BASE);
  expect(
    await page.evaluate(() => window.__globeLab.state().worldFrame),
  ).toBeNull();
  await page.locator("#globe-pin").click();
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return (
        s.phase === "landed" && (s.relief?.share ?? 0) >= 1 && s.relief?.settled
      );
    },
    null,
    { timeout: 300_000 },
  );
  const landed = await page.evaluate(() => window.__globeLab.state());
  // The pin moved the world into the target's frame.
  expect(landed.worldFrame).toEqual({
    lat: TARGET.latitude,
    lng: TARGET.longitude,
  });
  // At a held pose: the frame and the camera's ECEF pose, before and after.
  const read = () =>
    page.evaluate((g) => {
      const lab = window.__globeLab;
      lab.timeFrames(3);
      const s = lab.state();
      return {
        px: lab.readPixels(g),
        distanceM: s.cameraDistanceM,
        direction: s.cameraDirection,
        altitudeM: s.altitudeM,
      };
    }, grid());
  const inFrame = await read();
  await page.evaluate(() => window.__globeLab.reframe(null));
  const inEcef = await read();
  await page.evaluate((t) => window.__globeLab.reframe(t), {
    lat: TARGET.latitude,
    lng: TARGET.longitude,
  });
  const back = await read();
  const c = compare(inFrame.px, inEcef.px);
  const cBack = compare(inFrame.px, back.px);
  const dirDeg = (a, b) =>
    (Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * 180) /
    Math.PI;
  console.log(
    `world frame switch at the hold: frame against ECEF mean ${swept(c.mean, 0.5)}, p95 ${swept(c.p95, 4)}; back in the frame mean ${cBack.mean.toFixed(2)}; camera distance ${Math.abs(inFrame.distanceM - inEcef.distanceM).toFixed(3)} m apart, direction ${dirDeg(inFrame.direction, inEcef.direction).toExponential(2)} degrees apart, altitude ${(inFrame.altitudeM / 1000).toFixed(1)} km`,
  );
  expect(errors).toEqual([]);
  expect(c.mean).toBeLessThanOrEqual(0.5);
  expect(c.p95).toBeLessThanOrEqual(4);
  expect(cBack.mean).toBeLessThanOrEqual(0.5);
  // The ECEF pose is the same within 1 m and 0.01 degrees.
  expect(Math.abs(inFrame.distanceM - inEcef.distanceM)).toBeLessThan(1);
  expect(dirDeg(inFrame.direction, inEcef.direction)).toBeLessThan(0.01);
});
