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
    await expect(page.getByTestId("gallery").locator("img")).toHaveCount(8, {
      timeout: 15000,
    });
    const step = page.getByTestId("step-measure");
    if (!(await step.evaluate((el) => /** @type {any} */ (el).open))) {
      await step.locator("summary").click();
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
      await step.locator("summary").click();
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
  test(`every AR panel control fits a ${viewport.width}x${viewport.height} screen, with an object selected through the chooser and the code's re-measure offered`, async ({
    page,
  }) => {
    // The editing state (authoring plan 2026-09-28-0953 M4; review #4): a
    // hosted tour reopened, its stored code measured again (so "Re-measure
    // the code" is offered), and the hosted pin selected with the AR
    // chooser - the selected row's Edit / Move / Delete / Done, the
    // chooser's own line, the placement controls and the recording marker
    // together. The previous layout test never reached this state.
    await page.setViewportSize(viewport);
    await installTourViewerArFakes(page);
    await page.goto("/?debug=1");
    await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
    await page.getByTestId("open-button").click();
    await expect(page.getByTestId("gallery").locator("img")).toHaveCount(8, {
      timeout: 15000,
    });
    const step = page.getByTestId("step-measure");
    if (!(await step.evaluate((el) => /** @type {any} */ (el).open))) {
      await step.locator("summary").click();
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
    await expect(page.getByTestId("setup-mint")).toBeEnabled({
      timeout: 10000,
    });
    await page.getByTestId("setup-mint").click();
    await expect(page.getByTestId("setup-pin")).toBeEnabled();
    await expect(page.getByTestId("replace-code")).toBeVisible();

    await page.getByTestId("object-next").click();
    const selected = page.locator(
      '[data-testid="object-row"][data-selected="true"]',
    );
    await expect(selected.getByTestId("object-move")).toBeVisible();
    await expect(page.getByTestId("object-position")).toHaveText(/^1 of \d+$/);

    expect(await controlsBelowTheFold(page)).toEqual([]);
  });
}
