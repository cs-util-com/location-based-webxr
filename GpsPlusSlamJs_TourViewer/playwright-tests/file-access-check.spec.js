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
    "step-rewrite-browser",
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

test("the check page logs what the browser says about itself, and names how the last rewrite was stopped", async ({
  page,
}) => {
  // Why: the log is all that comes back from the phone. It must carry
  // the platform line (the Desktop-site run answers whether the client
  // hints still say Android there), and step 5 must say which way the
  // rewrite it reads was stopped - a closed tab or the whole browser -
  // since the two are run one after the other into the same file.
  await page.addInitScript(() => {
    localStorage.setItem(
      "file-access-check:rewrite",
      JSON.stringify({ way: "browser" }),
    );
  });
  await page.goto("/file-access-check.html");
  await expect(page.locator("#log")).toContainText(
    "Platform from the client hints:",
  );
  await expect(page.locator("#step-rewrite-browser")).toBeEnabled();
  await page.locator("#step-read").click();
  await expect(page.locator("#log")).toContainText(
    "Step 5: in the last rewrite, the whole browser was closed during the write",
  );
});

test("Copy the log says so when this browser cannot copy, and when copying fails", async ({
  page,
}) => {
  // Why: on a phone the person cannot see a console. A Copy button that
  // does nothing leaves them believing the log is on the clipboard; it
  // must say it was not copied and that a screenshot is the way.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      get: () => undefined,
    });
  });
  await page.goto("/file-access-check.html");
  await page.locator("#copy").click();
  await expect(page.locator("#log")).toContainText(
    "This browser cannot copy from this page. Take a screenshot of the log instead.",
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      get: () => ({
        writeText: () =>
          Promise.reject(new DOMException("not allowed", "NotAllowedError")),
      }),
    });
  });
  await page.locator("#copy").click();
  await expect(page.locator("#log")).toContainText(
    "Not copied (NotAllowedError: not allowed). Take a screenshot of the log instead.",
  );
});
