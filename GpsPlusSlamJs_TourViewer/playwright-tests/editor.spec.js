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

import { worldManifest } from "./ar-fakes.js";
import { inOwnStation, stationAt } from "./v3-fixture.mjs";

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

/**
 * @param {{ station?: boolean, farStation?: boolean }} [options] - a story
 *   station at the first code; two more stations, one far from every code
 */
async function editorTour({ station = false, farStation = false } = {}) {
  const codes = [];
  for (const [i, place] of [geo(0, 0), geo(30, 40)].entries()) {
    const id = await qrCodeId(
      `https://gps.csutil.com/tour/?qr=editor&n=${i + 1}`,
    );
    codes.push({
      path: `qr/${id}.json`,
      data: JSON.stringify({
        version: 1,
        qr: { physicalSizeM: 0.2, geo: { ...place, headingDeg: 90 } },
      }),
    });
  }
  // Through the serializer (version 3: stations at geo poses, the pins
  // and photos as their items, tour editor plan W3).
  const manifest = {
    ...createEmptyTourManifest(),
    title: "Editor fixture",
    // A story station at the first code's point (PR #609 review).
    stations: [
      ...(station
        ? [
            {
              id: "gate",
              title: "At the gate",
              // At the first code's point (version 3 has no code link,
              // tour editor plan D9).
              geo: { ...geo(0, 0), headingDeg: 0 },
              activateRadiusM: 30,
              foundRadiusM: 5,
              hint: "arrow",
              steps: [{ id: "hi", block: { kind: "text", text: "Hello" } }],
              items: [],
            },
          ]
        : []),
      // Two more stations (tour editor plan review 2 #3): one named, 98 m
      // from the nearest code, and one the rail calls by its number, 7 m
      // from the first code.
      ...(farStation
        ? [
            {
              id: "well",
              title: "Old well",
              geo: { ...geo(120, 0), headingDeg: 0 },
              activateRadiusM: 30,
              foundRadiusM: 5,
              hint: "arrow",
              steps: [{ id: "w", block: { kind: "text", text: "A well" } }],
              items: [],
            },
            {
              id: "bench",
              geo: { ...geo(-5, 5), headingDeg: 0 },
              activateRadiusM: 30,
              foundRadiusM: 5,
              hint: "arrow",
              steps: [{ id: "b", block: { kind: "text", text: "A bench" } }],
              items: [],
            },
          ]
        : []),
      ...[
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
      ].map(inOwnStation),
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
  // Version 3 has no loose pins (tour editor plan W3): the fixture's three
  // notes each sit in a station of their own, and the count, the rail and
  // the map say so (every station is listed, the automatic ones included).
  await expect(page.locator(".toast")).toHaveText(
    "Opened editor-fixture.zip: 2 codes, 3 notes, 3 stations",
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
    "Station 1",
    "Station 2",
    "Station 3",
  ]);
  await expect(page.locator(".mk-wrap")).toHaveCount(8);
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

/** A tour in the wrapped shape ("compress this folder") carrying a walk
 *  recording, and a code with no stored position. By default its
 *  `tour.json` also carries a debug camera capture of the walk's frame in
 *  a station of its own (`captureSpots`, as an earlier app wrote it),
 *  which the editor drops at the open. */
/** @param {{ pin: boolean, extra?: boolean, spots?: boolean }} options -
 *  `extra`: a second pin, as another program's edit of the same tour would
 *  add; `spots: false`: no capture spots and no station for them */
async function wrappedTour(options = { pin: false }) {
  const id = await qrCodeId("https://gps.csutil.com/tour/?qr=wrapped");
  const manifest = {
    ...createEmptyTourManifest(),
    title: "Wrapped fixture",
    stations: [
      ...(options.spots === false ? [] : [stationAt("walk", geo(5, 5))]),
      ...(options.pin
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
          ].map(inOwnStation)
        : []),
    ],
    ...(options.spots === false
      ? {}
      : {
          captureSpots: {
            fixes: 3,
            gpsAccuracyMedianM: 4,
            captures: [
              {
                image: "mytour/images/frame-000002.png",
                station: "walk",
                pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
              },
            ],
          },
        }),
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

test("lists no debug camera capture of a wrapped zip, and shows a code without a position in a card of its own", async ({
  page,
}) => {
  // Why (E1 review #3; M1 of the debug-captures plan): a code without a
  // position got an "off the map view" chip whose "Show it" could do
  // nothing. Changed expectation: this test also opened the walk's frame
  // as a "Recorded photo" row (E1 review #1, its path read under the
  // tour's folder). The frames are debug data now: no row, no card, and
  // no station for the one only the capture kept.
  await page.goto("/edit.html");
  await openThroughChooser(page, await wrappedTour(), "wrapped.zip");
  await expect(
    page.locator("#rail .row", { hasText: "The code" }),
  ).toBeVisible();
  await expect(
    page.locator("#rail .row", { hasText: "Recorded photo" }),
  ).toHaveCount(0);
  await expect(page.locator(".mk-station")).toHaveCount(0);
  await page.locator("#rail .row", { hasText: "The code" }).click();
  await expect(page.locator("#card")).toContainText("no position stored yet");
  await expect(page.locator("#offscreen-chip")).toBeHidden();
});

test("shows a walk's camera captures as debug data: a thumbnail each, out of reach of the pointer and the keyboard, behind a switch", async ({
  page,
}) => {
  // Why (M1 of the debug-captures plan): the frames a recording captured
  // by itself are debug data. The desktop editor shows them, after the
  // open, as small thumbnails a creator can look at but never select,
  // move, tab to or save: no row, no card, no tabindex, no pointer
  // events, no tooltip, nothing pending. The switch hides and shows them.
  const recording = Buffer.from(
    await (
      await fetch("http://127.0.0.1:5197/ranges-ok/recording-tour.zip")
    ).arrayBuffer(),
  );
  await page.goto("/edit.html");
  await openThroughChooser(page, recording, "recording.zip");
  await expect(page.locator("#debug-panel")).toBeVisible();
  await expect(page.locator("#debug-data-input")).toBeChecked();
  await expect(page.locator("#debug-status")).toHaveText(
    "Debug data: 2 camera captures on the map.",
  );
  const markers = page.locator(".mk-debug-wrap");
  await expect(markers).toHaveCount(2);
  await expect(page.locator(".mk-debug canvas")).toHaveCount(2);
  await expect(page.locator(".mk-debug-wrap[tabindex]")).toHaveCount(0);
  await expect(page.locator(".mk-debug-wrap.leaflet-interactive")).toHaveCount(
    0,
  );
  await expect(page.locator(".mk-debug-wrap[title]")).toHaveCount(0);
  await expect(page.locator(".leaflet-tooltip")).toHaveCount(0);
  expect(
    await markers
      .first()
      .evaluate((el) => getComputedStyle(el.parentElement ?? el).pointerEvents),
  ).toBe("none");
  // Not the tour's content: the rail lists the code only.
  await expect(page.locator("#rail .row")).toHaveCount(1);
  await page.locator("#debug-data-input").uncheck();
  await expect(markers).toHaveCount(0);
  await page.locator("#debug-data-input").check();
  await expect(markers).toHaveCount(2);
  await expect(page.locator("#save-status")).toHaveText("No changes");
});

test("says why a walk shows no debug data, and shows no switch for a tour without a walk", async ({
  page,
}) => {
  // Why (the async-UI rule): the debug layer's work ends in a final state
  // the creator can read - here a walk whose stream places nothing. A
  // tour without a walk has no debug data and no switch for it.
  await page.goto("/edit.html");
  await openThroughChooser(page, await wrappedTour(), "wrapped.zip");
  await expect(page.locator("#debug-panel")).toBeVisible();
  await expect(page.locator("#debug-status")).toContainText(
    "No debug data shown: ",
  );
  await expect(page.locator(".mk-debug-wrap")).toHaveCount(0);
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await page.locator("#open-another").click();
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await expect(page.locator("#tour-name")).not.toHaveText("Wrapped fixture");
  await expect(page.locator("#debug-panel")).toBeHidden();
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
    manifest:
      texts["tour.json"] === undefined ? {} : worldManifest(texts["tour.json"]),
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
  // The gate is the first station; the fixture's notes each sit in a
  // station of their own (version 3 has no loose pins, plan W3).
  await page.locator(".mk-station", { hasText: /^1$/ }).click();
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
 * Autosave (M6 E2b-2) moved out of the way: a walk that times its own saves
 * of an in-place file - an edit left committed while something else
 * happens to the file, a delete kept past its save - would race it.
 * The page reads `window.__tourEditorAutosave` in the dev server only.
 * @param {import("@playwright/test").Page} page
 */
async function autosaveOutOfTheWay(page) {
  await page.addInitScript(() => {
    // @ts-expect-error - the editor's dev-only autosave timings.
    window.__tourEditorAutosave = { delayMs: 3_600_000, maxWaitMs: 3_600_000 };
  });
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
  expect(Object.keys(texts)).toContain("mytour/images/frame-000002.png");
  // Changed expectation: this test once opened the walk's frame as a
  // "Recorded photo" read from the written file. The frames are debug
  // data now, so the write carries no capture spots, and the frame stays
  // only as part of the walk.
  expect(texts["mytour/tour.json"]).not.toContain("captureSpots");
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
  // Refused before the build: the change is still pending, and the
  // refusal pauses autosave (E2b-2) so it never retries into theirs.
  await expect(page.locator("#save-status")).toHaveText(
    "1 change not saved - not saved by itself until you Save",
  );
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
  // The listener is in place BEFORE the press, and reads the S key's own
  // keydown: an evaluate not awaited installed it while the press ran -
  // early enough it caught the Control keydown (never prevented), late
  // enough it caught nothing and timed out (2026-10-17, under load); it
  // passed only between the two.
  await page.evaluate(() => {
    window.addEventListener("keydown", (event) => {
      if (event.key.toLowerCase() !== "s") return;
      // @ts-expect-error - read back below.
      window.__savePrevented = event.defaultPrevented;
    });
  });
  await page.keyboard.press("Control+s");
  // @ts-expect-error - set by the listener above.
  expect(await page.evaluate(() => window.__savePrevented)).toBe(true);
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

test("a download of a tour that carries a walk keeps it by default, and leaves it out only when the switch is unticked", async ({
  page,
  context,
}) => {
  // Why (M1 of the debug-captures plan): until the walk can be saved apart
  // from the tour, a lean copy would be the only one a creator may keep,
  // without the walk - so the switch starts ticked whenever the file
  // carries one, and only an untick leaves it out, which the toast says.
  // The switch hides after a save, so the untick is tried on a second open
  // of the same tour. Changed expectation: the switch was ticked only when
  // the recorded photos could not be placed, and the toasts spoke of them.
  const tour = await wrappedTour({ pin: true });
  await noSavePicker(page);
  await page.goto("/edit.html");
  await openThroughChooser(page, tour, "wrapped.zip");
  await expect(page.locator("#keep-walk")).toBeVisible();
  await expect(page.locator("#keep-walk-input")).toBeChecked();
  await editPin(page, "Wrapped pin", "Kept by default");
  const kept = page.waitForEvent("download");
  await page.locator("#save-btn").click();
  const keptNames = await downloadedNames(await kept);
  expect(keptNames).toContain("mytour/tour.json");
  expect(keptNames).toContain("mytour/actions/000001.json");
  expect(keptNames).toContain("mytour/session.json");
  expect(keptNames).toContain("mytour/images/frame-000002.png");
  await expect(
    page.locator(".toast", { hasText: "leaves out the walk recording" }),
  ).toHaveCount(0);
  await page.close();
  const next = await newEditorPage(context);
  await openThroughChooser(next, tour, "wrapped.zip");
  // Ticked again on the second open; uncheck() would not wait for it (it
  // returns at once on a box that is still unchecked).
  await expect(next.locator("#keep-walk-input")).toBeChecked();
  await next.locator("#keep-walk-input").uncheck();
  await editPin(next, "Wrapped pin", "Lean on request");
  const lean = next.waitForEvent("download");
  await next.locator("#save-btn").click();
  const leanNames = await downloadedNames(await lean);
  expect(leanNames).not.toContain("mytour/actions/000001.json");
  expect(leanNames).not.toContain("mytour/session.json");
  expect(leanNames).not.toContain("mytour/images/frame-000002.png");
  await expect(
    next.locator(".toast", { hasText: "leaves out the walk recording" }),
  ).toHaveCount(1);
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
  // Ticked by default for a file carrying a walk (M1 of the debug-captures
  // plan); this copy is lean on request.
  await expect(page.locator("#keep-walk-input")).toBeChecked();
  await page.locator("#keep-walk-input").uncheck();
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
  await autosaveOutOfTheWay(page);
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
  await autosaveOutOfTheWay(page);
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
  // Save cannot work here, so the status must not send the creator to it
  // (E2b-2 milestone review #8): it says what the toast says.
  await expect(page.locator("#save-status")).toHaveText(
    "1 change not saved - it cannot be saved here: open the file again",
  );
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

test("a moved photo note survives a closed tab", async ({ page, context }) => {
  // Why (E2c milestone review #1, confirmed data loss): a photo note's
  // edit carries no bytes - they are in the opened file - and the read
  // dropped a photo record without its bytes, so the move was lost.
  await page.setViewportSize({ width: 1280, height: 800 });
  const buffer = await editorTour();
  await page.goto("/edit.html");
  await openThroughChooser(page, buffer, "editor-fixture.zip");
  await page.locator("#rail .row", { hasText: "Fountain" }).click();
  await page.locator("#card button", { hasText: "Move" }).click();
  const marker = await box(page.locator(".mk-wrap.sel"));
  await page.mouse.move(marker.x + marker.width / 2, marker.y + 10);
  await page.mouse.down();
  await page.mouse.move(marker.x + marker.width / 2 + 60, marker.y + 70, {
    steps: 8,
  });
  await page.mouse.up();
  await page.locator("#card button", { hasText: "Done" }).click();
  await expect(page.locator("#save-status")).toHaveText("1 change not saved");
  await backedUp(page);
  await page.close();
  const next = await newEditorPage(context);
  await openThroughChooser(next, buffer, "editor-fixture.zip");
  const offer = next.locator(".toast.draft-offer");
  await expect(offer).toContainText("1 change");
  await offer.locator("button", { hasText: "Restore" }).click();
  await expect(next.locator("#save-status")).toHaveText("1 change not saved");
});

test("an edit after a download, with the downloaded copy put in place, is offered by that copy", async ({
  page,
  context,
}) => {
  // Why (E2c milestone review #4): each build adds its versions to the
  // draft's `written` list. Without it the copy's own version of the note
  // is one this browser never SAW in a file, so the later edit reads as
  // "replaced by a newer one" and is dropped. A recording tour whose walk
  // is kept has the same key in the copy as in the original.
  await noSavePicker(page);
  await page.goto("/edit.html");
  await openThroughChooser(
    page,
    await wrappedTour({ pin: true }),
    "wrapped.zip",
  );
  // Changed expectation: the creator ticked the switch here; it starts
  // ticked now for a file carrying a walk (M1 of the debug-captures plan).
  // Asserted, not check()ed: check() reads the box before the open has
  // ticked it and then clicks it off again.
  await expect(page.locator("#keep-walk-input")).toBeChecked();
  await page.locator("#rail .row", { hasText: "Wrapped pin" }).click();
  await page.locator("#card textarea").fill("In the download");
  await page.locator("#card textarea").blur();
  const download = page.waitForEvent("download");
  await page.locator("#save-btn").click();
  const copy = readFileSync(await (await download).path());
  await page.locator("#rail .row", { hasText: "In the download" }).click();
  await page.locator("#card textarea").fill("After the download");
  await page.locator("#card textarea").blur();
  await expect(page.locator("#save-status")).toHaveText("1 change not saved");
  await backedUp(page);
  await page.close();
  const next = await newEditorPage(context);
  await openThroughChooser(next, copy, "wrapped.zip");
  await expect(
    next.locator("#rail .row", { hasText: "In the download" }),
  ).toHaveCount(1);
  const offer = next.locator(".toast.draft-offer");
  await expect(offer).toContainText("1 change");
  await expect(
    next.locator(".toast", { hasText: "replaced by a newer one" }),
  ).toHaveCount(0);
  await offer.locator("button", { hasText: "Restore" }).click();
  await expect(
    next.locator("#rail .row", { hasText: "After the download" }),
  ).toHaveCount(1);
});

// ---------------------------------------------------------------------------
// The editor saves by itself (M6 E2b-2): a few seconds after a committed
// change, while the tour is written in place. These run on Playwright's
// clock (`install` keeps it running; `runFor` moves it on), against the
// module's own delays; `body[data-autosave]` is the scheduler's state.
// ---------------------------------------------------------------------------

/**
 * The origin-private tour file, offered by a picker whose handle counts its
 * writes (`window.__writes`), holds each one while `window.__holdWrites` is
 * set until `window.__release()`, and then fails it while
 * `window.__failWrites` is set.
 * @param {import("@playwright/test").Page} page
 * @param {Buffer} buffer
 * @param {string} name
 */
async function offerCountedOpfsFile(page, buffer, name) {
  await offerOpfsFile(page, buffer, name);
  await page.evaluate(() => {
    // @ts-expect-error - the e2e's own picker, around the real handle.
    const real = window.showOpenFilePicker;
    // @ts-expect-error - read by the test.
    window.__writes = 0;
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
            window.__writes += 1;
            // @ts-expect-error - set by the test.
            if (window.__holdWrites) {
              await new Promise((resolve) => {
                // @ts-expect-error - called by the test.
                window.__release = resolve;
              });
            }
            // @ts-expect-error - set by the test.
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
}

/**
 * Edit the pin whose row shows `from`.
 * @param {import("@playwright/test").Page} page
 * @param {string} from
 * @param {string} text
 */
async function editPin(page, from, text) {
  await page.locator("#rail .row", { hasText: from }).click();
  const field = page.locator("#card textarea");
  await field.fill(text);
  await field.blur();
  await expect(page.locator("#card")).toContainText("Changed - not saved yet.");
}

/** @param {import("@playwright/test").Page} page */
function writes(page) {
  // @ts-expect-error - counted by the picker above.
  return page.evaluate(() => window.__writes);
}

test("saves by itself a few seconds after a change, quietly, and the next open finds no leftover draft", async ({
  page,
  context,
}) => {
  // Why (M6 E2b-2, owner Q-E2-4): a creator should not lose work for
  // forgetting Save. The autosave says so in the status line only - a
  // toast per save would be noise - and an autosave that lands is an
  // in-place write, so the draft clears what it carried (E2c's `landed`).
  await page.clock.install();
  await page.goto("/edit.html");
  await offerOpfsFile(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#choose-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "idle");
  await editTownHall(page, "Saved by itself");
  await expect(page.locator("body")).toHaveAttribute(
    "data-autosave",
    "waiting",
  );
  await page.clock.runFor(3_500);
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to editor-fixture.zip",
  );
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "idle");
  const texts = await readOpfsTour(page, "editor-fixture.zip");
  expect(texts["tour.json"]).toContain("Saved by itself");
  await expect(page.locator(".toast", { hasText: "Saved to" })).toHaveCount(0);
  await backedUp(page);
  await page.close();
  const next = await context.newPage();
  await answerTiles(next);
  await next.goto("/edit.html");
  await offerExistingOpfsFile(next, "editor-fixture.zip");
  await next.locator("#choose-btn").click();
  await expect(
    next.locator("#rail .row", { hasText: "Saved by itself" }),
  ).toHaveCount(1);
  await backedUp(next);
  await expect(next.locator(".toast.draft-offer")).toHaveCount(0);
});

test("a delete is not written while its Undo is offered, and Ctrl+Z still brings the photo back after the save", async ({
  page,
}) => {
  // Why (M4a review #2): without the hold, a delete reached the file 3 s
  // later, and an undo after that save did not survive a closed tab (the
  // draft places nothing new). So autosave waits out the toast's 8 s
  // again; after it, the edit stack's Ctrl+Z still brings the photo back -
  // its picture too, which the saved file no longer carries - and, since
  // the undo crosses that in-place save, writes the file again at once
  // (D33).
  await page.clock.install();
  await page.goto("/edit.html");
  await offerOpfsFile(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#choose-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "idle");
  await page.locator("#rail .row", { hasText: "Fountain" }).click();
  await page.locator("#card button", { hasText: "Delete" }).click();
  await expect(page.locator("#save-status")).toHaveText("1 change not saved");
  // Past the delay, inside the 8 s window: due, and held.
  await page.clock.runFor(4_000);
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "held");
  expect(
    (await readOpfsTour(page, "editor-fixture.zip"))["tour.json"],
  ).toContain("photo-ok");
  await expect(
    page.locator(".toast button", { hasText: "Undo" }),
  ).toBeVisible();
  // The window closes: the delete is saved by itself.
  await page.clock.runFor(5_000);
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to editor-fixture.zip",
  );
  const without = await readOpfsTour(page, "editor-fixture.zip");
  expect(without["tour.json"]).not.toContain("photo-ok");
  expect(Object.keys(without)).not.toContain("content/photo-ok.png");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".toast").last()).toHaveText(
    'Undone: the delete of "Fountain".',
  );
  await expect(page.locator("#rail .row", { hasText: "Fountain" })).toHaveCount(
    1,
  );
  // No clock moved: the write is the undo's own, not the autosave's.
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to editor-fixture.zip",
  );
  // Its card shows the picture the session kept.
  await page.locator("#rail .row", { hasText: "Fountain" }).click();
  await expect(page.locator("#card img.card-photo")).toBeVisible();
  await page.keyboard.press("Escape");
  const back = await readOpfsTour(page, "editor-fixture.zip");
  expect(back["tour.json"]).toContain("photo-ok");
  expect(Object.keys(back)).toContain("content/photo-ok.png");
});

/**
 * The Fountain photo deleted and saved in place with Save (autosave out of
 * the way), through the counting picker: one write, the file without it.
 * @param {import("@playwright/test").Page} page
 * @param {{ clock?: boolean, largeTour?: boolean, noSavePicker?: boolean }} [options]
 *   - `clock`: Playwright's clock installed (the resave's quiet time is
 *     then moved on with `runFor`); `largeTour`: the size cap lowered so
 *     the fixture counts as large (autosave off); `noSavePicker`: a
 *     download takes the `<a download>` path, which Playwright sees
 */
async function fountainDeletedInPlace(page, options = {}) {
  if (options.largeTour === true) {
    await page.addInitScript(() => {
      // @ts-expect-error - the editor's dev-only autosave cap.
      window.__tourEditorAutosave = { maxBytes: 1 };
    });
  } else {
    await autosaveOutOfTheWay(page);
  }
  if (options.noSavePicker === true) await noSavePicker(page);
  if (options.clock === true) await page.clock.install();
  await page.goto("/edit.html");
  await offerCountedOpfsFile(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-name")).toHaveText("Editor fixture");
  await page.locator("#rail .row", { hasText: "Fountain" }).click();
  await page.locator("#card button", { hasText: "Delete" }).click();
  await page.locator("#save-btn").click();
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to editor-fixture.zip",
  );
  expect(await writes(page)).toBe(1);
  expect(
    (await readOpfsTour(page, "editor-fixture.zip"))["tour.json"],
  ).not.toContain("photo-ok");
}

test("an undo across an in-place save writes the file again at once, and a reload keeps the note (D33)", async ({
  page,
  context,
}) => {
  // Why (D33): the open drops every draft record of an id the file on disk
  // lacks, so a delete saved in place and then undone was lost on a reload
  // made before the next save. The undo now writes the file in place at
  // once - "Saving…" while it writes, then "Saved to" - so the disk holds
  // what the editor shows.
  await fountainDeletedInPlace(page);
  await page.evaluate(() => {
    // @ts-expect-error - read by the picker.
    window.__holdWrites = true;
  });
  await page.keyboard.press("Control+z");
  await expect(page.locator(".toast").last()).toHaveText(
    'Undone: the delete of "Fountain".',
  );
  await expect(page.locator("#save-status")).toHaveText("Saving…");
  await expect(page.locator("#save-btn")).toBeDisabled();
  await expect.poll(() => writes(page)).toBe(2);
  await page.evaluate(() => {
    // @ts-expect-error - set by the picker.
    window.__release();
  });
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to editor-fixture.zip",
  );
  await expect(page.locator("#save-btn")).toBeEnabled();
  const back = await readOpfsTour(page, "editor-fixture.zip");
  expect(back["tour.json"]).toContain("photo-ok");
  expect(Object.keys(back)).toContain("content/photo-ok.png");
  await backedUp(page);
  await page.close();
  const next = await context.newPage();
  await answerTiles(next);
  await next.goto("/edit.html");
  await offerExistingOpfsFile(next, "editor-fixture.zip");
  await next.locator("#choose-btn").click();
  await expect(next.locator("#rail .row", { hasText: "Fountain" })).toHaveCount(
    1,
  );
  await backedUp(next);
  await expect(next.locator(".toast.draft-offer")).toHaveCount(0);
});

test("an undo across an in-place save whose write fails says why after the undo, and keeps the change", async ({
  page,
}) => {
  // Why (D33, the async-feedback rule): the resave's failure (the file
  // moved, the permission lapsed, the disk refused) reaches the creator
  // through the in-place refusal, after the undo's own toast; the status
  // line leaves "Saving…" and says the change is not saved.
  await fountainDeletedInPlace(page);
  await page.evaluate(() => {
    // @ts-expect-error - read by the picker.
    window.__failWrites = true;
  });
  await page.keyboard.press("Control+z");
  await expect(page.locator(".toast").last()).toContainText(
    "Not saved to editor-fixture.zip. It could not be written: the disk is full.",
  );
  await expect(
    page.locator(".toast", { hasText: 'Undone: the delete of "Fountain".' }),
  ).toBeVisible();
  expect(await writes(page)).toBe(2);
  // The save was built and not delivered: the status line's own words for
  // that, as for any failed in-place write.
  await expect(page.locator("#save-status")).toHaveText(
    "Not saved yet - tap Save again",
  );
  await expect(page.locator("#save-status")).toHaveAttribute(
    "data-state",
    "error",
  );
  await expect(page.locator("#save-btn")).toBeEnabled();
  await expect(page.locator("#rail .row", { hasText: "Fountain" })).toHaveCount(
    1,
  );
  // Save again delivers it once the disk takes it.
  await page.evaluate(() => {
    // @ts-expect-error - read by the picker.
    window.__failWrites = false;
  });
  await page.locator("#save-btn").click();
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to editor-fixture.zip",
  );
  expect(
    (await readOpfsTour(page, "editor-fixture.zip"))["tour.json"],
  ).toContain("photo-ok");
});

test("an undo of an edit made after the in-place save writes nothing, also once the quiet time passed", async ({
  page,
}) => {
  // Why (D33's rule): only a step across the in-place file writes it. Two
  // edits after the save, the newer undone: the document is still a step
  // away from the file, so nothing crosses - the change waits for the
  // autosave like any other. Read after the resave's quiet time, so a rule
  // that over-fired would have written by then.
  await fountainDeletedInPlace(page, { clock: true });
  await editTownHall(page, "After the save");
  await editPin(page, "After the save", "And again");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".toast").last()).toHaveText(
    'Undone: the text of "And again".',
  );
  await page.clock.runFor(2_000);
  await expect(page.locator("#save-status")).toHaveText("1 change not saved");
  expect(await writes(page)).toBe(1);
});

test("three quick undos across an in-place save make one write, with no refusal", async ({
  page,
}) => {
  // Why (D33, coalesced): autosave writes a few seconds after each change,
  // so nearly every undo starts at the file and crosses it. Written at once,
  // each undo rebuilt and rewrote the whole file, and the next undo was
  // refused while it rebuilt. The resave waits for a short quiet time after
  // the LAST step, so a run of undos is one write of where they ended.
  await fountainDeletedInPlace(page, { clock: true });
  await editTownHall(page, "One");
  await editPin(page, "One", "Two");
  await page.keyboard.press("Escape");
  await page.locator("#save-btn").click();
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to editor-fixture.zip",
  );
  expect(await writes(page)).toBe(2);
  // Two text edits and the delete undone, at a person's pace (300 ms
  // apart, each said and no save left running before the next): each step
  // crosses the file. Written at once, each would be a write of its own.
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("Control+z");
    await expect(page.locator(".toast").last()).toContainText("Undone");
    await expect(page.locator("#save-status")).not.toHaveAttribute(
      "data-state",
      "saving",
    );
    await page.clock.runFor(300);
  }
  await expect(page.locator(".toast").last()).toHaveText(
    'Undone: the delete of "Fountain".',
  );
  await page.clock.runFor(1_000);
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to editor-fixture.zip",
  );
  await page.clock.runFor(10_000);
  expect(await writes(page)).toBe(3);
  await expect(
    page.locator(".toast", { hasText: "A save is running" }),
  ).toHaveCount(0);
  const texts = await readOpfsTour(page, "editor-fixture.zip");
  expect(texts["tour.json"]).toContain("photo-ok");
  expect(texts["tour.json"]).toContain("Town hall");
  expect(texts["tour.json"]).not.toContain('"One"');
});

