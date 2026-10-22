// @ts-check
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
  walkRowControl,
} from "./ar-fakes.js";

/**
 * Why these tests matter (visitor walk W4 build plan M2, §3.1): the walk's
 * layout is W4's, and the design system zeroes paragraph and list margins,
 * so a port can lose every gap and still pass a test that asks only whether
 * an element is visible (the L5 lesson). These pin positions and gaps of
 * the chosen prototype (`public/prototypes/visitor-walk-4-radar-
 * and-list/`): the sheet at the bottom (a card at the bottom left of a
 * phone held sideways), the round Exit button, the peek's rows, the toast's
 * place clear of the radar's corner, the list's rows and the away block on
 * the start page - on phones, a phone held sideways and a desktop.
 *
 * Not pinned here, a field check on a phone instead: a TOUCH drag of the
 * grab or the peek, and a drag the browser cancels (pointercancel, a
 * scroll or a system gesture taking over). Playwright's mouse drives the
 * same pointer events, but not a real touch's slop and cancellation.
 */

const WALK_ARCHIVE = "http://127.0.0.1:5197/ranges-ok/walk-tour.zip";
const FIXED_WALK_ARCHIVE =
  "http://127.0.0.1:5197/ranges-ok/walk-tour-fixed.zip";

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 360, height: 740 },
  { width: 844, height: 390 },
  { width: 915, height: 412 },
  { width: 1440, height: 900 },
];

/** W4's sideways layout: the media query `(orientation: landscape) and
 *  (height <= 520px)`. */
const sideways = (v) => v.width > v.height && v.height <= 520;

/** An element's box by test id. */
async function box(page, testId) {
  const b = await page.getByTestId(testId).boundingBox();
  if (b === null) throw new Error(`${testId} has no box`);
  return b;
}

async function openTheWalk(page, archive = WALK_ARCHIVE) {
  await page.goto(`/?qr=${encodeURIComponent(archive)}`);
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    { timeout: 15000 },
  );
  await expect(page.getByTestId("enter-ar")).toBeEnabled({ timeout: 10000 });
}

async function enterTheWalk(page, archive = WALK_ARCHIVE) {
  await openTheWalk(page, archive);
  await page.getByTestId("enter-ar").click();
  await seedAlignment(page);
  await standAt(page, 0, 0, 0);
  await lockFixtureCode(page);
  await expect(page.getByTestId("walk-sheet")).toBeVisible();
  // A pose (the fakes deliver none): without it the walk reads tracking
  // lost and offers no skip.
  await trackingOk(page);
  // R-2's hold (M4): the peek names a station once the distance held.
  await waitForTheGuess(page);
}

/** AR tracking with a pose, and the report ready around a camera frame
 *  (the fakes deliver no poses: the report reads lost until one is
 *  reported). */
async function trackingOk(page) {
  await reportArTracking(page, true);
  await forceTrackingReady(page);
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
  });
  await forceTrackingReady(page);
}

/** The walk with no position anyone vouches for (M4, R-2): no location,
 *  the code locked, then its trust ended by an odometry frame change. */
async function enterWithoutAPosition(page) {
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
  await page.evaluate(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    t.nextDetection = null;
    t.alignmentStore.dispatch({ type: "qrDetected/qrFrameChanged" });
  });
  await trackingOk(page);
  await expect(page.getByTestId("walk-peek")).toHaveAttribute(
    "data-kind",
    "none",
  );
}

/** A locator's box, at the list's current scroll: each group of boxes
 *  compared is taken between two taps, never across a scroll (a tap
 *  scrolls its target into view). */
async function boxOf(locator) {
  const b = await locator.boundingBox();
  if (b === null) throw new Error("no box");
  return b;
}

