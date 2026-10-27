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
 * story first shows a pin, "The old sign", before the knight speaks.
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

  // Play the story to its end: the knight, the choice, the welcome.
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
