// @ts-check
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  TextReader,
  TextWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import {
  createEmptyTourManifest,
  serializeTourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";

/**
 * Why these tests matter (Tour Viewer M6 E1): the desktop editor opens a
 * file anyone can make and draws it on a map. These drive the REAL file
 * chooser and check what a creator sees: every code and note listed and on
 * the map, the card beside the selected marker and inside the free part of
 * the window, a photo shown from the zip and an oversized one refused, a
 * label carrying markup shown as text (never run), a zip that is not a tour
 * refused in words, and the chosen layout (variant 1: the rail on the left
 * under the top bar) at a phone, a phone sideways and a desktop.
 */

/** 1x1 red PNG, a real decodable image. */
const TINY_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => /** @type {number} */ (c.codePointAt(0)),
);

/** The same PNG whose header claims 5000 x 5000 px: over the tour cap,
 *  refused by its header before any decode. */
function oversizedPng() {
  const bytes = TINY_PNG.slice();
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 5000);
  view.setUint32(20, 5000);
  return bytes;
}

const AT = { lat: 48.5203, lon: 9.0536, alt: 340 };
const MARKUP = '<img src=x onerror="window.__xss=1">Town hall';

/** @param {number} north @param {number} east */
function geo(north, east) {
  return {
    lat: AT.lat + north / 111_320,
    lon: AT.lon + east / 73_800,
    alt: AT.alt,
  };
}

/** @param {{path: string, data: string | Uint8Array}[]} entries */
async function zip(entries) {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const e of entries) {
    await writer.add(
      e.path,
      typeof e.data === "string"
        ? new TextReader(e.data)
        : new Uint8ArrayReader(e.data),
    );
  }
  return Buffer.from(await writer.close());
}

async function editorTour(options = { station: false }) {
  const codes = [];
  /** @type {string[]} */
  const codeIds = [];
  for (const [i, place] of [geo(0, 0), geo(30, 40)].entries()) {
    const id = await qrCodeId(
      `https://gps.csutil.com/tour/?qr=editor&n=${i + 1}`,
    );
    codeIds.push(id);
    codes.push({
      path: `qr/${id}.json`,
      data: JSON.stringify({
        version: 1,
        qr: { physicalSizeM: 0.2, geo: { ...place, headingDeg: 90 } },
      }),
    });
  }
  // Through the serializer: a title needs tour.json version 2.
  const manifest = {
    ...createEmptyTourManifest(),
    title: "Editor fixture",
    // A story station at the first code's point (PR #609 review).
    stations: options.station
      ? [
          {
            id: "gate",
            title: "At the gate",
            anchor: { code: codeIds[0] },
            activateRadiusM: 30,
            foundRadiusM: 5,
            hint: "arrow",
            steps: [{ id: "hi", block: { kind: "text", text: "Hello" } }],
          },
        ]
      : [],
    objects: [
      {
        id: "pin-markup",
        kind: "pin",
        label: MARKUP,
        createdAtIso: "2026-10-13T00:00:00.000Z",
        geo: { ...geo(10, 10), headingDeg: 0 },
      },
      {
        id: "photo-ok",
        kind: "photo",
        label: "Fountain",
        image: "content/photo-ok.png",
        imageWidth: 1,
        imageHeight: 1,
        createdAtIso: "2026-10-13T00:00:00.000Z",
        geo: { ...geo(-10, 20), rotation: [0, 0, 0, 1] },
      },
      {
        id: "photo-big",
        kind: "photo",
        label: "Too big",
        image: "content/photo-big.png",
        imageWidth: 1,
        imageHeight: 1,
        createdAtIso: "2026-10-13T00:00:00.000Z",
        geo: { ...geo(20, -20), rotation: [0, 0, 0, 1] },
      },
    ],
  };
  return zip([
    { path: "tour.json", data: serializeTourManifest(manifest) },
    ...codes,
    { path: "content/photo-ok.png", data: TINY_PNG },
    { path: "content/photo-big.png", data: oversizedPng() },
  ]);
}

// The page prefers the browser's file picker (M6 E2b-1); these tests open
// through the file input, so the picker is taken away before each - the
// in-place tests put their own back after the page loads.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error - the e2e takes the picker away on purpose.
    delete window.showOpenFilePicker;
  });
});

/** @param {import("@playwright/test").Page} page */
async function answerTiles(page) {
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(TINY_PNG),
    }),
  );
}

/**
 * Open `buffer` through the real file chooser.
 * @param {import("@playwright/test").Page} page
 * @param {Buffer} buffer
 * @param {string} name
 */
async function openThroughChooser(page, buffer, name) {
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#drop").click();
  await (await chooser).setFiles({ name, mimeType: "application/zip", buffer });
}

/** @param {import("@playwright/test").Locator} locator */
async function box(locator) {
  const b = await locator.boundingBox();
  if (b === null) throw new Error("not laid out");
  return b;
}

test.beforeEach(async ({ page }) => {
  await answerTiles(page);
});

test("opens a tour through the file chooser and lists every code and note, labels as text", async ({
  page,
}) => {
  await page.goto("/edit.html");
  await expect(page.locator("#open-modal")).toBeVisible();
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await expect(page.locator(".toast")).toHaveText(
    "Opened editor-fixture.zip: 2 codes, 3 notes",
  );
  await expect(page.locator("#open-modal")).toBeHidden();
  await expect(page.locator("#tour-name")).toHaveText("Editor fixture");
  const titles = page.locator("#rail .row-title");
  await expect(titles).toHaveText([
    "Code 1",
    "Code 2",
    MARKUP,
    "Fountain",
    "Too big",
  ]);
  await expect(page.locator(".mk-wrap")).toHaveCount(5);
  // The markup is text: no element was made from it, nothing ran.
  await expect(page.locator("#rail img")).toHaveCount(0);
  expect(await page.evaluate(() => "__xss" in window)).toBe(false);
});

