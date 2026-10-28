// @ts-check
import { test, expect } from "./e2e-test.js";

/**
 * Why these tests matter: /legal/ is the one legal notice and privacy page
 * for every app on the site, and every app links it. It must load on its own
 * (no script, no external file), show both sections with the operator
 * placeholder still visibly marked rather than guessed, and keep the claims
 * that were held to the code: the Tour Viewer's storage claims (no offline
 * copy of the app, the clear control by its real name, the trust records as
 * a visit history), the Recorder's error reports, the 3-day log retention,
 * and the right to object. It must read on a phone without sideways
 * scrolling, and it must not print a console error.
 */

test("the legal page loads with both sections, the operator placeholder and the claims held to the code", async ({
  page,
}) => {
  /** @type {string[]} */
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/legal/index.html#privacy");
  await expect(page.locator("#notice h2")).toHaveText("Legal notice");
  await expect(page.locator("#privacy h2")).toHaveText("Privacy");
  await expect(page.getByTestId("operator-placeholder")).toBeVisible();
  await expect(page.getByTestId("operator-placeholder")).toContainText(
    "to be added before this page goes live",
  );
  const notice = page.locator("#notice");
  await expect(notice).toContainText("support@cs-util.com");
  await expect(notice).toContainText("Tours are made by their creators.");

  const privacy = page.locator("#privacy");
  await expect(privacy).toContainText("the apps set no cookies");
  await expect(privacy).toContainText("The log is deleted after 3 days.");
  await expect(privacy).toContainText("keeps no offline copy of itself");
  await expect(privacy).toContainText('under "Other settings"');
  await expect(privacy).toContainText("a history of the tours opened");
  await expect(page.getByTestId("error-reports")).toContainText(
    "Sentry's US data region",
  );
  await expect(page.getByTestId("error-reports")).toContainText(
    "one page load in ten",
  );
  await expect(privacy.locator("b", { hasText: "object" })).toBeVisible();
  await expect(page.getByTestId("last-updated")).toHaveText(
    /Last updated: \d{4}-\d{2}-\d{2}\./,
  );

  // Nothing scrolls sideways on a phone.
  await page.setViewportSize({ width: 360, height: 640 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("the landing page links the legal page", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('a[href="/legal/"]')).toHaveText(
    "Legal notice and privacy",
  );
});
