/**
 * The sharp cloud map (round-3 plan 2026-10-08-2345 §18, the owner's
 * DEC-R3-13..16): a 1,024 x 512 preview with the first look, then NASA's
 * 8,192 x 4,096 map, fetched in four pieces and drawn into ONE texture on
 * the GPU, which replaces the preview for every cloud reader; its date-line
 * seam eased in the fetch script (§16); rebuilt after a context loss.
 * SwiftShader renders on the CPU: costs are ratios within one page load.
 */
import { expect, test } from "@playwright/test";

import {
  bootGlobe,
  luminance,
  meanOf,
  median,
} from "./globe-smoke-helpers.mjs";

const TIME = "time=2026-10-05T11:00:00Z";
const QUIET = `spinMs=0&turnMs=0&${TIME}&cloudDrift=0&stars=0&milkyWay=0`;
// Over the North Atlantic at 3,000 km, looking down, by day: the cloudy
// view where the owner saw the pixels (M1's view); the ground at a coarse
// error target, the clouds are what these tests read.
const ATLANTIC = `${QUIET}&view=50,-30,3000,0,-90&errorTarget=64`;
const PIECES = "**/globe-assets/equirect/clouds-8192-*.webp";

/** Holds the full map's pieces until the returned function is called. */
async function holdPieces(page) {
  let release = () => {};
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(PIECES, async (route) => {
    await held;
    await route.continue();
  });
  return release;
}

/** Waits until the cloud map's full map is `want` and no tile is pending. */
async function waitFull(page, want, timeout = 240_000) {
  await page.waitForFunction(
    (w) => {
      const s = window.__globeLab.state();
      return s.cloudMap.full === w && s.pendingTiles === 0;
    },
    want,
    { timeout },
  );
}

const cloudMapOf = (page) =>
  page.evaluate(() => window.__globeLab.state().cloudMap);

/**
 * Box means of luminance: a grid of boxes of `box` canvas pixels over the
 * middle of the screen, each the mean of 5 x 5 samples.
 */
async function boxMeans(page, box) {
  const { w, h } = await page.evaluate(() => {
    const c = document.getElementById("globe-canvas");
    return { w: c.width, h: c.height };
  });
  const pts = [];
  const cols = Math.floor((w * 0.6) / box);
  const rows = Math.floor((h * 0.6) / box);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      for (let b = 0; b < 5; b++) {
        for (let a = 0; a < 5; a++) {
          const x = w * 0.2 + i * box + ((a + 0.5) * box) / 5;
          const y = h * 0.2 + j * box + ((b + 0.5) * box) / 5;
          pts.push([x / w, y / h]);
        }
      }
    }
  }
  const lum = (
    await page.evaluate((p) => window.__globeLab.readPixels(p), pts)
  ).map(luminance);
  const means = [];
  for (let k = 0; k < cols * rows; k++) {
    means.push(meanOf(lum.slice(k * 25, (k + 1) * 25)));
  }
  return { means, cols, rows };
}

const spreadOf = (values) => {
  const m = meanOf(values);
  return Math.sqrt(meanOf(values.map((v) => (v - m) ** 2)));
};

