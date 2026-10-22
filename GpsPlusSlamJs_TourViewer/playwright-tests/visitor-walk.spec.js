// @ts-check
import { expect, test } from "@playwright/test";

import {
  installTourViewerArFakes,
  lockFixtureCode,
  seedAlignment,
  standAt,
} from "./ar-fakes.js";

/**
 * The visitor's walk in AR (visitor walk W4 build plan M2): the sheet with
 * its peek, the story card in the peek's place and the list, the coach, the
 * toast, and the progress kept on the start page after leaving AR. Today's
 * rules are kept (skip, undo, the texts), so this drives the page the way
 * `stations.spec.js` does and reads the new surfaces. The fixture
 * (`archive-server.mjs`, `/ranges-ok/walk-tour.zip`) is the W4 prototype's
 * "Old town walk": the gate 28 m north, the well (82 N, 34 E), the tower
 * (170 N, 48 W), the garden (240 N, 46 E), any order, stories of lines
 * that advance by themselves (the fakes' timers).
 */

const WALK_ARCHIVE = "http://127.0.0.1:5197/ranges-ok/walk-tour.zip";
/** The same walk in fixed order: one station offered at a time. */
const FIXED_WALK_ARCHIVE =
  "http://127.0.0.1:5197/ranges-ok/walk-tour-fixed.zip";

/** The prototype's stations: where each stands and its story's length. */
const STATIONS = [
  { id: "gate", title: "The gate", north: 28, east: 0, lines: 3 },
  { id: "well", title: "The well", north: 82, east: 34, lines: 3 },
  { id: "tower", title: "The tower", north: 170, east: -48, lines: 2 },
  { id: "garden", title: "The garden", north: 240, east: 46, lines: 3 },
];

test.beforeEach(async ({ page }) => {
  await installTourViewerArFakes(page);
});

/** Open the walk as a visitor; wait until its start is offered. */
async function openTheWalk(page, archive = WALK_ARCHIVE) {
  await page.goto(`/?qr=${encodeURIComponent(archive)}`);
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    { timeout: 15000 },
  );
  await expect(page.getByTestId("enter-ar")).toBeEnabled({ timeout: 10000 });
}

/** Start AR at the code: aligned, standing at the zero, the code locked. */
async function enterAtTheCode(page) {
  await page.getByTestId("enter-ar").click();
  await seedAlignment(page);
  await standAt(page, 0, 0, 0);
  await lockFixtureCode(page);
  await expect(page.getByTestId("walk-sheet")).toBeVisible();
}

/** Fire the fakes' timers (a story's auto steps) n times. */
async function fireTimers(page, n = 1) {
  for (let i = 0; i < n; i += 1) {
    await page.evaluate(() => {
      /** @type {any} */ (window).__tourViewerTest.fireTimers();
    });
  }
}

/** Stand at a station and let its story play to its end. */
async function visit(page, station, second) {
  await standAt(page, station.north, station.east, second);
  await expect(page.getByTestId("walk-story")).toBeVisible();
  await expect(page.getByTestId("scene-title")).toHaveText(station.title);
  // Each line moves on after its timer; the last one ends the story.
  await expect
    .poll(
      async () => {
        await fireTimers(page);
        return page.getByTestId("walk-story").isHidden();
      },
      { timeout: 15000 },
    )
    .toBe(true);
}

test("the peek names the nearest station; the list opens by the grab and by a drag, and closes", async ({
  page,
}) => {
  // Why this test matters (W4 build plan M2, §1.5): the sheet replaces the
  // line over the camera, so the visitor must read the next station and
  // its distance in the peek, and reach every station in the list by the
  // two gestures W4 offers. The hidden line keeps saying the same.
  await openTheWalk(page);
  await enterAtTheCode(page);
  const sheet = page.getByTestId("walk-sheet");
  await expect(sheet).toHaveAttribute("data-sheet", "peek");
  await expect(page.getByTestId("walk-eyebrow")).toHaveText(
    "4 stations to find - nearest",
  );
  await expect(page.getByTestId("walk-title")).toHaveText("The gate");
  await expect(page.getByTestId("walk-distance")).toHaveText(/^2\d m$/);
  await expect(page.getByTestId("station-line")).toHaveText(
    /^4 stations to find - nearest: The gate, 2\d m$/,
  );
  await expect(page.getByTestId("walk-segments").locator("i")).toHaveCount(4);
  await expect(page.getByTestId("walk-list")).toBeHidden();
  // This tour's stations hold only stories, so nothing is placed and the
  // sentence stays at "placing the tour"; the found card and the coach
  // still give way to the walk.
  await expect(page.locator("#scan-card")).toBeHidden();
  await expect(page.getByTestId("walk-coach")).toBeHidden();

  // A tap on the grab opens the list: every station, the tour's title,
  // its order and the count.
  await page.getByTestId("walk-grab").click();
  await expect(sheet).toHaveAttribute("data-sheet", "list");
  await expect(page.getByTestId("walk-list")).toBeVisible();
  await expect(page.getByTestId("walk-list-title")).toHaveText("Old town walk");
  await expect(page.getByTestId("walk-chip")).toHaveText("Any order");
  await expect(page.getByTestId("walk-progress")).toHaveText(
    "0 of 4 found - 4 to find",
  );
  const rows = page.getByTestId("walk-row");
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toHaveAttribute("data-state", "next");
  await expect(rows.first().getByTestId("walk-row-sub")).toHaveText(/^2\d m$/);
  await expect(page.getByTestId("walk-grab")).toHaveAttribute(
    "aria-label",
    "Hide the list",
  );
  // Close closes it.
  await page.getByTestId("walk-close").click();
  await expect(sheet).toHaveAttribute("data-sheet", "peek");
  await expect(page.getByTestId("walk-list")).toBeHidden();

  // A drag up on the peek opens it, a drag down on the grab closes it; a
  // slip shorter than the threshold is a tap (it toggles, as a tap does).
  const peek = await page.getByTestId("walk-peek").boundingBox();
  if (peek === null) throw new Error("no peek");
  const x = peek.x + peek.width / 2;
  const y = peek.y + peek.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 10, { steps: 2 });
  await page.mouse.up();
  await expect(sheet).toHaveAttribute("data-sheet", "list");
  await page.getByTestId("walk-close").click();
  await expect(sheet).toHaveAttribute("data-sheet", "peek");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 60, { steps: 6 });
  await page.mouse.up();
  await expect(sheet).toHaveAttribute("data-sheet", "list");
  const grab = await page.getByTestId("walk-grab").boundingBox();
  if (grab === null) throw new Error("no grab");
  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
  await page.mouse.down();
  await page.mouse.move(grab.x + grab.width / 2, grab.y + 60, { steps: 6 });
  await page.mouse.up();
  await expect(sheet).toHaveAttribute("data-sheet", "peek");
});

