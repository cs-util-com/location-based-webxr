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
 *
 * These smokes measure the SETTLED frame (the relief's own queues idle):
 * a steady state, not what a viewer sees while tiles still arrive in
 * flight. The loading itself is measured elsewhere (the band's cost and
 * the phone's requests).
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
  const landedAt = Date.now();
  // Let the relief's tiles at the held altitude load and settle (its own
  // queues idle): a frame read while coarse tiles still stand in for fine
  // ones measured the loading, not the relief (centre 0.19 degrees off,
  // the detail's frames 12.8 levels apart).
  await page.waitForFunction(
    () => {
      const r = window.__globeLab.state().relief;
      return r?.visibleTiles > 0 && r.settled;
    },
    null,
    { timeout: 180_000 },
  );
  // The settle's own time, against the 180 s wait (CI runs 1.2-1.5x
  // slower than a local run), so the margin is read, not inferred.
  console.log(
    `relief settled ${((Date.now() - landedAt) / 1000).toFixed(1)} s after landing (wait 180 s)`,
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
// stronger detail. The bound is the noise of two loads without the detail:
// at the lab's default 0.5 the difference must exceed 3 times it (and
// 0.05 levels, should two loads match exactly), reported at x0.5 and x2;
// the sweep (0.25, 0.5, 1) shows the weight acting. A first run measured
// 0.10, 0.21 and 0.40 levels at 150 km, with 88 % of the region's factors
// away from 1: the detail is a fine high-pass, subtle from the hold.
test("the relief's tiles take the terrain lab's detail under the hold", async ({
  browser,
}) => {
  test.setTimeout(900_000);
  const grid = groundGrid();
  const frames = {};
  const states = {};
  for (const detail of [0, "0b", 0.25, 0.5, 1]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const weight = detail === "0b" ? 0 : detail;
    const errors = await diveAndLand(page, context, `${BASE}&detail=${weight}`);
    if (weight > 0) {
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
  const noise = diff("0b");
  const BOUND = Math.max(3 * noise, 0.05);
  const verdict = (v) =>
    [0.5, 1, 2].map((k) => `x${k} ${v > BOUND * k ? "ok" : "NO"}`).join(" ");
  console.log(
    `relief detail under the hold (the region: ${states[0.5]?.tiles} z8 height tiles, ${((states[0.5]?.bytes ?? 0) / 2 ** 20).toFixed(2)} MiB), ${grid.length} points against detail 0: noise (a second load at 0) ${noise.toFixed(3)}; 0.25 ${diff(0.25).toFixed(2)}, 0.5 ${diff(0.5).toFixed(2)} (bound ${BOUND.toFixed(3)}: ${verdict(diff(0.5))}), 1 ${diff(1).toFixed(2)}; region ${JSON.stringify(states[0.5])}`,
  );
  expect(states[0]?.state).toBe("idle");
  expect(states[0.5]?.state).toBe("ready");
  expect(states[0.5]?.changedShare).toBeGreaterThan(0.05);
  expect(diff(0.5)).toBeGreaterThan(BOUND);
  expect(diff(0.25)).toBeLessThan(diff(0.5));
  expect(diff(0.5)).toBeLessThan(diff(1));
});

/**
 * Waits until both carriers have loaded what they draw (the globe's queue
 * empty, the relief's own queues idle) and the counts hold still for 3 s.
 * After 120 s the frame is taken as it is and the log says so.
 */
async function settleBoth(page, label) {
  const waiting = page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      const r = s.relief;
      const ready =
        (r.share >= 1 || s.pendingTiles === 0) &&
        (r.share <= 0 || (r.settled && r.visibleTiles > 0));
      const w = window;
      const key = `${r.share},${s.loadedTiles},${r.visibleTiles},${r.stats.loaded}`;
      if (!ready || w.__bandKey !== key) {
        w.__bandKey = key;
        w.__bandSince = performance.now();
        return false;
      }
      return performance.now() - w.__bandSince >= 3000;
    },
    null,
    { timeout: 120_000, polling: 100 },
  );
  try {
    await waiting;
    return true;
  } catch {
    const s = await page.evaluate(() => window.__globeLab.state());
    console.log(
      `band settle: not still after 120 s (${label}): share ${s.relief?.share}, globe pending ${s.pendingTiles} loaded ${s.loadedTiles} refused ${s.refusedTiles}, relief visible ${s.relief?.visibleTiles} stats ${JSON.stringify(s.relief?.stats)} cache ${((s.relief?.cachedBytes ?? 0) / 2 ** 20).toFixed(1)} MiB, altitude ${(s.altitudeM / 1000).toFixed(0)} km`,
    );
    return false;
  }
}

// WHY (one-scene plan §3.2 and §6; F1): above the band the globe's own
// surface draws, below it the relief's tiles, and between them a dithered
// cross-fade. What this check measures (review 2026-10-03-1835 major 3):
// at a FIXED view, a 0.1 step of the share moves a tenth of the pixels
// from one carrier to the other, so the step is a tenth of the two
// carriers' distance (the full swap) by construction. It bounds that
// distance per step at a mean 1 level (reported at x0.5 and x2); it does
// not measure continuity under motion, which the moving-camera check
// below does. Both carriers are loaded first at share
// 0.5, then their tiles are frozen (`bandFreeze`) and the share stepped,
// so the steps measure the fade, not the tiles still refining. Measured
// at three heights across the band. Outside the band the other carrier is
// not drawn; the tile counts, the relief's cache and a frame-time ratio
// (SwiftShader, relative only) at share 0, 0.5 and 1 state its cost.
test("the band's cross-fade between the globe and the relief is continuous, and its cost stated", async ({
  browser,
}) => {
  test.setTimeout(1_500_000);
  const grid = groundGrid();
  const STEP = 1;
  const verdict = (v) =>
    [0.5, 1, 2].map((k) => `x${k} ${v <= STEP * k ? "ok" : "NO"}`).join(" ");
  const worst = [];
  const unsettled = [];
  for (const altKm of [1900, 1550, 1250]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    // The carriers' own cross-fade: without round 6's stencil fill (the
    // globe drawn behind the relief at share 1, by design) and without the
    // cloud shell (its clouds and shadow add their own swap across the
    // band, 19 levels against 6); both have their own smokes
    // (globe-handover, globe-clouds). Red since round 6 until pinned (the
    // full run of 2026-10-05, bisected to d0bb6cbe and the shell).
    const base = `${BASE}&handOverKm=${altKm}&detail=0&bandFill=0&cloudShell=0`;
    await context.grantPermissions(["geolocation"], { origin: ORIGIN });
    await context.setGeolocation(TARGET);
    const errors = await bootGlobe(page, `${base}&bandShare=0.5`);
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
    if (!(await settleBoth(page, `${altKm} km, both at 0.5`))) {
      unsettled.push(`${altKm} km`);
    }
    const frames = [];
    const costs = [];
    for (let i = 0; i <= 10; i++) {
      const share = i / 10;
      await page.evaluate((h) => {
        location.hash = h;
      }, `${base}&bandShare=${share}&bandFreeze=1`);
      await page.waitForFunction(
        (want) => window.__globeLab.state().relief?.share === want,
        share,
      );
      frames.push(
        await page.evaluate((g) => window.__globeLab.readPixels(g), grid),
      );
      if (i % 5 === 0) {
        const s = await page.evaluate(() => window.__globeLab.state());
        costs.push({
          share,
          globePending: s.pendingTiles,
          globeTiles: s.relief.globeDrawn ? s.relief.globeTiles : 0,
          reliefTiles: s.relief.reliefDrawn ? s.relief.visibleTiles : 0,
          reliefMiB: s.relief.cachedBytes / 2 ** 20,
          ms:
            (await page.evaluate(() => window.__globeLab.timeFrames(10))) / 10,
        });
      }
    }
    // Frozen means nothing loads or unloads: both caches still hold tiles
    // after the sweep (a release during the sweep emptied them once).
    const after = await page.evaluate(() => window.__globeLab.state());
    expect(after.relief.cachedBytes, `${altKm} km`).toBeGreaterThan(0);
    expect(after.relief.globeCachedBytes, `${altKm} km`).toBeGreaterThan(0);
    const steps = frames.slice(1).map((f, i) => meanDiff(frames[i], f));
    const max = Math.max(...steps);
    worst.push(max);
    console.log(
      `band at ${altKm} km (landed ${(natural / 1000).toFixed(0)} km): per 0.1 of share, mean |difference| ${steps.map((d) => d.toFixed(2)).join(" ")}; worst ${max.toFixed(2)} (bound ${STEP}: ${verdict(max)}); full swap ${meanDiff(frames[0], frames[10]).toFixed(2)}; cost ${costs.map((c) => `share ${c.share}: globe ${c.globeTiles} tiles (${c.globePending} pending), relief ${c.reliefTiles} tiles (its cache ${c.reliefMiB.toFixed(1)} MiB), ${c.ms.toFixed(1)} ms a frame`).join("; ")}`,
    );
    expect(errors, `${altKm} km`).toEqual([]);
    // Outside the band (share 0 and 1) the other carrier is not drawn.
    expect(costs[0].reliefTiles, `${altKm} km`).toBe(0);
    expect(costs[2].globeTiles, `${altKm} km`).toBe(0);
    await context.close();
  }
  console.log(
    `band frames taken still loading: ${unsettled.join(", ") || "none"}`,
  );
  for (const max of worst) expect(max).toBeLessThanOrEqual(STEP);
});

// WHY (one-scene plan §3.4; review 2026-10-03-1835 major 1): the clearance
// once came from a single ray at the pin press, from orbit, where no relief
// was loaded, so it was 0. Now every frame the camera is kept above the
// drawn ground under it by the clearance. Held at 5 km across a ridge of
// the synthetic heights (crest at 46.5 N 9.125 E, about 1.6-2.2 km, drawn at
// E 3 so 4.8-6.6 km): the camera, 5 km south of the target at 45 degrees,
// stands over the crest and about 2 km either side of it. At every point
// the hold must sit at least the clearance over the drawn ground, and
// wherever the ground comes within the clearance of the 5 km hold the
// camera must have been lifted. Measured on the settled frame.
for (const [label, lat] of [
  ["over the crest", 46.545],
  ["2 km north of the crest", 46.563],
  ["2 km south of the crest", 46.527],
]) {
  test(`the clearance holds every frame: a 5 km hold ${label}`, async ({
    page,
    context,
  }) => {
    test.setTimeout(300_000);
    await context.grantPermissions(["geolocation"], { origin: ORIGIN });
    await context.setGeolocation({ latitude: lat, longitude: 9.125 });
    const errors = await bootGlobe(page, `${BASE}&handOverKm=5`);
    await page.locator("#globe-pin").click();
    await page.waitForFunction(
      () => {
        const st = window.__globeLab.state();
        return (
          st.phase === "landed" &&
          st.pin.phase === "idle" &&
          st.relief?.groundUnderCameraM !== null &&
          st.relief?.visibleTiles > 0 &&
          st.relief.settled
        );
      },
      null,
      { timeout: 180_000 },
    );
    const st = await page.evaluate(() => window.__globeLab.state());
    const ground = st.relief.groundUnderCameraM;
    const needsLift = Math.max(0, ground) + 300 > 5_000;
    console.log(
      `clearance at a 5 km hold ${label}: altitude ${(st.altitudeM / 1000).toFixed(2)} km, drawn ground under the camera ${(ground / 1000).toFixed(2)} km (E ${st.relief.heightScale}), lift needed ${needsLift}, lifted on ${st.relief.clearanceLifts} frames`,
    );
    expect(errors).toEqual([]);
    expect(st.altitudeM).toBeGreaterThanOrEqual(Math.max(0, ground) + 300 - 1);
    expect(st.relief.clearanceLifts > 0).toBe(needsLift);
  });
}

// WHY (review 2026-10-03-1835 major 3): the dither is a screen pattern, so
// a moving camera slides the ground under it and the fade could shimmer.
// The camera is held at 31 dive times through the band (about three real
// frames apart in altitude), over the same loaded tiles (frozen), three
// times: the fade by altitude, the globe alone (share 0) and the relief
// alone (share 1). The fade's worst frame-to-frame change may exceed the
// worse of the two carriers' own by at most a mean 1 level (reported at
// x0.5 and x2); more is the dither shimmering.
test("the band's fade does not shimmer under a moving camera", async ({
  page,
  context,
}) => {
  test.setTimeout(900_000);
  const grid = groundGrid();
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(TARGET);
  const base = `${BASE}&handOverKm=1100&detail=0`;
  const errors = await bootGlobe(page, `${base}&bandShare=0.5`);
  await page.locator("#globe-pin").click();
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return s.phase === "landed" && s.pin.phase === "idle";
    },
    null,
    { timeout: 120_000 },
  );
  // Both carriers load at the band's middle, then the tiles are frozen.
  const mid = await page.evaluate(() => {
    let lo = 0;
    let hi = 60_000;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (window.__globeLab.diveAltitudeAt(m) > 1_550_000) lo = m;
      else hi = m;
    }
    return lo;
  });
  await page.evaluate((ms) => window.__globeLab.holdDiveAt(ms), mid);
  await settleBoth(page, "moving camera, both at 0.5");
  const times = await page.evaluate(() => {
    const at = (km) => {
      let lo = 0;
      let hi = 60_000;
      for (let i = 0; i < 40; i++) {
        const m = (lo + hi) / 2;
        if (window.__globeLab.diveAltitudeAt(m) > km * 1000) lo = m;
        else hi = m;
      }
      return lo;
    };
    const out = [];
    for (let i = 0; i <= 30; i++) {
      out.push(at(2_050 * (1_150 / 2_050) ** (i / 30)));
    }
    return out;
  });
  const rows = {};
  for (const [label, extra] of [
    ["fade", ""],
    ["globe", "&bandShare=0"],
    ["relief", "&bandShare=1"],
  ]) {
    await page.evaluate((h) => {
      location.hash = h;
    }, `${base}${extra}&bandFreeze=1`);
    const frames = [];
    for (const ms of times) {
      await page.evaluate((t) => window.__globeLab.holdDiveAt(t), ms);
      frames.push(
        await page.evaluate((g) => window.__globeLab.readPixels(g), grid),
      );
    }
    const held = await page.evaluate(() => window.__globeLab.state());
    expect(held.relief.cachedBytes, label).toBeGreaterThan(0);
    expect(held.relief.globeCachedBytes, label).toBeGreaterThan(0);
    const steps = frames.slice(1).map((f, i) => meanDiff(frames[i], f));
    rows[label] = {
      max: Math.max(...steps),
      mean: steps.reduce((a, b) => a + b, 0) / steps.length,
    };
  }
  const MARGIN = 1;
  const worst = Math.max(rows.globe.max, rows.relief.max);
  const excess = rows.fade.max - worst;
  console.log(
    `band under a moving camera, 31 frames 2,050 to 1,150 km: worst frame-to-frame step fade ${rows.fade.max.toFixed(2)} (mean ${rows.fade.mean.toFixed(2)}), globe ${rows.globe.max.toFixed(2)} (${rows.globe.mean.toFixed(2)}), relief ${rows.relief.max.toFixed(2)} (${rows.relief.mean.toFixed(2)}); excess ${excess.toFixed(2)} (margin ${MARGIN}: ${[0.5, 1, 2].map((k) => `x${k} ${excess <= MARGIN * k ? "ok" : "NO"}`).join(" ")})`,
  );
  expect(errors).toEqual([]);
  expect(excess).toBeLessThanOrEqual(MARGIN);
});

