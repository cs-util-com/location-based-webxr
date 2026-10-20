// @ts-check
import { expect, test } from "@playwright/test";

/**
 * The desktop editor's small fixes and its way in (tour editor plan
 * 2026-10-17-1816, W1; plan 2026-10-15-0348 M0 and M5).
 */

test("Save with nothing changed says so in a toast, and saves nothing", async ({
  page,
}) => {
  // Why (plan 2026-10-15-0348 §2.1, M0): the owner pressed Save on the
  // sample and "nothing happened" - the status line already read "No
  // changes", and Save only swapped it for "Nothing to save" in the same
  // spot. A click needs an answer the creator sees (root CLAUDE.md, async
  // feedback).
  await page.goto("/edit.html");
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  await page.locator("#sample-btn").click();
  await expect(page.locator("#topbar")).toBeVisible();
  let downloads = 0;
  page.on("download", () => {
    downloads += 1;
  });
  await page.locator("#save-btn").click();
  await expect(
    page.locator(".toast", { hasText: "Nothing to save" }),
  ).toBeVisible();
  await expect(page.locator("#save-status")).toHaveText("Nothing to save");
  expect(downloads).toBe(0);
});

/**
 * Why these tests matter (W1 step 5): a creator whose tour is hosted had
 * to download the zip before the editor could open it. The link is
 * fetched through the viewer's own transport and opened as a chosen file
 * is; the dialog is busy while it runs and says why a link did not open.
 */
test.describe("open a tour from its link", () => {
  test("opens the tour behind the link, busy until it has", async ({
    page,
  }) => {
    await page.goto("/edit.html");
    await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
    /** @type {(() => void) | undefined} */
    let release;
    const held = new Promise((resolve) => {
      release = () => {
        resolve(undefined);
      };
    });
    await page.route("**/ranges-ok/sample-tour.zip", async (route) => {
      await held;
      await route.continue();
    });
    await page
      .locator("#link-input")
      .fill("http://127.0.0.1:5197/ranges-ok/sample-tour.zip");
    const open = page.locator("#link-btn");
    await open.click();
    // In progress: the controls are off and the dialog says what runs.
    await expect(open).toBeDisabled();
    await expect(page.locator("#open-status")).toHaveText(
      "Fetching the tour from its link…",
    );
    release?.();
    await expect(page.locator("#topbar")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#tour-file")).toHaveText("sample-tour.zip");
    await expect(page.locator("#open-modal")).toBeHidden();
    await expect(open).toBeEnabled();
  });

  test("says why a link did not open, and gives the controls back", async ({
    page,
  }) => {
    await page.goto("/edit.html");
    await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
    await page
      .locator("#link-input")
      .fill("http://127.0.0.1:5197/no-cors/tour.zip");
    await page.locator("#link-btn").click();
    await expect(page.locator("#open-error")).toContainText(
      "Download the file to this computer, then choose it above.",
      { timeout: 15000 },
    );
    await expect(page.locator("#link-btn")).toBeEnabled();
    await expect(page.locator("#open-status")).toHaveText("");
  });

  test("refuses text that is not a link, without a request", async ({
    page,
  }) => {
    await page.goto("/edit.html");
    await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
    await page.locator("#link-input").fill("castle.zip");
    await page.locator("#link-btn").click();
    await expect(page.locator("#open-error")).toContainText(
      "That is not a web link",
    );
  });
});
