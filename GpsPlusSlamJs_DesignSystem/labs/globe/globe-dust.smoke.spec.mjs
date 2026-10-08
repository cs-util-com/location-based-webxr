/**
 * The space dust (round-2 plan 2026-10-07-2350 DEC-FR2-7; the owner:
 * "particles, so you feel how fast the camera is coming in; let us try
 * whether it looks good"). An experiment behind `dust=1`, off by default:
 * points in space high up, gone before the sky, nothing at all when off.
 */
import { expect, test } from "@playwright/test";

import { applyHash, bootGlobe } from "./globe-smoke-helpers.mjs";

const BASE =
  "spinMs=0&turnMs=0&time=2026-10-05T11:00:00Z&cloudDrift=0&stars=0&milkyWay=0&cloudVolume=0";
// Level at 8,000 km: the Earth below, space above, where the dust shows.
const HIGH = "view=46.9,7.4,8000,0,0";
const LOW = "view=46.9,7.4,150,0,-30";

/** Pixels brighter than 60 levels over the whole frame. */
async function brightPixels(page) {
  const stats = await page.evaluate(() =>
    window.__globeLab.regionStats({ cx: 0.5, cy: 0.5, rPx: 0 }, 60),
  );
  return stats.outsideBright;
}

/** The mean frame interval over 60 frames, ms (logged, not asserted). */
async function frameMs(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const times = [];
        const tick = (t) => {
          times.push(t);
          if (times.length < 61) requestAnimationFrame(tick);
          else resolve((times[60] - times[0]) / 60);
        };
        requestAnimationFrame(tick);
      }),
  );
}

// WHY: the dust must draw points in space when on, be gone low down where
// the sky begins, and draw nothing when off (the default), so the look
// nobody asked to change stays exactly as it was.
test("the space dust shows high up, is gone low down, and is off by default", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors = await bootGlobe(page, `${BASE}&${HIGH}`, { phase: "user" });
  const off = await page.evaluate(() => window.__globeLab.state().dust);
  const offBright = await brightPixels(page);
  const offMs = await frameMs(page);

  await applyHash(page, `${BASE}&dust=1&${HIGH}`);
  await page.waitForFunction(() => window.__globeLab.state().dust.shown);
  const high = await page.evaluate(() => window.__globeLab.state().dust);
  const onBright = await brightPixels(page);
  const onMs = await frameMs(page);

  await applyHash(page, `${BASE}&dust=1&${LOW}`);
  await page.waitForFunction(
    () => window.__globeLab.state().dust.shown === false,
  );
  const low = await page.evaluate(() => window.__globeLab.state().dust);

  console.log(
    `dust: off ${offBright} bright px (${offMs.toFixed(1)} ms/frame), on ${onBright} (${onMs.toFixed(1)} ms/frame), ${high.count} points; opacity ${high.opacity} high, ${low.opacity} at 150 km`,
  );
  expect(errors).toEqual([]);
  expect(off).toEqual({ count: 0, opacity: 0, shown: false });
  expect(high.opacity).toBe(1);
  expect(onBright - offBright).toBeGreaterThan(30);
  expect(low.opacity).toBe(0);
});
