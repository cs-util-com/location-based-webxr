// @ts-check
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  TextWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
} from "@zip.js/zip.js";

import {
  fileCommand,
  fileItem,
  openAnother,
  publish,
  save,
  startOnMap,
  viewCommand,
  viewItem,
} from "./editor-menus.js";
import {
  MARKUP,
  answerTiles,
  autosaveOutOfTheWay,
  backedUp,
  downloadedNames,
  editorTour,
  newEditorPage,
  noSavePicker,
  offerExistingOpfsFile,
  offerOpfsFile,
  openThroughChooser,
  readOpfsTour,
  saveAndRead,
  wrappedTour,
  zip,
} from "./editor-tours.js";

/**
 * Why these tests matter (Tour Viewer M6 E1): the desktop editor opens a
 * file anyone can make and draws it on a map. These drive the REAL file
 * chooser and check what a creator sees: every code and note listed and on
 * the map, an oversized photo refused, a label carrying markup shown as
 * text (never run), a zip that is not a tour refused in words, and the
 * edits and saves. (The map's own layout, its card placement and its
 * marker drag are no longer pinned here: the globe is the creator's view,
 * and the map is on its way out.)
 */

// The page prefers the browser's file picker (M6 E2b-1); these tests open
// through the file input, so the picker is taken away before each - the
// in-place tests put their own back after the page loads.
test.beforeEach(async ({ page, context }) => {
  await page.addInitScript(() => {
    // @ts-expect-error - the e2e takes the picker away on purpose.
    delete window.showOpenFilePicker;
  });
  // These specs work on the 2D map (its markers, rail and card); the 3D
  // view, the default, has its own specs (editor3d*.spec.js).
  await startOnMap(context);
});

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
  // A tour has no loose pins: the fixture's three
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
  await expect(viewItem(page, "debug")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#debug-status")).toHaveText(
    "Debug data: 2 camera captures on the map.",
  );
  const markers = page.locator(".mk-debug-wrap");
  await expect(markers).toHaveCount(2);
  await expect(page.locator(".mk-debug img")).toHaveCount(2);
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
  await viewCommand(page, "debug");
  await expect(viewItem(page, "debug")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(markers).toHaveCount(0);
  await viewCommand(page, "debug");
  await expect(viewItem(page, "debug")).toHaveAttribute("aria-checked", "true");
  await expect(markers).toHaveCount(2);
  await expect(page.locator("#save-status")).toHaveText("No changes");
});

test("frames the camera captures of a recording that has nothing else on the map", async ({
  page,
}) => {
  // Why (debug-captures M1): a recording whose one code has no position yet
  // (measured nowhere) has nothing to frame, so the map opened at the world
  // view - and its debug captures, ten metres apart, drew as one dot
  // somewhere over Europe. The map now frames the captures once they are
  // drawn. (The code stays: the editor opens no zip without a tour.json or
  // a code.)
  const full = new ZipReader(
    new Uint8ArrayReader(
      new Uint8Array(
        await (
          await fetch("http://127.0.0.1:5197/ranges-ok/recording-tour.zip")
        ).arrayBuffer(),
      ),
    ),
  );
  const entries = [];
  for (const entry of await full.getEntries()) {
    if (entry.directory) continue;
    if (entry.filename.startsWith("qr/")) {
      // The code without its stored position.
      const level = JSON.parse(await entry.getData(new TextWriter()));
      delete level.qr.geo;
      entries.push({ path: entry.filename, data: JSON.stringify(level) });
      continue;
    }
    entries.push({
      path: entry.filename,
      data: await entry.getData(new Uint8ArrayWriter()),
    });
  }
  await full.close();
  await page.goto("/edit.html");
  await openThroughChooser(page, await zip(entries), "no-code.zip");
  await expect(page.locator("#debug-status")).toHaveText(
    "Debug data: 2 camera captures on the map.",
  );
  const markers = page.locator(".mk-debug-wrap");
  await expect(markers).toHaveCount(2);
  // At the world view the two would share a pixel; framed, they stand
  // apart on the screen.
  await expect
    .poll(async () => {
      const [a, b] = await Promise.all([
        markers.nth(0).boundingBox(),
        markers.nth(1).boundingBox(),
      ]);
      return a === null || b === null ? 0 : Math.hypot(a.x - b.x, a.y - b.y);
    })
    .toBeGreaterThan(20);
});

test("says why a walk shows no debug data, and shows no switch for a tour without a walk", async ({
  page,
}) => {
  // Why (the async-UI rule): the debug layer's work ends in a final state
  // the creator can read - here a walk whose stream places nothing. A
  // tour without a walk has no debug data and no switch for it.
  // Changed expectation (M2 step 5 of the debug-captures plan): such a
  // tour's panel stays, offering "Add debug data…" alone - it used to be
  // hidden, which left no place to add the debug data back.
  await page.goto("/edit.html");
  await openThroughChooser(page, await wrappedTour(), "wrapped.zip");
  await expect(page.locator("#debug-panel")).toBeVisible();
  await expect(viewItem(page, "debug")).toHaveJSProperty("hidden", false);
  await expect(page.locator("#debug-status")).toContainText(
    "No debug data shown: ",
  );
  await expect(page.locator(".mk-debug-wrap")).toHaveCount(0);
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await openAnother(page);
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await expect(page.locator("#tour-name")).not.toHaveText("Wrapped fixture");
  await expect(page.locator("#debug-panel")).toBeVisible();
  await expect(viewItem(page, "debug")).toHaveJSProperty("hidden", true);
  await expect(page.locator("#debug-status")).toHaveText("");
  await expect(page.locator("#debug-add")).toHaveText("Add debug data…");
});

/**
 * Debug data as the Tour Viewer saves it apart (`debug-bundle.ts`): the
 * recording of recording-tour.zip - its tour and its code left out - and
 * a `debug-bundle.json` naming the tour it was saved from.
 * @param {{ tour: string | null, file: string | null }} from
 */
async function debugBundleOf(from) {
  const full = new ZipReader(
    new Uint8ArrayReader(
      new Uint8Array(
        await (
          await fetch("http://127.0.0.1:5197/ranges-ok/recording-tour.zip")
        ).arrayBuffer(),
      ),
    ),
  );
  const entries = [];
  for (const entry of await full.getEntries()) {
    if (entry.directory) continue;
    if (entry.filename === "tour.json" || entry.filename.startsWith("qr/")) {
      continue;
    }
    entries.push({
      path: entry.filename,
      data: await entry.getData(new Uint8ArrayWriter()),
    });
  }
  await full.close();
  entries.push({
    path: "debug-bundle.json",
    data: JSON.stringify({
      format: 1,
      seriesId: null,
      ...from,
      writtenAt: "2026-10-20T12:00:00.000Z",
    }),
  });
  return zip(entries);
}

/**
 * Add a file as debug data through the panel's file input.
 * @param {import("@playwright/test").Page} page
 * @param {Buffer} buffer
 * @param {string} name
 */
async function addDebugFile(page, buffer, name) {
  await page
    .locator("#debug-add-input")
    .setInputFiles({ name, mimeType: "application/zip", buffer });
}

test("adds the debug data back beside a tour from its own button, and forgets it at a reload", async ({
  page,
}) => {
  // Why (M2 step 5 of the debug-captures plan, Q-H): the debug data lives
  // in a file of its own, and the editor shows it again when the creator
  // adds that file - its captures on the map, a line naming the file -
  // without it ever becoming part of the tour: nothing pending, and a
  // reload forgets it (keeping it would put the whole walk in the
  // browser's storage).
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  // The panel shows once the tour is open: only then is there a tour to
  // add debug data to.
  await expect(page.locator("#debug-panel")).toBeVisible();
  await expect(viewItem(page, "debug")).toHaveJSProperty("hidden", true);
  const rows = await page.locator("#rail .row").count();
  expect(rows).toBeGreaterThan(0);
  const bundle = await debugBundleOf({
    tour: "Editor fixture",
    file: "editor-fixture.zip",
  });
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#debug-add").click();
  await (
    await chooser
  ).setFiles({
    name: "editor-fixture-debug.zip",
    mimeType: "application/zip",
    buffer: bundle,
  });
  await expect(page.locator("#debug-status")).toHaveText(
    "Added from editor-fixture-debug.zip, not saved with the tour. Debug data: 2 camera captures on the map.",
  );
  await expect(page.locator(".mk-debug-wrap")).toHaveCount(2);
  await expect(page.locator(".mk-debug img")).toHaveCount(2);
  await expect(viewItem(page, "debug")).toHaveJSProperty("hidden", false);
  await expect(page.locator("#debug-add")).toHaveText("Add debug data…");
  await expect(page.locator("#debug-add")).toBeEnabled();
  // Not the tour's content: nothing listed, nothing pending.
  await expect(page.locator("#rail .row")).toHaveCount(rows);
  await expect(page.locator("#save-status")).toHaveText("No changes");
  await page.reload();
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await expect(page.locator("#tour-name")).toHaveText("Editor fixture");
  await expect(viewItem(page, "debug")).toHaveJSProperty("hidden", true);
  await expect(page.locator("#debug-status")).toHaveText("");
  await expect(page.locator(".mk-debug-wrap")).toHaveCount(0);
});

test("says whose added debug data is - another tour's, or a plain recording - refuses a file that is none, and never saves it", async ({
  page,
}) => {
  // Why (Q-C of the debug-captures plan): a file saved from another tour
  // is shown, never refused, but the line says so; a Recorder zip names no
  // tour, so it is "a recording". A file without a recording is refused in
  // words, the layer kept. No save carries any of it (E2).
  await noSavePicker(page);
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await expect(page.locator("#debug-panel")).toBeVisible();
  await addDebugFile(
    page,
    await debugBundleOf({ tour: "Somewhere else", file: "else.zip" }),
    "else-debug.zip",
  );
  await expect(page.locator("#debug-status")).toHaveText(
    'Added from else-debug.zip, not saved with the tour. It was saved from another tour ("Somewhere else", else.zip), not this one. Debug data: 2 camera captures on the map.',
  );
  await expect(page.locator(".mk-debug-wrap")).toHaveCount(2);
  const recording = Buffer.from(
    await (
      await fetch("http://127.0.0.1:5197/ranges-ok/recording-tour.zip")
    ).arrayBuffer(),
  );
  await addDebugFile(page, recording, "walk.zip");
  await expect(page.locator("#debug-status")).toHaveText(
    "Added from walk.zip, not saved with the tour. It is a recording, not saved from this tour. Debug data: 2 camera captures on the map.",
  );
  await addDebugFile(page, await editorTour(), "plain.zip");
  await expect(
    page.locator(".toast", {
      hasText:
        "Not added: This file carries no recording: it is neither debug data nor a Recorder zip.",
    }),
  ).toBeVisible();
  // The button is back, idle and enabled, after the refusal (r901
  // review #3): left disabled, it would end the way to add the right file.
  await expect(page.locator("#debug-add")).toHaveText("Add debug data…");
  await expect(page.locator("#debug-add")).toBeEnabled();
  // The layer kept what was added before.
  await expect(page.locator("#debug-status")).toContainText(
    "Added from walk.zip",
  );
  await expect(page.locator(".mk-debug-wrap")).toHaveCount(2);
  await expect(page.locator("#save-status")).toHaveText("No changes");
  await page.locator("#rail .row", { hasText: "Town hall" }).click();
  const field = page.locator("#card textarea");
  await field.fill("Edited beside debug data");
  await field.blur();
  const saved = await saveAndRead(page);
  expect(saved.names.filter((n) => n.startsWith("actions/"))).toEqual([]);
  expect(saved.names.filter((n) => n.startsWith("images/"))).toEqual([]);
  expect(saved.names).not.toContain("session.json");
  expect(saved.names).not.toContain("debug-bundle.json");
});