test("a row opens the card beside its marker, with the photo from the zip, and Esc closes it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#rail .row", { hasText: "Fountain" }).click();
  const card = page.locator("#card");
  await expect(card).toBeVisible();
  await expect(card.locator("img.card-photo")).toBeVisible();
  await expect(card).toContainText("0.1-0.7 m near a code");
  const rail = await box(page.locator("#rail"));
  const cardBox = await box(card);
  const marker = await box(page.locator(".mk-wrap.sel"));
  // Inside the free part: right of the rail, under the top bar.
  expect(cardBox.x).toBeGreaterThanOrEqual(rail.x + rail.width);
  expect(cardBox.y).toBeGreaterThanOrEqual(80);
  // Beside its marker: the card's near edge within 40 px of the marker.
  const nearEdge =
    cardBox.x > marker.x
      ? cardBox.x - (marker.x + marker.width)
      : marker.x - (cardBox.x + cardBox.width);
  // Beside it, not over it (E1 review #5): a gap of 0 to 40 px.
  expect(nearEdge).toBeGreaterThanOrEqual(0);
  expect(nearEdge).toBeLessThan(40);
  // The row and the marker are selected together.
  await expect(
    page.locator("#rail .row", { hasText: "Fountain" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await expect(page.locator(".mk-wrap.sel")).toHaveCount(0);
});

test("refuses a photo over the tour's size cap with a line, not a decode", async ({
  page,
}) => {
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#rail .row", { hasText: "Too big" }).click();
  await expect(page.locator("#card .note-line.error")).toContainText(
    "This photo is not shown",
  );
  await expect(page.locator("#card img")).toHaveCount(0);
});

test("refuses a zip that is not a tour in words, and stays on the open dialog", async ({
  page,
}) => {
  await page.goto("/edit.html");
  await openThroughChooser(
    page,
    await zip([{ path: "session.json", data: "{}" }]),
    "recording.zip",
  );
  await expect(page.locator("#open-error")).toHaveText(
    /This file is not a tour/,
  );
  await expect(page.locator("#open-modal")).toBeVisible();
  await expect(page.locator("#rail")).toBeHidden();
});

for (const viewport of [
  { width: 1280, height: 800, collapsed: false },
  { width: 844, height: 390, collapsed: false },
  { width: 390, height: 844, collapsed: true },
]) {
  test(`keeps the chosen layout at ${viewport.width}x${viewport.height}: the rail on the left under the top bar`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/edit.html");
    await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
    // The open is async ("Opening…"): measure once the tour is drawn.
    await expect(page.locator("#rail")).toBeVisible();
    const top = await box(page.locator("#topbar"));
    const rail = await box(page.locator("#rail"));
    expect(top.x).toBe(12);
    expect(top.y).toBe(12);
    expect(top.width).toBe(viewport.width - 24);
    expect(rail.x).toBe(12);
    expect(rail.y).toBe(top.y + top.height + 12);
    // The prototype collapses the rail on a narrow window.
    expect(rail.width).toBe(
      viewport.collapsed ? 58 : viewport.width <= 980 ? 252 : 304,
    );
    // Every top-bar control inside the window (E2a review #11): the bar
    // is fixed, so the page's scroll width cannot see an overflow.
    for (const control of await page
      .locator("#topbar button, #save-status")
      .all()) {
      if (!(await control.isVisible())) continue;
      const b = await box(control);
      expect(b.x + b.width).toBeLessThanOrEqual(viewport.width);
    }
    // Nothing wider than the window.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
  });
}

test("the sample tour opens with its story's stations on the map", async ({
  page,
}) => {
  // Why: "Use the sample tour" is the first thing a visitor of the page
  // tries; the sample is a story tour with stations only, and an editor
  // that listed only codes and notes opened it as an empty world map.
  await page.goto("/edit.html");
  await page.locator("#sample-btn").click();
  await expect(page.locator(".toast")).toHaveText(
    "Opened marienplatz-tour.zip: 0 codes, 0 notes, 3 stations",
  );
  await expect(page.locator("#rail .row-title")).toHaveText([
    "The column",
    "The old gate",
    "The town hall steps",
  ]);
  await expect(page.locator(".mk-station")).toHaveCount(3);
});

/** A tour in the wrapped shape ("compress this folder"): a recorded photo
 *  whose image is the archive's entry name, and a code with no stored
 *  position. */
/** @param {{ pin: boolean, extra?: boolean }} options - `extra`: a second
 *  pin, as another program's edit of the same tour would add */
async function wrappedTour(options = { pin: false }) {
  const id = await qrCodeId("https://gps.csutil.com/tour/?qr=wrapped");
  const manifest = {
    ...createEmptyTourManifest(),
    title: "Wrapped fixture",
    objects: options.pin
      ? [
          {
            id: "pin-wrapped",
            kind: "pin",
            label: "Wrapped pin",
            createdAtIso: "2026-10-13T00:00:00.000Z",
            geo: { ...geo(6, 6), headingDeg: 0 },
          },
          ...(options.extra === true
            ? [
                {
                  id: "pin-elsewhere",
                  kind: "pin",
                  label: "Added elsewhere",
                  createdAtIso: "2026-10-14T00:00:00.000Z",
                  geo: { ...geo(-6, 6), headingDeg: 0 },
                },
              ]
            : []),
        ]
      : [],
    captureSpots: {
      fixes: 3,
      gpsAccuracyMedianM: 4,
      captures: [
        {
          image: "mytour/images/frame-000002.png",
          geo: { ...geo(5, 5), rotation: [0, 0, 0, 1] },
        },
      ],
    },
  };
  return zip([
    { path: "mytour/tour.json", data: serializeTourManifest(manifest) },
    {
      path: `mytour/qr/${id}.json`,
      data: JSON.stringify({ version: 1, qr: { physicalSizeM: 0.2 } }),
    },
    { path: "mytour/session.json", data: "{}" },
    { path: "mytour/actions/000001.json", data: "[]" },
    { path: "mytour/images/frame-000002.png", data: TINY_PNG },
  ]);
}

test("shows a recorded photo of a wrapped zip, and a code without a position in a card of its own", async ({
  page,
}) => {
  // Why (E1 review #1, #3): a recorded photo's image is already the entry
  // name, so joining the tour's folder to it read every one from the wrong
  // path; and a code without a position got an "off the map view" chip
  // whose "Show it" could do nothing.
  await page.goto("/edit.html");
  await openThroughChooser(page, await wrappedTour(), "wrapped.zip");
  await page.locator("#rail .row", { hasText: "Recorded photo" }).click();
  await expect(page.locator("#card img.card-photo")).toBeVisible();
  await page.locator("#rail .row", { hasText: "The code" }).click();
  await expect(page.locator("#card")).toContainText("no position stored yet");
  await expect(page.locator("#offscreen-chip")).toBeHidden();
});

test("says the sample is being fetched while it is, and why it failed when it does", async ({
  page,
}) => {
  // Why (root CLAUDE.md, async feedback; E1 review #5): the in-progress
  // state and the failure must both be visible.
  /** @type {() => void} */
  let answer = () => undefined;
  await page.route("**/samples/marienplatz-tour.zip", async (route) => {
    await new Promise((resolve) => {
      answer = () => {
        resolve(undefined);
      };
    });
    await route.fulfill({ status: 404, body: "" });
  });
  await page.goto("/edit.html");
  await page.locator("#sample-btn").click();
  await expect(page.locator("#open-status")).toHaveText(
    "Fetching the sample tour…",
  );
  await expect(page.locator("#sample-btn")).toBeDisabled();
  answer();
  await expect(page.locator("#open-error")).toHaveText(
    "The sample tour could not be fetched: the sample answered 404",
  );
  await expect(page.locator("#sample-btn")).toBeEnabled();
});

test("Open another tour can be cancelled, and a refused file keeps the open tour", async ({
  page,
}) => {
  // Why (E1 review #4): the old tour was closed before the new file was
  // checked, and the dialog had no way back.
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await expect(page.locator("#rail")).toBeVisible();
  await page.locator("#open-another").click();
  await expect(page.locator("#open-cancel")).toBeVisible();
  await openThroughChooser(
    page,
    await zip([{ path: "session.json", data: "{}" }]),
    "recording.zip",
  );
  await expect(page.locator("#open-error")).toHaveText(
    /This file is not a tour/,
  );
  await page.locator("#open-cancel").click();
  await expect(page.locator("#open-modal")).toBeHidden();
  await expect(page.locator("#tour-name")).toHaveText("Editor fixture");
  // The tour still reads: its photo opens.
  await page.locator("#rail .row", { hasText: "Fountain" }).click();
  await expect(page.locator("#card img.card-photo")).toBeVisible();
});

/**
 * The saved file, through the browser's download: the save picker is taken
 * away first, so the framework's `downloadBlob` takes its `<a download>`
 * path, which Playwright sees (M6 E2a).
 * @param {import("@playwright/test").Page} page
 */