test("an undo while an in-place write runs is written once that save ends", async ({
  page,
}) => {
  // Why (D33): an undo is taken while a save WRITES (only its rebuild
  // refuses one). It crosses the view that write holds, and no save may
  // start while one runs - so the save's end writes it.
  await fountainDeletedInPlace(page, { clock: true });
  await editTownHall(page, "Held");
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    // @ts-expect-error - read by the picker.
    window.__holdWrites = true;
  });
  await page.locator("#save-btn").click();
  await expect.poll(() => writes(page)).toBe(2);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".toast").last()).toHaveText(
    'Undone: the text of "Held".',
  );
  // The quiet time passes while the write is held: only the save's end can
  // start the resave now.
  await page.clock.runFor(1_000);
  expect(await writes(page)).toBe(2);
  await page.evaluate(() => {
    // @ts-expect-error - read by the picker.
    window.__holdWrites = false;
    // @ts-expect-error - set by the picker.
    window.__release();
  });
  await expect.poll(() => writes(page)).toBe(3);
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to editor-fixture.zip",
  );
  const texts = await readOpfsTour(page, "editor-fixture.zip");
  expect(texts["tour.json"]).toContain("Town hall");
  expect(texts["tour.json"]).not.toContain("Held");
});

test("a large tour, saved by hand, still writes an undo across its in-place save", async ({
  page,
}) => {
  // Why (D33, the default kept for a large tour): autosave is off above
  // the cap, so without the resave the restore would wait for Save - and a
  // reload before it would lose the note.
  await fountainDeletedInPlace(page, { clock: true, largeTour: true });
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "off");
  await page.keyboard.press("Control+z");
  await page.clock.runFor(1_000);
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to editor-fixture.zip",
  );
  expect(await writes(page)).toBe(2);
  expect(
    (await readOpfsTour(page, "editor-fixture.zip"))["tour.json"],
  ).toContain("photo-ok");
});

