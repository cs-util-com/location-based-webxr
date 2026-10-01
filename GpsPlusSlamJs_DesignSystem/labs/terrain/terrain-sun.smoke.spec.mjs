// @ts-check
/**
 * The terrain lab's sun term in the browser (globe round-5 plan
 * 2026-10-01-0945 §3.3 "One light first").
 *
 * Why this file matters: `terrain-sun.test.mjs` proves the reference
 * functions, but only the GPU shows that the shader reads the sun the page
 * computes: a uniform left at the map light, a frame turned the wrong way
 * (east for west) or a clock that ignores `time=` all still draw a
 * plausible relief. So the page's sun is held to an independent solar
 * estimate, and the relief's lit faces must swap sides between a morning
 * and an evening sun, measured on the real Alps tiles.
 */
import { expect, test } from "@playwright/test";

import {
  applyHash,
  boot,
  fixtureTile,
  luminance,
  readPixels,
  routeAll,
  state,
} from "./terrain-smoke-helpers.mjs";
import { reliefNormal, sunRelativeShade } from "./terrain-sun.js";

const DEG = Math.PI / 180;
/** Midsummer at the Alps place: a low sun from the north-east, then the west. */
const MORNING = "2026-06-21T04:30:00Z";
const EVENING = "2026-06-21T17:30:00Z";
/** The slope gain the view sets, so the prediction does not lean on a default. */
const SHADE = 1;
const VIEW = `place=alps&style=pastel&alt=300000&tilt=0&head=0&svf=0&tau=0&exag=1&shade=${SHADE}&light=1`;

/**
 * A low-precision sun (Spencer's declination and equation of time, about
 * 0.2°): independent of the framework's `solarPosition`, so it checks the
 * page's wiring (clock, place, frame) rather than repeating its code.
 */
function estimateSun(iso, latDeg, lngDeg) {
  const ms = Date.parse(iso);
  const start = Date.UTC(new Date(ms).getUTCFullYear(), 0, 1);
  const day = (ms - start) / 86_400_000;
  const g = (2 * Math.PI * day) / 365;
  const dec =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g);
  const eotMin =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const utcMin = (ms / 60_000) % 1440;
  const solarMin = utcMin + 4 * lngDeg + eotMin;
  const hour = (solarMin / 4 - 180) * DEG;
  const lat = latDeg * DEG;
  const el = Math.asin(
    Math.sin(lat) * Math.sin(dec) +
      Math.cos(lat) * Math.cos(dec) * Math.cos(hour),
  );
  const az =
    Math.atan2(
      Math.sin(hour),
      Math.cos(hour) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat),
    ) + Math.PI;
  return {
    elevationDeg: el / DEG,
    azimuthDeg: (((az / DEG) % 360) + 360) % 360,
  };
}

/** The page's sun as elevation and azimuth (clockwise from north), degrees. */
const sunAngles = ([e, n, u]) => ({
  elevationDeg: Math.asin(u) / DEG,
  azimuthDeg: (((Math.atan2(e, n) / DEG) % 360) + 360) % 360,
});

/** How far the page's sun may sit from the estimate, degrees; swept 0.5-2. */
const SUN_TOLERANCE_DEG = 1;
/**
 * The least shade difference (morning minus evening, predicted) that marks
 * a face as turned to one sun and from the other; swept 0.2-0.6.
 */
const FACE_SPLIT = 0.4;

test("the relief is lit by the globe's sun at the hash's time, and its lit faces follow it", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const record = await routeAll(page, fixtureTile);
  const errors = await boot(page, `${VIEW}&time=${MORNING}`);
  expect(record.missing).toEqual([]);
  const ground = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < 70; i++) {
      for (let j = 0; j < 70; j++) {
        const x = -110_000 + (220_000 * i) / 69;
        const y = -110_000 + (220_000 * j) / 69;
        const f = window.__terrainLab.fieldAt(x, y);
        if (f) out.push({ x, y, ...f });
      }
    }
    return out;
  });
  // The ground as the vertex shader places it (E 1, above the datum).
  const datum = (await state(page)).datum;
  const projected = await page.evaluate(
    (ps) => window.__terrainLab.projectAll(ps),
    ground.map((p) => [p.x, p.heightM - datum, -p.y]),
  );

  const measure = async (iso) => {
    await applyHash(page, `${VIEW}&time=${iso}`);
    const s = await state(page);
    expect(s.light).toBe(1);
    expect(s.sun.timeMs).toBe(Date.parse(iso));
    const px = await readPixels(page, projected);
    return { s, lum: px.map(luminance) };
  };
  const morning = await measure(MORNING);
  const evening = await measure(EVENING);

  for (const [iso, run] of [
    [MORNING, morning],
    [EVENING, evening],
  ]) {
    const got = sunAngles(run.s.sun.enu);
    const want = estimateSun(iso, 46.56, 9.14);
    const off = Math.max(
      Math.abs(got.elevationDeg - want.elevationDeg),
      Math.abs(((got.azimuthDeg - want.azimuthDeg + 540) % 360) - 180),
    );
    console.log(
      `sun at ${iso}: page el ${got.elevationDeg.toFixed(2)}° az ${got.azimuthDeg.toFixed(2)}°, ` +
        `estimate el ${want.elevationDeg.toFixed(2)}° az ${want.azimuthDeg.toFixed(2)}°, off ${off.toFixed(2)}° ` +
        `(${[0.5, 1, 2].map((t) => `${t}:${off <= t ? "pass" : "fail"}`).join(" ")})`,
    );
    expect(off).toBeLessThan(SUN_TOLERANCE_DEG);
  }

  // Each face's predicted shade under either sun, with the page's gain.
  const gain = morning.s.slopeBoost * SHADE;
  const shadeUnder = (sun, p) =>
    sunRelativeShade(reliefNormal(p.gx, p.gy, gain), sun);
  const split = (lum, threshold) => {
    const toMorning = [];
    const toEvening = [];
    ground.forEach((p, i) => {
      const d =
        shadeUnder(morning.s.sun.enu, p) - shadeUnder(evening.s.sun.enu, p);
      if (d > threshold) toMorning.push(lum[i]);
      else if (d < -threshold) toEvening.push(lum[i]);
    });
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    return {
      n: [toMorning.length, toEvening.length],
      diff: mean(toMorning) - mean(toEvening),
    };
  };
  for (const t of [0.2, 0.4, 0.6]) {
    const m = split(morning.lum, t);
    const e = split(evening.lum, t);
    console.log(
      `faces split at ${t}: n ${m.n.join("/")}, morning-facing minus evening-facing luminance: ` +
        `morning render ${m.diff.toFixed(1)}, evening render ${e.diff.toFixed(1)}`,
    );
  }
  const m = split(morning.lum, FACE_SPLIT);
  const e = split(evening.lum, FACE_SPLIT);
  expect(Math.min(...m.n)).toBeGreaterThan(30);
  // The faces turned to the morning sun are the lighter ones in the
  // morning and the darker ones in the evening. A sun that never reached
  // the shader would draw both renders alike and fail one of the two.
  expect(m.diff).toBeGreaterThan(10);
  expect(e.diff).toBeLessThan(-10);
  expect(errors).toEqual([]);
});
