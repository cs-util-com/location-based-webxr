// @ts-check
import { expect, test } from "@playwright/test";

/**
 * Why these tests matter: they are the ONLY place the browser-only halves of
 * the transport are proven — real cross-origin Range requests with their
 * CORS preflight, the Cache API store, and the fallback against a host that
 * ignores Range. The unit suites prove the policy against fakes; a green run
 * here proves the same code against a real Chromium network stack.
 *
 * All traffic accounting is PER PAGE (request/response listeners), never a
 * shared server counter — the suite runs fully parallel and a global tally
 * would count sibling tests' requests (which is exactly how the first
 * version of the cache spec failed).
 */

const ARCHIVE_HOST = "http://127.0.0.1:5197";
const RANGES_URL = `${ARCHIVE_HOST}/ranges-ok/tour.zip`;
const NO_RANGES_URL = `${ARCHIVE_HOST}/no-ranges/tour.zip`;

/** Tally this page's archive traffic: GET count and response bytes. */
function trackArchiveTraffic(page, url) {
  const tally = { gets: 0, bytes: 0 };
  page.on("request", (request) => {
    if (request.url() === url && request.method() === "GET") tally.gets += 1;
  });
  page.on("response", (response) => {
    if (
      response.url() === url &&
      response.request().method() === "GET" &&
      (response.status() === 200 || response.status() === 206)
    ) {
      tally.bytes += Number(response.headers()["content-length"] ?? "0");
    }
  });
  return tally;
}

async function openArchive(page, url) {
  await page.getByTestId("link-input").fill(url);
  await page.getByTestId("open-button").click();
}

async function expectGalleryStreamedIn(page) {
  const images = page.getByTestId("gallery").locator("img");
  await expect(images).toHaveCount(8, { timeout: 15000 });
  await expect(page.getByTestId("stats")).toBeVisible();
}

/** Cache API state is per browser context, but start each test clean anyway. */
test.beforeEach(async ({ page }) => {
  await page.goto("/?nocache=1");
  await page.evaluate(async () => {
    for (const key of await caches.keys()) await caches.delete(key);
  });
});

test("streams the gallery from range requests without downloading the whole archive", async ({
  page,
  request,
}) => {
  const res = await request.get(RANGES_URL);
  const totalSize = Buffer.byteLength(await res.body());

  await page.goto("/?nocache=1");
  const tally = trackArchiveTraffic(page, RANGES_URL);
  await openArchive(page, RANGES_URL);
  await expectGalleryStreamedIn(page);

  expect(tally.gets).toBeGreaterThan(3); // real range traffic
  // The point of the whole feature: a fraction of the archive, not the file.
  expect(tally.bytes).toBeGreaterThan(0);
  expect(tally.bytes).toBeLessThan(totalSize / 2);
});

test("falls back to a full download when the host ignores Range, and still renders", async ({
  page,
}) => {
  await page.goto("/?nocache=1");
  await openArchive(page, NO_RANGES_URL);
  await expectGalleryStreamedIn(page);
});

test("second visit serves from the cache: no archive GETs, only revalidation", async ({
  page,
}) => {
  await page.goto("/");
  await openArchive(page, RANGES_URL);
  await expectGalleryStreamedIn(page);
  // Wait until the background warm download has persisted the copy.
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          for (const key of await caches.keys()) {
            const cache = await caches.open(key);
            if ((await cache.keys()).length > 0) return true;
          }
          return false;
        }),
      { timeout: 15000 },
    )
    .toBe(true);

  await page.goto("/");
  const tally = trackArchiveTraffic(page, RANGES_URL);
  await openArchive(page, RANGES_URL);
  await expectGalleryStreamedIn(page);
  await expect(page.getByTestId("stats")).toContainText("serving from cache");
  // Zero GETs on THIS page: the only allowed traffic is the revalidation HEAD.
  expect(tally.gets).toBe(0);
});

test("clear cache empties the store and the next open goes to the network again", async ({
  page,
}) => {
  await page.goto("/");
  await openArchive(page, RANGES_URL);
  await expectGalleryStreamedIn(page);

  await page.getByTestId("clear-cache").click();
  await expect(page.getByTestId("clear-cache")).toHaveText("Cache cleared");

  await page.goto("/");
  const tally = trackArchiveTraffic(page, RANGES_URL);
  await openArchive(page, RANGES_URL);
  await expectGalleryStreamedIn(page);
  expect(tally.gets).toBeGreaterThan(0);
});
