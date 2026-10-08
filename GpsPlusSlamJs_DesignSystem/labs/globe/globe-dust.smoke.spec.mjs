/**
 * The speed dust (round-3 plan 2026-10-08-2345 D1; the owner, 2026-10-08:
 * "dust that streaks past the camera very fast, tied to the speed in metres
 * per second"). It replaced a world-fixed dust that clumped over the city
 * when he zoomed back out. Off by default; during a flight the streaks pour
 * outward from where the camera is heading; a stopped or placed camera
 * draws nothing.
 */
import { expect, test } from "@playwright/test";

import { applyHash, bootGlobe } from "./globe-smoke-helpers.mjs";

const TIME = "time=2026-10-05T11:00:00Z";

// WHY: the default look must not change; a held view has no speed.
test("the speed dust draws nothing by default, nor for a held view", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = await bootGlobe(
    page,
    `spinMs=0&turnMs=0&${TIME}&stars=0&milkyWay=0&view=46.9,7.4,8000,0,0`,
    { phase: "user" },
  );
  await page.evaluate(() => window.__globeLab.timeFrames(3));
  const off = await page.evaluate(() => window.__globeLab.state().dust);
  await applyHash(
    page,
    `spinMs=0&turnMs=0&${TIME}&stars=0&milkyWay=0&dust=1&view=46.9,7.4,8000,0,0`,
  );
  await page.evaluate(() => window.__globeLab.timeFrames(3));
  const held = await page.evaluate(() => window.__globeLab.state().dust);
  expect(errors).toEqual([]);
  expect(off.shown).toBe(false);
  expect(held.shown).toBe(false);
  expect(held.speedMps).toBe(0);
});

// WHY: the point of the dust. During the meteor's flight the camera looks
// along its travel, so the streaks must pour out of the screen's centre:
// the focus of expansion (where the measured velocity points) near the
// centre is the independent check (that each streak runs away from the
// focus holds by construction for any velocity, the milestone review, so
// it is only a drawing check). Low and slow, and after a jump back out,
// nothing.
test("during a flight the streaks pour outward from where the camera heads, and stop with it", async ({
  page,
}) => {
  test.setTimeout(400_000);
  await page.goto(
    `/labs/globe/#${TIME}&at=46.948,7.4474&land=1&flight=2&relief=0&cityWarm=0&dust=1`,
  );
  await page.waitForFunction(
    () => {
      const s = window.__globeLab?.state?.();
      return s && s.dust.shown && s.altitudeM < 10_000_000;
    },
    null,
    { timeout: 240_000, polling: 250 },
  );
  const high = await page.evaluate(() => {
    const lab = window.__globeLab;
    return {
      dust: lab.state().dust,
      altitudeM: lab.state().altitudeM,
      sample: lab.dustSample(300),
    };
  });
  const { streaks, focus } = high.sample;
  let outward = 0;
  let judged = 0;
  for (const { head, tail } of streaks) {
    if (!focus) break;
    const fromFocus = [head[0] - focus[0], head[1] - focus[1]];
    if (Math.hypot(fromFocus[0], fromFocus[1]) < 0.05) continue;
    const along = [head[0] - tail[0], head[1] - tail[1]];
    if (Math.hypot(along[0], along[1]) < 1e-4) continue;
    judged += 1;
    if (along[0] * fromFocus[0] + along[1] * fromFocus[1] > 0) outward += 1;
  }
  // Low and slow near the landing: nothing.
  await page.waitForFunction(
    () => window.__globeLab.state().altitudeM < 100_000,
    null,
    { timeout: 240_000, polling: 500 },
  );
  await page.evaluate(() => window.__globeLab.timeFrames(3));
  const low = await page.evaluate(() => window.__globeLab.state().dust);
  // The old dust's bug: back out to 30,000 km, a clump hung over the city.
  // A placed view is a teleport: nothing.
  await applyHash(
    page,
    `${TIME}&at=46.948,7.4474&relief=0&cityWarm=0&dust=1&view=46.9,7.4,30000,0,-90`,
  );
  await page.evaluate(() => window.__globeLab.timeFrames(3));
  const out = await page.evaluate(() => window.__globeLab.state().dust);
  console.log(
    `speed dust at ${(high.altitudeM / 1000).toFixed(0)} km: focus ${focus ? focus.map((x) => x.toFixed(3)).join(",") : "none"}, ${(high.dust.speedMps / 1000).toFixed(0)} km/s, share ${high.dust.share.toFixed(2)}, opacity ${high.dust.opacity.toFixed(2)}, ${streaks.length} streaks sampled, ${outward} of ${judged} outward; low: ${low.shown}; placed out: ${out.shown}`,
  );
  expect(high.dust.shown).toBe(true);
  expect(focus).not.toBeNull();
  // Where the camera heads is where it looks (within a tenth of the screen).
  expect(Math.hypot(focus[0] - 0.5, focus[1] - 0.5)).toBeLessThan(0.1);
  expect(judged).toBeGreaterThan(20);
  expect(outward / judged).toBeGreaterThanOrEqual(0.95);
  expect(low.shown).toBe(false);
  expect(out.shown).toBe(false);
});
