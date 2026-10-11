// @ts-check
import { expect, test } from "@playwright/test";

import {
  downloadedZip,
  finishAndDownload,
  installTourViewerArFakes,
  openFixtureTour,
} from "./ar-fakes.js";
import { E2E_QR_TEXT } from "./qr-fixture.mjs";

/**
 * The automatic move of a stored code, end to end (code book plan M6 v5.1;
 * the owner's decisions: the system decides by itself whether a poster
 * moved, one reliable walk is enough, no question).
 *
 * Why these tests matter: the unit tests prove the rule, the fit and the
 * settle's wiring one by one; only the composed page shows that a creator
 * who walks under a GPS that puts the code tens of metres from its saved
 * spot gets it moved at the visit's end with no question, that the Finish
 * says so and writes the spot it left into the level file, and that the
 * move survives a reload (the crash-safe draft is real OPFS here).
 *
 * The fixture tour stores the code about 13 m from the session zero; the
 * spec's GPS fixes are all shifted 44.5 m North, so the code is seen about
 * 36 m from its saved position. The fit's window is centred on the
 * sighting, which the page stamps with its own clock, so the fixes are
 * stamped from the page's clock too: one second apart from the walk's
 * start.
 */

/** The fakes' control surface on `window` (ar-fakes.js). */
const TEST_KEY = "__tourViewerTest";
/** 0.0004 degrees of latitude: 44.5 m North. */
const SHIFT_LAT = 0.0004;
/** Fixes walked after the seed: 70 s of walk, 35 m East. */
const WALK = 70;

test.beforeEach(async ({ page }) => {
  await installTourViewerArFakes(page);
});

/**
 * Device fixes consistent with one alignment 44.5 m North of the truth,
 * `count` of them one second apart from `first`; the first call sets the
 * zero and the walk's clock. Three seed fixes span North and East, then
 * each fix walks half a metre East.
 *
 * @param {import("@playwright/test").Page} page
 */
async function shiftedFixes(page, first, count) {
  await page.evaluate(
    ({ first, count, shift, key }) => {
      const test = /** @type {any} */ (window)[key];
      const store = test.alignmentStore;
      if (first === 0) {
        store.dispatch({
          type: "gpsData/setZeroPos",
          payload: { lat: 47.5, lon: 8.7 },
        });
        test.walkStartMs = Date.now();
      }
      const degPerMLon = 1.32966e-5;
      for (let i = first; i < first + count; i += 1) {
        const pairs = [
          { odom: [0, 0, 0], n: 0, e: 0 },
          { odom: [0, 0, -15], n: 15, e: 0 },
          { odom: [15, 0, 0], n: 0, e: 15 },
        ];
        const p = pairs[i] ?? {
          odom: [0.5 * (i - 3), 0, 0],
          n: 0,
          e: 0.5 * (i - 3),
        };
        store.dispatch({
          type: "gpsData/recordGpsEvent",
          payload: {
            odomPosition: p.odom,
            odomRotation: [0, 0, 0, 1],
            rawGpsPoint: {
              id: `walk-${String(i)}`,
              latitude: 47.5 + shift + p.n / 111_195,
              longitude: 8.7 + p.e * degPerMLon,
              altitude: 400,
              latLongAccuracy: 5,
              timestamp: test.walkStartMs + i * 1000,
            },
          },
        });
      }
    },
    { first, count, shift: SHIFT_LAT, key: TEST_KEY },
  );
}

/** Keep the code in view: a few camera frames, each a detection. */
async function lookAtTheCode(page) {
  await page.evaluate((key) => {
    /** @type {any} */ (window)[key].emitFrames(2);
  }, TEST_KEY);
}

/**
 * Enter AR at the fixture's code under the shifted GPS, see it far from its
 * saved spot, walk on with it in view, and end the visit.
 *
 * @param {import("@playwright/test").Page} page
 */
async function walkUnderShiftedGps(page) {
  await expect(page.getByTestId("enter-ar")).toBeEnabled({ timeout: 10000 });
  await page.getByTestId("enter-ar").click();
  await page.evaluate(
    ({ text, key }) => {
      /** @type {any} */ (window)[key].armQrDetection(text);
    },
    { text: E2E_QR_TEXT, key: TEST_KEY },
  );
  await expect
    .poll(
      async () => {
        await lookAtTheCode(page);
        return page.getByTestId("setup-status").textContent();
      },
      { timeout: 15000 },
    )
    .toMatch(/waiting for GPS alignment/i);
  await shiftedFixes(page, 0, 3);
  await expect(page.getByTestId("setup-status")).toContainText(
    /Code seen \d+ m from its saved position/,
    { timeout: 10000 },
  );
  // No question any more: the visit just goes on.
  for (let i = 3; i < 3 + WALK; i += 10) {
    await shiftedFixes(page, i, 10);
    await lookAtTheCode(page);
  }
  await expect(page.getByTestId("enter-ar")).toHaveText("Exit AR");
  await page.getByTestId("enter-ar").click();
  await expect(page.getByTestId("enter-ar")).not.toHaveText("Exit AR", {
    timeout: 10000,
  });
}

/** The fixture code's level file in a downloaded zip, parsed. */
async function codeLevel(page, index) {
  const zip = await downloadedZip(page, index);
  const texts = Object.values(zip.levels);
  expect(texts).toHaveLength(1);
  return JSON.parse(/** @type {string} */ (texts[0]));
}

test("a code seen 36 m from its saved spot after a reliable walk is moved at the visit's end, and the Finish says so and keeps the spot it left", async ({
  page,
}) => {
  await openFixtureTour(page);
  await walkUnderShiftedGps(page);
  // The result line stands between the Finish and the save (the save's own
  // line replaces it).
  await page.getByTestId("setup-finish").click();
  await expect(page.getByTestId("finish-block")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByTestId("finish-status")).toContainText(
    "The code's saved position moved to the poster's new spot",
  );
  await expect
    .poll(() =>
      page.evaluate(
        (key) => /** @type {any} */ (window)[key].downloads.length,
        TEST_KEY,
      ),
    )
    .toBe(1);
  const level = await codeLevel(page, 0);
  // Moved about 44 m North; the spot it left is remembered.
  expect(level.qr.geo.lat - level.qr.spots.previous.geo.lat).toBeGreaterThan(
    0.0003,
  );
  expect(level.qr.spots.copies ?? []).toEqual([]);
});

test("the moved spot survives a reload: the draft restores it and the Finish writes it", async ({
  page,
}) => {
  await openFixtureTour(page);
  await walkUnderShiftedGps(page);

  // The crash.
  await page.reload();
  await openFixtureTour(page);
  await expect(page.getByTestId("draft-offer")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("draft-restore").click();
  await expect(page.getByTestId("draft-offer")).toBeHidden();

  await finishAndDownload(page, 0);
  const level = await codeLevel(page, 0);
  expect(level.qr.geo.lat - level.qr.spots.previous.geo.lat).toBeGreaterThan(
    0.0003,
  );
});
