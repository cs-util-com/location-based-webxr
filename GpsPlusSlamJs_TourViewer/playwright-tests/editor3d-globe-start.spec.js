// @ts-check
import { expect, test } from "@playwright/test";

import {
  afterFrames,
  answerHosts,
  keepRejections,
  noClouds,
  rejections,
  view3d,
} from "./editor3d-fixture.js";

/**
 * Why these tests matter: the approach on the globe began at 8,000 km,
 * so close that the Earth filled the screen and the flight seemed to start
 * mid-way. It now starts where the globe lab's intro zooms out to, the
 * whole Earth in view, at every shape of screen: these pin the first
 * frames' distance from the Earth's centre against the view's own fit on a
 * phone held either way and on a desktop. The globe lab's speed streaks
 * pour past the camera on the way down; they must show mid-flight, and
 * cost no typical frame time against the same flight without them
 * (`dust=0`, the A/B link), both sampled at the same height of the
 * flight. This cannot test the phone's rule of no frame over 50 ms: a
 * headless browser draws the view in software, every frame over 50 ms
 * with or without the streaks; that rule is checked on a phone. The
 * comparison's second flight runs only with FRAME_TIME=1 (a measurement,
 * as `story-blocks-frame-time.spec.js`); by default one flight checks the
 * streaks show.
 */

/** The frame-time comparison runs only on request. */
const FRAME_TIME = process.env.FRAME_TIME === "1";

// Neither spec is about the clouds: without them the globe draws about
// four times the frames in this software renderer (`noClouds`).
test.beforeEach(async ({ page }) => {
  await noClouds(page);
});

/** Both runs' frames are taken from this height down (m): high and fast,
 *  where the streaks show. */
const SAMPLE_BELOW_M = 30_000_000;

/** The globe lab's intro distance from the Earth's centre (m). */
const INTRO_CENTRE_M = 50_000_000;

/**
 * Set the next approach's length (ms) before the page loads.
 * @param {import("@playwright/test").Page} page
 * @param {number} durationMs
 */
async function approachLasting(page, durationMs) {
  await page.addInitScript(
    (knob) => {
      /** @type {any} */ (window).__tourEditorApproach = knob;
    },
    { durationMs },
  );
}

/**
 * Open the sample tour on the globe view (its approach starts with it).
 * @param {import("@playwright/test").Page} page
 * @param {string} [extra] more of the link's query, "&dust=0"
 */
async function openSampleOnGlobe(page, extra = "") {
  await page.goto(`/edit.html?globe=1${extra}`);
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator("#sample-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 120_000,
  });
}

/**
 * The globe's part of the view's stats.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<any>}
 */
async function globeOf(page) {
  const stats = await view3d(page);
  return stats?.globe ?? null;
}

/**
 * Mean, median, 95th percentile and the count over 50 ms of frame times.
 * @param {number[]} ms
 */
function summary(ms) {
  const sorted = [...ms].sort((a, b) => a - b);
  const at = (/** @type {number} */ q) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return {
    n: ms.length,
    mean: ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length),
    median: at(0.5),
    p95: at(0.95),
    over50: ms.filter((x) => x > 50).length,
  };
}

// The phone held upright only: the narrowest aspect, where the fit is
// widest and a wrong aspect estimate falls shortest. Every aspect's start
// against its fit is held by `globe-approach-meteor.test.ts` ("starts
// with the whole Earth in view on a ...").
const VIEWPORTS = [{ name: "phone portrait", width: 390, height: 844 }];

