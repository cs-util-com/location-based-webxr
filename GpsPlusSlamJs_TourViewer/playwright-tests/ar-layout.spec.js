// @ts-check
import { expect, test } from "@playwright/test";

import { installTourViewerArFakes, seedAlignment } from "./ar-fakes.js";
import { E2E_QR_TEXT } from "./qr-fixture.mjs";

/**
 * Why these tests matter: in a WebXR DOM overlay `#ar-root` IS the screen,
 * and nothing in it can be scrolled into view by a creator holding a phone
 * at a poster. The owner's r750 field test found the print-size offer's
 * buttons below the bottom edge: the framework's AR canvas (window-sized,
 * inserted as `#ar-root`'s first child) sat in the page flow and pushed the
 * whole panel down a screen height. No test saw it because the AR fakes
 * inserted no canvas and nothing measured the overlay (TourViewer
 * scan-to-open plan §1, §5 #6). Every control the creator can see must lie
 * within one screen height of the overlay's top, in the tallest state the
 * panel reaches (the offer, the live readout, `?debug=1`), on small phones.
 */

const RANGES_ARCHIVE = "http://127.0.0.1:5197/ranges-ok/tour.zip";

/**
 * The visible `#ar-root` controls whose bottom edge lies more than one
 * screen height below the overlay's top - measured without scrolling: on
 * the device `#ar-root` fills the screen from its top edge.
 */
async function controlsBelowTheFold(page) {
  return page.evaluate(() => {
    const root = /** @type {HTMLElement} */ (
      document.getElementById("ar-root")
    );
    const top = root.getBoundingClientRect().top;
    return [...root.querySelectorAll("button, input")]
      .map((el) => /** @type {HTMLElement} */ (el))
      .filter((el) => el.offsetParent !== null)
      .filter(
        (el) => el.getBoundingClientRect().bottom - top > window.innerHeight,
      )
      .map((el) => el.id || el.dataset.testid || el.tagName);
  });
}

const PHONES = [
  { width: 360, height: 640 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
];

for (const viewport of PHONES) {
  test(`every AR panel control fits a ${viewport.width}x${viewport.height} screen, with the size offer open`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    // A print that came out at 96 % of the typed 0.16 m (the owner's).
    await installTourViewerArFakes(page, { printSizeM: 0.154 });
    await page.goto("/?debug=1");
    await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
    await page.getByTestId("open-button").click();
    await expect(page.locator("body")).toHaveAttribute(
      "data-tour-open",
      "settled",
      {
        timeout: 15000,
      },
    );
    const step = page.getByTestId("step-measure");
    if (!(await step.evaluate((el) => /** @type {any} */ (el).open))) {
      await page.getByTestId("station-measure").click();
    }
    // The troubleshooting recording's marker is one more line inside the
    // overlay (authoring recording plan 2026-09-28-0953, M1a) - part of the
    // tallest state the panel reaches.
    await page.getByTestId("record-session").check();
    await expect(page.getByTestId("enter-ar")).toBeEnabled({ timeout: 10000 });
    await page.getByTestId("enter-ar").click();
    await expect(page.getByTestId("recording-marker")).toBeVisible();
    await page.evaluate((text) => {
      /** @type {any} */ (window).__tourViewerTest.armQrDetection(text);
    }, E2E_QR_TEXT);
    await expect
      .poll(
        async () => {
          await page.evaluate(() => {
            /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
          });
          return page.getByTestId("size-offer-use").isVisible();
        },
        { timeout: 20000 },
      )
      .toBe(true);

    expect(await controlsBelowTheFold(page)).toEqual([]);
    // The offer sits above the status line (the owner's decision).
    const offerY = (await page.getByTestId("size-offer").boundingBox())?.y ?? 0;
    const statusY =
      (await page.getByTestId("setup-status").boundingBox())?.y ?? 0;
    expect(offerY).toBeLessThan(statusY);
  });
}

