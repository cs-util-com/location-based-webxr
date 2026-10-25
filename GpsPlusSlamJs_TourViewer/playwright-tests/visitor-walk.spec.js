// @ts-check
import { expect, test } from "@playwright/test";

import {
  forceTrackingReady,
  installTourViewerArFakes,
  lockFixtureCode,
  reportArTracking,
  seedAlignment,
  standAt,
  waitForTheGuess,
  walkRowControl,
} from "./ar-fakes.js";

/**
 * The visitor's walk in AR: the sheet with
 * its peek, the story card in the peek's place and the list, the coach, the
 * toast, and the progress kept on the start page after leaving AR. Today's
 * rules are kept (skip, undo, the texts), so this drives the page the way
 * `stations.spec.js` does and reads the new surfaces. The fixture
 * (`archive-server.mjs`, `/ranges-ok/walk-tour.zip`) is the the prototype prototype's
 * "Old town walk": the gate 28 m north, the well (82 N, 34 E), the tower
 * (170 N, 48 W), the garden (240 N, 46 E), any order, stories of lines
 * that advance by themselves (the fakes' timers).
 */

const WALK_ARCHIVE = "http://127.0.0.1:5197/ranges-ok/walk-tour.zip";
/** The same walk in fixed order: one station offered at a time. */
const FIXED_WALK_ARCHIVE =
  "http://127.0.0.1:5197/ranges-ok/walk-tour-fixed.zip";

/** The stations tour (`stations.spec.js`): stations holding content
 *  (a pin each at the gate and the well), and the same tour without its
 *  printed code. */
const STATIONS_ARCHIVE = "http://127.0.0.1:5197/ranges-ok/stations-tour.zip";
const NO_CODE_ARCHIVE =
  "http://127.0.0.1:5197/ranges-ok/stations-tour-no-code.zip";

/** The words the status says while the guide waits for a heading. */
const WALK = "Walk a few steps so the guide knows the direction.";

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

/** Start AR at the code: aligned, standing at the zero, the code locked,
 *  the tracking reported (the fakes deliver no poses, so without one the
 *  walk reads tracking lost and offers no skip); then, unless `guess` is
 *  false, wait out the hold after a missing distance so the peek names a station. */
async function enterAtTheCode(page, { guess = true } = {}) {
  await page.getByTestId("enter-ar").click();
  await seedAlignment(page);
  await standAt(page, 0, 0, 0);
  await lockFixtureCode(page);
  await expect(page.getByTestId("walk-sheet")).toBeVisible();
  await trackingOk(page);
  if (guess) await waitForTheGuess(page);
}

/** One tracking-quality report: "ok" through the shared fake, any other
 *  state (`degraded`: running, no heading earned yet) here. */
async function reportTracking(page, state) {
  if (state === "ok") {
    await forceTrackingReady(page);
    return;
  }
  await page.evaluate((state) => {
    /** @type {any} */ (window).__tourViewerTest.alignmentStore.dispatch({
      type: "trackingQuality/reportUpdated",
      payload: {
        state,
        confidence: 0.5,
        subScores: {
          convergence: 0.5,
          residualConsensus: 0.5,
          gpsAccuracy: 1,
          coverage: 0.5,
        },
        diagnostics: {},
      },
    });
  }, state);
}

/** The status's state once tracking reports `state` and a frame passes
 *  (the fakes send frames without poses, so quality decays between
 *  reports; each poll reports it again). */
async function statusWith(page, state, expected) {
  await expect
    .poll(
      async () => {
        await reportTracking(page, state);
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        await reportTracking(page, state);
        return page.getByTestId("ar-status").getAttribute("data-state");
      },
      { timeout: 20000 },
    )
    .toBe(expected);
}

/** AR tracking with a pose, and the report ready around a camera frame
 *  (the fakes deliver no poses, so the report reads lost after every
 *  recompute until one is reported; as the radar spec does). */
async function trackingOk(page) {
  await reportArTracking(page, true);
  await forceTrackingReady(page);
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
  });
  await forceTrackingReady(page);
}

