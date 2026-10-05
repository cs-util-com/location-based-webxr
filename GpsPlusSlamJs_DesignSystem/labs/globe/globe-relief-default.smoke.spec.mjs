// @ts-check
/**
 * The relief by default (F2 plan 2026-10-03-1922 F2a, DEC-GL5-15).
 *
 * Why this file matters: since F2a every viewer gets the relief without
 * asking for it (`#relief=0` keeps the old globe). The owner decided the
 * globe's look above the band stays unchanged (DEC-GL5-14), so the default
 * page, held in orbit over the Alps, must draw the same frame as
 * `relief=0` there, and it must boot without errors. Its cost is stated:
 * the boot to the settled orbit with and without the relief, each in its
 * own page load under SwiftShader (relative numbers only). The real
 * heights' source is fetched by the default page, so its tile requests
 * are answered here with nothing: above the band none is drawn.
 */
import { expect, test } from "@playwright/test";

import { arriveAt, bootGlobe } from "./globe-smoke-helpers.mjs";

const AT = { lat: 46.5, lng: 9 };
const VIEW = `at=${AT.lat},${AT.lng}&spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z&cloudDrift=0`;
/** The bounds' sweep factors (the owner's rule: a one-value verdict is provisional). */
const SWEEP = [0.5, 1, 2];
/** DEC-GL5-14: the look above the band, mean levels. */
const SAME_MEAN = 0.5;

function grid() {
  const g = [];
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 10; j++) g.push([0.05 + i * 0.08, 0.05 + j * 0.1]);
  }
  return g;
}

/** Boots `hash` as given, settles in orbit at AT, reads the grid. */
async function orbitFrame(page, hash) {
  const started = Date.now();
  const errors = await bootGlobe(page, hash, { plain: false });
  const state = await arriveAt(page, AT);
  const bootS = (Date.now() - started) / 1000;
  const px = await page.evaluate(
    (g) => window.__globeLab.readPixels(g),
    grid(),
  );
  return { errors, state, px, bootS };
}

test("the default page draws the relief's globe: the same orbit as relief=0, its boot cost stated", async ({
  browser,
}) => {
  test.setTimeout(420_000);
  const run = async (hash) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    // The tiles' host only: the height source's own module
    // (/osm-lib/elevation/terrarium.js) must load (the first run blocked it).
    await page.route(/elevation-tiles-prod/, (r) =>
      r.fulfill({ status: 404, body: "" }),
    );
    const result = await orbitFrame(page, hash);
    await context.close();
    return result;
  };
  const plain = await run(`relief=0&${VIEW}`);
  const byDefault = await run(VIEW);
  const d = byDefault.px.map((p, i) =>
    Math.max(
      Math.abs(p[0] - plain.px[i][0]),
      Math.abs(p[1] - plain.px[i][1]),
      Math.abs(p[2] - plain.px[i][2]),
    ),
  );
  const mean = d.reduce((s, v) => s + v, 0) / d.length;
  console.log(
    `relief by default in orbit at ${(byDefault.state.altitudeM / 1000).toFixed(0)} km: against relief=0 mean ${mean.toFixed(2)} levels (bound ${SAME_MEAN}: ${SWEEP.map((k) => `x${k} ${mean <= SAME_MEAN * k ? "ok" : "NO"}`).join(" ")}), worst ${Math.max(...d)}; boot to the settled orbit ${byDefault.bootS.toFixed(1)} s against ${plain.bootS.toFixed(1)} s (SwiftShader, one load each)`,
  );
  expect(plain.state.relief).toBeNull();
  // The default page made the relief (its carrier exists), not drawn here.
  expect(byDefault.state.relief).not.toBeNull();
  expect(byDefault.state.relief.share).toBe(0);
  expect(byDefault.errors).toEqual([]);
  expect(plain.errors).toEqual([]);
  expect(mean).toBeLessThanOrEqual(SAME_MEAN);
});
