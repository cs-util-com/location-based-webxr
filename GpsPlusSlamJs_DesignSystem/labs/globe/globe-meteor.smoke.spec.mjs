/**
 * The meteor approach (round-3 plan 2026-10-08-2345 F1; the owner on r805:
 * "very steep, then 45 rather late; like a meteor, flat from the start, at
 * 4,000 km already flat"). A link flies a straight line through space that
 * meets its place at 45 degrees: the view, looking along the travel, tilts
 * steadily from far out, held only by the horizon floor high up.
 */
import { expect, test } from "@playwright/test";

const R = 6_371_000;
const DEG = 180 / Math.PI;
/** The line's angle below the horizontal at h for a landing l, beta 45. */
const line = (h, l) =>
  Math.acos(((R + l) * Math.cos(Math.PI / 4)) / (R + h)) * DEG;
/** The horizon floor: the dip plus 5 degrees. */
const floor = (h) => Math.acos(R / (R + h)) * DEG + 5;

// WHY: the owner's ask, measured on the flight itself: below the floor's
// reach the view follows the line (at 4,000 km about 64 degrees below the
// horizontal, against R1's straight down), and it lands at 45.
test("a link flies the meteor: the view tilts along the line and lands at 45", async ({
  page,
}) => {
  test.setTimeout(400_000);
  await page.addInitScript(() => {
    window.__meteor = [];
    const tick = () => {
      const lab = window.__globeLab;
      if (lab?.ready) {
        const s = lab.state();
        window.__meteor.push({
          h: s.altitudeM,
          d: s.cameraDepressionDeg,
          p: s.phase,
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto(
    "/labs/globe/#time=2026-10-05T11:00:00Z&at=46.948,7.4474&land=1&flight=2&relief=0&cityWarm=0",
  );
  await page.waitForFunction(
    () => window.__globeLab?.state?.().altitudeM < 2_500,
    null,
    { timeout: 300_000, polling: 500 },
  );
  await page.waitForFunction(
    () =>
      window.__globeLab.state().phase === "landed" ||
      window.__globeLab.state().altitudeM < 2_100,
    null,
    {
      timeout: 120_000,
      polling: 500,
    },
  );
  // The first frames read the camera at the Earth's centre, before it is
  // placed: only samples above the ground count.
  const samples = (await page.evaluate(() => window.__meteor)).filter(
    (x) => x.h > 0,
  );
  const landing = 2_000;
  const near = (hKm) =>
    samples.reduce((best, s) =>
      Math.abs(Math.log(s.h / (hKm * 1000))) <
      Math.abs(Math.log(best.h / (hKm * 1000)))
        ? s
        : best,
    );
  const rows = [10_000, 4_000, 1_000].map((hKm) => {
    const s = near(hKm);
    const expected = Math.max(line(s.h, landing), floor(s.h));
    return { hKm, at: s.h / 1000, d: s.d, expected };
  });
  const last = samples[samples.length - 1];
  console.log(
    `meteor: ${rows.map((r) => `${r.at.toFixed(0)} km ${r.d.toFixed(1)} deg (line/floor ${r.expected.toFixed(1)})`).join(", ")}; last ${(last.h / 1000).toFixed(1)} km ${last.d.toFixed(1)} deg`,
  );
  for (const r of rows) {
    expect(Math.abs(r.d - r.expected), `${r.hKm} km`).toBeLessThan(3);
  }
  // Flatter than R1's straight down where the owner looked.
  expect(rows[1].d).toBeLessThan(75);
  expect(last.d).toBeGreaterThan(42);
  expect(last.d).toBeLessThan(48);
});
