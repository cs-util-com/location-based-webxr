// @ts-check
import { writeFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import {
  faceBearing,
  forceTrackingReady,
  installTourViewerArFakes,
  lockFixtureCode,
  reportArTracking,
  seedAlignment,
  standAt,
  waitForTheGuess,
} from "./ar-fakes.js";

/**
 * The radar and the precision chip: the radar at the top right opens the list; the chip under
 * it names how the position is known - by a code, by GPS (and how well),
 * too weak, unknown, tracking lost; the peek and the list's rows say which
 * way each station is once a heading exists; and a frozen radar (no
 * position, tracking lost) does not move with a position nobody vouches
 * for. The walk tests run on a tour of stories and on a tour whose
 * stations hold items (pins), as the walk's lessons ask.
 *
 * The fakes deliver no AR poses, so the tracking report reads `ar-lost`
 * (the framework's "not tracking") after every recompute - a device fix,
 * a code's vote on a camera frame - until a spec reports a pose:
 * `trackingOk` reports one (`reportArTracking`) and then forces the
 * report ready around a frame.
 */

const WALK_ARCHIVE = "http://127.0.0.1:5197/ranges-ok/walk-tour.zip";
const STATIONS_ARCHIVE = "http://127.0.0.1:5197/ranges-ok/stations-tour.zip";

const TOURS = [
  { name: "a tour of stories", archive: WALK_ARCHIVE },
  { name: "a tour with items", archive: STATIONS_ARCHIVE },
];

/** The words a direction flips to when the camera turns around. */
const OPPOSITE = {
  ahead: "behind you",
  "behind you": "ahead",
  "to your left": "to your right",
  "to your right": "to your left",
};

test.beforeEach(async ({ page }) => {
  await installTourViewerArFakes(page);
});

async function openTour(page, archive, search = "") {
  await page.goto(`/?qr=${encodeURIComponent(archive)}${search}`);
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    { timeout: 15000 },
  );
  await expect(page.getByTestId("enter-ar")).toBeEnabled({ timeout: 10000 });
}

async function frames(page, n = 1) {
  await page.evaluate((n) => {
    /** @type {any} */ (window).__tourViewerTest.emitFrames(n);
  }, n);
}

/** AR tracking with a pose, and the report ready around a camera frame
 *  (the frame renders the status, which publishes the tracking loss). */
async function trackingOk(page) {
  await reportArTracking(page, true);
  await forceTrackingReady(page);
  await frames(page);
  await forceTrackingReady(page);
}

/** Start AR at the code: aligned, standing at the zero, the code locked,
 *  the tracking ready. */
async function enterAtTheCode(page) {
  await page.getByTestId("enter-ar").click();
  await seedAlignment(page);
  await standAt(page, 0, 0, 0);
  await lockFixtureCode(page);
  await expect(page.getByTestId("walk-sheet")).toBeVisible();
  await trackingOk(page);
  // The no-guess hold: the peek names a station once the distance held.
  await waitForTheGuess(page);
}

/** End a playing story by its card's control (ask, then confirm). On
 *  the tour with items the visitor stands at its first station, so its
 *  story plays and, in order, the others wait as "Later". */
async function endTheStory(page) {
  const story = page.getByTestId("walk-story");
  if (await story.isHidden()) return;
  const end = page.getByTestId("story-end");
  await end.click();
  await expect(end).toHaveText(/^End the story of .+ now$/);
  await end.click();
  await expect(story).toBeHidden();
}

/** One tracking-quality report of `state` (not "ok"). */
async function reportTracking(page, state) {
  await page.evaluate((state) => {
    /** @type {any} */ (window).__tourViewerTest.alignmentStore.dispatch({
      type: "trackingQuality/reportUpdated",
      payload: {
        state,
        confidence: 0.2,
        subScores: {
          convergence: 0.2,
          residualConsensus: 0.2,
          gpsAccuracy: 1,
          coverage: 0.2,
        },
        diagnostics: {},
      },
    });
  }, state);
}

