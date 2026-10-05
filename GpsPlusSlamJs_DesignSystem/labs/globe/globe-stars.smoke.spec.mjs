// @ts-check
/**
 * The globe's stars to magnitude 9 (round-4 plan 2026-09-28-2105 DEC-GL4-2).
 *
 * Why this file matters: the field is now packed 6 bytes a star and the
 * direction is decoded in the vertex shader. A wrong decode would still
 * scatter points over the sky, and every other star check (bright pixels in
 * space, none over the Earth) would pass; only a star drawn WHERE the CPU
 * says it is can show the decode is right. The limit's range (to 9) and
 * the brightness slider's (to 10) must reach the page, and the cost of the
 * larger field is logged per limit, as the owner asked for it on both
 * tiers (desktop, and a phone-sized DPR-2 view).
 */
import { expect, test } from "@playwright/test";

import { applyHash, luminance, plainGlobe } from "./globe-smoke-helpers.mjs";

/** The sun behind the Earth at the equinox noon: space is dark around it. */
const VIEW =
  "at=0,-178.14&spinMs=0&turnMs=0&time=2026-03-20T12:00:00Z&cloudDrift=0&milkyWay=0&atmo=0";

async function boot(page, hash) {
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/labs/globe/#${plainGlobe(hash)}`);
  await page.waitForFunction(
    () => window.__globeLab?.ready || window.__globeLab?.error,
    null,
    { timeout: 90_000 },
  );
  expect(await page.evaluate(() => window.__globeLab.error)).toBeNull();
  await page.waitForFunction(
    () => window.__globeLab.state().phase === "arrived",
    null,
    { timeout: 90_000 },
  );
  return errors;
}

// WHY: the brightest star, decoded on the CPU from the same packed bytes,
// must light the pixels where the view projects it. Only the stars to 0.5
// are drawn (a handful), so a bright pixel there is that star.
test("the packed stars draw where their directions say", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await boot(page, `${VIEW}&starMag=0.5&starGain=4`);
  const brightest = await page.evaluate(
    () => window.__globeLab.state().sky.stars.brightest,
  );
  // Turn the view so the star is in space beside the Earth: the view's
  // axis 30° east of the star (the Earth's disc spans about 23°), the
  // camera over the antipode of that axis (as the Milky Way check does).
  const g = await page.evaluate(
    (v) => window.__globeLab.celestialToEcef(v),
    brightest,
  );
  const east = [-g[1], g[0], 0];
  const el = Math.hypot(...east);
  const s30 = Math.sin(Math.PI / 6);
  const c30 = Math.cos(Math.PI / 6);
  const cam = g.map((v, k) => -(v * c30 + (east[k] / el) * s30));
  const lat = (Math.asin(cam[2]) * 180) / Math.PI;
  const lng = (Math.atan2(cam[1], cam[0]) * 180) / Math.PI;
  await applyHash(
    page,
    `at=${lat.toFixed(3)},${lng.toFixed(3)}&spinMs=0&turnMs=0&time=2026-03-20T12:00:00Z&cloudDrift=0&milkyWay=0&starMag=0.5&starGain=4&sky=1`,
  );
  await page.waitForFunction(
    () => window.__globeLab.state().phase === "arrived",
  );
  const p = await page.evaluate(
    (v) => window.__globeLab.projectCelestial(v),
    brightest,
  );
  console.log(
    `brightest star ${JSON.stringify(brightest)} at ${JSON.stringify(p)}`,
  );
  expect(p).not.toBeNull();
  const { width, height } = await page.evaluate(() => {
    const c = document.getElementById("globe-canvas");
    return { width: c.width, height: c.height };
  });
  // A 7 x 7 pixel window around it.
  const win = [];
  for (let i = -3; i <= 3; i++) {
    for (let j = -3; j <= 3; j++)
      win.push([p[0] + i / width, p[1] + j / height]);
  }
  const lum = (
    await page.evaluate((w) => window.__globeLab.readPixels(w), win)
  ).map(luminance);
  const peak = Math.max(...lum);
  await applyHash(
    page,
    `at=${lat.toFixed(3)},${lng.toFixed(3)}&spinMs=0&turnMs=0&time=2026-03-20T12:00:00Z&cloudDrift=0&milkyWay=0&starMag=0.5&starGain=4&stars=0`,
  );
  const off = Math.max(
    ...(await page.evaluate((w) => window.__globeLab.readPixels(w), win)).map(
      luminance,
    ),
  );
  console.log(
    `brightest star's window: peak ${peak.toFixed(1)}, stars off ${off.toFixed(1)}`,
  );
  expect(peak).toBeGreaterThan(off + 60);
  expect(errors).toEqual([]);
});

/**
 * The cost per limit, as a ratio to the same view with the stars off,
 * measured in one page load. `FRAMES` frames per reading, the median of
 * `REPEATS` readings.
 */
const FRAMES = 20;
const REPEATS = 3;
const LIMITS = [6.5, 7.5, 8.5, 9];

async function costTable(page) {
  const rows = [];
  const time = async (extra) => {
    await applyHash(page, `${VIEW}&${extra}`);
    const t = [];
    for (let k = 0; k < REPEATS; k++) {
      t.push(
        await page.evaluate((n) => window.__globeLab.timeFrames(n), FRAMES),
      );
    }
    return t.sort((a, b) => a - b)[Math.floor(REPEATS / 2)];
  };
  const off = await time("stars=0");
  for (const mag of LIMITS) {
    const ms = await time(`starMag=${mag}&starGain=4`);
    const count = await page.evaluate(
      () => window.__globeLab.state().sky.stars.count,
    );
    rows.push({ mag, count, ratio: ms / off });
  }
  return { off, rows };
}

// WHY: the owner asked what the larger field costs. Logged, and bounded
// loosely: a field that multiplied the frame time would be a finding.
for (const [tier, use] of [
  ["desktop 1280x800", {}],
  [
    "phone 412x915 at DPR 2",
    { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 },
  ],
]) {
  test.describe(tier, () => {
    test.use(use);
    test(`what the stars cost per limit (${tier})`, async ({ page }) => {
      test.setTimeout(120_000);
      const errors = await boot(page, VIEW);
      const { off, rows } = await costTable(page);
      console.log(
        `stars cost, ${tier}: off ${(off / FRAMES).toFixed(1)} ms a frame (SwiftShader, relative only); ` +
          rows
            .map(
              (r) => `mag ${r.mag}: ${r.count} stars, x${r.ratio.toFixed(2)}`,
            )
            .join("; "),
      );
      for (const r of rows) expect(r.ratio).toBeLessThan(3);
      expect(rows.at(-1)?.count).toBeGreaterThan(80_000);
      expect(errors).toEqual([]);
    });
  });
}