/** Skip the scan by its escape: the tour is placed by GPS. */
async function skipTheCode(page) {
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.fireTimers();
  });
  await page.getByTestId("scan-escape").click();
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
  // Why this test matters: the sheet replaces the
  // line over the camera, so the visitor must read the next station and
  // its distance in the peek, and reach every station in the list by the
  // two gestures the prototype offers. The hidden line keeps saying the same.
  await openTheWalk(page);
  await enterAtTheCode(page);
  const sheet = page.getByTestId("walk-sheet");
  await expect(sheet).toHaveAttribute("data-sheet", "peek");
  await expect(page.getByTestId("walk-eyebrow")).toHaveText(
    "4 stations to find - nearest",
  );
  await expect(page.getByTestId("walk-title")).toHaveText("The gate");
  await expect(page.getByTestId("walk-distance-text")).toHaveText(/^2\d m$/);
  await expect(page.getByTestId("station-line")).toHaveText(
    /^4 stations to find - nearest: The gate, 2\d m$/,
  );
  await expect(page.getByTestId("walk-segments").locator("i")).toHaveCount(4);
  await expect(page.getByTestId("walk-list")).toBeHidden();
  // This tour's stations hold only stories, so no content stands; the
  // running walk still makes it a placed tour, so neither
  // the found card nor a placement wait stands over the walk, and the
  // screen reader's copy says the same.
  await expect(page.locator("#scan-card")).toBeHidden();
  await statusWith(page, "ok", "placed");
  await expect(page.getByTestId("walk-coach")).toBeHidden();
  await expect(page.getByTestId("ar-status-live")).toHaveText(
    "Tour placed. Look around.",
  );
  // The status's own sentence too: never "placing the tour" for a tour
  // whose stations hold only stories.
  await expect(page.getByTestId("ar-status")).toHaveText(
    "Tour placed. Look around.",
  );

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
  // With the code's heading the row says which way too: the camera looks north, the gate stands north.
  await expect(rows.first().getByTestId("walk-row-sub")).toHaveText(
    /^2\d m - ahead$/,
  );
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
  // Why this test matters: while a story plays the card stands
  // where the peek was, its dots follow the lines, and "End this story"
  // (two taps, with "Keep listening" beside the confirm) moved from the
  // skip button to the card. Opening the list hides the card; a find
  // closes the list again. While the end is asked the story waits: its
  // step's timer stops, and "Keep listening" starts it again.
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
  await expect(page.getByTestId("scene-continue")).toBeVisible();
  await end.click();
  await expect(end).toHaveText("End the story of The gate now");
  await expect(page.getByTestId("keep-listening")).toBeVisible();
  // Under the question the card offers only its two answers: the
  // next step waits for Keep listening.
  await expect(page.getByTestId("scene-continue")).toBeHidden();
  // Held: no timer runs under the question, the dot shows no timed fill.
  await expect(dots.nth(1)).not.toHaveAttribute("data-timed", "true");
  await fireTimers(page);
  await expect(page.getByTestId("scene-text")).toHaveText(
    "Traders who came late slept outside the walls, beside their carts.",
  );
  await page.getByTestId("keep-listening").click();
  await expect(end).toHaveText("End this story?");
  await expect(page.getByTestId("scene-continue")).toBeVisible();
  await expect(dots.nth(1)).toHaveAttribute("data-timed", "true");
  await expect(page.getByTestId("keep-listening")).toBeHidden();
  await expect(story).toBeVisible();
  // The focus is not dropped with the hidden button: it
  // moves to the end control beside it.
  await expect(end).toBeFocused();
  // Two taps end it: the peek is back, naming the next station, and the
  // focus that sat on the card's end control is on the grab.
  await end.click();
  await end.click();
  await expect(story).toBeHidden();
  await expect(page.getByTestId("walk-grab")).toBeFocused();
  await expect(page.getByTestId("walk-peek")).toBeVisible();
  await expect(page.getByTestId("walk-eyebrow")).toHaveText(
    "Next - station 2 of 4",
  );
  await expect(page.getByTestId("walk-title")).toHaveText("The well");
});

