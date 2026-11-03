// @ts-check
import { expect, test } from "@playwright/test";

import { encodeRgbPng } from "../../scripts/e2e/terrarium-png.mjs";
import {
  afterFrames,
  answerHosts,
  keepRejections,
  noApproach,
  rejections,
  reliefCarries,
  view3d,
} from "./editor3d-fixture.js";

/**
 * Why this test matters: the street map is drawn over the relief near the
 * camera and fades out farther away, and where it ends the eye sees the
 * step from the map's bright paper to the darker ground. The map's gain
 * (`?osmGain=`, the editor's default 0.55) compresses the map's brightness
 * before the blend so that step is smaller. At the fade's edge the map
 * goes from full strength to none, so the step there is the ratio of the
 * ground's brightness with the map at full strength to the same ground
 * bare: this test measures that ratio on the real page, at the same spot
 * and the same view, once without the map, once at gain 1 (no
 * compression) and at each gain under test. It pins that the link's gain
 * reaches the drawn map (a lower gain draws it darker) and that the
 * default lowers the step against no compression. The map tile is drawn
 * like the street map (`OSM_LIKE_TILE`): mostly its land colour, so the
 * ratios carry over to the real map, with white roads and dark names. The
 * gain's mode (`?osmGainMode=`) decides what becomes of those: the flat
 * multiply (the editor's default) keeps the road's and the name's contrast
 * against the land as the map has them at gain 1, the luma compression
 * (the A/B) lowers both; the contrasts are read as luma ratios between
 * the patch's percentiles (the names' at the 15th, inside the text band's
 * core, the land's at the median, the roads' at the 90th). Measured
 * 2026-11-03 (deciles of the patch): the 5th percentile sits in the dark
 * edges' tail and the 97th in the tone mapping's clipped white, both
 * blind to the gain. Land over the 10th and 20th percentiles: gain 1
 * 6.5 and 5.4, flat 0.55 6.5 and 5.7, compress 0.55 6.0 and 4.5; road
 * (90th) over land: 1.026, 1.072 (the road no longer clipped) and 1.037.
 *
 * Extra gains for a measurement: `OSM_GAIN_SWEEP=0.45,0.5,0.6,0.7`.
 */

/** OpenStreetMap's standard style: the land, a road, a name's text. */
const LAND = [242, 239, 233];
const ROAD = [255, 255, 255];
const TEXT = [51, 51, 51];

/**
 * A 256 px tile like the street map's, in stripes of 64 px (about 13 m at
 * the tour's zoom, wide enough to survive the texture's filtering): 36
 * rows of land, 16 of road, 12 of text.
 */
const OSM_LIKE_TILE = (() => {
  /** @type {number[]} */
  const rgb = [];
  for (let row = 0; row < 256; row++) {
    const band = row % 64;
    const colour = band < 36 ? LAND : band < 52 ? ROAD : TEXT;
    for (let col = 0; col < 256; col++) rgb.push(...colour);
  }
  return encodeRgbPng(256, 256, rgb);
})();

/** The phone's width, as the hold test: the editor's phone budget. */
const PHONE = { width: 390, height: 844 };

/** The gains measured, the default first after no compression. */
const GAINS = [
  1,
  0.55,
  ...(process.env["OSM_GAIN_SWEEP"] ?? "")
    .split(",")
    .map(Number)
    .filter((g) => g > 0 && g <= 1 && g !== 1 && g !== 0.55),
];

/**
 * The luma's (Rec. 709, 0-255) 15th percentile, median and 90th percentile
 * over the canvas's middle fifth, read from a screenshot (a
 * software-drawn WebGL keeps no drawing buffer to read back). The median
 * ignores the stations' markers in the patch.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<{ p15: number; p50: number; p90: number; deciles: number[] }>}
 */
async function middleLumas(page) {
  const box = await page.locator("#view3d canvas").boundingBox();
  if (box === null) throw new Error("no canvas");
  const png = await page.screenshot({
    clip: {
      x: box.x + box.width * 0.4,
      y: box.y + box.height * 0.4,
      width: box.width * 0.2,
      height: box.height * 0.2,
    },
  });
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(
      new Blob([bytes], { type: "image/png" }),
    );
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2d context");
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    /** @type {number[]} */
    const lumas = [];
    for (let i = 0; i < data.length; i += 4) {
      lumas.push(
        0.2126 * (data[i] ?? 0) +
          0.7152 * (data[i + 1] ?? 0) +
          0.0722 * (data[i + 2] ?? 0),
      );
    }
    lumas.sort((a, b) => a - b);
    /** @param {number} q */
    const at = (q) => lumas[Math.floor((lumas.length - 1) * q)] ?? 0;
    return {
      p15: at(0.15),
      p50: at(0.5),
      p90: at(0.9),
      deciles: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map((q) =>
        Math.round(at(q)),
      ),
    };
  }, png.toString("base64"));
}

/**
 * The middle's lumas on a fresh page: with the map at `gain` in `mode`,
 * or bare (the map's tiles refused, so none is drawn), after the relief
 * carries the ground and, with the map, every near tile has it.
 * @param {import("@playwright/test").Browser} browser
 * @param {number | "bare"} gain
 * @param {"flat" | "compress"} [mode]
 */
