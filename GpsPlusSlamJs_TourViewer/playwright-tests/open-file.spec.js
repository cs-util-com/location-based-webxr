// @ts-check
import { expect, test } from "@playwright/test";

/**
 * Why these tests matter (tour kit plan K0, K-D1): a link only works when
 * its host lets browsers read the file. "Open a file" is the way around a
 * host that does not: the tour is downloaded, then opened from the device.
 * These specs drive the REAL file chooser (Playwright's `filechooser`
 * event) and check the async-UI states on success and on failure.
 */

const ARCHIVE_HOST = "http://127.0.0.1:5197";
const RANGES_URL = `${ARCHIVE_HOST}/ranges-ok/tour.zip`;

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

test("opens a tour zip from the device through the file chooser", async ({
  page,
  request,
}) => {
  const file = await tourFile(request);
  await page.goto("/?nocache=1");
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("open-file-button").click();
  await (await chooser).setFiles(file);

  await expect(page.getByTestId("gallery").locator("img")).toHaveCount(8, {
    timeout: 15000,
  });
  await expect(page.getByTestId("file-status")).toContainText("tour (1).zip");
  // A file has no link: the print step asks for one instead of showing a
  // made-up address.
  await expect(page.getByTestId("print-url-shown")).toBeHidden();
  await expect(page.getByTestId("open-file-button")).toHaveText("Open a file");
  await expect(page.getByTestId("open-file-button")).toBeEnabled();
});

test("a file that is not a zip reports a plain error and restores the button", async ({
  page,
}) => {
  await page.goto("/?nocache=1");
  const chooser = page.waitForEvent("filechooser");
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
  await expect(page.getByTestId("open-file-button")).toHaveText("Open a file");
  await expect(page.getByTestId("open-file-button")).toBeEnabled();
});
