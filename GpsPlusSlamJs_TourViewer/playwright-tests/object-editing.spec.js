// @ts-check
import { expect, test } from "@playwright/test";

import { installTourViewerArFakes } from "./ar-fakes.js";
import { E2E_QR_TEXT } from "./qr-fixture.mjs";
import { parseTourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js";

/**
 * Editing placed objects, end to end (authoring plan 2026-09-28-0953 §3.4,
 * milestone M4; owner item 6: "create works; move, edit and delete do
 * not"). Why these tests matter: the unit tests prove each piece - the
 * model, the list, the pick, the move's code correction - but only the
 * composed page shows that the list the creator sees, the tap in AR, the
 * draft and the Finish all act on the SAME objects, and that what the
 * creator changed is what the downloaded zip carries: a hosted pin's new
 * text replacing the old one, a deleted photo gone WITH its jpg.
 */

const RANGES_ARCHIVE = "http://127.0.0.1:5197/ranges-ok/tour.zip";
/** The fixture tour's hosted pin (archive-server.mjs). */
const FIXTURE_PIN = "fixturepin01";
/** The fakes' control surface on `window` (ar-fakes.js). */
const TEST_KEY = "__tourViewerTest";

test.beforeEach(async ({ page }) => {
  await installTourViewerArFakes(page);
});

/** Entry names, and the JSON entries' text, of the n-th downloaded zip. */
async function downloadedZip(page, index) {
  const data = await page.evaluate(async (i) => {
    const d = /** @type {any} */ (window).__tourViewerTest.downloads[i];
    return Array.from(new Uint8Array(await d.blob.arrayBuffer()));
  }, index);
  const reader = new ZipReader(
    new BlobReader(new Blob([new Uint8Array(data)])),
  );
  const names = [];
  const json = {};
  for (const entry of await reader.getEntries()) {
    if (entry.directory) continue;
    names.push(entry.filename);
    if (entry.filename.endsWith(".json")) {
      json[entry.filename] = await entry.getData(new TextWriter());
    }
  }
  await reader.close();
  return { names, manifest: parseTourManifest(JSON.parse(json["tour.json"])) };
}

async function openTour(page) {
  await page.goto("/?nocache=1");
  await page.getByTestId("link-input").fill(RANGES_ARCHIVE);
  await page.getByTestId("open-button").click();
  await expect(page.getByTestId("gallery").locator("img")).toHaveCount(8, {
    timeout: 15000,
  });
  const step = page.getByTestId("step-measure");
  if (!(await step.evaluate((el) => /** @type {any} */ (el).open))) {
    await step.locator("summary").click();
  }
}

/** The session zero plus three consistent fixes (ar-mode.spec.js). */
async function seedAlignment(page) {
  await page.evaluate(() => {
    const store = /** @type {any} */ (window).__tourViewerTest.alignmentStore;
    store.dispatch({
      type: "gpsData/setZeroPos",
      payload: { lat: 47.5, lon: 8.7 },
    });
    const pairs = [
      { odom: [0, 0, 0], lat: 47.5, lon: 8.7 },
      { odom: [0, 0, -15], lat: 47.500135, lon: 8.7 },
      { odom: [15, 0, 0], lat: 47.5, lon: 8.7002 },
    ];
    for (const [i, p] of pairs.entries()) {
      store.dispatch({
        type: "gpsData/recordGpsEvent",
        payload: {
          odomPosition: p.odom,
          odomRotation: [0, 0, 0, 1],
          rawGpsPoint: {
            id: `seed-${String(i)}`,
            latitude: p.lat,
            longitude: p.lon,
            altitude: 400,
            latLongAccuracy: 5,
            timestamp: 1756150000000 + i * 1000,
          },
        },
      });
    }
  });
}

/** Enter AR and measure the fixture's code (it stores a pose, so the
 *  measurement keeps it - D10b); placement unlocks. */
async function enterArAndMeasure(page) {
  await expect(page.getByTestId("enter-ar")).toBeEnabled({ timeout: 10000 });
  await page.getByTestId("enter-ar").click();
  await page.evaluate((text) => {
    /** @type {any} */ (window).__tourViewerTest.armQrDetection(text);
  }, E2E_QR_TEXT);
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
        });
        return page.getByTestId("setup-status").textContent();
      },
      { timeout: 15000 },
    )
    .toMatch(/waiting for GPS alignment/i);
  await seedAlignment(page);
  await expect(page.getByTestId("setup-mint")).toBeEnabled({ timeout: 10000 });
  await page.getByTestId("setup-mint").click();
  await expect(page.getByTestId("setup-pin")).toBeEnabled();
}

/**
 * Finish, then download: the zip lands in the fake's downloads as the
 * `index`-th. The Finish button is disabled while the zip is rebuilt, so
 * waiting for it to come back is waiting for THIS rebuild - a second Finish
 * finds the first one's download button already live.
 */
async function finishAndDownload(page, index) {
  const finish = page.getByTestId("setup-finish");
  await finish.click();
  await expect(finish).toBeEnabled({ timeout: 30000 });
  await expect(page.getByTestId("finish-block")).toBeVisible();
  await page.getByTestId("finish-download").click();
  await expect
    .poll(() =>
      page.evaluate(
        () => /** @type {any} */ (window).__tourViewerTest.downloads.length,
      ),
    )
    .toBe(index + 1);
}

function row(page, title) {
  return page.getByTestId("object-row").filter({
    has: page.getByTestId("object-title").getByText(title, { exact: true }),
  });
}

