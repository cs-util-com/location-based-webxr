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

test("an overwritten archive (changed ETag) is evicted and refetched, not served stale", async ({
  page,
  request,
}) => {
  // Why this matters: the authoring loop overwrites the zip at a STABLE URL
  // (print the QR first, then update the content) — a cache that never
  // revalidates would serve the stale copy forever on every device that
  // visited once. This drives a real ETag change through the browser path.
  const FLIPPABLE_URL = `${ARCHIVE_HOST}/flippable/tour.zip`;
  await request.get(`${ARCHIVE_HOST}/flip?etag=v1`);
  try {
    await page.goto("/");
    await openArchive(page, FLIPPABLE_URL);
    await expectGalleryStreamedIn(page);
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

    // The "author" overwrites the archive: same URL, new ETag.
    await request.get(`${ARCHIVE_HOST}/flip?etag=v2`);

    await page.goto("/");
    const tally = trackArchiveTraffic(page, FLIPPABLE_URL);
    const heads = [];
    page.on("response", (response) => {
      if (
        response.url() === FLIPPABLE_URL &&
        response.request().method() === "HEAD"
      ) {
        heads.push(response.headers()["etag"] ?? "(none)");
      }
    });
    await openArchive(page, FLIPPABLE_URL);
    await expectGalleryStreamedIn(page);
    const cachedEtag = await page.evaluate(async (url) => {
      for (const key of await caches.keys()) {
        const cache = await caches.open(key);
        const res = await cache.match(url);
        if (res) return res.headers.get("etag") ?? "(none)";
      }
      return "(no entry)";
    }, FLIPPABLE_URL);
    // Revalidation saw the new ETag, evicted, and refetched from the network.
    expect(
      tally.gets,
      `heads seen: ${JSON.stringify(heads)}; cached etag now: ${cachedEtag}`,
    ).toBeGreaterThan(0);
  } finally {
    await request.get(`${ARCHIVE_HOST}/flip?etag=v1`);
  }
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

test("clear cache during an in-flight warm download settles only once the store is durably empty", async ({
  page,
  request,
}) => {
  // Why this matters (PR #358 review): the warm download persists on
  // completion, so a clear that ignored it reported "Cache cleared" and then
  // watched the background write silently repopulate the store — the next
  // visit served from cache after the user was told there was none. The
  // server's warm gate holds the warm GET open, giving a deterministic
  // in-flight window instead of racing a real download.
  const SLOW_WARM_URL = `${ARCHIVE_HOST}/slow-warm/tour.zip`;
  await request.get(`${ARCHIVE_HOST}/warm-gate?state=hold`);
  try {
    await page.goto("/");
    await openArchive(page, SLOW_WARM_URL);
    await expectGalleryStreamedIn(page); // ranges flow; the warm GET is held

    // Arm the completion watcher BEFORE releasing the gate so the ordering
    // of "Cache cleared" relative to the release is observable.
    await page.getByTestId("clear-cache").click();
    const clearedAt = page
      .waitForFunction(
        () =>
          document.querySelector('[data-testid="clear-cache"]')?.textContent ===
          "Cache cleared",
        undefined,
        { timeout: 15000, polling: 25 },
      )
      .then(() => Date.now());
    // The buggy handler settled within a few event-loop turns; this margin
    // is orders of magnitude above that. (Node-side sleep — the page itself
    // waits on real conditions.)
    await new Promise((resolve) => setTimeout(resolve, 500));
    const releasedAt = Date.now();
    await request.get(`${ARCHIVE_HOST}/warm-gate?state=release`);
    // The clear must have WAITED on the held warm write, not raced past it.
    expect(await clearedAt).toBeGreaterThanOrEqual(releasedAt);

    // Durably empty: the next visit must hit the network again — a
    // repopulated store would serve it with zero GETs.
    await page.goto("/");
    const tally = trackArchiveTraffic(page, SLOW_WARM_URL);
    await openArchive(page, SLOW_WARM_URL);
    await expectGalleryStreamedIn(page);
    expect(tally.gets).toBeGreaterThan(0);
  } finally {
    await request.get(`${ARCHIVE_HOST}/warm-gate?state=release`);
  }
});