/** The radar canvas's pixels, as a data URL. */
async function radarPicture(page) {
  await page.waitForFunction(() => {
    const c = /** @type {HTMLCanvasElement | null} */ (
      document.getElementById("walk-radar-canvas")
    );
    return c !== null && c.width > 0;
  });
  return page.evaluate(() =>
    /** @type {HTMLCanvasElement} */ (
      document.getElementById("walk-radar-canvas")
    ).toDataURL(),
  );
}

/** The radar's picture once it settled: two equal pictures 200 ms apart
 *  (a trailing draw may still be pending). Static only under reduced
 *  motion (no pulse, no wobble). */
async function settledPicture(page) {
  let last = "";
  await expect
    .poll(
      async () => {
        const now = await radarPicture(page);
        const same = now === last;
        last = now;
        return same;
      },
      { timeout: 10000, intervals: [200] },
    )
    .toBe(true);
  return last;
}

/** The first row still to find: its id and its direction words. */
async function firstUnfoundRow(page) {
  const row = page
    .getByTestId("walk-row")
    .and(page.locator('[data-state="next"], [data-state="left"]'))
    .first();
  const id = await row.getAttribute("data-id");
  const sub = (await row.getByTestId("walk-row-sub").textContent()) ?? "";
  return { id, word: /^\d+ m - (.+)$/.exec(sub)?.[1] ?? null };
}

for (const tour of TOURS) {
  test(`the radar opens and closes the list, and the chip stays quiet while a code placed the visitor, on ${tour.name}`, async ({
    page,
  }) => {
    // Why this test matters: the radar is the list's second
    // door, and the chip names the precision the radar's centre
    // draws; a code's position reads "Placed by a code", never its 1 m,
    // and a good position needs no words: the chip stays hidden.
    await openTour(page, tour.archive);
    await enterAtTheCode(page);
    const wrap = page.getByTestId("walk-radar-wrap");
    await expect(wrap).toBeVisible();
    await expect(page.getByTestId("walk-precision-text")).toHaveText(
      "Placed by a code",
    );
    await expect(page.getByTestId("walk-precision")).toBeHidden();
    await expect(wrap).toHaveAttribute("data-mode", "live");
    await expect(page.getByTestId("walk-precision")).toHaveAttribute(
      "data-kind",
      "code",
    );
    const radar = page.getByTestId("walk-radar");
    await expect(radar).toHaveAccessibleName(
      "Stations around you - open the list",
    );
    const sheet = page.getByTestId("walk-sheet");
    // It says whether its list is open, as the grab does.
    await expect(radar).toHaveAttribute("aria-expanded", "false");
    await radar.click();
    await expect(sheet).toHaveAttribute("data-sheet", "list");
    await expect(page.getByTestId("walk-list")).toBeVisible();
    await expect(radar).toHaveAttribute("aria-expanded", "true");
    await radar.click();
    await expect(sheet).toHaveAttribute("data-sheet", "peek");
    await expect(page.getByTestId("walk-list")).toBeHidden();
    await expect(radar).toHaveAttribute("aria-expanded", "false");
    // The canvas is drawn at the device's pixels (at most 2x).
    const ratio = await page.evaluate(() => {
      const c = /** @type {HTMLCanvasElement} */ (
        document.getElementById("walk-radar-canvas")
      );
      return {
        drawn: c.width / c.clientWidth,
        device: Math.min(2, Math.max(1, devicePixelRatio)),
      };
    });
    expect(ratio.drawn).toBeCloseTo(ratio.device, 1);
  });

  test(`the list's rows say which way each station is, and turn with the camera, on ${tour.name}`, async ({
    page,
  }) => {
    // Why this test matters: with a heading a row still to find
    // says where to walk ("46 m - to your right") with an arrow turned
    // there; turning the camera around turns the word to its opposite.
    await openTour(page, tour.archive);
    await enterAtTheCode(page);
    await endTheStory(page);
    await faceBearing(page, 0);
    await page.getByTestId("walk-grab").click();
    await expect(page.getByTestId("walk-list")).toBeVisible();
    await expect
      .poll(async () => (await firstUnfoundRow(page)).word)
      .not.toBeNull();
    const before = await firstUnfoundRow(page);
    const row = page.locator(`.walk-row[data-id="${String(before.id)}"]`);
    await expect(row.locator(".walk-arrow")).toHaveAttribute(
      "data-deg",
      /^-?\d+$/,
    );
    await faceBearing(page, 180);
    await expect(row.getByTestId("walk-row-sub")).toHaveText(
      new RegExp(`^\\d+ m - ${String(OPPOSITE[String(before.word)])}$`),
    );
  });
}