test("a found station's story takes the peek's place with its dots, and its end is the card's", async ({
  page,
}) => {
  // Why this test matters (§1.5): while a story plays the card stands
  // where the peek was, its dots follow the lines, and "End this story"
  // (two taps, with "Keep listening" beside the confirm) moved from the
  // skip button to the card. Opening the list hides the card; a find
  // closes the list again. Fixed order: today's rule offers the end only
  // while nothing unfound is offered (K4 review R9).
  await openTheWalk(page, FIXED_WALK_ARCHIVE);
  await enterAtTheCode(page);
  await page.getByTestId("walk-grab").click();
  await expect(page.getByTestId("walk-sheet")).toHaveAttribute(
    "data-sheet",
    "list",
  );
  await standAt(page, 26, 0, 1);
  // The find closes the list: the story card takes the peek's place.
  await expect(page.getByTestId("walk-sheet")).toHaveAttribute(
    "data-sheet",
    "peek",
  );
  const story = page.getByTestId("walk-story");
  await expect(story).toBeVisible();
  await expect(page.getByTestId("walk-peek")).toBeHidden();
  await expect(page.getByTestId("scene-text")).toHaveText(
    "Until 1840 this gate was shut every night at dusk.",
  );
  const dots = page.getByTestId("walk-dots").locator("i");
  await expect(dots).toHaveCount(3);
  await expect(dots.nth(0)).toHaveAttribute("data-s", "now");
  await expect(dots.nth(0)).toHaveAttribute("data-timed", "true");
  await fireTimers(page);
  await expect(page.getByTestId("scene-text")).toHaveText(
    "Traders who came late slept outside the walls, beside their carts.",
  );
  await expect(dots.nth(0)).toHaveAttribute("data-s", "on");
  await expect(dots.nth(1)).toHaveAttribute("data-s", "now");

  // The end control: ask, then Keep listening takes it back.
  const end = page.getByTestId("story-end");
  await expect(end).toHaveText("End this story?");
  await expect(page.getByTestId("station-skip")).toBeHidden();
  await expect(page.getByTestId("keep-listening")).toBeHidden();
  await end.click();
  await expect(end).toHaveText("End the story of The gate now");
  await expect(page.getByTestId("keep-listening")).toBeVisible();
  await page.getByTestId("keep-listening").click();
  await expect(end).toHaveText("End this story?");
  await expect(page.getByTestId("keep-listening")).toBeHidden();
  await expect(story).toBeVisible();
  // Two taps end it: the peek is back, naming the next station.
  await end.click();
  await end.click();
  await expect(story).toBeHidden();
  await expect(page.getByTestId("walk-peek")).toBeVisible();
  await expect(page.getByTestId("walk-eyebrow")).toHaveText(
    "Next - station 2 of 4",
  );
  await expect(page.getByTestId("walk-title")).toHaveText("The well");
});

