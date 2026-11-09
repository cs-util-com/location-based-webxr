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
 * unit test holds the icon's size and that only it takes a ray; only the
 * page shows it drawn over real relief, where the station's own camera
 * puts it, and a click on it reaching the selection. The ground here is
 * uneven on purpose: on flat ground the glow alone would have been enough.
 * Both views are held: the globe is the editor's default.
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
  test(`an ambient sound's icon shows over uneven ground from the station's camera, and a click on it selects the sound, on ${name}`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openSample3d(page, link, hills);
    await selectStation(page, STATION);
    // The relief has reached the station.
    await afterFrames(page, 60);

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