test("a running walk speaks as a placed tour: placed, placed by GPS with its request for steps, and finding the direction", async ({
  page,
}) => {
  // Why this test matters: a first fix for a
  // tour of stories hid the placement wait under the sheet, and with it
  // the request for steps and the GPS placement's reason; the hidden
  // sentence and the live region stayed in the wait. These tours' stations
  // hold content, so each path is the real one: the code (placed), the
  // scan skipped while no heading is earned (placed by GPS, its toast,
  // its request for steps on the coach and the code asked for in the
  // peek), and a tour without a code (finding the direction).
  await openTheWalk(page, STATIONS_ARCHIVE);
  await enterAtTheCode(page);
  await statusWith(page, "ok", "placed");
  await expect(page.getByTestId("ar-status-live")).toHaveText(
    "Tour placed. Look around.",
  );
  await expect(page.getByTestId("walk-coach")).toBeHidden();
  await expect(page.locator("#scan-card")).toBeHidden();

  await openTheWalk(page, STATIONS_ARCHIVE);
  await page.getByTestId("enter-ar").click();
  await seedAlignment(page);
  await skipTheCode(page);
  await statusWith(page, "degraded", "placed-gps");
  await expect(page.getByTestId("ar-status-live")).toHaveText(
    `Tour placed by GPS (less exact). ${WALK} Find the poster's code to line it up.`,
  );
  await expect(page.locator("#walk-toast")).toHaveText(
    "Tour placed by GPS (less exact)",
  );
  await expect(page.getByTestId("walk-coach-text")).toHaveText(WALK);
  await expect(page.getByTestId("walk-code-tail")).toHaveText(
    "Find the poster's code to line it up.",
  );

  await openTheWalk(page, NO_CODE_ARCHIVE);
  await page.getByTestId("enter-ar").click();
  await seedAlignment(page);
  await expect(page.getByTestId("walk-sheet")).toBeVisible();
  await statusWith(page, "degraded", "finding-direction");
  await expect(page.getByTestId("ar-status-live")).toHaveText(WALK);
  await expect(page.getByTestId("walk-coach-text")).toHaveText(WALK);
  // A walk earns the heading: the request goes.
  await standAt(page, 2, 1, 1);
  await statusWith(page, "ok", "placed");
  await expect(page.getByTestId("walk-coach")).toBeHidden();
});

test("a tour of stories placed by GPS still asks for steps while no heading is earned", async ({
  page,
}) => {
  // Why this test matters: the case the first fix broke -
  // no content stands, so only the running walk makes the tour placed,
  // and without it the request for steps never reached the visitor.
  await openTheWalk(page);
  await page.getByTestId("enter-ar").click();
  await seedAlignment(page);
  await skipTheCode(page);
  await statusWith(page, "degraded", "placed-gps");
  await expect(page.getByTestId("walk-coach-text")).toHaveText(WALK);
  await expect(page.locator("#walk-toast")).toHaveText(
    "Tour placed by GPS (less exact)",
  );
});

