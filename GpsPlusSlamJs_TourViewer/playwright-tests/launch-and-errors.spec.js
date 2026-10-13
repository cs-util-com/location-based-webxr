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
  await expect(page.getByTestId("open-button")).toHaveText("Check link", {
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

  // An own server's link (the link decides its host, M0c review): its
  // missing file is "not there yet", said in step 2's status line alone.
  await expect(page.getByTestId("link-status")).toContainText(
    "no file at this link",
    { timeout: 15000 },
  );
  await expect(page.getByTestId("error")).toHaveText("");
  await expect(page.getByTestId("open-button")).toHaveText("Check link");
  await expect(page.getByTestId("open-button")).toBeEnabled();
});

test("the page boots without console errors", async ({ page }) => {
  /** @type {string[]} */
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  // The creator's page opens on the intro since polish round M2b (the
  // "Tour Viewer" header is the visitor's).
  await expect(
    page.getByRole("heading", { name: /Put stories/ }),
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
/** The visitor's start page. It followed the device's scheme until the
 *  owner chose the paper V4 start page (polish round M4a, D-R12); since
 *  then it wears the paper look on every device, as the creator's setup
 *  page has since polish round M2b (D-P1). Both are pinned in each half;
 *  the AR overlay still follows the device (the over-camera tests). */
const VISITOR_PAGE = `/?nocache=1&qr=${encodeURIComponent(RANGES_URL)}`;

/** The creator page's paper, resolved on the root (polish round M2b). */
async function creatorPaper(page) {
  await page.goto("/?nocache=1");
  return page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--paper")
      .trim()
      .toLowerCase(),
  );
}

test.describe("a light device", () => {
  test.use({ colorScheme: "light" });

  test("the creator's setup page keeps the paper look on a light device", async ({
    page,
  }) => {
    expect(await creatorPaper(page)).toBe("#f4eedf");
  });

  test("the visitor's start page wears the paper look on a light device (M4a, D-R12)", async ({
    page,
  }) => {
    await page.goto(VISITOR_PAGE);
    const body = page.locator("body.page");
    await expect(body).toHaveCount(1);
    // The token, resolved on the root that declares it.
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue("--paper")
            .trim()
            .toLowerCase(),
        ),
      )
      .toBe("#f4eedf");
    // The UA is told, so form controls and scrollbars are light too.
    await expect
      .poll(() =>
        page.evaluate(
          () => getComputedStyle(document.documentElement).colorScheme,
        ),
      )
      .toContain("light");
    // The paint a visitor sees: the page's ground on the body, and the
    // accent as INK on the page's visible link - the bright accent would
    // measure 2.0:1 on paper (PR #463 review), so this is asserted on the
    // link, not read back off a token.
    await expect
      .poll(() => body.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe("rgb(244, 238, 223)");
    await expect
      .poll(() =>
        page
          .getByTestId("make-your-own")
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
    // HELD at "true": the page re-writes the flag on its own status render
    // (ar-entry.ts), and since polish round M2b the flag decides the
    // palette, so a render that flipped it back would test the resting
    // page instead of the session.
    await page.locator("body.page").evaluate((el) => {
      const hold = () => {
        if (el.dataset["arActive"] !== "true") el.dataset["arActive"] = "true";
      };
      hold();
      new MutationObserver(hold).observe(el, {
        attributes: true,
        attributeFilter: ["data-ar-active"],
      });
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

test.describe("a dark device", () => {
  test.use({ colorScheme: "dark" });

  test("the creator's setup page keeps the paper look on a dark device", async ({
    page,
  }) => {
    expect(await creatorPaper(page)).toBe("#f4eedf");
  });

  test("the visitor's start page wears the paper look on a dark device (M4a, D-R12)", async ({
    page,
  }) => {
    await page.goto(VISITOR_PAGE);
    const body = page.locator("body.page");
    await expect(body).toHaveCount(1);
    // The token, resolved on the root that declares it.
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue("--paper")
            .trim()
            .toLowerCase(),
        ),
      )
      .toBe("#f4eedf");
    // The UA is told, so form controls and scrollbars are light too.
    await expect
      .poll(() =>
        page.evaluate(
          () => getComputedStyle(document.documentElement).colorScheme,
        ),
      )
      .toContain("light");
    // The paint a visitor sees: the page's ground on the body, and the
    // accent as INK on the page's visible link - the bright accent would
    // measure 2.0:1 on paper (PR #463 review), so this is asserted on the
    // link, not read back off a token.
    await expect
      .poll(() => body.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe("rgb(244, 238, 223)");
    await expect
      .poll(() =>
        page
          .getByTestId("make-your-own")
          .evaluate((el) => getComputedStyle(el).color.trim()),
      )
      .toBe("rgb(138, 75, 0)");
  });

  // The dark half of the over-camera pin above. This is the one that
  // fails if a light block ever escapes its gate INTO an AR session -
  // the resting-page assertions cannot see that state at all.
  test("the AR overlay keeps the dark treatment while a session runs", async ({
    page,
  }) => {
    await page.goto("/?nocache=1");
    // HELD at "true": the page re-writes the flag on its own status render
    // (ar-entry.ts), and since polish round M2b the flag decides the
    // palette, so a render that flipped it back would test the resting
    // page instead of the session.
    await page.locator("body.page").evaluate((el) => {
      const hold = () => {
        if (el.dataset["arActive"] !== "true") el.dataset["arActive"] = "true";
      };
      hold();
      new MutationObserver(hold).observe(el, {
        attributes: true,
        attributeFilter: ["data-ar-active"],
      });
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

// Milestone review of b4c #5 (QR near-frontal pose plan §66): `?debug=1` is
// the owner's field-session readout; only main.ts unhides it, and a unit
// test of the text alone would pass while the block never became visible.
// The block lives in the collapsible AR step, so its own `hidden` flag is
// what is asserted, not the step's disclosure.
test("?debug=1 unhides the QR readout; without it the block stays hidden", async ({
  page,
}) => {
  await page.goto("/?nocache=1&debug=1");
  await expect(page.getByTestId("ar-debug")).not.toHaveAttribute("hidden");
  await page.goto("/?nocache=1");
  await expect(page.getByTestId("ar-debug")).toHaveAttribute("hidden", "");
  // A bare ?debug is off (the framework's shared reader).
  await page.goto("/?nocache=1&debug");
  await expect(page.getByTestId("ar-debug")).toHaveAttribute("hidden", "");
});