async function saveAndRead(page) {
  const download = page.waitForEvent("download");
  await page.locator("#save-btn").click();
  const file = await download;
  const path = await file.path();
  const bytes = new Uint8Array(readFileSync(path));
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  const entries = await reader.getEntries();
  /** @type {Record<string, string>} */
  const texts = {};
  for (const entry of entries) {
    if (!entry.directory && entry.getData !== undefined) {
      texts[entry.filename] = await entry.getData(new TextWriter());
    }
  }
  await reader.close();
  return {
    name: file.suggestedFilename(),
    manifest: JSON.parse(texts["tour.json"] ?? "{}"),
    names: Object.keys(texts),
  };
}

/** @param {import("@playwright/test").Page} page */
async function noSavePicker(page) {
  await page.addInitScript(() => {
    // @ts-expect-error - the e2e takes the picker away on purpose.
    delete window.showSaveFilePicker;
  });
}

test("edits a pin's text and saves a tour that carries it", async ({
  page,
}) => {
  // Why (M6 E2a): an edit on the desktop must reach the file the creator
  // puts back - under the opened file's name, so Drive offers Replace.
  await noSavePicker(page);
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#rail .row", { hasText: "Town hall" }).click();
  const field = page.locator("#card textarea");
  await field.fill("The new text");
  await field.blur();
  await expect(page.locator("#save-status")).toHaveText("1 change not saved");
  await expect(page.locator("#card")).toContainText("Changed - not saved yet.");
  const saved = await saveAndRead(page);
  expect(saved.name).toBe("editor-fixture.zip");
  const pinSaved = saved.manifest.objects.find(
    (/** @type {{ id: string }} */ o) => o.id === "pin-markup",
  );
  expect(pinSaved.label).toBe("The new text");
  await expect(page.locator("#save-status")).toHaveText(
    "Saved as editor-fixture.zip",
  );
});

test("refuses to empty a pin, in the card's words", async ({ page }) => {
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#rail .row", { hasText: "Town hall" }).click();
  const field = page.locator("#card textarea");
  await field.fill("   ");
  await field.blur();
  await expect(page.locator("#card")).toContainText("A pin needs some text");
  await expect(page.locator("#save-status")).toHaveText("No changes");
});

test("deletes a note with Undo, and a saved delete takes the photo's file", async ({
  page,
}) => {
  await noSavePicker(page);
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#rail .row", { hasText: "Fountain" }).click();
  await page.locator("#card button", { hasText: "Delete" }).click();
  await expect(page.locator("#rail .row", { hasText: "Fountain" })).toHaveCount(
    0,
  );
  await page.locator(".toast button", { hasText: "Undo" }).click();
  await expect(page.locator("#rail .row", { hasText: "Fountain" })).toHaveCount(
    1,
  );
  await expect(page.locator("#save-status")).toHaveText("No changes");
  await page.locator("#rail .row", { hasText: "Fountain" }).click();
  await page.locator("#card button", { hasText: "Delete" }).click();
  const saved = await saveAndRead(page);
  expect(
    saved.manifest.objects.map((/** @type {{ id: string }} */ o) => o.id),
  ).not.toContain("photo-ok");
  expect(saved.names).not.toContain("content/photo-ok.png");
  expect(saved.names).toContain("content/photo-big.png");
});

test("moves a pin by dragging its marker, says the height was kept, and saves the new place", async ({
  page,
}) => {
  await noSavePicker(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#rail .row", { hasText: "Town hall" }).click();
  await page.locator("#card button", { hasText: "Move" }).click();
  await expect(page.locator("#card")).toContainText(
    "Drag the marker to its new place.",
  );
  const marker = await box(page.locator(".mk-wrap.sel"));
  await page.mouse.move(marker.x + marker.width / 2, marker.y + 10);
  await page.mouse.down();
  await page.mouse.move(marker.x + marker.width / 2 + 60, marker.y + 70, {
    steps: 8,
  });
  await page.mouse.up();
  await page.locator("#card button", { hasText: "Done" }).click();
  await expect(page.locator("#card")).toContainText(
    "Height kept from the phone",
  );
  const saved = await saveAndRead(page);
  const pinSaved = saved.manifest.objects.find(
    (/** @type {{ id: string }} */ o) => o.id === "pin-markup",
  );
  // South-east of where it was: further east, further south.
  expect(pinSaved.geo.lon).toBeGreaterThan(9.0536 + 10 / 73_800);
  expect(pinSaved.geo.lat).toBeLessThan(48.5203 + 10 / 111_320);
  expect(pinSaved.geo.alt).toBe(340);
});

test("asks before Open another tour drops unsaved changes", async ({
  page,
}) => {
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#rail .row", { hasText: "Town hall" }).click();
  const field = page.locator("#card textarea");
  await field.fill("Changed");
  await field.blur();
  /** @type {string[]} */
  const asked = [];
  page.once("dialog", (dialog) => {
    asked.push(dialog.message());
    void dialog.dismiss();
  });
  await page.locator("#open-another").click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toMatch(/not saved/);
  await expect(page.locator("#open-modal")).toBeHidden();
});

test("a click right after typing lands: on another row, and on Save", async ({
  page,
}) => {
  // Why (E2a review #3): the commit on blur redrew the rail and the card,
  // so the click that caused the blur hit a replaced node and was lost;
  // and Save stayed disabled until the field blurred.
  await noSavePicker(page);
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#rail .row", { hasText: "Town hall" }).click();
  await page.locator("#card textarea").fill("Typed, then a row");
  await page.locator("#rail .row", { hasText: "Fountain" }).click();
  await expect(
    page.locator("#rail .row", { hasText: "Fountain" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#save-status")).toHaveText("1 change not saved");
  await page.locator("#rail .row", { hasText: "Typed, then a row" }).click();
  await page.locator("#card textarea").fill("Typed, then Save");
  const saved = await saveAndRead(page);
  const pinSaved = saved.manifest.objects.find(
    (/** @type {{ id: string }} */ o) => o.id === "pin-markup",
  );
  expect(pinSaved.label).toBe("Typed, then Save");
});

test("Ctrl+Enter commits the text, Esc cancels a move", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#rail .row", { hasText: "Town hall" }).click();
  await page.locator("#card textarea").fill("By keyboard");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator("#save-status")).toHaveText("1 change not saved");
  await page.locator("#card button", { hasText: "Move" }).click();
  const marker = await box(page.locator(".mk-wrap.sel"));
  await page.mouse.move(marker.x + marker.width / 2, marker.y + 10);
  await page.mouse.down();
  await page.mouse.move(marker.x + 200, marker.y + 120, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await expect(page.locator("#card")).not.toContainText(
    "Drag the marker to its new place.",
  );
  // Only the text edit is pending: the cancelled move changed nothing.
  await expect(page.locator("#save-status")).toHaveText("1 change not saved");
});

test("a dismissed save picker keeps the file, and Save again delivers it", async ({
  page,
}) => {
  // Why (E2a review #6): the one undelivered case the page can see is a
  // dismissed picker; the built file must not be lost with it.
  await page.addInitScript(() => {
    let calls = 0;
    // @ts-expect-error - the e2e's own picker.
    window.showSaveFilePicker = () => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new DOMException("dismissed", "AbortError"));
      }
      return Promise.resolve({
        createWritable: () =>
          Promise.resolve({
            write: (/** @type {Blob} */ blob) => {
              // @ts-expect-error - read back by the test.
              window.__savedBytes = blob.size;
              return Promise.resolve();
            },
            close: () => Promise.resolve(),
            abort: () => Promise.resolve(),
          }),
      });
    };
  });
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#rail .row", { hasText: "Town hall" }).click();
  await page.locator("#card textarea").fill("Saved on the second try");
  await page.locator("#save-btn").click();
  await expect(page.locator("#save-status")).toHaveText(
    "Not saved yet - tap Save again",
  );
  await page.locator("#save-btn").click();
  await expect(page.locator("#save-status")).toHaveText(
    "Saved as editor-fixture.zip",
  );
  expect(
    // @ts-expect-error - set by the fake writable.
    await page.evaluate(() => window.__savedBytes),
  ).toBeGreaterThan(0);
});

