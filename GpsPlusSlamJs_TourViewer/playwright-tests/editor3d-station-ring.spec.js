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
 * are read, from straight above (Top view, drawn back to `TOP_DISTANCE_M`
 * so every station stands in the read stretch), with the relief above
 * every ring. On the globe this holds that the rings are drawn and seen
 * from above, not that they escape the relief: drawn with a depth test, in
 * the scene's own pass, the rings still showed (4678 pixels against 4782),
 * so the material's depth test is held by the stations' unit test alone
 * (`isInterfacePart`).
 * TODO: why a depth-tested ring 8 m under the relief still shows is an open
 * question; until it is answered this spec cannot tell a ring the relief
 * covers from one it does not. One hypothesis checked and not borne out:
 * that the ground the gate reads (`stats().ground[].groundM`, the relief
 * sampled from the finest loaded tile) is not the ground drawn, which can
 * differ on real relief. Here every relief tile at every zoom carries the
 * same flat height (`answerHosts`), so any tile drawn stands where the
 * sample says, and one run read the relief 7.3 to 9.3 m above each
 * station's drawn height (`groundM` 523.5 against `drawnM` 514.2 to
 * 516.2). Still open: whether the relief's tiles write the depth the ring
 * is tested against in that pass.
 */

/** How far the relief stands above the sample's stations (m): more than a
 *  ring's lift over its station. */
const RELIEF_ABOVE_STATIONS_M = 8;

/** How far the Top view stands back from the tour (m): the Top view tilts
 *  where the camera stands, at eye height, and sees no ring from there. */
const TOP_DISTANCE_M = 80;

/** How much bluer than red a pixel of the blue ring is at the least: the
 *  ring reads about 82 over the ground. The globe's grey-blue ground comes
 *  close and moves with the sun, which follows the day the test runs on,
 *  so the ground's own count is read with the rings out of view and taken
 *  off (`CONTROL_RADIUS_M`). */
const RING_BLUE = 70;

/** Blue pixels fewer than the sample's three rings add to this view: 4782
 *  with the rings against 1637 of ground alone measured, 3145 added (both
 *  read again in one run, the control after the stations were drawn anew:
 *  4782 and 1637). Swept
 *  over the blue cutoff the rings added 3494, 3437, 3145 and 2052 at 50,
 *  60, 70 and 80 (1859 at 40, 0 at 90). */
const RING_PIXELS = 2000;

/** The rings' radius for the control read (m): the most a station takes,
 *  which puts every ring outside the stretch read from `TOP_DISTANCE_M`
 *  (the least, 2 m, still drew a loop of the ring's blue). */
const CONTROL_RADIUS_M = 300;

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

test("a station's found radius is drawn and seen from above over relief standing above it", async ({
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
  const names = page.locator('#tree-body [data-layer="names"]');
  await names.click();
  await expect(names).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("t");
  await expect.poll(async () => (await view3d(page))?.top).toBe(true);
  await page.evaluate(
    (m) => /** @type {any} */ (window).__tourEditor.view3dDistance(m),
    TOP_DISTANCE_M,
  );
  // The relief has reached every station: the ground drawn under each
  // stands where the hosts put it.
  await expect
    .poll(
      async () =>
        ((await view3d(page))?.ground ?? []).map(
          (/** @type {{ groundM: number }} */ g) =>
            Math.round(g.groundM - SQUARE_GROUND_M),
        ),
      { timeout: 60_000 },
    )
    .toEqual([
      RELIEF_ABOVE_STATIONS_M,
      RELIEF_ABOVE_STATIONS_M,
      RELIEF_ABOVE_STATIONS_M,
    ]);
  await afterFrames(page, RELIEF_FRAMES);
  // Every station stands in the stretch read, so the blue counted is the
  // rings' and not some other blue of the view.
  const canvas = await page.locator("#view3d canvas").boundingBox();
  if (canvas === null) throw new Error("no canvas");
  const shown = await page.evaluate(() => {
    const hook = /** @type {any} */ (window).__tourEditor;
    return hook
      .view3d()
      .ground.map((/** @type {{ id: string }} */ g) =>
        hook.view3dScreenOf(`station:${g.id}`),
      );
  });
  expect(shown).toHaveLength(3);
  for (const at of shown) {
    expect(at, "a station on the screen").not.toBeNull();
    const x = canvas.x + at[0];
    const y = canvas.y + at[1];
    expect(x).toBeGreaterThan(VIEW_CLIP.x);
    expect(x).toBeLessThan(VIEW_CLIP.x + VIEW_CLIP.width);
    expect(y).toBeGreaterThan(VIEW_CLIP.y);
    expect(y).toBeLessThan(VIEW_CLIP.y + VIEW_CLIP.height);
  }

  const count = await ringPixels(page);
  const rendered = (await view3d(page))?.renders ?? 0;
  // The control: the same view with the rings out of it, so the
  // ground's own blue (which moves with the sun, and the editor's sun
  // follows the day the test runs on) is counted and taken off.
  const edited = await page.evaluate((radiusM) => {
    const hook = /** @type {any} */ (window).__tourEditor;
    const kinds = hook
      .manifest()
      .stations.map(
        (/** @type {{ id: string }} */ s) =>
          hook.editor().editStation(s.id, { foundRadiusM: radiusM }).kind,
      );
    hook.edited();
    return kinds;
  }, CONTROL_RADIUS_M);
  expect(edited).toEqual(["edited", "edited", "edited"]);
  // The edit rebuilds every station: their rings are drawn again at the
  // new radius once all three are rendered anew, and a few frames later
  // on the screen. Read before that, the old rings would count as ground.
  await expect
    .poll(async () => (await view3d(page))?.renders ?? 0, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(rendered + 3);
  await afterFrames(page, 8);
  const ground = await ringPixels(page);
  expect(count - ground).toBeGreaterThan(RING_PIXELS);
  expect(await rejections(page)).toEqual([]);
});