test("shows debug data dropped on its panel in place of the tour's own walk, and says so", async ({
  page,
}) => {
  // Why (M2 step 5 of the debug-captures plan): the creator chose the
  // added file, so it wins over the walk the tour carries - here a walk
  // whose stream places nothing, so only the added file can draw - and
  // the line says which one the map shows. A drop on the panel adds it as
  // the button does.
  await page.goto("/edit.html");
  await openThroughChooser(page, await wrappedTour(), "wrapped.zip");
  await expect(page.locator("#debug-status")).toContainText(
    "No debug data shown: ",
  );
  const bundle = await debugBundleOf({
    tour: "Wrapped fixture",
    file: "wrapped.zip",
  });
  const dropped = await page.evaluateHandle((bytes) => {
    const data = new DataTransfer();
    data.items.add(
      new File([new Uint8Array(bytes)], "wrapped-debug.zip", {
        type: "application/zip",
      }),
    );
    return data;
  }, Array.from(bundle));
  await page
    .locator("#debug-panel")
    .dispatchEvent("drop", { dataTransfer: dropped });
  await expect(page.locator("#debug-status")).toHaveText(
    "Added from wrapped-debug.zip, not saved with the tour. It is shown in place of the tour's own walk. Debug data: 2 camera captures on the map.",
  );
  await expect(page.locator(".mk-debug-wrap")).toHaveCount(2);
  await expect(page.locator("#save-status")).toHaveText("No changes");
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
  await openAnother(page);
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

test("edits a pin's text and saves a tour that carries it @pr", async ({
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
  await expect(page.locator("#save-status")).toHaveText(
    "1 change not saved - kept in this browser until you save",
  );
  await expect(page.locator("#card")).toContainText("Changed - not saved yet.");
  const saved = await saveAndRead(page);
  expect(saved.name).toBe("editor-fixture.zip");
  const pinSaved = saved.manifest.objects.find(
    (/** @type {{ id: string }} */ o) => o.id === "pin-markup",
  );
  expect(pinSaved.caption).toBe("The new text");
  await expect(page.locator("#save-status")).toHaveText(
    "Saved as editor-fixture.zip",
  );
});

test("Save a copy writes the edits to a new file and leaves the tour's own unsaved", async ({
  page,
}) => {
  // Why: a copy is a second file, not a save: the tour's own file must
  // still be due its changes afterwards (the status, the mark, the next
  // Save), or a creator who made a copy would lose the edits in the file
  // they go on working in.
  await noSavePicker(page);
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await expect(fileItem(page, "saveCopy")).toBeEnabled();
  await page.locator("#rail .row", { hasText: "Town hall" }).click();
  const field = page.locator("#card textarea");
  await field.fill("The copied text");
  await field.blur();
  await expect(page.locator("#save-status")).toHaveText(
    "1 change not saved - kept in this browser until you save",
  );
  await expect(page.locator("#unsaved-mark")).toBeVisible();
  const copy = await saveAndRead(page, (p) => fileCommand(p, "saveCopy"));
  expect(copy.name).toBe("editor-fixture copy.zip");
  const pinCopied = copy.manifest.objects.find(
    (/** @type {{ id: string }} */ o) => o.id === "pin-markup",
  );
  expect(pinCopied.caption).toBe("The copied text");
  await expect(
    page.locator(".toast", {
      hasText: "Saved a copy as editor-fixture copy.zip",
    }),
  ).toBeVisible();
  // The tour's own file is still due the change.
  await expect(page.locator("#save-status")).toHaveText(
    "1 change not saved - kept in this browser until you save",
  );
  await expect(page.locator("#unsaved-mark")).toBeVisible();
  const saved = await saveAndRead(page);
  expect(saved.name).toBe("editor-fixture.zip");
  await expect(page.locator("#unsaved-mark")).toBeHidden();
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

test("counts a pin's text in the card and refuses one past 40 characters", async ({
  page,
}) => {
  // Why: a pin's text is a short text's caption, which the tour file caps
  // at 40 characters, so the card counts it while it is typed and the edit
  // refuses a longer one in the card's words instead of saving a file
  // nothing could read.
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#rail .row", { hasText: "Town hall" }).click();
  const field = page.locator("#card textarea");
  const count = page.locator("#card-text-count");
  await expect(count).toHaveText("38 / 40");
  await expect(field).toHaveAttribute("aria-describedby", "card-text-count");
  await field.fill("x".repeat(41));
  await expect(count).toHaveText("41 / 40");
  await expect(count).toHaveAttribute("data-over", "");
  await field.blur();
  await expect(page.locator("#card")).toContainText(
    "A pin's text takes at most 40 characters.",
  );
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
  await openAnother(page);
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
  await expect(page.locator("#save-status")).toHaveText(
    "1 change not saved - kept in this browser until you save",
  );
  await page.locator("#rail .row", { hasText: "Typed, then a row" }).click();
  await page.locator("#card textarea").fill("Typed, then Save");
  const saved = await saveAndRead(page);
  const pinSaved = saved.manifest.objects.find(
    (/** @type {{ id: string }} */ o) => o.id === "pin-markup",
  );
  expect(pinSaved.caption).toBe("Typed, then Save");
});

test("Ctrl+Enter commits the text, Esc cancels a move", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/edit.html");
  await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#rail .row", { hasText: "Town hall" }).click();
  await page.locator("#card textarea").fill("By keyboard");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator("#save-status")).toHaveText(
    "1 change not saved - kept in this browser until you save",
  );
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
  await expect(page.locator("#save-status")).toHaveText(
    "1 change not saved - kept in this browser until you save",
  );
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
  await save(page);
  await expect(page.locator("#save-status")).toHaveText(
    "Not saved yet - tap Save again",
  );
  await save(page);
  await expect(page.locator("#save-status")).toHaveText(
    "Saved as editor-fixture.zip",
  );
  expect(
    // @ts-expect-error - set by the fake writable.
    await page.evaluate(() => window.__savedBytes),
  ).toBeGreaterThan(0);
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
  await save(page);
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
  // Listening from before the page loads: Playwright starts catching file
  // choosers when the first listener is added, asynchronously, and under
  // load an Enter pressed right after it opened a chooser it had not yet
  // caught (2 of 16 runs beside the layout tests, none of 48 so).
  const chooser = page.waitForEvent("filechooser");
  await page.goto("/edit.html");
  // The button answers once the page script is wired; before, Enter on a
  // button inside a label does nothing.
  await expect(page.locator("body")).toHaveAttribute("data-editor", "ready");
  const choose = page.locator("#choose-btn");
  await choose.focus();
  await expect(choose).toBeFocused();
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
 * The editor fixture opened from a writable file of the origin-private
 * file system (saved in place), autosave out of the way, and the Town
 * hall pin's text changed to `text`.
 * @param {import("@playwright/test").Page} page
 * @param {string} text
 */
async function inPlaceTourEdited(page, text) {
  await autosaveOutOfTheWay(page);
  await page.goto("/edit.html");
  await offerOpfsFile(page, await editorTour(), "editor-fixture.zip");
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-name")).toHaveText("Editor fixture");
  await editPin(page, "Town hall", text);
}

/**
 * The page's save dialog answers with the file `name` of the
 * origin-private file system (made if it is not there).
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
async function savePickerAnswers(page, name) {
  await page.evaluate(async (fileName) => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(fileName, { create: true });
    // @ts-expect-error - the e2e's own save dialog.
    window.showSaveFilePicker = () => Promise.resolve(handle);
  }, name);
}

test("Save a copy refuses the tour's own file, and writes through another file picked", async ({
  page,
}) => {
  // Why: the copy lands in whatever file the save dialog gives. Given the
  // tour's own file it would land over it, and the tour would no longer
  // know what its file holds; so it is refused before anything is built,
  // and nothing is written. Given another file, the copy is written there
  // and the tour's own file and its pending change stay as they were.
  await inPlaceTourEdited(page, "The copied text");
  const status = page.locator("#save-status");
  await expect(status).toHaveText("1 change not saved");
  const before = await readOpfsTour(page, "editor-fixture.zip");
  await savePickerAnswers(page, "editor-fixture.zip");
  await fileCommand(page, "saveCopy");
  await expect(
    page.locator(".toast", {
      hasText:
        "editor-fixture.zip is the tour's own file - save the copy under another name. Nothing was written.",
    }),
  ).toBeVisible();
  expect(await readOpfsTour(page, "editor-fixture.zip")).toEqual(before);
  await expect(status).toHaveText("1 change not saved");
  await savePickerAnswers(page, "another name.zip");
  await fileCommand(page, "saveCopy");
  await expect(
    page.locator(".toast", { hasText: "Saved a copy as another name.zip" }),
  ).toBeVisible();
  const copy = await readOpfsTour(page, "another name.zip");
  expect(copy["tour.json"]).toContain("The copied text");
  expect(await readOpfsTour(page, "editor-fixture.zip")).toEqual(before);
  await expect(status).toHaveText("1 change not saved");
  await expect(page.locator("#unsaved-mark")).toBeVisible();
});

test("Ctrl+S pressed while a copy is being saved saves the tour once the copy is done", async ({
  page,
}) => {
  // Why: a copy holds the page's save slot while it is built. Ctrl+S
  // pressed then must not be dropped in silence: it waits, as it does
  // behind an autosave, and saves the tour into its own file once the
  // copy is done (here: its dialog dismissed).
  await inPlaceTourEdited(page, "Saved after the copy");
  const status = page.locator("#save-status");
  await expect(status).toHaveText("1 change not saved");
  await page.evaluate(() => {
    // @ts-expect-error - the e2e's own save dialog.
    window.showSaveFilePicker = () =>
      new Promise((_resolve, reject) => {
        // @ts-expect-error - called by the test.
        window.__dismiss = () =>
          reject(new DOMException("dismissed", "AbortError"));
      });
  });
  await fileCommand(page, "saveCopy");
  await expect(status).toHaveText("Saving a copy…");
  await page.keyboard.press("Control+s");
  await page.evaluate(() => {
    // @ts-expect-error - set by the held dialog.
    window.__dismiss();
  });
  await expect(status).toHaveText("Saved to editor-fixture.zip");
  expect(
    (await readOpfsTour(page, "editor-fixture.zip"))["tour.json"],
  ).toContain("Saved after the copy");
});

test("a copy leaves the tour's own save due: it says it saves a copy, keeps the unsaved mark, and a step across the file is written after it", async ({
  page,
}) => {
  // Why: a copy holds the page's save slot while it is built, and used to
  // claim it as a save of the tour does: the bottom bar said "Saving…"
  // with the unsaved mark gone, though the tour's own file was not being
  // saved, and the claim took on an undo's due rewrite of the file (D33),
  // which then never came - a reload would have opened the file with the
  // undone change still in it. The page's timers are held while the undo
  // and the copy's click happen, so the copy claims inside the undo's
  // quiet time, as a quick hand's does.
  await page.clock.install();
  await inPlaceTourEdited(page, "Written first");
  await save(page);
  const status = page.locator("#save-status");
  await expect(status).toHaveText("Saved to editor-fixture.zip");
  expect(
    (await readOpfsTour(page, "editor-fixture.zip"))["tour.json"],
  ).toContain("Written first");
  // The copy's save dialog stays open until the test dismisses it.
  await page.evaluate(() => {
    // @ts-expect-error - the e2e's own save dialog.
    window.showSaveFilePicker = () =>
      new Promise((_resolve, reject) => {
        // @ts-expect-error - called by the test.
        window.__dismiss = () =>
          reject(new DOMException("dismissed", "AbortError"));
      });
  });
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);
  await page.keyboard.press("Control+z");
  await expect(status).toHaveText("1 change not saved");
  await fileCommand(page, "saveCopy");
  await expect(status).toHaveText("Saving a copy…");
  await expect(page.locator("#unsaved-mark")).toBeVisible();
  // The undo's quiet time ends while the copy holds the slot.
  await page.clock.runFor(2_000);
  await page.clock.resume();
  await page.evaluate(() => {
    // @ts-expect-error - set by the held dialog.
    window.__dismiss();
  });
  // The undo crossed the file written in place: it is written again.
  await expect(status).toHaveText("Saved to editor-fixture.zip");
  expect(
    (await readOpfsTour(page, "editor-fixture.zip"))["tour.json"],
  ).not.toContain("Written first");
  await expect(page.locator("#unsaved-mark")).toBeHidden();
});

test("saves in place to the file it opened, and keeps the walk recording @pr", async ({
  page,
}) => {
  // Why (M6 E2b-1, E2b plan review #1): where the browser allows it, Save
  // writes the opened file itself - and since that may be the creator's
  // only copy of the walk, an in-place save never leaves the walk out.
  await page.goto("/edit.html");
  await offerOpfsFile(page, await wrappedTour({ pin: true }), "wrapped.zip");
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-name")).toHaveText("Wrapped fixture");
  await expect(fileItem(page, "keepWalk")).toHaveJSProperty("hidden", true);
  await page.locator("#rail .row", { hasText: "Wrapped pin" }).click();
  await page.locator("#card textarea").fill("Saved in place");
  await save(page);
  await expect(page.locator("#save-status")).toHaveText("Saved to wrapped.zip");
  const texts = await readOpfsTour(page, "wrapped.zip");
  expect(texts["mytour/tour.json"]).toContain("Saved in place");
  expect(Object.keys(texts)).toContain("mytour/actions/000001.json");
  expect(Object.keys(texts)).toContain("mytour/images/frame-000002.png");
  // Changed expectation: this test once opened the walk's frame as a
  // "Recorded photo" read from the written file. The frames are debug
  // data now (the format has no field for them), and the frame stays only
  // as part of the walk.
  expect(texts["mytour/tour.json"]).not.toContain("captureSpots");
});

test("refuses to write over a file that changed meanwhile, and offers the download @pr", async ({
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
  await save(page);
  await expect(page.locator("#save-status")).toHaveText("Saved to wrapped.zip");
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const w = await (await root.getFileHandle("wrapped.zip")).createWritable();
    await w.write("another program wrote this");
    await w.close();
  });
  await page.locator("#card textarea").fill("Not over theirs");
  await save(page);
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
  // the start - in every save, a download included: since M2 of the
  // debug-captures plan any other copy leaves the walk out by default, so
  // this rule alone keeps it (seen red with the rule switched off).
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
  await expect(fileItem(second, "keepWalk")).toHaveJSProperty("hidden", true);
  await second.locator("#rail .row", { hasText: "Wrapped pin" }).click();
  await second.locator("#card textarea").fill("A copy first");
  const download = second.waitForEvent("download");
  await save(second);
  const copy = await (await download).path();
  const reader = new ZipReader(
    new Uint8ArrayReader(new Uint8Array(readFileSync(copy))),
  );
  const names = (await reader.getEntries()).map((e) => e.filename);
  await reader.close();
  expect(names).toContain("mytour/actions/000001.json");
  await told.locator("button", { hasText: "Edit here anyway" }).click();
  await second.locator("#card textarea").fill("Then in place");
  await save(second);
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
  await save(page);
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
  await openAnother(page);
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-name")).toHaveText("Wrapped fixture");
  await page.locator("#rail .row", { hasText: "Wrapped pin" }).click();
  await page.locator("#card textarea").fill("Opened twice");
  await save(page);
  await expect(page.locator("#save-status")).toHaveText("Saved to wrapped.zip");
  await expect(
    page.locator(".toast", { hasText: "Another tab is editing" }),
  ).toHaveCount(0);
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
  await save(page);
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
  await save(page);
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
  await openAnother(page);
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-name")).toHaveText("Wrapped fixture");
  await expect(fileItem(page, "keepWalk")).toHaveJSProperty("hidden", true);
  await expect(
    page.locator(".toast", { hasText: "Another tab is editing" }),
  ).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// The editor's draft (M6 E2c): its walks need no view of the tour and run
// without one, in editor-files.spec.js. The pin edit below is the map's,
// for the walks that still edit on the map.
// ---------------------------------------------------------------------------

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

test("saves by itself a few seconds after a change, quietly, and the next open finds no leftover draft @pr", async ({
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
  await save(page);
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
  await expect(fileItem(page, "save")).toBeDisabled();
  await expect.poll(() => writes(page)).toBe(2);
  await page.evaluate(() => {
    // @ts-expect-error - set by the picker.
    window.__release();
  });
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to editor-fixture.zip",
  );
  await expect(fileItem(page, "save")).toBeEnabled();
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
  await expect(fileItem(page, "save")).toBeEnabled();
  await expect(page.locator("#rail .row", { hasText: "Fountain" })).toHaveCount(
    1,
  );
  // Save again delivers it once the disk takes it.
  await page.evaluate(() => {
    // @ts-expect-error - read by the picker.
    window.__failWrites = false;
  });
  await save(page);
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
  await save(page);
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
  await save(page);
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
  await openAnother(page);
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
  await expect(page.locator("#save-status")).toHaveText(
    "2 changes not saved - kept in this browser until you save",
  );
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
  await expect(page.locator("#save-status")).toHaveText(
    "2 changes not saved - kept in this browser until you save",
  );
  await page.keyboard.press("Control+y");
  await expect(last).toHaveText("Nothing to redo.");
  // Typing in the card: Ctrl+Z is the field's.
  await page.locator("#rail .row", { hasText: "First" }).click();
  const field = page.locator("#card textarea");
  await field.focus();
  const said = await page.locator(".toast").count();
  await page.keyboard.press("Control+z");
  await expect(page.locator("#save-status")).toHaveText(
    "2 changes not saved - kept in this browser until you save",
  );
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
  await save(page);
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
  await openAnother(page);
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
  await save(page);
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
  await save(page);
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
  await openAnother(page);
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

test("a Ctrl+S pressed in a tour opened while the last tour's save still ran saves that tour once that save ends", async ({
  page,
}) => {
  // Why: the closed tour's save, ending, dropped every queued Save as if it
  // were its own - but a Ctrl+S pressed after the next tour opened belongs
  // to the tour that shows, and was lost without a word. A copy's and the
  // open's write already run it for the tour that shows; a save must too.
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
  await openAnother(page);
  await offerCountedOpfsFile(page, await editorTour(), "second.zip");
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-file")).toHaveText("second.zip");
  await editTownHall(page, "Saved by Ctrl+S in the second tour");
  await page.keyboard.press("Control+s");
  await page.evaluate(() => {
    // @ts-expect-error - read by the picker.
    window.__holdWrites = false;
    // @ts-expect-error - set by the held write.
    window.__release();
  });
  // No clock advance: the autosave cannot be what saves it - the Ctrl+S is.
  await expect(page.locator("#save-status")).toHaveText("Saved to second.zip");
  await expect(
    page.locator(".toast", { hasText: "Saved to second.zip" }),
  ).toBeVisible();
  expect((await readOpfsTour(page, "second.zip"))["tour.json"]).toContain(
    "Saved by Ctrl+S in the second tour",
  );
});

test("a Ctrl+S pressed in a tour opened while the last tour's Ctrl+S save still ran saves that tour once that save ends", async ({
  page,
}) => {
  // Why: an open keeps who holds the save slot, so the closed tour's
  // explicit save still reads as "explicit" - and a Ctrl+S was dropped as
  // "the same Save" although it was pressed in another tour. The earlier
  // fix covered the autosave holding the slot; this is the Ctrl+S one.
  // The autosave is held off (an installed clock still runs its timers),
  // so it cannot take the write and pass the test by another path.
  await autosaveOutOfTheWay(page);
  await page.clock.install();
  await page.goto("/edit.html");
  await offerCountedOpfsFile(page, await editorTour(), "editor-fixture.zip");
  await page.evaluate(() => {
    // @ts-expect-error - read by the picker.
    window.__holdWrites = true;
  });
  await page.locator("#choose-btn").click();
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "idle");
  await editTownHall(page, "Saved by Ctrl+S in the first tour");
  await page.keyboard.press("Control+s");
  await page.waitForFunction(
    // @ts-expect-error - set by the held write.
    () => typeof window.__release === "function",
  );
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await openAnother(page);
  await offerCountedOpfsFile(page, await editorTour(), "second.zip");
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-file")).toHaveText("second.zip");
  await editTownHall(page, "Saved by Ctrl+S in the second tour");
  await page.keyboard.press("Control+s");
  await page.evaluate(() => {
    // @ts-expect-error - read by the picker.
    window.__holdWrites = false;
    // @ts-expect-error - set by the held write.
    window.__release();
  });
  // The autosave held off, and the toast only a Save gives: the autosave
  // cannot be what saves it - the Ctrl+S is.
  await expect(page.locator("#save-status")).toHaveText("Saved to second.zip");
  await expect(
    page.locator(".toast", { hasText: "Saved to second.zip" }),
  ).toBeVisible();
  expect((await readOpfsTour(page, "second.zip"))["tour.json"]).toContain(
    "Saved by Ctrl+S in the second tour",
  );
});

test("a Ctrl+S pressed in the sample while its file waits for the last tour's save is saved into that file once it is adopted", async ({
  page,
}) => {
  // Why (a PR review finding): the sample's open-time write into the file
  // its click chose waits for the save slot. The closed tour's save, ending,
  // ran the Ctrl+S queued in the sample before that write claimed the slot:
  // the sample had no file yet, so it said "Press Save to choose where to
  // save the tour." and dropped the Save - and the write then put the
  // unedited sample into the file. The queued Save must wait for the
  // adopted file and then save the edit into it.
  await autosaveOutOfTheWay(page);
  await page.clock.install();
  await page.goto("/edit.html");
  await offerCountedOpfsFile(page, await editorTour(), "editor-fixture.zip");
  await page.evaluate(() => {
    // @ts-expect-error - read by the picker.
    window.__holdWrites = true;
  });
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-file")).toHaveText("editor-fixture.zip");
  await editTownHall(page, "Saved by Ctrl+S in the first tour");
  await page.keyboard.press("Control+s");
  await page.waitForFunction(
    // @ts-expect-error - set by the held write.
    () => typeof window.__release === "function",
  );
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await openAnother(page);
  await clickBoundSavePicker(page, "my-sample.zip");
  await page.locator("#sample-btn").click();
  await expect(page.locator("#topbar")).toBeVisible({ timeout: 15000 });
  await page.locator("#no-gps-input").check();
  await page.keyboard.press("Control+s");
  await page.evaluate(() => {
    // @ts-expect-error - read by the picker.
    window.__holdWrites = false;
    // @ts-expect-error - set by the held write.
    window.__release();
  });
  await expect(page.locator("#tour-file")).toHaveText("my-sample.zip");
  // The autosave is an hour away: only the queued Ctrl+S can save the edit.
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to my-sample.zip",
  );
  expect(tourJsonOf(await readOpfsTour(page, "my-sample.zip"))).toContain(
    '"needsNoGps": true',
  );
  await expect(
    page.locator(".toast", { hasText: "Press Save to choose" }),
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
  await save(page);
  await expect(page.locator("#save-status")).toHaveText("Saved to nogps.zip");
  // The save's refresh drew the same words: the node stays, so a screen
  // reader does not announce the warning again.
  expect(await line?.evaluate((node) => node.isConnected)).toBe(true);
  expect(await savedManifest(page, "nogps.zip")).toMatchObject({
    version: 4,
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
  await save(next);
  await expect(next.locator("#save-status")).toHaveText("Saved to nogps.zip");
  const off = await savedManifest(next, "nogps.zip");
  expect(off).not.toHaveProperty("needsNoGps");
  expect(off).toMatchObject({ version: 4, minor: 0 });
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
  await expect(page.locator("#save-status")).toHaveText(
    "1 change not saved - kept in this browser until you save",
  );
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
  await expect(next.locator("#save-status")).toHaveText(
    "1 change not saved - kept in this browser until you save",
  );
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
  await expect(page.locator("#save-status")).toHaveText(
    "4 changes not saved - kept in this browser until you save",
  );
  const saved = await saveAndRead(page);
  expect(saved.manifest).toMatchObject({
    version: 4,
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
  await expect(page.locator("#save-status")).toHaveText(
    "1 change not saved - kept in this browser until you save",
  );
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
// updated, and "Move the debug data out" (the walk, written as the debug
// bundle since M2 of the debug-captures plan).
// ---------------------------------------------------------------------------

test("Done saves what is pending, says where it is and how to update the tour, and moves the walk out into a file of its own @pr", async ({
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
  await publish(page);
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
  await expect(done.locator('a[href="/legal/#privacy"]')).toBeVisible();
  // No save dialog in this browser: the walk is downloaded, and the tour
  // keeps it until a second click says the download arrived (the M4b
  // milestone review #2: a started download is not a landed one).
  const download = page.waitForEvent("download");
  const move = page.locator("#done-move");
  await move.click();
  const walkFile = await download;
  // Changed expectation (M2 of the debug-captures plan): the walk's own
  // zip and its about-this-walk.txt are the debug bundle now - its
  // identity, its note and the name the phone gives it too.
  expect(walkFile.suggestedFilename()).toBe("wrapped-debug.zip");
  // The whole recording - every frame - and the note naming the tour (the
  // M4b milestone review #8).
  expect(await downloadedNames(walkFile)).toEqual([
    "about-this-debug-data.txt",
    "debug-bundle.json",
    "mytour/actions/000001.json",
    "mytour/images/frame-000002.png",
    "mytour/session.json",
  ]);
  await expect(page.locator("#done-move-status")).toContainText(
    "The debug data was downloaded as wrapped-debug.zip",
  );
  await expect(move).toHaveText("Take the debug data out of the tour");
  expect(Object.keys(await readOpfsTour(page, "wrapped.zip"))).toContain(
    "mytour/actions/000001.json",
  );
  await move.click();
  await expect(page.locator("#done-move-status")).toContainText(
    "The debug data is in wrapped-debug.zip",
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
  // The item that opened it is in the closed menu: its button.
  await expect(page.locator("#file-menu-btn")).toBeFocused();
  // The next save keeps the walk of the bytes it rebuilds from: none.
  await editPin(page, "Done saves this", "After the move");
  await save(page);
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
  const doneButton = fileItem(page, "publish");
  await publish(page);
  // The menu closed on the click: the save shows in the status line, and
  // the item says it too, should the menu open again.
  await expect(page.locator("#save-status")).toHaveText("Saving…");
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
    page.locator(".toast", { hasText: "Not ready to share yet" }),
  ).toBeVisible();
  await expect(doneButton).toHaveText("Share and publish…");
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
  await publish(page);
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
  await expect(move).toHaveText("Move the debug data out");
  expect(await readOpfsTour(page, "wrapped.zip")).toEqual(before);
  // ... and the next save still carries the walk (the M4b milestone
  // review #7: a failed move must leave nothing behind that drops it).
  await page.locator("#done-close").click();
  await editPin(page, "Held, then failed", "Saved after a dismissed move");
  await save(page);
  await expect(page.locator("#save-status")).toHaveText("Saved to wrapped.zip");
  expect(Object.keys(await readOpfsTour(page, "wrapped.zip"))).toContain(
    "mytour/actions/000001.json",
  );
  await publish(page);
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
  expect((await download).suggestedFilename()).toBe("wrapped-debug.zip");
  await expect(move).toHaveText("Take the debug data out of the tour");
  await move.click();
  await expect(page.locator("#done-move-status")).toContainText(
    "keeps its debug data",
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
  await save(page);
  await expect(page.locator("#save-status")).toHaveText("Saved to wrapped.zip");
  const after = await readOpfsTour(page, "wrapped.zip");
  expect(after["mytour/tour.json"]).toContain("Saved after a failed move");
  expect(Object.keys(after)).toContain("mytour/actions/000001.json");
});

/**
 * A stand-in for the browser's save dialog that behaves as Chromium's
 * does: it opens only during the click that asked for it (a call after an
 * await of seconds is refused with a SecurityError), and it hands back a
 * real file of the origin-private file system, `name`. A key press counts
 * as a click (Ctrl+S is a gesture too). `hold` keeps the dialog open until
 * `window.__releaseWalkPick()`; `dismiss` has the creator dismiss it (an
 * AbortError - only inside the gesture: outside it the refusal comes
 * first); `unreadable` hands back the file as a handle that writes but
 * cannot be read back (`getFile` refuses); `failWrite` as one whose
 * every write is refused at its close (a full disk), the file left as it
 * was; `seed`: the text the file already holds, as an existing file
 * picked to be replaced does (else it is empty, as the browser makes a
 * new one on the pick).
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 * @param {{ hold?: boolean, dismiss?: boolean, unreadable?: boolean, failWrite?: boolean, seed?: string }} [options]
 */
async function clickBoundSavePicker(page, name, options = {}) {
  await page.evaluate(
    async ({ fileName, hold, dismiss, unreadable, failWrite, seed }) => {
      const root = await navigator.storage.getDirectory();
      const real = await root.getFileHandle(fileName, { create: true });
      if (seed !== null) {
        const seeding = await real.createWritable();
        await seeding.write(seed);
        await seeding.close();
      }
      const failing = {
        kind: "file",
        name: real.name,
        createWritable: async () => {
          const writable = await real.createWritable();
          return {
            write: (/** @type {Blob} */ data) => writable.write(data),
            close: async () => {
              await writable.abort();
              throw new DOMException(
                "There is not enough space on the disk.",
                "QuotaExceededError",
              );
            },
            abort: () => Promise.resolve(),
          };
        },
        getFile: () => real.getFile(),
        remove: () => real.remove(),
        isSameEntry: (/** @type {FileSystemHandle} */ other) =>
          real.isSameEntry(other),
      };
      const handle = failWrite
        ? failing
        : unreadable
          ? {
              kind: "file",
              name: real.name,
              createWritable: () => real.createWritable(),
              getFile: () =>
                Promise.reject(
                  new DOMException(
                    "the file could not be read",
                    "NotReadableError",
                  ),
                ),
              isSameEntry: (/** @type {FileSystemHandle} */ other) =>
                real.isSameEntry(other),
            }
          : real;
      let inClick = false;
      for (const type of ["click", "keydown"]) {
        document.addEventListener(
          type,
          () => {
            inClick = true;
            setTimeout(() => {
              inClick = false;
            }, 0);
          },
          true,
        );
      }
      // @ts-expect-error - read by the test.
      window.__walkPicks = 0;
      // @ts-expect-error - read by the test: the names each call suggested.
      window.__walkPickNames = [];
      // @ts-expect-error - the e2e's own save dialog.
      window.showSaveFilePicker = (
        /** @type {{ suggestedName?: string } | undefined} */ asked,
      ) => {
        // @ts-expect-error - counted for the test.
        window.__walkPicks += 1;
        // @ts-expect-error - recorded for the test.
        window.__walkPickNames.push(asked?.suggestedName ?? null);
        if (!inClick) {
          return Promise.reject(
            new DOMException(
              "Must be handling a user gesture",
              "SecurityError",
            ),
          );
        }
        if (dismiss) {
          return Promise.reject(
            new DOMException("The user aborted a request.", "AbortError"),
          );
        }
        if (!hold) return Promise.resolve(handle);
        return new Promise((resolve) => {
          // @ts-expect-error - called by the test.
          window.__releaseWalkPick = () => resolve(handle);
        });
      };
    },
    {
      fileName: name,
      hold: options.hold === true,
      dismiss: options.dismiss === true,
      unreadable: options.unreadable === true,
      failWrite: options.failWrite === true,
      seed: options.seed ?? null,
    },
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
  await publish(page);
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
  await clickBoundSavePicker(page, "wrapped-debug.zip");
  await page.locator("#done-move").click();
  await expect(page.locator("#done-move-status")).toContainText(
    "The debug data is in wrapped-debug.zip",
  );
  // @ts-expect-error - counted by the stand-in.
  expect(await page.evaluate(() => window.__walkPicks)).toBe(1);
  const walk = await readOpfsTour(page, "wrapped-debug.zip");
  expect(Object.keys(walk).sort()).toEqual([
    "about-this-debug-data.txt",
    "debug-bundle.json",
    "mytour/actions/000001.json",
    "mytour/images/frame-000002.png",
    "mytour/session.json",
  ]);
  expect(walk["about-this-debug-data.txt"]).toContain("wrapped.zip");
  expect(JSON.parse(walk["debug-bundle.json"] ?? "")).toMatchObject({
    format: 1,
    seriesId: null,
    tour: "Wrapped fixture",
    file: "wrapped.zip",
  });
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
  await clickBoundSavePicker(page, "wrapped-debug.zip", { hold: true });
  await page.locator("#done-move").click();
  await expect(page.locator("#done-move")).toHaveText(
    "Moving the debug data out…",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator("#done-modal")).toBeVisible();
  await expect(page.locator("#done-close")).toBeDisabled();
  await expect(fileItem(page, "publish")).toBeDisabled();
  await page.evaluate(() => {
    // @ts-expect-error - set by the stand-in.
    window.__releaseWalkPick();
  });
  await expect(page.locator("#done-move-status")).toContainText(
    "The debug data is in wrapped-debug.zip",
  );
  await expect(page.locator("#done-close")).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.locator("#done-modal")).toBeHidden();
  // Done works again, and its dialog knows the walk is gone.
  await publish(page);
  await expect(page.locator("#done-modal")).toBeVisible();
  await expect(page.locator("#done-walk")).toBeHidden();
});

test("a Ctrl+S pressed in a tour opened while the last tour's debug data was moved saves that tour once the move ends", async ({
  page,
}) => {
  // Why: the move's end ran a queued Save only when its own tour still
  // showed. A tour dropped mid-move (a late integrity failure) lets the
  // creator open the next tour while the move still holds the save, and a
  // Ctrl+S pressed there was lost without a word - a save's, a copy's and
  // an open's end already run it for the tour that shows; a move must too.
  await autosaveOutOfTheWay(page);
  await doneWithWrappedTour(page);
  await clickBoundSavePicker(page, "wrapped-debug.zip", { hold: true });
  await page.locator("#done-move").click();
  await expect(page.locator("#done-move")).toHaveText(
    "Moving the debug data out…",
  );
  // The tour goes mid-move, as a late integrity failure takes it.
  await page.evaluate(() => {
    // @ts-expect-error - the dev server's test hook.
    window.__tourEditor.dropTour("The tour file is damaged.");
  });
  await expect(page.locator("#done-modal")).toBeHidden();
  await offerOpfsFile(page, await editorTour(), "second.zip");
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-file")).toHaveText("second.zip");
  await editTownHall(page, "Saved by Ctrl+S during the move");
  await page.keyboard.press("Control+s");
  // Queued behind the move, which still holds the save: nothing written.
  await expect(page.locator("#save-status")).toHaveText("Saving…");
  expect((await readOpfsTour(page, "second.zip"))["tour.json"]).not.toContain(
    "Saved by Ctrl+S during the move",
  );
  await page.evaluate(() => {
    // @ts-expect-error - set by the stand-in.
    window.__releaseWalkPick();
  });
  // The autosave is out of the way: only the Ctrl+S can save it.
  await expect(page.locator("#save-status")).toHaveText("Saved to second.zip");
  expect((await readOpfsTour(page, "second.zip"))["tour.json"]).toContain(
    "Saved by Ctrl+S during the move",
  );
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
  await expect(page.locator("#done-move")).toHaveText(
    "Move the debug data out",
  );
  expect(await readOpfsTour(page, "wrapped.zip")).toEqual(before);
  expect(Object.keys(before)).toContain("mytour/actions/000001.json");
});

/**
 * A tour carrying a walk opened from a file the page may not write, with
 * one edit saved as a lean download - the default (M2 of the
 * debug-captures plan) - and Done open on it.
 * @param {import("@playwright/test").Page} page
 */
async function doneAfterLeanDownload(page) {
  await autosaveOutOfTheWay(page);
  await noSavePicker(page);
  await page.goto("/edit.html");
  await openThroughChooser(
    page,
    await wrappedTour({ pin: true }),
    "wrapped.zip",
  );
  await expect(page.locator("#tour-name")).toHaveText("Wrapped fixture");
  await editPin(page, "Wrapped pin", "Saved lean");
  const lean = page.waitForEvent("download");
  await save(page);
  expect(await downloadedNames(await lean)).not.toContain(
    "mytour/actions/000001.json",
  );
  await publish(page);
  await expect(page.locator("#done-modal")).toBeVisible();
}

test("after a lean download, Done offers to save the debug data from the opened file, and downloads it as the debug bundle", async ({
  page,
}) => {
  // Why (M2 of the debug-captures plan): the copy a creator
  // keeps leaves the walk out by default, so the walk may be in the opened
  // file only - Done says so and saves it apart, read from that file (the
  // newest bytes carry none, and the move would refuse).
  await doneAfterLeanDownload(page);
  await expect(page.locator("#done-walk-text")).toContainText(
    "wrapped.zip leaves out your debug data",
  );
  await expect(page.locator("#done-move")).toBeHidden();
  const save = page.locator("#done-save-debug");
  await expect(save).toHaveText("Save the debug data");
  const download = page.waitForEvent("download");
  await save.click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("wrapped-debug.zip");
  expect(await downloadedNames(file)).toEqual([
    "about-this-debug-data.txt",
    "debug-bundle.json",
    "mytour/actions/000001.json",
    "mytour/images/frame-000002.png",
    "mytour/session.json",
  ]);
  await expect(page.locator("#done-move-status")).toHaveText(
    "The debug data is in wrapped-debug.zip - keep that file.",
  );
  await expect(save).toHaveText("Save the debug data again");
  await expect(save).toBeEnabled();
});

test("after a lean download, its toast says to save the debug data first, and its button saves it", async ({
  page,
}) => {
  // Why (r901 review #1): "Save the debug data" reads the opened file, so
  // a toast that first said "put it in place of the old file" led the
  // creator to overwrite the only copy of the walk before saving it. The
  // toast now puts the debug-data step first and offers the save itself.
  await autosaveOutOfTheWay(page);
  await noSavePicker(page);
  await page.goto("/edit.html");
  await openThroughChooser(
    page,
    await wrappedTour({ pin: true }),
    "wrapped.zip",
  );
  await expect(page.locator("#tour-name")).toHaveText("Wrapped fixture");
  await editPin(page, "Wrapped pin", "Saved lean");
  const lean = page.waitForEvent("download");
  await save(page);
  await lean;
  const saved = page.locator(".toast", {
    hasText: "leaves out the debug data",
  });
  await expect(saved).toContainText(
    "Save the debug data first, before you put this copy in place",
  );
  const download = page.waitForEvent("download");
  await saved
    .getByRole("button", { name: "Save the debug data", exact: true })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("wrapped-debug.zip");
  expect(await downloadedNames(file)).toContain("debug-bundle.json");
  await expect(
    page.locator(".toast", {
      hasText: "The debug data is in wrapped-debug.zip - keep that file.",
    }),
  ).toHaveCount(1);
  await expect(
    saved.getByRole("button", { name: "Save the debug data again" }),
  ).toBeEnabled();
});

test("Save the debug data asks for its file on the click, and writes the bundle there", async ({
  page,
}) => {
  // Why: as the move's, the save dialog must open within the click - the
  // bundle's build takes longer than Chromium waits - and a dismissed one
  // saves nothing.
  await doneAfterLeanDownload(page);
  await clickBoundSavePicker(page, "wrapped-debug.zip");
  await page.locator("#done-save-debug").click();
  await expect(page.locator("#done-move-status")).toHaveText(
    "The debug data is in wrapped-debug.zip - keep that file.",
  );
  // @ts-expect-error - counted by the stand-in.
  expect(await page.evaluate(() => window.__walkPicks)).toBe(1);
  const bundle = await readOpfsTour(page, "wrapped-debug.zip");
  expect(Object.keys(bundle).sort()).toEqual([
    "about-this-debug-data.txt",
    "debug-bundle.json",
    "mytour/actions/000001.json",
    "mytour/images/frame-000002.png",
    "mytour/session.json",
  ]);
  expect(JSON.parse(bundle["debug-bundle.json"] ?? "")).toMatchObject({
    format: 1,
    tour: "Wrapped fixture",
    file: "wrapped.zip",
  });
});

test("Save the debug data refuses the opened tour's own file as its target, and writes nothing", async ({
  page,
}) => {
  // Why (r901 review #5): the debug data is read from the opened file, so
  // a bundle written over it would leave the walk in neither file. As the
  // move does, the save refuses it before anything is written; opened
  // through the file input, the file is told by its name.
  await doneAfterLeanDownload(page);
  await clickBoundSavePicker(page, "wrapped.zip");
  const save = page.locator("#done-save-debug");
  await save.click();
  await expect(page.locator("#done-move-status")).toContainText(
    "wrapped.zip has the name of the tour file you opened",
  );
  await expect(save).toHaveText("Save the debug data");
  await expect(save).toBeEnabled();
  // The stand-in dialog's file stayed as it made it: empty.
  expect(
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      return (await (await root.getFileHandle("wrapped.zip")).getFile()).size;
    }),
  ).toBe(0);
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
  await publish(page);
  await expect(page.locator("#done-modal")).toBeVisible();
  await clickBoundSavePicker(page, "wrapped-debug.zip");
  const move = page.locator("#done-move");
  await move.click();
  await expect(page.locator("#done-move-status")).toContainText(
    "The debug data is in wrapped-debug.zip - keep that file.",
  );
  await expect(move).toHaveText("Download the tour without the debug data");
  expect(Object.keys(await readOpfsTour(page, "wrapped-debug.zip"))).toContain(
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

test("a tour without a file is saved into the file its first Save asks for, and from then on in place and by itself @pr", async ({
  page,
}) => {
  // Why: a tour opened from a link, the sample or a drop used to be
  // downloaded as a new copy at every Save, to be put in place by hand,
  // and nothing saved by itself. Where the browser has both file dialogs,
  // the first Save asks for the file IN its click (a dialog asked for
  // after the build is refused) and the page then keeps that file as the
  // tour's: a later edit is saved into it without a second dialog.
  await page.addInitScript(() => {
    // Put back after the suite's own init script took it away: this
    // browser has both dialogs.
    /** @type {any} */ (window).showOpenFilePicker = () =>
      Promise.reject(new DOMException("not in this test", "AbortError"));
    // Counted: the open asks once to keep the site's storage (the drafts).
    Reflect.set(window, "__persistCalls", 0);
    const persist = navigator.storage.persist.bind(navigator.storage);
    navigator.storage.persist = () => {
      Reflect.set(
        window,
        "__persistCalls",
        Reflect.get(window, "__persistCalls") + 1,
      );
      return persist();
    };
  });
  await page.clock.install();
  await page.goto("/edit.html");
  await expect(page.locator("#open-fineprint")).toContainText(
    "asks where to save it as it opens (or at its first Save)",
  );
  await dropOnDropBox(page, await editorTour(), "editor-fixture.zip");
  await expect(page.locator("#tour-name")).toHaveText("Editor fixture");
  expect(await page.evaluate(() => Reflect.get(window, "__persistCalls"))).toBe(
    1,
  );
  await clickBoundSavePicker(page, "saved-tour.zip");
  await page.locator("#rail .row", { hasText: "Town hall" }).click();
  await page.locator("#card textarea").fill("Saved into the chosen file");
  let downloads = 0;
  page.on("download", () => {
    downloads += 1;
  });
  await save(page);
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to saved-tour.zip",
  );
  // One dialog, opened inside the click (the stand-in refuses one outside
  // it), and no download.
  expect(await page.evaluate(() => Reflect.get(window, "__walkPicks"))).toBe(1);
  expect(downloads).toBe(0);
  const first = await readOpfsTour(page, "saved-tour.zip");
  expect(first["tour.json"]).toContain("Saved into the chosen file");
  // A second edit saves by itself, into the same file, with no dialog.
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "idle");
  await editPin(page, "Saved into the chosen file", "Saved by itself");
  await expect(page.locator("body")).toHaveAttribute(
    "data-autosave",
    "waiting",
  );
  await page.clock.runFor(3_500);
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "idle");
  expect((await readOpfsTour(page, "saved-tour.zip"))["tour.json"]).toContain(
    "Saved by itself",
  );
  expect(await page.evaluate(() => Reflect.get(window, "__walkPicks"))).toBe(1);
  expect(downloads).toBe(0);
});

test("a tour without a file whose save dialog was dismissed keeps its save for Save again", async ({
  page,
}) => {
  // Why: a dismissed dialog must not lose the save, nor fall back to a
  // download the creator did not ask for. The stand-in dialog is
  // dismissed only when asked for inside the click; asked for later (after
  // the build, as Chromium refuses it) it is refused, and the page would
  // download - so this fails if the dialog stops being asked for in the
  // click.
  await withBothDialogs(page);
  await page.goto("/edit.html");
  await dropOnDropBox(page, await editorTour(), "editor-fixture.zip");
  await expect(page.locator("#tour-name")).toHaveText("Editor fixture");
  await clickBoundSavePicker(page, "never-written.zip", { dismiss: true });
  await editTownHall(page, "Not yet saved");
  let downloads = 0;
  page.on("download", () => {
    downloads += 1;
  });
  await save(page);
  await expect(page.locator("#save-status")).toHaveText(
    "Not saved yet - tap Save again",
  );
  expect(await page.evaluate(() => Reflect.get(window, "__walkPicks"))).toBe(1);
  expect(downloads).toBe(0);
});

/**
 * A tour without a file, opened by a drop where the browser has both file
 * dialogs, with the Town hall pin edited to `text`; the save dialog is the
 * click-bound stand-in giving `saved-tour.zip`. Downloads are counted.
 * @param {import("@playwright/test").Page} page
 * @param {string} text
 * @param {{ unreadable?: boolean }} [options]
 */
async function droppedTourEdited(page, text, options = {}) {
  await withBothDialogs(page);
  await autosaveOutOfTheWay(page);
  await page.goto("/edit.html");
  await dropOnDropBox(page, await editorTour(), "editor-fixture.zip");
  await expect(page.locator("#tour-name")).toHaveText("Editor fixture");
  await clickBoundSavePicker(page, "saved-tour.zip", options);
  await editTownHall(page, text);
  const counted = { downloads: 0 };
  page.on("download", () => {
    counted.downloads += 1;
  });
  return counted;
}

test("Ctrl+S on a tour without a file asks for its file inside the key press", async ({
  page,
}) => {
  // Why: Ctrl+S is the other way to Save, and Chromium opens the save
  // dialog only within the gesture that asked for it. Asked for after the
  // build, the stand-in refuses it and the page downloads a copy instead.
  const counted = await droppedTourEdited(page, "Saved by the keys");
  await page.keyboard.press("Control+s");
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to saved-tour.zip",
  );
  expect(await page.evaluate(() => Reflect.get(window, "__walkPicks"))).toBe(1);
  expect(counted.downloads).toBe(0);
  expect((await readOpfsTour(page, "saved-tour.zip"))["tour.json"]).toContain(
    "Saved by the keys",
  );
});

test("Done on a tour without a file asks for its file inside its click, and says the changes are in the file chosen then", async ({
  page,
}) => {
  // Why: Done saves what is pending before its dialog opens, so it too
  // must ask for the file within its click. Its dialog then names that
  // file as the one chosen at the first Save - never "the file you
  // opened", which a tour from a link, the sample or a drop does not have.
  const counted = await droppedTourEdited(page, "Saved by Done");
  await publish(page);
  await expect(page.locator("#done-modal")).toBeVisible();
  await expect(page.locator("#done-where")).toHaveText(
    "Your changes are saved in saved-tour.zip, the file you chose when you first saved.",
  );
  expect(await page.evaluate(() => Reflect.get(window, "__walkPicks"))).toBe(1);
  expect(counted.downloads).toBe(0);
  expect((await readOpfsTour(page, "saved-tour.zip"))["tour.json"]).toContain(
    "Saved by Done",
  );
});

test("a first Save whose chosen file cannot be read back says the tour was saved, and that the next Save asks again", async ({
  page,
}) => {
  // Why: the file the first Save wrote is read back to keep saving into
  // it. When that read fails, the tour is saved all the same, but later
  // saves cannot go there by themselves - said in words, or the creator
  // would wait for an autosave that never comes.
  await droppedTourEdited(page, "Saved, not kept", { unreadable: true });
  await save(page);
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to saved-tour.zip",
  );
  await expect(
    page.locator(".toast", {
      hasText:
        "Your tour is saved in saved-tour.zip, but the editor could not keep saving into that file",
    }),
  ).toContainText("so the next Save asks for a file again");
  expect((await readOpfsTour(page, "saved-tour.zip"))["tour.json"]).toContain(
    "Saved, not kept",
  );
  await editPin(page, "Saved, not kept", "Saved again");
  await save(page);
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to saved-tour.zip",
  );
  expect(await page.evaluate(() => Reflect.get(window, "__walkPicks"))).toBe(2);
});

