import { test, expect } from "./e2e-test.js";
import { installQrDemoFakes, feedFrames } from "./fakes.js";

/**
 * The `?qrperf` instrument with the device seam faked.
 *
 * Why these tests matter: the instrument exists to be read off a phone
 * screenshot, so the report must actually render (that it stays invisible for
 * everyone who did not ask for it is held in qr-demo.spec.js, on the plain boot);
 * and in `zxing` mode the ~400 KB WASM must come from THIS site - the library's
 * default is the jsDelivr CDN, which would add a third-party runtime dependency
 * the project ruled out.
 * The dev server has no `/qr-demo/` base, so "same origin" is what can be
 * proven here; the base prefix is Vite's own `?url` handling.
 */

/** Boot with a query string (the shared `bootQrDemo` always opens "/"). */
async function bootWith(page, search) {
  await page.goto(`/${search}`);
  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("hud")).toBeVisible();
}

test.describe("QR-tracking demo - ?qrperf instrument", () => {
  test.beforeEach(async ({ page }) => {
    await installQrDemoFakes(page);
  });

  // Why the interval matters: the field test measures a faster detection rate
  // by URL; the value must reach the frame source, and the report must say
  // which interval it measured and show the pose section the before/after
  // comparison reads.
  test("renders the native report at the URL's interval, times each detect, and copies", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await bootWith(page, "?qrperf=1&interval=60");
    const intervalMs = await page.evaluate(
      () => window.__qrDemoTest.frameSourceOptions?.intervalMs,
    );
    expect(intervalMs).toBe(60);
    await feedFrames(page, 3);
    const log = page.getByTestId("qrperf-log");
    await expect(log).toBeVisible();
    await expect(log).toContainText("QRPERF native | post-fix");
    // The stage line proves wrapDetect ran; the rates line always says "detect".
    await expect(log).toContainText(/detect\s+med [0-9.]+/);
    await expect(log).toContainText("interval 60 ms");
    await expect(log).toContainText(/pose(:| jumps)/);

    const copy = page.getByTestId("qrperf-copy");
    await copy.click();
    await expect(copy).toHaveText("Copied");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(JSON.parse(copied)).toMatchObject({ mode: "native" });
  });

  test("zxing mode loads the self-hosted WASM and never the CDN", async ({
    page,
  }) => {
    const cdnRequests = [];
    await page.route(/jsdelivr/, (route) => {
      cdnRequests.push(route.request().url());
      return route.abort();
    });
    const wasmResponse = page.waitForResponse((r) =>
      /zxing_reader[^/]*\.wasm/.test(r.url()),
    );
    await bootWith(page, "?qrperf=zxing");
    const response = await wasmResponse;
    expect(response.ok()).toBe(true);
    expect(new URL(response.url()).origin).toBe(new URL(page.url()).origin);
    await expect(page.getByTestId("qrperf-log")).toContainText("zxing load");
    expect(cdnRequests).toEqual([]);
  });
});
