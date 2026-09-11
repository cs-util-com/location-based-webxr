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
  // ...and in the print panel, which a QR-launched open presents like any
  // other (flows plan M3: the boot reaches the prefill through openUrl).
  await expect(page.getByTestId("print-url-shown")).toHaveText(RANGES_URL);
  // ...and it is TEXT, not a field: a creator who already gave the link in
  // step 1 is not asked for it again (second testing session, F7).
  await expect(page.getByTestId("print-url")).toBeHidden();
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
  await expect(page.getByTestId("open-button")).toHaveText("Test link", {
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
  await expect(page.getByTestId("open-button")).toHaveText("Test link");
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

/**
 * Why these tests matter: the setup page is a DOCUMENT, and its ground is a
 * page rather than the camera - which is why it opts into `.page` while the
 * five AR apps do not. Light mode rides that same opt-in (owner decision
 * 2026-09-10), so what has to hold is a pair: a device asking for light gets
 * a light ground, and one asking for dark - the default - is unchanged.
 *
 * A screenshot would show this too, but only to someone looking. These
 * assert it, and they assert the DARK half as well, because a light block
 * written with the wrong scope repaints everything and a test that only ever
 * checks light would call that a success.
 *
 * EACH HALF ASSERTS A RESOLVED PAINT, not only the tokens the sheet sets.
 * The first version checked `--paper` and `color-scheme` alone - both
 * declared directly by the light block - so it could only ever confirm that
 * the block MATCHED. It passed while every plate, button and badge on the
 * page still painted the dark surface, because `--surface-gradient` is
 * composed on `:root` and the block was setting its inputs on a descendant
 * (PR #462 review). A token a rule declares is an input; what a viewer sees
 * is the output, and only the output can catch a composite that fails to
 * follow.
 */
test.describe("the setup page follows the device's colour scheme", () => {
  test.use({ colorScheme: "light" });

  test("a light device gets the light ground", async ({ page }) => {
    await page.goto("/?nocache=1");
    const body = page.locator("body.page");
    await expect(body).toHaveCount(1);
    // The token, resolved on the element that declares it.
    await expect
      .poll(() =>
        body.evaluate((el) =>
          getComputedStyle(el).getPropertyValue("--paper").trim(),
        ),
      )
      .toBe("#f2f1ed");
    // And the UA is told, so form controls and scrollbars follow.
    await expect
      .poll(() => body.evaluate((el) => getComputedStyle(el).colorScheme))
      .toContain("light");
    // The paint itself. `.plate` fills from `--surface-gradient`, which is
    // COMPOSED on :root from --surface-hi/--surface-lo - the one token that
    // cannot follow an override placed on a descendant.
    await expect
      .poll(() =>
        page
          .locator(".plate")
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundImage),
      )
      .toContain("rgba(255, 255, 255, 0.78)");
  });
});

test.describe("a dark device keeps the default ground", () => {
  test.use({ colorScheme: "dark" });

  test("nothing about the dark page moves", async ({ page }) => {
    await page.goto("/?nocache=1");
    const body = page.locator("body.page");
    await expect
      .poll(() =>
        body.evaluate((el) =>
          getComputedStyle(el).getPropertyValue("--paper").trim(),
        ),
      )
      .toBe("#232838");
    // The dark paint, for the same reason as the light one: this is the
    // assertion that fails if a light block ever escapes its gate.
    await expect
      .poll(() =>
        page
          .locator(".plate")
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundImage),
      )
      .toContain("rgba(52, 58, 80, 0.35)");
  });
});