test("'Can't get there?' opens the list on its row; the confirm skips, the row's undo brings it back; each is said in a toast", async ({
  page,
}) => {
  // Why this test matters: the quick
  // action opens the list with the focus's row asking for its confirm,
  // the rows carry Skip, its confirm, the undo with its bar and
  // Bring back, and what happened is said in the toast (the async-UI
  // rule's final state). The focus follows each tap's control to what
  // takes its place.
  await openTheWalk(page);
  await enterAtTheCode(page);
  const sheet = page.getByTestId("walk-sheet");
  const quick = page.getByTestId("station-skip");
  await expect(quick).toHaveText("Can't get there?");
  await expect(quick).toHaveAttribute("data-kind", "ask");
  await quick.click();
  await expect(sheet).toHaveAttribute("data-sheet", "list");
  // The quick action goes while the list is open; its focus moves to the
  // armed row's confirm.
  await expect(quick).toBeHidden();
  const confirm = walkRowControl(page, "The gate", "confirm");
  await expect(confirm).toHaveText("Skip The gate - I can't get there");
  await expect(confirm).toBeFocused();
  await expect(walkRowControl(page, "The gate", "cancel")).toBeVisible();
  await expect(walkRowControl(page, "The gate", "act")).toHaveCount(0);
  await confirm.click();
  const toast = page.locator("#walk-toast");
  await expect(toast).toHaveText("Skipped The gate.");
  const undo = walkRowControl(page, "The gate", "act");
  await expect(undo).toHaveText("Undo: bring back The gate");
  await expect(undo).toHaveAttribute("data-k", "undo");
  await expect(undo).toBeFocused();
  await expect(
    page.getByTestId("walk-row").filter({ hasText: "The gate" }),
  ).toHaveAttribute("data-state", "skipped");
  await expect(page.getByTestId("walk-undobar")).toBeVisible();
  await expect(
    page.getByTestId("walk-segments").locator("i").first(),
  ).toHaveAttribute("data-s", "skipped");
  await undo.click();
  await expect(toast).toHaveText("Brought back The gate.");
  await expect(walkRowControl(page, "The gate", "act")).toHaveText("Skip");
  await expect(page.getByTestId("walk-undobar")).toHaveCount(0);

  // Another row's Skip asks first; Cancel takes the ask back.
  await walkRowControl(page, "The tower", "act").click();
  await expect(walkRowControl(page, "The tower", "confirm")).toHaveText(
    "Skip The tower - I can't get there",
  );
  await walkRowControl(page, "The tower", "cancel").click();
  await expect(walkRowControl(page, "The tower", "act")).toBeFocused();
  await expect(walkRowControl(page, "The tower", "confirm")).toHaveCount(0);

  // The quick action's own undo, with the list closed.
  await walkRowControl(page, "The tower", "act").click();
  await walkRowControl(page, "The tower", "confirm").click();
  await expect(toast).toHaveText("Skipped The tower.");
  await page.getByTestId("walk-close").click();
  await expect(quick).toHaveText("Undo: bring back The tower");
  await expect(quick).toHaveAttribute("data-kind", "undo");
  await quick.click();
  await expect(toast).toHaveText("Brought back The tower.");
  await expect(quick).toHaveText("Can't get there?");
});

test("a row's metres change in place as the visitor walks: the row and the focus on it survive", async ({
  page,
}) => {
  // Why this test matters: the sheet redraws on every guide call, and a
  // row rebuilt for a new metre or direction word drops a tap in flight
  // and the keyboard's or screen reader's focus. The sub line and the
  // title's accessible name are written in place; the row is the same
  // element after the walk.
  await openTheWalk(page);
  await enterAtTheCode(page);
  await page.getByTestId("walk-grab").click();
  const row = page.getByTestId("walk-row").filter({ hasText: "The well" });
  const sub = row.getByTestId("walk-row-sub");
  const main = row.getByTestId("walk-row-main");
  await expect(sub).toHaveText(/^89 m/);
  await main.focus();
  await row.evaluate((li) => {
    li.dataset["kept"] = "yes";
  });
  await standAt(page, 6, 0, 1);
  await expect(sub).toHaveText(/^83 m/);
  await expect(main).toHaveAttribute("aria-label", /^The well: 83 m/);
  await expect(row).toHaveAttribute("data-kept", "yes");
  await expect(main).toBeFocused();
});

test("while tracking is lost no skip is offered, and it comes back with the tracking", async ({
  page,
}) => {
  // Why this test matters: with tracking lost the guide cannot tell where
  // the visitor is, so the peek's quick action and the rows' Skip are
  // hidden (a skip made then would be made blind); they return with the
  // tracking.
  await openTheWalk(page);
  await enterAtTheCode(page);
  const quick = page.getByTestId("station-skip");
  await expect(quick).toHaveText("Can't get there?");
  await page.getByTestId("walk-grab").click();
  await expect(walkRowControl(page, "The gate", "act")).toHaveText("Skip");
  await reportArTracking(page, false);
  await expect(page.getByTestId("walk-precision-text")).toHaveText(
    "Paused - tracking lost",
  );
  await expect(walkRowControl(page, "The gate", "act")).toHaveCount(0);
  await page.getByTestId("walk-close").click();
  await expect(quick).toBeHidden();
  await trackingOk(page);
  await expect(page.getByTestId("walk-precision-text")).toHaveText(
    "Placed by a code",
  );
  await expect(quick).toHaveText("Can't get there?");
});

