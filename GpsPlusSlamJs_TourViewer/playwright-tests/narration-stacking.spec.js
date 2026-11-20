// @ts-check
import { expect, test } from "@playwright/test";

import {
  installTourViewerArFakes,
  lockFixtureCode,
  seedAlignment,
  standAt,
} from "./ar-fakes.js";

/**
 * A narrated text's words at the bottom (the narration box) beside a
 * narration circle's player card, in the visitor's AR view. The archive
 * server's `/ranges-ok/narrated-tour.zip` holds, at its gate, a long text
 * with a voice and a read-along (no creator's choice, so its words show in
 * the box) and a narration circle around the gate. The fakes hand the
 * world parts a viewer at the visitor's place, so the circle sees the
 * visitor inside it and opens its card.
 */

const TOUR = "http://127.0.0.1:5197/ranges-ok/narrated-tour.zip";

/** @param {import("@playwright/test").Page} page */
async function emitFrame(page) {
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
  });
}

/**
 * Open the tour, enter AR at the gate and wait until the box and the
 * circle's card both show.
 * @param {import("@playwright/test").Page} page
 */
async function enterTheGate(page) {
  await page.goto(`/?qr=${encodeURIComponent(TOUR)}`);
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    { timeout: 15000 },
  );
  const button = page.getByTestId("enter-ar");
  await expect(button).toBeEnabled({ timeout: 10000 });
  await button.click();
  await seedAlignment(page);
  await standAt(page, 0, 0, 0);
  await lockFixtureCode(page);
  await expect
    .poll(
      async () => {
        await emitFrame(page);
        // A hidden box keeps its size (`nb-off` fades it), so "shown" is
        // its class, not Playwright's visibility.
        const boxOn = await page
          .getByTestId("narration-box")
          .evaluate((el) => !el.classList.contains("nb-off"));
        return boxOn && (await page.getByTestId("narration-card").isVisible());
      },
      { timeout: 20000 },
    )
    .toBe(true);
}

/**
 * An element's box by test id.
 * @param {import("@playwright/test").Page} page
 * @param {string} testId
 */
async function rect(page, testId) {
  const b = await page.getByTestId(testId).boundingBox();
  if (b === null) throw new Error(`${testId} has no box`);
  return b;
}

/**
 * Points on a grid over the part of `a` that `b` also covers, or none.
 * @param {{ x: number, y: number, width: number, height: number }} a
 * @param {{ x: number, y: number, width: number, height: number }} b
 */
function overlapPoints(a, b) {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right - left < 4 || bottom - top < 4) return [];
  const points = [];
  for (let i = 1; i < 6; i += 1) {
    for (let j = 1; j < 4; j += 1) {
      points.push({
        x: left + ((right - left) * i) / 6,
        y: top + ((bottom - top) * j) / 4,
      });
    }
  }
  return points;
}

/**
 * What lies topmost at each point: "card" (inside the card's root),
 * "box", or "other"; and whether a button is there.
 * @param {import("@playwright/test").Page} page
 * @param {{ x: number, y: number }[]} points
 */
async function topmost(page, points) {
  return page.evaluate((pts) => {
    return pts.map(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const where =
        el?.closest("#narration-card-root") != null
          ? "card"
          : el?.closest('[data-testid="narration-box"]') != null
            ? "box"
            : "other";
      return { where, button: el?.closest("button") != null };
    });
  }, points);
}

/**
 * The box's place once it has settled (it moves a few px after it shows):
 * frames emitted until two reads agree.
 * @param {import("@playwright/test").Page} page
 */
async function settledBox(page) {
  let last = "";
  /** @type {{ x: number, y: number, width: number, height: number } | null} */
  let settled = null;
  await expect
    .poll(
      async () => {
        await emitFrame(page);
        const b = await rect(page, "narration-box");
        const now = JSON.stringify(b);
        const same = now === last;
        last = now;
        settled = b;
        return same;
      },
      { timeout: 10000 },
    )
    .toBe(true);
  if (settled === null) throw new Error("the box never settled");
  return settled;
}

/**
 * The points of the box, on a fine grid, that the card leaves free and no
 * button holds (the free part can be a strip of a few px).
 * @param {import("@playwright/test").Page} page
 * @param {{ x: number, y: number, width: number, height: number }} b
 */
