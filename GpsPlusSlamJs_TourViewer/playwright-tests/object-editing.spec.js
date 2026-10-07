// @ts-check
import { expect, test } from "@playwright/test";

import {
  enterArAndMeasure,
  installTourViewerArFakes,
  openFixtureTour as openTour,
} from "./ar-fakes.js";
import { parseTourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { E2E_QR_ARCHIVE } from "./qr-fixture.mjs";
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

/** The fixture tour's hosted pin (archive-server.mjs). */
const FIXTURE_PIN = "fixturepin01";
/** The fakes' control surface on `window` (ar-fakes.js). */
const TEST_KEY = "__tourViewerTest";

test.beforeEach(async ({ page }) => {
  await installTourViewerArFakes(page);
});

/** Every file entry's name, and each JSON entry's text, of a zip's bytes. */
async function readZip(bytes) {
  const reader = new ZipReader(new BlobReader(new Blob([bytes])));
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
  return { names, json };
}

/** The level files (`qr/*.json`) of a zip, by entry name, as text. */
async function levelTexts(bytes) {
  const { json } = await readZip(bytes);
  return Object.fromEntries(
    Object.entries(json).filter(([name]) => name.startsWith("qr/")),
  );
}

/** Entry names, the manifest and the level files of the n-th downloaded zip. */
async function downloadedZip(page, index) {
  const data = await page.evaluate(async (i) => {
    const d = /** @type {any} */ (window).__tourViewerTest.downloads[i];
    return Array.from(new Uint8Array(await d.blob.arrayBuffer()));
  }, index);
  const bytes = new Uint8Array(data);
  const { names, json } = await readZip(bytes);
  return {
    names,
    manifest: parseTourManifest(JSON.parse(json["tour.json"])),
    levels: await levelTexts(bytes),
  };
}

/**
 * Finish, then download: the zip lands in the fake's downloads as the
 * `index`-th. The Finish button is disabled while the zip is rebuilt, so
 * waiting for it to leave that state is waiting for THIS rebuild - a second
 * Finish finds the first one's download button already live. It leaves it
 * enabled when work remains, or hidden when nothing is left to write
 * (code book plan M4d: an unchanged stored code is not work).
 */
async function finishAndDownload(page, index) {
  const finish = page.getByTestId("setup-finish");
  await finish.click();
  await expect
    .poll(async () => (await finish.isHidden()) || (await finish.isEnabled()), {
      timeout: 30000,
    })
    .toBe(true);
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

test("a desk edit is finished without entering AR, and the hosted code's level is not rewritten (code book plan M4e, §9 D4)", async ({
  page,
}) => {
  // A Finish and BOTH zips read back in node (the hosted one for the
  // byte comparison): longer than the 30 s default allows on a loaded
  // machine - its first runs reached "Saved as" and timed out reading.
  test.setTimeout(90_000);
  // Why this matters: the owner decided a tour can be edited at the desk
  // and finished there - no walk to a printed code. Finish used to need a
  // measured code in hand. The unit tests prove the readiness rule and the
  // rebuild; only the composed page shows that the button is offered on a
  // desktop with no session, and that the zip it writes keeps the hosted
  // level exactly (nothing was measured, so nothing may move).
  await openTour(page);
  await row(page, "Fixture pin").getByTestId("object-edit").click();
  await page.getByTestId("object-edit-input").fill("Renamed at the desk");
  await page.getByTestId("object-edit-save").click();
  await expect(page.getByTestId("object-list-note")).toHaveText(
    /Saved "Renamed at the desk"/,
  );
  // The AR session was never started.
  await expect(page.getByTestId("enter-ar")).toBeEnabled({ timeout: 10000 });

  const finish = page.getByTestId("setup-finish");
  await expect(finish).toBeEnabled();
  await finishAndDownload(page, 0);
  // Nothing is left to write after it.
  await expect(finish).toBeHidden();
  const zip = await downloadedZip(page, 0);
  const pins = zip.manifest.objects.filter((o) => o.id === FIXTURE_PIN);
  expect(pins).toHaveLength(1);
  expect(pins[0]?.kind === "pin" && pins[0].label).toBe("Renamed at the desk");
  const hosted = await page.evaluate(async (url) => {
    const response = await fetch(url);
    return Array.from(new Uint8Array(await response.arrayBuffer()));
  }, E2E_QR_ARCHIVE);
  const hostedLevels = await levelTexts(new Uint8Array(hosted));
  expect(Object.keys(hostedLevels)).not.toHaveLength(0);
  expect(zip.levels).toEqual(hostedLevels);
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

test("Delete offers Undo beside its outcome, which brings a hosted pin back; the Undo goes when its time is up", async ({
  page,
}) => {
  // M4 review #5: Delete had no confirm and no undo. The page list is the
  // DOM half of the unit-tested Undo (authoring-settle.test.ts): the button
  // sits beside the outcome, restores the row, and is withdrawn when the
  // hold timer (the `schedule` seam, fired by hand) runs out.
  await openTour(page);
  await row(page, "Fixture pin").getByTestId("object-delete").click();
  await expect(page.getByTestId("object-list-note")).toHaveText(
    /Deleted "Fixture pin"/,
  );
  await expect(row(page, "Fixture pin")).toHaveCount(0);
  await page.getByTestId("object-undo").click();
  await expect(page.getByTestId("object-list-note")).toHaveText(
    /Restored "Fixture pin"/,
  );
  await expect(
    row(page, "Fixture pin").getByTestId("object-detail"),
  ).toHaveText(/in the zip/);

  await row(page, "Fixture pin").getByTestId("object-delete").click();
  await expect(page.getByTestId("object-undo")).toBeVisible();
  await page.evaluate(
    (key) => /** @type {any} */ (window)[key].fireTimers(),
    TEST_KEY,
  );
  await expect(page.getByTestId("object-undo")).toBeHidden();
  await expect(row(page, "Fixture pin")).toHaveCount(0);
});