test("a chosen target leads the peek, the line and its row until it is tapped again", async ({
  page,
}) => {
  // Why this test matters: "Guide me here" on a
  // row makes that station the walk's target - the peek, the hidden line
  // and the row say so - whatever is nearest; tapped again, the nearest
  // leads again.
  await openTheWalk(page);
  await enterAtTheCode(page);
  await expect(page.getByTestId("walk-title")).toHaveText("The gate");
  await page.getByTestId("walk-grab").click();
  const tower = walkRowControl(page, "The tower", "main");
  await expect(tower).toHaveAttribute(
    "aria-label",
    /^The tower: \d+ m.*\. Guide me here$/,
  );
  await tower.click();
  const row = page.getByTestId("walk-row").filter({ hasText: "The tower" });
  await expect(row).toHaveAttribute("data-chosen", "true");
  await expect(row).toHaveAttribute("data-state", "next");
  await expect(tower).toHaveAttribute("aria-pressed", "true");
  await expect(tower).toBeFocused();
  await expect(row.getByTestId("walk-row-sub")).toHaveText(
    /^\d+ m.* - your choice$/,
  );
  await expect(page.getByTestId("walk-eyebrow")).toHaveText(
    "4 stations to find - your choice",
  );
  await expect(page.getByTestId("walk-title")).toHaveText("The tower");
  await expect(page.getByTestId("station-line")).toHaveText(
    /^4 stations to find - your choice: The tower, \d+ m$/,
  );
  // Tapped again: no choice, the nearest leads.
  await tower.click();
  await expect(row).not.toHaveAttribute("data-chosen", "true");
  await expect(page.getByTestId("walk-title")).toHaveText("The gate");
  await expect(page.getByTestId("walk-eyebrow")).toHaveText(
    "4 stations to find - nearest",
  );
});

test("with no position the walk names no station: the chooser asks which one, and one tap on a row skips it", async ({
  page,
}) => {
  // Why this test matters: a visitor
  // without location whose code lost its trust (an odometry frame change)
  // has no position anyone vouches for; no text may name a station as
  // next or nearest - not the peek, not the hidden line, not the quick
  // action - and "Can't get there?" opens the list to ask which one.
  await page.addInitScript(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    if (t) t.locationPermission = "denied";
  });
  await openTheWalk(page);
  const button = page.getByTestId("enter-ar");
  await button.click();
  await expect(button).toHaveText("Exit AR");
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.arPose = {
      position: { x: 0, y: 1.4, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    };
  });
  await lockFixtureCode(page);
  await trackingOk(page);
  await waitForTheGuess(page);
  await expect(page.getByTestId("walk-title")).toHaveText("The gate");
  // The code goes out of sight and the odometry frame changes.
  await page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    t.nextDetection = null;
    t.alignmentStore.dispatch({ type: "qrDetected/qrFrameChanged" });
  });
  await trackingOk(page);
  const peek = page.getByTestId("walk-peek");
  await expect(peek).toHaveAttribute("data-kind", "none");
  await expect(page.getByTestId("walk-eyebrow")).toHaveText("Position unknown");
  await expect(page.getByTestId("walk-title")).toHaveText("4 stations to find");
  const line = page.getByTestId("station-line");
  await expect(line).toHaveText(
    "4 stations to find - scan one of the tour's codes so the guide knows where you are.",
  );
  const quick = page.getByTestId("station-skip");
  await expect(quick).toHaveText("Can't get there?");
  for (const station of STATIONS) {
    await expect(page.getByTestId("walk-peek")).not.toContainText(
      station.title,
    );
    await expect(line).not.toContainText(station.title);
    await expect(quick).not.toContainText(station.title);
  }
  await quick.click();
  await expect(page.getByTestId("walk-sheet")).toHaveAttribute(
    "data-sheet",
    "list",
  );
  await expect(page.getByTestId("walk-hint")).toHaveText(
    "Your position is unknown, so the guide can't tell which station is nearest. Which one can't you reach?",
  );
  // The hint is the question the rows answer: the list opens on the first
  // row's Skip, and each Skip is described by the hint, so a screen
  // reader hears the question with the control.
  const firstSkip = walkRowControl(page, "The gate", "act");
  await expect(firstSkip).toBeFocused();
  await expect(firstSkip).toHaveAttribute("aria-describedby", "walk-hint");
  await expect(walkRowControl(page, "The tower", "act")).toHaveAttribute(
    "aria-describedby",
    "walk-hint",
  );
  // No row is the next one, and none shows a distance.
  const rows = page.getByTestId("walk-row");
  await expect(
    page.locator('[data-testid="walk-row"][data-state="next"]'),
  ).toHaveCount(0);
  for (const station of STATIONS) {
    const row = rows.filter({ hasText: station.title });
    await expect(row).toHaveAttribute("data-state", "left");
    await expect(row.getByTestId("walk-row-sub")).toHaveText(
      "Distance unknown",
    );
  }
  // In the chooser one tap on a row's Skip skips it; the undo covers a
  // mistake.
  await walkRowControl(page, "The well", "act").click();
  await expect(page.locator("#walk-toast")).toHaveText("Skipped The well.");
  await expect(walkRowControl(page, "The well", "act")).toHaveText(
    "Undo: bring back The well",
  );
  await expect(page.getByTestId("walk-hint")).toHaveText(
    "Your position is unknown - scan one of the tour's codes, or pick a station below.",
  );
});

