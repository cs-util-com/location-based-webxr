// @ts-check
import { expect, test } from "@playwright/test";

import {
  forceTrackingReady,
  installTourViewerArFakes,
  lockFixtureCode,
  reportArTracking,
  seedAlignment,
  standAt,
} from "./ar-fakes.js";

/**
 * A station's story blocks in the world (station blocks plan B2b), end to
 * end through the AR fakes. The fixture (`archive-server.mjs`,
 * `/ranges-ok/story-blocks-tour.zip`) is the stations tour whose gate
 * story first shows a pin, "The old sign" (with a description), then a
 * video card, then a long text, before the knight speaks.
 */

const ARCHIVE = "http://127.0.0.1:5197/ranges-ok/story-blocks-tour.zip";

test.beforeEach(async ({ page }) => {
  await installTourViewerArFakes(page);
});

/** Open the tour as a visitor, start AR aligned, and find the gate. */
async function atTheGate(page) {
  await page.goto(`/?qr=${encodeURIComponent(ARCHIVE)}`);
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
  await reportArTracking(page, true);
  await forceTrackingReady(page);
}

/** The object ids drawn under the gate's content, after one frame. */
function gateIds(page) {
  return page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    t.emitFrames(1);
    /** @param {any} o @returns {string[]} */
    const ids = (o) => [
      ...(typeof o.userData?.objectId === "string"
        ? [o.userData.objectId]
        : []),
      ...(o.children ?? []).flatMap(ids),
    ];
    const root = t.fakeScene.children.find(
      (/** @type {any} */ c) => c.name === "station-content:gate",
    );
    return root === undefined ? [] : [...new Set(ids(root))].sort();
  });
}

test("a pin the story shows stands in the world from its step on, and stays after the story ends", async ({
  page,
}) => {
  // Why this test matters (B2b step 2, B-Q4): a story block with a world
  // view used to show only its words in the card and vanish with the
  // next step. It now stands in the station's world from the step that
  // reaches it for the rest of the visit - beside the station's own pin,
  // and still there once the story is over.
  await atTheGate(page);
  await expect(page.getByTestId("scene-text")).toHaveText("The old sign");
  await expect
    .poll(() => gateIds(page), { timeout: 20000 })
    .toEqual(["gate-pin", "gate-story-sign"]);

  // Play the story to its end: the clip, the long text, the knight, the
  // choice, the welcome.
  await page.getByTestId("scene-continue").click();
  await expect(page.getByTestId("scene-text")).toHaveText(
    "The gate opens at dawn.",
  );
  await expect(page.getByTestId("scene-video")).toBeVisible();
  await page.getByTestId("scene-continue").click();
  await expect(page.getByTestId("scene-video")).toBeHidden();
  await page.getByTestId("scene-continue").click();
  await expect(page.getByTestId("scene-text")).toHaveText("Halt, traveller!");
  await page.getByTestId("scene-continue").click();
  await page.getByTestId("scene-choices").getByText("Yes").click();
  await expect(page.getByTestId("scene-text")).toHaveText("Welcome inside.");
  await page.getByTestId("scene-continue").click();
  await expect(page.getByTestId("scene-panel")).toBeHidden();

  await expect
    .poll(() => gateIds(page))
    .toEqual(["gate-pin", "gate-story-sign"]);
});

test("a tap on a pin with a description opens its whole text in a sheet, a tap on its Close is no tap in the world", async ({
  page,
}) => {
  // Why this test matters (B2b step 5): a pin shows only its caption in
  // the world; its description is reachable only by a tap in AR, which is
  // the session's select. Only a pin with a description is offered to the
  // tap (the gate's own pin has none), and the sheet's Close is the
  // overlay's tap, never a select that would hit what stands behind it.
  await atTheGate(page);
  await expect(page.getByTestId("scene-text")).toHaveText("The old sign");
  await expect
    .poll(() => gateIds(page), { timeout: 20000 })
    .toContain("gate-story-sign");
  const tapped = await page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    t.pickId = "gate-story-sign";
    return { fired: t.tapXr(), offered: t.pickTargets };
  });
  expect(tapped).toEqual({ fired: true, offered: ["gate-story-sign"] });
  await expect(page.getByTestId("pin-sheet")).toBeVisible();
  await expect(page.getByTestId("pin-sheet-title")).toHaveText("The old sign");
  await expect(page.getByTestId("pin-sheet-text")).toHaveText(
    "Carved in 1400.",
  );
  const closeIsWorldTap = await page.evaluate(() =>
    /** @type {any} */ (window).__tourViewerTest.tapXr("#pin-sheet-close"),
  );
  expect(closeIsWorldTap).toBe(false);
  await page.getByTestId("pin-sheet-close").click();
  await expect(page.getByTestId("pin-sheet")).toBeHidden();
});

/** Continue the gate's story from its first step to `text`. */
async function continueTo(page, text) {
  for (let i = 0; i < 4; i += 1) {
    const now = await page.getByTestId("scene-text").textContent();
    if (now === text) return;
    await page.getByTestId("scene-continue").click();
  }
  await expect(page.getByTestId("scene-text")).toHaveText(text);
}

test("the video card plays its clip with the browser's controls, the transcript below", async ({
  page,
}) => {
  // Why this test matters (B2b step 3): the card used to show only the
  // transcript. It now plays the clip - a real WebM, decoded by the
  // browser - from a tap on the player, with its poster and controls,
  // and the transcript stays below for a visitor who cannot hear it.
  await atTheGate(page);
  await continueTo(page, "The gate opens at dawn.");
  const video = page.getByTestId("scene-video");
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute("controls", "");
  await expect
    .poll(() =>
      video.evaluate((v) => /** @type {HTMLVideoElement} */ (v).poster),
    )
    .toMatch(/^blob:/);
  // A tap on the player plays it (the tap is the activation).
  await video.click();
  await expect
    .poll(() =>
      video.evaluate((v) => {
        const el = /** @type {HTMLVideoElement} */ (v);
        return el.currentTime > 0 || el.ended;
      }),
    )
    .toBe(true);
  // The transcript sits below the player.
  const below = await page.evaluate(() => {
    const v = document.getElementById("scene-video");
    const t = document.getElementById("scene-text");
    return (
      v !== null &&
      t !== null &&
      v.getBoundingClientRect().bottom <= t.getBoundingClientRect().top + 1
    );
  });
  expect(below).toBe(true);
});

test("a long text card shows its paragraphs apart, without the markup", async ({
  page,
}) => {
  // Why this test matters (B2b step 4): the card collapsed the creator's
  // paragraphs into one run and showed the markdown's stars. It now shows
  // the plain text P with a blank line between paragraphs.
  await atTheGate(page);
  await continueTo(page, "Built in 1400, rebuilt later.\n\nThe second part.");
  const text = page.getByTestId("scene-text");
  expect(await text.evaluate((p) => getComputedStyle(p).whiteSpace)).toBe(
    "pre-line",
  );
  // Two paragraphs are taller than one line of the same text.
  const lines = await text.evaluate((p) =>
    Math.round(
      p.getBoundingClientRect().height /
        parseFloat(getComputedStyle(p).lineHeight),
    ),
  );
  expect(lines).toBeGreaterThanOrEqual(3);
});
