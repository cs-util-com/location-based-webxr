// @ts-check
/**
 * The recorder's fixed-view sweep with editor-style items
 * (`globe-perf-views.js`, `globe-perf-items.js`).
 *
 * Why this file matters: the sweep is a phone test from ONE link: it must
 * start by itself (`perfAuto=1`), visit every view from space down to
 * street level, hold each item count there with the items actually in the
 * scene (registered for the eye camera's near plane, as an editor's
 * would be), put the street camera at an eye height over the drawn ground,
 * and end in an export whose table pools the runs. A sweep that silently
 * skipped a view, measured with no items, or stood the street camera in
 * the air would send back numbers that look fine and answer nothing.
 *
 * SwiftShader renders on the CPU, so nothing here asserts a time: only the
 * plan, the counts, the placement and the export's shape. Heights are
 * synthetic and the city is off: nothing leaves 127.0.0.1.
 */
import { expect, test } from "@playwright/test";

import { bootGlobe } from "./globe-smoke-helpers.mjs";

// A settle of up to 60 s a view: under SwiftShader the relief takes the
// frame only once its view is refined (the band gate), which takes tens of
// seconds a view; a 5 s settle left the street camera over the globe.
const HASH = [
  "spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z&cloudDrift=0",
  "stars=0&milkyWay=0&atmo=0&groundSky=0&cloudVolume=0",
  "relief=1&reliefHeights=synthetic&city=0&cityWarm=0&eye=1",
  "at=46.948,7.4474",
  // No warm-up pass (its unit tests cover the plan): it doubles the moves.
  "perf=1&perfAuto=1&perfItems=3&perfRepeats=1&perfHoldS=1&perfViewSettleS=60&perfQuietS=60&perfWarmup=0",
  // SwiftShader takes seconds a frame: the frame watchdog would stop it.
  "perfWatchdogS=600",
].join("&");

const VIEWS = ["space", "100km", "10km", "1km", "street"];

// WHY: the one-link phone test. It runs without a press, visits the five
// views in order with the items in the scene, places the street camera at
// eye height over the drawn ground with the items ahead, removes the items
// at the end, and exports one row per view and count.
test("the fixed-view sweep starts by itself and measures each view with its items", async ({
  page,
}) => {
  test.setTimeout(1_200_000);
  const errors = await bootGlobe(page, HASH, { plain: false });
  await page.waitForFunction(() => window.__globeLab.perf !== null, null, {
    timeout: 30_000,
  });
  // Started by itself: the status leaves "idle" without a press.
  await page.waitForFunction(
    () => window.__globeLab.perf.status() !== "idle",
    null,
    { timeout: 30_000 },
  );
  // At street level, while it holds: the items are registered, the camera
  // stands about an eye height over the drawn ground, and the items'
  // middle is ahead of it, inside the view.
  await page.waitForFunction(
    () => /street/.test(window.__globeLab.perf.status()),
    null,
    { timeout: 900_000, polling: 250 },
  );
  // The status changes when the move is ordered; under SwiftShader a frame
  // takes seconds, so wait for the camera itself to stand near the ground.
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return (
        s.eye.items === 3 &&
        typeof s.planes.clearanceM === "number" &&
        s.planes.clearanceM < 10
      );
    },
    null,
    { timeout: 300_000, polling: 250 },
  );
  const street = await page.evaluate(() => {
    const s = window.__globeLab.state();
    const hit = window.__globeLab.groundHitAt(0.5, 0.5);
    return {
      eye: s.eye,
      clearanceM: s.planes.clearanceM,
      near: s.planes.near,
      centreHitM: hit?.miss === null ? hit.t : null,
      item0: window.__globeLab.perfItem(0),
    };
  });
  console.log(`street view: ${JSON.stringify(street)}`);
  expect(street.eye.on).toBe(true);
  // The eye height (1.7 m) over the drawn ground, within the relief's
  // sampling (the clearance is the least over a ring around the camera).
  expect(street.clearanceM).toBeGreaterThan(0.5);
  expect(street.clearanceM).toBeLessThan(5);
  // Looking a little down at the items' middle 30 m ahead: the ray hits
  // the ground beyond it, not the sky and not at the feet.
  expect(street.centreHitM).toBeGreaterThan(20);
  // The items are what is measured: the first one (near the middle) must
  // be in the camera's view and stand on the drawn ground, not under it
  // (a relief that refined after the items were placed buries them).
  expect(street.item0).not.toBeNull();
  expect(street.item0.inView).toBe(true);
  expect(street.item0.footOverGroundM).toBeGreaterThan(-0.1);
  expect(street.item0.footOverGroundM).toBeLessThan(0.5);

  await page.waitForFunction(
    () => /^(Done|Failed)/.test(window.__globeLab.perf.status()),
    null,
    { timeout: 900_000, polling: 500 },
  );
  expect(await page.evaluate(() => window.__globeLab.perf.status())).toMatch(
    /^Done/,
  );
  const out = JSON.parse(
    await page.evaluate(() => window.__globeLab.perf.exportText()),
  );
  console.log(
    `settles: ${JSON.stringify(out.lab.map((r) => [r.label, r.settle]))}`,
  );
  expect(errors).toEqual([]);
  expect(out.lab.map((r) => r.label)).toEqual(VIEWS.map((v) => `${v} n=3 r1`));
  for (const r of out.lab) {
    expect(r.work.frames).toBeGreaterThan(0);
    expect(r.bytes).toBeGreaterThan(0);
    // What each run saw: why it was void (if it was), the viewport, the
    // items inside the view, and how long its waits took.
    expect(Array.isArray(r.voidedBy)).toBe(true);
    expect(r.viewport).toMatch(/^\d+x\d+@[\d.]+$/);
    expect(r.itemsInView).toBeGreaterThanOrEqual(0);
    expect(r.itemsInView).toBeLessThanOrEqual(3);
    expect(typeof r.settle.moveMs).toBe("number");
    expect(typeof r.settle.quietMs).toBe("number");
  }
  // Without a city (city=0) the gate does not wait; the sweep ended done.
  expect(out.cityGate.outcome).toBe("off");
  expect(out.outcome).toBe("done");
  expect(out.contextLost).toBeNull();
  // One run per view, pooled or counted as timed out: under SwiftShader a
  // low view's queues may not drain within the waits, and such a run must
  // be counted, never pooled.
  expect(out.views.map((r) => [r.view, r.items, r.runs + r.timedOut])).toEqual(
    VIEWS.map((v) => [v, 3, 1]),
  );
  expect(out.views.find((r) => r.view === "space").runs).toBe(1);
  // The items leave with the sweep.
  expect(await page.evaluate(() => window.__globeLab.state().eye.items)).toBe(
    0,
  );
  expect(await page.locator('[data-perf="summary"]').textContent()).toMatch(
    /^view\s+n\s+p50/,
  );
});