test("a station at its code's point and the code are both reachable on the map", async ({
  page,
}) => {
  // Why (PR #609 review): drawn at the same point with the same size, the
  // station was hidden under the code and could only be found in the rail.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/edit.html");
  await openThroughChooser(
    page,
    await editorTour({ station: true }),
    "editor-fixture.zip",
  );
  await page.locator(".mk-station").click();
  await expect(page.locator("#card")).toContainText("At the gate");
  await page.keyboard.press("Escape");
  await page.locator(".mk-code", { hasText: "1" }).click();
  await expect(page.locator("#card")).toContainText("Code 1");
});

test("a file dropped outside the drop box does not take the page away", async ({
  page,
}) => {
  // Why (PR #609 review): the browser's default for a drop is to open the
  // file, which would drop the open tour.
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  const prevented = await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(["x"], "other.zip"));
    const over = new DragEvent("dragover", {
      bubbles: true,
      cancelable: true,
      dataTransfer: data,
    });
    const dropped = new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: data,
    });
    const target = document.getElementById("map") ?? document.body;
    target.dispatchEvent(over);
    target.dispatchEvent(dropped);
    return over.defaultPrevented && dropped.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect(page.locator("#tour-name")).toHaveText("Editor fixture");
});

test("a refused text committed by clicking away is said in a toast", async ({
  page,
}) => {
  // Why (PR #611 review): the card showed the refusal and the click then
  // replaced the card, so the creator was never told their text was kept.
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#rail .row", { hasText: "Town hall" }).click();
  await page.locator("#card textarea").fill("   ");
  await page.locator("#rail .row", { hasText: "Fountain" }).click();
  await expect(
    page.locator(".toast", { hasText: "A pin needs some text" }),
  ).toBeVisible();
  await expect(page.locator("#save-status")).toHaveText("No changes");
});

test("typing goes on in the field when a save ends mid-typing", async ({
  page,
}) => {
  // Why (PR #611 review): the save's end re-rendered the card and the
  // reused field lost the focus, so the next keystrokes went nowhere.
  await page.addInitScript(() => {
    // @ts-expect-error - the e2e's own picker, held until released.
    window.showSaveFilePicker = () =>
      new Promise((resolve) => {
        // @ts-expect-error - released by the test.
        window.__release = () =>
          resolve({
            createWritable: () =>
              Promise.resolve({
                write: () => Promise.resolve(),
                close: () => Promise.resolve(),
                abort: () => Promise.resolve(),
              }),
          });
      });
  });
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#rail .row", { hasText: "Town hall" }).click();
  const field = page.locator("#card textarea");
  await field.fill("First");
  await page.locator("#save-btn").click();
  await page.waitForFunction(
    // @ts-expect-error - set by the held picker.
    () => typeof window.__release === "function",
  );
  await field.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" and");
  // @ts-expect-error - set by the held picker.
  await page.evaluate(() => window.__release());
  // The typing is still pending, so the line says that; the save landed.
  await expect(page.locator("#save-status")).toHaveAttribute(
    "data-saved",
    "Saved as editor-fixture.zip",
  );
  await page.keyboard.type(" more");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("First and more");
});

test("the save's result stays until it is closed", async ({ page }) => {
  // Why (PR #611 review): it says where to put the file, and the 8 s hold
  // tuned for an Undo took that away before it could be read.
  await page.clock.install();
  await noSavePicker(page);
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#rail .row", { hasText: "Town hall" }).click();
  await page.locator("#card textarea").fill("Saved, then read");
  await saveAndRead(page);
  const result = page.locator(".toast", { hasText: "Put it in place" });
  await expect(result).toBeVisible();
  await page.clock.runFor(60_000);
  await expect(result).toBeVisible();
  await result.locator("button", { hasText: "Close" }).click();
  await expect(result).toHaveCount(0);
});

test("the file chooser can be reached and opened from the keyboard", async ({
  page,
}) => {
  // Why (PR #612 review): the chooser was a styled span in a label around
  // a hidden input, none of which is in the tab order, so a keyboard user
  // could open only the sample.
  await page.goto("/edit.html");
  // The button answers once the page script is wired; before, Enter on a
  // button inside a label does nothing.
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  const choose = page.locator("#choose-btn");
  await choose.focus();
  await expect(choose).toBeFocused();
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (
    await chooser
  ).setFiles({
    name: "editor-fixture.zip",
    mimeType: "application/zip",
    buffer: await editorTour(),
  });
  await expect(page.locator("#tour-name")).toHaveText("Editor fixture");
});

/**
 * A tour file in the page's origin-private file system, offered by a
 * stand-in for the browser's file picker: a real FileSystemFileHandle, so
 * the in-place write runs for real (E2b plan review #13).
 * @param {import("@playwright/test").Page} page
 * @param {Buffer} buffer
 * @param {string} name
 * @param {{ permission?: string }} [options] - a stand-in answer to the
 *   write-permission request, else the handle's own
 */
async function offerOpfsFile(page, buffer, name, options = {}) {
  await page.evaluate(
    async ({ b64, fileName, permission }) => {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(fileName, { create: true });
      const w = await handle.createWritable();
      await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      await w.close();
      const offered =
        permission === undefined
          ? handle
          : {
              kind: "file",
              name: handle.name,
              getFile: () => handle.getFile(),
              createWritable: () => handle.createWritable(),
              requestPermission: () => Promise.resolve(permission),
            };
      // @ts-expect-error - the e2e's own picker.
      window.showOpenFilePicker = () => Promise.resolve([offered]);
    },
    { b64: buffer.toString("base64"), fileName: name, ...options },
  );
}

/**
 * A file of the page's origin-private file system, as a zip's texts.
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
async function readOpfsTour(page, name) {
  const b64 = await page.evaluate(async (fileName) => {
    const root = await navigator.storage.getDirectory();
    const file = await (await root.getFileHandle(fileName)).getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    let text = "";
    for (const b of bytes) text += String.fromCharCode(b);
    return btoa(text);
  }, name);
  const reader = new ZipReader(
    new Uint8ArrayReader(new Uint8Array(Buffer.from(b64, "base64"))),
  );
  /** @type {Record<string, string>} */
  const texts = {};
  for (const entry of await reader.getEntries()) {
    if (!entry.directory && entry.getData !== undefined) {
      texts[entry.filename] = await entry.getData(new TextWriter());
    }
  }
  await reader.close();
  return texts;
}

