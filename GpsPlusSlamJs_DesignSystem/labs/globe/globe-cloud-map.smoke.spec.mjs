/**
 * The cloud map (round-3 plan 2026-10-08-2345 M1; the owner on r805: the
 * clouds "pixelated already at 3,000 km"). The map is 4,096 x 2,048, sent
 * to the GPU as one channel, and decoded off the main thread where the
 * browser can.
 */
import { expect, test } from "@playwright/test";

import {
  applyHash,
  bootGlobe,
  luminance,
  meanOf,
  median,
} from "./globe-smoke-helpers.mjs";

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
 * Lines of whole pixels across the middle of the screen, one luminance a
 * pixel: `rows` (east-west here, along the texels' short side at 50 N)
 * and `columns` (north-south, along their long side, where a texel spans
 * the most pixels).
 */
async function readLines(page) {
  const { width, height } = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    return { width: c.width, height: c.height };
  });
  const across = [0.4, 0.45, 0.5, 0.55, 0.6];
  const pts = [];
  for (const v of across) {
    for (let x = Math.floor(width * 0.2); x < Math.floor(width * 0.8); x++) {
      pts.push([(x + 0.5) / width, v]);
    }
  }
  const rowLength = pts.length / across.length;
  for (const u of across) {
    for (let y = Math.floor(height * 0.2); y < Math.floor(height * 0.8); y++) {
      pts.push([u, (y + 0.5) / height]);
    }
  }
  const px = (
    await page.evaluate((p) => window.__globeLab.readPixels(p), pts)
  ).map(luminance);
  const cut = (from, length) =>
    across.map((_, i) => px.slice(from + i * length, from + (i + 1) * length));
  const colStart = rowLength * across.length;
  return {
    rows: cut(0, rowLength),
    columns: cut(colStart, (px.length - colStart) / across.length),
  };
}

/**
 * How the lines' bending is spread, over the pixels where `mask` (the
 * bilinear read's lines) is brighter than `floor` at the pixel and both
 * neighbours (over the clouds, so the ground's own magnified imagery does
 * not decide it). A bilinear read is straight inside a texel and kinks at
 * its edges: its second differences are spikes, the grid the owner saw. A
 * smooth read bends a little at every pixel instead. Their total is about
 * the same (the slope's total change), so the measure is how peaked they
 * are: mean(d2^2) / mean(|d2|)^2, 1 for an even bend, high for spikes.
 */
function kinkiness(lines, mask, floor) {
  let d2 = 0;
  let d2sq = 0;
  let n = 0;
  lines.forEach((line, r) => {
    const m = mask[r];
    for (let i = 1; i < line.length - 1; i++) {
      if (Math.min(m[i - 1], m[i], m[i + 1]) <= floor) continue;
      const bend = line[i + 1] - 2 * line[i] + line[i - 1];
      d2 += Math.abs(bend);
      d2sq += bend * bend;
      n += 1;
    }
  });
  const meanD2 = d2 / Math.max(n, 1);
  return { kink: d2sq / Math.max(n, 1) / Math.max(meanD2 * meanD2, 1e-9), n };
}

const spreadOf = (lines) => {
  const all = lines.flat();
  const mean = meanOf(all);
  return Math.sqrt(meanOf(all.map((l) => (l - mean) ** 2)));
};

/** One page's frame time with the B-spline over without it (live switch). */
async function costRatio(page, hash) {
  const ms = { 0: [], 1: [] };
  for (let round = 0; round < 3; round++) {
    for (const cubic of [0, 1]) {
      await applyHash(page, `${hash}&cloudCubic=${cubic}`);
      await page.evaluate(() => window.__globeLab.timeFrames(2));
      ms[cubic].push(
        await page.evaluate(() => window.__globeLab.timeFrames(6) / 6),
      );
    }
  }
  return median(ms[1]) / median(ms[0]);
}