/**
 * The browser has both file dialogs: the open dialog is put back (the
 * suite's own init script took it away) as a stand-in no test here
 * answers, so the first Save of a dropped tour asks for its file.
 * @param {import("@playwright/test").Page} page
 */
async function withBothDialogs(page) {
  await page.addInitScript(() => {
    /** @type {any} */ (window).showOpenFilePicker = () =>
      Promise.reject(new DOMException("not in this test", "AbortError"));
  });
}

test("the first Save of a tour without a file keeps its walk in the file it asks for, and Done says the walk is there", async ({
  page,
}) => {
  // Why: the file the first Save asks for becomes the tour's own file,
  // saved into in place from then on - and an in-place save never leaves
  // the walk out, since that file may become the creator's only copy of
  // it. The first write once left it out, and since the file then counted
  // as in place, nothing offered to save the walk apart either.
  await withBothDialogs(page);
  await autosaveOutOfTheWay(page);
  await page.goto("/edit.html");
  await dropOnDropBox(page, await wrappedTour({ pin: true }), "wrapped.zip");
  await expect(page.locator("#tour-name")).toHaveText("Wrapped fixture");
  await clickBoundSavePicker(page, "saved-wrapped.zip");
  await editPin(page, "Wrapped pin", "Saved with the walk");
  await save(page);
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to saved-wrapped.zip",
  );
  const saved = await readOpfsTour(page, "saved-wrapped.zip");
  expect(saved["mytour/tour.json"]).toContain("Saved with the walk");
  expect(Object.keys(saved)).toContain("mytour/actions/000001.json");
  expect(Object.keys(saved)).toContain("mytour/images/frame-000002.png");
  await publish(page);
  await expect(page.locator("#done-modal")).toBeVisible();
  await expect(page.locator("#done-walk-text")).toContainText(
    "saved-wrapped.zip also carries your debug data",
  );
  await expect(page.locator("#done-move")).toBeVisible();
});

