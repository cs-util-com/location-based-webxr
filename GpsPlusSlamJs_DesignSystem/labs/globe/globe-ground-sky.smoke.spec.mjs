// @ts-check
/**
 * The sky hand-over on the descent (F2 plan 2026-10-03-1922 F2b, M1, M6).
 *
 * Why this file matters: below the edge (80 km by default) the framework's
 * ground sky takes over the sky's pixels from the space pass, and the
 * exposure eases from the space view's to the ground sky's. Any jump in
 * either is a visible pop on the way down. Measured, with the bounds
 * stated in the plan before building (each swept x0.5/x1/x2):
 *
 * - **Continuity:** the camera held at dive times through 100 to 45 km;
 *   the frame-to-frame step with the ground sky may exceed the step
 *   without it (`groundSky=0`, the space pass alone) by at most a mean 1
 *   level. Only against the space pass: the ground sky alone at every
 *   height is not a state the lab has.
 * - **The exposure:** the same frames' mean luminance may change by at most
 *   2 levels per 0.1 of the weight beyond what the space pass alone does.
 * - **The rebuilds:** at most one pass per quantised observer step over the
 *   dive (plus the first), and the sky done rebuilding at the hold.
 * - **The dark, physical sky above the edge's band** (the owner's choice,
 *   2026-10-05, from screenshots at 45 km): looking up at the hold, the
 *   ground sky's pixels are darker than the space pass's by at least 20
 *   levels of luminance (64 measured). The plan's first bound (within 8 of
 *   the space pass) assumed the two skies would agree; they do not, because
 *   the space pass draws a day-blue sky from inside its shell where the
 *   real sky at 40 km is close to black.
 */
import { expect, test } from "@playwright/test";

import { bootGlobe, luminance, meanOf } from "./globe-smoke-helpers.mjs";

const ORIGIN = `http://127.0.0.1:${process.env.DS_E2E_PORT ?? "5198"}`;
const TARGET = { latitude: 46.5, longitude: 9.0 };
const HOLD_KM = 40;
const BASE = `spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z&cloudDrift=0&stars=0&milkyWay=0&relief=1&reliefHeights=synthetic&diveMs=6000&detail=0&landKm=${HOLD_KM}`;
/** The bounds' sweep factors (the owner's rule: a one-value verdict is provisional). */
const SWEEP = [0.5, 1, 2];
const STEP = 1;
const EXPOSURE_PER_TENTH = 2;
/** Looking up at the hold: the ground sky darker by at least this (levels). */
const SKY_DARKER = 20;

const verdict = (value, bound) =>
  `${value.toFixed(2)} (bound ${bound}: ${SWEEP.map((k) => `x${k} ${value <= bound * k ? "ok" : "NO"}`).join(" ")})`;

function grid(fromV, toV) {
  const g = [];
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 6; j++) {
      g.push([0.05 + i * 0.1, fromV + ((toV - fromV) * (j + 0.5)) / 6]);
    }
  }
  return g;
}

const meanDiff = (a, b) =>
  meanOf(
    a.map((p, i) =>
      Math.max(
        Math.abs(p[0] - b[i][0]),
        Math.abs(p[1] - b[i][1]),
        Math.abs(p[2] - b[i][2]),
      ),
    ),
  );

async function land(page, context) {
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(TARGET);
  const errors = await bootGlobe(page, BASE);
  await page.locator("#globe-pin").click();
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return (
        s.phase === "landed" &&
        s.pin.phase === "idle" &&
        s.relief?.settled &&
        s.groundSky?.rebuildPending === false
      );
    },
    null,
    { timeout: 300_000 },
  );
  return errors;
}