test("the peek says which way the focus is, and its arrow turns with the camera", async ({
  page,
}) => {
  // Why this test matters: the peek's tail says the focus's
  // direction ("Ahead.") and the distance's arrow points there; turning
  // the camera turns both. The gate stands 28 m north of the code.
  await openTour(page, WALK_ARCHIVE);
  await enterAtTheCode(page);
  await faceBearing(page, 0);
  await expect(page.getByTestId("walk-tail")).toHaveText("Ahead.");
  const arrow = page.locator("#walk-distance-arrow");
  await expect(arrow).toHaveAttribute("data-deg", /^-?\d+$/);
  const ahead = Number(await arrow.getAttribute("data-deg"));
  expect(Math.abs(ahead)).toBeLessThan(28);
  await expect(page.getByTestId("walk-distance-text")).toHaveText(/^\d+ m$/);
  // Facing east, the station north of the visitor is to the left.
  await faceBearing(page, 90);
  await expect(page.getByTestId("walk-tail")).toHaveText("To your left.");
  await expect
    .poll(async () => Number(await arrow.getAttribute("data-deg")))
    .toBeCloseTo(ahead - 90, 0);
  // Facing south, behind.
  await faceBearing(page, 180);
  await expect(page.getByTestId("walk-tail")).toHaveText("Behind you.");
});

test("placed by GPS: the chip says how well, too weak says so, and no heading draws no words", async ({
  page,
}) => {
  // Why this test matters: GPS is "about N m" from the fixes'
  // own accuracy, and fixes too weak to guide by say so; with no heading
  // the peek shows the distance alone (no direction is invented).
  await openTour(page, WALK_ARCHIVE);
  await page.getByTestId("enter-ar").click();
  await seedAlignment(page);
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.fireTimers();
  });
  await page.getByTestId("scan-escape").click();
  // Fixes of now: the guide trusts a lone device fix only while fresh.
  await reportArTracking(page, true);
  await standAt(page, 0, 0, "now", 4);
  await reportTracking(page, "degraded");
  await frames(page);
  const chip = page.getByTestId("walk-precision-text");
  await expect(chip).toHaveText(/^GPS - about \d+ m$/);
  await expect(page.getByTestId("walk-precision")).toHaveAttribute(
    "data-kind",
    "gps",
  );
  // GPS within the ceiling needs no words: the chip stays hidden.
  await expect(page.getByTestId("walk-precision")).toBeHidden();
  // The no-guess hold: a distance is named once it held.
  await waitForTheGuess(page);
  await expect(page.getByTestId("walk-distance-text")).toHaveText(/^\d+ m$/);
  await expect(page.getByTestId("walk-tail")).not.toHaveText(
    /^(Ahead|To your|Behind)/,
  );
  await expect(page.locator("#walk-distance-arrow")).not.toHaveAttribute(
    "data-deg",
    /./,
  );
  for (let i = 0; i < 10; i += 1) await standAt(page, 0, 0, "now", 60);
  await reportTracking(page, "degraded");
  await frames(page);
  await expect(chip).toHaveText(/^GPS - about \d+ m, too weak$/);
  await expect(page.getByTestId("walk-precision")).toHaveAttribute(
    "data-kind",
    "weak",
  );
  // Too weak is a state the visitor can act on: the chip says so.
  await expect(page.getByTestId("walk-precision")).toBeVisible();
  await expect(page.getByTestId("walk-radar-wrap")).toHaveAttribute(
    "data-mode",
    "live",
  );
});