test("saves in place to the file it opened, and keeps the walk recording", async ({
  page,
}) => {
  // Why (M6 E2b-1, E2b plan review #1): where the browser allows it, Save
  // writes the opened file itself - and since that may be the creator's
  // only copy of the walk, an in-place save never leaves the walk out.
  await page.goto("/edit.html");
  await offerOpfsFile(page, await wrappedTour({ pin: true }), "wrapped.zip");
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-name")).toHaveText("Wrapped fixture");
  await expect(page.locator("#keep-walk")).toBeHidden();
  await page.locator("#rail .row", { hasText: "Wrapped pin" }).click();
  await page.locator("#card textarea").fill("Saved in place");
  await page.locator("#save-btn").click();
  await expect(page.locator("#save-status")).toHaveText("Saved to wrapped.zip");
  const texts = await readOpfsTour(page, "wrapped.zip");
  expect(texts["mytour/tour.json"]).toContain("Saved in place");
  expect(Object.keys(texts)).toContain("mytour/actions/000001.json");
  // The photos now read from the written file.
  await page.locator("#rail .row", { hasText: "Recorded photo" }).click();
  await expect(page.locator("#card img.card-photo")).toBeVisible();
});

test("refuses to write over a file that changed meanwhile, and offers the download", async ({
  page,
}) => {
  // Why (E2b plan review #4): another program's write must never be
  // overwritten; the creator's changes stay, and a download saves them.
  await noSavePicker(page);
  await page.goto("/edit.html");
  await offerOpfsFile(page, await wrappedTour({ pin: true }), "wrapped.zip");
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-name")).toHaveText("Wrapped fixture");
  await page.locator("#rail .row", { hasText: "Wrapped pin" }).click();
  await page.locator("#card textarea").fill("Saved first");
  await page.locator("#save-btn").click();
  await expect(page.locator("#save-status")).toHaveText("Saved to wrapped.zip");
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const w = await (await root.getFileHandle("wrapped.zip")).createWritable();
    await w.write("another program wrote this");
    await w.close();
  });
  await page.locator("#card textarea").fill("Not over theirs");
  await page.locator("#save-btn").click();
  const refusal = page.locator(".toast", { hasText: "changed on disk" });
  await expect(refusal).toBeVisible();
  // Refused before the build: the change is still pending.
  await expect(page.locator("#save-status")).toHaveText("1 change not saved");
  const download = page.waitForEvent("download");
  await refusal.locator("button", { hasText: "Download instead" }).click();
  expect((await download).suggestedFilename()).toBe("wrapped.zip");
  await expect(page.locator("#save-status")).toHaveText("Saved as wrapped.zip");
  expect(
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      return (await (await root.getFileHandle("wrapped.zip")).getFile()).text();
    }),
  ).toBe("another program wrote this");
});

test("opens a file it may not write and saves it as a download", async ({
  page,
}) => {
  // Why (E2b plan review #8): a refused permission opens the tour all the
  // same; Save then downloads, and the page says why.
  await noSavePicker(page);
  await page.goto("/edit.html");
  await offerOpfsFile(page, await editorTour(), "editor-fixture.zip", {
    permission: "denied",
  });
  await page.locator("#choose-btn").click();
  await expect(
    page.locator(".toast", { hasText: "did not allow saving to this file" }),
  ).toBeVisible();
  await page.locator("#rail .row", { hasText: "Town hall" }).click();
  await page.locator("#card textarea").fill("As a download");
  const saved = await saveAndRead(page);
  expect(saved.name).toBe("editor-fixture.zip");
});

test("Ctrl+S saves, and the browser's own save never opens", async ({
  page,
}) => {
  // Why (E2b plan review #10): on this page Ctrl+S means the tour; the
  // browser's "Save page as" would save the editor itself.
  await noSavePicker(page);
  await page.goto("/edit.html");
  // The page's keydown handler exists once its script is wired; a press
  // before that reached the browser (a flaky run under load).
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  const prevented = page.evaluate(
    () =>
      new Promise((resolve) => {
        window.addEventListener(
          "keydown",
          (event) => {
            resolve(event.defaultPrevented);
          },
          { once: true },
        );
      }),
  );
  await page.keyboard.press("Control+s");
  expect(await prevented).toBe(true);
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#rail .row", { hasText: "Town hall" }).click();
  await page.locator("#card textarea").fill("By keyboard");
  const download = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  expect((await download).suggestedFilename()).toBe("editor-fixture.zip");
});

test("a second tab on a file of the same name saves a copy unless told to edit here", async ({
  page,
  context,
}) => {
  // Why (E2b plan review #6): two tabs writing one file would each
  // overwrite the other's work; the second is told, and may still choose.
  await page.goto("/edit.html");
  await offerOpfsFile(page, await wrappedTour({ pin: true }), "wrapped.zip");
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-name")).toHaveText("Wrapped fixture");
  const second = await context.newPage();
  await second.goto("/edit.html");
  await offerOpfsFile(second, await wrappedTour({ pin: true }), "wrapped.zip");
  await second.locator("#choose-btn").click();
  const told = second.locator(".toast", { hasText: "Another tab is editing" });
  await expect(told).toBeVisible();
  await expect(
    told.locator("button", { hasText: "Edit here anyway" }),
  ).toBeVisible();
});

test("a second tab that edits anyway keeps the walk, in its copy and in place", async ({
  page,
  context,
}) => {
  // Why (E2b-1 review #1): the second tab saved a download without the
  // walk, and "Edit here anyway" then wrote that walk-less build over the
  // creator's only copy. A tour opened to be written keeps its walk from
  // the start.
  await page.goto("/edit.html");
  await offerOpfsFile(page, await wrappedTour({ pin: true }), "wrapped.zip");
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-name")).toHaveText("Wrapped fixture");
  const second = await context.newPage();
  await noSavePicker(second);
  await second.goto("/edit.html");
  await offerOpfsFile(second, await wrappedTour({ pin: true }), "wrapped.zip");
  await second.locator("#choose-btn").click();
  const told = second.locator(".toast", { hasText: "Another tab is editing" });
  await expect(told).toBeVisible();
  await expect(second.locator("#keep-walk")).toBeHidden();
  await second.locator("#rail .row", { hasText: "Wrapped pin" }).click();
  await second.locator("#card textarea").fill("A copy first");
  const download = second.waitForEvent("download");
  await second.locator("#save-btn").click();
  const copy = await (await download).path();
  const reader = new ZipReader(
    new Uint8ArrayReader(new Uint8Array(readFileSync(copy))),
  );
  const names = (await reader.getEntries()).map((e) => e.filename);
  await reader.close();
  expect(names).toContain("mytour/actions/000001.json");
  await told.locator("button", { hasText: "Edit here anyway" }).click();
  await second.locator("#card textarea").fill("Then in place");
  await second.locator("#save-btn").click();
  await expect(second.locator("#save-status")).toHaveText(
    "Saved to wrapped.zip",
  );
  const texts = await readOpfsTour(second, "wrapped.zip");
  expect(texts["mytour/tour.json"]).toContain("Then in place");
  expect(Object.keys(texts)).toContain("mytour/actions/000001.json");
});

