// @ts-check
/**
 * The band's hand-over without holes (round-6 plan 2026-10-04-1050 G6-1,
 * DEC-G6-2), measured in the browser.
 *
 * Why this file matters: the owner saw the whole Earth turn blue at the
 * switch between the globe and the relief. The relief took pixels by
 * altitude before it had a tile there, and the background showed through.
 * Here the dive and a zoom out run while every frame is read, with the
 * frame cleared magenta (`holeColor=1`), so a pixel no carrier drew is
 * unambiguous. The gate and the stencil fill (`bandGate=1&bandFill=1`, the
 * defaults) must leave no hole. The old rule (both 0) is the positive
 * control: it must show holes, or this check could not see one.
 */
import { expect, test } from "@playwright/test";

import { bootGlobe } from "./globe-smoke-helpers.mjs";

const ORIGIN = `http://127.0.0.1:${process.env.DS_E2E_PORT ?? "5198"}`;
const TARGET = { latitude: 46.5, longitude: 9.0 };
const BASE =
  "spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z&cloudDrift=0&stars=0&milkyWay=0&atmo=0&space=0&sky=0&relief=1&reliefHeights=synthetic&diveMs=6000&handOver=0&detail=0&holeColor=1";

/**
 * A pixel no carrier drew shows the clear colour, magenta with
 * `holeColor=1`: red and blue at least this, green at most 255 minus it.
 * Black was ambiguous: dark water at an oblique view reads near black
 * (2026-10-04, the Mediterranean in a zoom out).
 */
const HOLE_MIN = 240;

/**
 * Below this altitude (km) the globe's disk fills the frame (at 2,000 km
 * it spans about 100 degrees, twice the 50 degree view); above it the
 * lower grid can read space past the limb, which is not a hole. The band
 * starts at 2,000 km.
 */
const FILLS_FRAME_KM = 2_100;

/** Points over the lower half of the frame, where the ground is in the dive. */
function lowerGrid() {
  const grid = [];
  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 5; j++) grid.push([0.2 + i * 0.075, 0.55 + j * 0.08]);
  }
  return grid;
}

/**
 * Reads one frame in the page: its hole count, the band's share and the
 * altitude. Runs inside `page.evaluate`, so it takes plain values.
 */
function readFrame({ grid, holeMin }) {
  const lab = window.__globeLab;
  const px = lab.readPixels(grid);
  const s = lab.state();
  const live = JSON.parse(lab.debug.exportText()).live;
  const hole = ([r, g, b]) =>
    r >= holeMin && b >= holeMin && g <= 255 - holeMin;
  return {
    holes: px.filter(hole).length,
    holeAt: grid.filter((_, i) => hole(px[i])).slice(0, 4),
    share: s.relief?.share ?? null,
    settled: s.relief?.settled ?? null,
    phase: s.phase,
    altKm: live.altitudeKm,
  };
}

/** Dives with `gate` and reads every frame until the relief has taken over. */
async function diveAndCount(page, context, gate) {
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(TARGET);
  const errors = await bootGlobe(
    page,
    `${BASE}&bandGate=${gate}&bandFill=${gate}`,
  );
  await page.locator("#globe-pin").click();
  const frames = [];
  const started = Date.now();
  let landedAt = null;
  // Each read renders one frame; until the relief has every pixel (or 20 s
  // after landing), at most 120 s.
  // The relief takes over only once its view is refined, which takes up to
  // about 90 s at the hold under SwiftShader: 120 s after landing at most.
  while (Date.now() - started < 240_000) {
    const f = await page.evaluate(readFrame, {
      grid: lowerGrid(),
      holeMin: HOLE_MIN,
    });
    if (f.phase === "landed" && landedAt === null) landedAt = Date.now();
    f.sinceLandMs = landedAt === null ? null : Date.now() - landedAt;
    frames.push(f);
    if (landedAt !== null && (f.share ?? 0) >= 1) break;
    if (landedAt !== null && Date.now() - landedAt > 120_000) break;
  }
  return { frames, errors };
}

/**
 * Zooms out (wheel steps at the canvas centre) from a landed dive whose
 * globe tiles were released, reading a frame after each step until the
 * camera is above the band.
 */
