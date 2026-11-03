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
 * default lowers the step against no compression. The map tile is the
 * street map's land colour, so the ratios carry over to the real map.
 *
 * Extra gains for a measurement: `OSM_GAIN_SWEEP=0.45,0.5,0.6,0.7`.
 */

/** The street map's land colour (OpenStreetMap's standard style). */
const LAND_TILE = encodeRgbPng(1, 1, [242, 239, 233]);

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
 * The median luma (Rec. 709, 0-255) of the canvas's middle fifth, read
 * from a screenshot (a software-drawn WebGL keeps no drawing buffer to
 * read back). The median ignores the stations' markers in the patch.
 * @param {import("@playwright/test").Page} page
 */
async function middleLuma(page) {
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
    return lumas[Math.floor(lumas.length / 2)] ?? 0;
  }, png.toString("base64"));
}

/**
 * The middle's luma on a fresh page: with the map at `gain`, or bare (the
 * map's tiles refused, so none is drawn), after the relief carries the
 * ground and, with the map, every near tile has it.
 * @param {import("@playwright/test").Browser} browser
 * @param {number | "bare"} gain
 */
async function lumaWith(browser, gain) {
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
            body: LAND_TILE,
          }),
    );
    await page.goto(`/edit.html?globe=1&osmGain=${gain === "bare" ? 1 : gain}`);
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
    const luma = await middleLuma(page);
    expect(await rejections(page)).toEqual([]);
    return luma;
  } finally {
    await page.close();
  }
}

test("the street map's gain lowers the brightness step at the fade's edge", async ({
  browser,
}, testInfo) => {
  // A fresh page per reading: each loads the relief (up to 400 frames,
  // `reliefCarries`) and the map.
  test.setTimeout(420_000 * (GAINS.length + 1));
  const bare = await lumaWith(browser, "bare");
  /** @type {Record<string, number>} */
  const ratios = {};
  /** @type {Record<string, number>} */
  const lumas = { bare };
  for (const gain of GAINS) {
    lumas[gain] = await lumaWith(browser, gain);
    ratios[gain] = Math.round((lumas[gain] / bare) * 100) / 100;
  }
  const reading = JSON.stringify({ lumas, ratios });
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
  // A lower gain is never brighter, across the gains measured.
  const sorted = [...GAINS].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    expect(lumas[sorted[i - 1] ?? 0]).toBeLessThanOrEqual(
      (lumas[sorted[i] ?? 0] ?? 0) + 1,
    );
  }
});
