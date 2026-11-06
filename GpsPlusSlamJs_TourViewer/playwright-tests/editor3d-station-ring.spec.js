// @ts-check
import { expect, test } from "@playwright/test";

import {
  SQUARE_GROUND_M,
  afterFrames,
  answerHosts,
  keepRejections,
  openSampleIn3d,
  rejections,
  view3d,
} from "./editor3d-fixture.js";

/**
 * Why this test matters: a station's found radius is a flat ring at the
 * station's height, and the ground is rarely flat: where the relief stood
 * above that height it covered the ring, so the creator lost sight of it
 * (seen on a phone). Nothing but the picture can show that: the ring's
 * material says how it is drawn, not what the relief does to it. So the
 * relief here stands above the sample's stations and the canvas's pixels
 * are read, from straight above, where the relief covers every ring.
 * This is the older view: on the globe the test's street-level camera
 * looks over coarse tiles that sag below the stations, so a ring stayed in
 * sight with its depth test on and the check could not fail. The globe
 * draws the same material (`isInterfacePart`, and the stations' unit test).
 */

/** How far the relief stands above the sample's stations (m): more than a
 *  ring's lift over its station. */
const RELIEF_ABOVE_STATIONS_M = 8;

/** How much bluer than red a pixel of the blue ring is at the least (the
 *  ring's colour is 220 to 111, over a grey ground). */
const RING_BLUE = 30;

/** Blue pixels fewer than the sample's three rings make at this view. */
const RING_PIXELS = 100;

/** Frames for the relief to reach the stations. Read too early the rings
 *  show whatever they are made of, so this can only weaken the check, never
 *  fail it: the check was seen red at this count. */
const RELIEF_FRAMES = 120;

/** The stretch of the 1280 by 800 page read: the view clear of the panels
 *  and the map controls, which hold the same blue. */
const VIEW_CLIP = Object.freeze({ x: 260, y: 60, width: 1000, height: 640 });

/**
 * The pixels of the view that are as blue as the ring (from a screenshot:
 * a software-drawn WebGL keeps no drawing buffer to read back).
 * @param {import("@playwright/test").Page} page
 */
async function ringPixels(page) {
  const png = await page.screenshot({ clip: VIEW_CLIP });
  return page.evaluate(
    async ({ b64, blue }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("no 2d context");
      context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if ((data[i + 2] ?? 0) - (data[i] ?? 0) >= blue) count++;
      }
      return count;
    },
    { b64: png.toString("base64"), blue: RING_BLUE },
  );
}

test("a station's found radius shows where the relief stands above the station", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await answerHosts(page, {
    groundM: SQUARE_GROUND_M + RELIEF_ABOVE_STATIONS_M,
  });
  await keepRejections(page);
  await openSampleIn3d(page);
  // The names' number badges are the same blue.
  await page.locator('#tree-body [data-layer="names"]').click();
  await page.keyboard.press("t");
  await expect.poll(async () => (await view3d(page))?.top).toBe(true);
  await expect.poll(async () => (await view3d(page))?.flying).toBe(false);
  await afterFrames(page, RELIEF_FRAMES);

  const count = await ringPixels(page);
  expect(count).toBeGreaterThan(RING_PIXELS);
  expect(await rejections(page)).toEqual([]);
});