test("an undo across the first save into a chosen file writes that file again", async ({
  page,
}) => {
  // Why (D33): the file the first Save asked for is written in place, so
  // an undo across that save must write it again - a reload would
  // otherwise read a file holding a change the editor no longer shows.
  // The first write was once not counted as in place, and the undo then
  // waited for a later save.
  await withBothDialogs(page);
  await autosaveOutOfTheWay(page);
  await page.goto("/edit.html");
  await dropOnDropBox(page, await editorTour(), "editor-fixture.zip");
  await expect(page.locator("#tour-name")).toHaveText("Editor fixture");
  await clickBoundSavePicker(page, "saved-tour.zip");
  await editTownHall(page, "Saved, then undone");
  await save(page);
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to saved-tour.zip",
  );
  // Adopted: the page saves by itself into it now.
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "idle");
  expect((await readOpfsTour(page, "saved-tour.zip"))["tour.json"]).toContain(
    "Saved, then undone",
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".toast").last()).toHaveText(
    'Undone: the text of "Saved, then undone".',
  );
  await expect
    .poll(
      async () =>
        (await readOpfsTour(page, "saved-tour.zip"))["tour.json"] ?? "",
    )
    .not.toContain("Saved, then undone");
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to saved-tour.zip",
  );
});

/**
 * Open `buffer` by dropping it on the drop box: a tour without a file
 * handle, opened while the browser's open dialog is in place (the chooser
 * would go through that dialog).
 * @param {import("@playwright/test").Page} page
 * @param {Buffer} buffer
 * @param {string} name
 */
