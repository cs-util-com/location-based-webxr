// @ts-check
import { expect, test } from "@playwright/test";

import {
  GLOBE_VIEW,
  OLDER_VIEW,
  SQUARE_GROUND_M,
  afterFrames,
  answerHosts,
  keepRejections,
  noApproach,
  noClouds,
  rejections,
  view3d,
} from "./editor3d-fixture.js";

/**
 * Why these tests matter: in the editor's 3D view a sound has no body of
 * its own - an ambient sound's glow is faint and lies under any rise of the
 * relief - so its speaker icon is how a creator finds and selects it. A
 * unit test holds the icon's size and that only it takes a ray. The page
 * holds two things. First, that the icon is SEEN where the relief stands in
 * front of it: the canvas's pixels at the icon's point are read and must be
 * the icon's colours (the pick alone cannot say so, it never meets the
 * relief). Second, that from the station's own camera over uneven ground a
 * press reaches it and selects the sound, on both views (the globe is the
 * editor's default).
 *
 * A free character had no drawing in the editor at all. He stands now in
 * the visitor's character look, turning toward the camera, so the camera
 * orbiting his station to four headings finds him on the screen at each.
 */

test.describe.configure({ mode: "default" });

/** Hills over the sample square: up to 4 m either way of its ground, a
 *  few dozen tile pixels apart (m). */
const hills = (/** @type {number} */ col, /** @type {number} */ row) =>
  SQUARE_GROUND_M + 4 * Math.sin(col / 23) * Math.cos(row / 17);

/** The sample's ambient sound, in its second station. */
const SOUND = "market-sound";
const STATION = "gate";

/**
 * The editor at `link` with the sample tour open in 3D, on the relief
 * `groundAt` gives.
 * @param {import("@playwright/test").Page} page
 * @param {string} link
 * @param {(col: number, row: number) => number} [groundAt]
 */
async function openSample3d(page, link, groundAt) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await answerHosts(page, groundAt === undefined ? {} : { groundAt });
  await keepRejections(page);
  if (link === GLOBE_VIEW) {
    await noApproach(page);
    // Not about the clouds: without them the globe draws several times
    // faster in a software renderer (`noClouds`).
    await noClouds(page);
  }
  await page.goto(link);
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator("#sample-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "3d", {
    timeout: 120_000,
  });
  await expect.poll(async () => (await view3d(page))?.stations).toBe(3);
}

/**
 * Select station `id` from the tree and wait for the flight to it.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 */
async function selectStation(page, id) {
  await page.locator(`#tree-body [data-select="station:${id}"]`).click();
  await expect.poll(() => selected(page)).toBe(`station:${id}`);
  await expect.poll(async () => (await view3d(page))?.flying).toBe(false);
}

/** @param {import("@playwright/test").Page} page */
function selected(page) {
  return page.evaluate(() =>
    /** @type {any} */ (window).__tourEditor.selected(),
  );
}

/**
 * A canvas point (CSS px) where a press reaches the sound, searched from
 * its foot upward (the icon stands over it), or null.
 * @param {import("@playwright/test").Page} page
 */
function iconPoint(page) {
  return page.evaluate((id) => {
    const hook = /** @type {any} */ (window).__tourEditor;
    const foot = hook.view3dScreenOf(id);
    if (foot === null) return null;
    for (let up = 0; up <= 240; up += 2) {
      for (const side of [0, -4, 4, -8, 8]) {
        const x = foot[0] + side;
        const y = foot[1] - up;
        if (hook.view3dUnder(x, y)?.pick === id) return [x, y];
      }
    }
    return null;
  }, SOUND);
}