test("a write that fails keeps the changes and offers the download", async ({
  page,
}) => {
  // Why (E2b-1 review #10): the page's failed-write path, not only the
  // refusals the check makes.
  await noSavePicker(page);
  await page.goto("/edit.html");
  await offerOpfsFile(page, await wrappedTour({ pin: true }), "wrapped.zip");
  await page.evaluate(() => {
    // @ts-expect-error - the e2e's own picker, around the real handle.
    const real = window.showOpenFilePicker;
    // @ts-expect-error - the e2e's own picker.
    window.showOpenFilePicker = async () => {
      const [handle] = await real();
      return [
        {
          kind: "file",
          name: handle.name,
          getFile: () => handle.getFile(),
          requestPermission: () => Promise.resolve("granted"),
          createWritable: () =>
            Promise.resolve({
              write: () => Promise.reject(new Error("the disk is full")),
              close: () => Promise.resolve(),
              abort: () => Promise.resolve(),
            }),
        },
      ];
    };
  });
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-name")).toHaveText("Wrapped fixture");
  await page.locator("#rail .row", { hasText: "Wrapped pin" }).click();
  await page.locator("#card textarea").fill("Not written");
  await page.locator("#save-btn").click();
  const refusal = page.locator(".toast", { hasText: "the disk is full" });
  await expect(refusal).toBeVisible();
  const download = page.waitForEvent("download");
  await refusal.locator("button", { hasText: "Download instead" }).click();
  expect((await download).suggestedFilename()).toBe("wrapped.zip");
});

test("the same file opened again in the same tab is still saved in place", async ({
  page,
}) => {
  // Why (E2b-1 review #3): the new lock was asked before the old hold let
  // go, so the tab was told another tab was editing its own file.
  await page.goto("/edit.html");
  await offerOpfsFile(page, await wrappedTour({ pin: true }), "wrapped.zip");
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-name")).toHaveText("Wrapped fixture");
  await page.locator("#open-another").click();
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-name")).toHaveText("Wrapped fixture");
  await page.locator("#rail .row", { hasText: "Wrapped pin" }).click();
  await page.locator("#card textarea").fill("Opened twice");
  await page.locator("#save-btn").click();
  await expect(page.locator("#save-status")).toHaveText("Saved to wrapped.zip");
  await expect(
    page.locator(".toast", { hasText: "Another tab is editing" }),
  ).toHaveCount(0);
});

test("a group's count follows a delete while the search hides the deleted note", async ({
  page,
}) => {
  // Why (PR #613 review): with the same rows shown, the rail updated them
  // in place and left the group's count of ALL notes as it was.
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  const photos = page.locator('.group[data-kind="photo"] .count');
  await expect(photos).toHaveText("2");
  await page.locator("#rail .row", { hasText: "Too big" }).click();
  await page.locator("#filter").fill("Fountain");
  await page.locator("#card button", { hasText: "Delete" }).click();
  await expect(photos).toHaveText("1");
});

test("a refusal after a save was built still offers the download, and a later open of the file is this tab's", async ({
  page,
}) => {
  // Why (PR #614 review): a save that was built but not written leaves its
  // bytes with the page, so a later refusal can still download - it said
  // the edits could not be saved. And "Download instead" let the lock go
  // without waiting for it, so the same file opened again was told
  // another tab had it.
  await noSavePicker(page);
  await page.goto("/edit.html");
  await offerOpfsFile(page, await wrappedTour({ pin: true }), "wrapped.zip");
  await page.evaluate(() => {
    // @ts-expect-error - the e2e's own picker, around the real handle.
    const real = window.showOpenFilePicker;
    // @ts-expect-error - read by the test.
    window.__failWrites = true;
    // @ts-expect-error - the e2e's own picker.
    window.showOpenFilePicker = async () => {
      const [handle] = await real();
      return [
        {
          kind: "file",
          name: handle.name,
          getFile: () => handle.getFile(),
          requestPermission: () => Promise.resolve("granted"),
          createWritable: async () => {
            // @ts-expect-error - set above.
            if (window.__failWrites) {
              return {
                write: () => Promise.reject(new Error("the disk is full")),
                close: () => Promise.resolve(),
                abort: () => Promise.resolve(),
              };
            }
            return handle.createWritable();
          },
        },
      ];
    };
  });
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-name")).toHaveText("Wrapped fixture");
  await page.locator("#rail .row", { hasText: "Wrapped pin" }).click();
  await page.locator("#card textarea").fill("Built, not written");
  await page.locator("#save-btn").click();
  await expect(
    page.locator(".toast", { hasText: "the disk is full" }),
  ).toBeVisible();
  // Something else writes the file; the next Save is refused before it
  // builds - and the save built before is still there to download.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const w = await (await root.getFileHandle("wrapped.zip")).createWritable();
    await w.write("another program wrote this");
    await w.close();
  });
  await page.locator("#save-btn").click();
  const refusal = page.locator(".toast", { hasText: "changed on disk" });
  await expect(refusal).toBeVisible();
  await expect(refusal).not.toContainText("cannot be saved here");
  const download = page.waitForEvent("download");
  await refusal.locator("button", { hasText: "Download instead" }).click();
  expect((await download).suggestedFilename()).toBe("wrapped.zip");
  // The same file again, in this tab: no "another tab".
  await offerOpfsFile(page, await wrappedTour({ pin: true }), "wrapped.zip");
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await page.locator("#open-another").click();
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-name")).toHaveText("Wrapped fixture");
  await expect(page.locator("#keep-walk")).toBeHidden();
  await expect(
    page.locator(".toast", { hasText: "Another tab is editing" }),
  ).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// The editor's draft (M6 E2c): edits survive a closed tab.
//
// A page is reopened with `context.newPage()` in the SAME browser context
// (a new context has an empty origin-private file system), and every page
// is closed only after the draft says it is backed up (`data-draft` =
// `saved`): `page.close()` skips `beforeunload`, so nothing else waits for
// the draft's writes (E2c plan review #12).
// ---------------------------------------------------------------------------

/**
 * A second editor page in the same context, set up as `beforeEach` sets
 * up `page`: no open or save picker (the file input and the download
 * path), the map's tiles answered.
 * @param {import("@playwright/test").BrowserContext} context
 */
async function newEditorPage(context) {
  const next = await context.newPage();
  await next.addInitScript(() => {
    // @ts-expect-error - the e2e takes the pickers away on purpose.
    delete window.showOpenFilePicker;
    // @ts-expect-error - the e2e takes the pickers away on purpose.
    delete window.showSaveFilePicker;
  });
  await answerTiles(next);
  await next.goto("/edit.html");
  return next;
}

/** The draft's writes have all landed.
 * @param {import("@playwright/test").Page} page */
async function backedUp(page) {
  await expect(page.locator("body")).toHaveAttribute("data-draft", "saved");
}

/**
 * Edit the "Town hall" pin's text.
 * @param {import("@playwright/test").Page} page
 * @param {string} text
 */
async function editTownHall(page, text) {
  await page.locator("#rail .row", { hasText: "Town hall" }).click();
  const field = page.locator("#card textarea");
  await field.fill(text);
  await field.blur();
  await expect(page.locator("#card")).toContainText("Changed - not saved yet.");
}