test("the radar draws north as soon as the content is placed, provisional until tracking confirms it, while the arrows wait", async ({
  page,
}) => {
  // Why this test matters: the tour's content is placed in the
  // alignment's frame before any heading is confirmed, and a radar that
  // waited for that confirmation disagreed with what the visitor saw. It
  // now reads the same frame at once and says it is provisional (dimmer,
  // no view cone); the direction words and the arrows keep waiting for a
  // confirmed heading, which confident tracking gives.
  await openTour(page, WALK_ARCHIVE);
  await page.getByTestId("enter-ar").click();
  await seedAlignment(page);
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.fireTimers();
  });
  await page.getByTestId("scan-escape").click();
  await reportArTracking(page, true);
  await standAt(page, 0, 0, "now", 4);
  await reportTracking(page, "degraded");
  await faceBearing(page, 0);
  const wrap = page.getByTestId("walk-radar-wrap");
  await expect(wrap).toHaveAttribute("data-mode", "live");
  await expect(wrap).toHaveAttribute("data-heading", "provisional");
  await waitForTheGuess(page);
  await expect(page.locator("#walk-distance-arrow")).not.toHaveAttribute(
    "data-deg",
    /./,
  );
  await trackingOk(page);
  await faceBearing(page, 0);
  await expect(wrap).toHaveAttribute("data-heading", "confirmed");
});

test("tracking lost pauses the radar: the chip says so and the radar goes grey, and comes back", async ({
  page,
}) => {
  // Why this test matters: while AR tracking is lost the
  // position is not trusted; the chip says "Paused - tracking lost" and
  // the radar freezes in grey (its last judged picture), then returns.
  await openTour(page, STATIONS_ARCHIVE);
  await enterAtTheCode(page);
  const chip = page.getByTestId("walk-precision-text");
  await expect(chip).toHaveText("Placed by a code");
  await expect(page.getByTestId("walk-precision")).toBeHidden();
  await reportArTracking(page, false);
  await expect(chip).toHaveText("Paused - tracking lost");
  await expect(page.getByTestId("walk-precision")).toBeVisible();
  await expect(page.getByTestId("walk-radar-wrap")).toHaveAttribute(
    "data-mode",
    "frozen",
  );
  await expect(page.getByTestId("walk-precision")).toHaveAttribute(
    "data-kind",
    "lost",
  );
  await trackingOk(page);
  await expect(chip).toHaveText("Placed by a code");
  await expect(page.getByTestId("walk-radar-wrap")).toHaveAttribute(
    "data-mode",
    "live",
  );
  await expect(page.getByTestId("walk-precision")).toBeHidden();
});