// WHY (review 2026-10-03-1835 major 4): "outside the band the other carrier
// fetches nothing" was true by construction and unmeasured, and the
// globe's 64 MB cache stayed resident down to the hold. On a phone's
// viewport (390 x 844 at DPR 2): above the band the relief has fetched
// nothing; at the 150 km hold the globe's cache has been released down to
// its coarsest tiles and the globe asks for no tile over five seconds; the
// two caches together stay under 72 MiB there (the relief's own 64 MB
// budget plus an eighth), reported at x0.5 and x2. Since round 6 the
// drain keeps the globe's coarsest tiles on purpose: they are the stencil
// fill behind the relief (plan 2026-10-04-1050 G6-1). Kept: more than
// nothing (the fill needs them) and at most 8 MiB, the same eighth of the
// globe's 64 MB budget (4.0 MiB measured on 2026-10-05).
test("outside the band the other carrier fetches nothing and holds no memory, on a phone", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(TARGET);
  const errors = await bootGlobe(page, BASE);
  await page.waitForFunction(
    () => window.__globeLab.state().pendingTiles === 0,
    null,
    { timeout: 120_000 },
  );
  const above = await page.evaluate(() => window.__globeLab.state());
  await page.locator("#globe-pin").click();
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return (
        s.phase === "landed" &&
        s.pin.phase === "idle" &&
        s.relief?.settled &&
        s.relief.visibleTiles > 0
      );
    },
    null,
    { timeout: 120_000 },
  );
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const t0 = await page.evaluate(() => {
    const s = window.__globeLab.state();
    return { requests: s.tileRequestsByLevel, at: performance.now() };
  });
  await page.waitForFunction((at) => performance.now() - at > 5_000, t0.at);
  // The release spreads its disposals over frames (bandDrainTiles, perf
  // plan 2026-10-03-2017 H4): read once the globe's drain has finished.
  await page.waitForFunction(
    () => window.__globeLab.state().relief.lastRelease.globe?.drainedAt != null,
    null,
    { timeout: 120_000 },
  );
  const held = await page.evaluate(() => window.__globeLab.state());
  const MIB = 2 ** 20;
  const total = (held.relief.cachedBytes + held.relief.globeCachedBytes) / MIB;
  const LIMIT = 72;
  console.log(
    `phone 390x844 DPR 2: above the band relief loaded ${above.relief.stats.loaded}, cache ${(above.relief.cachedBytes / MIB).toFixed(1)} MiB; at the hold the globe released ${(held.relief.releasedBytes.globe / MIB).toFixed(1)} MiB, its cache ${(held.relief.globeCachedBytes / MIB).toFixed(1)} MiB, globe tile requests over 5 s ${sum(held.tileRequestsByLevel) - sum(t0.requests)}; both caches ${total.toFixed(1)} MiB (limit ${LIMIT}: ${[0.5, 1, 2].map((k) => `x${k} ${total <= LIMIT * k ? "ok" : "NO"}`).join(" ")})`,
  );
  expect(errors).toEqual([]);
  expect(above.relief.stats.loaded).toBe(0);
  expect(above.relief.cachedBytes).toBe(0);
  expect(held.relief.releasedBytes.globe).toBeGreaterThan(0);
  expect(held.relief.globeCachedBytes).toBeGreaterThan(0);
  expect(held.relief.globeCachedBytes).toBeLessThanOrEqual(8 * MIB);
  expect(sum(held.tileRequestsByLevel)).toBe(sum(t0.requests));
  expect(total).toBeLessThanOrEqual(LIMIT);
  await context.close();
});