// WHY: the owner's report itself (M1, re-measured after the milestone
// review's finding 3). Over the clouds, along the texels' long side
// (columns), the clouds read through the B-spline must bend in fewer
// spikes than the bilinear read wherever the map is magnified, 1,000 to
// 3,000 km (1,000 km is this 1280-pixel view's match for the owner's
// phone at 3,000 km), at every brightness floor swept (60, 100, 150: a
// one-value verdict is provisional; the low floors keep the cloud edges,
// where a staircase shows), and keep the clouds' contrast (the spread of
// the same lines). Rows (the short side) and 6,000 km (a texel about a
// pixel) are logged, not asserted. The cost is logged as a ratio within
// one page load.
test("the clouds through the B-spline show less of the texel grid where the map is magnified, and keep their contrast", async ({
  page,
}) => {
  test.setTimeout(900_000);
  const floors = [60, 100, 150];
  const lines = [];
  const results = [];
  for (const km of [1000, 1500, 3000, 6000]) {
    const view = `spinMs=0&turnMs=0&${TIME}&cloudDrift=0&stars=0&milkyWay=0&view=50,-30,${km},0,-90&errorTarget=64`;
    const errors = await bootGlobe(page, view, { phase: "user" });
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
    const read = {};
    for (const cubic of [0, 1]) {
      await applyHash(page, `${view}&cloudCubic=${cubic}`);
      await page.evaluate(() => window.__globeLab.timeFrames(3));
      read[cubic] = await readLines(page);
    }
    const cost = await costRatio(page, view);
    expect(errors).toEqual([]);
    const judge = (side) =>
      floors.map((floor) => ({
        floor,
        bilinear: kinkiness(read[0][side], read[0][side], floor),
        cubic: kinkiness(read[1][side], read[0][side], floor),
      }));
    const columns = judge("columns");
    const rows = judge("rows");
    const spread = [
      spreadOf([...read[0].rows, ...read[0].columns]),
      spreadOf([...read[1].rows, ...read[1].columns]),
    ];
    results.push({ km, columns, spread });
    const say = (side) =>
      side
        .map(
          (b) =>
            `over ${b.floor}: ${b.bilinear.kink.toFixed(2)} -> ${b.cubic.kink.toFixed(2)} (x${(b.cubic.kink / b.bilinear.kink).toFixed(2)}, ${b.bilinear.n} px)`,
        )
        .join(", ");
    lines.push(
      `${km} km: columns ${say(columns)}; rows ${say(rows)}; spread ${spread[0].toFixed(1)} / ${spread[1].toFixed(1)}; cost x${cost.toFixed(2)}`,
    );
  }
  console.log(`cloud map sampling: ${lines.join(" | ")}`);
  for (const r of results) {
    expect(r.spread[0], `${r.km} km has clouds`).toBeGreaterThan(10);
    expect(r.spread[1] / r.spread[0], `${r.km} km`).toBeGreaterThan(0.9);
    if (r.km > 3000) continue;
    for (const b of r.columns) {
      if (b.bilinear.n < 200) continue;
      expect(b.cubic.kink, `${r.km} km over ${b.floor}`).toBeLessThan(
        b.bilinear.kink,
      );
    }
  }
});

// WHY (M1 milestone review, findings 1 and 5): the volume reads the map
// through the B-spline in its march, and a relief tile's program carries
// the filter twice (the surface's and the volume shadow's): with the
// relief on, at 12 km over overcast Norway, the page must draw without a
// console error, and the B-spline's cost there is logged as a ratio
// within one page load.
test("the volume and the relief draw with the B-spline, its cost stated", async ({
  page,
}) => {
  test.setTimeout(600_000);
  const view = `spinMs=0&turnMs=0&${TIME}&cloudDrift=0&stars=0&milkyWay=0&relief=1&reliefHeights=synthetic&reliefNear=3&view=61,5.5,12,0,-20`;
  const errors = await bootGlobe(page, view, { phase: "user" });
  await page.waitForFunction(
    () => {
      const s = window.__globeLab.state();
      return (
        s.mapsLoaded === s.mapsTotal &&
        s.cloudVolume?.share > 0 &&
        s.relief?.litTiles > 0
      );
    },
    null,
    { timeout: 300_000 },
  );
  const cost = await costRatio(page, view);
  const state = await page.evaluate(() => window.__globeLab.state());
  console.log(
    `volume at 12 km: cost x${cost.toFixed(2)} with the B-spline; volume ${JSON.stringify(state.cloudVolume)}; relief lit tiles ${state.relief.litTiles}`,
  );
  expect(errors).toEqual([]);
  expect(state.cloudVolume.drawn).toBeGreaterThan(0);
});
