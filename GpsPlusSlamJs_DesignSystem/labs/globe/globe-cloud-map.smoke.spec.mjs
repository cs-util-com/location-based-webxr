/**
 * The cloud map (round-3 plan 2026-10-08-2345 M1; the owner on r805: the
 * clouds "pixelated already at 3,000 km"). The map is 4,096 x 2,048, sent
 * to the GPU as one channel, and decoded off the main thread where the
 * browser can.
 */
import { expect, test } from "@playwright/test";

import { bootGlobe, luminance, meanOf } from "./globe-smoke-helpers.mjs";

const TIME = "time=2026-10-05T11:00:00Z";
// Over the North Atlantic at 3,000 km, looking down, by day: a cloudy
// stretch where the owner saw the pixels. The ground at a coarse error
// target (6 tiles, not about 200 at a tile a second headless): the clouds
// are what these tests read.
const VIEW = "view=50,-30,3000,0,-90&errorTarget=64";
const BASE = `spinMs=0&turnMs=0&${TIME}&cloudDrift=0&stars=0&milkyWay=0&${VIEW}`;

/** A grid of normalised points over the middle of the screen. */
function grid(n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      pts.push([0.25 + (0.5 * i) / (n - 1), 0.25 + (0.5 * j) / (n - 1)]);
    }
  }
  return pts;
}

async function readView(page, hash) {
  const errors = await bootGlobe(page, hash, { phase: "user" });
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return s.mapsLoaded + s.mapErrors === s.mapsTotal && s.pendingTiles === 0;
    },
    null,
    { timeout: 120_000 },
  );
  await page.evaluate(() => window.__globeLab.timeFrames(3));
  const read = await page.evaluate((pts) => {
    const lab = window.__globeLab;
    return { px: lab.readPixels(pts), state: lab.state() };
  }, grid(24));
  return { errors, ...read };
}

// WHY: the map the owner asked to be sharper must be the one the GPU has
// (4,096 wide, not the 2,048 a stale cache or registry would give), held
// as one channel (8 MB, not 32, on a phone), and decoded off the main
// thread. And the off-thread path must draw what the image element drew:
// a decoder that ignored "flip the rows" would put every cloud on the
// other hemisphere, which pixel equality between the two paths catches
// (the grid's own spread shows the view has clouds to compare).
test("the cloud map is 4096 x 2048, one channel, decoded off the thread, and draws as the image element did", async ({
  page,
  browser,
}) => {
  test.setTimeout(400_000);
  const bitmap = await readView(page, BASE);
  const other = await browser.newPage();
  const element = await readView(other, `${BASE}&mapBitmap=0`);
  await other.close();
  const lumA = bitmap.px.map(luminance);
  const lumB = element.px.map(luminance);
  const diff = meanOf(lumA.map((l, i) => Math.abs(l - lumB[i])));
  const mean = meanOf(lumA);
  const spread = Math.sqrt(meanOf(lumA.map((l) => (l - mean) ** 2)));
  console.log(
    `cloud map: ${JSON.stringify(bitmap.state.cloudMap)} (element: ${JSON.stringify(element.state.cloudMap)}); mean |bitmap - element| ${diff.toFixed(2)} over ${lumA.length} points, the view's spread ${spread.toFixed(1)}`,
  );
  expect(bitmap.errors).toEqual([]);
  expect(element.errors).toEqual([]);
  expect(bitmap.state.cloudMap).toEqual({
    width: 4096,
    height: 2048,
    red: true,
    bitmap: true,
  });
  expect(element.state.cloudMap).toMatchObject({
    width: 4096,
    height: 2048,
    red: true,
    bitmap: false,
  });
  expect(spread).toBeGreaterThan(10);
  expect(diff).toBeLessThan(1);
});
