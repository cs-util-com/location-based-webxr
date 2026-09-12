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
    // And the UA is told, so form controls and scrollbars follow - the
    // scrollbar only because the PAGE branches its own unlayered `:root`
    // declaration; a body-level `color-scheme` reaches controls but never
    // the viewport (PR #463 review).
    await expect
      .poll(() => body.evaluate((el) => getComputedStyle(el).colorScheme))
      .toContain("light");
    // The paint itself. `.step` fills from `--surface-gradient`, which is
    // COMPOSED on :root from --surface-hi/--surface-lo - the one token that
    // cannot follow an override placed on a descendant. `.step` and not
    // `.plate`: the page's only plate is the AR stats HUD, which is
    // `display: none` here, so asserting on it would prove the paint on a
    // surface no viewer ever sees (PR #463 review).
    await expect
      .poll(() =>
        page
          .locator(".step")
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundImage),
      )
      .toContain("rgba(255, 255, 255, 0.78)");
    // And the ACCENT as ink, asserted ON THE LINK rather than as a token.
    // The bright accent measures 2.0:1 on this ground - a WCAG 1.4.3 AA
    // failure on the page's only link, which the first light block
    // shipped (PR #463 review).
    //
    // Reading `--accent-ink` back off the body was the first attempt and
    // guarded NOTHING: the light block declares that token, so the
    // assertion could only confirm the block matched. The defect was
    // never the token's value - it was which token the link referenced,
    // and pointing it back at `--accent` left every test here green with
    // the 2.0:1 link restored (PR #466 review). This is the assertion
    // that fails for that revert.
    await expect
      .poll(() =>
        page
          .locator("#visitor-link")
          .evaluate((el) => getComputedStyle(el).color.trim()),
      )
      .toBe("rgb(138, 75, 0)");
  });

  // Why this test matters: the pair above only ever looks at the RESTING
  // page, and this app has a second ground. The light block is gated on
  // `:root:has(.page)`, which is per-DOCUMENT, not per-ground - and the
  // Tour Viewer is the one app that is both light-eligible and an AR host,
  // with `#ar-status` inside `#ar-root`, the subtree WebXR DOM Overlay
  // composites over the CAMERA feed. So the light palette reaches the
  // camera, which this block's own comment used to deny (PR #468 review).
  //
  // Nothing here decides whether it SHOULD reach it. Each pairing
  // contrasts with its own halo (about 17:1 light, 21:1 dark), so both are
  // legible over arbitrary video and only a device can settle the look.
  // This pins what the overlay resolves TODAY, so that changing it is a
  // visible decision rather than a discovery in the field.
  test("the AR overlay follows the light ground while a session runs", async ({
    page,
  }) => {
    await page.goto("/?nocache=1");
    // The attribute production itself sets when a session starts, so this
    // drives the real state rather than a test-only class (ar-entry.ts).
    await page.locator("body.page").evaluate((el) => {
      el.dataset["arActive"] = "true";
    });
    const status = page.locator("#ar-status");
    await expect(status).toHaveCount(1);
    // Near-black ink over the camera feed, behind a WHITE halo.
    await expect
      .poll(() => status.evaluate((el) => getComputedStyle(el).color.trim()))
      .toBe("rgb(27, 27, 32)");
    await expect
      .poll(() => status.evaluate((el) => getComputedStyle(el).textShadow))
      .toContain("rgba(255, 255, 255, 0.95)");
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
          .locator(".step")
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundImage),
      )
      .toContain("rgba(52, 58, 80, 0.35)");
    // The accent as ink on the dark ground, for the same reason the light
    // half asserts it: without this, a light `--accent-ink` escaping its
    // gate would dim the link to 3.2:1 here and nothing would notice.
    await expect
      .poll(() =>
        page
          .locator("#visitor-link")
          .evaluate((el) => getComputedStyle(el).color.trim()),
      )
      .toBe("rgb(242, 151, 31)");
  });

  // The dark half of the over-camera pin above. This is the one that
  // fails if a light block ever escapes its gate INTO an AR session -
  // the resting-page assertions cannot see that state at all.
  test("the AR overlay keeps the dark treatment while a session runs", async ({
    page,
  }) => {
    await page.goto("/?nocache=1");
    await page.locator("body.page").evaluate((el) => {
      el.dataset["arActive"] = "true";
    });
    const status = page.locator("#ar-status");
    await expect(status).toHaveCount(1);
    // White ink behind a BLACK halo - the treatment the halo tokens were
    // designed for, and the one an over-camera HUD has always used here.
    await expect
      .poll(() => status.evaluate((el) => getComputedStyle(el).color.trim()))
      .toBe("rgb(255, 255, 255)");
    await expect
      .poll(() => status.evaluate((el) => getComputedStyle(el).textShadow))
      .toContain("rgba(0, 0, 0, 0.95)");
  });
});
