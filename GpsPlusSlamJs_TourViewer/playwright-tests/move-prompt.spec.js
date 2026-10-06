// @ts-check
import { expect, test } from "@playwright/test";

import { installTourViewerArFakes, openFixtureTour } from "./ar-fakes.js";
import { E2E_QR_TEXT } from "./qr-fixture.mjs";

/**
 * The prompt for a physically moved code, end to end (authoring plan
 * 2026-09-28-0953 §3.6 "Authoring (D20 ask once)", milestone M5b; UI round
 * 1, U3: "Did the poster move here?").
 *
 * Why these tests matter: the unit tests prove the tracker, the settle's
 * decision and the draft memory one by one; only the composed page shows
 * that a creator
 * standing at a code GPS puts tens of metres from its saved spot is asked
 * ONCE the refusal has lasted, that each of the three answers does what it
 * says, and that "No, it's a second poster" survives a reload (the crash-safe
 * draft is real OPFS here).
 *
 * The fixture tour stores the code about 13 m from the session zero; the
 * spec's GPS fixes are all shifted 44.5 m North, so the code is seen about
 * 36 m from its saved position - beyond the 26.2 m bound at 5 m accuracy.
 */

/** The fakes' control surface on `window` (ar-fakes.js). */
const TEST_KEY = "__tourViewerTest";
/** 0.0004 degrees of latitude: 44.5 m North. */
const SHIFT_LAT = 0.0004;

test.beforeEach(async ({ page }) => {
  await installTourViewerArFakes(page);
});

/**
 * Device fixes consistent with one alignment that is 44.5 m North of the
 * truth, `count` of them one second apart starting at `first`; the first
 * call also sets the zero. Each fix walks half a metre East.
 *
 * @param {import("@playwright/test").Page} page
 */
async function shiftedFixes(page, first, count) {
  await page.evaluate(
    ({ first, count, shift, key }) => {
      const store = /** @type {any} */ (window)[key].alignmentStore;
      if (first === 0) {
        store.dispatch({
          type: "gpsData/setZeroPos",
          payload: { lat: 47.5, lon: 8.7 },
        });
      }
      const degPerMLon = 1.32966e-5;
      for (let i = first; i < first + count; i += 1) {
        // Three fixes span North and East (the seed's L), then a walk East.
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
              id: `shifted-${String(i)}`,
              latitude: 47.5 + shift + p.n / 111_195,
              longitude: 8.7 + p.e * degPerMLon,
              altitude: 400,
              latLongAccuracy: 5,
              timestamp: 1756150000000 + i * 1000,
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
 * Enter AR at the fixture's code under the shifted GPS and measure it (the
 * tour stores it, so the measurement keeps the saved pose, D10b).
 *
 * @param {import("@playwright/test").Page} page
 */
async function measureUnderShiftedGps(page) {
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
  await expect(page.getByTestId("setup-mint")).toBeEnabled({ timeout: 10000 });
  await page.getByTestId("setup-mint").click();
  await expect(page.getByTestId("setup-status")).toContainText(
    /Code seen \d+ m from its saved position/,
    { timeout: 10000 },
  );
}

/** Walk on under the same GPS until the refusal has lasted `seconds`. */
async function walkOn(page, from, seconds) {
  for (let i = from; i < from + seconds; i += 1) {
    await shiftedFixes(page, i, 1);
    await lookAtTheCode(page);
  }
}

test("the prompt asks only once the offset has lasted; 'Yes, it moved' changes nothing at once, and Undo takes it back", async ({
  page,
}) => {
  await openFixtureTour(page);
  await measureUnderShiftedGps(page);
  const prompt = page.getByTestId("move-prompt");
  const status = page.getByTestId("setup-status");
  // An offset that has just begun is not a moved code yet (§7j #9).
  await walkOn(page, 3, 5);
  await expect(prompt).toBeHidden();
  await walkOn(page, 8, 20);
  await expect(prompt).toBeVisible();
  await expect(page.getByTestId("move-prompt-text")).toHaveText(
    /The code is about \d+ m from its saved spot\. Did the poster move here\?/,
  );
  const use = page.getByTestId("move-prompt-use");
  await expect(use).toHaveText("Yes, it moved");
  await use.click();
  await expect(prompt).toBeHidden();
  // UI round 1, U3: the settle saves the new spot at the visit's end,
  // after enough walking - nothing has moved yet.
  await expect(status).toContainText("saved when this visit ends");
  await expect(status).toContainText(/Code seen \d+ m from its saved position/);
  const undo = page.getByTestId("move-undo-button");
  await expect(undo).toBeVisible();
  await undo.click();
  await expect(page.getByTestId("move-undo")).toBeHidden();
  await expect(status).toContainText("Not marked as moved.");
  // The undo counts as "Not now" for this spot: the prompt does not return.
  await walkOn(page, 28, 22);
  await expect(status).toContainText(/Code seen \d+ m from its saved position/);
  await expect(prompt).toBeHidden();
});

test("'Not now' keeps the saved position and does not ask again for the same spot", async ({
  page,
}) => {
  await openFixtureTour(page);
  await measureUnderShiftedGps(page);
  await walkOn(page, 3, 25);
  const prompt = page.getByTestId("move-prompt");
  await expect(prompt).toBeVisible();
  await page.getByTestId("move-prompt-later").click();
  await expect(prompt).toBeHidden();
  await walkOn(page, 28, 25);
  // Still refused (the saved position stands), still not asked.
  await expect(page.getByTestId("setup-status")).toContainText(
    /Code seen \d+ m from its saved position/,
  );
  await expect(prompt).toBeHidden();
  await expect(page.getByTestId("move-undo")).toBeHidden();
});

test("'No, it's a second poster' is remembered in the draft: after a reload the same spot is not asked about again", async ({
  page,
}) => {
  await openFixtureTour(page);
  await measureUnderShiftedGps(page);
  await walkOn(page, 3, 25);
  const prompt = page.getByTestId("move-prompt");
  await expect(prompt).toBeVisible();
  await page.getByTestId("move-prompt-copy").click();
  await expect(prompt).toBeHidden();
  // The answer reaches the draft's meta before the "crash".
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const found = [];
        async function walk(dir) {
          for await (const [name, handle] of dir.entries()) {
            if (handle.kind === "directory") await walk(handle);
            else if (name === "meta.blob") {
              const text = await (await handle.getFile()).text();
              found.push(text);
            }
          }
        }
        // The page keeps writing and removing draft files while this walks
        // (a write commits through a temporary file; a discard removes its
        // entry), so an entry listed a moment ago can be gone when it is
        // opened (`NotFoundError`), or held by the page's write when it is
        // read (`NotReadableError`): either read is "not yet", and the poll
        // asks again. Any other error is a real failure.
        try {
          await walk(root);
        } catch (error) {
          if (
            error instanceof DOMException &&
            (error.name === "NotFoundError" ||
              error.name === "NotReadableError")
          ) {
            return false;
          }
          throw error;
        }
        return found.some((t) => t.includes('"second-copy"'));
      }),
    )
    .toBe(true);

  await page.reload();
  await openFixtureTour(page);
  await measureUnderShiftedGps(page);
  await walkOn(page, 3, 25);
  await expect(page.getByTestId("setup-status")).toContainText(
    /Code seen \d+ m from its saved position/,
  );
  await expect(prompt).toBeHidden();
});
