// @ts-check
import { expect, test } from "@playwright/test";

import { installTourViewerArFakes } from "./ar-fakes.js";

/**
 * Why these tests matter: the
 * legal notice and the privacy page exist for people to find them, so each
 * place the plan names must link to them: the visitor's "What happens?",
 * the setup page's footer and the editor. The page itself is now one page
 * for the whole site at /legal/ (built from GpsPlusSlamJs_Landing, where its
 * text is tested); this app's old /tour/legal.html forwards there, keeping
 * the section, so links saved before the move still arrive. The visitor's
 * corrected claim and the safety line before the start button are pinned
 * here too, beside the link they sit with.
 */

const SAMPLE = "http://127.0.0.1:5197/ranges-ok/sample-tour.zip";

test("the old legal page forwards to the site-wide page and keeps the section", async ({
  page,
}) => {
  // The dev server does not serve /legal/ (the site build does), so the
  // address is what is checked, not the text.
  await page.goto("/legal.html#privacy");
  await expect(page).toHaveURL(/\/legal\/#privacy$/);
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
    "/legal/#privacy",
  );
  await expect(page.getByTestId("visitor-privacy")).toBeVisible();
});

test("the setup page's footer links the legal notice and the privacy page, and its claim about offline use is exact", async ({
  page,
}) => {
  await page.goto("/");
  const foot = page.getByTestId("setup-foot");
  await expect(foot.locator('a[href="/legal/#notice"]')).toHaveText(
    "Legal notice",
  );
  await expect(foot.locator('a[href="/legal/#privacy"]')).toHaveText("Privacy");
  // No service worker: the page itself needs a connection, so only an
  // open tour keeps working without one (the M4b fix re-review #3, as the
  // privacy page says). Hidden steps and settings are read as text.
  await expect(page.getByTestId("setup-intro")).toContainText(
    "Keeps working without signal once a tour has loaded",
  );
  for (const said of [
    page.getByTestId("setup-intro"),
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
  await foot.locator('a[href="/legal/#notice"]').click();
  await expect(page).toHaveURL(/\/legal\/#notice$/);
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
  await expect(print.locator('a[href="/legal/#privacy"]')).toBeVisible();
});