test("a large tour's resave whose quiet time ends during an edit waits for the edit, then writes the undone state", async ({
  page,
}) => {
  // Why: a resave falling due while a field was being
  // typed in was claimed and then held, and the claim had already taken the
  // resave on - so on a large tour (autosave off) nothing wrote the file
  // until Save, the very loss the resave closes. It now waits out the edit and
  // runs when the edit ends.
  await fountainDeletedInPlace(page, { clock: true, largeTour: true });
  await page.keyboard.press("Control+z");
  await expect(page.locator(".toast").last()).toHaveText(
    'Undone: the delete of "Fountain".',
  );
  // Typing starts inside the resave's quiet time, and is not committed.
  await page.locator("#rail .row", { hasText: "Town hall" }).click();
  const field = page.locator("#card textarea");
  await field.fill("Held a while");
  await page.clock.runFor(1_000);
  expect(await writes(page)).toBe(1);
  // The edit ends: the resave runs now.
  await field.blur();
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to editor-fixture.zip",
  );
  expect(await writes(page)).toBe(2);
  expect(
    (await readOpfsTour(page, "editor-fixture.zip"))["tour.json"],
  ).toContain("photo-ok");
});

test("after Download instead, a step across the old in-place save downloads nothing by itself", async ({
  page,
}) => {
  // Why (D33): a download cannot be rewritten silently. The undo's resave
  // fails, "Download instead" downloads that save, and the redo after it
  // crosses the file the failed resave named - but the page no longer
  // writes in place, so nothing is saved until Save is pressed.
  await fountainDeletedInPlace(page, { clock: true, noSavePicker: true });
  let downloads = 0;
  page.on("download", () => {
    downloads += 1;
  });
  await page.evaluate(() => {
    // @ts-expect-error - read by the picker.
    window.__failWrites = true;
  });
  await page.keyboard.press("Control+z");
  await page.clock.runFor(1_000);
  const refusal = page.locator(".toast", { hasText: "the disk is full" });
  await expect(refusal).toBeVisible();
  const download = page.waitForEvent("download");
  await refusal.locator("button", { hasText: "Download instead" }).click();
  await download;
  await expect(page.locator("#save-status")).toHaveText(
    "Saved as editor-fixture.zip",
  );
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator(".toast").last()).toHaveText(
    'Redone: the delete of "Fountain".',
  );
  await page.clock.runFor(5_000);
  await expect(page.locator("#save-status")).toContainText(
    "1 change not saved",
  );
  expect(downloads).toBe(1);
});