/**
 * The picker hands out the origin-private file `name` as it is now.
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
async function offerExistingOpfsFile(page, name) {
  await page.evaluate(async (fileName) => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(fileName);
    // @ts-expect-error - the e2e's own picker.
    window.showOpenFilePicker = () => Promise.resolve([handle]);
  }, name);
}

test("edits survive a closed tab: the same file reopened offers them, and Restore brings them back", async ({
  page,
  context,
}) => {
  // Why (M6 E2c): a closed tab, a crash or a reload lost every edit not
  // yet saved; the draft keeps them in this browser and the next open of
  // the same file offers them - changes and deletions named apart.
  const buffer = await editorTour();
  await page.goto("/edit.html");
  await openThroughChooser(page, buffer, "editor-fixture.zip");
  await editTownHall(page, "Kept in the browser");
  await page.locator("#rail .row", { hasText: "Fountain" }).click();
  await page.locator("#card button", { hasText: "Delete" }).click();
  await expect(page.locator("#save-status")).toHaveText("2 changes not saved");
  await backedUp(page);
  await page.close();
  const next = await newEditorPage(context);
  await openThroughChooser(next, buffer, "editor-fixture.zip");
  const offer = next.locator(".toast.draft-offer");
  await expect(offer).toContainText("1 change and 1 deletion");
  // Until it is answered the tour is the file's.
  await expect(next.locator("#rail .row", { hasText: "Fountain" })).toHaveCount(
    1,
  );
  await offer.locator("button", { hasText: "Restore" }).click();
  await expect(offer).toHaveCount(0);
  await expect(
    next.locator("#rail .row", { hasText: "Kept in the browser" }),
  ).toHaveCount(1);
  await expect(next.locator("#rail .row", { hasText: "Fountain" })).toHaveCount(
    0,
  );
  await expect(next.locator("#save-status")).toHaveText("2 changes not saved");
});

test("Not now keeps the earlier edits for the next open, and Delete it throws them away", async ({
  page,
  context,
}) => {
  // Why (E2c plan review #7): declining is not deleting - a mis-tap must
  // not cost the work - and "Delete it" is the one way to drop it.
  const buffer = await editorTour();
  await page.goto("/edit.html");
  await openThroughChooser(page, buffer, "editor-fixture.zip");
  await editTownHall(page, "Asked about twice");
  await backedUp(page);
  await page.close();
  const second = await newEditorPage(context);
  await openThroughChooser(second, buffer, "editor-fixture.zip");
  await second
    .locator(".toast.draft-offer button", { hasText: "Not now" })
    .click();
  await backedUp(second);
  await second.close();
  const third = await newEditorPage(context);
  await openThroughChooser(third, buffer, "editor-fixture.zip");
  await third
    .locator(".toast.draft-offer button", { hasText: "Delete it" })
    .click();
  await backedUp(third);
  await third.close();
  const fourth = await newEditorPage(context);
  await openThroughChooser(fourth, buffer, "editor-fixture.zip");
  await expect(fourth.locator("#tour-name")).toHaveText("Editor fixture");
  await backedUp(fourth);
  await expect(fourth.locator(".toast.draft-offer")).toHaveCount(0);
});

test("a delivered download clears nothing: the original reopened still offers the edits", async ({
  page,
  context,
}) => {
  // Why (E2c plan review #2): "the download arrived" only means the
  // browser started it, and whether the copy is ever put in place is not
  // known - so the original file opened again still has its edits.
  await noSavePicker(page);
  const buffer = await editorTour();
  await page.goto("/edit.html");
  await openThroughChooser(page, buffer, "editor-fixture.zip");
  await editTownHall(page, "Downloaded once");
  const saved = await saveAndRead(page);
  expect(JSON.stringify(saved.manifest)).toContain("Downloaded once");
  await backedUp(page);
  await page.close();
  const next = await newEditorPage(context);
  await openThroughChooser(next, buffer, "editor-fixture.zip");
  await expect(next.locator(".toast.draft-offer")).toContainText("1 change");
});

test("a lean download of a recording tour: the original still offers, the lean copy opens without an offer", async ({
  page,
  context,
}) => {
  // Why (E2c plan review #5): the copy without the walk has another key
  // than the tour it came from, so the draft cannot follow a download -
  // it stays with the original.
  await noSavePicker(page);
  const original = await wrappedTour({ pin: true });
  await page.goto("/edit.html");
  await openThroughChooser(page, original, "wrapped.zip");
  await page.locator("#rail .row", { hasText: "Wrapped pin" }).click();
  await page.locator("#card textarea").fill("In the lean copy");
  await page.locator("#card textarea").blur();
  await expect(page.locator("#keep-walk-input")).not.toBeChecked();
  const download = page.waitForEvent("download");
  await page.locator("#save-btn").click();
  const lean = readFileSync(await (await download).path());
  await backedUp(page);
  await page.close();
  const leanPage = await newEditorPage(context);
  await openThroughChooser(leanPage, lean, "wrapped.zip");
  await expect(
    leanPage.locator("#rail .row", { hasText: "In the lean copy" }),
  ).toHaveCount(1);
  await backedUp(leanPage);
  await expect(leanPage.locator(".toast.draft-offer")).toHaveCount(0);
  await leanPage.close();
  const originalPage = await newEditorPage(context);
  await openThroughChooser(originalPage, original, "wrapped.zip");
  await expect(originalPage.locator(".toast.draft-offer")).toContainText(
    "1 change",
  );
});

test("a tour of notes alone saved in place and reopened keeps the edit made after the save", async ({
  page,
  context,
}) => {
  // Why (E2c plan review #5): such a tour's key changes with every save;
  // the draft follows the key of the bytes written, so the later edit is
  // found by the next open of the saved file.
  await page.goto("/edit.html");
  await offerOpfsFile(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-name")).toHaveText("Editor fixture");
  await editTownHall(page, "Saved in place");
  await page.locator("#save-btn").click();
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to editor-fixture.zip",
  );
  await page.locator("#rail .row", { hasText: "Fountain" }).click();
  await page.locator("#card button", { hasText: "Delete" }).click();
  await expect(page.locator("#save-status")).toHaveText("1 change not saved");
  await backedUp(page);
  await page.close();
  const next = await context.newPage();
  await answerTiles(next);
  await next.goto("/edit.html");
  await offerExistingOpfsFile(next, "editor-fixture.zip");
  await next.locator("#choose-btn").click();
  await expect(
    next.locator("#rail .row", { hasText: "Saved in place" }),
  ).toHaveCount(1);
  const offer = next.locator(".toast.draft-offer");
  await expect(offer).toContainText("1 deletion");
  await offer.locator("button", { hasText: "Restore" }).click();
  await expect(next.locator("#rail .row", { hasText: "Fountain" })).toHaveCount(
    0,
  );
});

test("the changed-on-disk refusal points to the browser's copy, and the file opened again offers the edits", async ({
  page,
}) => {
  // Why (E2b-1's named gap, E2c plan review #9): another program wrote the
  // file before the first save, so the page cannot rebuild - the draft
  // still holds the edits, and a tour built on a walk recording keeps its
  // key through that write, so opening it again offers them.
  await page.goto("/edit.html");
  await offerOpfsFile(page, await wrappedTour({ pin: true }), "wrapped.zip");
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-name")).toHaveText("Wrapped fixture");
  await page.locator("#rail .row", { hasText: "Wrapped pin" }).click();
  await page.locator("#card textarea").fill("Before the other program");
  await page.locator("#card textarea").blur();
  await backedUp(page);
  const elsewhere = await wrappedTour({ pin: true, extra: true });
  await page.evaluate(async (b64) => {
    const root = await navigator.storage.getDirectory();
    const w = await (await root.getFileHandle("wrapped.zip")).createWritable();
    await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    await w.close();
  }, elsewhere.toString("base64"));
  await page.locator("#save-btn").click();
  await expect(
    page.locator(".toast", { hasText: "this browser keeps a copy of them" }),
  ).toBeVisible();
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await page.locator("#open-another").click();
  await page.locator("#choose-btn").click();
  await expect(
    page.locator("#rail .row", { hasText: "Added elsewhere" }),
  ).toHaveCount(1);
  const offer = page.locator(".toast.draft-offer");
  await expect(offer).toContainText("1 change");
  await offer.locator("button", { hasText: "Restore" }).click();
  await expect(
    page.locator("#rail .row", { hasText: "Before the other program" }),
  ).toHaveCount(1);
  await expect(
    page.locator("#rail .row", { hasText: "Added elsewhere" }),
  ).toHaveCount(1);
});

test("a phone's draft and the editor's for one tour file stay apart", async ({
  page,
  context,
}) => {
  // Why (E2c plan review #3): the phone keys a file-opened tour by the
  // same file key; sharing one namespace, each page's sweeps would take
  // the other's records. The editor's namespace is its own.
  const buffer = await editorTour();
  await page.goto("/edit.html");
  await openThroughChooser(page, buffer, "editor-fixture.zip");
  await editTownHall(page, "The editor's text");
  await backedUp(page);
  // The phone's draft for the same file: its namespace is the editor's
  // without the "editor:" prefix.
  const phoneDir = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const drafts = await root.getDirectoryHandle("drafts");
    /** @type {string[]} */
    const names = [];
    // @ts-expect-error - the async iterator is not in every DOM typing.
    for await (const name of drafts.keys()) names.push(name);
    const mine = names.find((n) => decodeURIComponent(n).startsWith("editor:"));
    if (mine === undefined) throw new Error(`no editor draft in ${names}`);
    const phone = encodeURIComponent(
      decodeURIComponent(mine).slice("editor:".length),
    );
    const dir = await drafts.getDirectoryHandle(phone, { create: true });
    /** @param {string} key @param {string} text */
    const put = async (key, text) => {
      const h = await dir.getFileHandle(`${encodeURIComponent(key)}.blob`, {
        create: true,
      });
      const w = await h.createWritable();
      await w.write(text);
      await w.close();
    };
    await put(
      "meta",
      JSON.stringify({ tourUrl: "phone", sizeM: 0.16, level: null }),
    );
    await put(
      "object:pin-markup",
      JSON.stringify({
        id: "pin-markup",
        kind: "pin",
        label: "The phone's text",
        createdAtIso: "2026-10-13T00:00:00.000Z",
        geo: { lat: 48.5204, lon: 9.0537, alt: 340, headingDeg: 0 },
      }),
    );
    return phone;
  });
  await page.close();
  const next = await newEditorPage(context);
  await openThroughChooser(next, buffer, "editor-fixture.zip");
  const offer = next.locator(".toast.draft-offer");
  await expect(offer).toContainText("1 change");
  await offer.locator("button", { hasText: "Delete it" }).click();
  await backedUp(next);
  // The phone's records are untouched by the editor's open and delete.
  const phoneKeys = await next.evaluate(async (dirName) => {
    const root = await navigator.storage.getDirectory();
    const dir = await (
      await root.getDirectoryHandle("drafts")
    ).getDirectoryHandle(dirName);
    /** @type {string[]} */
    const names = [];
    // @ts-expect-error - the async iterator is not in every DOM typing.
    for await (const name of dir.keys()) names.push(decodeURIComponent(name));
    return names.sort();
  }, phoneDir);
  expect(phoneKeys).toEqual(["meta.blob", "object:pin-markup.blob"]);
});

