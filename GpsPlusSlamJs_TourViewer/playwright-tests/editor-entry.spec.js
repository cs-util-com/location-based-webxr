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