for (const tour of TOURS) {
  test(`without a position the radar freezes: a move changes nothing on it, a skip does, on ${tour.name}`, async ({
    page,
  }) => {
    // Why this test matters: a visitor without location whose code
    // lost its trust (an odometry frame change) has no position anyone
    // vouches for: the chip says "Position unknown", the radar goes grey
    // with a "?" at its centre and keeps the last judged picture - a walk
    // must not move a single blip on it. Only the geometry freezes: a
    // skip made meanwhile shows at once (the statuses stay live). Reduced
    // motion stills the live radar's pulse, so two pictures compare.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      const t = /** @type {any} */ (window).__tourViewerTest;
      if (t) t.locationPermission = "denied";
    });
    await openTour(page, tour.archive);
    const button = page.getByTestId("enter-ar");
    await expect(button).toHaveText("Start the tour", { timeout: 10000 });
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
    await endTheStory(page);
    const chip = page.getByTestId("walk-precision-text");
    await expect(chip).toHaveText("Placed by a code");
    const live = await settledPicture(page);
    // The code goes out of sight and the odometry frame changes.
    await page.evaluate(() => {
      const t = /** @type {any} */ (window).__tourViewerTest;
      t.nextDetection = null;
      t.alignmentStore.dispatch({ type: "qrDetected/qrFrameChanged" });
    });
    await trackingOk(page);
    await expect(chip).toHaveText("Position unknown");
    await expect(page.getByTestId("walk-precision")).toBeVisible();
    await expect(page.getByTestId("walk-radar-wrap")).toHaveAttribute(
      "data-mode",
      "frozen",
    );
    const frozen = await settledPicture(page);
    expect(frozen).not.toBe(live);
    // A walk of 40 m north and a turn: the frozen radar keeps its picture.
    await page.evaluate(() => {
      const t = /** @type {any} */ (window).__tourViewerTest;
      t.arPose = {
        position: { x: 6, y: 1.4, z: -40 },
        orientation: { x: 0, y: 0.7071, z: 0, w: 0.7071 },
      };
      t.emitFrames(3);
    });
    await expect(chip).toHaveText("Position unknown");
    expect(await settledPicture(page)).toBe(frozen);
    // A skip changes a blip: "Can't get there?" opens the list - asking
    // which station on the tour of stories, which names none without a
    // position, on the focus's row on the tour in order - and the
    // row's Skip or confirm skips it.
    await page.getByTestId("station-skip").click();
    const confirm = page.getByTestId("walk-row-confirm");
    if ((await confirm.count()) > 0) await confirm.click();
    else await page.getByTestId("walk-row-act").first().click();
    await expect(page.getByTestId("walk-row-act").first()).toHaveText(
      /^Undo: bring back /,
    );
    // The list closed again: the picture compared is the radar's alone.
    await page.getByTestId("walk-close").click();
    await expect(chip).toHaveText("Position unknown");
    await expect(page.getByTestId("walk-radar-wrap")).toHaveAttribute(
      "data-mode",
      "frozen",
    );
    expect(await settledPicture(page)).not.toBe(frozen);
  });
}

test("?debug=1 reads the radar's draw time and the frame time", async ({
  page,
}) => {
  // Why this test matters (the 50 ms frame budget: no frame over 50 ms): the phone test
  // judges the radar by these two lines, so they must be on the page; the
  // numbers measured headless are written out when asked for.
  await openTour(page, WALK_ARCHIVE, "&debug=1");
  await enterAtTheCode(page);
  const debug = page.getByTestId("ar-debug");
  // Frames for about two seconds: the window fills with draws.
  await expect
    .poll(
      async () => {
        await frames(page);
        const m = /radar draw: .*\((\d+) in 2 s\)/.exec(
          (await debug.textContent()) ?? "",
        );
        return Number(m?.[1] ?? 0);
      },
      { timeout: 15000, intervals: [70] },
    )
    .toBeGreaterThanOrEqual(15);
  await expect(debug).toContainText(
    /radar draw: \d+\.\d{2} ms mean, \d+\.\d{2} ms worst \(\d+ in 2 s\)/,
  );
  await expect(debug).toContainText(/frame: /);
  const out = process.env["WALK_RADAR_DEBUG_OUT"];
  if (out !== undefined && out !== "") {
    writeFileSync(out, `${(await debug.textContent()) ?? ""}\n`);
  }
});