async function lumasWith(browser, gain, mode = "flat") {
  const page = await browser.newPage({ viewport: PHONE });
  try {
    await answerHosts(page, { globeAssets: "serve" });
    await keepRejections(page);
    await noApproach(page);
    // Matched before `answerHosts`' plain tile (routes added later go first).
    await page.route("https://tile.openstreetmap.org/**", (route) =>
      gain === "bare"
        ? route.fulfill({ status: 404, body: "Not Found" })
        : route.fulfill({
            status: 200,
            contentType: "image/png",
            body: OSM_LIKE_TILE,
          }),
    );
    await page.goto(
      `/edit.html?globe=1&osmGain=${gain === "bare" ? 1 : gain}&osmGainMode=${mode}`,
    );
    await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
    await page.locator("#sample-btn").click();
    await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
      timeout: 120_000,
    });
    // The heavy clouds off, as in the other globe tests.
    await expect
      .poll(async () => (await view3d(page))?.globe?.air?.clouds?.on)
      .toBe(true);
    await page.locator("#view-menu-btn").click();
    await page.locator("#view-clouds").click();
    await page.keyboard.press("Escape");
    await reliefCarries(page);
    await page.evaluate(() =>
      /** @type {any} */ (window).__tourEditor.view3dDistance(150),
    );
    if (gain !== "bare") {
      await expect
        .poll(
          async () => {
            const osm = (await view3d(page))?.osm;
            const c = osm?.coverage;
            return (
              osm?.active === true &&
              osm?.on === 1 &&
              c.near > 0 &&
              c.withMap > 0 &&
              c.withMap + c.coarse === c.near
            );
          },
          { timeout: 120_000, intervals: [1_000] },
        )
        .toBe(true);
    }
    // The map's switch ramps and the move settles over a few frames.
    await afterFrames(page, 20);
    const lumas = await middleLumas(page);
    expect(await rejections(page)).toEqual([]);
    return lumas;
  } finally {
    await page.close();
  }
}

test("the street map's gain lowers the brightness step at the fade's edge", async ({
  browser,
}, testInfo) => {
  // A fresh page per reading: each loads the relief (up to 400 frames,
  // `reliefCarries`) and the map.
  test.setTimeout(420_000 * (GAINS.length + 2));
  const round = (/** @type {number} */ x) => Math.round(x * 1000) / 1000;
  /** @param {{ p15: number; p50: number; p90: number; deciles: number[] }} l */
  const contrasts = (l) => ({
    roadLand: round(l.p90 / Math.max(l.p50, 1)),
    landText: round(l.p50 / Math.max(l.p15, 1)),
    deciles: l.deciles,
  });
  const bare = (await lumasWith(browser, "bare")).p50;
  /** @type {Record<string, number>} */
  const ratios = {};
  /** @type {Record<string, number>} */
  const lumas = { bare };
  /** @type {Record<string, { roadLand: number; landText: number; deciles: number[] }>} */
  const contrast = {};
  for (const gain of GAINS) {
    const l = await lumasWith(browser, gain);
    lumas[gain] = l.p50;
    ratios[gain] = Math.round((l.p50 / bare) * 100) / 100;
    contrast[gain] = contrasts(l);
  }
  const compressed = await lumasWith(browser, 0.55, "compress");
  contrast["0.55 compress"] = contrasts(compressed);
  const reading = JSON.stringify({
    lumas,
    ratios,
    contrast,
    compressed: compressed.p50,
  });
  testInfo.annotations.push({
    type: "osm gain readings",
    description: reading,
  });
  console.log(`osm gain readings ${reading}`);

  // Not vacuous: the bare ground is drawn, and the map over it.
  expect(bare).toBeGreaterThan(5);
  expect(lumas[1]).not.toBeCloseTo(bare, 0);
  // The default draws the map darker than no compression: the gain
  // reaches the drawn map, and the step at the fade's edge is smaller.
  expect(lumas[0.55]).toBeLessThan((lumas[1] ?? 0) - 5);
  expect(Math.abs((ratios[0.55] ?? 0) - 1)).toBeLessThan(
    Math.abs((ratios[1] ?? 0) - 1),
  );
  // The flat multiply keeps the map's contrasts as at gain 1 (the road's
  // even rises: at gain 1 the tone mapping clips it); the compression
  // lowers both against the flat multiply.
  const one = contrast[1] ?? { roadLand: 0, landText: 0 };
  const flat = contrast[0.55] ?? { roadLand: 0, landText: 0 };
  const squeezed = contrast["0.55 compress"] ?? { roadLand: 0, landText: 0 };
  expect(one.landText).toBeGreaterThan(1.5);
  expect(flat.roadLand).toBeGreaterThan(one.roadLand - 0.01);
  expect(flat.landText / one.landText).toBeGreaterThan(0.9);
  expect(squeezed.roadLand).toBeLessThan(flat.roadLand - 0.01);
  expect(squeezed.landText).toBeLessThan(flat.landText * 0.93);
  // A lower gain is never brighter, across the gains measured.
  const sorted = [...GAINS].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    expect(lumas[sorted[i - 1] ?? 0]).toBeLessThanOrEqual(
      (lumas[sorted[i] ?? 0] ?? 0) + 1,
    );
  }
});
