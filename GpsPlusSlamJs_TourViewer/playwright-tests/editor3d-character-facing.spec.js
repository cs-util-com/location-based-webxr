// @ts-check
import { expect, test } from "@playwright/test";

import {
  afterFrames,
  capture,
  keepRejections,
  openSampleIn3d,
  rejections,
  view3d,
} from "./editor3d-fixture.js";

/**
 * Why these tests matter: in the editor's 3D view a close camera over a
 * station put every character's full speech bubble on the screen at once,
 * covering the station being edited, and a flat character turned at most
 * 60 degrees showed a thin card from the side. Units hold the rules (the
 * bubble opens for the selection or a playing line; a flat figure faces
 * the camera fully); only the page shows the editor handing its selection
 * to the drawn characters and the drawn figures turning to its camera.
 * The sample tour's "column" station has two free characters.
 */

test.describe.configure({ mode: "default" });

const STATION = "column";
const CHARACTERS = ["column-herald", "column-squire"];
/** Close to the station: under the visitor's 9 m bubble distance, so the
 *  old distance rule would have opened both bubbles here (m). */
const CLOSE_M = 7;
/** The figure's turn is eased; settled, it faces the camera within about
 *  2.6 degrees (cos 0.999). */
const SQUARE = 0.999;

/**
 * What the page's check says a drawn character shows now.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 * @returns {Promise<{ bubble: number, pip: number, squareness: number } | null>}
 */
function characterOf(page, id) {
  return page.evaluate(
    (who) => /** @type {any} */ (window).__tourEditor.view3dCharacter(who),
    id,
  );
}

/** @param {import("@playwright/test").Page} page */
function selected(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.selected(),
  );
}

/**
 * Select tree entry `id` and wait for any flight to it.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 */
async function select(page, id) {
  await page.locator(`#tree-body [data-select="${id}"]`).click();
  await expect.poll(() => selected(page)).toBe(id);
  await expect.poll(async () => (await view3d(page))?.flying).toBe(false);
}

/**
 * Orbit to `deg`, close in, and wait until each character settled facing
 * the camera with the bubble `open` names (others shut).
 * @param {import("@playwright/test").Page} page
 * @param {number} deg
 * @param {string | null} open
 */
async function settledAt(page, deg, open) {
  await page.evaluate(
    ([heading, m]) => {
      const hook = /** @type {any} */ (window).__tourEditor;
      hook.view3dHeading(heading);
      hook.view3dDistance(m);
    },
    [deg, CLOSE_M],
  );
  await afterFrames(page, 3);
  for (const id of CHARACTERS) {
    await expect
      .poll(async () => (await characterOf(page, id))?.squareness ?? -2, {
        message: `${id} faces the camera at ${deg} degrees`,
        timeout: 60_000,
      })
      .toBeGreaterThan(SQUARE);
    const want = id === open ? 1 : 0;
    await expect
      .poll(async () => (await characterOf(page, id))?.bubble ?? -1, {
        message: `${id}'s bubble at ${deg} degrees, ${String(open)} selected`,
        timeout: 60_000,
      })
      .toBe(want);
    await expect
      .poll(async () => (await characterOf(page, id))?.pip ?? -1, {
        message: `${id}'s name tag at ${deg} degrees`,
        timeout: 60_000,
      })
      .toBe(1 - want);
  }
}

for (const [width, height] of [
  [1280, 800],
  [844, 390],
]) {
  test(`at ${width} x ${height}: name tags until a character is selected, his bubble then, every figure facing the camera`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width, height });
    await keepRejections(page);
    await openSampleIn3d(page);
    await select(page, `station:${STATION}`);
    const canvas = page.locator("canvas").first();
    for (const deg of [0, 90, 180, 270]) {
      // The station selected, no character: only name tags.
      await settledAt(page, deg, null);
      if (deg === 0 || deg === 90) {
        await capture(
          canvas,
          testInfo.outputPath(`${width}x${height}-none-${deg}.png`),
        );
      }
    }
    await select(page, CHARACTERS[0]);
    for (const deg of [0, 90, 225]) {
      await settledAt(page, deg, CHARACTERS[0]);
      if (deg !== 225) {
        await capture(
          canvas,
          testInfo.outputPath(`${width}x${height}-selected-${deg}.png`),
        );
      }
    }
    expect(await rejections(page)).toEqual([]);
  });
}