test("a resave waits while another tour is being chosen, and runs once that is cancelled", async ({
  page,
}) => {
  // Why: a resave landing while Open another reads a file would belong to
  // neither tour cleanly (as for the autosave, E2b-2 milestone review #1).
  await fountainDeletedInPlace(page, { clock: true });
  await page.keyboard.press("Control+z");
  // The restore is a change not saved: Open another asks first.
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await page.locator("#open-another").click();
  await expect(page.locator("#open-modal")).toBeVisible();
  await page.clock.runFor(1_000);
  // A resave started by the quiet time would say "Saving…" at once (its
  // write comes later, so the count alone could not tell).
  await expect(page.locator("#save-status")).toHaveText("1 change not saved");
  expect(await writes(page)).toBe(1);
  await page.locator("#open-cancel").click();
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to editor-fixture.zip",
  );
  expect(await writes(page)).toBe(2);
});

test("Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo, each said; in a field Ctrl+Z is the field's own", async ({
  page,
}) => {
  // Why (W2): the edit stack's keys. Each step is said in a toast (it can
  // change something off screen), the stack walks newest first, and a key
  // pressed while typing belongs to the field, not to the tour.
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await editPin(page, "Town hall", "First");
  await page.locator("#rail .row", { hasText: "Fountain" }).click();
  await page.locator("#card button", { hasText: "Delete" }).click();
  await expect(page.locator("#save-status")).toHaveText("2 changes not saved");
  const last = page.locator(".toast").last();
  await page.keyboard.press("Control+z");
  await expect(last).toHaveText('Undone: the delete of "Fountain".');
  await expect(page.locator("#rail .row", { hasText: "Fountain" })).toHaveCount(
    1,
  );
  await page.keyboard.press("Control+z");
  await expect(last).toHaveText('Undone: the text of "First".');
  await expect(
    page.locator("#rail .row", { hasText: "Town hall" }),
  ).toHaveCount(1);
  await expect(page.locator("#save-status")).toHaveText("No changes");
  await page.keyboard.press("Control+z");
  await expect(last).toHaveText("Nothing to undo.");
  await page.keyboard.press("Control+Shift+z");
  await expect(last).toHaveText('Redone: the text of "First".');
  await page.keyboard.press("Control+y");
  await expect(last).toHaveText('Redone: the delete of "Fountain".');
  await expect(page.locator("#save-status")).toHaveText("2 changes not saved");
  await page.keyboard.press("Control+y");
  await expect(last).toHaveText("Nothing to redo.");
  // Typing in the card: Ctrl+Z is the field's.
  await page.locator("#rail .row", { hasText: "First" }).click();
  const field = page.locator("#card textarea");
  await field.focus();
  const said = await page.locator(".toast").count();
  await page.keyboard.press("Control+z");
  await expect(page.locator("#save-status")).toHaveText("2 changes not saved");
  expect(await page.locator(".toast").count()).toBe(said);
});