for (const viewport of VIEWPORTS) {
  const label = `${String(viewport.width)}x${String(viewport.height)}`;

  // Why this test matters: in AR every control of the walk must be on the
  // screen without scrolling the page, and the page must not scroll
  // sideways - a phone pans a page that is wider than the screen under a
  // swipe meant for the sheet. The framework's window-sized canvas, laid
  // out at the overlay root's place, made the page wider than the window.
  // The page must not scroll down either (a sideways phone's header once
  // pushed the AR overlay below the fold), in every state the walk's
  // controls take: the peek, the list, a row's armed Skip, the quick
  // action's full-width undo and the complete tour's foot.
  test(`in AR the page does not scroll sideways and every control of the walk is on the screen at ${label}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installTourViewerArFakes(page);
    await enterTheWalk(page);
    /** @param {string} state */
    const pageFits = async (state) => {
      const o = await page.evaluate(() => {
        const d = document.documentElement;
        return {
          x: d.scrollWidth - d.clientWidth,
          y: d.scrollHeight - d.clientHeight,
          scrolled: window.scrollX + window.scrollY,
        };
      });
      expect(o.x, `${state}: sideways overflow`).toBeLessThanOrEqual(0);
      expect(o.y, `${state}: downward overflow`).toBeLessThanOrEqual(0);
      expect(o.scrolled, `${state}: page scrolled`).toBe(0);
    };
    /** @param {{ x: number, y: number, width: number, height: number }} b
     *  @param {string} id */
    const onScreen = (b, id) => {
      expect(b.x, id).toBeGreaterThanOrEqual(0);
      expect(b.y, id).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, id).toBeLessThanOrEqual(viewport.width + 0.5);
      expect(b.y + b.height, id).toBeLessThanOrEqual(viewport.height + 0.5);
    };
    await pageFits("the peek");
    for (const id of [
      "enter-ar",
      "walk-radar",
      "walk-grab",
      "walk-peek",
      "station-skip",
      "walk-precision",
    ]) {
      onScreen(await box(page, id), id);
    }
    // The list open: its close button, its title, its first row and that
    // row's Skip on the screen.
    await page.getByTestId("walk-grab").click();
    for (const id of ["walk-close", "walk-list-title"]) {
      onScreen(await box(page, id), id);
    }
    onScreen(await boxOf(page.getByTestId("walk-row").first()), "first row");
    onScreen(
      await boxOf(walkRowControl(page, "The gate", "act")),
      "a row's Skip",
    );
    await pageFits("the list");
    // A row's Skip armed: its confirm and Cancel on the screen.
    await walkRowControl(page, "The gate", "act").click();
    onScreen(
      await boxOf(walkRowControl(page, "The gate", "confirm")),
      "the confirm",
    );
    onScreen(await boxOf(walkRowControl(page, "The gate", "cancel")), "Cancel");
    await pageFits("a row armed");
    await walkRowControl(page, "The gate", "cancel").click();
    // The quick action wrapped to its own line, full width: its undo.
    await page.getByTestId("walk-close").click();
    await page.getByTestId("station-skip").click();
    await walkRowControl(page, "The gate", "confirm").click();
    await page.getByTestId("walk-close").click();
    const quick = page.getByTestId("station-skip");
    await expect(quick).toHaveAttribute("data-kind", "undo");
    onScreen(await box(page, "station-skip"), "the quick action's undo");
    expect((await box(page, "station-skip")).width).toBeCloseTo(
      (await box(page, "walk-peek-row")).width,
      0,
    );
    await pageFits("the quick action's undo");
    // The tour complete: the list's foot shows and its button is on the
    // screen (scrolled into the list's view, never the page's; the foot's
    // bottom padding may lie in the list's scrolled-off part).
    await page.getByTestId("walk-grab").click();
    for (const title of ["The well", "The tower", "The garden"]) {
      await walkRowControl(page, title, "act").click();
      await walkRowControl(page, title, "confirm").click();
    }
    await expect(page.getByTestId("walk-sheet")).toHaveAttribute(
      "data-complete",
      "true",
    );
    await page.getByTestId("walk-exit").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("walk-list-foot")).toBeVisible();
    onScreen(await box(page, "walk-exit"), "the foot's Exit AR");
    await pageFits("the tour complete");
  });

  // Why this test matters (the prototype's "on the way"): the
  // pill stands at 42 % of the height, 8 px in from the edge on its
  // station's side; sideways the left one starts right of the sheet's
  // card, which would cover it.
  test(`the edge pill sits at 42 % of the height, 8 px from its edge, clear of the sheet, at ${label}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installTourViewerArFakes(page);
    await enterTheWalk(page);
    const pill = page.getByTestId("walk-edge-pill");
    // Facing east, the gate (north) is to the left.
    await faceBearing(page, 90);
    await expect(pill).toHaveAttribute("data-side", "left");
    const left = await box(page, "walk-edge-pill");
    expect(left.y).toBeCloseTo(viewport.height * 0.42, 0);
    if (sideways(viewport)) {
      expect(left.x).toBeCloseTo(viewport.width / 2 + 10, 0);
      const sheet = await box(page, "walk-sheet");
      expect(left.x).toBeGreaterThan(sheet.x + sheet.width);
    } else {
      expect(left.x).toBeCloseTo(8, 0);
    }
    expect(left.width).toBeLessThanOrEqual(viewport.width * 0.44 + 0.5);
    // Its chevron first, pointing out, 6 px before the words.
    const arrow = await boxOf(pill.locator("svg"));
    const words = await box(page, "walk-edge-pill-text");
    expect(arrow.x).toBeLessThan(words.x);
    expect(words.x - (arrow.x + arrow.width)).toBeCloseTo(6, 0);
    // Facing west, on the right: the chevron after the words.
    await faceBearing(page, 270);
    await expect(pill).toHaveAttribute("data-side", "right");
    const right = await box(page, "walk-edge-pill");
    expect(right.x + right.width).toBeCloseTo(viewport.width - 8, 0);
    expect(right.y).toBeCloseTo(viewport.height * 0.42, 0);
    const arrowR = await boxOf(pill.locator("svg"));
    const wordsR = await box(page, "walk-edge-pill-text");
    expect(arrowR.x - (wordsR.x + wordsR.width)).toBeCloseTo(6, 0);
  });

  test(`the walk's sheet, its peek and the Exit button sit where the prototype puts them at ${label}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installTourViewerArFakes(page);
    await enterTheWalk(page);
    const sheet = await box(page, "walk-sheet");
    if (sideways(viewport)) {
      // A card at the bottom left, 10 px from both edges.
      expect(sheet.x).toBeCloseTo(10, 0);
      expect(viewport.height - (sheet.y + sheet.height)).toBeCloseTo(10, 0);
      expect(sheet.width).toBeCloseTo(Math.min(370, viewport.width * 0.48), 0);
    } else {
      // On the bottom edge, at most 520 px wide, centred.
      expect(sheet.y + sheet.height).toBeCloseTo(viewport.height, 0);
      const width = Math.min(viewport.width, 520);
      expect(sheet.width).toBeCloseTo(width, 0);
      expect(sheet.x).toBeCloseTo((viewport.width - width) / 2, 0);
    }
    // The grab is the sheet's top 22 px (its box: the layout is W4's);
    // the segments 6 px tall, 4 px apart, 16 px in from the sheet's sides;
    // the peek's row at least 56 px tall (48 sideways).
    const grab = await box(page, "walk-grab");
    expect(grab.y).toBeCloseTo(sheet.y + 1, 0); // under the 1 px border
    expect(grab.height).toBeCloseTo(22, 0);
    // Its target is 44 px (W4 M2 review): 10 px above the sheet's edge
    // and 10 px below the grab's box, a tap still lands on the grab.
    expect(
      await page.evaluate(
        ({ x, ys }) =>
          ys.map(
            (y) =>
              document.elementFromPoint(x, y)?.closest("#walk-grab") != null,
          ),
        {
          x: grab.x + grab.width / 2,
          ys: [grab.y - 10, grab.y + grab.height + 10],
        },
      ),
    ).toEqual([true, true]);
    await expect(page.getByTestId("walk-grab")).toHaveAttribute(
      "aria-controls",
      "walk-list",
    );
    const segments = page.getByTestId("walk-segments").locator("i");
    const first = await segments.nth(0).boundingBox();
    const second = await segments.nth(1).boundingBox();
    if (first === null || second === null) throw new Error("no segments");
    expect(first.height).toBeCloseTo(6, 0);
    expect(second.x - (first.x + first.width)).toBeCloseTo(4, 0);
    expect(first.x - sheet.x).toBeCloseTo(sideways(viewport) ? 17 : 16, 0);
    expect(first.y - (grab.y + grab.height)).toBeCloseTo(2, 0);
    const row = await box(page, "walk-peek-row");
    expect(row.y - (first.y + first.height)).toBeCloseTo(10, 0);
    expect(row.height).toBeGreaterThanOrEqual(sideways(viewport) ? 48 : 56);
    // The quick action sits on the row, right of the title, inside the
    // sheet; at most 46 % of the row.
    const quick = await box(page, "station-skip");
    expect(quick.x + quick.width).toBeLessThanOrEqual(
      sheet.x + sheet.width - 15,
    );
    expect(quick.y).toBeGreaterThanOrEqual(row.y - 1);
    expect(quick.y + quick.height).toBeLessThanOrEqual(row.y + row.height + 1);
    expect(quick.width).toBeLessThanOrEqual(row.width * 0.46 + 1);
    expect(quick.height).toBeGreaterThanOrEqual(44);
    // ... on the title's line, 12 px after the title's column.
    const title = await box(page, "walk-title");
    expect(quick.y).toBeLessThanOrEqual(title.y + title.height);
    expect(quick.y + quick.height).toBeGreaterThanOrEqual(title.y);
    const column = await page
      .getByTestId("walk-peek-row")
      .locator(".walk-peek-main")
      .boundingBox();
    if (column === null) throw new Error("no title column");
    expect(quick.x - (column.x + column.width)).toBeCloseTo(12, 0);
    // The distance's figures are lining and of one width, as W4's.
    await expect(page.getByTestId("walk-distance")).toHaveCSS(
      "font-variant-numeric",
      "lining-nums tabular-nums",
    );
    // The round Exit button: 44 px, 12 px from the left, 30 px from the
    // top (10 sideways).
    const exit = await box(page, "enter-ar");
    expect(exit.width).toBeCloseTo(44, 0);
    expect(exit.height).toBeCloseTo(44, 0);
    expect(exit.x).toBeCloseTo(12, 0);
    expect(exit.y).toBeCloseTo(sideways(viewport) ? 10 : 30, 0);
    // Nothing of the walk reaches past the screen's right edge. (The page
    // as a whole is not asked: the AR fakes' window-sized canvas sits
    // offset inside #ar-root and overflows on its own.)
    expect(
      await page.evaluate(() =>
        ["walk-sheet", "walk-toast-root", "enter-ar"].filter((id) => {
          const el = document.getElementById(id);
          return (
            el !== null &&
            el.getBoundingClientRect().right > window.innerWidth + 0.5
          );
        }),
      ),
    ).toEqual([]);
  });

  test(`the list opens inside the screen with 44 px rows, and the toast stays clear of the radar's corner at ${label}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installTourViewerArFakes(page);
    await enterTheWalk(page);
    await page.getByTestId("walk-grab").click();
    await expect(page.getByTestId("walk-list")).toBeVisible();
    const sheet = await box(page, "walk-sheet");
    expect(sheet.y).toBeGreaterThanOrEqual(0);
    expect(sheet.height).toBeLessThanOrEqual(
      sideways(viewport)
        ? viewport.height - 74 + 1
        : viewport.height * 0.66 + 1,
    );
    const rows = page.getByTestId("walk-row");
    await expect(rows).toHaveCount(4);
    for (let i = 0; i < 4; i += 1) {
      const r = await rows.nth(i).boundingBox();
      if (r === null) continue; // scrolled out of the list's own view
      expect(r.height).toBeGreaterThanOrEqual(44);
    }
    // The last row can be reached: scrolled into the list's view, it
    // stands inside the sheet and the screen.
    await rows.last().scrollIntoViewIfNeeded();
    const last = await rows.last().boundingBox();
    if (last === null) throw new Error("no last row");
    expect(last.y + last.height).toBeLessThanOrEqual(
      sheet.y + sheet.height + 0.5,
    );
    expect(last.y + last.height).toBeLessThanOrEqual(viewport.height + 0.5);
    // The open sheet leaves the Exit button free.
    const exitButton = await box(page, "enter-ar");
    expect(
      sheet.y >= exitButton.y + exitButton.height ||
        sheet.x >= exitButton.x + exitButton.width,
    ).toBe(true);
    // W4's figures are lining: the app font's old-style numerals would
    // shrink the rows' numbers.
    await expect(rows.first().locator(".walk-glyph")).toHaveCSS(
      "font-variant-numeric",
      "lining-nums",
    );
    await page.getByTestId("walk-close").click();
    // A skip's toast: in W4's place, left of the radar's corner (132 px
    // at the top right) on a phone, centred on a desktop. "Can't get
    // there?" opens the list on the gate's row; its confirm skips (M4).
    const quick = page.getByTestId("station-skip");
    await quick.click();
    await page.getByTestId("walk-row-confirm").click();
    const toast = page.locator("#walk-toast");
    await expect(toast).toHaveText("Skipped The gate.");
    // The toast's place is its root's: the toast itself slides in a few
    // pixels as it enters.
    const t = await page.locator("#walk-toast-root").boundingBox();
    if (t === null) throw new Error("no toast root");
    const wide =
      viewport.width > 520 &&
      (viewport.height > 520 || viewport.width < viewport.height);
    if (wide) {
      expect(t.x + t.width / 2).toBeCloseTo(viewport.width / 2, 0);
      expect(t.y).toBeCloseTo(84, 0);
    } else if (sideways(viewport)) {
      expect(t.x + t.width).toBeCloseTo(viewport.width - 130, 0);
      expect(t.y).toBeCloseTo(14, 0);
    } else {
      expect(t.x).toBeCloseTo(12, 0);
      expect(t.x + t.width).toBeLessThanOrEqual(viewport.width - 132);
      expect(t.y).toBeCloseTo(84, 0);
    }
    // A suggestion or an undo takes the row's full width, on its own line
    // (the list closed: the quick action is not shown over it).
    await page.getByTestId("walk-close").click();
    const undo = await box(page, "station-skip");
    const row = await box(page, "walk-peek-row");
    expect(undo.width).toBeCloseTo(row.width, 0);
    // Nothing of the walk under the Exit button.
    const exit = await box(page, "enter-ar");
    expect(t.y >= exit.y + exit.height || t.x >= exit.x + exit.width).toBe(
      true,
    );
  });

  test(`the coach stands centred (at 60 % across in landscape, beside the sheet) at ${label}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installTourViewerArFakes(page);
    await openTheWalk(page);
    await page.evaluate(() => {
      /** @type {any} */ (window).__tourViewerTest.holdInitAR = true;
    });
    await page.getByTestId("enter-ar").click();
    await expect(page.getByTestId("walk-coach-text")).toHaveText(
      "Starting AR…",
    );
    const coach = await box(page, "walk-coach");
    const cx = coach.x + coach.width / 2;
    const cy = coach.y + coach.height / 2;
    if (sideways(viewport)) {
      expect(cx).toBeCloseTo(viewport.width * 0.6, 0);
      expect(cy).toBeCloseTo(viewport.height * 0.5, 0);
    } else {
      expect(cx).toBeCloseTo(viewport.width / 2, 0);
      expect(cy).toBeCloseTo(viewport.height * 0.44, 0);
    }
    expect(coach.width).toBeLessThanOrEqual(
      Math.min(320, viewport.width - 40) + 1,
    );
  });

  test(`the story card fills the peek's place, its dots above one row of buttons, at ${label}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installTourViewerArFakes(page);
    await enterTheWalk(page, FIXED_WALK_ARCHIVE);
    await standAt(page, 26, 0, 1);
    await expect(page.getByTestId("walk-story")).toBeVisible();
    const sheet = await box(page, "walk-sheet");
    expect(sheet.height).toBeLessThanOrEqual(
      sideways(viewport)
        ? viewport.height - 74 + 1
        : viewport.height * 0.66 + 1,
    );
    const dots = await box(page, "walk-dots");
    // The dots stand 10 px under the story's text box, as W4's: the
    // panel's empty status and choices take no row, and a one-line text
    // keeps W4's two-line height (3em).
    const text = await box(page, "scene-text");
    expect(dots.y - (text.y + text.height)).toBeCloseTo(10, 0);
    const acts = await box(page, "walk-story-acts");
    expect(acts.y).toBeGreaterThanOrEqual(dots.y + dots.height);
    const go = await box(page, "scene-continue");
    const end = await box(page, "story-end");
    expect(Math.abs(go.y - end.y)).toBeLessThanOrEqual(1);
    expect(end.x - (go.x + go.width)).toBeCloseTo(8, 0);
    expect(end.x + end.width).toBeLessThanOrEqual(sheet.x + sheet.width - 15);
  });
}

