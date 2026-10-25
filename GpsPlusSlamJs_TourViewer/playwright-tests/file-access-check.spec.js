// @ts-check
import { expect, test } from "@playwright/test";

/**
 * Why this test matters: the file-access check page is opened once, on a
 * phone, from a branch preview, by someone who cannot debug it there. It is
 * a build entry linked from nothing, so no other test opens it: this one
 * proves it loads its module, wires its buttons and logs without a console
 * error, keeps its log across a reload, and fits a phone's width. What the
 * page measures (the save dialog, kept handles, an interrupted rewrite)
 * needs that phone and is not tested here.
 */
test("the file-access check page loads without console errors and logs its steps", async ({
  page,
}) => {
  const errors = /** @type {string[]} */ ([]);
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/file-access-check.html");
  await expect(page.locator("#log")).toContainText("Page opened.");
  await expect(page.locator("#env")).toContainText("Save dialog: ");
  for (const id of [
    "step-save",
    "step-reload",
    "step-access",
    "step-rewrite",
    "step-read",
    "step-open",
  ]) {
    await expect(page.locator(`#${id}`)).toBeEnabled();
  }
  // A step with nothing kept yet says so, rather than failing silently.
  await page.locator("#step-read").click();
  await expect(page.locator("#log")).toContainText(
    "No file is kept yet: run step 1 first.",
  );
  // The log survives the reload step 2 asks for.
  await page.reload();
  await expect(page.locator("#log")).toContainText("No file is kept yet");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
