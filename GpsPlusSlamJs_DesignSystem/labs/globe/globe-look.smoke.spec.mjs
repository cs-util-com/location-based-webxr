// @ts-check
/**
 * The reference image's looks (round-4 plan 2026-09-28-2105 DEC-GL4-8):
 * a blue grade, shaded clouds, a soft blue-grey night with warm lights,
 * navy space and a glow round bright stars, each behind its own switch.
 *
 * Why this file matters: each look is judged by eye against its own
 * OFF, so each must (a) do nothing at 0, the default (the look before, as
 * every other smoke measures it), and (b) move the pixels it is about, in
 * the direction the reference shows, when on. The floors are loose (the
 * strength is tuned by eye) and each is reported at x0.5, x1 and x2 (the
 * parameter-sweep rule of 2026-09-13). The atmosphere pass is off in every view
 * (`atmo=0`): it would add its own blue and cost frames, and none of
 * these looks is about it.
 */
import { expect, test } from "@playwright/test";

import {
  applyHash,
  bootGlobe,
  gridAround,
  luminance,
  meanOf,
} from "./globe-smoke-helpers.mjs";

/** The equinox noon over the subsolar point: the day side fills the view. */
const DAY =
  "at=0,1.86&spinMs=0&turnMs=0&time=2026-03-20T12:00:00Z&cloudDrift=0&stars=0&milkyWay=0&atmo=0";
/** Europe at 21:00 UTC: the night side with city lights. */
const NIGHT =
  "at=48,10&spinMs=0&turnMs=0&time=2026-03-20T21:00:00Z&cloudDrift=0&stars=0&milkyWay=0&atmo=0";
/**
 * The sun behind the Earth: space dark around the disc, the stars at the
 * DEFAULT limit and gain (round-5 plan DEC-GL5-4: the glow must show at
 * them), the sun's glow and navy space off (they would light the frame
 * around the disc).
 */
const STARS =
  "at=0,-178.14&spinMs=0&turnMs=0&time=2026-03-20T12:00:00Z&cloudDrift=0&milkyWay=0&atmo=0&sunGlow=0&space=0";

const SWEEP = [0.5, 1, 2];
/** "value vs floor: x0.5 ok x1 ok x2 NO" for a value that must exceed it. */
const verdict = (value, floor) =>
  `${value.toFixed(2)} (floor ${floor}: ${SWEEP.map((k) => `x${k} ${value > floor * k ? "ok" : "NO"}`).join(" ")})`;

const read = (page, points) =>
  page.evaluate((p) => window.__globeLab.readPixels(p), points);
const mean = (px, k) => meanOf(px.map((p) => p[k]));

/** Waits until the tiles for the current view have loaded. */
const loaded = (page) =>
  page.waitForFunction(
    () => window.__globeLab.state().pendingTiles === 0,
    null,
    {
      timeout: 90_000,
    },
  );

test("every look but navy space is off by default; the grade and the cloud shading move their pixels", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = await bootGlobe(page, DAY);
  await loaded(page);
  expect(await page.evaluate(() => window.__globeLab.state().look)).toEqual({
    grade: 0,
    cloudRelief: 0,
    twilight: 0,
    // 0.1 by default since round 5 (plan 2026-10-01-0945 DEC-GL5-4).
    space: 0.1,
    starGlow: 0,
  });
  const grid = gridAround([0.5, 0.5], 0.2, 9);
  const off = await read(page, grid);
  // 1. The blue grade: the day side bluer against red.
  await applyHash(page, `${DAY}&grade=1`);
  const graded = await read(page, grid);
  const blueShift =
    mean(graded, 2) - mean(graded, 0) - (mean(off, 2) - mean(off, 0));
  // 2. The cloud shading: the clouds' pixels change, cloud-free ones stay.
  await applyHash(page, `${DAY}&cloudRelief=1`);
  const shaded = await read(page, grid);
  const withClouds = meanOf(
    shaded.map((p, i) => Math.abs(luminance(p) - luminance(off[i]))),
  );
  await applyHash(page, `${DAY}&cloudOpacity=0`);
  const bare = await read(page, grid);
  await applyHash(page, `${DAY}&cloudOpacity=0&cloudRelief=1`);
  const bareShaded = await read(page, grid);
  const withoutClouds = meanOf(
    bareShaded.map((p, i) => Math.abs(luminance(p) - luminance(bare[i]))),
  );
  console.log(
    `looks: grade blue minus red +${verdict(blueShift, 5)}; cloud shading mean |change| ${verdict(withClouds, 1)} with clouds, ${withoutClouds.toFixed(2)} without`,
  );
  expect(blueShift).toBeGreaterThan(5);
  expect(withClouds).toBeGreaterThan(1);
  expect(withoutClouds).toBeLessThan(0.5);
  expect(errors).toEqual([]);
});