for (const viewport of VIEWPORTS) {
  const label = `${String(viewport.width)}x${String(viewport.height)}`;
  test(`the list's hint, a row's title, action, confirm and undo bar sit where the prototype puts them at ${label}`, async ({
    page,
  }) => {
    // Why (W4 build plan M4, §1.6, §3.1): the rows' controls are W4's - a
    // 34 px glyph column, the title a 44 px button, the action at the
    // row's right edge, the confirm on its own line 44 px in under the
    // title, the undo's 3 px bar under the title and the action - and the
    // hint sits between the progress line and the rows, 16 px in from the
    // list's sides. The design system zeroes paragraph margins, so these
    // gaps are pinned, not only the elements' presence.
    await page.setViewportSize(viewport);
    await installTourViewerArFakes(page);
    await enterWithoutAPosition(page);
    // "Can't get there?" with no station guessed: the list asks which.
    await page.getByTestId("station-skip").click();
    const list = await box(page, "walk-list");
    const hint = await boxOf(page.getByTestId("walk-hint"));
    await expect(page.getByTestId("walk-hint")).toHaveText(
      /Which one can't you reach\?$/,
    );
    expect(hint.x - list.x).toBeCloseTo(16, 0);
    expect(list.x + list.width - (hint.x + hint.width)).toBeCloseTo(16, 0);
    await expect(page.getByTestId("walk-hint")).toHaveCSS(
      "background-color",
      "rgba(147, 197, 253, 0.1)",
    );
    const progress = await boxOf(page.getByTestId("walk-progress"));
    expect(hint.y).toBeGreaterThanOrEqual(progress.y + progress.height - 0.5);
    const firstRow = await boxOf(page.getByTestId("walk-row").first());
    expect(firstRow.y - (hint.y + hint.height)).toBeCloseTo(10, 0);
    // Closed and opened by the grab (no chooser): a row's Skip asks first.
    await page.getByTestId("walk-close").click();
    await page.getByTestId("walk-grab").click();
    const towerRow = page
      .getByTestId("walk-row")
      .filter({ hasText: "The tower" });
    const row = await boxOf(towerRow);
    const main = await boxOf(walkRowControl(page, "The tower", "main"));
    const act = await boxOf(walkRowControl(page, "The tower", "act"));
    // The glyph's 34 px column and the 10 px gap, inside 8 px of padding.
    expect(main.x - row.x).toBeCloseTo(8 + 34 + 10, 0);
    expect(main.height).toBeGreaterThanOrEqual(44);
    expect(row.x + row.width - (act.x + act.width)).toBeCloseTo(8, 0);
    expect(act.x - (main.x + main.width)).toBeCloseTo(10, 0);
    expect(act.width).toBeGreaterThanOrEqual(44);
    expect(act.height).toBeGreaterThanOrEqual(44);
    await walkRowControl(page, "The tower", "act").click();
    const title = await boxOf(walkRowControl(page, "The tower", "main"));
    const confirm = await boxOf(walkRowControl(page, "The tower", "confirm"));
    const cancel = await boxOf(walkRowControl(page, "The tower", "cancel"));
    const armed = await boxOf(towerRow);
    // The confirm's line: under the title, 44 px in from the row's
    // padding, Cancel 8 px beside it (or wrapped under it on a narrow
    // row), both at least 44 px tall.
    expect(confirm.x - armed.x).toBeCloseTo(8 + 44, 0);
    expect(confirm.y).toBeGreaterThanOrEqual(title.y + title.height - 0.5);
    expect(confirm.height).toBeGreaterThanOrEqual(44);
    expect(cancel.height).toBeGreaterThanOrEqual(44);
    if (Math.abs(cancel.y - confirm.y) <= 1) {
      expect(cancel.x - (confirm.x + confirm.width)).toBeCloseTo(8, 0);
    } else {
      expect(cancel.y - (confirm.y + confirm.height)).toBeCloseTo(8, 0);
    }
    expect(cancel.x + cancel.width).toBeLessThanOrEqual(
      armed.x + armed.width - 8 + 0.5,
    );
    await walkRowControl(page, "The tower", "confirm").click();
    const undo = await boxOf(walkRowControl(page, "The tower", "act"));
    const bar = await boxOf(towerRow.getByTestId("walk-undobar"));
    const skipped = await boxOf(towerRow);
    // The undo's bar spans the title and the action columns, 3 px tall,
    // under both; the undo wraps within 170 px.
    expect(bar.x - skipped.x).toBeCloseTo(8 + 34 + 10, 0);
    expect(skipped.x + skipped.width - (bar.x + bar.width)).toBeCloseTo(8, 0);
    expect(bar.height).toBeCloseTo(3, 0);
    expect(bar.y).toBeGreaterThanOrEqual(undo.y + undo.height - 0.5);
    expect(undo.width).toBeLessThanOrEqual(170 + 0.5);
  });

  test(`the away block's segments span it in the walk's colours, inside the start's card, at ${label}`, async ({
    page,
  }) => {
    // Why (W4 M2 review): the segments are the block's full width, found
    // in W4's teal and the rest in its paper line (not the page's map
    // colours); on a desktop the block stays in the start's left column.
    await page.setViewportSize(viewport);
    await installTourViewerArFakes(page);
    await enterTheWalk(page);
    await standAt(page, 26, 0, 1);
    await expect(page.getByTestId("walk-story")).toBeVisible();
    await page.getByTestId("enter-ar").click();
    await expect(page.getByTestId("walk-away")).toBeVisible();
    const away = await box(page, "walk-away");
    const segments = await box(page, "walk-away-segments");
    expect(segments.x).toBeCloseTo(away.x, 0);
    expect(segments.width).toBeCloseTo(away.width, 0);
    const cells = page.getByTestId("walk-away-segments").locator("i");
    await expect(cells).toHaveCount(4);
    await expect(cells.first()).toHaveCSS(
      "background-color",
      "rgb(15, 118, 110)",
    );
    await expect(cells.last()).toHaveCSS(
      "background-color",
      "rgb(221, 214, 199)",
    );
    // Its rows are W4's white cards on the paper line.
    const row = page.getByTestId("walk-away-row").first();
    await expect(row).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(row).toHaveCSS("border-top-color", "rgb(221, 214, 199)");
    // ... their titles W4's 15 px bold, not the start page's small type.
    await expect(row.locator("b")).toHaveCSS("font-size", "15px");
    await expect(row.locator("b")).toHaveCSS("font-weight", "700");
    const card = await page.locator("#visitor-screen").boundingBox();
    if (card === null) throw new Error("no start card");
    expect(away.x).toBeGreaterThanOrEqual(card.x - 0.5);
    expect(away.x + away.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
    expect(away.x + away.width).toBeLessThanOrEqual(viewport.width + 0.5);
  });
}

/** A tour whose stations hold items (pins): every walk layout also runs
 *  on one (the walk's lessons). */
const ITEMS_ARCHIVE = "http://127.0.0.1:5197/ranges-ok/stations-tour.zip";

/** Two boxes overlap (strictly: touching edges do not). */
const overlaps = (a, b) =>
  a.x < b.x + b.width - 0.5 &&
  b.x < a.x + a.width - 0.5 &&
  a.y < b.y + b.height - 0.5 &&
  b.y < a.y + a.height - 0.5;

for (const viewport of VIEWPORTS) {
  const label = `${String(viewport.width)}x${String(viewport.height)}`;
  for (const archive of [WALK_ARCHIVE, ITEMS_ARCHIVE]) {
    const tour = archive === WALK_ARCHIVE ? "stories" : "items";
    test(`the radar sits at the top right with the chip under it, clear of the walk, at ${label} (${tour})`, async ({
      page,
    }) => {
      // Why (visitor walk W4 build plan M3, §1.2): W4's radar is 132 px,
      // 30 px from the top and 12 px from the right (108 px and 10 px on a
      // phone held sideways); the chip stands 6 px under it, right-aligned,
      // at most 36 px wider; neither covers the Exit button, the sheet
      // (closed or open) or the toast's place.
      await page.setViewportSize(viewport);
      await installTourViewerArFakes(page);
      await enterTheWalk(page, archive);
      const size = sideways(viewport) ? 108 : 132;
      const radar = await box(page, "walk-radar");
      expect(radar.width).toBeCloseTo(size, 0);
      expect(radar.height).toBeCloseTo(size, 0);
      expect(viewport.width - (radar.x + radar.width)).toBeCloseTo(12, 0);
      expect(radar.y).toBeCloseTo(sideways(viewport) ? 10 : 30, 0);
      await expect(page.getByTestId("walk-radar")).toHaveCSS(
        "border-radius",
        "50%",
      );
      const chip = await box(page, "walk-precision");
      expect(chip.y - (radar.y + radar.height)).toBeCloseTo(6, 0);
      expect(chip.x + chip.width).toBeCloseTo(radar.x + radar.width, 0);
      expect(chip.width).toBeLessThanOrEqual(size + 36 + 0.5);
      await expect(page.getByTestId("walk-precision")).toHaveCSS(
        "font-size",
        "12px",
      );
      await expect(page.getByTestId("walk-precision")).toHaveCSS(
        "border-radius",
        "14px",
      );
      const exit = await box(page, "enter-ar");
      const sheet = await box(page, "walk-sheet");
      for (const other of [exit, sheet]) {
        expect(overlaps(radar, other)).toBe(false);
        expect(overlaps(chip, other)).toBe(false);
      }
      // The list open: still clear of the radar and the chip.
      await page.getByTestId("walk-grab").click();
      await expect(page.getByTestId("walk-list")).toBeVisible();
      const open = await box(page, "walk-sheet");
      expect(overlaps(radar, open)).toBe(false);
      expect(overlaps(chip, open)).toBe(false);
      await page.getByTestId("walk-close").click();
      // A skip's toast stands clear of the radar and the chip (the
      // stories tour: the items tour's first station is found at the
      // code, its story playing).
      if (archive !== WALK_ARCHIVE) return;
      const quick = page.getByTestId("station-skip");
      await quick.click();
      await page.getByTestId("walk-row-confirm").click();
      await expect(page.locator("#walk-toast")).toBeVisible();
      const toast = await page.locator("#walk-toast").boundingBox();
      if (toast === null) throw new Error("no toast");
      expect(overlaps(radar, toast)).toBe(false);
      expect(overlaps(chip, toast)).toBe(false);
    });
  }
}

test("the away block sits above the start's safety line, inside a phone's screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installTourViewerArFakes(page);
  await enterTheWalk(page);
  await standAt(page, 26, 0, 1);
  await expect(page.getByTestId("walk-story")).toBeVisible();
  await page.getByTestId("enter-ar").click();
  await expect(page.getByTestId("walk-away")).toBeVisible();
  const away = await box(page, "walk-away");
  const root = await page.locator("#ar-root").boundingBox();
  if (root === null) throw new Error("no ar-root");
  // The block's gap to the start below it: W4's 16 px becomes the start
  // page's own spacing (the visitor screen's end, #ar-root's 12 px), with
  // the safety line kept between the block and the button.
  expect(root.y - (away.y + away.height)).toBeCloseTo(29, 0);
  const rows = page.getByTestId("walk-away-row");
  await expect(rows).toHaveCount(4);
  const r = await rows.first().boundingBox();
  if (r === null) throw new Error("no row");
  expect(r.height).toBeGreaterThanOrEqual(44);
  expect(away.x).toBeGreaterThanOrEqual(16 - 1);
  const start = await box(page, "enter-ar");
  expect(start.y + start.height).toBeLessThanOrEqual(844);
  expect(away.x + away.width).toBeLessThanOrEqual(390 - 16 + 1);
});