async function zoomOutAndCount(page, context, gate) {
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(TARGET);
  const errors = await bootGlobe(
    page,
    // The old rule also released every tile at once, the coarsest
    // included (`bandDrainTiles=0`); the new drain keeps them.
    `${BASE}&bandGate=${gate}&bandFill=${gate}&bandReleaseMs=1000${gate === 1 ? "" : "&bandDrainTiles=0"}`,
  );
  await page.locator("#globe-pin").click();
  // Landed, the relief has every pixel, and the globe's cache is drained.
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return (
        s.phase === "landed" &&
        (s.relief?.share ?? 0) >= 1 &&
        s.relief?.lastRelease?.globe?.drainedAt != null
      );
    },
    null,
    { timeout: 180_000 },
  );
  const box = await page.locator("#globe-canvas").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const frames = [];
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    await page.mouse.wheel(0, 300);
    const f = await page.evaluate(readFrame, {
      grid: lowerGrid(),
      holeMin: HOLE_MIN,
    });
    frames.push(f);
    if (f.altKm > FILLS_FRAME_KM * 1.2) break;
  }
  return { frames, errors };
}

/** The frames below the band's top, and those of them with a hole. */
function summarise(frames) {
  const inBand = frames.filter((f) => f.altKm <= FILLS_FRAME_KM);
  const holeFrames = inBand.filter((f) => f.holes > 0);
  const detail = holeFrames
    .map(
      (f) =>
        `${f.holes}@${Math.round(f.altKm)}km/share ${f.share?.toFixed(2)} at ${JSON.stringify(f.holeAt)}`,
    )
    .join(", ");
  return { inBand, holeFrames, detail };
}

for (const gate of [1, 0]) {
  const label =
    gate === 1
      ? "shows no hole with the gate and the fill"
      : "shows holes without them (the positive control)";

  test(`the dive through the band ${label}`, async ({ page, context }) => {
    test.setTimeout(300_000);
    const { frames, errors } = await diveAndCount(page, context, gate);
    const { inBand, holeFrames, detail } = summarise(frames);
    const reliefFrames = frames.filter((f) => (f.share ?? 0) > 0).length;
    console.log(
      `dive, gate and fill ${gate}: ${frames.length} frames (${inBand.length} below ${FILLS_FRAME_KM} km), ${holeFrames.length} with a hole, ${reliefFrames} with relief pixels, last share ${frames.at(-1)?.share}; ${detail}`,
    );
    expect(errors).toEqual([]);
    // The relief did take over: the check ran through the band.
    expect(reliefFrames).toBeGreaterThan(0);
    // With the gate the relief takes its first pixels only once its view is
    // refined (owner 2026-10-04: no flash from the globe's sharp imagery to
    // the relief's coarse first tiles).
    const first = frames.find((f) => (f.share ?? 0) > 0);
    console.log(
      `dive, gate and fill ${gate}: the relief's first pixels at ${Math.round(first?.altKm ?? -1)} km, ${first?.sinceLandMs == null ? "before landing" : `${(first.sinceLandMs / 1000).toFixed(1)} s after landing`}, settled ${first?.settled}`,
    );
    if (gate === 1) expect(first?.settled).toBe(true);
    if (gate === 1) expect(holeFrames.length).toBe(0);
    else expect(holeFrames.length).toBeGreaterThan(0);
  });

  test(`zooming out of the band ${label}`, async ({ page, context }) => {
    test.setTimeout(420_000);
    const { frames, errors } = await zoomOutAndCount(page, context, gate);
    const { inBand, holeFrames, detail } = summarise(frames);
    const top = Math.max(...frames.map((f) => f.altKm));
    console.log(
      `zoom out, gate and fill ${gate}: ${frames.length} frames (${inBand.length} below ${FILLS_FRAME_KM} km), ${holeFrames.length} with a hole, top ${Math.round(top)} km; ${detail}`,
    );
    expect(errors).toEqual([]);
    // The zoom left the band: the check ran through it.
    expect(top).toBeGreaterThan(FILLS_FRAME_KM);
    if (gate === 1) expect(holeFrames.length).toBe(0);
    else expect(holeFrames.length).toBeGreaterThan(0);
  });
}