async function dropOnDropBox(page, buffer, name) {
  await page.evaluate(
    ({ bytes, fileName }) => {
      const data = new DataTransfer();
      data.items.add(
        new File([new Uint8Array(bytes)], fileName, {
          type: "application/zip",
        }),
      );
      const target = document.getElementById("drop");
      if (target === null) throw new Error("no drop box");
      for (const type of ["dragover", "drop"]) {
        target.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: data,
          }),
        );
      }
    },
    { bytes: [...buffer], fileName: name },
  );
}

/**
 * A saved tour's manifest text, whether the zip holds it at its root or in
 * a folder.
 * @param {Record<string, string>} texts
 */
function tourJsonOf(texts) {
  const key = Object.keys(texts).find(
    (name) => name === "tour.json" || name.endsWith("/tour.json"),
  );
  return key === undefined ? "" : texts[key];
}

/** The link a tour is opened from in the open-from-a-link tests. */
const LINKED_TOUR = "http://127.0.0.1:5197/ranges-ok/sample-tour.zip";

/**
 * A stand-in save dialog (as `clickBoundSavePicker`, bound to the click)
 * whose file's write is held until `window.__releaseWrite()`: the page's
 * state while it writes can be seen. The names it was asked to suggest are
 * kept in `window.__savePickNames`.
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
async function heldWriteSavePicker(page, name) {
  await page.evaluate(async (fileName) => {
    const root = await navigator.storage.getDirectory();
    const real = await root.getFileHandle(fileName, { create: true });
    /** @type {() => void} */
    let release = () => undefined;
    const held = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    // @ts-expect-error - called by the test.
    window.__releaseWrite = release;
    const handle = {
      kind: "file",
      name: real.name,
      createWritable: async () => {
        const writable = await real.createWritable();
        return {
          write: (/** @type {Blob} */ data) => writable.write(data),
          close: async () => {
            await held;
            await writable.close();
          },
          abort: () => writable.abort(),
        };
      },
      getFile: () => real.getFile(),
      isSameEntry: (/** @type {FileSystemHandle} */ other) =>
        real.isSameEntry(other),
    };
    let inClick = false;
    for (const type of ["click", "keydown"]) {
      document.addEventListener(
        type,
        () => {
          inClick = true;
          setTimeout(() => {
            inClick = false;
          }, 0);
        },
        true,
      );
    }
    // @ts-expect-error - read by the test.
    window.__savePickNames = [];
    // @ts-expect-error - the e2e's own save dialog.
    window.showSaveFilePicker = (/** @type {any} */ options) => {
      // @ts-expect-error - kept for the test.
      window.__savePickNames.push(options?.suggestedName);
      if (!inClick) {
        return Promise.reject(
          new DOMException("Must be handling a user gesture", "SecurityError"),
        );
      }
      return Promise.resolve(handle);
    };
  }, name);
}

