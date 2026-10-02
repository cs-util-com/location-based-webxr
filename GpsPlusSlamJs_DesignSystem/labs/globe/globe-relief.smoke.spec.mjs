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

/** The frame's lower 60 % (the ground under the hold), every 4 %. */
const groundGrid = () => {
  const g = [];
  for (let y = 0.4; y <= 0.98; y += 0.04)
    for (let x = 0.02; x <= 0.98; x += 0.04) g.push([x, y]);
  return g;
};
const meanDiff = (a, b) =>
  a.reduce(
    (s, p, i) =>
      s +
      (Math.abs(p[0] - b[i][0]) +
        Math.abs(p[1] - b[i][1]) +
        Math.abs(p[2] - b[i][2])) /
        3,
    0,
  ) / a.length;

// WHY (F1, globe-albedo plus its detail on the library's tiles): the
// relief's tiles wear the imagery as the albedo and take the terrain
// lab's detail factor over the target's 256 km region (built in the page
// from the same synthetic heights). Under the hold the detail must reach
// the tiles: the frame differs from the same view without it, more for a
// stronger detail. Bound: mean 1 level at the lab's default 0.5, reported
// at x0.5 and x2; the sweep shows the weight acting (0.25, 0.5, 1).
test("the relief's tiles take the terrain lab's detail under the hold", async ({
  browser,
}) => {
  test.setTimeout(900_000);
  const grid = groundGrid();
  const frames = {};
  const states = {};
  for (const detail of [0, 0.25, 0.5, 1]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = await diveAndLand(page, context, `${BASE}&detail=${detail}`);
    if (detail > 0) {
      await page.waitForFunction(
        () => {
          const d = window.__globeLab.state().relief?.detail;
          return d?.state === "ready" || d?.state === "failed";
        },
        null,
        { timeout: 120_000 },
      );
    }
    states[detail] = (
      await page.evaluate(() => window.__globeLab.state())
    ).relief.detail;
    frames[detail] = await page.evaluate(
      (g) => window.__globeLab.readPixels(g),
      grid,
    );
    expect(errors, `detail ${detail}`).toEqual([]);
    await context.close();
  }
  const diff = (d) => meanDiff(frames[0], frames[d]);
  const BOUND = 1;
  const verdict = (v) =>
    [0.5, 1, 2].map((k) => `x${k} ${v > BOUND * k ? "ok" : "NO"}`).join(" ");
  console.log(
    `relief detail under the hold, ${grid.length} points against detail 0: 0.25 ${diff(0.25).toFixed(2)}, 0.5 ${diff(0.5).toFixed(2)} (bound ${BOUND}: ${verdict(diff(0.5))}), 1 ${diff(1).toFixed(2)}; region ${JSON.stringify(states[0.5])}`,
  );
  expect(states[0]?.state).toBe("idle");
  expect(states[0.5]?.state).toBe("ready");
  expect(states[0.5]?.changedShare).toBeGreaterThan(0.05);
  expect(diff(0.5)).toBeGreaterThan(BOUND);
  expect(diff(0.25)).toBeLessThan(diff(0.5));
  expect(diff(0.5)).toBeLessThan(diff(1));
});

/**
 * Waits until both carriers have what they draw loaded and the counts
 * hold still for a second: the globe's tiles while it has pixels (share
 * below 1), the relief's while it has (share above 0).
 */
async function settleBoth(page) {
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      const r = s.relief;
      const ready =
        (r.share >= 1 || s.pendingTiles === 0) &&
        (r.share <= 0 || (r.settled && r.visibleTiles > 0));
      const w = window;
      const key = `${r.share},${s.loadedTiles},${r.visibleTiles}`;
      if (!ready || w.__bandKey !== key) {
        w.__bandKey = key;
        w.__bandSince = performance.now();
        return false;
      }
      return performance.now() - w.__bandSince >= 1000;
    },
    null,
    { timeout: 120_000, polling: 100 },
  );
}

// WHY (one-scene plan §3.2 and §6; F1): above the band the globe's own
// surface draws, below it the relief's tiles, and between them a dithered
// cross-fade. The two carriers differ by a mean 4.3 levels at noon from
// 1,000 km (the relief's library tiles are coarser over part of the
// frame: globe-terrain.smoke.spec.mjs), so the swap must be spread: at a
// fixed view inside the band, each 0.1 step of the relief's share may
// change the ground by at most a mean 1 level (reported at x0.5 and x2),
// so no frame of the dive jumps. Measured at three heights across the
// band. Outside the band the other carrier is not drawn; the tile counts
// and a frame-time ratio (SwiftShader, relative only) state the band's
// cost.
test("the band's cross-fade between the globe and the relief is continuous, and its cost stated", async ({
  browser,
}) => {
  test.setTimeout(1_500_000);
  const grid = groundGrid();
  const STEP = 1;
  const verdict = (v) =>
    [0.5, 1, 2].map((k) => `x${k} ${v <= STEP * k ? "ok" : "NO"}`).join(" ");
  const worst = [];
  for (const altKm of [1900, 1550, 1250]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const base = `${BASE}&handOverKm=${altKm}&detail=0`;
    await context.grantPermissions(["geolocation"], { origin: ORIGIN });
    await context.setGeolocation(TARGET);
    const errors = await bootGlobe(page, `${base}&bandShare=0`);
    await page.locator("#globe-pin").click();
    await page.waitForFunction(
      () => {
        const s = window.__globeLab.state();
        return s.phase === "landed" && s.pin.phase === "idle";
      },
      null,
      { timeout: 120_000 },
    );
    const natural = await page.evaluate(() => {
      const s = window.__globeLab.state();
      return s.altitudeM;
    });
    const frames = [];
    const costs = [];
    for (let i = 0; i <= 10; i++) {
      const share = i / 10;
      await page.evaluate((h) => {
        location.hash = h;
      }, `${base}&bandShare=${share}`);
      await page.waitForFunction(
        (want) => window.__globeLab.state().relief?.share === want,
        share,
      );
      await settleBoth(page);
      frames.push(
        await page.evaluate((g) => window.__globeLab.readPixels(g), grid),
      );
      if (i % 5 === 0) {
        const s = await page.evaluate(() => window.__globeLab.state());
        costs.push({
          share,
          globeTiles: s.relief.globeDrawn ? s.relief.globeTiles : 0,
          reliefTiles: s.relief.reliefDrawn ? s.relief.visibleTiles : 0,
          ms:
            (await page.evaluate(() => window.__globeLab.timeFrames(10))) / 10,
        });
      }
    }
    const steps = frames.slice(1).map((f, i) => meanDiff(frames[i], f));
    const max = Math.max(...steps);
    worst.push(max);
    console.log(
      `band at ${altKm} km (landed ${(natural / 1000).toFixed(0)} km): per 0.1 of share, mean |difference| ${steps.map((d) => d.toFixed(2)).join(" ")}; worst ${max.toFixed(2)} (bound ${STEP}: ${verdict(max)}); full swap ${meanDiff(frames[0], frames[10]).toFixed(2)}; cost ${costs.map((c) => `share ${c.share}: globe ${c.globeTiles} tiles, relief ${c.reliefTiles} tiles, ${c.ms.toFixed(1)} ms a frame`).join("; ")}`,
    );
    expect(errors, `${altKm} km`).toEqual([]);
    // Outside the band (share 0 and 1) the other carrier is not drawn.
    expect(costs[0].reliefTiles, `${altKm} km`).toBe(0);
    expect(costs[2].globeTiles, `${altKm} km`).toBe(0);
    await context.close();
  }
  for (const max of worst) expect(max).toBeLessThanOrEqual(STEP);
});