test("a write that fails pauses autosave until Save, with no write loop", async ({
  page,
}) => {
  // Why (E2b plan review #3): a disk that refuses must not be written
  // again on every change; the creator is told, and Save starts it again.
  await page.clock.install();
  await page.goto("/edit.html");
  await offerCountedOpfsFile(page, await editorTour(), "editor-fixture.zip");
  await page.evaluate(() => {
    // @ts-expect-error - read by the picker.
    window.__failWrites = true;
  });
  await page.locator("#choose-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "idle");
  await editTownHall(page, "First try");
  await page.clock.runFor(3_500);
  const refusal = page.locator(".toast", { hasText: "the disk is full" });
  await expect(refusal).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "paused");
  expect(await writes(page)).toBe(1);
  await page.evaluate(() => {
    // @ts-expect-error - read by the picker.
    window.__failWrites = false;
  });
  await editPin(page, "First try", "Second try");
  await expect(page.locator("#save-status")).toHaveText(
    "1 change not saved - not saved by itself until you Save",
  );
  await page.clock.runFor(60_000);
  // Still paused, read BEFORE the count (E2b-2 milestone review #11): a
  // count read while an autosave was still starting would pass a loop.
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "paused");
  expect(await writes(page)).toBe(1);
  await page.locator("#save-btn").click();
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to editor-fixture.zip",
  );
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "idle");
  expect(await writes(page)).toBe(2);
  await editPin(page, "Second try", "Third, by itself again");
  await page.clock.runFor(3_500);
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to editor-fixture.zip",
  );
  expect(await writes(page)).toBe(3);
  expect(
    (await readOpfsTour(page, "editor-fixture.zip"))["tour.json"],
  ).toContain("Third, by itself again");
});

test("an edit made while an autosave writes is kept for the next one, and by the draft", async ({
  page,
  context,
}) => {
  // Why (M6 E2b-2 with E2c's draft): the write that lands clears what it
  // carried, never the edit made while it ran - in this tour of notes
  // alone the draft even moves to the written file's key, and must take
  // that edit along. The status shows the save in progress meanwhile.
  await page.addInitScript(() => {
    // @ts-expect-error - the editor's dev-only autosave timings: the second
    // autosave must not come before the tab is closed.
    window.__tourEditorAutosave = { delayMs: 600_000, maxWaitMs: 600_000 };
  });
  await page.clock.install();
  await page.goto("/edit.html");
  await offerCountedOpfsFile(page, await editorTour(), "editor-fixture.zip");
  await page.evaluate(() => {
    // @ts-expect-error - read by the picker.
    window.__holdWrites = true;
  });
  await page.locator("#choose-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "idle");
  await editTownHall(page, "In the first autosave");
  await page.clock.runFor(600_500);
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "saving");
  await expect(page.locator("#save-status")).toHaveText("Saving…");
  await page.waitForFunction(
    // @ts-expect-error - set by the held write.
    () => typeof window.__release === "function",
  );
  await editPin(page, "In the first autosave", "Made during the write");
  await page.evaluate(() => {
    // @ts-expect-error - read by the picker.
    window.__holdWrites = false;
    // @ts-expect-error - set by the held write.
    window.__release();
  });
  await expect(page.locator("body")).toHaveAttribute(
    "data-autosave",
    "waiting",
  );
  await expect(page.locator("#save-status")).toHaveText("1 change not saved");
  expect(
    (await readOpfsTour(page, "editor-fixture.zip"))["tour.json"],
  ).toContain("In the first autosave");
  await backedUp(page);
  await page.close();
  const next = await context.newPage();
  await answerTiles(next);
  await next.goto("/edit.html");
  await offerExistingOpfsFile(next, "editor-fixture.zip");
  await next.locator("#choose-btn").click();
  await expect(
    next.locator("#rail .row", { hasText: "In the first autosave" }),
  ).toHaveCount(1);
  const offer = next.locator(".toast.draft-offer");
  await expect(offer).toContainText("1 change");
  await offer.locator("button", { hasText: "Restore" }).click();
  await expect(
    next.locator("#rail .row", { hasText: "Made during the write" }),
  ).toHaveCount(1);
});

// ---------------------------------------------------------------------------
// The E2b-2 milestone review's findings on the page (#1, #3, #5, #6, #7).
// ---------------------------------------------------------------------------

test("autosave waits while another tour is being chosen, and goes on when that is cancelled", async ({
  page,
}) => {
  // Why (E2b-2 milestone review #1): an autosave that ran while the next
  // tour was being opened landed in the middle of that open and moved the
  // NEW tour's draft. The page holds autosave while the open dialog shows.
  await page.clock.install();
  await page.goto("/edit.html");
  await offerCountedOpfsFile(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#choose-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "idle");
  await editTownHall(page, "Kept while choosing");
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await page.locator("#open-another").click();
  await expect(page.locator("#open-modal")).toBeVisible();
  await page.clock.runFor(4_000);
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "held");
  expect(await writes(page)).toBe(0);
  await page.locator("#open-cancel").click();
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to editor-fixture.zip",
  );
  expect(await writes(page)).toBe(1);
});

test("a large tour is saved when Save is pressed, and the status line says so", async ({
  page,
}) => {
  // Why (E2b-2 milestone review #3): every save rebuilds and rewrites the
  // whole file, so on a large tour an autosave every few seconds costs
  // gigabytes of writes (and sync-client uploads) per session. Above the
  // cap autosave is off and the status says how the tour is saved. The cap
  // is lowered here by the dev seam, so the fixture counts as large.
  await page.addInitScript(() => {
    // @ts-expect-error - the editor's dev-only autosave cap.
    window.__tourEditorAutosave = { maxBytes: 1 };
  });
  await page.clock.install();
  await page.goto("/edit.html");
  await offerCountedOpfsFile(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-name")).toHaveText("Editor fixture");
  await editTownHall(page, "Saved by hand");
  await expect(page.locator("#save-status")).toHaveText(
    "1 change not saved - large tour: saved when you press Save; your changes are kept in this browser meanwhile",
  );
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "off");
  await page.clock.runFor(60_000);
  expect(await writes(page)).toBe(0);
  await page.locator("#save-btn").click();
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to editor-fixture.zip",
  );
  expect(await writes(page)).toBe(1);
});

test("a Save that fails does not start an autosave at once", async ({
  page,
}) => {
  // Why (E2b-2 milestone review #5): the explicit save's end woke an
  // autosave that fell due during it BEFORE autosave learned the save had
  // failed - a second write, at once, into a file that had just refused
  // one.
  await page.clock.install();
  await page.goto("/edit.html");
  await offerCountedOpfsFile(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#choose-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "idle");
  await page.evaluate(() => {
    // @ts-expect-error - read by the picker.
    window.__holdWrites = true;
    // @ts-expect-error - read by the picker.
    window.__failWrites = true;
  });
  await editTownHall(page, "Saved by hand");
  await page.locator("#save-btn").click();
  await page.waitForFunction(
    // @ts-expect-error - set by the held write.
    () => typeof window.__release === "function",
  );
  // An edit made while the Save writes falls due during it: held.
  await editPin(page, "Saved by hand", "Edited while it writes");
  await page.clock.runFor(3_500);
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "held");
  await page.evaluate(() => {
    // @ts-expect-error - read by the picker.
    window.__holdWrites = false;
    // @ts-expect-error - set by the held write.
    window.__release();
  });
  await expect(
    page.locator(".toast", { hasText: "the disk is full" }),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "paused");
  expect(await writes(page)).toBe(1);
});

// (The test "the photos a save could not place are said once, also when
// only autosave saves" stood here. Nothing places the walk's frames since
// M1 of the debug-captures plan - they are debug data - so no save has
// such a sentence to say; the autosave's quiet status line is pinned by
// the autosave tests above.)

test("a Ctrl+S pressed while the last tour's save still ran is not run later, unasked", async ({
  page,
}) => {
  // Why (E2b-2 milestone review #7): a save of the closed tour left
  // "an autosave runs" set, so a Ctrl+S in the next tour was queued behind
  // it - and since that save ended without a word, the queue stayed and
  // fired after the next tour's own autosave, as an explicit save nobody
  // asked for then.
  await page.clock.install();
  await page.goto("/edit.html");
  await offerCountedOpfsFile(page, await editorTour(), "editor-fixture.zip");
  await page.evaluate(() => {
    // @ts-expect-error - read by the picker.
    window.__holdWrites = true;
  });
  await page.locator("#choose-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "idle");
  await editTownHall(page, "Written while the next tour opens");
  await page.clock.runFor(3_500);
  await page.waitForFunction(
    // @ts-expect-error - set by the held write.
    () => typeof window.__release === "function",
  );
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await page.locator("#open-another").click();
  await offerCountedOpfsFile(page, await editorTour(), "second.zip");
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-file")).toHaveText("second.zip");
  await page.keyboard.press("Control+s");
  await page.evaluate(() => {
    // @ts-expect-error - set by the held write.
    const release = window.__release;
    // @ts-expect-error - the next held write sets its own.
    window.__release = undefined;
    release();
  });
  // The closed tour's save lands in its own file, and ends quietly.
  await expect
    .poll(async () => {
      try {
        return (await readOpfsTour(page, "editor-fixture.zip"))["tour.json"];
      } catch {
        return "";
      }
    })
    .toContain("Written while the next tour opens");
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "idle");
  // The second tour's autosave, held in its write, and an edit meanwhile.
  await editTownHall(page, "First in the second tour");
  // Twice: the first look may still find the closed tour's save ending.
  await page.clock.runFor(3_500);
  await page.clock.runFor(3_500);
  await page.waitForFunction(
    // @ts-expect-error - set by the held write.
    () => typeof window.__release === "function",
  );
  await editPin(page, "First in the second tour", "Made during its autosave");
  await page.evaluate(() => {
    // @ts-expect-error - read by the picker.
    window.__holdWrites = false;
    // @ts-expect-error - set by the held write.
    window.__release();
  });
  // Nobody pressed Save in this tour: the edit made during the autosave
  // waits for the next one - no explicit save, and no Save toast.
  await expect(page.locator("#save-status")).toHaveText("1 change not saved");
  await expect(
    page.locator(".toast", { hasText: "Saved to second.zip" }),
  ).toHaveCount(0);
  await page.clock.runFor(3_500);
  await expect(page.locator("#save-status")).toHaveText("Saved to second.zip");
  expect((await readOpfsTour(page, "second.zip"))["tour.json"]).toContain(
    "Made during its autosave",
  );
  expect(await writes(page)).toBe(2);
  await expect(
    page.locator(".toast", { hasText: "Saved to second.zip" }),
  ).toHaveCount(0);
});

