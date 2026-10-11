// @ts-check
/**
 * The spherical cloud volume from about 700 km (round-4 plan
 * 2026-10-11-0122, R4d / V1, DEC-R4-5 as reconciled with DEC-R3-6 in its
 * §6 item 8; `globe-cloud-shell-volume.js`, `cloudShellVolume=1`).
 *
 * Why this file matters: the owner saw the clouds "almost gone between
 * about 700 and 30 km" and asked for volumetric clouds that take over from
 * about 700 km, coarse following the cloud map, finer from 200 km, today's
 * slab from 30 km, handing over as smoothly as today's volume fades in. A
 * second pass over the slab is exactly where a seam, a dip in the opacity
 * or a jump between "layers" would show, and none of that is visible to a
 * unit test:
 *
 * - **Shots for the owner** at the same poses, before (`cloudShellVolume=0`)
 *   and after (`=1`), written when `R4D_SHOTS_DIR` names a folder, with the
 *   flat layer's and the volumes' shares logged at each (where the gap is).
 */
import { expect, test } from "@playwright/test";

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { globeSource } from "/globe/globe-sources.js";

import { applyHash, bootGlobe } from "./globe-smoke-helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sharp = createRequire(import.meta.url)("sharp");

/** The two places: Lucerne (DEC-R4-2) and a partly cloudy North Atlantic (the map about 0.57). */
const PLACES = {
  lucerne: "47.0502,8.3093",
  ocean: "50.0,-35.0",
};
/** The owner's altitudes (km), the plan's §6 item 8. */
const ALTITUDES = [700, 400, 200, 100, 50, 30, 15];
/** Looking straight down (almost: a heading needs a horizontal part) and at 45 degrees. */
const PITCHES = { down: -89, oblique: -45 };
const BASE =
  "spinMs=0&turnMs=0&time=2026-10-05T11:00:00Z&cloudDrift=0&relief=1&reliefHeights=synthetic&detail=0&cloudNoise=live&city=0&dust=0";

/** The frame's state the shots are judged by. */
const shares = () => {
  const s = window.__globeLab.state();
  return {
    flat: s.cloudFlat,
    slab: s.cloudVolume?.share ?? null,
    shell: s.cloudShellVolume?.share ?? null,
    weight: s.cloudShellVolume?.weight ?? null,
    observerKm: s.groundSky.observerAltitudeKm,
  };
};

