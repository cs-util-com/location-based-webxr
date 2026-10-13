// @ts-check
import { expect, test } from "@playwright/test";

import { installTourViewerArFakes } from "./ar-fakes.js";

/**
 * Why these tests matter: the visitor's start page is the owner's chosen
 * prototype V4 (polish round M4a, D-R12, D-R14) - the tour's name large,
 * one line under it, one round button in the thumb zone. Unit tests see
 * the words, not the page: whether the button is on the first screen,
 * centred and round, whether the name sits above it and nothing scrolls
 * sideways, is only visible in a browser at a phone's size. A prototype
 * that the build drifts from is the failure this guards (lessons learned,
 * 2026-10-12: compare the chosen prototype with the build side by side).
 */

const SAMPLE = "http://127.0.0.1:5197/ranges-ok/sample-tour.zip";
const BAKED = "http://127.0.0.1:5197/ranges-ok/baked-tour.zip";

/** A visitor whose browser will still ask for the location. */
async function openAsNewVisitor(page, url) {
  await installTourViewerArFakes(page);
  await page.addInitScript(() => {
    const t = /** @type {any} */ (window).__tourViewerTest;
    if (t) t.locationPermission = "prompt";
  });
  await page.goto(`/?qr=${encodeURIComponent(url)}`);
}

/** The boxes the layout rules are about, measured without scrolling. */
function layout(page) {
  return page.evaluate(() => {
    const box = (id) => {
      const r = /** @type {HTMLElement} */ (
        document.getElementById(id)
      ).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    return {
      button: box("enter-ar"),
      root: box("ar-root"),
      title: box("visitor-title"),
      height: window.innerHeight,
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
}

const VIEWPORTS = [
  { width: 412, height: 915 },
  { width: 360, height: 640 },
  // A phone held sideways: the name and the action side by side.
  { width: 915, height: 412 },
];

for (const viewport of VIEWPORTS) {
  test(`the start page leads with the tour's name and puts the round button on the first ${viewport.width}x${viewport.height} screen`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openAsNewVisitor(page, SAMPLE);
    await expect(page.getByTestId("visitor-title")).toHaveText(
      "The knight of Marienplatz (sample)",
      { timeout: 15000 },
    );
    await expect(page.getByTestId("visitor-subline")).toHaveText(
      "3 places to discover",
    );
    const button = page.getByTestId("enter-ar");
    await expect(button).toHaveText("Allow location", { timeout: 10000 });
    await expect(button).toHaveAttribute("data-step", "1 of 2");
    await expect(page.getByTestId("ar-hint")).toHaveText(
      /browser will ask for your location/,
    );
    const l = await layout(page);
    // On the first screen, without scrolling.
    expect(l.button.top).toBeGreaterThanOrEqual(0);
    expect(l.button.bottom).toBeLessThanOrEqual(l.height);
    // Round: as wide as it is tall.
    expect(
      Math.abs(
        l.button.right - l.button.left - (l.button.bottom - l.button.top),
      ),
    ).toBeLessThan(1);
    // Centred in its column.
    const centre = (b) => (b.left + b.right) / 2;
    expect(Math.abs(centre(l.button) - centre(l.root))).toBeLessThan(1);
    // The name before the action: above it, or (sideways) left of it.
    expect(
      l.title.bottom <= l.button.top || l.title.right <= l.button.left,
    ).toBe(true);
    // Nothing scrolls sideways.
    expect(l.scrollWidth).toBeLessThanOrEqual(l.width);
    // The creator's page chrome is not the visitor's.
    await expect(page.locator("body > header")).toBeHidden();
  });
}

test("a phone without AR copies the tour's link for one that has it", async ({
  browser,
}) => {
  // No fakes: headless Chromium has no WebXR, i.e. the unsupported phone.
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  await page.goto(`/?qr=${encodeURIComponent(SAMPLE)}`);
  const button = page.getByTestId("enter-ar");
  await expect(button).toHaveText("Copy link", { timeout: 10000 });
  await expect(button).toBeEnabled();
  await expect(page.getByTestId("ar-status")).toContainText("Copy the link");
  // "What happens?" describes a session this phone cannot start.
  await expect(page.locator("#visitor-what")).toBeHidden();
  await expect(page.getByTestId("make-your-own")).toBeVisible();
  await button.click();
  await expect(button).toHaveText("Link copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    page.url(),
  );
  await context.close();
});

test("a tour with photos shows one of them above its name", async ({
  page,
}) => {
  await openAsNewVisitor(page, BAKED);
  const cover = page.getByTestId("visitor-cover");
  await expect(cover).toBeVisible({ timeout: 15000 });
  // The photo really loaded from the zip, not a broken image.
  await expect
    .poll(() =>
      cover
        .locator("img")
        .evaluate((img) => /** @type {HTMLImageElement} */ (img).naturalWidth),
    )
    .toBeGreaterThan(0);
  // No name in this tour: it still reads as a tour - and it is the
  // page's heading (the header's is hidden for a visitor, M4 review #11).
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "An AR tour",
  );
});

test("a tour with a photo still puts the button on a small phone's first screen", async ({
  page,
}) => {
  // Why (M4 review #8): the photo adds about a quarter of the screen above
  // the name; the layout tests above use the sample, which has none.
  await page.setViewportSize({ width: 360, height: 640 });
  await openAsNewVisitor(page, BAKED);
  await expect(page.getByTestId("visitor-cover")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByTestId("enter-ar")).toHaveText("Allow location", {
    timeout: 10000,
  });
  const l = await layout(page);
  expect(l.button.top).toBeGreaterThanOrEqual(0);
  expect(l.button.bottom).toBeLessThanOrEqual(l.height);
  expect(l.title.bottom).toBeLessThanOrEqual(l.button.top);
});