for (const viewport of PHONES) {
  test(`every AR panel control fits a ${viewport.width}x${viewport.height} screen, with the longest scan-to-open note`, async ({
    page,
  }) => {
    // Scan-to-open plan §9 #14: with no tour open the panel carries the
    // code's status line, whose longest form is a file not hosted yet -
    // one more line of text above the controls on a small phone.
    await page.setViewportSize(viewport);
    await installTourViewerArFakes(page);
    await page.goto("/?debug=1");
    const step = page.getByTestId("step-measure");
    if (!(await step.evaluate((el) => /** @type {any} */ (el).open))) {
      await page.getByTestId("station-measure").click();
    }
    await expect(page.getByTestId("enter-ar")).toBeEnabled({ timeout: 10000 });
    await page.getByTestId("enter-ar").click();
    const missing = `https://gps.csutil.com/tour/?qr=${encodeURIComponent(
      "http://127.0.0.1:5197/ranges-ok/does-not-exist.zip",
    )}`;
    await page.evaluate((text) => {
      /** @type {any} */ (window).__tourViewerTest.armQrDetection(text);
    }, missing);
    await expect
      .poll(
        async () => {
          await page.evaluate(() => {
            /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
          });
          return page.getByTestId("setup-status").textContent();
        },
        { timeout: 20000 },
      )
      .toMatch(/in view to try again/);

    expect(await controlsBelowTheFold(page)).toEqual([]);
  });
}

for (const viewport of PHONES) {
  test(`every AR panel control fits a ${viewport.width}x${viewport.height} screen, with an object selected by a tap`, async ({
    page,
  }) => {
    // The editing state (authoring plan 2026-09-28-0953 M4; review #4): a
    // hosted tour reopened, its stored code measured again, and the hosted
    // pin selected by a tap on it - the selected row's Edit / Move /
    // Delete / Done, the placement controls and the recording marker
    // together. The previous layout test never reached this state.
    await page.setViewportSize(viewport);
    await installTourViewerArFakes(page);
    await page.goto("/?debug=1");
    await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
    await page.getByTestId("open-button").click();
    await expect(page.locator("body")).toHaveAttribute(
      "data-tour-open",
      "settled",
      {
        timeout: 15000,
      },
    );
    const step = page.getByTestId("step-measure");
    if (!(await step.evaluate((el) => /** @type {any} */ (el).open))) {
      await page.getByTestId("station-measure").click();
    }
    await page.getByTestId("record-session").check();
    await expect(page.getByTestId("enter-ar")).toBeEnabled({ timeout: 10000 });
    await page.getByTestId("enter-ar").click();
    await page.evaluate((text) => {
      /** @type {any} */ (window).__tourViewerTest.armQrDetection(text);
    }, E2E_QR_TEXT);
    await expect
      .poll(
        async () => {
          await page.evaluate(() => {
            /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
          });
          return page.getByTestId("setup-status").textContent();
        },
        { timeout: 20000 },
      )
      .toMatch(/waiting for GPS alignment/i);
    await seedAlignment(page);
    await expect(page.getByTestId("setup-status")).toContainText(
      /Code measured/,
      { timeout: 10000 },
    );
    await expect(page.getByTestId("setup-pin")).toBeEnabled();

    // Selected by a tap on it (polish round M3: the chooser is gone).
    await page.evaluate(() => {
      const t = /** @type {any} */ (window).__tourViewerTest;
      t.pickId = "fixturepin01";
      t.tapXr();
    });
    const selected = page.locator(
      '[data-testid="object-row"][data-selected="true"]',
    );
    await expect(selected.getByTestId("object-move")).toBeVisible();
    await expect(selected.getByTestId("object-close")).toBeVisible();
    // Object mode: the place buttons step aside.
    await expect(page.getByTestId("setup-pin")).toBeHidden();

    expect(await controlsBelowTheFold(page)).toEqual([]);
  });
}

/** The box of a test id, in viewport pixels. */
async function box(page, testId) {
  const b = await page.getByTestId(testId).boundingBox();
  if (b === null) throw new Error(`${testId} has no box`);
  return { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height };
}

/**
 * A wide sans-serif in place of the UI font. Windows renders the stack in
 * Corbel, a narrow face; a Linux runner falls back to a much wider one, and
 * the chip row that fit locally overflowed the 360 px screen there (left
 * edge at -3.86 px). Every layout check below runs in the wide face, so a
 * local run sees what a phone with wide fonts sees.
 */
const WIDE_UI_FONT =
  ':root { --font-ui: "DejaVu Sans", Verdana, sans-serif !important; }';