test("sideways, 'Back to the tour' is on screen without scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await installTourViewerArFakes(page);
  await enterTheWalk(page);
  await standAt(page, 26, 0, 1);
  await expect(page.getByTestId("walk-story")).toBeVisible();
  await page.getByTestId("enter-ar").click();
  await expect(page.getByTestId("walk-away")).toBeVisible();
  await expect(page.getByTestId("enter-ar")).toHaveText("Back to the tour");
  const start = await box(page, "enter-ar");
  expect(start.y).toBeGreaterThanOrEqual(0);
  expect(start.y + start.height).toBeLessThanOrEqual(390);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  const label = `${String(viewport.width)}x${String(viewport.height)}`;
  test(`the chip's longest words wrap to two lines under the radar, right-aligned, at ${label}`, async ({
    page,
  }) => {
    // Why (W4 build plan M3 review): the code state's one short line hid
    // whether the chip's longest words ("GPS - about N m, too weak") keep
    // W4's place - 6 px under the radar, its right edge on the radar's,
    // at most 36 px wider - when they wrap, sideways too.
    await page.setViewportSize(viewport);
    await installTourViewerArFakes(page);
    await openTheWalk(page);
    await page.getByTestId("enter-ar").click();
    await seedAlignment(page);
    await page.evaluate(() => {
      /** @type {any} */ (window).__tourViewerTest.fireTimers();
    });
    await page.getByTestId("scan-escape").click();
    await reportArTracking(page, true);
    for (let i = 0; i < 10; i += 1) await standAt(page, 0, 0, "now", 60);
    // The tracking report not ready: the fresh fix stands in, judged by
    // its own accuracy (the radar spec's path to too weak).
    await page.evaluate(() => {
      const t = /** @type {any} */ (window).__tourViewerTest;
      t.alignmentStore.dispatch({
        type: "trackingQuality/reportUpdated",
        payload: {
          state: "degraded",
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
      t.emitFrames(1);
    });
    const text = page.getByTestId("walk-precision-text");
    await expect(text).toHaveText(/^GPS - about \d+ m, too weak$/);
    const size = sideways(viewport) ? 108 : 132;
    const radar = await box(page, "walk-radar");
    const chip = await box(page, "walk-precision");
    expect(chip.y - (radar.y + radar.height)).toBeCloseTo(6, 0);
    expect(chip.x + chip.width).toBeCloseTo(radar.x + radar.width, 0);
    expect(chip.width).toBeLessThanOrEqual(size + 36 + 0.5);
    // Two lines of 12 px type at a line height of 1.2, inside 5 px of
    // padding and a 1 px border: the words wrap rather than overflow.
    const lines = await box(page, "walk-precision-text");
    expect(lines.height).toBeGreaterThanOrEqual(2 * 14.4 - 0.5);
    expect(lines.height).toBeLessThan(3 * 14.4 - 0.5);
    expect(
      await page
        .getByTestId("walk-precision")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 0.5),
    ).toBe(true);
    for (const other of [
      await box(page, "enter-ar"),
      await box(page, "walk-sheet"),
    ]) {
      expect(overlaps(chip, other)).toBe(false);
    }
  });
}

/**
 * The running CSS animations and transitions inside \`#ar-root\`, each as
 * \`{ kind, name, on }\`: an animation by its keyframes' name, a transition
 * by its property; \`on\` is the element's id or class (with a
 * pseudo-element's name) and \`ms\` the duration.
 */
async function runningInAr(page) {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === "running")
      .flatMap((a) => {
        const effect = /** @type {KeyframeEffect | null} */ (a.effect);
        const target = effect?.target ?? null;
        if (target === null || target.closest("#ar-root") === null) return [];
        const any = /** @type {any} */ (a);
        const cls =
          typeof target.className === "string" ? target.className : "";
        return [
          {
            kind: any.animationName === undefined ? "transition" : "animation",
            name: any.animationName ?? any.transitionProperty ?? "",
            on: (target.id || cls) + (effect?.pseudoElement ?? ""),
            ms: Number(effect?.getTiming().duration ?? 0),
          },
        ];
      }),
  );
}

