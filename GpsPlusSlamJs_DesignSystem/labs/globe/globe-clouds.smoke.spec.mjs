// @ts-check
/**
 * The clouds on their own shell (round-6 plan 2026-10-04-1050 G6-2,
 * DEC-G6-3/4), measured in the browser.
 *
 * Why this file matters: the owner saw the relief turn into a black-and-white
 * relief under a passing cloud: the clouds were painted into the ground's
 * colour, so the relief's shading lit the cloud. With the shell the ground
 * keeps its own colour, the clouds float above it, and a soft shadow is the
 * only trace they leave on the ground. Measured at the hold over the relief,
 * all from one landed dive (the clouds' look switches apply live):
 * - the ground under a hidden shell equals the cloud-free ground (no paint
 *   left), while the painted ground does not (the positive control);
 * - the shadow only ever darkens, and does darken somewhere;
 * - from orbit nothing changes: the clouds move onto the shell only as the
 *   relief takes the pixels, because the shell, tone-mapped and then blended
 *   in display space, read 25-35 levels (summed) darker than the paint
 *   (measured 2026-10-04), and the approved orbit look stays;
 * - the shell's cost, on against off (logged).
 */
import { expect, test } from "@playwright/test";

import { bootGlobe } from "./globe-smoke-helpers.mjs";

const ORIGIN = `http://127.0.0.1:${process.env.DS_E2E_PORT ?? "5198"}`;
const TARGET = { latitude: 46.5, longitude: 9.0 };
const BASE =
  "spinMs=0&turnMs=0&time=2026-03-20T11:00:00Z&cloudDrift=0&relief=1&reliefHeights=synthetic&diveMs=6000&handOver=0&detail=0";

/** A 12 x 8 grid over the frame below the horizon at the hold. */
function holdGrid() {
  const grid = [];
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 8; j++) grid.push([0.05 + i * 0.065, 0.3 + j * 0.085]);
  }
  return grid;
}

/** Mean and 95th percentile of the per-point summed channel differences. */
function compare(a, b) {
  const d = a.map(
    (p, i) =>
      Math.abs(p[0] - b[i][0]) +
      Math.abs(p[1] - b[i][1]) +
      Math.abs(p[2] - b[i][2]),
  );
  const sorted = [...d].sort((x, y) => x - y);
  return {
    mean: d.reduce((s, v) => s + v, 0) / d.length,
    p95: sorted[Math.floor(0.95 * (sorted.length - 1))],
  };
}

/** Applies a hash and returns the grid's pixels after a few frames. */
async function readAt(page, hash, grid, { hideShell = false } = {}) {
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
  await page.waitForFunction(
    (h) => window.__globeLab.state().appliedHash === h,
    hash,
  );
  return page.evaluate(
    ([g, hide]) => {
      window.__globeLab.hideCloudShell(hide);
      window.__globeLab.timeFrames(3);
      return window.__globeLab.readPixels(g);
    },
    [grid, hideShell],
  );
}

test("the ground keeps its colour under the shell, the shadow only darkens, and the orbit look holds", async ({
  page,
  context,
}) => {
  test.setTimeout(900_000);
  await context.grantPermissions(["geolocation"], { origin: ORIGIN });
  await context.setGeolocation(TARGET);
  const errors = await bootGlobe(page, BASE);
  // From orbit first: the shell against the paint, the same frame.
  await page.waitForFunction(
    () => window.__globeLab.state().pendingTiles === 0,
    null,
    { timeout: 300_000 },
  );
  const orbitGrid = holdGrid();
  const orbitShell = await readAt(page, `${BASE}&cloudShell=1`, orbitGrid);
  const orbitPaint = await readAt(page, `${BASE}&cloudShell=0`, orbitGrid);
  const orbit = compare(orbitShell, orbitPaint);
  const cost = await page.evaluate(async () => {
    const lab = window.__globeLab;
    const rounds = [];
    for (const shell of [1, 0, 1, 0]) {
      const h = `${location.hash.slice(1).replace(/&cloudShell=\d/, "")}&cloudShell=${shell}`;
      location.hash = h;
      await new Promise((r) => requestAnimationFrame(r));
      rounds.push({ shell, ms: lab.timeFrames(5) / 5 });
    }
    return rounds;
  });
  // Then the hold over the relief.
  await page.locator("#globe-pin").click();
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return (
        s.phase === "landed" && (s.relief?.share ?? 0) >= 1 && s.relief?.settled
      );
    },
    null,
    { timeout: 300_000 },
  );
  const grid = holdGrid();
  const clear = await readAt(page, `${BASE}&cloudShell=0&cloudOpacity=0`, grid);
  const painted = await readAt(page, `${BASE}&cloudShell=0`, grid);
  const under = await readAt(page, `${BASE}&cloudShell=1&cloudShadow=0`, grid, {
    hideShell: true,
  });
  const shaded = await readAt(
    page,
    `${BASE}&cloudShell=1&cloudShadow=0.6`,
    grid,
    {
      hideShell: true,
    },
  );
  const keep = compare(under, clear);
  const paint = compare(painted, clear);
  const lum = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  const darker = under.map((p, i) => lum(p) - lum(shaded[i]));
  const brighter = Math.max(0, ...darker.map((v) => -v));
  const darkened = darker.filter((v) => v > 3).length;
  console.log(
    `cloud shell: under the hidden shell vs cloud-free mean ${keep.mean.toFixed(2)} p95 ${keep.p95}; painted vs cloud-free mean ${paint.mean.toFixed(2)} p95 ${paint.p95}; shadow 0.6 darkens ${darkened} of ${grid.length} points, brightens at most ${brighter.toFixed(2)}; orbit shell vs paint mean ${orbit.mean.toFixed(2)} p95 ${orbit.p95}; frame ms ${cost.map((r) => `${r.shell ? "shell" : "paint"} ${r.ms.toFixed(0)}`).join(", ")}`,
  );
  expect(errors).toEqual([]);
  // No paint left: the ground under the shell is the cloud-free ground
  // (summed channels, 8-bit; rendering noise reads 0-2).
  expect(keep.mean).toBeLessThanOrEqual(2);
  // The positive control: the paint does change the ground.
  expect(paint.mean).toBeGreaterThan(keep.mean + 10);
  // The shadow only darkens, and somewhere it does.
  expect(brighter).toBeLessThanOrEqual(1);
  expect(darkened).toBeGreaterThan(0);
  // From orbit the clouds are the paint, with the shell switch on or off.
  expect(orbit.mean).toBeLessThanOrEqual(2);
});