for (const viewport of [
  { width: 412, height: 915 },
  { width: 360, height: 640 },
  { width: 320, height: 640 },
  { width: 915, height: 412 },
]) {
  test(`the creator's HUD in AR is H1 on ${viewport.width}x${viewport.height}: the card top left, Done top right, the chips at the bottom (polish round M3, D-P4)`, async ({
    page,
  }) => {
    // Why: the owner chose H1 - the camera view kept clear, the readout a
    // card at the top, the way out a chip beside it, the place actions a
    // row of chips at the bottom with "Place a pin" first. A test that only
    // asked whether each control is visible passed the old stacked panel;
    // this pins where each one sits (root CLAUDE.md: a chosen prototype is
    // pinned by positions, not presence).
    await page.setViewportSize(viewport);
    await installTourViewerArFakes(page);
    await page.goto("/");
    await page.addStyleTag({ content: WIDE_UI_FONT });
    await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
    await page.getByTestId("open-button").click();
    await expect(page.locator("body")).toHaveAttribute(
      "data-tour-open",
      "settled",
      {
        timeout: 15000,
      },
    );
    if (
      !(await page
        .getByTestId("step-measure")
        .evaluate((el) => /** @type {any} */ (el).open))
    ) {
      await page.getByTestId("station-measure").click();
    }
    await expect(page.getByTestId("enter-ar")).toBeEnabled({ timeout: 10000 });
    await page.getByTestId("enter-ar").click();
    await page.evaluate((text) => {
      /** @type {any} */ (window).__tourViewerTest.armQrDetection(text);
    }, E2E_QR_TEXT);
    await expect
      .poll(
        async () => {
          await page.evaluate(() => {
            /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
          });
          return page.getByTestId("setup-status").textContent();
        },
        { timeout: 20000 },
      )
      .toMatch(/waiting for GPS alignment/i);
    await seedAlignment(page);
    await expect(page.getByTestId("setup-pin")).toBeEnabled();

    const done = await box(page, "enter-ar");
    const card = await box(page, "setup-status");
    const pin = await box(page, "setup-pin");
    const photo = await box(page, "setup-photo");
    const newStation = await box(page, "setup-new-station");
    // Done: a chip at the top right.
    await expect(page.getByTestId("enter-ar")).toHaveText("Done");
    expect(done.top).toBeLessThan(40);
    expect(viewport.width - done.right).toBeLessThan(40);
    // The card: top left, beside Done, never under it.
    expect(card.top).toBeLessThan(40);
    expect(card.left).toBeLessThan(40);
    expect(card.right).toBeLessThanOrEqual(done.left);
    // The chips: at the bottom, one row, "Place a pin" first, centred.
    // "New station here" (D8) sits centred just above that row on every
    // screen, never off screen.
    expect(viewport.height - pin.bottom).toBeLessThan(80);
    expect(Math.abs(pin.top - photo.top)).toBeLessThan(6);
    expect(pin.right).toBeLessThanOrEqual(photo.left);
    const middle = (pin.left + photo.right) / 2;
    expect(Math.abs(middle - viewport.width / 2)).toBeLessThan(2);
    expect(newStation.bottom).toBeLessThanOrEqual(pin.top);
    expect(pin.top - newStation.bottom).toBeLessThan(16);
    expect(
      Math.abs((newStation.left + newStation.right) / 2 - viewport.width / 2),
    ).toBeLessThan(2);
    // The whole row on screen, at every width down to 320 px in the wide
    // face: a centred row wider than the screen spills off both edges.
    expect(pin.left).toBeGreaterThanOrEqual(0);
    expect(photo.right).toBeLessThanOrEqual(viewport.width);
    expect(newStation.left).toBeGreaterThanOrEqual(0);
    expect(newStation.right).toBeLessThanOrEqual(viewport.width);
    // The focus and reading order is the order on screen (WCAG 2.4.3):
    // top to bottom, then left to right - never CSS `order` or a reversed
    // wrap, which move the boxes but not the tab stops.
    expect(
      await page
        .getByTestId("setup-controls")
        .evaluate((el) =>
          [...el.querySelectorAll("button")]
            .filter((b) => b.getClientRects().length > 0)
            .map((b) => b.dataset.testid),
        ),
    ).toEqual(["setup-new-station", "setup-pin", "setup-photo"]);
    // The camera view between them is clear: nothing of the panel there.
    expect(pin.top - card.bottom).toBeGreaterThan(viewport.height * 0.3);
    // The technical line is ?debug=1's only.
    await expect(page.getByTestId("ar-status")).toBeHidden();
  });
}
