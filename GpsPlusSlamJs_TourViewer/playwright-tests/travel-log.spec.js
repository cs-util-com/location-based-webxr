// @ts-check
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { installTourViewerArFakes } from "./ar-fakes.js";

/**
 * Why these tests matter: the travelling box's field log is a debug tool
 * on the visitor's page. Its buttons must stay out of a visitor's view
 * without `?debug=1`, show with it, and the `tb.*` knobs of the address
 * must reach the travel controller: the log's head carries the knobs the
 * walk ran with, and a sweep read against the wrong knobs would be wrong
 * without anyone noticing. The download is the copy's fallback, so it is
 * the path checked here (headless Chromium has no clipboard to read).
 */

const ARCHIVE = "http://127.0.0.1:5197/ranges-ok/tour.zip";

test.beforeEach(async ({ page }) => {
  await installTourViewerArFakes(page);
  await page.addInitScript(() => {
    // @ts-expect-error - the save picker is taken away on purpose: the
    // download goes through the page's <a download> fallback.
    delete window.showSaveFilePicker;
  });
});

/**
 * Opens the tour as a visitor, with `extra` on the address.
 * @param {import("@playwright/test").Page} page
 * @param {string} extra
 */
async function openAsVisitor(page, extra) {
  await page.goto(`/?qr=${encodeURIComponent(ARCHIVE)}${extra}`);
  await expect(page.locator("body")).toHaveAttribute(
    "data-tour-open",
    "settled",
    { timeout: 15000 },
  );
}

test("the travel log's buttons stay hidden without debug", async ({ page }) => {
  await openAsVisitor(page, "&tb.thr=16");
  await expect(page.getByTestId("travel-log-tools")).toHaveAttribute(
    "hidden",
    "",
  );
});

test("with debug the travel log shows and carries the address's knobs", async ({
  page,
}) => {
  await openAsVisitor(page, "&debug=1&tb.thr=16&tb.lock=0");
  const tools = page.getByTestId("travel-log-tools");
  await expect(tools).not.toHaveAttribute("hidden", "");
  const download = page.waitForEvent("download");
  await page.evaluate(() => {
    document.getElementById("travel-log-download")?.click();
  });
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^travel-log-.*\.txt$/);
  const head = JSON.parse(
    readFileSync(await file.path(), "utf8").split("\n")[0] ?? "",
  );
  expect(head).toMatchObject({
    kind: "head",
    v: 2,
    knobs: { thr: 16, lock: 0 },
  });
  await expect(page.getByTestId("travel-log-download")).toHaveText(
    "Log downloaded",
  );
});
