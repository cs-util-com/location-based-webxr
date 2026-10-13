// @ts-check
import { expect, test } from "@playwright/test";

/**
 * Why these tests matter (tour kit plan K0, K-D1): a link only works when
 * its host lets browsers read the file. "Open a file" is the way around a
 * host that does not: the tour is downloaded, then opened from the device.
 * These specs drive the REAL file chooser (Playwright's `filechooser`
 * event), check the async-UI states on success and on failure, and check
 * that a host that blocks browsers - and only such a host, not an offline
 * phone - gets the "download the file" advice with its own button.
 */

const ARCHIVE_HOST = "http://127.0.0.1:5197";
const RANGES_URL = `${ARCHIVE_HOST}/ranges-ok/tour.zip`;
const NO_CORS_URL = `${ARCHIVE_HOST}/no-cors/tour.zip`;

/**
 * The e2e tour's bytes, as a file a visitor downloaded.
 * @param {import("@playwright/test").APIRequestContext} request
 */
async function tourFile(request) {
  const response = await request.get(RANGES_URL);
  return {
    name: "tour (1).zip",
    mimeType: "application/zip",
    buffer: await response.body(),
  };
}

/** Step 1 holds the device open (polish round M2, A5); the suite's
 *  creator has a stored host, so the page starts at step 2.
 *  @param {import("@playwright/test").Page} page */
async function openHostStep(page) {
  await page.getByTestId("station-host").click();
  await expect(page.getByTestId("step-host")).toHaveAttribute("open", "");
}

test("opens a tour zip from the device through the file chooser", async ({
  page,
  request,
}) => {
  const file = await tourFile(request);
  await page.goto("/?nocache=1");
  const chooser = page.waitForEvent("filechooser");
  await openHostStep(page);
  await page.getByTestId("open-file-button").click();
  await (await chooser).setFiles(file);

  await expect(page.getByTestId("gallery").locator("img")).toHaveCount(8, {
    timeout: 15000,
  });
  await expect(page.getByTestId("file-status")).toContainText("tour (1).zip");
  // A file has no link: the print step asks for one instead of showing a
  // made-up address.
  await expect(page.getByTestId("print-url-shown")).toBeHidden();
  await expect(page.getByTestId("open-file-button")).toHaveText(
    "Open it from this device",
  );
  await expect(page.getByTestId("open-file-button")).toBeEnabled();
});

test("a file that is not a zip reports a plain error and restores the button", async ({
  page,
}) => {
  await page.goto("/?nocache=1");
  const chooser = page.waitForEvent("filechooser");
  await openHostStep(page);
  await page.getByTestId("open-file-button").click();
  await (
    await chooser
  ).setFiles({
    name: "notes.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("this is not a zip"),
  });
  await expect(page.getByTestId("error")).toContainText("not a readable tour", {
    timeout: 15000,
  });
  await expect(page.getByTestId("open-file-button")).toHaveText(
    "Open it from this device",
  );
  await expect(page.getByTestId("open-file-button")).toBeEnabled();
});

test("a host that blocks browsers gets the download advice, and its button opens the file", async ({
  page,
  request,
}) => {
  const file = await tourFile(request);
  await page.goto(`/?nocache=1&qr=${encodeURIComponent(NO_CORS_URL)}`);
  await expect(page.getByTestId("error")).toContainText("Download the file", {
    timeout: 15000,
  });
  const advice = page.getByTestId("open-file-advice");
  await expect(advice).toBeVisible();

  const chooser = page.waitForEvent("filechooser");
  await advice.click();
  await (await chooser).setFiles(file);
  // The visitor's tour opened from the file: named, and the advice and the
  // error are gone.
  await expect(page.getByTestId("file-status")).toContainText("tour (1).zip", {
    timeout: 15000,
  });
  await expect(page.getByTestId("error")).toHaveText("");
  await expect(advice).toBeHidden();
});

test("an offline phone is told it is offline, not to download the file", async ({
  page,
  context,
}) => {
  await page.goto("/?nocache=1");
  await context.setOffline(true);
  await page.getByTestId("link-input").fill(RANGES_URL);
  await page.getByTestId("open-button").click();
  // Step 2's status line says it (since r821 it speaks alone: the error
  // box's "connect to the internet" contradicted its "you can print the
  // code now" - PRs #584/#585 reviews).
  await expect(page.getByTestId("link-status")).toContainText("offline", {
    timeout: 15000,
  });
  await expect(page.getByTestId("error")).toHaveText("");
  await expect(page.getByTestId("open-file-advice")).toBeHidden();
  await context.setOffline(false);
});