test("it compiles and draws at 700, 200 and 50 km, and nothing with the switch off", async ({
  page,
}) => {
  test.setTimeout(900_000);
  const pose = (km, on) =>
    `${BASE}&view=${PLACES.ocean},${km},0,-45&cloudShellVolume=${on}`;
  const errors = await bootGlobe(page, pose(700, 1), { phase: "user" });
  const seen = {};
  for (const km of [700, 200, 50]) {
    await applyHash(page, pose(km, 1));
    await page.evaluate(() => window.__globeLab.timeFrames(2));
    seen[km] = await page.evaluate(() => ({
      state: window.__globeLab.state().cloudShellVolume,
      flat: window.__globeLab.state().cloudFlat,
      back: window.__globeLab.cloudShellReadBack(1)?.[0] ?? null,
    }));
  }
  await applyHash(page, pose(200, 0));
  await page.evaluate(() => window.__globeLab.timeFrames(2));
  const off = await page.evaluate(() => ({
    state: window.__globeLab.state().cloudShellVolume,
    flat: window.__globeLab.state().cloudFlat,
  }));
  console.log(
    `the spherical volume: ${Object.entries(seen)
      .map(
        ([km, x]) =>
          `${km} km weight ${x.state.weight.toFixed(3)} law ${JSON.stringify(x.state.law)} deck ${x.state.deckKm.map((d) => d.toFixed(2)).join("-")} km, the shell's mean alpha ${x.back?.meanAlpha.toFixed(3)} cover ${x.back?.over.toFixed(3)}, flat ${x.flat.toFixed(3)}`,
      )
      .join(
        "; ",
      )}; off at 200 km: weight ${off.state.weight}, flat ${off.flat.toFixed(3)}`,
  );
  expect(errors).toEqual([]);
  for (const km of [700, 200, 50]) {
    expect(seen[km].state.weight).toBe(1);
    expect(seen[km].state.drawn).toBeGreaterThan(0);
    expect(seen[km].back.over).toBeGreaterThan(0.02);
    expect(seen[km].flat).toBe(0);
  }
  expect(off.state.weight).toBe(0);
  expect(off.flat).toBeGreaterThan(0);
});

test("the clouds by altitude at the owner's poses, before and after, for his eye", async ({
  page,
}) => {
  test.setTimeout(7_200_000);
  const dir = process.env.R4D_SHOTS_DIR ?? null;
  const modes = (process.env.R4D_SHOTS_MODES ?? "0,1").split(",");
  // Subsets for a quick look: R4D_SHOTS_KM="700,50", R4D_SHOTS_AT="ocean",
  // R4D_SHOTS_LOOK="oblique", R4D_SHOTS_EXTRA (hash keys for every pose).
  const kms = process.env.R4D_SHOTS_KM?.split(",").map(Number) ?? ALTITUDES;
  const places = Object.entries(PLACES).filter(
    ([name]) =>
      !process.env.R4D_SHOTS_AT ||
      process.env.R4D_SHOTS_AT.split(",").includes(name),
  );
  const looks = Object.entries(PITCHES).filter(
    ([name]) =>
      !process.env.R4D_SHOTS_LOOK ||
      process.env.R4D_SHOTS_LOOK.split(",").includes(name),
  );
  const extra = process.env.R4D_SHOTS_EXTRA
    ? `&${process.env.R4D_SHOTS_EXTRA}`
    : "";
  const tag = process.env.R4D_SHOTS_TAG ?? "";
  const first = `${BASE}${extra}&view=${places[0][1]},${kms[0]},0,-89&cloudShellVolume=${modes[0]}`;
  const errors = await bootGlobe(page, first, { phase: "user" });
  const log = [];
  for (const [place, at] of places) {
    for (const km of kms) {
      for (const [look, pitch] of looks) {
        for (const mode of modes) {
          await applyHash(
            page,
            `${BASE}${extra}&view=${at},${km},0,${pitch}&cloudShellVolume=${mode}`,
          );
          // The imagery and the relief settled, so before and after are
          // shot over the same ground (a slow load only delays a shot).
          await page
            .waitForFunction(
              () => {
                const s = window.__globeLab.state();
                return s.mapsLoaded === s.mapsTotal && s.pendingTiles === 0;
              },
              null,
              { timeout: 180_000 },
            )
            .catch(() => console.log(`${place} ${km} ${look}: still loading`));
          await page.evaluate(() => window.__globeLab.timeFrames(3));
          const s = await page.evaluate(shares);
          log.push({ place, km, look, mode, ...s });
          if (dir) {
            await page.screenshot({
              path: `${dir}/r4d-${place}-${km}km-${look}-${mode === "1" ? "after" : "before"}${tag}.png`,
            });
          }
        }
      }
    }
  }
  console.log(
    `owner shots ${dir ? `written to ${dir}` : "not written (no R4D_SHOTS_DIR)"}:\n${log
      .map(
        (x) =>
          `${x.place} ${x.km} km ${x.look} shell=${x.mode}: flat ${x.flat?.toFixed(3)} slab ${x.slab?.toFixed(3)} shell ${x.shell === null ? "-" : x.shell.toFixed(3)} weight ${x.weight === null ? "-" : x.weight.toFixed(3)} (observer ${x.observerKm.toFixed(1)} km)`,
      )
      .join("\n")}`,
  );
  expect(errors).toEqual([]);
});

/** Mean absolute difference of two equal-length arrays. */
const meanAbs = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
};

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

/** Pearson correlation (0 when either is flat). */
function correlation(a, b) {
  const ma = mean(a);
  const mb = mean(b);
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += (a[i] - ma) * (b[i] - mb);
    aa += (a[i] - ma) ** 2;
    bb += (b[i] - mb) ** 2;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

/** The mixed composite's alpha on the grid (a convex mix: never over 1). */
const mixOf = (x) =>
  (x.shell ?? x.slab).map(
    (_, i) =>
      (x.shell ? x.weight * x.shell[i] : 0) +
      (x.slab ? x.slabWeight * x.slab[i] : 0),
  );

const NX = 48;
const NY = 30;

// WHY: below the slab's ceiling the shell and the slab are MIXED by the
// slab's share. They meet without a seam only if they draw the same clouds
// there: the same field on the same chart, the same cover and column. Read
// pixel by pixel where both draw (the lower half of the frame, inside the
// slab's disc), at 35, 30 and 25 km: the shell's alpha against the slab's,
// their correlation and mean difference. A shell on another chart or basis
// correlates near 0 (a 6 km shift of the noise decorrelates it).
test("the shell and the slab draw the same clouds where they are mixed", async ({
  page,
}) => {
  test.setTimeout(1_800_000);
  const pose = (km) =>
    `${BASE}&view=${PLACES.ocean},${km},0,-60&cloudShellVolume=1`;
  const errors = await bootGlobe(page, pose(35), { phase: "user" });
  const rows = [];
  for (const km of [35, 30, 25]) {
    await applyHash(page, pose(km));
    await page.evaluate(() => window.__globeLab.timeFrames(2));
    const x = await page.evaluate(
      ({ nx, ny }) => window.__globeLab.cloudShellAlphaGrid(nx, ny),
      { nx: NX, ny: NY },
    );
    const near = (arr) => arr.slice(0, NX * (NY / 2));
    rows.push({
      km,
      weight: x.weight,
      slabWeight: x.slabWeight,
      r: correlation(near(x.shell), near(x.slab)),
      diff: meanAbs(near(x.shell), near(x.slab)),
      means: [mean(near(x.shell)), mean(near(x.slab))],
    });
  }
  console.log(
    `shell against slab where mixed (ocean, 60 degrees down, the lower half): ${rows
      .map(
        (x) =>
          `${x.km} km weights ${x.weight.toFixed(2)}/${x.slabWeight.toFixed(2)}: r ${x.r.toFixed(3)} (bound 0.5: ${[0.25, 0.5, 0.75].map((k) => `${k} ${x.r > k ? "ok" : "NO"}`).join(" ")}), mean |diff| ${x.diff.toFixed(3)}, mean alpha ${x.means.map((m) => m.toFixed(3)).join("/")}`,
      )
      .join("; ")}`,
  );
  expect(errors).toEqual([]);
  for (const x of rows) expect(x.r).toBeGreaterThan(0.5);
});

// WHY: the owner's "no jump between layers". The camera held straight down
// over the ocean through a geometric descent (4 % a step) from 1,200 to
// 12 km; at each pose the mixed clouds' alpha on a grid (the clouds only:
// loading imagery does not count). A switch between parameter sets, or a
// hand-over that pops, stands out as a step far above its neighbours;
// zooming alone changes every step about alike. Each step against the
// median of the 8 steps around it (swept x2 / x3 / x4).
test("the descent changes the clouds smoothly, no jump between layers", async ({
  page,
}) => {
  test.setTimeout(3_600_000);
  // The sweep's runs (R4D_DESCENT_FROM / _TO km, R4D_DESCENT_EXTRA hash
  // keys: the hand-over altitudes and bands), the full descent by default.
  const from = Number(process.env.R4D_DESCENT_FROM ?? 1_200);
  const to = Number(process.env.R4D_DESCENT_TO ?? 12);
  const extra = process.env.R4D_DESCENT_EXTRA
    ? `&${process.env.R4D_DESCENT_EXTRA}`
    : "";
  const altitudes = [];
  for (let h = from; h >= to; h /= 1.04) altitudes.push(h);
  const pose = (km) =>
    `${BASE}${extra}&view=${PLACES.ocean},${km.toFixed(3)},0,-89&cloudShellVolume=1`;
  const errors = await bootGlobe(page, pose(altitudes[0]), { phase: "user" });
  const steps = [];
  let previous = null;
  for (const km of altitudes) {
    await applyHash(page, pose(km));
    await page.evaluate(() => window.__globeLab.timeFrames(1));
    const x = await page.evaluate(
      ({ nx, ny }) => window.__globeLab.cloudShellAlphaGrid(nx, ny),
      { nx: NX, ny: NY },
    );
    const grid = x.shell || x.slab ? mixOf(x) : new Array(NX * NY).fill(0);
    if (previous) {
      steps.push({ km, step: meanAbs(grid, previous), alpha: mean(grid) });
    }
    previous = grid;
  }
  const local = steps.map((s, i) => {
    const around = steps
      .slice(Math.max(0, i - 4), i + 5)
      .filter((_, k) => k !== Math.min(i, 4))
      .map((x) => x.step)
      .sort((a, b) => a - b);
    const median = around[Math.floor(around.length / 2)];
    return { ...s, ratio: s.step / Math.max(median, 1e-4) };
  });
  const worst = local.reduce((w, x) => (x.ratio > w.ratio ? x : w));
  console.log(
    `descent over the ocean${extra}, straight down, 4 % a step: ${local
      .map(
        (x) => `${x.km.toFixed(0)}:${x.step.toFixed(3)}/${x.alpha.toFixed(2)}`,
      )
      .join(
        " ",
      )}; the worst step ${worst.step.toFixed(3)} at ${worst.km.toFixed(1)} km is x${worst.ratio.toFixed(2)} its neighbours' median (${[2, 3, 4].map((k) => `x${k} ${worst.ratio <= k ? "ok" : "NO"}`).join(" ")})`,
  );
  expect(errors).toEqual([]);
  expect(worst.ratio).toBeLessThanOrEqual(3);
});

