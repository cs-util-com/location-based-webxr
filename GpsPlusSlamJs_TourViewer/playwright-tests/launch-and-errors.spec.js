// @ts-check
import { expect, test } from "@playwright/test";

/**
 * Why these tests matter: the `?qr=` boot path is the printed-QR entry — the
 * one flow a passerby actually uses, with no chance to retry a broken link —
 * and the error paths are what they see when a link HAS broken. The async-UI
 * rule (in-progress state while opening, a final state either way) is
 * asserted here for both outcomes.
 */

const ARCHIVE_HOST = "http://127.0.0.1:5197";
const RANGES_URL = `${ARCHIVE_HOST}/ranges-ok/tour.zip`;

test("a ?qr= launch opens the archive with no interaction", async ({
  page,
}) => {
  await page.goto(`/?nocache=1&qr=${encodeURIComponent(RANGES_URL)}`);
  await expect(page.getByTestId("gallery").locator("img")).toHaveCount(8, {
    timeout: 15000,
  });
  // The resolved URL lands in the input so the visitor can see/share it.
  await expect(page.getByTestId("link-input")).toHaveValue(RANGES_URL);
});

test("opening shows the in-progress state, then restores it (success path)", async ({
  page,
}) => {
  // Delay every archive response so the transitional state is observable.
  await page.route(`${ARCHIVE_HOST}/**`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });
  await page.goto("/?nocache=1");
  await page.getByTestId("link-input").fill(RANGES_URL);
  await page.getByTestId("open-button").click();

  await expect(page.getByTestId("open-button")).toHaveText("Opening…");
  await expect(page.getByTestId("open-button")).toBeDisabled();
  await expect(page.getByTestId("open-button")).toHaveText("Open", {
    timeout: 20000,
  });
  await expect(page.getByTestId("open-button")).toBeEnabled();
});

test("a missing archive reports a clear error and restores the button (failure path)", async ({
  page,
}) => {
  await page.goto("/?nocache=1");
  await page.getByTestId("link-input").fill(`${ARCHIVE_HOST}/nope/gone.zip`);
  await page.getByTestId("open-button").click();

  await expect(page.getByTestId("error")).toContainText("does not exist", {
    timeout: 15000,
  });
  await expect(page.getByTestId("open-button")).toHaveText("Open");
  await expect(page.getByTestId("open-button")).toBeEnabled();
});

test("the page boots without console errors", async ({ page }) => {
  /** @type {string[]} */
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Tour Viewer" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