/**
 * The tour's saved `tour.json`, parsed as written.
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 * @returns {Promise<Record<string, unknown>>}
 */
async function savedManifest(page, name) {
  return JSON.parse((await readOpfsTour(page, name))["tour.json"] ?? "{}");
}

test("the needs-no-GPS setting: saved in tour.json, shown on when reopened, left out when off", async ({
  page,
  context,
}) => {
  // Why (QR-first M1b-2, owner Q-QF-1): a creator marks a tour that the
  // printed codes place, so its visitors are never asked for location.
  // It is an edit like a note's: pending until saved, written as
  // `needsNoGps: true` (the framework's writer), read back on
  // the next open - and turned off, the field is gone, never `false`.
  // While it is on, the stations farther than 40 m from every code are
  // named (tour editor plan review 2 #3).
  await autosaveOutOfTheWay(page);
  await page.goto("/edit.html");
  await offerOpfsFile(
    page,
    await editorTour({ station: true, farStation: true }),
    "nogps.zip",
  );
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-name")).toHaveText("Editor fixture");
  const setting = page.locator("#no-gps-input");
  const warnings = page.locator("#no-gps-warnings");
  await expect(setting).not.toBeChecked();
  await expect(warnings).toBeHidden();
  // The live region is empty, never `hidden` (M1b-2 milestone review #5):
  // one shown and filled in the same task is commonly not announced.
  await expect(warnings).not.toHaveAttribute("hidden");
  await setting.check();
  await expect(page.locator("#save-status")).toHaveText("1 change not saved");
  await expect(warnings).toHaveText(
    '1 station is farther than 40 m from every printed code: "Old well". Without location, the position drifts with every metre walked from the last code, so visitors may not reach it. A code near it, or asking for location, fixes this.',
  );
  const line = await warnings.locator("p").first().elementHandle();
  await page.locator("#save-btn").click();
  await expect(page.locator("#save-status")).toHaveText("Saved to nogps.zip");
  // The save's refresh drew the same words: the node stays, so a screen
  // reader does not announce the warning again.
  expect(await line?.evaluate((node) => node.isConnected)).toBe(true);
  expect(await savedManifest(page, "nogps.zip")).toMatchObject({
    version: 3,
    minor: 0,
    needsNoGps: true,
  });
  await backedUp(page);
  await page.close();

  const next = await context.newPage();
  await answerTiles(next);
  await next.goto("/edit.html");
  await offerExistingOpfsFile(next, "nogps.zip");
  await next.locator("#choose-btn").click();
  await expect(next.locator("#tour-name")).toHaveText("Editor fixture");
  await expect(next.locator("#no-gps-input")).toBeChecked();
  await expect(next.locator("#no-gps-warnings")).toContainText(
    "1 station is farther than 40 m from every printed code",
  );
  await backedUp(next);
  await expect(next.locator(".toast.draft-offer")).toHaveCount(0);
  await next.locator("#no-gps-input").uncheck();
  await expect(next.locator("#no-gps-warnings")).toBeHidden();
  await next.locator("#save-btn").click();
  await expect(next.locator("#save-status")).toHaveText("Saved to nogps.zip");
  const off = await savedManifest(next, "nogps.zip");
  expect(off).not.toHaveProperty("needsNoGps");
  expect(off).toMatchObject({ version: 3, minor: 0 });
});

test("a changed needs-no-GPS setting survives a closed tab, and Restore brings it back", async ({
  page,
  context,
}) => {
  // Why (the draft gap, M1b-2): the draft kept the notes' edits but not a
  // tour-level setting, so a closed tab lost the setting alone.
  const buffer = await editorTour();
  await page.goto("/edit.html");
  await openThroughChooser(page, buffer, "editor-fixture.zip");
  await page.locator("#no-gps-input").check();
  await expect(page.locator("#save-status")).toHaveText("1 change not saved");
  await backedUp(page);
  await page.close();
  const next = await newEditorPage(context);
  await openThroughChooser(next, buffer, "editor-fixture.zip");
  const offer = next.locator(".toast.draft-offer");
  await expect(offer).toContainText("1 change");
  // Until it is answered the tour is the file's.
  await expect(next.locator("#no-gps-input")).not.toBeChecked();
  await offer.locator("button", { hasText: "Restore" }).click();
  await expect(next.locator("#no-gps-input")).toBeChecked();
  await expect(next.locator("#save-status")).toHaveText("1 change not saved");
});

/**
 * Why (tour editor plan 2026-10-17-1816, W2): the tour's name, description,
 * cover and contact had no place in the editor. The name in the top bar
 * opens them; Apply makes each changed field a pending change, saved into
 * `tour.json`, and an emptied name removes the title rather than
 * silently keeping it. A value the format would drop is refused in the
 * dialog, in words, and changes nothing.
 */
test("the tour's name opens its details: applied, saved into tour.json, and an emptied name removes the title", async ({
  page,
}) => {
  await noSavePicker(page);
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await expect(page).toHaveTitle("Editor fixture - Tour editor");
  await page.locator("#tour-name").click();
  const dialog = page.locator("#details-modal");
  await expect(dialog).toBeVisible();
  const name = page.locator("#details-name");
  await expect(name).toHaveValue("Editor fixture");
  await expect(name).toBeFocused();
  // The tour's placed photos are the choices, "None" chosen.
  await expect(page.locator(".cover-choice")).toHaveText([
    /None/,
    /Fountain/,
    /Too big/,
  ]);
  await expect(page.locator('.cover-choice input[value=""]')).toBeChecked();
  // Each photo shows its picture, read from the zip.
  await expect(
    page.locator(".cover-choice", { hasText: "Fountain" }).locator("img"),
  ).toBeVisible();
  await name.fill("Castle walk");
  await page.locator("#details-description").fill("Up to the castle and back.");
  await page.locator(".cover-choice", { hasText: "Fountain" }).click();
  await page.locator("#details-contact").fill("guide@example.org");
  await page.locator("#details-apply").click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".toast").last()).toHaveText(
    "Tour details changed - not saved yet.",
  );
  await expect(page.locator("#tour-name")).toHaveText("Castle walk");
  await expect(page.locator("#tour-name")).toBeFocused();
  await expect(page).toHaveTitle("Castle walk - Tour editor");
  await expect(page.locator("#save-status")).toHaveText("4 changes not saved");
  const saved = await saveAndRead(page);
  expect(saved.manifest).toMatchObject({
    version: 3,
    minor: 0,
    title: "Castle walk",
    description: "Up to the castle and back.",
    cover: "photo-ok",
    contact: "guide@example.org",
  });

  // Opened again it shows what was saved; an emptied name removes the
  // title (the top bar then names the file).
  await page.locator("#tour-name").click();
  await expect(page.locator("#details-description")).toHaveValue(
    "Up to the castle and back.",
  );
  await expect(
    page.locator('.cover-choice input[value="photo-ok"]'),
  ).toBeChecked();
  await name.fill("");
  await page.locator("#details-apply").click();
  await expect(page.locator("#tour-name")).toHaveText("editor-fixture.zip");
  await expect(page.locator("#save-status")).toHaveText("1 change not saved");
  const untitled = await saveAndRead(page);
  expect(untitled.manifest).not.toHaveProperty("title");
  expect(untitled.manifest).toMatchObject({ cover: "photo-ok" });
});

test("a contact the format refuses stays in the dialog with the reason; Esc closes it and changes nothing", async ({
  page,
}) => {
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#tour-name").click();
  const contact = page.locator("#details-contact");
  await contact.fill("call me at the gate");
  await page.locator("#details-apply").click();
  await expect(page.locator("#details-modal")).toBeVisible();
  await expect(page.locator("#details-error")).toHaveText(
    "The contact must be an e-mail address or a web link starting with http:// or https://.",
  );
  await expect(contact).toHaveValue("call me at the gate");
  // The focus stays in the dialog (M4a review #12): Tab never reaches the
  // map, the rail or the top bar behind it.
  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () =>
          document.activeElement?.closest("#topbar, #rail, #map, #card") !==
            null && document.activeElement !== null,
      ),
    ).toBe(false);
  }
  await contact.focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("#details-modal")).toBeHidden();
  await expect(page.locator("#tour-name")).toBeFocused();
  await expect(page.locator("#save-status")).toHaveText("No changes");
  // Opened again, the error is gone and the tour's own values show.
  await page.locator("#tour-name").click();
  await expect(page.locator("#details-error")).toBeHidden();
  await expect(contact).toHaveValue("");
});