// WHY: the cost, against the 50 ms frame rule (the owner's phone: no frame
// over 50 ms). SwiftShader renders on the CPU, so only ratios within one
// page load mean anything: the frame with the shell on against off at 700,
// 200 and 50 km, and the shell's own pass at full and half resolution. The
// GPU timer (EXT_disjoint_timer_query_webgl2) is used where the device has
// it (headless Chromium does not: stated in the log).
test("its cost, as ratios within one page load", async ({ page }) => {
  test.setTimeout(3_600_000);
  const pose = (km, on, res = 1) =>
    `${BASE}&view=${PLACES.ocean},${km},0,-45&cloudShellVolume=${on}&cloudShellRes=${res}`;
  const errors = await bootGlobe(page, pose(700, 1), { phase: "user" });
  const timer = await page.evaluate(
    () =>
      document
        .createElement("canvas")
        .getContext("webgl2")
        ?.getExtension("EXT_disjoint_timer_query_webgl2") !== null,
  );
  const rows = [];
  for (const km of [700, 200, 50]) {
    const frames = { on: [], off: [] };
    for (const on of [0, 1, 0, 1]) {
      await applyHash(page, pose(km, on));
      await page.evaluate(() => window.__globeLab.timeFrames(2));
      frames[on ? "on" : "off"].push(
        await page.evaluate(() => window.__globeLab.timeFrames(6) / 6),
      );
    }
    const pass = {};
    for (const res of [1, 0.5, 1, 0.5]) {
      await applyHash(page, pose(km, 1, res));
      await page.evaluate(() => window.__globeLab.timeFrames(1));
      (pass[res] ??= []).push(
        await page.evaluate(() => window.__globeLab.timeCloudShell(6) / 6),
      );
    }
    rows.push({ km, frames, pass });
  }
  console.log(
    `cost (SwiftShader, relative; GPU timer ${timer ? "available" : "not available"}): ${rows
      .map(
        (x) =>
          `${x.km} km: frame on/off x${(mean(x.frames.on) / mean(x.frames.off)).toFixed(2)} (${mean(x.frames.on).toFixed(0)}/${mean(x.frames.off).toFixed(0)} ms), the pass alone ${mean(x.pass[1]).toFixed(0)} ms at full, ${mean(x.pass[0.5]).toFixed(0)} at half (x${(mean(x.pass[0.5]) / mean(x.pass[1])).toFixed(2)}), the pass a share ${(mean(x.pass[1]) / mean(x.frames.on)).toFixed(2)} of the frame`,
      )
      .join("; ")}`,
  );
  expect(errors).toEqual([]);
  for (const x of rows) expect(mean(x.pass[1])).toBeGreaterThan(0);
});

