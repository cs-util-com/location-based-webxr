// @ts-check
// The tours, files and page set-ups the editor's file specs share
// (editor.spec.js on the map, editor-files.spec.js without a 3D view): the
// fixture tours built in the test, the real file chooser, the browser's
// download read back, the origin-private file a stand-in picker offers,
// and the draft's readiness mark.
import { expect } from "@playwright/test";
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
import { save } from "./editor-menus.js";
import {
  capturedPhoto,
  imageAsset,
  inOwnStation,
  pinBlock,
  showStep,
  textCard,
} from "./tour-fixture.mjs";

/** 1x1 red PNG, a real decodable image. */
export const TINY_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => /** @type {number} */ (c.codePointAt(0)),
);

/** The same PNG whose header claims 5000 x 5000 px: over the tour cap,
 *  refused by its header before any decode. */
export function oversizedPng() {
  const bytes = TINY_PNG.slice();
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 5000);
  view.setUint32(20, 5000);
  return bytes;
}

export const AT = { lat: 48.5203, lon: 9.0536, alt: 340 };

// Within a pin text's 40 characters, so the file opens.
export const MARKUP = '<img src=x onerror="__xss=1">Town hall';

/** @param {number} north @param {number} east */
export function geo(north, east) {
  return {
    lat: AT.lat + north / 111_320,
    lon: AT.lon + east / 73_800,
    alt: AT.alt,
  };
}

/** @param {{path: string, data: string | Uint8Array}[]} entries */
export async function zip(entries) {
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
export async function editorTour({ station = false, farStation = false } = {}) {
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
  // Through the serializer (version 4: stations at geo poses, the pins
  // and photos as their free blocks).
  const manifest = {
    ...createEmptyTourManifest(),
    title: "Editor fixture",
    assets: [
      imageAsset("photo-ok", "content/photo-ok.png", 1, 1),
      imageAsset("photo-big", "content/photo-big.png", 1, 1),
    ],
    // A story station at the first code's point (PR #609 review).
    stations: [
      ...(station
        ? [
            {
              id: "gate",
              title: "At the gate",
              // At the first code's point (a station names no code).
              geo: { ...geo(0, 0), headingDeg: 0 },
              activateRadiusM: 30,
              foundRadiusM: 5,
              hint: "arrow",
              blocks: [textCard("hello", "At the gate", "Hello")],
              steps: [showStep("hi", "hello")],
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
              blocks: [textCard("a-well", "Old well", "A well")],
              steps: [showStep("w", "a-well")],
            },
            {
              id: "bench",
              geo: { ...geo(-5, 5), headingDeg: 0 },
              activateRadiusM: 30,
              foundRadiusM: 5,
              hint: "arrow",
              blocks: [textCard("a-bench", "A bench", "A bench")],
              steps: [showStep("b", "a-bench")],
            },
          ]
        : []),
      ...[
        {
          ...pinBlock("pin-markup", MARKUP, {
            createdAtIso: "2026-10-13T00:00:00.000Z",
          }),
          geo: { ...geo(10, 10), headingDeg: 0 },
        },
        {
          ...capturedPhoto("photo-ok", {
            caption: "Fountain",
            createdAtIso: "2026-10-13T00:00:00.000Z",
          }),
          geo: { ...geo(-10, 20), rotation: [0, 0, 0, 1] },
        },
        {
          ...capturedPhoto("photo-big", {
            caption: "Too big",
            createdAtIso: "2026-10-13T00:00:00.000Z",
          }),
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

/** @param {import("@playwright/test").Page} page */
export async function answerTiles(page) {
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
export async function openThroughChooser(page, buffer, name) {
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#drop").click();
  await (await chooser).setFiles({ name, mimeType: "application/zip", buffer });
}

/** A tour in the wrapped shape ("compress this folder") carrying a walk
 *  recording and its frame, and a code with no stored position.
 *  @param {{ pin: boolean, extra?: boolean }} options -
 *  `extra`: a second pin, as another program's edit of the same tour would
 *  add */
export async function wrappedTour(options = { pin: false }) {
  const id = await qrCodeId("https://gps.csutil.com/tour/?qr=wrapped");
  const manifest = {
    ...createEmptyTourManifest(),
    title: "Wrapped fixture",
    stations: [
      ...(options.pin
        ? [
            {
              ...pinBlock("pin-wrapped", "Wrapped pin", {
                createdAtIso: "2026-10-13T00:00:00.000Z",
              }),
              geo: { ...geo(6, 6), headingDeg: 0 },
            },
            ...(options.extra === true
              ? [
                  {
                    ...pinBlock("pin-elsewhere", "Added elsewhere", {
                      createdAtIso: "2026-10-14T00:00:00.000Z",
                    }),
                    geo: { ...geo(-6, 6), headingDeg: 0 },
                  },
                ]
              : []),
          ].map(inOwnStation)
        : []),
    ],
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

/**
 * The saved file, through the browser's download: the save picker is taken
 * away first, so the framework's `downloadBlob` takes its `<a download>`
 * path, which Playwright sees (M6 E2a). `run`: the command that saves
 * (File's Save unless said).
 * @param {import("@playwright/test").Page} page
 * @param {(page: import("@playwright/test").Page) => Promise<void>} [run]
 */
export async function saveAndRead(page, run = save) {
  const download = page.waitForEvent("download");
  await run(page);
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
export async function noSavePicker(page) {
  await page.addInitScript(() => {
    // @ts-expect-error - the e2e takes the picker away on purpose.
    delete window.showSaveFilePicker;
  });
}

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
export async function offerOpfsFile(page, buffer, name, options = {}) {
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
export async function autosaveOutOfTheWay(page) {
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
export async function readOpfsTour(page, name) {
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

/**
 * A second editor page in the same context, set up as `beforeEach` sets
 * up `page`: no open or save picker (the file input and the download
 * path), the map's tiles answered.
 * @param {import("@playwright/test").BrowserContext} context
 */
export async function newEditorPage(context) {
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
export async function backedUp(page) {
  await expect(page.locator("body")).toHaveAttribute("data-draft", "saved");
}

/**
 * The picker hands out the origin-private file `name` as it is now.
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
export async function offerExistingOpfsFile(page, name) {
  await page.evaluate(async (fileName) => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(fileName);
    // @ts-expect-error - the e2e's own picker.
    window.showOpenFilePicker = () => Promise.resolve([handle]);
  }, name);
}

/**
 * A downloaded zip's entry names, sorted.
 * @param {import("@playwright/test").Download} download
 */
export async function downloadedNames(download) {
  const bytes = new Uint8Array(readFileSync(await download.path()));
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  const names = (await reader.getEntries())
    .filter((e) => !e.directory)
    .map((e) => e.filename)
    .sort();
  await reader.close();
  return names;
}