test("the open dialog's fine print says what Save does in this browser", async ({
  page,
}) => {
  // Why (W2): it said "Save gives you a new copy" everywhere, which is
  // wrong where the file picker lets Save write the chosen file itself.
  // This suite takes the picker away before each test: a new copy.
  await page.goto("/edit.html");
  const fine = page.locator("#open-fineprint");
  await expect(fine).toContainText("Save gives you a new copy");
  const withPicker = await page.context().newPage();
  await answerTiles(withPicker);
  await withPicker.addInitScript(() => {
    // Put back after the suite's own init script took it away.
    /** @type {any} */ (window).showOpenFilePicker = () =>
      Promise.reject(new DOMException("not in this test", "AbortError"));
  });
  await withPicker.goto("/edit.html");
  await expect(withPicker.locator("#open-fineprint")).toContainText(
    "saved into that file",
  );
  await expect(withPicker.locator("#open-fineprint")).not.toContainText(
    "Save gives you a new copy",
  );
  await withPicker.close();
});

// ---------------------------------------------------------------------------
// "Done" (W2, D18, D19): where the changes are, how the tour at its link is
// updated, and "Move the walk out".
// ---------------------------------------------------------------------------

/**
 * A downloaded zip's entry names, sorted.
 * @param {import("@playwright/test").Download} download
 */
async function downloadedNames(download) {
  const bytes = new Uint8Array(readFileSync(await download.path()));
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  const names = (await reader.getEntries())
    .filter((e) => !e.directory)
    .map((e) => e.filename)
    .sort();
  await reader.close();
  return names;
}

test("Done saves what is pending, says where it is and how to update the tour, and moves the walk out into a file of its own", async ({
  page,
}) => {
  // Why (W2, D18, D19): a creator leaving the editor must learn where the
  // changes are and what is left to do for the tour at its link - and,
  // since the file written in place keeps the walk (the GPS track, the
  // depth), that a hosted copy of it is public with the walk unless it is
  // moved out. The move must put the walk in a file of its own, take it
  // out of the tour file for good (also the next save), and leave the
  // Drive-mount tip hidden until the owner's check (review #10).
  await autosaveOutOfTheWay(page);
  await noSavePicker(page);
  await page.goto("/edit.html");
  await offerOpfsFile(page, await wrappedTour({ pin: true }), "wrapped.zip");
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-name")).toHaveText("Wrapped fixture");
  await editPin(page, "Wrapped pin", "Done saves this");
  await page.locator("#done-btn").click();
  const done = page.locator("#done-modal");
  await expect(done).toBeVisible();
  await expect(page.locator("#done-where")).toHaveText(
    "Your changes are saved in wrapped.zip, the file you opened on this computer.",
  );
  expect(
    (await readOpfsTour(page, "wrapped.zip"))["mytour/tour.json"],
  ).toContain("Done saves this");
  await expect(page.locator("#done-update")).toContainText(
    "Replace existing file",
  );
  await page.locator("#done-host").selectOption("dropbox");
  await expect(page.locator("#done-update")).toContainText("In Dropbox");
  await expect(page.locator("#done-public")).toContainText("public");
  await expect(page.locator("#done-walk-text")).toContainText("GPS track");
  await expect(page.locator("#done-drive-tip")).toBeHidden();
  await expect(done.locator('a[href="legal.html#privacy"]')).toBeVisible();
  // No save dialog in this browser: the walk is downloaded, and the tour
  // keeps it until a second click says the download arrived (the M4b
  // milestone review #2: a started download is not a landed one).
  const download = page.waitForEvent("download");
  const move = page.locator("#done-move");
  await move.click();
  const walkFile = await download;
  expect(walkFile.suggestedFilename()).toBe("wrapped-walk.zip");
  // The whole recording - every frame - and the note naming the tour (the
  // M4b milestone review #8).
  expect(await downloadedNames(walkFile)).toEqual([
    "about-this-walk.txt",
    "mytour/actions/000001.json",
    "mytour/images/frame-000002.png",
    "mytour/session.json",
  ]);
  await expect(page.locator("#done-move-status")).toContainText(
    "The walk was downloaded as wrapped-walk.zip",
  );
  await expect(move).toHaveText("Take the walk out of the tour");
  expect(Object.keys(await readOpfsTour(page, "wrapped.zip"))).toContain(
    "mytour/actions/000001.json",
  );
  await move.click();
  await expect(page.locator("#done-move-status")).toContainText(
    "The walk is in wrapped-walk.zip",
  );
  await expect(page.locator("#done-where")).toHaveText(
    "Your changes are saved in wrapped.zip, the file you opened on this computer.",
  );
  await expect(page.locator("#done-move")).toBeHidden();
  const tour = Object.keys(await readOpfsTour(page, "wrapped.zip"));
  expect(tour).not.toContain("mytour/actions/000001.json");
  expect(tour).not.toContain("mytour/session.json");
  // Changed expectation: the frame a capture spot named stayed for the
  // visitors. The frames are debug data now, so the walk takes it along.
  expect(tour).not.toContain("mytour/images/frame-000002.png");
  await page.locator("#done-close").click();
  await expect(done).toBeHidden();
  await expect(page.locator("#done-btn")).toBeFocused();
  // The next save keeps the walk of the bytes it rebuilds from: none.
  await editPin(page, "Done saves this", "After the move");
  await page.locator("#save-btn").click();
  await expect(page.locator("#save-status")).toHaveText("Saved to wrapped.zip");
  const after = await readOpfsTour(page, "wrapped.zip");
  expect(after["mytour/tour.json"]).toContain("After the move");
  expect(Object.keys(after)).not.toContain("mytour/actions/000001.json");
});

test("Done shows its save in progress and stays shut when the save fails, and a failed write of either file leaves the tour file as it was", async ({
  page,
}) => {
  // Why (the async-UI rule; W2, D19): Done's own save is awaited work, so
  // it shows its state and says a failure; and the move writes two files -
  // the walk's first, then the tour - so a failure of either must leave the
  // tour file exactly as it was, still carrying the walk.
  await autosaveOutOfTheWay(page);
  await page.goto("/edit.html");
  await offerCountedOpfsFile(
    page,
    await wrappedTour({ pin: true }),
    "wrapped.zip",
  );
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-name")).toHaveText("Wrapped fixture");
  await editPin(page, "Wrapped pin", "Held, then failed");
  await page.evaluate(() => {
    // @ts-expect-error - read by the counted picker.
    window.__holdWrites = true;
    // @ts-expect-error - read by the counted picker.
    window.__failWrites = true;
  });
  const doneButton = page.locator("#done-btn");
  await doneButton.click();
  await expect(doneButton).toHaveText("Saving…");
  await expect(doneButton).toBeDisabled();
  // Held at the write itself: the build before it takes its time.
  await expect.poll(() => writes(page)).toBe(1);
  await page.evaluate(() => {
    // @ts-expect-error - read by the counted picker.
    window.__holdWrites = false;
    // @ts-expect-error - set by the counted picker.
    window.__release();
  });
  await expect(
    page.locator(".toast", { hasText: "Not done yet" }),
  ).toBeVisible();
  await expect(doneButton).toHaveText("Done");
  await expect(doneButton).toBeEnabled();
  await expect(page.locator("#done-modal")).toBeHidden();
  // That failed save rightly offers "Download instead"; dismissed here, so
  // the check after the failed move below sees only what the move offers.
  const offer = page.locator(".toast", { hasText: "Download instead" });
  await offer.getByRole("button", { name: "Close" }).click();
  await expect(offer).toHaveCount(0);
  await page.evaluate(() => {
    // @ts-expect-error - read by the counted picker.
    window.__failWrites = false;
  });
  await doneButton.click();
  await expect(page.locator("#done-modal")).toBeVisible();
  const before = await readOpfsTour(page, "wrapped.zip");
  expect(before["mytour/tour.json"]).toContain("Held, then failed");
  expect(Object.keys(before)).toContain("mytour/actions/000001.json");
  // The walk's file is not saved (its save dialog dismissed): nothing moves.
  await page.evaluate(() => {
    // @ts-expect-error - the e2e's own save picker.
    window.showSaveFilePicker = () =>
      Promise.reject(new DOMException("dismissed", "AbortError"));
  });
  const move = page.locator("#done-move");
  await move.click();
  await expect(page.locator("#done-move-status")).toContainText(
    "Nothing was moved",
  );
  await expect(move).toBeEnabled();
  await expect(move).toHaveText("Move the walk out");
  expect(await readOpfsTour(page, "wrapped.zip")).toEqual(before);
  // ... and the next save still carries the walk (the M4b milestone
  // review #7: a failed move must leave nothing behind that drops it).
  await page.locator("#done-close").click();
  await editPin(page, "Held, then failed", "Saved after a dismissed move");
  await page.locator("#save-btn").click();
  await expect(page.locator("#save-status")).toHaveText("Saved to wrapped.zip");
  expect(Object.keys(await readOpfsTour(page, "wrapped.zip"))).toContain(
    "mytour/actions/000001.json",
  );
  await doneButton.click();
  await expect(page.locator("#done-modal")).toBeVisible();
  const before2 = await readOpfsTour(page, "wrapped.zip");
  // The walk's file is saved, and the tour's write fails: the tour keeps
  // its walk.
  await page.evaluate(() => {
    // @ts-expect-error - the e2e takes the picker away: a plain download.
    delete window.showSaveFilePicker;
    // @ts-expect-error - read by the counted picker.
    window.__failWrites = true;
  });
  const download = page.waitForEvent("download");
  await move.click();
  expect((await download).suggestedFilename()).toBe("wrapped-walk.zip");
  await expect(move).toHaveText("Take the walk out of the tour");
  await move.click();
  await expect(page.locator("#done-move-status")).toContainText(
    "keeps its walk",
  );
  await expect(move).toBeEnabled();
  expect(await readOpfsTour(page, "wrapped.zip")).toEqual(before2);
  // A failed move write offers no "Download instead": there was nothing
  // to download, and it would have detached the file (review #6).
  await expect(
    page.locator(".toast", { hasText: "Download instead" }),
  ).toHaveCount(0);
  // ... and the next save, once the disk writes again, still carries it.
  await page.evaluate(() => {
    // @ts-expect-error - read by the counted picker.
    window.__failWrites = false;
  });
  await page.locator("#done-close").click();
  await editPin(
    page,
    "Saved after a dismissed move",
    "Saved after a failed move",
  );
  await page.locator("#save-btn").click();
  await expect(page.locator("#save-status")).toHaveText("Saved to wrapped.zip");
  const after = await readOpfsTour(page, "wrapped.zip");
  expect(after["mytour/tour.json"]).toContain("Saved after a failed move");
  expect(Object.keys(after)).toContain("mytour/actions/000001.json");
});