test("the twilight lifts the dark ground and warms the lights", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = await bootGlobe(page, NIGHT);
  await loaded(page);
  const grid = gridAround([0.5, 0.5], 0.15, 9);
  const off = await read(page, grid);
  await applyHash(page, `${NIGHT}&twilight=1`);
  const on = await read(page, grid);
  const dark = off
    .map((p, i) => [luminance(p), i])
    .filter(([l]) => l < 20)
    .map(([, i]) => i);
  const lift = meanOf(dark.map((i) => luminance(on[i]) - luminance(off[i])));
  const bright = off.reduce(
    (best, p, i) => (luminance(p) > luminance(off[best]) ? i : best),
    0,
  );
  const warmOff = off[bright][0] - off[bright][2];
  const warmOn = on[bright][0] - on[bright][2];
  console.log(
    `looks: twilight dark ground +${verdict(lift, 0.5)} over ${dark.length} probes; brightest light red minus blue ${warmOff} -> ${warmOn}`,
  );
  expect(dark.length).toBeGreaterThan(10);
  expect(lift).toBeGreaterThan(0.5);
  expect(warmOn).toBeGreaterThan(warmOff);
  expect(errors).toEqual([]);
});

test("navy space: a corner of the frame is black off and navy on", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = await bootGlobe(page, `${DAY}&space=0`);
  await loaded(page);
  const [cornerOff] = await read(page, [[0.03, 0.05]]);
  await applyHash(page, DAY);
  const [cornerDefault] = await read(page, [[0.03, 0.05]]);
  await applyHash(page, `${DAY}&space=1`);
  const [cornerOn] = await read(page, [[0.03, 0.05]]);
  console.log(
    `looks: space corner ${cornerOff.slice(0, 3)} -> ${cornerOn.slice(0, 3)} (the default 0.1: ${cornerDefault.slice(0, 3)}); blue ${verdict(cornerOn[2], 15)}`,
  );
  expect(cornerOff.slice(0, 3)).toEqual([0, 0, 0]);
  // The default is navy too, darker than at 1 (DEC-GL5-4).
  expect(cornerDefault[2]).toBeGreaterThan(cornerOff[2]);
  expect(cornerDefault[2]).toBeLessThan(cornerOn[2]);
  expect(cornerOn[2]).toBeGreaterThan(cornerOn[0]);
  expect(cornerOn[2]).toBeGreaterThan(15);
  expect(errors).toEqual([]);
});

// WHY (round-5 plan DEC-GL5-4): the glow scaled with intensity squared, so
// at the default limit (8.5) it widened a few dozen stars and moved the
// frame's light 1 %: invisible. It now scales with intensity. Shown at the
// DEFAULT parameters, in space only, against the glow off; the limit is
// swept over 6-9 (logged), and the floor is half the smallest gain of
// that sweep's own measurement (see GLOW_GAIN_FLOOR).
test("the star glow shows at the default star limit", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await bootGlobe(page, STARS);
  await loaded(page);
  // Space only: everything outside the Earth's disc (plus 4 px), whose
  // night side and city lights would otherwise swamp the stars' light.
  const space = await page.evaluate(() => {
    const st = window.__globeLab.state();
    const c = /** @type {HTMLCanvasElement} */ (
      document.getElementById("globe-canvas")
    );
    const rPx =
      ((c.height / 2) * Math.tan(Math.asin(st.radiusM / st.distance))) /
      Math.tan((st.fovY * Math.PI) / 360);
    return { cx: 0.5, cy: 0.5, rPx: rPx + 4 };
  });
  const stats = (hash) =>
    applyHash(page, hash).then(() =>
      page.evaluate(({ c }) => window.__globeLab.regionStats(c, 10), {
        c: space,
      }),
    );
  const gains = async (extra) => {
    const off = await stats(`${STARS}${extra}`);
    const on = await stats(`${STARS}${extra}&starGlow=1`);
    return {
      light: on.outsideSum / Math.max(1, off.outsideSum) - 1,
      spread: on.outsideBright / Math.max(1, off.outsideBright) - 1,
      off,
    };
  };
  const sweep = [];
  for (const mag of [6, 7, 8, 9]) {
    sweep.push({ mag, ...(await gains(`&starMag=${mag}`)) });
  }
  const atDefault = await gains("");
  console.log(
    `looks: star glow gain over off, space only: ` +
      sweep
        .map(
          (r) =>
            `mag ${r.mag} light +${r.light.toFixed(2)} pixels +${r.spread.toFixed(2)}`,
        )
        .join(", ") +
      `; at the default limit light ${verdict(atDefault.light, GLOW_GAIN_FLOOR)}, pixels over 10 ${verdict(atDefault.spread, GLOW_GAIN_FLOOR)}`,
  );
  expect(atDefault.off.outsideBright).toBeGreaterThan(0);
  expect(atDefault.light).toBeGreaterThan(GLOW_GAIN_FLOOR);
  expect(atDefault.spread).toBeGreaterThan(GLOW_GAIN_FLOOR);
  expect(errors).toEqual([]);
});

/**
 * The glow's least gain over off at the default parameters, as a fraction
 * (light in space and pixels over 10 levels): half the smallest gain the
 * starMag 6-9 sweep measured (2026-10-01: pixels +0.18 at magnitude 9;
 * light +0.31 to +0.89, pixels +0.18 to +1.66 over the sweep; at the
 * default 8.5 light +0.36, pixels +0.25).
 */
const GLOW_GAIN_FLOOR = 0.09;