test("the quick skip takes two taps and its undo one; each is said in a toast", async ({
  page,
}) => {
  // Why this test matters (§1.4, today's rules kept): the skip still asks
  // first and names the station, the undo still brings it back for a
  // moment - and what happened is said in the toast now, not the line.
  await openTheWalk(page);
  await enterAtTheCode(page);
  const quick = page.getByTestId("station-skip");
  await expect(quick).toHaveText("Can't get there?");
  await expect(quick).toHaveAttribute("data-kind", "ask");
  await quick.click();
  await expect(quick).toHaveText("Skip The gate - I can't get there");
  await expect(quick).toHaveAttribute("data-kind", "suggested");
  await quick.click();
  const toast = page.locator("#walk-toast");
  await expect(toast).toHaveText("Skipped The gate.");
  await expect(quick).toHaveText("Undo: bring back The gate");
  await expect(quick).toHaveAttribute("data-kind", "undo");
  await expect(
    page.getByTestId("walk-segments").locator("i").first(),
  ).toHaveAttribute("data-s", "skipped");
  await quick.click();
  await expect(toast).toHaveText("Brought back The gate.");
  await expect(quick).toHaveText("Can't get there?");
});

test("the completion opens the list once, with its card and the way out", async ({
  page,
}) => {
  // Why this test matters (§1.6): the end of the walk is shown, not only
  // said - the list opens on its own with the completion card - and only
  // once: a visitor who closed it is not pulled back into it.
  await openTheWalk(page);
  await enterAtTheCode(page);
  let second = 1;
  for (const station of STATIONS) {
    await visit(page, station, second);
    second += 1;
  }
  const sheet = page.getByTestId("walk-sheet");
  await expect(sheet).toHaveAttribute("data-sheet", "list");
  await expect(sheet).toHaveAttribute("data-complete", "true");
  await expect(page.getByTestId("walk-done")).toBeVisible();
  await expect(page.getByTestId("walk-done-title")).toHaveText(
    "Tour complete - every station visited.",
  );
  await expect(page.getByTestId("walk-done-text")).toHaveText(
    "Thank you for walking with us.",
  );
  await expect(page.getByTestId("walk-exit")).toBeVisible();
  await expect(page.getByTestId("walk-row")).toHaveCount(4);
  await page.getByTestId("walk-close").click();
  await expect(sheet).toHaveAttribute("data-sheet", "peek");
  await expect(page.getByTestId("walk-title")).toHaveText("Tour complete");
  // Later frames do not open it again.
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.emitFrames(3);
  });
  await standAt(page, 240, 47, second);
  await expect(sheet).toHaveAttribute("data-sheet", "peek");
  // "Exit AR" on the card is the session's own way out.
  await page.getByTestId("walk-grab").click();
  await page.getByTestId("walk-exit").click();
  await expect(page.getByTestId("enter-ar")).toHaveText("Back to the tour");
});

test("leaving AR shows the progress on the start page; coming back is welcomed", async ({
  page,
}) => {
  // Why this test matters (§1.8): a visitor who leaves AR mid-walk sees
  // what was found on the start page and goes "Back to the tour" with the
  // same tap; inside, the toast says the progress was kept.
  await openTheWalk(page);
  await expect(page.getByTestId("walk-away")).toBeHidden();
  await expect(page.getByTestId("enter-ar")).toHaveText("Start the tour");
  await enterAtTheCode(page);
  await visit(page, STATIONS[0], 1);
  await page.getByTestId("enter-ar").click(); // in AR: the way out
  const away = page.getByTestId("walk-away");
  await expect(away).toBeVisible();
  await expect(page.getByTestId("walk-away-text")).toHaveText(
    "You left AR. Your progress is kept while this page is open.",
  );
  const rows = page.getByTestId("walk-away-row");
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText("The gate");
  await expect(rows.first()).toContainText("Found");
  await expect(page.getByTestId("enter-ar")).toHaveText("Back to the tour");
  await expect(page.getByTestId("walk-sheet")).toBeHidden();

  await enterAtTheCode(page);
  await expect(away).toBeHidden();
  await expect(page.locator("#walk-toast")).toHaveText(
    "Welcome back - your progress is kept.",
  );
  await expect(page.getByTestId("walk-eyebrow")).toHaveText(
    "3 stations to find - nearest",
  );
});

test("the start says 'Starting AR…' in the coach, and a failed start can be tried again", async ({
  page,
}) => {
  // Why this test matters (§1.4, the async-UI rule): the AR start takes a
  // moment with nothing else on screen, so the coach says so with its
  // spinner; a start that fails goes back to the page with "Try again",
  // and the second try starts.
  await openTheWalk(page);
  await page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    t.failNextInitAR = true;
  });
  await page.getByTestId("enter-ar").click();
  await expect(page.getByTestId("enter-ar")).toHaveText("Try again");
  await expect(page.getByTestId("walk-coach")).toBeHidden();
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.holdInitAR = true;
  });
  await page.getByTestId("enter-ar").click();
  const coach = page.getByTestId("walk-coach");
  await expect(coach).toBeVisible();
  await expect(coach).toHaveAttribute("data-look", "spinner");
  await expect(page.getByTestId("walk-coach-text")).toHaveText("Starting AR…");
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.releaseInitAR();
  });
  await expect(page.getByTestId("walk-coach-text")).not.toHaveText(
    "Starting AR…",
  );
  await seedAlignment(page);
  await standAt(page, 0, 0, 0);
  await lockFixtureCode(page);
  await expect(page.getByTestId("walk-sheet")).toBeVisible();
});
