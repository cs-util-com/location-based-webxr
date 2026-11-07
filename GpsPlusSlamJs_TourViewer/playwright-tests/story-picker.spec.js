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
 * Why these tests matter: a station with several stories used to play only
 * its first. Here a visitor gets their titles to tap, end to end through
 * the AR fakes. The fixture (`archive-server.mjs`,
 * `/ranges-ok/two-stories-tour.zip`) is the stations tour whose gate holds
 * two stories and its free pin; its well keeps one story.
 */

const ARCHIVE = "http://127.0.0.1:5197/ranges-ok/two-stories-tour.zip";
const LONG_TITLE =
  "The guard who has stood at this gate for more than sixty long years";

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
  await expect(page.getByTestId("scene-text")).toHaveText("Choose a story");
}

test("the walk's words at the picker say what is asked, and what the end control does", async ({
  page,
}) => {
  // Why: the picker waits for a tap and its end control leaves the
  // station, so "its story is playing" and "End the story" both mislead.
  await atTheGate(page);
  const end = page.getByTestId("story-end");
  await expect(end).toHaveText("Skip the stories");
  await end.click();
  await expect(end).toHaveText("Skip the stories of The gate now");
  await expect(page.getByTestId("keep-listening")).toHaveText("Keep choosing");
  await page.getByTestId("keep-listening").click();
  await expect(end).toHaveText("Skip the stories");
  // A pick answers the ask: the story's end control starts unasked, and the
  // story runs on with no "Keep listening".
  await end.click();
  await page.getByTestId("scene-choice").first().click();
  await expect(end).toHaveText("End this story?");
  await expect(page.getByTestId("keep-listening")).toBeHidden();
});

const picks = (page) => page.getByTestId("scene-choice");

/** An element's box. */
async function box(locator) {
  const b = await locator.boundingBox();
  if (b === null) throw new Error("no box");
  return b;
}

test("a station's stories are offered by title; one plays, comes back marked, and Continue moves the walk on @pr", async ({
  page,
}) => {
  await atTheGate(page);
  await expect(picks(page)).toHaveText(["The arch", LONG_TITLE]);
  // The first story has the focus: the buttons replaced what held it.
  await expect(picks(page).first()).toBeFocused();
  // Free content stands before any story is picked.
  const free = await page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    t.emitFrames(1);
    const root = t.fakeScene.children.find(
      (/** @type {any} */ c) => c.name === "station-content:gate",
    );
    /** @param {any} o @returns {string[]} */
    const ids = (o) => [
      ...(typeof o.userData?.objectId === "string"
        ? [o.userData.objectId]
        : []),
      ...(o.children ?? []).flatMap(ids),
    ];
    return root === undefined ? [] : ids(root);
  });
  expect(free).toContain("gate-pin");

  await picks(page).first().click();
  await expect(page.getByTestId("scene-text")).toHaveText(
    "Built in 1400 and rebuilt twice.",
  );
  await expect(picks(page)).toHaveCount(0);
  await page.getByTestId("scene-continue").click();

  await expect(page.getByTestId("scene-text")).toHaveText("Choose a story");
  await expect(picks(page)).toHaveText(["✓ The arch", LONG_TITLE]);
  await expect(picks(page).first()).toBeFocused();

  await page.getByTestId("scene-continue").click();
  await expect(page.getByTestId("scene-panel")).toBeHidden();
  await expect(page.getByTestId("walk-sheet")).toContainText("The well");
});

test("the last unplayed story ends the station; a one-story station starts directly", async ({
  page,
}) => {
  await atTheGate(page);
  await picks(page).first().click();
  await page.getByTestId("scene-continue").click();
  await picks(page).nth(1).click();
  await expect(page.getByTestId("scene-text")).toHaveText(
    "Sixty years, and never a day off.",
  );
  await page.getByTestId("scene-continue").click();
  await expect(page.getByTestId("scene-panel")).toBeHidden();

  // The well, with its one story: no picker, as before.
  for (let m = 5, s = 1; m <= 30; m += 5, s += 1) await standAt(page, m, 0, s);
  await forceTrackingReady(page);
  await expect(page.getByTestId("scene-title")).toHaveText("The well");
  await expect(picks(page)).toHaveCount(0);
  await expect(page.getByTestId("scene-text")).not.toHaveText("Choose a story");
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1440, height: 900 },
]) {
  test(`the picker's order and gaps at ${String(viewport.width)}x${String(viewport.height)}`, async ({
    page,
  }) => {
    // Why this test matters: there is no prototype for this panel, and the
    // design system zeroes paragraph margins, so "visible" would pass a
    // broken layout. Pinned: every button inside the panel, whatever the
    // title's length, under the description and above Continue.
    await page.setViewportSize(viewport);
    await atTheGate(page);
    const panel = await box(page.getByTestId("scene-panel"));
    const description = await box(page.getByTestId("scene-description"));
    const continueButton = page.getByTestId("scene-continue");
    await continueButton.scrollIntoViewIfNeeded();
    const go = await box(continueButton);
    const after = await box(page.getByTestId("scene-panel"));
    let lastBottom = description.y - panel.y + description.height;
    for (const pick of await picks(page).all()) {
      const b = await box(pick);
      expect(b.x).toBeGreaterThanOrEqual(after.x - 0.5);
      expect(b.x + b.width).toBeLessThanOrEqual(after.x + after.width + 0.5);
      expect(b.height).toBeGreaterThanOrEqual(36);
      expect(b.y - after.y).toBeGreaterThanOrEqual(lastBottom);
      lastBottom = b.y - after.y + b.height;
    }
    const last = await box(picks(page).last());
    expect(go.y).toBeGreaterThanOrEqual(last.y + last.height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}
