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

/**
 * Rows of whole pixels across the middle of the screen: each row's
 * luminance, one value a pixel.
 */
async function readRows(page, rows) {
  const width = await page.evaluate(
    () => document.querySelector("canvas").width,
  );
  const pts = [];
  for (const v of rows) {
    for (let x = Math.floor(width * 0.2); x < Math.floor(width * 0.8); x++) {
      pts.push([(x + 0.5) / width, v]);
    }
  }
  const px = await page.evaluate((p) => window.__globeLab.readPixels(p), pts);
  const per = px.length / rows.length;
  return rows.map((_, r) => px.slice(r * per, (r + 1) * per).map(luminance));
}

/**
 * How the row's bending is spread, over the pixels where `mask` (the
 * bilinear read's rows) is brighter than `floor` at the pixel and both
 * neighbours (under the clouds, so the ground's own magnified imagery does
 * not decide it). A bilinear read is straight inside a texel and kinks at
 * its edges: its second differences are spikes, the grid the owner saw. A
 * smooth read bends a little at every pixel instead. Their total is about
 * the same (the slope's total change), so the measure is how peaked they
 * are: mean(d2^2) / mean(|d2|)^2, 1 for an even bend, high for spikes.
 * `ratio` (mean |d2| / mean |d1|) is logged beside it, not asserted: a
 * smooth read lowers d1 while the 8-bit floor in d2 stays, so it rises.
 */
function kinkiness(rows, mask, floor) {
  let d1 = 0;
  let d2 = 0;
  let d2sq = 0;
  let n = 0;
  rows.forEach((row, r) => {
    const m = mask[r];
    for (let i = 1; i < row.length - 1; i++) {
      if (Math.min(m[i - 1], m[i], m[i + 1]) <= floor) continue;
      const bend = row[i + 1] - 2 * row[i] + row[i - 1];
      d1 += Math.abs(row[i + 1] - row[i]);
      d2 += Math.abs(bend);
      d2sq += bend * bend;
      n += 1;
    }
  });
  const meanD2 = d2 / Math.max(n, 1);
  return {
    kink: d2sq / Math.max(n, 1) / Math.max(meanD2 * meanD2, 1e-9),
    ratio: d2 / Math.max(d1, 1e-9),
    n,
  };
}

const spreadOf = (rows) => {
  const all = rows.flat();
  const mean = meanOf(all);
  return Math.sqrt(meanOf(all.map((l) => (l - mean) ** 2)));
};

// WHY: the owner's report itself. Over the clouds, the clouds read through
// the B-spline must bend in fewer spikes than the bilinear read where the
// map is magnified (1,500 and 3,000 km: measured x0.87-0.91 at every
// brightness floor, 2026-10-09), and keep the clouds' contrast (the spread
// of the same rows), so the fix smooths the grid, not the clouds. The
// brightness floor that picks "under the clouds" is swept (120, 150, 180:
// a one-value verdict is provisional). 1,000 km (this 1280-pixel view's
// match for the owner's phone at 3,000 km) measured no difference (x0.97
// to x1.00: both reads are barely peaked there), and at 6,000 km a texel
// is about a pixel: both logged, not asserted.
test("the clouds through the B-spline show less of the texel grid where the map is magnified, and keep their contrast", async ({
  page,
}) => {
  test.setTimeout(900_000);
  const rows = [0.4, 0.45, 0.5, 0.55, 0.6];
  const floors = [120, 150, 180];
  const lines = [];
  const results = [];
  for (const km of [1000, 1500, 3000, 6000]) {
    const view = `spinMs=0&turnMs=0&${TIME}&cloudDrift=0&stars=0&milkyWay=0&view=50,-30,${km},0,-90&errorTarget=64`;
    const lum = {};
    for (const cubic of [0, 1]) {
      const errors = await bootGlobe(page, `${view}&cloudCubic=${cubic}`, {
        phase: "user",
      });
      expect(errors).toEqual([]);
      await page.waitForFunction(
        () => {
          const s = window.__globeLab.state();
          return (
            s.mapsLoaded + s.mapErrors === s.mapsTotal && s.pendingTiles === 0
          );
        },
        null,
        { timeout: 120_000 },
      );
      await page.evaluate(() => window.__globeLab.timeFrames(3));
      lum[cubic] = await readRows(page, rows);
    }
    const byFloor = floors.map((floor) => ({
      floor,
      bilinear: kinkiness(lum[0], lum[0], floor),
      cubic: kinkiness(lum[1], lum[0], floor),
    }));
    const spread = [spreadOf(lum[0]), spreadOf(lum[1])];
    results.push({ km, byFloor, spread });
    lines.push(
      `${km} km: ${byFloor.map((b) => `over ${b.floor}: ${b.bilinear.kink.toFixed(3)} -> ${b.cubic.kink.toFixed(3)} (x${(b.cubic.kink / b.bilinear.kink).toFixed(2)}; d2/d1 ${b.bilinear.ratio.toFixed(2)} -> ${b.cubic.ratio.toFixed(2)}; ${b.bilinear.n} px)`).join(", ")}; spread ${spread[0].toFixed(1)} / ${spread[1].toFixed(1)}`,
    );
  }
  console.log(`cloud map sampling: ${lines.join("; ")}`);
  for (const r of results) {
    expect(r.spread[0], `${r.km} km has clouds`).toBeGreaterThan(10);
    expect(r.spread[1] / r.spread[0], `${r.km} km`).toBeGreaterThan(0.9);
    if (r.km < 1500 || r.km > 3000) continue;
    for (const b of r.byFloor) {
      if (b.bilinear.n < 200) continue;
      expect(b.cubic.kink, `${r.km} km over ${b.floor}`).toBeLessThan(
        b.bilinear.kink,
      );
    }
  }
});