async function freeBoxPoints(page, b) {
  const points = [];
  for (let x = b.x + 2; x < b.x + b.width - 1; x += 4) {
    for (let y = b.y + 1; y < b.y + b.height - 1; y += 2) {
      points.push({ x, y });
    }
  }
  const top = await topmost(page, points);
  return points.filter(
    (_, i) => top[i]?.where === "box" && top[i]?.button === false,
  );
}

/**
 * What a tap on the box leaves at once, read without waiting: the tap's
 * play or pause sign (in the page for most of a second: it goes at the
 * end of its 0.75 s animation) and the store's playing flag, set at once
 * by the tap and kept. `data-speaking` follows the voice and could turn
 * later.
 * @param {import("@playwright/test").Page} page
 */
async function tapTrace(page) {
  return page.evaluate(() => ({
    signs: document.querySelectorAll('[data-testid="narration-box-tap"]')
      .length,
    playing: /** @type {any} */ (
      window
    ).__tourViewerTest.alignmentStore?.getState?.()?.narrationBox?.playing,
  }));
}

/**
 * The box speaking (`yes`) or not, frames emitted until it is.
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} box
 * @param {string} want
 */
async function expectSpeaking(page, box, want) {
  await expect
    .poll(async () => {
      await emitFrame(page);
      return box.getAttribute("data-speaking");
    })
    .toBe(want);
}

for (const viewport of [
  { width: 390, height: 844, free: false },
  { width: 844, height: 390, free: true },
]) {
  test(`a circle's card stands over the narrated words and keeps its taps, at ${String(viewport.width)}x${String(viewport.height)}`, async ({
    page,
  }) => {
    // Why this test matters: both sit at the foot of the screen. The
    // card is what the visitor uses while inside the circle, so it must
    // be on top where they overlap, and a tap on it must never pause or
    // start the narrated text's voice under it. It also pins how much of
    // the box stays free today: in landscape the box is wider than the
    // card and its ends still pause and play; in portrait the card covers
    // the whole box, so the narrated words can neither be read nor paused
    // while a circle's card is open. A change to either layout shows here.
    await page.setViewportSize(viewport);
    await installTourViewerArFakes(page, { viewer: true });
    await enterTheGate(page);
    const box = page.getByTestId("narration-box");
    const boxRect = await settledBox(page);
    const cardRect = await rect(page, "narration-card");

    // Where they overlap, the card is on top.
    const shared = overlapPoints(boxRect, cardRect);
    expect(shared.length, "the card and the box overlap").toBeGreaterThan(0);
    const sharedTop = await topmost(page, shared);
    expect(sharedTop.map((p) => p.where)).toEqual(shared.map(() => "card"));

    // A tap on the card (not on its play button) never reaches the box.
    const onCard = shared.find((_, i) => sharedTop[i]?.button === false);
    if (onCard === undefined) throw new Error("no plain card point");
    await expect(box).toHaveAttribute("data-speaking", "no");
    await page.mouse.click(onCard.x, onCard.y);
    // A tap the box took would show its sign and set the store at once.
    expect(await tapTrace(page)).toEqual({ signs: 0, playing: false });
    for (let i = 0; i < 5; i += 1) await emitFrame(page);
    await expect(box).toHaveAttribute("data-speaking", "no");

    const free = await freeBoxPoints(page, boxRect);
    if (!viewport.free) {
      expect(free, "the card covers the whole box").toEqual([]);
      return;
    }
    // The box's own part, which the card leaves free, plays and pauses.
    const [at] = free;
    if (at === undefined) throw new Error("no free point on the box");
    await page.mouse.click(at.x, at.y);
    // The trace the card tap was checked for does show for a box tap:
    // the store first, which does not depend on the sign's animation, so
    // a slow read that misses the sign still shows the tap was taken.
    const trace = await tapTrace(page);
    expect(trace.playing, "the box took the tap").toBe(true);
    expect(trace.signs, "the tap's sign, read within its animation").toBe(1);
    await expectSpeaking(page, box, "yes");
    await page.mouse.click(at.x, at.y);
    await expectSpeaking(page, box, "no");
  });
}
