// @ts-check
import { expect, test } from "@playwright/test";

import {
  enterArAndMeasure,
  installTourViewerArFakes,
  openFixtureTour,
} from "./ar-fakes.js";
import { E2E_QR_ARCHIVE, E2E_QR_TEXT } from "./qr-fixture.mjs";

/**
 * The summary after Finish, end to end (authoring plan 2026-09-28-0953 §1
 * item 5, §3.3, milestone M3b; owner item 5: "a map with each code's
 * position and a clearly visible line for the direction it faces, the
 * placed objects, and the result of the final estimate, so the author can
 * judge whether to go back and scan more").
 *
 * Why these tests matter: the unit tests prove the log, the verdict and
 * what the map is handed; only the composed page shows that a real Finish
 * - after a real AR visit whose store is wiped at its end - still has the
 * visit to judge, that Leaflet actually arrives through the dynamic import
 * and draws the code, its line and the pin, that a map that cannot load
 * says so while the verdict stays, and that a visitor never downloads any
 * of it. Map tiles are answered locally: no test reaches the network.
 */

/** A 1x1 transparent PNG for every map tile request. */
const TILE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/** Answer tiles locally and record every URL the page requests. */
async function watchRequests(page) {
  /** @type {string[]} */
  const urls = [];
  page.on("request", (request) => {
    urls.push(request.url());
  });
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TILE_PNG }),
  );
  return urls;
}

const leafletRequests = (urls) =>
  urls.filter((u) => /leaflet|summary-map/i.test(u));

/** Place a pin at the fake reticle with this label. */
async function placePin(page, label) {
  await page.getByTestId("setup-pin").click();
  await page.getByTestId("pin-label").fill(label);
  await page.getByTestId("pin-save").click();
  await expect(page.getByTestId("setup-status")).toContainText(
    /1 object placed/,
  );
}

async function finish(page) {
  const finishButton = page.getByTestId("setup-finish");
  await finishButton.click();
  await expect(page.getByTestId("finish-block")).toBeVisible({
    timeout: 30000,
  });
}

test.beforeEach(async ({ page }) => {
  await installTourViewerArFakes(page);
});

test("after Finish the page shows each code with its facing line and verdict, and the pin, on a map loaded on demand", async ({
  page,
}) => {
  const urls = await watchRequests(page);
  await openFixtureTour(page);
  await enterArAndMeasure(page);
  await placePin(page, "Summary pin");
  // Nothing of the map before the Finish: it loads on demand.
  expect(leafletRequests(urls)).toEqual([]);

  await finish(page);
  const summary = page.getByTestId("summary");
  await expect(summary).toBeVisible();
  // The code, with a plain verdict and the numbers behind it.
  const row = summary.getByTestId("summary-code");
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("summary-verdict")).toHaveText(
    /^(Good|Walk further from the code|Wait for better GPS|Scan it again in another AR visit)$/,
  );
  await row.getByTestId("summary-numbers").locator("summary").click();
  await expect(row.getByTestId("summary-numbers")).toContainText(
    /1 visit: expected within/,
  );
  await expect(row.getByTestId("summary-numbers")).toContainText(/provisional/);

  // The map arrived and drew the code, its facing line, and the pin.
  await expect(page.getByTestId("summary-map-status")).toHaveAttribute(
    "data-state",
    "ready",
    { timeout: 15000 },
  );
  const map = page.getByTestId("summary-map");
  await expect(map.locator("path.tv-summary-code")).toHaveCount(1);
  await expect(map.locator("path.tv-summary-facing")).toHaveCount(1);
  await expect(map.locator("path.tv-summary-pin")).toHaveCount(1);
  await expect(map.locator(".tv-summary-object-label")).toHaveText(
    "Summary pin",
  );
  await expect(map.locator(".tv-summary-code-label")).toHaveText(/^The code: /);
  // The visit's walk survived the store's wipe at the AR exit: its raw
  // GPS (yellow) and fused (cyan) lines, drawn by the shared overlay (the
  // yellow accuracy circles are fainter: stroke-opacity 0.5).
  await expect(
    map.locator('path[stroke="#ffff00"][stroke-opacity="0.8"]'),
  ).toHaveCount(1);
  await expect(
    map.locator('path[stroke="#00ffff"][stroke-opacity="0.8"]'),
  ).toHaveCount(1);
  expect(leafletRequests(urls).length).toBeGreaterThan(0);

  // Back to authoring is Start AR setup again.
  const before = await page.evaluate(
    () => /** @type {any} */ (window).__tourViewerTest.initARCalls.length,
  );
  await page.getByTestId("summary-start-ar").click();
  await expect
    .poll(() =>
      page.evaluate(
        () => /** @type {any} */ (window).__tourViewerTest.initARCalls.length,
      ),
    )
    .toBe(before + 1);
});

test("a map that cannot load says so, and the verdict stays", async ({
  page,
}) => {
  await watchRequests(page);
  // The map view's module is the dynamic import: refuse it.
  await page.route("**/src/summary-map-view.ts*", (route) => route.abort());
  await openFixtureTour(page);
  await enterArAndMeasure(page);
  await finish(page);
  await expect(page.getByTestId("summary-map-status")).toHaveText(
    /The map could not load/,
    { timeout: 15000 },
  );
  await expect(
    page.getByTestId("summary-code").getByTestId("summary-verdict"),
  ).toBeVisible();
});

test("a visitor's page never loads Leaflet", async ({ page }) => {
  const urls = await watchRequests(page);
  await page.goto(`/?qr=${encodeURIComponent(E2E_QR_ARCHIVE)}`);
  await expect(page.getByTestId("gallery").locator("img")).toHaveCount(8, {
    timeout: 15000,
  });
  const enter = page.getByTestId("enter-ar");
  await expect(enter).toBeEnabled({ timeout: 10000 });
  await enter.click();
  await page.evaluate((text) => {
    /** @type {any} */ (window).__tourViewerTest.armQrDetection(text);
  }, E2E_QR_TEXT);
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        return page.getByTestId("ar-status").textContent();
      },
      { timeout: 20000 },
    )
    .toMatch(/Code recognised/);
  // The whole visit, AR and all, without one request for the map.
  expect(leafletRequests(urls)).toEqual([]);
  // ...while the page's modules did load (the check sees requests at all).
  expect(urls.some((u) => u.includes("/src/main.ts"))).toBe(true);
});