test("a skipped station is brought back after the tour is complete, and the tour completes again", async ({
  page,
}) => {
  // Why this test matters: a skip is
  // never final - "Bring back" stays on a skipped row at any time, even
  // once the tour is complete, and the complete tour becomes incomplete
  // everywhere (the card, the segments, the peek), then complete again.
  await openTheWalk(page);
  await enterAtTheCode(page);
  await visit(page, STATIONS[0], 1);
  await visit(page, STATIONS[1], 2);
  await page.getByTestId("walk-grab").click();
  // Two skips: the second settles the first, whose row now says "Bring
  // back" rather than the undo.
  await walkRowControl(page, "The tower", "act").click();
  await walkRowControl(page, "The tower", "confirm").click();
  await walkRowControl(page, "The garden", "act").click();
  await walkRowControl(page, "The garden", "confirm").click();
  const sheet = page.getByTestId("walk-sheet");
  await expect(sheet).toHaveAttribute("data-complete", "true");
  await expect(page.getByTestId("walk-done-title")).toHaveText(
    "Tour complete - 2 skipped.",
  );
  await expect(page.getByTestId("walk-done-text")).toHaveText(
    "2 of 4 found. A skipped station can still be brought back.",
  );
  const bring = walkRowControl(page, "The tower", "act");
  await expect(bring).toHaveText("Bring back");
  await expect(bring).toHaveAttribute("aria-label", "Bring back The tower");
  await bring.click();
  await expect(page.locator("#walk-toast")).toHaveText(
    "Brought back The tower.",
  );
  await expect(sheet).toHaveAttribute("data-complete", "false");
  await expect(page.getByTestId("walk-done")).toBeHidden();
  await expect(
    page.getByTestId("walk-segments").locator("i").nth(2),
  ).not.toHaveAttribute("data-s", "skipped");
  await expect(page.getByTestId("station-line")).toHaveText(
    /^(Brought back The tower\. )?Next: The tower, \d+ m$/,
  );
  // Skipped again, the tour is complete again.
  await walkRowControl(page, "The tower", "act").click();
  await walkRowControl(page, "The tower", "confirm").click();
  await expect(sheet).toHaveAttribute("data-complete", "true");
  await expect(page.getByTestId("walk-done-title")).toHaveText(
    "Tour complete - 2 skipped.",
  );
});

test("the completion opens the list once, with its card and the way out", async ({
  page,
}) => {
  // Why this test matters: the end of the walk is shown, not only
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
  // The card has no way out of its own: the X at the top left is the one.
  await expect(page.getByTestId("walk-exit")).toHaveCount(0);
  await expect(page.getByTestId("enter-ar")).toHaveText("Exit AR");
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
  // The X at the top left is the session's way out.
  await page.getByTestId("enter-ar").click();
  await expect(page.getByTestId("enter-ar")).toHaveText("Back to the tour");
});