/**
 * The cloud map's mean over a box around a place (degrees), from the
 * registry's own file on disk (the map the globe loads first), read with
 * sharp: the CPU's view of what the shell's cover reads.
 */
async function mapMean(lat, lng, halfLat, halfLng) {
  const file = join(
    here,
    "../../../GpsPlusSlamJs_Globe/assets",
    globeSource("clouds").path.replace("/globe-assets/", ""),
  );
  const { data, info } = await sharp(file)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  let n = 0;
  for (let y = lat - halfLat; y <= lat + halfLat; y += halfLat / 10) {
    for (let x = lng - halfLng; x <= lng + halfLng; x += halfLng / 10) {
      const u = (((x / 360 + 0.5) % 1) + 1) % 1;
      const v = 0.5 - y / 180;
      const px = Math.min(info.width - 1, Math.floor(u * info.width));
      const py = Math.min(info.height - 1, Math.floor(v * info.height));
      sum += data[py * info.width + px] / 255;
      n += 1;
    }
  }
  return sum / n;
}

// WHY: "coarse volumetric clouds that follow the cloud map". The shell's
// cover is the map at each point's true latitude and longitude: looking
// straight down from 700 km at places from a clear desert to a cloudy
// southern ocean, the share of the frame the shell covers must follow the
// map's mean over the view (a correlation across places), and the clear
// place must draw clearly less than the cloudy ones. A shell reading the
// map at a wrong latitude or longitude, or not at all, correlates near 0.
test("the coverage follows the cloud map", async ({ page }) => {
  test.setTimeout(1_800_000);
  const places = [
    [23, 10],
    [47.0502, 8.3093],
    [35, -135],
    [50, -35],
    [-45, -35],
    [-50, -150],
  ];
  const pose = ([lat, lng]) =>
    `${BASE}&view=${lat},${lng},700,0,-89&cloudShellVolume=1`;
  const errors = await bootGlobe(page, pose(places[0]), { phase: "user" });
  const rows = [];
  for (const place of places) {
    console.log(
      `coverage: ${place.join(",")} (${new Date().toISOString().slice(11, 19)})`,
    );
    await applyHash(page, pose(place));
    await page.evaluate(() => window.__globeLab.timeFrames(2));
    const x = await page.evaluate(
      ({ nx, ny }) => window.__globeLab.cloudShellAlphaGrid(nx, ny),
      { nx: NX, ny: NY },
    );
    // The view straight down from 700 km: about 3 degrees of latitude
    // either side, and 1.6 times that across (the frame's aspect).
    const half = 3;
    console.log(
      `coverage: ${place.join(",")} drawn (${new Date().toISOString().slice(11, 19)})`,
    );
    rows.push({
      place,
      map: await mapMean(
        place[0],
        place[1],
        half,
        (1.6 * half) / Math.cos((place[0] * Math.PI) / 180),
      ),
      covered: mean(x.shell.map((a) => (a > 0.5 ? 1 : 0))),
      alpha: mean(x.shell),
    });
  }
  const r = correlation(
    rows.map((x) => x.map),
    rows.map((x) => x.alpha),
  );
  console.log(
    `coverage against the map, straight down from 700 km: ${rows
      .map(
        (x) =>
          `${x.place.join(",")} map ${x.map.toFixed(2)} shell alpha ${x.alpha.toFixed(3)} covered ${x.covered.toFixed(3)}`,
      )
      .join(
        "; ",
      )}; correlation ${r.toFixed(3)} (bound 0.8: ${[0.6, 0.8, 0.9].map((k) => `${k} ${r > k ? "ok" : "NO"}`).join(" ")})`,
  );
  expect(errors).toEqual([]);
  expect(r).toBeGreaterThan(0.8);
  const clearest = rows.reduce((a, b) => (b.map < a.map ? b : a));
  const cloudiest = rows.reduce((a, b) => (b.map > a.map ? b : a));
  expect(clearest.alpha).toBeLessThan(0.5 * cloudiest.alpha);
});
