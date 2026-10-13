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
  // The shell reads the live field only (R4d review): with the tile noise
  // the old layers draw, the switch on or not.
  await applyHash(
    page,
    `${pose(200, 1)}`.replace("cloudNoise=live", "cloudNoise=tile"),
  );
  await page.evaluate(() => window.__globeLab.timeFrames(2));
  const tile = await page.evaluate(() => ({
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
  expect(tile.state.weight).toBe(0);
  expect(tile.flat).toBeGreaterThan(0);
});

test("the clouds by altitude at the owner's poses, before and after, for his eye", async ({
  page,
}) => {
  // Opt-in, as the sweep (R4d review): up to 2 h of pictures for the
  // owner's eye, nothing a gate should wait for.
  test.skip(
    !process.env.R4D_SHOTS_DIR,
    "R4D_SHOTS_DIR=<folder> takes the owner's pictures",
  );
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
// The composite's mix, cell by cell (cloudShellPixelWeight's rule): the
// shell at its fade-in less the slab's share of the cloud the slab draws
// there, plus the slab at its share.
const mixOf = (x) =>
  (x.shell ?? x.slab).map((_, i) => {
    const shell = x.shell ? x.shell[i] : 0;
    const slab = x.slab ? x.slab[i] : 0;
    const r = shell > 1e-4 ? Math.min(1, slab / shell) : 1;
    return x.weight * (1 - x.slabWeight * r) * shell + x.slabWeight * slab;
  });

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
    // The shell's grid is its own drawing (the composite weighs it).
    const shell = near(x.shell);
    rows.push({
      km,
      weight: x.weight,
      slabWeight: x.slabWeight,
      r: correlation(shell, near(x.slab)),
      diff: meanAbs(shell, near(x.slab)),
      means: [mean(shell), mean(near(x.slab))],
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
  for (const x of rows) {
    expect(x.r).toBeGreaterThan(0.5);
    // The correlation is blind to amplitude: the record's aerial defect
    // read r 0.999 with alpha 0.479 against 0.287 (R4d review, finding 4).
    // The mean |difference| measured 0.001-0.008 and the means equal.
    expect(x.diff).toBeLessThan(0.05);
    const [shell, slab] = x.means;
    expect(shell / Math.max(slab, 1e-4)).toBeGreaterThan(0.8);
    expect(shell / Math.max(slab, 1e-4)).toBeLessThan(1.25);
  }
});

// WHY (R4d milestone review, finding 1, 2026-10-12): the shell and the
// slab were mixed by one weight for the whole screen, but the slab exists
// only within its disc (80 km), so at the owner's oblique pose (pitch
// -19.5, fovY 50; the deck seen ~600 km out from 25 km up) every cloud
// beyond the disc was drawn at 1 - the slab's share: 0.35 at 25 km, gone
// at 15 km. The straight-down and steep smokes above never saw it. The
// same pose with the slab mixed in (its ceiling at 40 km, the default) and
// with its ceiling moved below the camera (10 km: the shell alone; the
// shell needs the cloud volume on, so `cloudVolume=0` would turn it off
// too): the clouds beyond the slab's disc (the cells the slab does not
// draw) must keep their strength. Bound 0.95 (swept 0.9 / 0.95 / 0.98). At
// 25 and 18 km both cases use the same station (the slab's set), so only
// the mix differs. Measured 2026-10-12 over the whole far half: the old
// global mix x0.90 (the disc is placed ahead where the view meets the deck,
// so only the band beyond it lost its clouds, not the review's estimated
// 0.35); since round 5 the far half also holds the disc's haze, so only the
// cells beyond the disc are compared.
test("far clouds keep their strength below the slab's ceiling at the owner's oblique pose", async ({
  page,
}) => {
  test.setTimeout(1_800_000);
  const pose = (km, slab) =>
    `${BASE}&view=${PLACES.ocean},${km},0,-19.5&fovY=50&cloudShellVolume=1&cloudVolumeCeilingKm=${slab ? 40 : 10}`;
  const errors = await bootGlobe(page, pose(25, 1), { phase: "user" });
  const rows = [];
  for (const km of [25, 18]) {
    const read = async (slab) => {
      await applyHash(page, pose(km, slab));
      await page.evaluate(() => window.__globeLab.timeFrames(2));
      const x = await page.evaluate(
        ({ nx, ny }) => window.__globeLab.cloudShellAlphaGrid(nx, ny),
        { nx: NX, ny: NY },
      );
      return {
        mix: x.shell || x.slab ? mixOf(x) : new Array(NX * NY).fill(0),
        slab: x.slab ?? new Array(NX * NY).fill(0),
      };
    };
    const on = await read(1);
    // Beyond the slab's disc, by geometry: the grid's rows whose ray meets
    // the deck farther than the disc's far edge from the camera (the
    // centre's distance ahead plus its radius, plus 10 km), or never meets
    // the flat deck (toward the horizon). Inside the disc the slab's haze
    // applies on purpose (round 5, C3) and the shell alone has none, so only
    // beyond it does on against off measure lost clouds (the R4d review's
    // finding 1). The slab's own alpha would not do: it is clear in clear
    // patches inside the disc too.
    const geometry = await page.evaluate((ny) => {
      const lab = window.__globeLab;
      const cv = lab.state().cloudVolume;
      return {
        rows: lab.cloudVolumeRows(ny).map((r) => r.distanceKm),
        edgeKm: (cv.aheadM + cv.radiusM) / 1000,
      };
    }, NY);
    const off = await read(0);
    const beyondRow = geometry.rows.map(
      (d) => d === null || d >= geometry.edgeKm + 10,
    );
    const beyond = on.slab.map((_, i) => beyondRow[Math.floor(i / NX)]);
    const pick = (a) => a.filter((_, i) => beyond[i]);
    rows.push({
      km,
      cells: pick(on.mix).length,
      far: mean(pick(on.mix)) / Math.max(mean(pick(off.mix)), 1e-4),
      farOff: mean(pick(off.mix)),
    });
  }
  console.log(
    `far clouds beyond the slab's disc with the slab on against off (ocean, pitch -19.5, fovY 50): ${rows
      .map(
        (x) =>
          `${x.km} km x${x.far.toFixed(2)} over ${x.cells} cells (off ${x.farOff.toFixed(3)}; ${[0.9, 0.95, 0.98].map((k) => `${k} ${x.far >= k ? "ok" : "NO"}`).join(" ")})`,
      )
      .join("; ")}`,
  );
  expect(errors).toEqual([]);
  for (const x of rows) {
    // Cells and clouds to judge (a clear sky proves nothing).
    expect(x.cells).toBeGreaterThan(20);
    expect(x.farOff).toBeGreaterThan(0.02);
    expect(x.far).toBeGreaterThanOrEqual(0.95);
  }
});

// WHY (round-5 plan 2026-10-12-0612 C2, C3; the owner on r822): on the
// way down "between 300 and 150 km nothing moves" (the station law's
// smoothstep had no slope at 200 km), and "from about 100 km they turn
// transparent" (the aerial fade, alpha x exp(-distance / 60 km), from 200
// km down). Straight down over the ocean from 300 to 45 km in 4 % steps:
// the smallest per-step change against the median (a static stretch is a
// dead zone) and the lowest mean alpha against the alpha at the top (the
// transparency). Both logged with the bound's sweep; the bounds sit between
// the old code's and the new code's values (measured 2026-10-12).
test("the clouds keep morphing and keep their strength from 300 down to 45 km", async ({
  page,
}) => {
  test.setTimeout(3_600_000);
  const errors = await bootGlobe(
    page,
    `${BASE}&view=${PLACES.ocean},300,0,-89&cloudShellVolume=1`,
    { phase: "user" },
  );
  const { local, line } = await descend(page, { from: 300, to: 45, extra: "" });
  const medianOf = (xs) =>
    [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const median = medianOf(local.map((x) => x.step));
  const deadest =
    Math.min(...local.map((x) => x.step)) / Math.max(median, 1e-4);
  const top = local[0].alpha;
  const weakest = Math.min(...local.map((x) => x.alpha)) / Math.max(top, 1e-4);
  console.log(
    `${line}; round 5: the smallest step x${deadest.toFixed(2)} of the median (${[0.5, 0.6, 0.65].map((k) => `${k} ${deadest >= k ? "ok" : "NO"}`).join(" ")}), the weakest mean alpha x${weakest.toFixed(2)} of the top's (${[0.7, 0.85, 0.95].map((k) => `${k} ${weakest >= k ? "ok" : "NO"}`).join(" ")})`,
  );
  expect(errors).toEqual([]);
  // Measured 2026-10-12, old code against new: the smallest step x0.46
  // against x0.70, the weakest alpha x0.51 against x0.99; the bounds between.
  expect(deadest).toBeGreaterThanOrEqual(0.6);
  expect(weakest).toBeGreaterThanOrEqual(0.85);
});

// WHY (round-5 plan §11, DEC-R5-6, the owner's A): the high layer is drawn
// from above (at 150 km, in front of the clouds) and from below (at 2 km
// looking just above the horizon, behind them, the deck seen from below),
// at full strength near the ground where the shell itself hands to the
// slab; and a ray that meets the ground first ends there (it was drawn
// through the Earth below the horizon). The order flips at its height.
test("the high layer draws from above and below, in front and behind", async ({
  page,
}) => {
  test.setTimeout(900_000);
  const errors = await bootGlobe(
    page,
    `${BASE}&view=${PLACES.ocean},150,0,-20&cloudShellVolume=1&cloudHigh=1`,
    { phase: "user" },
  );
  const read = async () => {
    await page.evaluate(() => window.__globeLab.timeFrames(2));
    return page.evaluate(
      ({ nx, ny }) => ({
        grid: window.__globeLab.cloudShellAlphaGrid(nx, ny),
        high: window.__globeLab.state().cloudShellVolume.high,
      }),
      { nx: NX, ny: NY },
    );
  };
  const above = await read();
  await applyHash(
    page,
    `${BASE}&view=${PLACES.ocean},2,0,8&cloudShellVolume=1&cloudHigh=1`,
  );
  const below = await read();
  // The bottom quarter of the frame looks below the horizon (pitch 8, fovY 50).
  const rows = Math.floor(NY / 4);
  const underHorizon = below.grid.high.slice(0, rows * NX);
  console.log(
    `high layer: from 150 km mean alpha ${mean(above.grid.high).toFixed(3)} in front ${above.high.inFront}; from 2 km ${mean(below.grid.high).toFixed(3)} in front ${below.high.inFront}, below the horizon ${mean(underHorizon).toFixed(4)}`,
  );
  expect(errors).toEqual([]);
  expect(mean(above.grid.high)).toBeGreaterThan(0.05);
  expect(above.high.inFront).toBe(true);
  expect(mean(below.grid.high)).toBeGreaterThan(0.05);
  expect(below.high.inFront).toBe(false);
  expect(mean(underHorizon)).toBeLessThan(0.01);
});

// WHY (round-5 plan 2026-10-12-0612 C4; the owner on r822: "at about 30 km
// the same clouds twice, slightly offset, both half transparent"): the slab
// is flat in its frame, the shell curved, so inside the slab's disc they
// drew the same clouds at points up to about 1.3 km apart. At the owner's
// oblique pose (pitch -19.5, fovY 50), the shell's own drawing (not weighted
// by the disc) against the slab's, over every pixel the slab draws, with the
// shell's deck flat there (cloudShellFlat=1) and on the sphere (0): the
// same code, one variable.
test("the shell and the slab draw the same clouds across the disc at the owner's oblique pose", async ({
  page,
}) => {
  test.setTimeout(1_800_000);
  const pose = (km, flat) =>
    `${BASE}&view=${PLACES.ocean},${km},0,-19.5&fovY=50&cloudShellVolume=1&cloudShellFlat=${flat}`;
  const errors = await bootGlobe(page, pose(30, 1), { phase: "user" });
  const rows = [];
  for (const km of [30, 25]) {
    for (const flat of [1, 0]) {
      await applyHash(page, pose(km, flat));
      await page.evaluate(() => window.__globeLab.timeFrames(2));
      const x = await page.evaluate(
        ({ nx, ny }) => window.__globeLab.cloudShellSeamGrid(nx, ny),
        { nx: NX, ny: NY },
      );
      const keep = x.slab.map((v) => v > 0.02);
      const shell = x.shell.filter((_, i) => keep[i]);
      const slab = x.slab.filter((_, i) => keep[i]);
      rows.push({
        km,
        flat,
        n: shell.length,
        r: correlation(shell, slab),
        diff: meanAbs(shell, slab),
      });
    }
  }
  console.log(
    `the shell's own drawing against the slab's where it draws (ocean, pitch -19.5, fovY 50): ${rows
      .map(
        (x) =>
          `${x.km} km flat ${x.flat}: r ${x.r.toFixed(3)} (${[0.8, 0.85, 0.9].map((k) => `${k} ${x.r >= k ? "ok" : "NO"}`).join(" ")}), mean |diff| ${x.diff.toFixed(3)} over ${x.n} cells`,
      )
      .join("; ")}`,
  );
  expect(errors).toEqual([]);
  // Measured 2026-10-12: the flat deck r 0.905 / 0.945 at 30 / 25 km, the
  // sphere's (the control) 0.580 / 0.714; the bound between, and the flat
  // deck must beat the control at each altitude.
  for (const km of [30, 25]) {
    const flat = rows.find((x) => x.km === km && x.flat === 1);
    const sphere = rows.find((x) => x.km === km && x.flat === 0);
    expect(flat.n).toBeGreaterThan(100);
    expect(flat.r).toBeGreaterThanOrEqual(0.85);
    expect(flat.r).toBeGreaterThan(sphere.r + 0.1);
  }
});

// WHY: the owner's "no jump between layers". The camera held straight down
// over the ocean through a geometric descent (4 % a step) from 1,200 to
// 12 km; at each pose the mixed clouds' alpha on a grid (the clouds only:
// loading imagery does not count). A switch between parameter sets, or a
// hand-over that pops, stands out as a step far above its neighbours;
// zooming alone changes every step about alike. Each step against the
// median of the 8 steps around it (swept x2 / x3 / x4).
/**
 * One descent straight down over the ocean from `from` to `to` km in 4 %
 * steps, the hash's `extra` keys applied (a page already booted): each
 * step's mean change of the mixed clouds' alpha against the median of its
 * 8 neighbours. Returns the steps, the worst and the log line.
 */
async function descend(page, { from, to, extra }) {
  const altitudes = [];
  for (let h = from; h >= to; h /= 1.04) altitudes.push(h);
  const pose = (km) =>
    `${BASE}${extra}&view=${PLACES.ocean},${km.toFixed(3)},0,-89&cloudShellVolume=1`;
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
  const line = `descent over the ocean${extra}, straight down, 4 % a step: ${local
    .map((x) => `${x.km.toFixed(0)}:${x.step.toFixed(3)}/${x.alpha.toFixed(2)}`)
    .join(
      " ",
    )}; the worst step ${worst.step.toFixed(3)} at ${worst.km.toFixed(1)} km is x${worst.ratio.toFixed(2)} its neighbours' median (${[2, 3, 4].map((k) => `x${k} ${worst.ratio <= k ? "ok" : "NO"}`).join(" ")})`;
  return { local, worst, line };
}

// WHY (R4d review, finding 4; filed in 2026-10-12-0500-globe-r4d-shell-open-
// findings-followup.md): the law's step count is continuous but the march
// took it rounded, so where it turned over (6 to 7 between 200 and 30 km)
// every jittered node moved at once. Straight down the path is short and
// hides it; looking ahead it is long. Across the turnover, in 0.1 % steps
// of altitude, the change between two frames must look like its
// neighbours'. Measured 2026-10-13 at 118 km (6 to 7): x1.01 at 1 % steps
// and x1.07 at 0.1 %, so no pop shows (the segments are integrated
// analytically, so where the nodes sit barely matters); kept as a guard,
// and the finding closed without a change.
test("no pop where the march's step count turns over, looking ahead", async ({
  page,
}) => {
  test.setTimeout(900_000);
  const pose = (km) =>
    `${BASE}&view=${PLACES.ocean},${km.toFixed(3)},0,-15&cloudShellVolume=1`;
  const errors = await bootGlobe(page, pose(200), { phase: "user" });
  const stepsAt = async (km) => {
    await applyHash(page, pose(km));
    await page.evaluate(() => window.__globeLab.timeFrames(1));
    return page.evaluate(
      () => window.__globeLab.state().cloudShellVolume.law.steps,
    );
  };
  // The altitude where the rounded count turns over (bisected).
  let hi = 200;
  let lo = 30;
  const turn = Math.round(await stepsAt(hi)) + 0.5;
  for (let i = 0; i < 12; i++) {
    const mid = Math.sqrt(hi * lo);
    if ((await stepsAt(mid)) < turn) hi = mid;
    else lo = mid;
  }
  const crossKm = Math.sqrt(hi * lo);
  const frames = [];
  for (let k = 5; k >= -5; k--) {
    const km = crossKm * 1.001 ** (k + 0.5);
    await applyHash(page, pose(km));
    await page.evaluate(() => window.__globeLab.timeFrames(1));
    const x = await page.evaluate(
      ({ nx, ny }) => window.__globeLab.cloudShellAlphaGrid(nx, ny),
      { nx: NX, ny: NY },
    );
    frames.push({ km, alpha: mixOf(x) });
  }
  const changes = [];
  for (let i = 1; i < frames.length; i++) {
    changes.push(meanAbs(frames[i].alpha, frames[i - 1].alpha));
  }
  // The middle change crosses the turnover (frames 5 and 6 straddle it).
  const across = changes[5];
  const others = changes.filter((_, i) => i !== 5).sort((a, b) => a - b);
  const median = others[Math.floor(others.length / 2)];
  const ratio = across / Math.max(median, 1e-4);
  console.log(
    `step count turns over at ${crossKm.toFixed(1)} km (${turn - 0.5} to ${turn + 0.5}); the change across it ${across.toFixed(4)} against the neighbours' median ${median.toFixed(4)}: x${ratio.toFixed(2)} (${[1.5, 2, 3].map((k) => `x${k} ${ratio <= k ? "ok" : "NO"}`).join(" ")}); all ${changes.map((c) => c.toFixed(4)).join(" ")}`,
  );
  expect(errors).toEqual([]);
  expect(ratio).toBeLessThanOrEqual(2);
});

test("the descent changes the clouds smoothly, no jump between layers", async ({
  page,
}) => {
  test.setTimeout(3_600_000);
  // One run's own range and hash keys (R4D_DESCENT_FROM / _TO km,
  // R4D_DESCENT_EXTRA), the full descent by default.
  const from = Number(process.env.R4D_DESCENT_FROM ?? 1_200);
  const to = Number(process.env.R4D_DESCENT_TO ?? 12);
  const extra = process.env.R4D_DESCENT_EXTRA
    ? `&${process.env.R4D_DESCENT_EXTRA}`
    : "";
  const errors = await bootGlobe(
    page,
    `${BASE}${extra}&view=${PLACES.ocean},${from},0,-89&cloudShellVolume=1`,
    { phase: "user" },
  );
  const { worst, line } = await descend(page, { from, to, extra });
  console.log(line);
  expect(errors).toEqual([]);
  expect(worst.ratio).toBeLessThanOrEqual(3);
});

// WHY: the owner's rule (2026-09-13): a verdict from one parameter value is
// provisional. The same descent measure over each hand-over's band with the
// hand-over moved by a third either way and the bands widened and narrowed:
// the shell's top (467 / 933 km, its middle station at 2/7 of it), its
// fade-in band (100 / 600 km), its middle station (133 / 267 km), and the
// slab's ceiling (27 / 53 km) and fade (12 / 37 km). One page load for all
// (the hash applies live); run only when R4D_SWEEP=1 (about 40 minutes on
// SwiftShader).
test("the hand-overs swept, no jump at any of them", async ({ page }) => {
  test.skip(process.env.R4D_SWEEP !== "1", "R4D_SWEEP=1 runs the sweep");
  test.setTimeout(7_200_000);
  const runs = [
    [997, 311, "cloudShellTopKm=467&cloudShellMidKm=133"],
    [1599, 622, "cloudShellTopKm=933&cloudShellMidKm=266"],
    [1040, 467, "cloudShellBandKm=100"],
    [1690, 467, "cloudShellBandKm=600"],
    [500, 60, "cloudShellMidKm=133"],
    [500, 60, "cloudShellMidKm=267"],
    [90, 8, "cloudVolumeCeilingKm=27&cloudVolumeFadeKm=25"],
    [90, 8, "cloudVolumeCeilingKm=53&cloudVolumeFadeKm=25"],
    [90, 8, "cloudVolumeCeilingKm=40&cloudVolumeFadeKm=12"],
    [90, 8, "cloudVolumeCeilingKm=40&cloudVolumeFadeKm=37"],
  ].map(([from, to, keys]) => ({ from, to, extra: `&${keys}` }));
  const errors = await bootGlobe(
    page,
    `${BASE}&view=${PLACES.ocean},1000,0,-89&cloudShellVolume=1`,
    { phase: "user" },
  );
  const worsts = [];
  for (const run of runs) {
    const { worst, line } = await descend(page, run);
    console.log(line);
    worsts.push(worst.ratio);
  }
  expect(errors).toEqual([]);
  for (const ratio of worsts) expect(ratio).toBeLessThanOrEqual(3);
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
