// @ts-check
import { expect, test } from "@playwright/test";

import { installTourViewerArFakes } from "./ar-fakes.js";

/**
 * Why these tests matter (tour editor plan 2026-10-17-1816, W6, D13, D24):
 * the legal notice and the privacy page exist for people to find them, so
 * the page itself is not enough - each place the plan names must link to
 * it: the visitor's "What happens?", the setup page's footer and the
 * editor. The page is a draft for the owner's review: it must say so, and
 * the operator's placeholders must stay visible rather than be guessed.
 * The visitor's corrected claim and the safety line before the start
 * button are pinned here too, beside the link they sit with.
 */

const SAMPLE = "http://127.0.0.1:5197/ranges-ok/sample-tour.zip";

test("the legal page says it is a draft and carries both sections with their placeholders", async ({
  page,
}) => {
  await page.goto("/legal.html");
  await expect(page.getByTestId("legal-draft")).toContainText("Draft");
  await expect(page.locator("#notice h2")).toHaveText(
    "Legal notice (Impressum)",
  );
  await expect(page.locator("#privacy h2")).toHaveText("Privacy");
  await expect(page.locator("#notice")).toContainText(
    "[Full name or company name, legal form]",
  );
  await expect(page.locator("#privacy")).toContainText("[N] days");
  // Claims held to the code (the M4b milestone review #5): no offline copy
  // of the app, the clear control by its real name, the trust records said
  // to be a visit history, and only the cookies the APP sets.
  const privacy = page.locator("#privacy");
  await expect(privacy).toContainText("sets no cookies");
  await expect(privacy).toContainText("keeps no offline copy of itself");
  await expect(privacy).toContainText('under "Other settings"');
  await expect(privacy).toContainText("a history of the tours opened");
  await expect(privacy).not.toContainText("work without a connection");
  // Nothing scrolls sideways on a phone.
  await page.setViewportSize({ width: 360, height: 640 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("the visitor's What happens? links the privacy page, says what stays on the phone, and the safety line stands before the start button", async ({
  page,
}) => {
  await installTourViewerArFakes(page);
  await page.goto(`/?qr=${encodeURIComponent(SAMPLE)}`);
  await expect(page.getByTestId("visitor-title")).toHaveText(
    "The knight of Marienplatz (sample)",
    { timeout: 15000 },
  );
  const safety = page.getByTestId("visitor-safety");
  await expect(safety).toHaveText(
    "Watch where you walk. Look up from your phone when you move, and stay off roads.",
  );
  const [line, button] = await Promise.all([
    safety.boundingBox(),
    page.getByTestId("enter-ar").boundingBox(),
  ]);
  expect(line).not.toBeNull();
  expect(button).not.toBeNull();
  expect((line?.y ?? 0) + (line?.height ?? 0)).toBeLessThanOrEqual(
    button?.y ?? 0,
  );
  await page.locator("#visitor-what summary").click();
  const what = page.locator("#visitor-what");
  // The tour's own download is a request the servers see, so "sends
  // nothing anywhere" overclaimed (the M4b milestone review #4).
  await expect(what).toContainText(
    "The app sends none of your data: no camera image, no location. No sign-up, no account.",
  );
  await expect(what).not.toContainText("sends nothing anywhere");
  await expect(what).not.toContainText("Nothing is uploaded");
  await expect(page.getByTestId("visitor-privacy")).toHaveAttribute(
    "href",
    "legal.html#privacy",
  );
  await expect(page.getByTestId("visitor-privacy")).toBeVisible();
});

test("the setup page's footer links the legal notice and the privacy page, and its claim about offline use is exact", async ({
  page,
}) => {
  await page.goto("/");
  const foot = page.getByTestId("setup-foot");
  await expect(foot.locator('a[href="legal.html#notice"]')).toHaveText(
    "Legal notice",
  );
  await expect(foot.locator('a[href="legal.html#privacy"]')).toHaveText(
    "Privacy",
  );
  // No service worker: the page itself needs a connection, so only an
  // open tour keeps working without one (the M4b fix re-review #3, as the
  // privacy page says). Hidden steps and settings are read as text.
  await expect(page.getByTestId("landing-make")).toContainText(
    "Keeps working without signal once a tour has loaded",
  );
  for (const said of [
    page.getByTestId("landing"),
    page.getByTestId("step-host"),
    page.getByTestId("storage-panel"),
  ]) {
    await expect(said).not.toContainText(/offline/i);
  }
  await expect(page.getByTestId("step-host")).toContainText(
    "once it has loaded, it keeps working without signal",
  );
  await expect(page.getByTestId("storage-panel")).toContainText(
    "so a revisit opens faster",
  );
  await foot.locator('a[href="legal.html#notice"]').click();
  await expect(page).toHaveURL(/legal\.html#notice$/);
  await expect(page.getByTestId("legal-draft")).toBeVisible();
});

test("the editor's fine print names the map's source and links the privacy page", async ({
  page,
}) => {
  await page.goto("/edit.html");
  const print = page.locator("#open-modal .fineprint");
  await expect(print).toContainText(
    "The tour file stays on this computer. The map comes from OpenStreetMap.",
  );
  await expect(print).not.toContainText("nothing is uploaded");
  await expect(print.locator('a[href="legal.html#privacy"]')).toBeVisible();
});