for (const [name, link] of [
  ["the older view", OLDER_VIEW],
  ["the globe", GLOBE_VIEW],
]) {
  test(`from the station's camera over uneven ground a click on an ambient sound's icon selects the sound, on ${name}`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openSample3d(page, link, hills);
    await selectStation(page, STATION);
    // The relief has reached the station: the ground drawn under it has
    // loaded and holds still between two reads (the hills give each
    // station its own height, so there is no one value to wait for).
    /** @type {number | null} */
    let lastGroundM = null;
    await expect
      .poll(async () => {
        const at = (await view3d(page))?.ground?.find(
          (/** @type {{ id: string }} */ g) => g.id === STATION,
        );
        const groundM = at?.groundM ?? null;
        const settled =
          groundM !== null &&
          lastGroundM !== null &&
          Math.abs(groundM - lastGroundM) < 0.01;
        lastGroundM = groundM;
        return settled;
      })
      .toBe(true);

    // The station's camera frames its view in the middle of the canvas,
    // which covers only the view between the docks; the sound stands at
    // the frame's left edge, so the details are folded to give the view
    // its width (the picking, not the docks, is what this test is about).
    const fold = page.locator('#inspector-head [data-act="fold"]');
    if ((await fold.getAttribute("aria-label")) !== "Show the details") {
      await fold.click();
    }
    await expect(fold).toHaveAttribute("aria-label", "Show the details");
    await afterFrames(page, 3);
    const at = await iconPoint(page);
    expect(at, "no point of the canvas reaches the sound").not.toBeNull();
    const canvas = await page.locator("#view3d canvas").boundingBox();
    if (canvas === null || at === null) throw new Error("no canvas");
    expect(at[0]).toBeGreaterThan(0);
    expect(at[0]).toBeLessThan(canvas.width);
    expect(at[1]).toBeGreaterThan(0);
    expect(at[1]).toBeLessThan(canvas.height);

    // Below its foot, on the ground inside its 20 m range, a press does
    // not reach the sound: its glow and its range ring take no ray.
    const ground = await page.evaluate((id) => {
      const hook = /** @type {any} */ (window).__tourEditor;
      const foot = hook.view3dScreenOf(id);
      return foot === null ? null : hook.view3dUnder(foot[0], foot[1] + 40);
    }, SOUND);
    expect(ground?.pick ?? null).not.toBe(SOUND);

    await page.mouse.click(canvas.x + at[0], canvas.y + at[1]);
    await expect.poll(() => selected(page)).toBe(SOUND);
    expect(await rejections(page)).toEqual([]);
  });
}

/** The top view's distance for the check (m). From straight above the
 *  icon lies flat facing up, at its lift and half its size over its foot:
 *  48 px across at 60 m is about 3.4 m, so its face is about 2.3 m up. */
const TOP_DISTANCE_M = 60;

/** How far the relief stands above the sample's stations (m): well over
 *  the icon's face at `TOP_DISTANCE_M`, so the relief is in front of all
 *  of it, and well under the camera. */
const RELIEF_ABOVE_STATIONS_M = 8;

/** Half the side of the square of pixels read round the icon's middle
 *  (CSS px): 17 px across, inside the icon's 48 px disc. */
const BOX_HALF_PX = 8;

/**
 * The pixels within `BOX_HALF_PX` of (`x`, `y`) on the canvas (CSS px),
 * as RGBA bytes. From a screenshot: a software-drawn WebGL keeps no drawing
 * buffer to read back.
 * @param {import("@playwright/test").Page} page
 * @param {{ x: number, y: number }} canvas the canvas's place on the page
 * @param {readonly [number, number]} at
 * @returns {Promise<number[]>}
 */