// WHY (review 2026-10-03-1835 minor 9): the detail test proved the wiring
// (the frame changes); this proves the PLACE. A planted grid brightens the
// ground east of the target by 1.6 and leaves the west alone; from the
// hold, looking north, east is the frame's right. The right of the frame
// must brighten and the left must not (bounds: right up by at least 3
// levels, left within 0.5; reported at x0.5 and x2).
test("a planted detail grid lands where it is placed: east of the target brightens, west does not", async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  // The placement alone: round 6's sharp takeover and the cloud shell
  // change the frame while it is read (the relief taking pixels late, the
  // shell's clouds and shadow over the relief), which drifted the west half
  // by 4.3 and then 22 levels with nothing planted there (bisected
  // 2026-10-05: fb27d790, then the shell). Their own smokes cover them.
  const errors = await diveAndLand(
    page,
    context,
    `${BASE}&detail=0&bandSharp=0&cloudShell=0`,
  );
  const half = (left) => {
    const g = [];
    for (let y = 0.45; y <= 0.95; y += 0.05)
      for (let x = left ? 0.05 : 0.6; x <= (left ? 0.4 : 0.95); x += 0.05)
        g.push([x, y]);
    return g;
  };
  const read = (g) => page.evaluate((p) => window.__globeLab.readPixels(p), g);
  const lum = (px) =>
    px.reduce((s, p) => s + 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2], 0) /
    px.length;
  const before = {
    left: lum(await read(half(true))),
    right: lum(await read(half(false))),
  };
  expect(
    await page.evaluate(() => window.__globeLab.plantDetail(1.6)),
  ).not.toBeNull();
  const after = {
    left: lum(await read(half(true))),
    right: lum(await read(half(false))),
  };
  const up = after.right - before.right;
  const drift = Math.abs(after.left - before.left);
  console.log(
    `planted detail (1.6 east of the target): right half ${before.right.toFixed(1)} -> ${after.right.toFixed(1)} (up ${up.toFixed(2)}, floor 3: ${[0.5, 1, 2].map((k) => `x${k} ${up >= 3 * k ? "ok" : "NO"}`).join(" ")}), left half ${before.left.toFixed(1)} -> ${after.left.toFixed(1)} (drift ${drift.toFixed(2)}, bound 0.5: ${[0.5, 1, 2].map((k) => `x${k} ${drift <= 0.5 * k ? "ok" : "NO"}`).join(" ")})`,
  );
  expect(errors).toEqual([]);
  expect(up).toBeGreaterThanOrEqual(3);
  expect(drift).toBeLessThanOrEqual(0.5);
});

