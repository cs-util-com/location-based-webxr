// @ts-check
/**
 * The reference image's looks (round-4 plan 2026-09-28-2105 DEC-GL4-8):
 * a blue grade, shaded clouds, a soft blue-grey night with warm lights,
 * navy space and a glow round bright stars, each behind its own switch.
 *
 * Why this file matters: each look is judged by the owner against its own
 * OFF, so each must (a) do nothing at 0, the default (the look before, as
 * every other smoke measures it), and (b) move the pixels it is about, in
 * the direction the reference shows, when on. The floors are loose (the
 * owner tunes the strength by eye) and each is reported at x0.5, x1 and
 * x2 (owner rule 2026-09-13). The atmosphere pass is off in every view
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
 * The sun behind the Earth: space dark around the disc, bright stars only,
 * the sun's glow off (it would light the frame around the disc, and before
 * the tiles cover it, the whole frame).
 */
const STARS =
  "at=0,-178.14&spinMs=0&turnMs=0&time=2026-03-20T12:00:00Z&cloudDrift=0&milkyWay=0&atmo=0&starMag=2&starGain=4&sunGlow=0";

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

test("every look is off by default; the grade and the cloud shading move their pixels", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = await bootGlobe(page, DAY);
  await loaded(page);
  expect(await page.evaluate(() => window.__globeLab.state().look)).toEqual({
    grade: 0,
    cloudRelief: 0,
    twilight: 0,
    space: 0,
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
  const errors = await bootGlobe(page, DAY);
  await loaded(page);
  const [cornerOff] = await read(page, [[0.03, 0.05]]);
  await applyHash(page, `${DAY}&space=1`);
  const [cornerOn] = await read(page, [[0.03, 0.05]]);
  console.log(
    `looks: space corner ${cornerOff.slice(0, 3)} -> ${cornerOn.slice(0, 3)}; blue ${verdict(cornerOn[2], 15)}`,
  );
  expect(cornerOff.slice(0, 3)).toEqual([0, 0, 0]);
  expect(cornerOn[2]).toBeGreaterThan(cornerOn[0]);
  expect(cornerOn[2]).toBeGreaterThan(15);
  expect(errors).toEqual([]);
});

test("the star glow spreads the brightest stars' light", async ({ page }) => {
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
  const off = await page.evaluate(
    ({ c }) => window.__globeLab.regionStats(c, 10),
    { c: space },
  );
  await applyHash(page, `${STARS}&starGlow=1`);
  const on = await page.evaluate(
    ({ c }) => window.__globeLab.regionStats(c, 10),
    { c: space },
  );
  const light = on.outsideSum / Math.max(1, off.outsideSum);
  const spread = on.outsideBright / Math.max(1, off.outsideBright);
  console.log(
    `looks: star glow in space: light ${off.outsideSum.toFixed(0)} -> ${on.outsideSum.toFixed(0)} (ratio ${verdict(light, 1.1)}), pixels over 10 ${off.outsideBright} -> ${on.outsideBright} (ratio ${verdict(spread, 1.1)})`,
  );
  expect(off.outsideBright).toBeGreaterThan(0);
  expect(light).toBeGreaterThan(1.1);
  expect(spread).toBeGreaterThan(1.1);
  expect(errors).toEqual([]);
});