// WHY (DEC-R3-15): the preview must come first and alone (the pieces held
// back here show it is a stage of its own, not a race), then the GPU must
// hold ONE 8,192 x 4,096 one-channel map; and that map must draw the SAME
// clouds as the preview, only sharper: averaged over boxes larger than a
// preview texel (about 18 px here) the two agree, while the same boxes
// one box apart do not. A piece in the wrong quadrant, flipped, or drawn
// from the wrong rows would break the agreement. Box sizes swept (20, 40,
// 80 px). Two quadrants, so two different pieces are checked (M1b review,
// item 6c): the North Atlantic (piece 0-0, the north-west) and the
// southern Indian Ocean (piece 1-1, the south-east, by day at 11:00 UTC).
// The frame cost after the swap against before is logged, as a ratio
// within one page load.
const PLACES = [
  { name: "north-west, the Atlantic", view: ATLANTIC },
  {
    name: "south-east, the Indian Ocean",
    view: `${QUIET}&view=-45,60,3000,0,-90&errorTarget=64`,
  },
];
for (const place of PLACES) {
  test(`the preview first, then ONE 8192 x 4096 map that draws the same clouds, sharper (${place.name})`, async ({
    page,
  }) => {
    test.setTimeout(600_000);
    const release = await holdPieces(page);
    // Every frame's length and the cloud map's state at its end, to see the
    // allocation's frame and each piece's against the frames around them.
    await page.addInitScript(() => {
      window.__cloudFrames = [];
      let last = performance.now();
      const tick = (t) => {
        const m = window.__globeLab?.ready
          ? window.__globeLab.state().cloudMap
          : null;
        window.__cloudFrames.push({
          ms: t - last,
          full: m?.full ?? null,
          allocated: m?.allocated ?? false,
          drawn: m?.piecesDrawn ?? 0,
        });
        last = t;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const errors = await bootGlobe(page, place.view, { phase: "user" });
    await waitFull(page, "loading");
    const preview = await cloudMapOf(page);
    expect(preview).toMatchObject({
      stage: "preview",
      preview: "in",
      width: 1024,
      height: 512,
      red: true,
    });
    await page.evaluate(() => window.__globeLab.timeFrames(3));
    const sizes = [20, 40, 80];
    const before = {};
    for (const box of sizes) before[box] = await boxMeans(page, box);
    const frameMs = async () => {
      const ms = [];
      for (let i = 0; i < 3; i++) {
        ms.push(await page.evaluate(() => window.__globeLab.timeFrames(6) / 6));
      }
      return median(ms);
    };
    const previewMs = await frameMs();
    release();
    await waitFull(page, "in");
    const full = await cloudMapOf(page);
    expect(full).toMatchObject({
      stage: "full",
      full: "in",
      width: 8192,
      height: 4096,
      red: true,
      piecesFailed: 0,
      rebuilds: 0,
    });
    const fullMs = await frameMs();
    // The frame that allocated the map and the four that drew a piece each
    // (the last also builds the mipmaps), against the plain frames while
    // the pieces were held: absolute ms as well as ratios (a ratio of an
    // emulated frame cannot bound the phone's 50 ms rule; neither can the
    // absolute SwiftShader ms, but they show what the step adds).
    const built = await page.evaluate(() => {
      const f = window.__cloudFrames;
      const alloc = f.findIndex(
        (x, i) => i > 0 && x.allocated && !f[i - 1].allocated,
      );
      const draws = f
        .map((x, i) => ({ ...x, i }))
        .filter((x) => x.i > 0 && x.drawn > f[x.i - 1].drawn)
        .map((x) => x.ms);
      const plain = f
        .slice(alloc + 1)
        .filter((x) => x.full === "loading" && x.drawn === 0)
        .map((x) => x.ms);
      return { alloc: alloc > 0 ? f[alloc].ms : null, draws, plain };
    });
    const base = median(built.plain);
    const show = (ms) => `${ms?.toFixed(0)} ms (x${(ms / base).toFixed(2)})`;
    const lines = [];
    const results = [];
    for (const box of sizes) {
      const after = await boxMeans(page, box);
      const a = before[box].means;
      const b = after.means;
      const diff = meanOf(a.map((v, i) => Math.abs(v - b[i])));
      // The signed mean: a bias (the shading is not linear in the coverage,
      // so a coarse map averaged before it reads brighter or darker than a
      // sharp one averaged after it) has one sign; a misplaced piece has none.
      const bias = meanOf(a.map((v, i) => b[i] - v));
      // The control: the same boxes one box to the east.
      const shifted = [];
      for (let k = 0; k < b.length; k++) {
        if ((k + 1) % after.cols !== 0) shifted.push(Math.abs(a[k] - b[k + 1]));
      }
      const control = meanOf(shifted);
      const spread = spreadOf(b);
      results.push({ box, diff, control, spread });
      lines.push(
        `${box} px: |preview - full| ${diff.toFixed(2)} (full - preview ${bias.toFixed(2)}), one box apart ${control.toFixed(2)}, spread ${spread.toFixed(1)} (${b.length} boxes)`,
      );
    }
    console.log(
      `cloud map 8k (${place.name}): ${lines.join(" | ")}; frame x${(fullMs / previewMs).toFixed(2)} after the swap; the allocation's frame ${show(built.alloc)}, the pieces' ${built.draws.map(show).join(", ")} against ${built.plain.length} plain frames (median ${base.toFixed(0)} ms, SwiftShader); full at ${full.fullAtMs?.toFixed(0)} ms (the pieces held)`,
    );
    expect(errors).toEqual([]);
    for (const r of results) {
      expect(r.spread, `${r.box} px has clouds`).toBeGreaterThan(10);
      expect(r.diff, `${r.box} px`).toBeLessThan(r.control / 2);
      expect(r.diff, `${r.box} px`).toBeLessThan(r.spread / 3);
    }
  });
}

// WHY (M1b review, item 5): a device whose largest texture is 4,096 to
// 8,191 joins the same four pieces decoded at half size into a 4,096 x
// 2,048 map (zero extra bytes) instead of keeping the 1,024 preview. The
// page is told its largest texture is 4,096 (getParameter answered before
// three reads it); the half map must draw the preview's clouds, sharper,
// as the full one does (boxes of 40 px, against the same boxes one box
// apart).
test("a device that holds only 4096 joins the same pieces at half size", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await page.addInitScript(() => {
    const MAX_TEXTURE_SIZE = 0x0d33;
    const real = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (name) {
      return name === MAX_TEXTURE_SIZE ? 4096 : real.call(this, name);
    };
  });
  const release = await holdPieces(page);
  const errors = await bootGlobe(page, ATLANTIC, { phase: "user" });
  await waitFull(page, "loading");
  await page.evaluate(() => window.__globeLab.timeFrames(3));
  const before = await boxMeans(page, 40);
  release();
  await waitFull(page, "in");
  const half = await cloudMapOf(page);
  const after = await boxMeans(page, 40);
  const diff = meanOf(before.means.map((v, i) => Math.abs(v - after.means[i])));
  const shifted = [];
  for (let k = 0; k < after.means.length; k++) {
    if ((k + 1) % after.cols !== 0) {
      shifted.push(Math.abs(before.means[k] - after.means[k + 1]));
    }
  }
  const control = meanOf(shifted);
  const spread = spreadOf(after.means);
  console.log(
    `half map: ${JSON.stringify(half)}; |preview - half| ${diff.toFixed(2)}, one box apart ${control.toFixed(2)}, spread ${spread.toFixed(1)}`,
  );
  expect(half).toMatchObject({
    stage: "full",
    full: "in",
    scale: 0.5,
    width: 4096,
    height: 2048,
    red: true,
  });
  expect(errors).toEqual([]);
  expect(spread).toBeGreaterThan(10);
  expect(diff).toBeLessThan(control / 2);
  expect(diff).toBeLessThan(spread / 3);
});

// WHY (§16): NASA's map does not wrap, and the globe drew a line down the
// date line. Looking straight down on the map's own date line (the clouds'
// drift offset taken into account) from 1,500 km, where a texel of the
// full map is about 3 px, the mean jump between the two columns of pixels
// either side of it, over 200 rows, must be no larger than the median
// jump between neighbouring columns around it, at each of three
// latitudes. Measured 2026-10-09: the eased map x0.57 / x0.73 / x0.82 of
// the median (lat -20 / 0 / 20); the same view with the pieces served
// UNEASED (a one-time control, the source cut as it comes) x1.23 / x2.38 /
// x1.34, so the measure fails on the seam the owner would have seen.
// Logged against x1.0, x1.2 and x1.5. By day there (00:00 UTC): at the
// other tests' 11:00 the date line is in the night and every jump reads 0.
const PACIFIC_NOON = QUIET.replace(TIME, "time=2026-10-05T00:00:00Z");
test("no seam where the cloud map wraps", async ({ page }) => {
  test.setTimeout(600_000);
  // The map's date line in the world: where the drifted map's u is 0.
  const probe = await bootGlobe(page, `${PACIFIC_NOON}&view=0,180,1500,0,-90`, {
    phase: "user",
  });
  expect(probe).toEqual([]);
  const offsetDeg = await page.evaluate(
    () => (window.__globeLab.state().cloudLonOffsetRad * 180) / Math.PI,
  );
  const seamLng = ((((-180 + offsetDeg + 180) % 360) + 360) % 360) - 180;
  const rows = [];
  for (const lat of [-20, 0, 20]) {
    const errors = await bootGlobe(
      page,
      `${PACIFIC_NOON}&view=${lat},${seamLng.toFixed(4)},1500,0,-90&errorTarget=64`,
      { phase: "user" },
    );
    await waitFull(page, "in");
    const { w, h } = await page.evaluate(() => {
      const c = document.getElementById("globe-canvas");
      return { w: c.width, h: c.height };
    });
    const [u] = await page.evaluate(
      ([a, b]) => window.__globeLab.project(a, b),
      [lat, seamLng],
    );
    const seamX = Math.round(u * w);
    const span = 30;
    const pts = [];
    for (let r = 0; r < 200; r++) {
      const y = h / 2 - 100 + r + 0.5;
      for (let i = -span; i <= span; i++) {
        pts.push([(seamX + i + 0.5) / w, y / h]);
      }
    }
    const lum = (
      await page.evaluate((p) => window.__globeLab.readPixels(p), pts)
    ).map(luminance);
    const width = 2 * span + 1;
    const pairMeans = [];
    for (let i = 0; i < width - 1; i++) {
      let sum = 0;
      for (let r = 0; r < 200; r++) {
        sum += Math.abs(lum[r * width + i + 1] - lum[r * width + i]);
      }
      pairMeans.push(sum / 200);
    }
    // The pair straddling the seam: pixel centres either side of seamX.
    const at = span - 1;
    const seam = Math.max(pairMeans[at], pairMeans[at + 1]);
    const others = pairMeans.filter((_, i) => Math.abs(i - at) > 3);
    rows.push({
      lat,
      seam,
      typical: median(others),
      largest: Math.max(...others),
      errors,
    });
  }
  console.log(
    `cloud map wrap at ${seamLng.toFixed(2)}: ${rows.map((r) => `lat ${r.lat} seam ${r.seam.toFixed(2)}, typical ${r.typical.toFixed(2)} (x${(r.seam / r.typical).toFixed(2)}), largest ${r.largest.toFixed(2)}`).join("; ")}; ${[1, 1.2, 1.5].map((k) => `x${k} ${rows.every((r) => r.seam <= k * r.typical) ? "ok" : "NO"}`).join(" ")}`,
  );
  for (const r of rows) {
    expect(r.errors).toEqual([]);
    expect(r.typical, `lat ${r.lat} has clouds to compare`).toBeGreaterThan(
      0.5,
    );
    expect(r.seam, `lat ${r.lat}`).toBeLessThanOrEqual(r.typical);
  }
});

// WHY (DEC-R3-15): the first look waits for the preview only. With the
// pieces held back, the first look must still show within its 3 s, on the
// preview, clouded (its images are the level 0 halves and the preview).
// The page and the measure are globe-first-look.smoke.spec.mjs's (the 3 s
// counts from the lab's first ready frame, so a lighter page, e.g. one
// without the relief, starts the clock before the first frames' shader
// compiles and reads seconds more: measured 5.4 s with relief=0, the
// images decoded only once those frames were done).
test("the first look shows within 3 s on the preview, the pieces held back", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const release = await holdPieces(page);
  await page.addInitScript(() => {
    window.__firstLook = [];
    const t0 = performance.now();
    const tick = () => {
      const lab = window.__globeLab;
      if (lab?.ready && !lab.error) {
        const s = lab.state();
        window.__firstLook.push({
          t: performance.now(),
          shown: s.firstLook?.shown ?? false,
          stage: s.cloudMap.stage,
          preview: s.cloudMap.preview,
        });
      }
      if (performance.now() - t0 < 15_000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto(
    `/labs/globe/#spinMs=0&turnMs=0&${TIME}&stars=0&milkyWay=0&cloudVolume=0&at=46.9,7.4`,
  );
  await page.waitForFunction(() => performance.now() > 15_500, null, {
    timeout: 120_000,
  });
  const frames = await page.evaluate(() => window.__firstLook);
  const shown = frames.filter((f) => f.shown);
  const waitMs = (shown[0]?.t ?? Infinity) - (frames[0]?.t ?? 0);
  console.log(
    `first look on the preview: the first after ${waitMs.toFixed(0)} ms, ${shown.length} frames shown, stages ${[...new Set(shown.map((f) => f.stage))].join(",")}`,
  );
  release();
  expect(shown.length).toBeGreaterThan(0);
  expect(waitMs).toBeLessThan(3_000);
  expect(shown[0].preview).toBe("in");
  for (const f of shown) expect(f.stage).toBe("preview");
});

// WHY (DEC-R3-16): the full map is built from pieces the page has freed,
// so three cannot re-upload it after a context loss (phones lose the
// context when a page is backgrounded): the preview must show at once,
// and the map must be rebuilt from the pieces once the context is back,
// drawing what it drew before, with no console error on the way. The
// time from the page's start to the full map is logged.
test("a context loss shows the preview, and the restore rebuilds the full map", async ({
  page,
}) => {
  test.setTimeout(600_000);
  const errors = await bootGlobe(page, ATLANTIC, { phase: "user" });
  await waitFull(page, "in");
  const first = await cloudMapOf(page);
  await page.evaluate(() => window.__globeLab.timeFrames(3));
  const before = await boxMeans(page, 40);
  await page.evaluate(() => {
    const gl = document.getElementById("globe-canvas").getContext("webgl2");
    window.__loseContext = gl.getExtension("WEBGL_lose_context");
    window.__loseContext.loseContext();
  });
  await page.waitForFunction(
    () => window.__globeLab.state().cloudMap.full === "lost",
    null,
    { timeout: 60_000 },
  );
  const lost = await cloudMapOf(page);
  await page.evaluate(() => window.__loseContext.restoreContext());
  await waitFull(page, "in");
  const rebuilt = await cloudMapOf(page);
  await page.evaluate(() => window.__globeLab.timeFrames(3));
  const after = await boxMeans(page, 40);
  const diff = meanOf(before.means.map((v, i) => Math.abs(v - after.means[i])));
  console.log(
    `context loss: full at ${first.fullAtMs?.toFixed(0)} ms from the page's start; while lost ${JSON.stringify(lost)}; rebuilt ${JSON.stringify(rebuilt)}; |before - after| ${diff.toFixed(2)} over ${before.means.length} boxes, spread ${spreadOf(after.means).toFixed(1)}`,
  );
  expect(lost).toMatchObject({ stage: "preview", full: "lost" });
  expect(rebuilt).toMatchObject({
    stage: "full",
    full: "in",
    width: 8192,
    height: 4096,
    rebuilds: 1,
  });
  expect(diff).toBeLessThan(2);
  expect(errors).toEqual([]);
});

// WHY (the async-feedback rule; DEC-R3-15; M1b review, items 4 and 6a): a
// piece that cannot load, after its two retries, must leave the preview
// drawn where that piece would be (never a hole or a cloudless quarter),
// end the loading label, and say so in the error box, without counting
// the clouds as a map that failed. The failed piece is the view's own
// (0-0, the north-west), and the view must show the PREVIEW's clouds:
// box means equal to a page whose pieces are held back (a cloudless or
// half-drawn quarter would differ by the clouds' spread, about 35).
test("a piece that fails keeps the preview's clouds where it would be, and says so", async ({
  page,
  browser,
}) => {
  test.setTimeout(400_000);
  await page.route("**/globe-assets/equirect/clouds-8192-0-0.webp", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  const errors = await bootGlobe(page, ATLANTIC, { phase: "user" });
  await waitFull(page, "failed");
  const state = await page.evaluate(() => window.__globeLab.state());
  expect(state.cloudMap).toMatchObject({
    stage: "preview",
    width: 1024,
    full: "failed",
    piecesFailed: 1,
    retries: 2,
    piecesHeld: 0,
    allocated: false,
  });
  expect([state.mapsLoaded, state.mapErrors]).toEqual([state.mapsTotal, 0]);
  await expect(page.locator("#globe-error")).toContainText(
    "The sharp cloud map could not load: the coarser one shows.",
  );
  await expect(page.locator("#globe-loading")).toBeHidden();
  await page.evaluate(() => window.__globeLab.timeFrames(3));
  const failed = await boxMeans(page, 40);
  // The reference: the same view with every piece held back.
  const other = await browser.newPage();
  const release = await holdPieces(other);
  const otherErrors = await bootGlobe(other, ATLANTIC, { phase: "user" });
  await waitFull(other, "loading");
  await other.evaluate(() => window.__globeLab.timeFrames(3));
  const preview = await boxMeans(other, 40);
  release();
  await other.close();
  const diff = meanOf(
    failed.means.map((v, i) => Math.abs(v - preview.means[i])),
  );
  const spread = spreadOf(preview.means);
  console.log(
    `failed piece: ${JSON.stringify(state.cloudMap)}; |failed - preview| ${diff.toFixed(2)} over ${failed.means.length} boxes, the preview's spread ${spread.toFixed(1)}`,
  );
  expect(spread).toBeGreaterThan(10);
  expect(diff).toBeLessThan(1);
  expect(errors.filter((t) => !/404|Failed to load resource/.test(t))).toEqual(
    [],
  );
  expect(otherErrors).toEqual([]);
});