// Why (owner decision 2026-10-04: the fill "with a cost measurement"): the
// globe now draws while the relief has the pixels (only where the relief
// left one, the stencil rejecting the rest) and keeps its top tiles. Its
// cost is measured at the hold against the fill off, in the same session,
// alternating three times; logged, not asserted (relative under SwiftShader;
// the owner's phone reads it with the Debug panel's recording).
test("the stencil fill's cost at the hold, on against off (logged)", async ({
  context,
}) => {
  test.setTimeout(600_000);
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(TARGET);
  const perFrame = {};
  for (const round of [1, 2, 3]) {
    for (const fill of [1, 0]) {
      // A fresh page each time: the fill is read at start.
      const page = await context.newPage();
      const errors = await bootGlobe(page, `${BASE}&bandFill=${fill}`);
      await page.locator("#globe-pin").click();
      await page.waitForFunction(
        () => {
          const s = window.__globeLab.state();
          return s.phase === "landed" && (s.relief?.share ?? 0) >= 1;
        },
        null,
        { timeout: 180_000 },
      );
      const ms = await page.evaluate(() => window.__globeLab.timeFrames(20));
      (perFrame[fill] ??= []).push(ms / 20);
      expect(errors, `round ${round}, fill ${fill}`).toEqual([]);
      await page.close();
    }
  }
  const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const on = median(perFrame[1]);
  const off = median(perFrame[0]);
  console.log(
    `stencil fill cost at the hold: on ${on.toFixed(0)} ms, off ${off.toFixed(0)} ms a frame (median of 3, SwiftShader), x${(on / off).toFixed(3)}; rounds on ${perFrame[1].map((v) => v.toFixed(0)).join("/")}, off ${perFrame[0].map((v) => v.toFixed(0)).join("/")}`,
  );
  expect(Number.isFinite(on / off)).toBe(true);
});

/**
 * Lands, zooms out until the relief has been drained, zooms back in to
 * where it landed, and returns the height tiles requested on the way back
 * (owner decision 2026-10-04, DEC-N1).
 */
async function returnIntoBand(page, context, keepMiB) {
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(TARGET);
  const errors = await bootGlobe(
    page,
    `${BASE}&bandReleaseMs=1000&keepHeightsMiB=${keepMiB}`,
  );
  await page.locator("#globe-pin").click();
  const state = () => page.evaluate(() => window.__globeLab.state());
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return (
        s.phase === "landed" && (s.relief?.share ?? 0) >= 1 && s.relief?.settled
      );
    },
    null,
    { timeout: 240_000 },
  );
  const landed = await state();
  const altKm = () =>
    page.evaluate(
      () => JSON.parse(window.__globeLab.debug.exportText()).live.altitudeKm,
    );
  const landedKm = await altKm();
  const box = await page.locator("#globe-canvas").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  let steps = 0;
  while ((await altKm()) < 2_600 && steps < 60) {
    await page.mouse.wheel(0, 300);
    await page.evaluate(() => window.__globeLab.timeFrames(2));
    steps++;
  }
  // Out of the band: the relief is drained (all but its coarsest tiles).
  await page.waitForFunction(
    () =>
      window.__globeLab.state().relief?.lastRelease?.relief?.drainedAt != null,
    null,
    { timeout: 120_000 },
  );
  const out = await state();
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, -300);
    await page.evaluate(() => window.__globeLab.timeFrames(2));
  }
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return (s.relief?.share ?? 0) >= 1 && s.relief?.settled;
    },
    null,
    { timeout: 240_000 },
  );
  const back = await state();
  return {
    errors,
    landedKm,
    backKm: await altKm(),
    first: landed.relief.heightRequests,
    returned: back.relief.heightRequests - out.relief.heightRequests,
    kept: out.relief.keptHeights,
  };
}

// Why (owner report 2026-10-04: "it seems not to reload the elevation from
// cache"): leaving the band drains the relief, and the library freed its
// decoded heights with the last tile, so a return fetched every height tile
// again. With the keeper (16 MiB, the default) a return must fetch far
// fewer; with it off (0) it refetches, the positive control.
test("a return into the band reuses the kept heights, without the keeper it fetches them again", async ({
  context,
}) => {
  test.setTimeout(900_000);
  const rows = {};
  for (const keepMiB of [16, 0]) {
    const page = await context.newPage();
    rows[keepMiB] = await returnIntoBand(page, context, keepMiB);
    await page.close();
  }
  console.log(
    `return into the band: ${[16, 0]
      .map((k) => {
        const r = rows[k];
        return `keep ${k} MiB: landed ${Math.round(r.landedKm)} km, back at ${Math.round(r.backKm)} km, first descent ${r.first} height tiles, the return ${r.returned}, kept ${r.kept.kept} (${(r.kept.keptBytes / 2 ** 20).toFixed(1)} MiB, ${r.kept.evicted} given back)`;
      })
      .join("; ")}`,
  );
  for (const k of [16, 0]) expect(rows[k].errors, `keep ${k}`).toEqual([]);
  expect(rows[16].kept.kept).toBeGreaterThan(0);
  expect(rows[0].kept.kept).toBe(0);
  // The control refetches; the keeper fetches at most a quarter of that.
  expect(rows[0].returned).toBeGreaterThan(0);
  expect(rows[16].returned).toBeLessThanOrEqual(rows[0].returned / 4);
});