for (const reduced of [false, true]) {
  // Why this test matters: a visitor who asked for reduced motion gets a
  // walk that holds still - otherwise the coach's spinner, the timed story
  // dot, the toast, the undo's bar and the radar's and arrow's easing all
  // move. The CSS guard in \`walk-sheet.test.ts\` checks that each animated
  // rule is named in the reduced-motion block; only a browser shows that
  // each one wins its cascade. The run without the preference pins that
  // the same states do animate, so the reduced run is not quiet by
  // accident. Not reached here: the chip's pending pulse (the fakes give a
  // position before the sheet shows); the CSS guard covers it.
  test(`the walk's states ${reduced ? "hold still under" : "animate without"} reduced motion`, async ({
    page,
  }) => {
    await page.emulateMedia({
      reducedMotion: reduced ? "reduce" : "no-preference",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await installTourViewerArFakes(page);
    /** @type {{ state: string, kind: string, name: string, on: string, ms: number }[]} */
    const seen = [];
    const look = async (/** @type {string} */ state) => {
      for (const a of await runningInAr(page)) seen.push({ state, ...a });
    };
    await openTheWalk(page);
    await page.evaluate(() => {
      /** @type {any} */ (window).__tourViewerTest.holdInitAR = true;
    });
    await page.getByTestId("enter-ar").click();
    await expect(page.getByTestId("walk-coach")).toHaveAttribute(
      "data-look",
      "spinner",
    );
    await look("the coach's spinner");
    await page.evaluate(() => {
      /** @type {any} */ (window).__tourViewerTest.releaseInitAR();
    });
    await seedAlignment(page);
    await standAt(page, 0, 0, 0);
    await lockFixtureCode(page);
    await expect(page.getByTestId("walk-sheet")).toBeVisible();
    await trackingOk(page);
    await waitForTheGuess(page);
    await look("the peek");
    await standAt(page, 26, 0, 1);
    await expect(page.getByTestId("walk-story")).toBeVisible();
    await expect(
      page.getByTestId("walk-dots").locator("i").first(),
    ).toHaveAttribute("data-timed", "true");
    await look("a timed story step");
    await page.getByTestId("story-end").click();
    await page.getByTestId("story-end").click();
    await expect(page.getByTestId("walk-story")).toBeHidden();
    await page.getByTestId("station-skip").click();
    await page.getByTestId("walk-row-confirm").click();
    await expect(page.locator("#walk-toast")).toHaveText(/^Skipped /);
    await look("a skip's toast and undo");
    if (reduced) {
      // Nothing in the AR overlay moves: no animation runs, and a
      // transition lasts at most a frame (the design system shortens its
      // own to 1 ms under the preference rather than removing them).
      expect(seen.filter((a) => a.kind === "animation" || a.ms > 16)).toEqual(
        [],
      );
    } else {
      const named = new Set(seen.map((a) => `${a.state}: ${a.name}`));
      for (const expected of [
        "the coach's spinner: walk-spin",
        "a timed story step: walk-dot",
        "a skip's toast and undo: enter-rise",
        "a skip's toast and undo: walk-undo",
        "the peek: filter",
      ]) {
        expect([...named], expected).toContain(expected);
      }
    }
  });
}