test("a second tab on the same tour keeps no backup and says so", async ({
  page,
  context,
}) => {
  // Why (E2c plan review #6): two tabs writing one draft would each sweep
  // the other's records; only the tab holding the draft writes it.
  const buffer = await editorTour();
  await page.goto("/edit.html");
  await openThroughChooser(page, buffer, "editor-fixture.zip");
  await backedUp(page);
  const second = await newEditorPage(context);
  await openThroughChooser(second, buffer, "editor-fixture.zip");
  await expect(
    second.locator(".toast", { hasText: "keeps no backup copy" }),
  ).toBeVisible();
  await expect(second.locator("body")).toHaveAttribute("data-draft", "off");
  // The first tab still backs up.
  await editTownHall(page, "The first tab's edit");
  await backedUp(page);
});

test("a refused in-place write keeps the edits in the browser for the next open", async ({
  page,
  context,
}) => {
  // Why (E2c): a write that fails leaves the edits only on this page;
  // closed now, they come back from the draft.
  const buffer = await wrappedTour({ pin: true });
  await noSavePicker(page);
  await page.goto("/edit.html");
  await offerOpfsFile(page, buffer, "wrapped.zip");
  await page.evaluate(() => {
    // @ts-expect-error - the e2e's own picker, around the real handle.
    const real = window.showOpenFilePicker;
    // @ts-expect-error - the e2e's own picker.
    window.showOpenFilePicker = async () => {
      const [handle] = await real();
      return [
        {
          kind: "file",
          name: handle.name,
          getFile: () => handle.getFile(),
          requestPermission: () => Promise.resolve("granted"),
          createWritable: () =>
            Promise.resolve({
              write: () => Promise.reject(new Error("the disk is full")),
              close: () => Promise.resolve(),
              abort: () => Promise.resolve(),
            }),
        },
      ];
    };
  });
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-name")).toHaveText("Wrapped fixture");
  await page.locator("#rail .row", { hasText: "Wrapped pin" }).click();
  await page.locator("#card textarea").fill("Not written, still kept");
  await page.locator("#save-btn").click();
  await expect(
    page.locator(".toast", { hasText: "the disk is full" }),
  ).toBeVisible();
  await backedUp(page);
  await page.close();
  const next = await newEditorPage(context);
  await openThroughChooser(next, buffer, "wrapped.zip");
  const offer = next.locator(".toast.draft-offer");
  await expect(offer).toContainText("1 change");
  await offer.locator("button", { hasText: "Restore" }).click();
  await expect(
    next.locator("#rail .row", { hasText: "Not written, still kept" }),
  ).toHaveCount(1);
});

test("an undo of a delete of an edited note keeps the edit for the next open", async ({
  page,
  context,
}) => {
  // Why (E2c plan review #11): the delete removed the edited record from
  // the draft; its undo must write it again, or the edit is on screen and
  // gone from the browser's copy.
  const buffer = await editorTour();
  await page.goto("/edit.html");
  await openThroughChooser(page, buffer, "editor-fixture.zip");
  await editTownHall(page, "Edited, deleted, undone");
  await page.locator("#card button", { hasText: "Delete" }).click();
  await page.locator(".toast button", { hasText: "Undo" }).click();
  await expect(
    page.locator("#rail .row", { hasText: "Edited, deleted, undone" }),
  ).toHaveCount(1);
  await backedUp(page);
  await page.close();
  const next = await newEditorPage(context);
  await openThroughChooser(next, buffer, "editor-fixture.zip");
  const offer = next.locator(".toast.draft-offer");
  await expect(offer).toContainText("1 change");
  await expect(offer).not.toContainText("deletion");
  await offer.locator("button", { hasText: "Restore" }).click();
  await expect(
    next.locator("#rail .row", { hasText: "Edited, deleted, undone" }),
  ).toHaveCount(1);
});