for (const { name, width, height } of VIEWPORTS) {
  test(`the approach starts with the whole Earth in view on a ${name}`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width, height });
    await keepRejections(page);
    await answerHosts(page, { globeAssets: "serve" });
    // Long, so the first frames stand at the start.
    await approachLasting(page, 600_000);
    await openSampleOnGlobe(page);
    await afterFrames(page, 2);
    const globe = await globeOf(page);
    expect(globe.approach?.flying).toBe(true);
    // The view's fit at the size it drew (fitted on its first frame). The
    // start's rule is at least twice that fit (the lab's zoom-out limit):
    // the start was estimated from the page's box before the view drew,
    // so a wrong aspect estimate falls short of it here. The first frames
    // came down less than 1 % of a 600 s flight.
    expect(globe.fitM).toBeGreaterThan(0);
    expect(globe.startCentreM).toBeGreaterThanOrEqual(2 * globe.fitM - 1);
    expect(globe.centreM).toBeGreaterThanOrEqual(2 * globe.fitM * 0.99);
    // Where the globe lab's intro zooms out to, less what the long flight
    // came down in its first frames and the surface's flattening.
    expect(globe.centreM).toBeGreaterThan(INTRO_CENTRE_M * 0.97);
    test.info().annotations.push({
      type: "start",
      description: JSON.stringify({
        viewport: `${width}x${height}`,
        altitudeKm: Math.round(globe.altitudeM / 1000),
        centreKm: Math.round(globe.centreM / 1000),
        fitKm: Math.round(globe.fitM / 1000),
        startCentreKm: Math.round(globe.startCentreM / 1000),
      }),
    });
    expect(await rejections(page)).toEqual([]);
  });
}

test("the speed streaks show mid-flight and cost no frame time against none", async ({
  page,
}) => {
  test.setTimeout(FRAME_TIME ? 480_000 : 240_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await keepRejections(page);
  await answerHosts(page, { globeAssets: "serve" });
  await approachLasting(page, 120_000);

  /**
   * The approach with or without the streaks: whether they showed while
   * it flew, and the times of the 40 frames after it came below
   * `SAMPLE_BELOW_M` (the same moment of the flight in both runs: the
   * flight is paced by its clock, not by the frames).
   * @param {string} extra
   */
  const run = async (extra) => {
    await openSampleOnGlobe(page, extra);
    let shown = false;
    await expect
      .poll(
        async () => {
          const globe = await globeOf(page);
          shown ||= globe?.dust?.shown === true;
          return (globe?.altitudeM ?? Infinity) < SAMPLE_BELOW_M;
        },
        { timeout: 90_000 },
      )
      .toBe(true);
    const below = await globeOf(page);
    await afterFrames(page, 40);
    const globe = await globeOf(page);
    expect(globe.approach?.flying).toBe(true);
    shown ||= globe.dust?.shown === true;
    return {
      shown,
      dust: globe.dust,
      fromKm: Math.round(below.altitudeM / 1000),
      toKm: Math.round(globe.altitudeM / 1000),
      times: summary(globe.frameTimesMs.slice(-40)),
    };
  };

  // With the streaks first: a cold page, so any doubt is against them.
  const on = await run("");
  // Mid-flight, high and fast: the streaks show, in the lab's look.
  expect(on.shown).toBe(true);
  expect(on.dust.count).toBe(2500);
  expect(on.dust.gain).toBe(2);
  if (FRAME_TIME) {
    const off = await run("&dust=0");
    test.info().annotations.push({
      type: "frame times",
      description: JSON.stringify({
        on: { km: [on.fromKm, on.toKm], ...on.times },
        off: { km: [off.fromKm, off.toKm], ...off.times },
      }),
    });
    expect(off.dust.shown).toBe(false);
    // Off still measures the speed: the same flight, nothing drawn.
    expect(off.dust.speedMps).toBeGreaterThan(0);
    // The streaks add no time on a typical frame against the same flight
    // without them, at the same height. The count of frames over 50 ms is
    // only annotated: headless, every frame is over 50 ms either way, so a
    // comparison of it would pass whatever the streaks cost.
    expect(on.times.median).toBeLessThanOrEqual(off.times.median * 1.25 + 5);
  }
  expect(await rejections(page)).toEqual([]);
});