// WHY (frame-hitch review 2026-10-03-2017 H4): releasing a carrier's cache
// at the very frame it leaves the band made a zoom that wobbles over an
// edge unload, reload and recompile again and again. A carrier is released
// only after it has stayed out of the band for `bandReleaseMs`. Five quick
// excursions out of the band release nothing; a stay out releases no
// sooner than the hold and at most one frame after it, timed in the page
// (the frame that left the band to the frame that released), for holds of
// 2, 5 and 10 s. Timed from the test, the release came a constant 2.6-2.8 s
// after the hold, for every hold: the test's own latency (the hash, the
// polling, frames of about 0.5 s under SwiftShader) and the release's
// dispose burst, which is logged here for the frame-hitch plan (H4).
test("a carrier's cache is released only after it stays out of the band", async ({
  page,
  context,
}) => {
  test.setTimeout(900_000);
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(TARGET);
  const base = `${BASE}&handOverKm=1550&detail=0`;
  const errors = await bootGlobe(page, `${base}&bandShare=0.5`);
  await page.locator("#globe-pin").click();
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return s.phase === "landed" && s.pin.phase === "idle";
    },
    null,
    { timeout: 120_000 },
  );
  await settleBoth(page, "release hold, both at 0.5");
  const releasedGlobe = () =>
    page.evaluate(() => window.__globeLab.state().relief.releasedBytes.globe);
  const setHash = (h) =>
    page.evaluate((x) => {
      location.hash = x;
    }, h);
  const at = (h) =>
    page.waitForFunction((x) => window.__globeLab.state().appliedHash === x, h);
  // Five excursions out of the band (share 1), each under a second.
  for (let i = 0; i < 5; i++) {
    await setHash(`${base}&bandShare=1&bandReleaseMs=5000`);
    await at(`${base}&bandShare=1&bandReleaseMs=5000`);
    await setHash(`${base}&bandShare=0.5&bandReleaseMs=5000`);
    await at(`${base}&bandShare=0.5&bandReleaseMs=5000`);
  }
  const afterWobble = await releasedGlobe();
  const rows = [];
  for (const holdMs of [2_000, 5_000, 10_000]) {
    // Back in the band, reloading, then out for good.
    await setHash(`${base}&bandShare=0.5&bandReleaseMs=${holdMs}`);
    await settleBoth(page, `release hold ${holdMs} ms, back at 0.5`);
    const before = await releasedGlobe();
    await setHash(`${base}&bandShare=1&bandReleaseMs=${holdMs}`);
    await page.waitForFunction(
      (b) => window.__globeLab.state().relief.releasedBytes.globe > b,
      before,
      { timeout: holdMs + 30_000 },
    );
    // The drain runs over frames; read it once it has finished.
    await page.waitForFunction(
      () =>
        window.__globeLab.state().relief.lastRelease.globe?.drainedAt != null,
      null,
      { timeout: 120_000 },
    );
    const last = await page.evaluate(
      () => window.__globeLab.state().relief.lastRelease.globe,
    );
    const frameMs =
      (await page.evaluate(() => window.__globeLab.timeFrames(5))) / 5;
    rows.push({
      holdMs,
      took: last.releasedAt - last.leftAt,
      releaseMs: last.releaseMs,
      worstFrameMs: last.worstFrameMs,
      frames: last.frames,
      maxPerFrame: last.maxPerFrame,
      bytes: last.bytes,
      frameMs,
    });
  }
  console.log(
    `release hold: after five excursions under a second, released ${afterWobble} bytes; ${rows.map((r) => `hold ${r.holdMs} ms released ${r.took.toFixed(0)} ms after leaving (a frame ${r.frameMs.toFixed(0)} ms), the release took ${r.releaseMs.toFixed(0)} ms for ${(r.bytes / 2 ** 20).toFixed(1)} MiB over ${r.frames} frames, at most ${r.maxPerFrame} tiles and ${r.worstFrameMs.toFixed(1)} ms in one`).join(", ")}`,
  );
  expect(errors).toEqual([]);
  expect(afterWobble).toBe(0);
  for (const r of rows) {
    expect(r.took).toBeGreaterThanOrEqual(r.holdMs);
    // One frame after the hold at most, with the frame's own spread.
    expect(r.took).toBeLessThan(r.holdMs + 2 * r.frameMs);
    // The drain's cap (bandDrainTiles 8 by default) holds in every frame.
    expect(r.maxPerFrame).toBeGreaterThan(0);
    expect(r.maxPerFrame).toBeLessThanOrEqual(8);
  }
});