/**
 * A stand-in for the browser's save dialog that behaves as Chromium's
 * does: it opens only during the click that asked for it (a call after an
 * await of seconds is refused with a SecurityError), and it hands back a
 * real file of the origin-private file system, `name`. `hold` keeps the
 * dialog open until `window.__releaseWalkPick()`.
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 * @param {{ hold?: boolean }} [options]
 */
async function clickBoundSavePicker(page, name, options = {}) {
  await page.evaluate(
    async ({ fileName, hold }) => {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(fileName, { create: true });
      let inClick = false;
      document.addEventListener(
        "click",
        () => {
          inClick = true;
          setTimeout(() => {
            inClick = false;
          }, 0);
        },
        true,
      );
      // @ts-expect-error - read by the test.
      window.__walkPicks = 0;
      // @ts-expect-error - the e2e's own save dialog.
      window.showSaveFilePicker = () => {
        // @ts-expect-error - counted for the test.
        window.__walkPicks += 1;
        if (!inClick) {
          return Promise.reject(
            new DOMException(
              "Must be handling a user gesture",
              "SecurityError",
            ),
          );
        }
        if (!hold) return Promise.resolve(handle);
        return new Promise((resolve) => {
          // @ts-expect-error - called by the test.
          window.__releaseWalkPick = () => resolve(handle);
        });
      };
    },
    { fileName: name, hold: options.hold === true },
  );
}

/**
 * Open the wrapped tour in place, edit its pin, and press Done.
 * @param {import("@playwright/test").Page} page
 */
async function doneWithWrappedTour(page) {
  await page.goto("/edit.html");
  await offerOpfsFile(page, await wrappedTour({ pin: true }), "wrapped.zip");
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-name")).toHaveText("Wrapped fixture");
  await editPin(page, "Wrapped pin", "Before the move");
  await page.locator("#done-btn").click();
  await expect(page.locator("#done-modal")).toBeVisible();
}

test("the walk's file is asked for on the click, so a long build cannot cost the save dialog, and the walk lands in the chosen file", async ({
  page,
}) => {
  // Why (the M4b milestone review #2): the dialog used to be opened after
  // the move's build; Chromium refuses it then, the framework fell back to
  // a download it could not check, and the tour was rewritten without the
  // walk - which then existed nowhere if that download was cancelled.
  await autosaveOutOfTheWay(page);
  await doneWithWrappedTour(page);
  await clickBoundSavePicker(page, "wrapped-walk.zip");
  await page.locator("#done-move").click();
  await expect(page.locator("#done-move-status")).toContainText(
    "The walk is in wrapped-walk.zip",
  );
  // @ts-expect-error - counted by the stand-in.
  expect(await page.evaluate(() => window.__walkPicks)).toBe(1);
  const walk = await readOpfsTour(page, "wrapped-walk.zip");
  expect(Object.keys(walk).sort()).toEqual([
    "about-this-walk.txt",
    "mytour/actions/000001.json",
    "mytour/images/frame-000002.png",
    "mytour/session.json",
  ]);
  expect(walk["about-this-walk.txt"]).toContain("wrapped.zip");
  const tour = Object.keys(await readOpfsTour(page, "wrapped.zip"));
  expect(tour).not.toContain("mytour/actions/000001.json");
  // Changed expectation: the frame stayed for the visitors while a capture
  // spot named it; the frames are debug data now and go with the walk.
  expect(tour).not.toContain("mytour/images/frame-000002.png");
});

test("Done stays shut and the dialog stays open while the walk is moved out", async ({
  page,
}) => {
  // Why (the M4b milestone review #1): closed mid-move (Escape, Close), the
  // dialog let Done start while the move held the page's save; Done then
  // waited on a promise that had long settled, and the tab froze.
  await autosaveOutOfTheWay(page);
  await doneWithWrappedTour(page);
  await clickBoundSavePicker(page, "wrapped-walk.zip", { hold: true });
  await page.locator("#done-move").click();
  await expect(page.locator("#done-move")).toHaveText("Moving the walk out…");
  await page.keyboard.press("Escape");
  await expect(page.locator("#done-modal")).toBeVisible();
  await expect(page.locator("#done-close")).toBeDisabled();
  await expect(page.locator("#done-btn")).toBeDisabled();
  await page.evaluate(() => {
    // @ts-expect-error - set by the stand-in.
    window.__releaseWalkPick();
  });
  await expect(page.locator("#done-move-status")).toContainText(
    "The walk is in wrapped-walk.zip",
  );
  await expect(page.locator("#done-close")).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.locator("#done-modal")).toBeHidden();
  // Done works again, and its dialog knows the walk is gone.
  await page.locator("#done-btn").click();
  await expect(page.locator("#done-modal")).toBeVisible();
  await expect(page.locator("#done-walk")).toBeHidden();
});

test("the tour file itself is refused as the walk's file, before anything is written", async ({
  page,
}) => {
  // Why (the M4b fix re-review #1): pointed at the opened tour, the save
  // dialog let the walk's zip land over the tour; the tour's own write was
  // then refused as "changed", and the tour's content existed nowhere.
  await autosaveOutOfTheWay(page);
  await doneWithWrappedTour(page);
  const before = await readOpfsTour(page, "wrapped.zip");
  await clickBoundSavePicker(page, "wrapped.zip");
  await page.locator("#done-move").click();
  await expect(page.locator("#done-move-status")).toContainText(
    "wrapped.zip is the tour itself",
  );
  await expect(page.locator("#done-move")).toHaveText("Move the walk out");
  expect(await readOpfsTour(page, "wrapped.zip")).toEqual(before);
  expect(Object.keys(before)).toContain("mytour/actions/000001.json");
});

test("a tour with no file to write into is downloaded without the walk on a second click, once the walk is in its file", async ({
  page,
}) => {
  // Why (the M4b fix re-review #2): such a tour (a sample, a link, a file
  // it may not write) is downloaded; done right after the walk's write,
  // the click's window had passed, the save dialog was refused and the
  // download fell back unseen - while the dialog said the tour no longer
  // carried the walk. Its download now waits for a fresh click.
  await autosaveOutOfTheWay(page);
  await page.goto("/edit.html");
  await offerOpfsFile(page, await wrappedTour({ pin: true }), "wrapped.zip", {
    permission: "denied",
  });
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-name")).toHaveText("Wrapped fixture");
  // Nothing edited: Done opens without a save.
  await page.locator("#done-btn").click();
  await expect(page.locator("#done-modal")).toBeVisible();
  await clickBoundSavePicker(page, "wrapped-walk.zip");
  const move = page.locator("#done-move");
  await move.click();
  await expect(page.locator("#done-move-status")).toContainText(
    "The walk is in wrapped-walk.zip - keep that file.",
  );
  await expect(move).toHaveText("Download the tour without the walk");
  expect(Object.keys(await readOpfsTour(page, "wrapped-walk.zip"))).toContain(
    "mytour/actions/000001.json",
  );
  // The second click downloads the tour: the stand-in dialog goes, so the
  // download is the browser's own.
  await page.evaluate(() => {
    // @ts-expect-error - the e2e's own save dialog.
    delete window.showSaveFilePicker;
  });
  const download = page.waitForEvent("download");
  await move.click();
  const tour = readFileSync(await (await download).path());
  await expect(page.locator("#done-move-status")).toContainText(
    "no longer carries it",
  );
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(tour)));
  const names = (await reader.getEntries()).map((e) => e.filename);
  await reader.close();
  expect(names).not.toContain("mytour/actions/000001.json");
  // Changed expectation: the frame stayed while a capture spot named it;
  // the frames are debug data now and go with the walk.
  expect(names).not.toContain("mytour/images/frame-000002.png");
});