test("the edge pill names the focus off screen on its side, says when it is behind, and goes in view or with the list open", async ({
  page,
}) => {
  // Why this test matters (the prototype's "on the way" and "behind
  // you"): the station the walk is about can leave the screen when the
  // visitor turns; the pill at that edge names it and its distance, and
  // says "behind you" once it is. It goes when the station is back in
  // view, and while the list is up (the list names it already). The gate
  // stands 28 m north of the code, and is the focus.
  await openTour(page, WALK_ARCHIVE);
  await enterAtTheCode(page);
  const pill = page.getByTestId("walk-edge-pill");
  const text = page.getByTestId("walk-edge-pill-text");
  await faceBearing(page, 0);
  await expect(page.getByTestId("walk-tail")).toHaveText("Ahead.");
  await expect(pill).toBeHidden();
  const metres = (
    await page.getByTestId("walk-distance-text").textContent()
  )?.trim();
  // Facing east, the gate is to the left: the pill on the left.
  await faceBearing(page, 90);
  await expect(pill).toBeVisible();
  await expect(pill).toHaveAttribute("data-side", "left");
  await expect(text).toHaveText(`The gate - ${String(metres)}`);
  // Facing west, on the right.
  await faceBearing(page, 270);
  await expect(pill).toHaveAttribute("data-side", "right");
  await expect(text).toHaveText(`The gate - ${String(metres)}`);
  // Facing south it is behind, and the pill keeps its side.
  await faceBearing(page, 180);
  await expect(text).toHaveText(`The gate - ${String(metres)}, behind you`);
  await expect(pill).toHaveAttribute("data-side", "right");
  // The list up: no pill; closed again: back.
  await page.getByTestId("walk-grab").click();
  await expect(pill).toBeHidden();
  await page.getByTestId("walk-close").click();
  await expect(pill).toBeVisible();
  // In view again: gone.
  await faceBearing(page, 0);
  await expect(pill).toBeHidden();
});

test("the focus is marked in the scene: its own HUD, a beacon and a ring that follow it", async ({
  page,
}) => {
  // Why this test matters: the walk's focus is drawn apart from
  // the other stations - its HUD marker in the focus's look, a beacon
  // over it and a ring on the ground where it is found. A cue left on a
  // station the walk is no longer about is a wrong instruction, so the
  // cues move with the focus and go with the session.
  await openTour(page, WALK_ARCHIVE);
  await enterAtTheCode(page);
  const huds = () =>
    page.evaluate(() => {
      const t = /** @type {any} */ (window).__tourViewerTest;
      return t.hudPair.map((h) => ({
        look: h.look,
        ids: h.getTargets().map((x) => x.id),
      }));
    });
  const cues = () =>
    page.evaluate(() => {
      const t = /** @type {any} */ (window).__tourViewerTest;
      return t.fakeScene.children
        .filter(
          (c) => c.name === "walk-focus-beacon" || c.name === "walk-focus-ring",
        )
        .map((c) => ({
          name: c.name,
          north: Math.round(c.position.x),
          east: Math.round(c.position.z),
        }));
    });
  await expect.poll(huds).toEqual([
    { look: "focus", ids: ["gate"] },
    { look: "others", ids: ["well", "tower", "garden"] },
  ]);
  await expect
    .poll(async () => (await cues()).map((c) => c.name).sort())
    .toEqual(["walk-focus-beacon", "walk-focus-ring"]);
  const gate = await cues();
  expect(gate.every((c) => c.north === 28 && c.east === 0)).toBe(true);
  // At the gate it is found; the walk moves on to the well, its cues
  // with it.
  await standAt(page, 28, 0, 1);
  await expect
    .poll(async () => (await huds())[0])
    .toEqual({
      look: "focus",
      ids: ["well"],
    });
  await expect.poll(cues).toEqual(
    expect.arrayContaining([
      { name: "walk-focus-beacon", north: 82, east: 34 },
      { name: "walk-focus-ring", north: 82, east: 34 },
    ]),
  );
  // The exit takes every cue with it.
  await page.getByTestId("enter-ar").click();
  await expect.poll(async () => (await cues()).length).toBe(0);
});
