// @ts-check
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import {
  forceTrackingReady,
  installTourViewerArFakes,
  seedAlignment,
  standAt,
  waitForTheGuess,
} from "./ar-fakes.js";

/**
 * The committed anchor field-test tour (`public/samples/anchor-test-tour.zip`)
 * through the link the phone test opens: `?relocate=here&debug=1`. The tour
 * sits at a public square; the switch moves its stations, and their
 * content, to the phone's first fix, and the debug log carries the
 * anchors' section with its verdict.
 */

const ARCHIVE = "http://127.0.0.1:5197/ranges-ok/anchor-test-tour.zip";

test.beforeEach(async ({ page }) => {
  await installTourViewerArFakes(page);
  await page.addInitScript(() => {
    // @ts-expect-error - the save picker is taken away on purpose: the
    // download goes through the page's <a download> fallback.
    delete window.showSaveFilePicker;
  });
});

test("the anchor test tour, moved to the phone, offers its tower about 15 m away and logs the anchors' verdict", async ({
  page,
}) => {
  // Why this test matters: the phone test of the deferred anchors runs
  // through exactly this link, from a deployed preview with no PC. If the
  // tour does not open, is not moved, or the log lacks the anchors' section
  // and its verdict, the test cannot be read off the pasted log.
  await page.goto(
    `/?qr=${encodeURIComponent(ARCHIVE)}&relocate=here&debug=1&anchors=ab`,
  );
  const button = page.getByTestId("enter-ar");
  await expect(button).toBeEnabled({ timeout: 15000 });
  await button.click();
  // The seeded fixes start at the zero and walk south and west, away from
  // the first station (15 m north of the first fix), as the sample tour's
  // test does.
  await seedAlignment(page, { southWest: true });
  await standAt(page, 0, 0, 0);
  await forceTrackingReady(page);

  await expect(page.getByTestId("relocate-note")).toBeVisible({
    timeout: 15000,
  });
  // An any-order tour names no station until the position holds steady.
  await waitForTheGuess(page);
  await expect(page.getByTestId("station-line")).toHaveText(
    /^3 stations to find - nearest: A: the tower, (1[0-9]|2[0-5]) m$/,
    { timeout: 15000 },
  );

  const tools = page.getByTestId("travel-log-tools");
  await expect(tools).not.toHaveAttribute("hidden", "");
  const download = page.waitForEvent("download");
  await page.evaluate(() => {
    document.getElementById("travel-log-download")?.click();
  });
  const text = readFileSync(await (await download).path(), "utf8");
  expect(text).toContain("--- anchors ---");
  expect(text).toContain("--- verdict ---");
  expect(text).toMatch(/^pass p95/m);
  expect(text).toMatch(/^frame p95 regression/m);
  expect(text).toMatch(/^out-of-view commits within their queue/m);
});