async function pixelsAround(page, canvas, at) {
  const R = BOX_HALF_PX;
  const png = await page.screenshot({
    clip: {
      x: canvas.x + at[0] - R,
      y: canvas.y + at[1] - R,
      width: 2 * R + 1,
      height: 2 * R + 1,
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
    return [...context.getImageData(0, 0, bitmap.width, bitmap.height).data];
  }, png.toString("base64"));
}

/**
 * The share of the pixels that the icon turned into its own colours: they
 * differ from the same pixels drawn without it (by over 48 in the sum of
 * the channels), and `shown` has them in the icon's colours - its dark
 * blue-grey disc (all channels under 90, blue over red) or its amber
 * speaker and rim (red over 190, red over blue by 70). Whatever else is
 * drawn there (the relief, a ring in the same amber) is in both and does
 * not count.
 * @param {readonly number[]} shown
 * @param {readonly number[]} hidden
 */
function iconShare(shown, hidden) {
  let icon = 0;
  for (let i = 0; i < shown.length; i += 4) {
    const r = shown[i] ?? 0;
    const g = shown[i + 1] ?? 0;
    const b = shown[i + 2] ?? 0;
    const changed =
      Math.abs(r - (hidden[i] ?? 0)) +
        Math.abs(g - (hidden[i + 1] ?? 0)) +
        Math.abs(b - (hidden[i + 2] ?? 0)) >
      48;
    const disc = r < 90 && g < 90 && b < 90 && b > r;
    const speaker = r > 190 && r - b > 70;
    if (changed && (disc || speaker)) icon++;
  }
  return icon / (shown.length / 4);
}

/**
 * The sounds' speaker icons shown or hidden, a few frames drawn after.
 * @param {import("@playwright/test").Page} page
 * @param {boolean} on
 */
async function soundIcons(page, on) {
  await page.evaluate(
    (shown) => /** @type {any} */ (window).__tourEditor.view3dSoundIcons(shown),
    on,
  );
  await afterFrames(page, 4);
}

// Why: the claim the icon exists for. The relief stands 8 m above the
// station, so it is in front of the whole icon from the top view; the
// pixels at the icon's middle must still be the icon's own. The same
// pixels are read with the icon and without it, in the one view: the
// station's selected ring passes under the icon in the same amber, so a
// sample elsewhere on the screen says nothing about the icon. Drawn with a depth test the relief hides the
// icon and the two reads are the same. The older view: on the globe a
// street-level camera looks over coarse tiles that sag below the stations
// (see the found-radius spec), and the globe draws the same material
// (`isInterfacePart`).
test("an ambient sound's icon is seen where the relief stands in front of it", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openSample3d(
    page,
    OLDER_VIEW,
    () => SQUARE_GROUND_M + RELIEF_ABOVE_STATIONS_M,
  );
  await selectStation(page, STATION);
  await page.keyboard.press("t");
  await expect.poll(async () => (await view3d(page))?.top).toBe(true);
  await expect.poll(async () => (await view3d(page))?.flying).toBe(false);
  await page.evaluate(
    (m) => /** @type {any} */ (window).__tourEditor.view3dDistance(m),
    TOP_DISTANCE_M,
  );
  expect((await view3d(page))?.distanceM).toBeCloseTo(TOP_DISTANCE_M, 0);
  // The relief has reached the station: the ground drawn under it stands
  // where the hosts put it.
  await expect
    .poll(async () => {
      const at = (await view3d(page))?.ground?.find(
        (/** @type {{ id: string }} */ g) => g.id === STATION,
      );
      return at?.groundM ?? null;
    })
    .toBeCloseTo(SQUARE_GROUND_M + RELIEF_ABOVE_STATIONS_M, 0);
  await afterFrames(page, 4);

  // The icon's middle on the screen: the middle of the points a press
  // there reaches it by.
  const middle = await page.evaluate((id) => {
    const hook = /** @type {any} */ (window).__tourEditor;
    const foot = hook.view3dScreenOf(id);
    if (foot === null) return null;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let dx = -80; dx <= 80; dx += 2) {
      for (let dy = -80; dy <= 80; dy += 2) {
        if (hook.view3dUnder(foot[0] + dx, foot[1] + dy)?.pick === id) {
          sx += foot[0] + dx;
          sy += foot[1] + dy;
          n++;
        }
      }
    }
    return n === 0 ? null : /** @type {[number, number]} */ ([sx / n, sy / n]);
  }, SOUND);
  expect(middle, "no point of the canvas reaches the sound").not.toBeNull();
  const canvas = await page.locator("#view3d canvas").boundingBox();
  if (canvas === null || middle === null) throw new Error("no canvas");
  const shown = await pixelsAround(page, canvas, middle);
  await soundIcons(page, false);
  const hidden = await pixelsAround(page, canvas, middle);
  await soundIcons(page, true);
  // Measured at 40, 60 and 90 m, boxes 9 to 33 px across and change
  // tolerances 24 to 96: 0.59 to 0.92 with the icon drawn (0.85 here), and
  // 0 everywhere with a depth test, where the relief hides it. The ring's
  // amber under the icon alone fills 0.12 to 0.43 of the box.
  // Two reads with the icon drawn did not differ in any pixel.
  expect(iconShare(shown, hidden)).toBeGreaterThan(0.5);
  expect(await rejections(page)).toEqual([]);
});

/** The sample's free characters, at its first station. */
const CHARACTERS = ["column-herald", "column-squire"];

/**
 * How many points of a 4 px grid round `id`'s own canvas point (within
 * 160 px) a press there selects `id` by: his figure's footprint on the
 * screen, in grid cells (his words and shadow take no press).
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 */
function footprint(page, id) {
  return page.evaluate((who) => {
    const hook = /** @type {any} */ (window).__tourEditor;
    const foot = hook.view3dScreenOf(who);
    if (foot === null) return 0;
    let cells = 0;
    for (let dx = -160; dx <= 160; dx += 4) {
      for (let dy = -160; dy <= 160; dy += 4) {
        if (hook.view3dUnder(foot[0] + dx, foot[1] + dy)?.pick === who) {
          cells++;
        }
      }
    }
    return cells;
  }, id);
}

// Why: drawn as a flat card at a fixed turn he would vanish edge-on
// from the side; the visitor's look turns him toward the camera. The
// orbit goes round his station to four headings; at each he has a
// footprint on the screen.
test("a free character shows on the screen from four camera headings round his station", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await openSample3d(page, OLDER_VIEW);
  await selectStation(page, "column");
  /** @type {Record<string, number>} */
  const cells = {};
  for (const headingDeg of [0, 90, 180, 270]) {
    await page.evaluate(
      (deg) => /** @type {any} */ (window).__tourEditor.view3dHeading(deg),
      headingDeg,
    );
    for (const id of CHARACTERS) {
      // His turn toward the camera eases in over a second or so.
      await expect
        .poll(() => footprint(page, id), { message: `${id} at ${headingDeg}` })
        .toBeGreaterThan(0);
      cells[`${id} ${headingDeg}`] = await footprint(page, id);
    }
  }
  testInfo.annotations.push({
    type: "footprints (4 px cells)",
    description: JSON.stringify(cells),
  });
  expect(await rejections(page)).toEqual([]);
});