test("the ground sky takes over the sky without a jump, its exposure eased, its rebuilds stepped", async ({
  page,
  context,
}) => {
  test.setTimeout(900_000);
  const errors = await land(page, context);
  const landed = await page.evaluate(() => window.__globeLab.state());
  expect(landed.groundSky.supported).toBe(true);
  expect(landed.groundSky.weight).toBe(1);
  // The rebuilds over the dive: one pass per observer step at most (from
  // the ceiling to the hold, 5 % steps), plus the first.
  const steps = Math.ceil(Math.log(99.9 / HOLD_KM) / Math.log(1.05)) + 1;
  const passes = landed.groundSky.rebuilds.luts;
  // Dive times through 100 to 45 km, the tiles frozen.
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
    for (let i = 0; i <= 24; i++) out.push(at(100 * (45 / 100) ** (i / 24)));
    return out;
  });
  const g = grid(0.1, 0.9);
  const rows = {};
  for (const [label, extra] of [
    ["ground sky", ""],
    ["space only", "&groundSky=0"],
  ]) {
    await page.evaluate((h) => {
      location.hash = h;
    }, `${BASE}${extra}&bandFreeze=1`);
    const frames = [];
    for (const ms of times) {
      await page.evaluate((t) => window.__globeLab.holdDiveAt(t), ms);
      // The staged sky settles at each held height before the read.
      await page.waitForFunction(
        () => window.__globeLab.state().groundSky?.rebuildPending === false,
        null,
        { timeout: 30_000 },
      );
      frames.push(
        await page.evaluate((pts) => {
          const lab = window.__globeLab;
          const px = lab.readPixels(pts);
          const st = lab.state();
          return {
            px,
            weight: st.groundSky?.weight ?? 0,
            programs: st.programs,
            haze: st.haze,
          };
        }, g),
      );
    }
    rows[label] = frames;
  }
  const on = rows["ground sky"];
  const off = rows["space only"];
  let worstStep = 0;
  let worstExposure = 0;
  for (let i = 1; i < on.length; i++) {
    const stepOn = meanDiff(on[i].px, on[i - 1].px);
    const stepOff = meanDiff(off[i].px, off[i - 1].px);
    worstStep = Math.max(worstStep, stepOn - stepOff);
    const dl = (frames, k) =>
      meanOf(frames[k].px.map(luminance)) -
      meanOf(frames[k - 1].px.map(luminance));
    const dw = Math.abs(on[i].weight - on[i - 1].weight);
    if (dw > 0.01) {
      const beyond = Math.abs(dl(on, i) - dl(off, i));
      worstExposure = Math.max(worstExposure, beyond / (dw / 0.1));
    }
  }
  // Looking up at the hold: the sky's pixels with and without.
  const sky = [];
  for (const extra of ["", "&groundSky=0"]) {
    await page.evaluate((h) => {
      location.hash = h;
    }, `${BASE}${extra}&bandFreeze=1`);
    await page.evaluate((t) => window.__globeLab.holdDiveAt(t), times.at(-1));
    await page.evaluate(() => window.__globeLab.pitchView(40));
    await page.waitForFunction(
      () => window.__globeLab.state().groundSky?.rebuildPending === false,
      null,
      { timeout: 30_000 },
    );
    sky.push(
      await page.evaluate(
        (pts) => window.__globeLab.readPixels(pts),
        grid(0.05, 0.3),
      ),
    );
  }
  const skyDarker =
    meanOf(sky[1].map(luminance)) - meanOf(sky[0].map(luminance));
  console.log(
    `ground sky over 100-45 km: frame-to-frame step beyond the space pass's, worst ${verdict(worstStep, STEP)}; exposure, mean luminance per 0.1 of the weight beyond the space pass's, worst ${verdict(worstExposure, EXPOSURE_PER_TENTH)}; rebuild passes over the dive ${passes} (bound ${steps}); weights ${on.map((f) => f.weight.toFixed(2)).join(" ")}; looking up at ${HOLD_KM} km, the ground sky darker than the space pass by ${skyDarker.toFixed(2)} (at least ${SKY_DARKER}: ${SWEEP.map((k) => `x${k} ${skyDarker >= SKY_DARKER * k ? "ok" : "NO"}`).join(" ")}); programs ${on[0].programs} at weight 0 and ${on.at(-1).programs} at weight 1; haze at weight 1 ${JSON.stringify(on.at(-1).haze)}`,
  );
  expect(errors).toEqual([]);
  expect(passes).toBeLessThanOrEqual(steps);
  // The fog is there for the whole page, so crossing the edge compiles
  // nothing (frame-hitch review 2026-10-03-2017), and the haze is on below.
  expect(on.at(-1).programs).toBe(on[0].programs);
  expect(on.at(-1).haze.synced).toBe(true);
  expect(on.at(-1).haze.density).toBeGreaterThan(0);
  expect(worstStep).toBeLessThanOrEqual(STEP);
  expect(worstExposure).toBeLessThanOrEqual(EXPOSURE_PER_TENTH);
  expect(skyDarker).toBeGreaterThanOrEqual(SKY_DARKER);
});
