/**
 * The globe's first look (round-2 plan 2026-10-07-2350 DEC-FR2-6; the
 * owner: "the globe is plain blue for a second before its texture loads").
 * The tile renderer draws a tile only once its imagery is in; until then
 * there was no sphere, only the atmosphere's veil over black (measured: 7 s
 * of one blue, 29/64/115, at the globe's centre in this harness). The first
 * look, the imagery's level 0 on a sphere of its own, covers that time.
 */
import { expect, test } from "@playwright/test";

const VIEW =
  "spinMs=0&turnMs=0&time=2026-10-05T11:00:00Z&at=46.9,7.4&stars=0&milkyWay=0&cloudVolume=0";

// WHY: the first frames show the Earth, near the look the tiles then give,
// and the sphere steps aside once the globe can draw its whole view.
test("the first frames show the Earth before its imagery tiles arrive", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    window.__firstLook = [];
    const t0 = performance.now();
    const tick = () => {
      const lab = window.__globeLab;
      if (lab?.ready && !lab.error) {
        const [c] = lab.readPixels([[0.5, 0.5]]);
        const s = lab.state();
        window.__firstLook.push({
          shown: s.firstLook?.shown ?? false,
          rgb: c.slice(0, 3),
        });
      }
      if (performance.now() - t0 < 30_000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto(`/labs/globe/#${VIEW}`);
  await page.waitForFunction(() => performance.now() > 30_500, null, {
    timeout: 120_000,
  });
  const frames = await page.evaluate(() => window.__firstLook);
  const shown = frames.filter((f) => f.shown);
  const last = frames.at(-1);
  console.log(
    `first look: ${frames.length} frames, ${shown.length} with the sphere; centre ${shown[0]?.rgb.join(",")} then ${last?.rgb.join(",")}`,
  );
  expect(shown.length).toBeGreaterThan(0);
  expect(last?.shown).toBe(false);
  // Near the tiles' look (within 40 levels a channel), never the veil blue.
  for (const f of shown) {
    for (let i = 0; i < 3; i++) {
      expect(Math.abs((f.rgb[i] ?? 0) - (last?.rgb[i] ?? 0))).toBeLessThan(40);
    }
  }
});