/**
 * The size (bytes) of a file of the page's origin-private file system.
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
function opfsSize(page, name) {
  return page.evaluate(async (fileName) => {
    const root = await navigator.storage.getDirectory();
    return (await (await root.getFileHandle(fileName)).getFile()).size;
  }, name);
}

/**
 * The text a file of the page's origin-private file system holds, or null
 * when there is no such file.
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
function opfsText(page, name) {
  return page.evaluate(async (fileName) => {
    const root = await navigator.storage.getDirectory();
    try {
      return await (
        await root.getFileHandle(fileName)
      )
        .getFile()
        .then((f) => f.text());
    } catch {
      return null;
    }
  }, name);
}

/**
 * The size and SHA-256 (hex) of a file of the page's origin-private file
 * system.
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
function opfsDigest(page, name) {
  return page.evaluate(async (fileName) => {
    const root = await navigator.storage.getDirectory();
    const file = await (await root.getFileHandle(fileName)).getFile();
    const bytes = await file.arrayBuffer();
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return {
      size: bytes.byteLength,
      sha256: [...hash].map((b) => b.toString(16).padStart(2, "0")).join(""),
    };
  }, name);
}

test("a tour opened from its link asks where to save it in the click, and is that file from its first edit", async ({
  page,
}) => {
  // Why: a tour opened from a link had no file: it was kept only in this
  // browser, never saved by itself, and its first Save asked where to put
  // it. Where the browser adopts a saved file, the open's own click now
  // asks (Chromium opens the dialog only within a few seconds of a click,
  // and the fetch can take longer - the stand-in refuses a later call),
  // writes the fetched tour there once it has opened, says so while it
  // writes, and saves every later edit into it by itself. The name it
  // suggests is dated to the second (local time), so reopening the same
  // link never offers the file that holds the edited tour.
  await withBothDialogs(page);
  await page.clock.install({ time: new Date(2026, 9, 7, 9, 5) });
  await page.goto("/edit.html");
  await expect(page.locator("#open-fineprint")).toContainText(
    "asks where to save it as it opens",
  );
  await heldWriteSavePicker(page, "linked.zip");
  let downloads = 0;
  page.on("download", () => {
    downloads += 1;
  });
  await page.locator("#link-input").fill(LINKED_TOUR);
  await page.locator("#link-btn").click();
  await expect(page.locator("#topbar")).toBeVisible({ timeout: 15000 });
  // Asked once, in the click, under the name the link's file carries,
  // dated.
  const asked = await page.evaluate(() =>
    Reflect.get(window, "__savePickNames"),
  );
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatch(/^sample-tour-2026-10-07-0905\d{2}\.zip$/);
  // While the tour is written into the chosen file, the status says so.
  await expect(page.locator("#save-status")).toHaveText(
    "Saving into linked.zip…",
  );
  await page.evaluate(() => Reflect.get(window, "__releaseWrite")());
  await expect(
    page.locator(".toast", {
      hasText:
        "Saved to linked.zip. Your changes are saved into it by themselves.",
    }),
  ).toBeVisible();
  await expect(page.locator("#tour-file")).toHaveText("linked.zip");
  await expect(page.locator("#save-status")).toHaveText("No changes");
  const written = await readOpfsTour(page, "linked.zip");
  expect(tourJsonOf(written)).toContain('"version"');
  // The fetched bytes, unchanged, before the first edit (r955 review #4):
  // the same size and SHA-256 as the link serves.
  const served = await (await page.request.get(LINKED_TOUR)).body();
  expect(await opfsDigest(page, "linked.zip")).toEqual({
    size: served.length,
    sha256: createHash("sha256").update(served).digest("hex"),
  });
  // The first edit is saved into it by itself, with no dialog.
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "idle");
  await page.locator("#no-gps-input").check();
  await expect(page.locator("body")).toHaveAttribute(
    "data-autosave",
    "waiting",
  );
  await page.clock.runFor(3_500);
  await expect(page.locator("#save-status")).toHaveText("Saved to linked.zip");
  expect(tourJsonOf(await readOpfsTour(page, "linked.zip"))).toContain(
    '"needsNoGps": true',
  );
  expect(
    await page.evaluate(() => Reflect.get(window, "__savePickNames")),
  ).toHaveLength(1);
  expect(downloads).toBe(0);
  // Done names the file as the one chosen when the tour opened.
  await publish(page);
  await expect(page.locator("#done-where")).toHaveText(
    "Your changes are saved in linked.zip, the file you chose when you opened the tour.",
  );
  // ... and says to upload it under the name the file at the link has,
  // which the chosen file does not carry.
  await expect(page.locator("#done-update")).toContainText(
    "Rename linked.zip to sample-tour.zip, or whatever the file at your link is called, and upload it under that name",
  );
});

test("the sample asks where to save it in its click, and the chosen file holds it", async ({
  page,
}) => {
  // Why: the sample is the other tour without a file of its own; it must
  // ask in its own click as a link does, and the file must hold the tour.
  await withBothDialogs(page);
  await page.goto("/edit.html");
  await clickBoundSavePicker(page, "my-sample.zip");
  await page.locator("#sample-btn").click();
  await expect(page.locator("#tour-file")).toHaveText("my-sample.zip", {
    timeout: 15000,
  });
  expect(await page.evaluate(() => Reflect.get(window, "__walkPicks"))).toBe(1);
  const title = await page.locator("#tour-name").textContent();
  expect(tourJsonOf(await readOpfsTour(page, "my-sample.zip"))).toContain(
    `"title": ${JSON.stringify(title)}`,
  );
});

test("a link that fails after a file was picked writes nothing into it, keeps the file, and says so", async ({
  page,
}) => {
  // Why: the dialog is asked for before the fetch (it needs the click), so
  // the fetch can fail after the creator picked a file - which the browser
  // has made by then, empty, or emptied if it existed (Chromium truncates
  // a file chosen in the save dialog). Nothing may be written there until
  // the tour's bytes are in hand and the tour opened. The page cannot tell
  // a new empty file from an emptied tour, so it never deletes the file,
  // and the page says, beside what went wrong, words true either way.
  await withBothDialogs(page);
  await page.clock.install();
  await page.goto("/edit.html");
  await clickBoundSavePicker(page, "never-written.zip");
  await page
    .locator("#link-input")
    .fill("http://127.0.0.1:5197/no-cors/tour.zip");
  await page.locator("#link-btn").click();
  await expect(page.locator("#open-error")).toContainText(
    "Download the file to this computer, then choose it above.",
    { timeout: 15000 },
  );
  // What became of the file is said in a toast that stays, as the other
  // warnings about a file are: a passing one could go unread.
  const left = page.locator(".toast", {
    hasText:
      "Nothing of the tour was written into never-written.zip. The browser may have emptied it when it was chosen, so if it was an existing file, do not rely on it.",
  });
  await expect(left).toBeVisible();
  await page.clock.runFor(30_000);
  await expect(left).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "__walkPicks"))).toBe(1);
  expect(await opfsSize(page, "never-written.zip")).toBe(0);
  await expect(page.locator("#topbar")).toBeHidden();
  await expect(page.locator("#link-btn")).toBeEnabled();
});

test("a link that fails after an existing file was picked never deletes it, and says so", async ({
  page,
}) => {
  // Why: the file picked may be an existing one (picked to be replaced).
  // A real Chromium has emptied it by now; the stand-in cannot, so it is
  // seeded, and this assertion fails if the page writes anything into the
  // file or deletes it. The message must not claim the file is as it was.
  await withBothDialogs(page);
  await page.goto("/edit.html");
  await clickBoundSavePicker(page, "kept.zip", { seed: "an older tour" });
  await page
    .locator("#link-input")
    .fill("http://127.0.0.1:5197/no-cors/tour.zip");
  await page.locator("#link-btn").click();
  await expect(
    page.locator(".toast", {
      hasText:
        "Nothing of the tour was written into kept.zip. The browser may have emptied it when it was chosen, so if it was an existing file, do not rely on it.",
    }),
  ).toBeVisible({ timeout: 15000 });
  expect(await opfsText(page, "kept.zip")).toBe("an older tour");
});

test("a write refused at the open says so in a toast that stays, keeps the file, and the first Save asks again", async ({
  page,
}) => {
  // Why: the write at the open can fail (a full disk). The UI-feedback
  // rule wants the failure said and the in-progress state ended: the
  // status leaves "Saving into...", the tour keeps the name it opened
  // with, the picked file is kept (never deleted), and the first Save of a change asks
  // for a file again (r955 review #2). The toast no longer says Save asks
  // again while there is nothing to save (Save does not ask then).
  await withBothDialogs(page);
  await page.clock.install();
  await page.goto("/edit.html");
  await clickBoundSavePicker(page, "full-disk.zip", { failWrite: true });
  await page.locator("#sample-btn").click();
  const toastLine = page.locator(".toast", {
    hasText: "The tour is open, but full-disk.zip could not be written",
  });
  await expect(toastLine).toBeVisible({ timeout: 15000 });
  await expect(toastLine).toContainText(
    "Nothing of the tour was written into full-disk.zip. The browser may have emptied it when it was chosen, so if it was an existing file, do not rely on it. Your changes are kept in this browser until you save.",
  );
  await expect(toastLine).not.toContainText("Save asks for a file again");
  await expect(page.locator("#save-status")).toHaveText("No changes");
  await expect(page.locator("#tour-file")).toHaveText("marienplatz-tour.zip");
  expect(await opfsSize(page, "full-disk.zip")).toBe(0);
  // A toast that stays: still there long after a passing one would go.
  await page.clock.runFor(30_000);
  await expect(toastLine).toBeVisible();
  await page.locator("#no-gps-input").check();
  await expect(page.locator("#save-status")).toHaveText(
    "1 change not saved - kept in this browser until you save",
  );
  await save(page);
  expect(await page.evaluate(() => Reflect.get(window, "__walkPicks"))).toBe(2);
});

test("while the write at the open runs, it holds the save slot: Save is unavailable, and Ctrl+S saves right after", async ({
  page,
}) => {
  // Why: the write at the open holds the page's save slot, so Save shows
  // as unavailable during it. Ctrl+S
  // pressed then must not be dropped in silence: it waits, as it does
  // behind an autosave, and saves the edit made meanwhile into the
  // adopted file once the write has landed. The page's clock is paused
  // once the write holds, so the autosave's delay never passes and only
  // the waiting Ctrl+S can save.
  await withBothDialogs(page);
  await page.clock.install({ time: new Date(2026, 9, 7, 9, 0) });
  await page.goto("/edit.html");
  await heldWriteSavePicker(page, "slow.zip");
  await page.locator("#link-input").fill(LINKED_TOUR);
  await page.locator("#link-btn").click();
  await expect(page.locator("#save-status")).toHaveText(
    "Saving into slow.zip…",
    { timeout: 15000 },
  );
  await expect(page.locator("#file-save")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.clock.pauseAt(new Date(2026, 9, 7, 10, 0));
  await page.locator("#no-gps-input").check();
  await page.keyboard.press("Control+s");
  await page.evaluate(() => Reflect.get(window, "__releaseWrite")());
  await expect(page.locator("#tour-file")).toHaveText("slow.zip");
  await expect(page.locator("#save-status")).toHaveText("Saved to slow.zip");
  expect(tourJsonOf(await readOpfsTour(page, "slow.zip"))).toContain(
    '"needsNoGps": true',
  );
  await expect(page.locator("#file-save")).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
  // One dialog only: the one in the open's click.
  expect(
    await page.evaluate(() => Reflect.get(window, "__savePickNames")),
  ).toHaveLength(1);
});

test("a file chosen at the open that another tab is editing is not said to save by itself", async ({
  page,
}) => {
  // Why: the tour is written into the chosen file, but when another tab
  // holds that file's name the editor attaches no in-place save (Save
  // downloads a copy until "Edit here anyway"), so the toast must not
  // promise that changes are saved into it by themselves.
  await withBothDialogs(page);
  await page.goto("/edit.html");
  await page.evaluate(() => {
    void navigator.locks.request(
      "gps-plus-slam/tour-viewer-editor/locked.zip",
      () => new Promise(() => undefined),
    );
  });
  await clickBoundSavePicker(page, "locked.zip");
  await page.locator("#sample-btn").click();
  await expect(
    page.locator(".toast", {
      hasText: "Another tab is editing a file named locked.zip.",
    }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.locator(".toast", { hasText: "Saved to locked.zip." }),
  ).toBeVisible();
  await expect(
    page.locator(".toast", { hasText: "saved into it by themselves" }),
  ).toHaveCount(0);
  expect(tourJsonOf(await readOpfsTour(page, "locked.zip"))).toContain(
    '"version"',
  );
});

test("a dismissed dialog at the open leaves the tour in this browser, said in the status, and the first Save asks again", async ({
  page,
}) => {
  // Why: dismissing the dialog must not stop the tour from opening, nor
  // download anything; the tour is then kept only in this browser, which
  // the status line says beside the unsaved changes, and the first Save
  // asks for a file as it did before - suggesting a dated name, as the
  // open's dialog did, so Enter there never offers to replace a file
  // holding an earlier edit of the same tour.
  await withBothDialogs(page);
  await page.clock.install({ time: new Date(2026, 9, 7, 9, 5) });
  await page.goto("/edit.html");
  await clickBoundSavePicker(page, "never-written.zip", { dismiss: true });
  await page.locator("#sample-btn").click();
  await expect(page.locator("#topbar")).toBeVisible({ timeout: 15000 });
  expect(await page.evaluate(() => Reflect.get(window, "__walkPicks"))).toBe(1);
  expect(await opfsSize(page, "never-written.zip")).toBe(0);
  await page.locator("#no-gps-input").check();
  await expect(page.locator("#save-status")).toHaveText(
    "1 change not saved - kept in this browser until you save",
  );
  await save(page);
  expect(await page.evaluate(() => Reflect.get(window, "__walkPicks"))).toBe(2);
  const names = await page.evaluate(() =>
    Reflect.get(window, "__walkPickNames"),
  );
  expect(names).toHaveLength(2);
  for (const suggested of names) {
    expect(suggested).toMatch(/^marienplatz-tour-2026-10-07-0905\d{2}\.zip$/);
  }
});

test("on Android a tour from the sample asks for its file as on a desktop, and saves into it by itself", async ({
  page,
}) => {
  // Why: Android was held back from adopting a picked file (a content URI,
  // with no replace in one step) until a check on a phone showed that a
  // rewrite cut short by closing the tab leaves the old file whole. Now an
  // Android browser (told here by its client hints, as Chrome reports it)
  // asks in the click and saves into the chosen file as a desktop does.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "userAgentData", {
      configurable: true,
      get: () => ({ platform: "Android", mobile: true }),
    });
  });
  await withBothDialogs(page);
  await page.clock.install();
  await page.goto("/edit.html");
  await clickBoundSavePicker(page, "phone-sample.zip");
  await page.locator("#sample-btn").click();
  await expect(page.locator("#tour-file")).toHaveText("phone-sample.zip", {
    timeout: 15000,
  });
  expect(await page.evaluate(() => Reflect.get(window, "__walkPicks"))).toBe(1);
  await expect(page.locator("body")).toHaveAttribute("data-autosave", "idle");
  await page.locator("#no-gps-input").check();
  await page.clock.runFor(3_500);
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to phone-sample.zip",
  );
  expect(tourJsonOf(await readOpfsTour(page, "phone-sample.zip"))).toContain(
    '"needsNoGps": true',
  );
});

test("Done names the hosted file by the dated save's name, in the session that opened the link and after the save is reopened", async ({
  page,
}) => {
  // Why: the hosted file's name was known only to the session that opened
  // the link. Reopened later, the dated save (sample-tour-2026-...zip) was
  // to be uploaded "over the file at your tour's link" under its own name,
  // which on Dropbox, OneDrive or GitHub puts a second file beside the
  // hosted one and leaves the link on the old tour. The saved name without
  // its date is the hosted one's, hedged in words. The link points to an
  // own server, so the steps are an own server's - never Google Drive's.
  const dated = "sample-tour-2026-10-07-090500.zip";
  await withBothDialogs(page);
  await page.clock.install({ time: new Date(2026, 9, 7, 9, 5) });
  await page.goto("/edit.html");
  await heldWriteSavePicker(page, dated);
  await page.locator("#link-input").fill(LINKED_TOUR);
  await page.locator("#link-btn").click();
  await expect(page.locator("#save-status")).toHaveText(
    `Saving into ${dated}…`,
    { timeout: 15000 },
  );
  await page.evaluate(() => Reflect.get(window, "__releaseWrite")());
  await expect(page.locator("#tour-file")).toHaveText(dated);
  await publish(page);
  const update = page.locator("#done-update");
  await expect(update).toContainText(
    `Rename ${dated} to sample-tour.zip, or whatever the file at your link is called, and upload it under that name`,
  );
  await expect(update).toContainText("Put it on your server");
  await expect(update).not.toContainText("Google Drive");
  // The dated save, opened again in a new visit of the page.
  const bytes = await page.evaluate(async (fileName) => {
    const root = await navigator.storage.getDirectory();
    const file = await (await root.getFileHandle(fileName)).getFile();
    return [...new Uint8Array(await file.arrayBuffer())];
  }, dated);
  await page.goto("/edit.html");
  await dropOnDropBox(page, Buffer.from(bytes), dated);
  await expect(page.locator("#tour-file")).toHaveText(dated, {
    timeout: 15000,
  });
  await publish(page);
  await expect(page.locator("#done-update")).toContainText(
    `Rename ${dated} to sample-tour.zip, or whatever the file at your link is called, and upload it under that name`,
  );
});

test("a write at the open still running when another tour is opened lets the save slot go: the new tour saves", async ({
  page,
}) => {
  // Why: the write into the file chosen at a link's open released the
  // page's one save slot only while its own tour was still open. Opening
  // another tour during the write left the slot held for good, and Save
  // stayed unavailable for the new tour.
  await withBothDialogs(page);
  await autosaveOutOfTheWay(page);
  await page.goto("/edit.html");
  await heldWriteSavePicker(page, "slow.zip");
  await page.locator("#link-input").fill(LINKED_TOUR);
  await page.locator("#link-btn").click();
  await expect(page.locator("#save-status")).toHaveText(
    "Saving into slow.zip…",
    { timeout: 15000 },
  );
  await openAnother(page);
  await dropOnDropBox(page, await editorTour(), "editor-fixture.zip");
  await expect(page.locator("#tour-name")).toHaveText("Editor fixture");
  await page.evaluate(() => Reflect.get(window, "__releaseWrite")());
  await page.locator("#no-gps-input").check();
  await expect(page.locator("#file-save")).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await save(page);
  await expect(page.locator("#save-status")).toHaveText("Saved to slow.zip");
  expect(tourJsonOf(await readOpfsTour(page, "slow.zip"))).toContain(
    '"needsNoGps": true',
  );
});

test("a Ctrl+S pressed in a tour opened while the last tour's copy was written saves that tour once the copy is done", async ({
  page,
}) => {
  // Why: a copy holds the page's save slot until its write ends, also
  // when another tour opened meanwhile, so a Ctrl+S in that tour waits
  // behind it. The copy's end ran only the waiting Save of the tour it
  // copied - gone by then - and the new tour's Ctrl+S was dropped in
  // silence.
  await inPlaceTourEdited(page, "Left in the first tour");
  await heldWriteSavePicker(page, "a-copy.zip");
  await fileCommand(page, "saveCopy");
  await expect(page.locator("#save-status")).toHaveText("Saving a copy…");
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await openAnother(page);
  await offerOpfsFile(page, await editorTour(), "second.zip");
  await page.locator("#choose-btn").click();
  await expect(page.locator("#tour-file")).toHaveText("second.zip");
  await editTownHall(page, "Saved in the second tour");
  await page.keyboard.press("Control+s");
  await page.evaluate(() => Reflect.get(window, "__releaseWrite")());
  await expect(page.locator("#save-status")).toHaveText("Saved to second.zip");
  expect((await readOpfsTour(page, "second.zip"))["tour.json"]).toContain(
    "Saved in the second tour",
  );
});

test("a Ctrl+S queued behind a copy, on a tour with no file and nothing to save, says there is nothing to save", async ({
  page,
}) => {
  // Why: "Press Save to choose where to save the tour" asks the creator
  // to save. With no change to save, a Save says there is nothing to
  // save, and a Ctrl+S that waited behind a copy must say the same, not
  // send the creator to a dialog for nothing.
  await withBothDialogs(page);
  await autosaveOutOfTheWay(page);
  await page.goto("/edit.html");
  await dropOnDropBox(page, await editorTour(), "editor-fixture.zip");
  await expect(page.locator("#tour-name")).toHaveText("Editor fixture");
  await heldWriteSavePicker(page, "a-copy.zip");
  await fileCommand(page, "saveCopy");
  await expect(page.locator("#file-save")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Control+s");
  await page.evaluate(() => Reflect.get(window, "__releaseWrite")());
  await expect(
    page.locator(".toast", { hasText: "Saved a copy as a-copy.zip" }),
  ).toBeVisible();
  await expect(
    page.locator(".toast", { hasText: "Nothing to save" }),
  ).toBeVisible();
  await expect(
    page.locator(".toast", {
      hasText: "Press Save to choose where to save the tour",
    }),
  ).toHaveCount(0);
});

test("a Ctrl+S queued behind a copy, on a tour with no file to save into, says to press Save instead of downloading", async ({
  page,
}) => {
  // Why: a tour without a file asks where to save it, and the browser
  // opens that dialog only within a key press or a click. A Ctrl+S pressed
  // while a copy was written ran once the copy was done - outside its key
  // press - and downloaded the tour under its undated name. It now says to
  // press Save, which asks where to save it.
  await withBothDialogs(page);
  await autosaveOutOfTheWay(page);
  await page.goto("/edit.html");
  await dropOnDropBox(page, await editorTour(), "editor-fixture.zip");
  await expect(page.locator("#tour-name")).toHaveText("Editor fixture");
  await heldWriteSavePicker(page, "a-copy.zip");
  await editTownHall(page, "Queued behind the copy");
  let downloads = 0;
  page.on("download", () => {
    downloads += 1;
  });
  await fileCommand(page, "saveCopy");
  await expect(page.locator("#file-save")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.keyboard.press("Control+s");
  await page.evaluate(() => Reflect.get(window, "__releaseWrite")());
  await expect(
    page.locator(".toast", { hasText: "Saved a copy as a-copy.zip" }),
  ).toBeVisible();
  await expect(
    page.locator(".toast", {
      hasText: "Press Save to choose where to save the tour",
    }),
  ).toBeVisible();
  await expect(page.locator("#save-status")).toContainText("not saved");
  expect(downloads).toBe(0);
  // Only the copy's dialog was asked for.
  expect(
    await page.evaluate(() => Reflect.get(window, "__savePickNames")),
  ).toHaveLength(1);
});

test("a Ctrl+S pressed while the debug data is moved out runs once the move is done", async ({
  page,
}) => {
  // Why: the move holds the page's save slot, so a Ctrl+S pressed during
  // it waits, as it does behind an autosave or a copy, and runs once the
  // move let go - never dropped in silence. Done saved everything first,
  // so the save it runs finds nothing to save, and says so.
  await autosaveOutOfTheWay(page);
  await doneWithWrappedTour(page);
  await clickBoundSavePicker(page, "wrapped-debug.zip", { hold: true });
  await page.locator("#done-move").click();
  await expect(page.locator("#done-move")).toHaveText(
    "Moving the debug data out…",
  );
  await page.keyboard.press("Control+s");
  const nothing = page.locator(".toast", { hasText: "Nothing to save" });
  await expect(nothing).toHaveCount(0);
  await page.evaluate(() => {
    // @ts-expect-error - set by the stand-in.
    window.__releaseWalkPick();
  });
  await expect(page.locator("#done-move-status")).toContainText(
    "The debug data is in wrapped-debug.zip",
  );
  await expect(nothing).toBeVisible();
});
