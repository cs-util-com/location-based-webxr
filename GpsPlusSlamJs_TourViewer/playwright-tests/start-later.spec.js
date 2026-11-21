// @ts-check
import { expect, test } from "@playwright/test";

import {
  finishAndDownload,
  installTourViewerArFakes,
  seedAlignment,
} from "./ar-fakes.js";

/**
 * "Start on this phone now, share later" (setup flow round 2): one tap
 * saves the empty starter tour on this phone and opens that same file as
 * the tour, before AR; Done then leads to making the code.
 *
 * Why these tests matter: placing is locked while no tour is open, so this
 * route is the only way a creator without storage can begin. The unit
 * tests pin save-before-open with fakes; only the real page shows that the
 * saved zip really opens as the tour (the open marks the page settled and
 * lands on step 5), and that Done shows "Make your code now" instead of
 * the steps for replacing a file at a link that does not exist yet.
 */

test("saves the starter tour, opens it here, and Done leads to making the code @pr", async ({
  page,
}) => {
  await installTourViewerArFakes(page);
  await page.goto("/?nocache=1");
  await page.getByTestId("station-host").click();
  await page.getByTestId("start-answer-later").click();
  await expect(page.getByTestId("step-link")).toHaveAttribute("open", "");
  await expect(page.getByTestId("start-later")).toBeVisible();
  await expect(page.getByTestId("link-field")).toBeHidden();
  // The honest copy: the file stays empty until Done.
  await expect(page.getByTestId("link-why")).toContainText("empty until Done");

  await page.getByTestId("start-here").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    { timeout: 15000 },
  );
  await expect(page.getByTestId("start-here")).toHaveText("Saved and opened");
  const saved = await page.evaluate(() =>
    /** @type {any} */ (window).__tourViewerTest.downloads.map(
      (/** @type {{ filename: string, seam?: string }} */ d) => [
        d.filename,
        d.seam,
      ],
    ),
  );
  expect(saved).toEqual([["tour.zip", "download"]]);
  await expect(page.getByTestId("step-measure")).toHaveAttribute("open", "");

  // Back at "Your file", a second tap must not save another empty file
  // and open it over the tour that is open.
  await page.getByTestId("station-link").click();
  await expect(page.getByTestId("start-here")).toBeVisible();
  await page.getByTestId("start-here").click();
  await expect(page.getByTestId("start-here")).toHaveText(
    "A tour is already open on this phone",
  );
  expect(
    await page.evaluate(
      () => /** @type {any} */ (window).__tourViewerTest.downloads.length,
    ),
  ).toBe(1);
  await page.getByTestId("station-measure").click();
  await expect(page.getByTestId("step-measure")).toHaveAttribute("open", "");

  // A new tour has no measured code: placing runs on the GPS fix alone.
  await page.getByTestId("enter-ar").click();
  await seedAlignment(page);
  await expect(page.getByTestId("setup-pin")).toBeEnabled();
  await page.getByTestId("setup-pin").click();
  await page.getByTestId("pin-label").fill("Gate");
  await page.getByTestId("pin-save").click();
  // The Finish saves the tour zip by itself, after the starter (index 0).
  await finishAndDownload(page, 1);
  await expect(page.getByTestId("step-done")).toHaveAttribute("open", "");
  await expect(page.getByTestId("finish-status")).toContainText(
    "make its code",
  );
  await expect(page.getByTestId("make-code")).toBeVisible();
  await expect(page.locator("#replace-help")).toBeHidden();
  await expect(page.locator("#upload-ask")).toBeHidden();

  await page.getByTestId("make-code-start").click();
  await expect(page.getByTestId("step-link")).toHaveAttribute("open", "");
  await expect(page.getByTestId("link-heading")).toHaveText(
    "Put your tour online, then paste its link",
  );
  await expect(page.getByTestId("start-host")).toBeVisible();
  // The zip was saved at Done: no starter offered a second time. A host
  // is chosen first, since with none chosen the starter is hidden anyway;
  // Dropbox is one that offers the starter on a new tour.
  await page
    .getByTestId("host-tiles")
    .getByRole("button")
    .filter({ hasText: "Dropbox" })
    .click();
  await expect(page.getByTestId("host-steps")).toBeVisible();
  await expect(page.getByTestId("starter-zip")).toBeHidden();
  await expect(
    page.getByTestId("host-steps").locator("li").first(),
  ).toContainText("Find the tour zip this phone saved at Done");
});

test("a dismissed save opens nothing and says so", async ({ page }) => {
  await installTourViewerArFakes(page);
  await page.goto("/?nocache=1");
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.saveOutcome = false;
  });
  await page.getByTestId("station-host").click();
  await page.getByTestId("start-answer-later").click();
  await page.getByTestId("start-here").click();
  await expect(page.getByTestId("start-here")).toHaveText(
    "Not saved - tap to try again",
  );
  await expect(page.getByTestId("start-here")).toBeEnabled();
  await expect(page.locator("body")).not.toHaveAttribute(
    "data-tour-open",
    "settled",
  );
});