test("leaving AR shows the progress on the start page; coming back is welcomed", async ({
  page,
}) => {
  // Why this test matters: a visitor who leaves AR mid-walk sees
  // what was found on the start page and goes "Back to the tour" with the
  // same tap; inside, the toast says the progress was kept.
  await openTheWalk(page);
  await expect(page.getByTestId("walk-away")).toBeHidden();
  await expect(page.getByTestId("enter-ar")).toHaveText("Start the tour");
  await enterAtTheCode(page);
  await visit(page, STATIONS[0], 1);
  // Leaving with the list open: the next entry starts at the peek, as
  // The prototype's does (the side-by-side check).
  await page.getByTestId("walk-grab").click();
  await expect(page.getByTestId("walk-sheet")).toHaveAttribute(
    "data-sheet",
    "list",
  );
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

  await enterAtTheCode(page, { guess: false });
  await expect(away).toBeHidden();
  await expect(page.locator("#walk-toast")).toHaveText(
    "Welcome back - your progress is kept.",
  );
  // The toast's root is hidden from a screen reader (its other words are
  // announced elsewhere); the welcome has its own polite region.
  await expect(page.getByTestId("walk-toast-root")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(page.getByTestId("walk-live")).toHaveText(
    "Welcome back - your progress is kept.",
  );
  await expect(page.getByTestId("walk-sheet")).toHaveAttribute(
    "data-sheet",
    "peek",
  );
  await waitForTheGuess(page);
  await expect(page.getByTestId("walk-eyebrow")).toHaveText(
    "3 stations to find - nearest",
  );
});

test("coming back to a tour of stories placed by GPS says both the placement and the welcome", async ({
  page,
}) => {
  // Why this test matters: on a tour of stories only the running walk
  // makes the tour placed, so the first sheet render of an entry both
  // re-renders the status (which says the GPS placement as news, once per
  // entry) and says the welcome back. Both reach the one toast in the
  // same frame; the second must not replace the first, or the placement
  // news is lost for the whole entry (it is never said again).
  await openTheWalk(page);
  await enterAtTheCode(page);
  await visit(page, STATIONS[0], 1);
  await page.getByTestId("enter-ar").click(); // in AR: the way out
  await expect(page.getByTestId("enter-ar")).toHaveText("Back to the tour");

  await page.getByTestId("enter-ar").click();
  await seedAlignment(page);
  await skipTheCode(page);
  await statusWith(page, "degraded", "placed-gps");
  await expect(page.getByTestId("walk-sheet")).toBeVisible();
  const toast = page.locator("#walk-toast");
  // Both, whole and in the order said: the status's news, then the
  // sheet's welcome (one toast, never one replacing the other).
  await expect(toast).toHaveText(
    "Tour placed by GPS (less exact) Welcome back - your progress is kept.",
  );
});

/** A visitor on the start page, ready to start: a fresh tour ("Start
 *  the tour"), or back from AR with progress ("Back to the tour"). */
const STARTS = [
  {
    name: "Start the tour",
    ready: async (page) => {
      await openTheWalk(page);
    },
  },
  {
    name: "Back to the tour",
    ready: async (page) => {
      await openTheWalk(page);
      await enterAtTheCode(page);
      await visit(page, STATIONS[0], 1);
      await page.getByTestId("enter-ar").click(); // in AR: the way out
      await expect(page.getByTestId("enter-ar")).toHaveText("Back to the tour");
    },
  },
];

for (const start of STARTS) {
  test(`'${start.name}' says 'Starting AR…' in the coach, and a failed start can be tried again`, async ({
    page,
  }) => {
    // Why this test matters (the async-UI rule): the AR start takes
    // a moment with nothing else on screen, so the coach says so with its
    // spinner; a start that fails goes back to the page with "Try again",
    // and the second try starts - from a fresh tour and from "Back to the
    // tour" alike.
    await start.ready(page);
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
    await expect(page.getByTestId("walk-coach-text")).toHaveText(
      "Starting AR…",
    );
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
}
