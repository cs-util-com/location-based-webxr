// @ts-check
/**
 * The sky fill on the globe (DEC-GL5-11; review 2026-10-03-1835 major 2).
 *
 * Why this file matters: the relief takes the sky's fill at a low sun, and
 * the globe's own surface takes it only as far as the relief has the
 * pixels (the altitude band's share), so the approved globe look above the
 * band does not change for anyone. Two failures would be silent:
 * - the fill reaching the plain globe (a +37 % brighter terminator at a
 *   10 degree sun, the review measured);
 * - the look pin (`skyFloor=0`) not reaching the shader, so every smoke
 *   that pins the look would measure the fill without knowing it.
 * Each is checked in the browser:
 * - the pin's value as the shader reads it;
 * - at dusk from the arrived view and from 5,000 km, with the relief off
 *   and on (above the band its share is 0): the default frame against
 *   `skyFloor=0`.
 * Bound: a mean 0.5 levels, reported at x0.5, x1 and x2. The frame time
 * of the relief's page (the band compiled in) against the plain globe is
 * logged (SwiftShader: relative only).
 */
import { expect, test } from "@playwright/test";

import {
  applyHash,
  bootGlobe,
  withPreRound4Look,
} from "./globe-smoke-helpers.mjs";

const ORIGIN = `http://127.0.0.1:${process.env.DS_E2E_PORT ?? "5198"}`;
/** The equinox at 18:00 UTC over 0 N 0 E: the terminator under the target. */
const TARGET = { latitude: 0, longitude: 0 };
const DUSK =
  "at=0,0&spinMs=0&turnMs=0&time=2026-03-20T18:00:00Z&cloudDrift=0&stars=0&milkyWay=0&atmo=0";
const BOUND = 0.5;
const SWEEP = [0.5, 1, 2];
const verdict = (v) =>
  SWEEP.map((k) => `x${k} ${v <= BOUND * k ? "ok" : "NO"}`).join(" ");

/** The frame's middle 60 %, every 4 %. */
const grid = () => {
  const g = [];
  for (let y = 0.2; y <= 0.8; y += 0.04)
    for (let x = 0.2; x <= 0.8; x += 0.04) g.push([x, y]);
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

/** Waits until the globe's tiles for the view have loaded. */
const loaded = (page) =>
  page.waitForFunction(
    () => window.__globeLab.state().pendingTiles === 0,
    null,
    { timeout: 120_000 },
  );

// The pin reaches the shader: the uniform the fill reads, not the hash.
test("the pre-round-4 look pin sets the sky fill's floor the shader reads", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = await bootGlobe(page, withPreRound4Look(DUSK));
  const pinned = await page.evaluate(() => window.__globeLab.state().skyFill);
  await applyHash(page, DUSK);
  const open = await page.evaluate(() => window.__globeLab.state().skyFill);
  console.log(
    `sky fill as the shader reads it: pinned ${JSON.stringify(pinned)}, default ${JSON.stringify(open)}`,
  );
  expect(pinned.floor).toBe(0);
  expect(open.floor).toBe(0.5);
  expect(errors).toEqual([]);
});

test("the globe's look at dusk is the approved one above the band, relief off or on", async ({
  browser,
}) => {
  test.setTimeout(900_000);
  const points = grid();
  const rows = [];
  for (const relief of [0, 1]) {
    for (const view of ["arrived", "5000 km"]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const base = `${DUSK}&relief=${relief}&reliefHeights=synthetic`;
      const hash =
        view === "arrived"
          ? base
          : `${base}&diveMs=2000&landKm=5000`;
      const errors = await bootGlobe(page, hash);
      if (view !== "arrived") {
        await context.grantPermissions(["geolocation"], { origin: ORIGIN });
        await context.setGeolocation(TARGET);
        await page.locator("#globe-pin").click();
        await page.waitForFunction(
          () => {
            const s = window.__globeLab.state();
            return s.phase === "landed" && s.pin.phase === "idle";
          },
          null,
          { timeout: 120_000 },
        );
      }
      await loaded(page);
      const s = await page.evaluate(() => window.__globeLab.state());
      // The cost of the compiled-in band (review 2026-10-03-1835 minor 10):
      // the frame time with the relief's page against the plain globe.
      const ms =
        (await page.evaluate(() => window.__globeLab.timeFrames(10))) / 10;
      const fill = await page.evaluate(
        (p) => window.__globeLab.readPixels(p),
        points,
      );
      await applyHash(page, `${hash}&skyFloor=0`);
      const none = await page.evaluate(
        (p) => window.__globeLab.readPixels(p),
        points,
      );
      rows.push({
        relief,
        view,
        altitudeKm: s.altitudeM / 1000,
        share: s.relief?.share ?? null,
        diff: meanDiff(fill, none),
        ms,
        errors,
      });
      await context.close();
    }
  }
  for (const r of rows) {
    console.log(
      `dusk, relief ${r.relief}, ${r.view} (${r.altitudeKm.toFixed(0)} km, share ${r.share}): default against skyFloor=0, mean |difference| ${r.diff.toFixed(3)} (bound ${BOUND}: ${verdict(r.diff)}); ${r.ms.toFixed(1)} ms a frame`,
    );
  }
  for (const r of rows) {
    expect(r.errors, `${r.relief} ${r.view}`).toEqual([]);
    expect(r.diff, `${r.relief} ${r.view}`).toBeLessThanOrEqual(BOUND);
  }
});
