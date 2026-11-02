// @ts-check
import { expect, test } from "@playwright/test";

import {
  installTourViewerArFakes,
  lockFixtureCode,
  seedAlignment,
  standAt,
} from "./ar-fakes.js";

/**
 * The visitor's view switch: inside a station, on a long text its creator
 * stands as a reading sign, the visitor picks Reading or Lectern. The
 * choice is kept on the device for every long text in every tour, and a
 * browser that refuses to store it keeps it for the visit. The archive
 * server's `/ranges-ok/long-text-tour.zip` and `long-text-tour-b.zip` are
 * two tours whose gates each hold such a long text.
 */

const TOUR_A = "http://127.0.0.1:5197/ranges-ok/long-text-tour.zip";
const TOUR_B = "http://127.0.0.1:5197/ranges-ok/long-text-tour-b.zip";

/**
 * Open `archive`, enter AR at the gate and wait for the switch.
 * @param {import("@playwright/test").Page} page
 * @param {string} archive
 */
async function enterTheGate(page, archive) {
  await page.goto(`/?qr=${encodeURIComponent(archive)}`);
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
        return page.getByTestId("view-switch").isVisible();
      },
      { timeout: 20000 },
    )
    .toBe(true);
}

/** @param {import("@playwright/test").Page} page */
async function emitFrame(page) {
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
  });
}

/**
 * The name of the stand a block is drawn as ("reading-sign", "lectern"),
 * frames emitted until it is `expected`.
 * @param {import("@playwright/test").Page} page
 * @param {string} blockId
 * @param {string} expected
 */
async function expectDrawnAs(page, blockId, expected) {
  await expect
    .poll(
      async () => {
        await emitFrame(page);
        return page.evaluate((id) => {
          /** @param {any} o @returns {string | null} */
          const find = (o) => {
            if (o.userData?.objectId === id) return o.name;
            for (const c of o.children ?? []) {
              const name = find(c);
              if (name !== null) return name;
            }
            return null;
          };
          return find(/** @type {any} */ (window).__tourViewerTest.fakeScene);
        }, blockId);
      },
      { timeout: 20000 },
    )
    .toBe(expected);
}

test("the visitor's view choice is remembered from one tour to the next", async ({
  page,
}) => {
  // Why this test matters: the preference is the device's, not the
  // tour's: a visitor who reads at a lectern once reads every long text
  // that way, in every tour, until they take the creator's choice again.
  // It also pins that the choice redraws the block already standing.
  await installTourViewerArFakes(page);
  await enterTheGate(page, TOUR_A);
  await expectDrawnAs(page, "gate-essay", "reading-sign");
  await expect(page.getByTestId("view-switch-current")).toHaveText("Reading");
  await page.getByTestId("view-switch-button").click();
  await page.getByTestId("view-switch-lectern").click();
  await expect(page.getByTestId("view-switch-menu")).toBeHidden();
  await expect(page.getByTestId("walk-toast-root")).toContainText(
    "Lectern from now on, for every long text on this phone.",
  );
  await expectDrawnAs(page, "gate-essay", "lectern");

  await enterTheGate(page, TOUR_B);
  await expect(page.getByTestId("view-switch-current")).toHaveText("Lectern");
  await expectDrawnAs(page, "keep-essay", "lectern");
  // The way back: the creator's choice again, in this tour and the next.
  await page.getByTestId("view-switch-button").click();
  await page.getByTestId("view-switch-reset").click();
  await expect(page.getByTestId("walk-toast-root")).toContainText(
    "Back to the creator's choice: Reading.",
  );
  await expectDrawnAs(page, "keep-essay", "reading-sign");
  await enterTheGate(page, TOUR_A);
  await expect(page.getByTestId("view-switch-current")).toHaveText("Reading");
});

test("a browser that refuses to store the choice keeps it for the visit", async ({
  page,
}) => {
  // Why this test matters: private browsing and full storage throw on a
  // write. The choice must still apply, and the visitor must be told it
  // lasts only this visit rather than believe it is kept.
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("refused", "QuotaExceededError");
    };
  });
  await installTourViewerArFakes(page);
  await enterTheGate(page, TOUR_A);
  await page.getByTestId("view-switch-button").click();
  await page.getByTestId("view-switch-lectern").click();
  await expect(page.getByTestId("walk-toast-root")).toContainText(
    "Lectern for this visit (this browser does not keep the choice).",
  );
  await expectDrawnAs(page, "gate-essay", "lectern");
  await expect(page.getByTestId("view-switch-current")).toHaveText("Lectern");
});

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1440, height: 900 },
];

/**
 * An element's box by test id.
 * @param {import("@playwright/test").Page} page
 * @param {string} testId
 */
async function box(page, testId) {
  const b = await page.getByTestId(testId).boundingBox();
  if (b === null) throw new Error(`${testId} has no box`);
  return b;
}

for (const viewport of VIEWPORTS) {
  test(`the switch sits beside the Exit button, its menu below it, at ${String(viewport.width)}x${String(viewport.height)}`, async ({
    page,
  }) => {
    // Why this test matters: the place is the owner's (top left, below
    // the notch) and the look the prototype's; a test of presence alone
    // passes a switch under the Exit button or a menu off the screen.
    // Pinned: the pill 8 px right of the round button, their centres on
    // one line, the prototype's 36 px pill, the menu 6 px under the pill
    // at its left edge, inside the screen, above the radar.
    await page.setViewportSize(viewport);
    await installTourViewerArFakes(page);
    await enterTheGate(page, TOUR_A);
    const exit = await box(page, "enter-ar");
    const pill = await box(page, "view-switch-button");
    expect(pill.height).toBeCloseTo(36, 0);
    expect(pill.x - (exit.x + exit.width)).toBeCloseTo(8, 0);
    expect(pill.y + pill.height / 2).toBeCloseTo(exit.y + exit.height / 2, 0);
    await page.getByTestId("view-switch-button").click();
    const menu = await box(page, "view-switch-menu");
    expect(menu.y - (pill.y + pill.height)).toBeCloseTo(6, 0);
    expect(menu.x).toBeCloseTo(pill.x, 0);
    expect(menu.width).toBeCloseTo(Math.min(290, viewport.width - 30), 0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(viewport.width);
    expect(menu.y + menu.height).toBeLessThanOrEqual(viewport.height);
    // The radar does not cover the menu: what is under its top right (inside
    // its 16 px rounded corner) is the menu.
    const topmost = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest(".vs-menu") != null,
      [menu.x + menu.width - 20, menu.y + 20],
    );
    expect(topmost).toBe(true);
  });
}