test("the list edits a hosted pin on the page - no AR needed - and the Finish writes the new text in its place", async ({
  page,
}) => {
  await openTour(page);
  // The hosted zip's pin is listed on the page (a desktop, no session).
  const hosted = row(page, "Fixture pin");
  await expect(hosted).toBeVisible();
  await expect(hosted.getByTestId("object-detail")).toHaveText(
    /^Pin · in the zip · \d+ m from the code$/,
  );
  // No Move on the page: that needs the reticle.
  await expect(hosted.getByTestId("object-move")).toHaveCount(0);

  await hosted.getByTestId("object-edit").click();
  await page.getByTestId("object-edit-input").fill("The renamed pin");
  await page.getByTestId("object-edit-save").click();
  await expect(page.getByTestId("object-list-note")).toHaveText(
    /Saved "The renamed pin"/,
  );
  const renamed = row(page, "The renamed pin");
  await expect(renamed.getByTestId("object-detail")).toHaveText(
    /changed, not yet in the zip/,
  );

  await enterArAndMeasure(page);
  await finishAndDownload(page, 0);
  const zip = await downloadedZip(page, 0);
  const pins = zip.manifest.objects.filter((o) => o.id === FIXTURE_PIN);
  // Replaced in place: one record, the new text.
  expect(pins).toHaveLength(1);
  expect(pins[0]?.kind === "pin" && pins[0].label).toBe("The renamed pin");
});

test("a deleted photo leaves the zip with its jpg, and a deleted hosted pin leaves the manifest", async ({
  page,
}) => {
  await openTour(page);
  await enterArAndMeasure(page);
  await page.evaluate(() => {
    /** @type {any} */ (window).__tourViewerTest.emitFrames(1);
  });
  await page.getByTestId("setup-photo").click();
  await expect(page.getByTestId("setup-status")).toContainText(
    /1 object placed/,
  );
  await finishAndDownload(page, 0);
  const first = await downloadedZip(page, 0);
  const photo = first.manifest.objects.find((o) => o.kind === "photo");
  expect(photo, "the photo is in the first zip").toBeDefined();
  const jpg = photo?.kind === "photo" ? photo.image : "";
  expect(first.names).toContain(jpg);

  // On the page now (the Finish ended the session): delete both.
  await row(page, "Photo").getByTestId("object-delete").click();
  await expect(page.getByTestId("object-list-note")).toHaveText(
    /Deleted the photo - it leaves the zip on the next Finish/,
  );
  await row(page, "Fixture pin").getByTestId("object-delete").click();
  await expect(row(page, "Fixture pin")).toHaveCount(0);

  await finishAndDownload(page, 1);
  const second = await downloadedZip(page, 1);
  expect(second.manifest.objects.map((o) => o.id)).toEqual([]);
  expect(second.names).not.toContain(jpg);
});

test("a tap in AR selects the object under the ring, a tap on the panel does not, and Move takes the pin to the reticle", async ({
  page,
}) => {
  await openTour(page);
  await enterArAndMeasure(page);

  // In AR the list waits for a selection.
  await expect(page.getByTestId("object-list-hint")).toHaveText(
    /tap the screen to select it/,
  );
  await page.evaluate(
    ([key, id]) => {
      /** @type {any} */ (window)[key].pickId = id;
      /** @type {any} */ (window)[key].tapXr();
    },
    [TEST_KEY, FIXTURE_PIN],
  );
  // The hosted pin was among the rendered objects, and is selected.
  expect(
    await page.evaluate(
      (key) => /** @type {any} */ (window)[key].pickTargets,
      TEST_KEY,
    ),
  ).toContain(FIXTURE_PIN);
  const selected = page.locator(
    '[data-testid="object-row"][data-selected="true"]',
  );
  await expect(selected.getByTestId("object-title")).toHaveText("Fixture pin");
  await expect(selected.getByTestId("object-move")).toBeVisible();

  // THE GUARD: a tap on Delete in the overlay is a DOM click AND an XR
  // select; the select must not also pick what stands behind the button.
  // Nothing is under the ring now, so a select that got through would
  // clear the selection.
  const fired = await page.evaluate((key) => {
    const t = /** @type {any} */ (window)[key];
    t.pickId = null;
    return t.tapXr('[data-testid="object-delete"]');
  }, TEST_KEY);
  expect(fired, "the panel cancels beforexrselect").toBe(false);
  await expect(selected).toHaveCount(1);
  // A tap on the scene with nothing under the ring clears it.
  await page.evaluate(
    (key) => /** @type {any} */ (window)[key].tapXr(),
    TEST_KEY,
  );
  await expect(selected).toHaveCount(0);

  // Select again and move it to the reticle.
  await page.evaluate(
    ([key, id]) => {
      /** @type {any} */ (window)[key].pickId = id;
      /** @type {any} */ (window)[key].tapXr();
    },
    [TEST_KEY, FIXTURE_PIN],
  );
  await selected.getByTestId("object-move").click();
  await expect(page.getByTestId("object-list-note")).toHaveText(
    /Moved "Fixture pin" to the ring/,
  );
  await finishAndDownload(page, 0);
  const zip = await downloadedZip(page, 0);
  const moved = zip.manifest.objects.find((o) => o.id === FIXTURE_PIN);
  // The fixture's pin stood at 47.50009 N 8.7 E; the reticle is elsewhere.
  expect(moved?.geo.lon).not.toBeCloseTo(8.7, 6);
});
