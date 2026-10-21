// @ts-check
import { expect, test } from "@playwright/test";

import {
  installTourViewerArFakes,
  lockFixtureCode,
  seedAlignment,
  standAt,
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
}

for (const viewport of VIEWPORTS) {
  const label = `${String(viewport.width)}x${String(viewport.height)}`;

  test(`the walk's sheet, its peek and the Exit button sit where W4 puts them at ${label}`, async ({
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
    // The grab is the sheet's top 22 px; the segments 6 px tall, 4 px
    // apart, 16 px in from the sheet's sides; the peek's row at least
    // 56 px tall (48 sideways).
    const grab = await box(page, "walk-grab");
    expect(grab.y).toBeCloseTo(sheet.y + 1, 0); // under the 1 px border
    expect(grab.height).toBeCloseTo(22, 0);
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
    // W4's figures are lining: the app font's old-style numerals would
    // shrink the rows' numbers.
    await expect(rows.first().locator(".walk-glyph")).toHaveCSS(
      "font-variant-numeric",
      "lining-nums",
    );
    await page.getByTestId("walk-close").click();
    // A skip's toast: in W4's place, left of the radar's corner (132 px
    // at the top right) on a phone, centred on a desktop.
    const quick = page.getByTestId("station-skip");
    await quick.click();
    await quick.click();
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
    // A suggestion or an undo takes the row's full width, on its own line.
    const undo = await box(page, "station-skip");
    const row = await box(page, "walk-peek-row");
    expect(undo.width).toBeCloseTo(row.width, 0);
    // Nothing of the walk under the Exit button.
    const exit = await box(page, "enter-ar");
    expect(t.y >= exit.y + exit.height || t.x >= exit.x + exit.width).toBe(
      true,
    );
  });

  test(`the coach stands where W4 centres it at ${label}`, async ({ page }) => {
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
    const acts = await box(page, "walk-story-acts");
    expect(acts.y).toBeGreaterThanOrEqual(dots.y + dots.height);
    const go = await box(page, "scene-continue");
    const end = await box(page, "story-end");
    expect(Math.abs(go.y - end.y)).toBeLessThanOrEqual(1);
    expect(end.x - (go.x + go.width)).toBeCloseTo(8, 0);
    expect(end.x + end.width).toBeLessThanOrEqual(sheet.x + sheet.width - 15);
  });
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
