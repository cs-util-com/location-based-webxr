// @ts-check
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import { fileCommand, fileItem, openAnother, save } from "./editor-menus.js";
import {
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
  saveAndRead,
  wrappedTour,
} from "./editor-tours.js";

/**
 * Why these tests matter: what the editor keeps of a creator's work - the
 * file it writes, the copy it downloads, the draft this browser keeps until
 * a save - does not depend on the view the tour is drawn in. These walks
 * check exactly that, so they run with no 3D view at all: WebGL is refused
 * before the page loads, the opened tour shows the page that says the 3D
 * view cannot open, and the File menu, the status line, the toasts and the
 * draft stay in use. An edit goes through the editor session the way a
 * control of the page would (the dev server's `window.__tourEditor` hook,
 * then its `edited()`, which follows it as an edit made here: the status,
 * the draft and the autosave told), and what the tour holds is read from
 * the manifest the page would write. They were the map editor's (rail and
 * card) and moved here when the map is to be removed: measured on six of
 * them, about 3 s a test this way against 1-3 min on the globe in the
 * software renderer. Where a walk is about the editor's own controls, it
 * stays with the view that has them.
 */

// The page prefers the browser's file picker; these open through the file
// input, so the picker is taken away (a walk that opens in place puts its
// own back after the page loads). The refused WebGL holds for every page of
// the context, so a second tab opens without a 3D view too.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    // @ts-expect-error - the e2e takes the picker away on purpose.
    delete window.showOpenFilePicker;
    const real = HTMLCanvasElement.prototype.getContext;
    /** @type {any} */ (HTMLCanvasElement.prototype).getContext = function (
      /** @type {string} */ kind,
      /** @type {unknown[]} */ ...rest
    ) {
      return kind.startsWith("webgl") ? null : real.call(this, kind, ...rest);
    };
  });
});

/**
 * Open `buffer` through the real file chooser and wait for the tour: with
 * no WebGL, the page that says the 3D view cannot open.
 * @param {import("@playwright/test").Page} page
 * @param {Buffer} buffer
 * @param {string} name
 */
async function openFile(page, buffer, name) {
  await openThroughChooser(page, buffer, name);
  await expect(page.locator("#view3d-failed")).toBeVisible();
}

/**
 * Open the origin-private file the page's picker offers (in place) and
 * wait for the tour.
 * @param {import("@playwright/test").Page} page
 */
async function openOffered(page) {
  await page.locator("#choose-btn").click();
  await expect(page.locator("#view3d-failed")).toBeVisible();
}

/**
 * One edit through the editor session, followed as an edit of the page's
 * own controls is; the session's answer must be `expected`.
 * @param {import("@playwright/test").Page} page
 * @param {{ act: "editText" | "remove" | "move", id: string, args?: unknown[] }} edit
 * @param {string} expected
 */
async function sessionEdit(page, edit, expected) {
  const kind = await page.evaluate(({ act, id, args }) => {
    // @ts-expect-error - the editor's dev-only test hook.
    const hook = window.__tourEditor;
    const outcome = hook.editor()[act](id, ...(args ?? []));
    hook.edited();
    return outcome.kind;
  }, edit);
  expect(kind).toBe(expected);
}

/** @param {import("@playwright/test").Page} page @param {string} id @param {string} text */
const editText = (page, id, text) =>
  sessionEdit(page, { act: "editText", id, args: [text] }, "edited");

/** @param {import("@playwright/test").Page} page @param {string} id */
const remove = (page, id) =>
  sessionEdit(page, { act: "remove", id }, "deleted");

/**
 * The text (a pin's) or caption (a photo's) of the tour's object `id` as
 * the page would write it, or `undefined` when the tour has no such object.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 * @returns {Promise<string | undefined>}
 */
function captionOf(page, id) {
  return page.evaluate((blockId) => {
    // @ts-expect-error - the editor's dev-only test hook.
    const manifest = window.__tourEditor.manifest();
    const block = manifest.stations
      .flatMap((/** @type {{ blocks: any[] }} */ s) => s.blocks)
      .find((/** @type {{ id: string }} */ b) => b.id === blockId);
    return block === undefined ? undefined : block.caption;
  }, id);
}

/**
 * Where the tour's object `id` stands as the page would write it: its
 * station's place (an object placed on its own is a station of its own)
 * and its pose's position in that station's frame, or `undefined` when
 * the tour has no such object.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 * @returns {Promise<{ lat: number, lon: number, position: number[] } | undefined>}
 */
function placeOf(page, id) {
  return page.evaluate((blockId) => {
    // @ts-expect-error - the editor's dev-only test hook.
    const manifest = window.__tourEditor.manifest();
    for (const station of manifest.stations) {
      const block = station.blocks.find(
        (/** @type {{ id: string }} */ b) => b.id === blockId,
      );
      if (block !== undefined) {
        return {
          lat: station.geo.lat,
          lon: station.geo.lon,
          position: [...block.pose.position],
        };
      }
    }
    return undefined;
  }, id);
}

/**
 * Wait until the tour's object `id` reads `caption` (`undefined`: gone).
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 * @param {string | undefined} caption
 */
async function expectCaption(page, id, caption) {
  await expect.poll(() => captionOf(page, id)).toBe(caption);
}

// The editor fixture's objects (editor-tours.js): the "Town hall" pin, the
// "Fountain" photo; the wrapped tour's pin and the one another program adds.
const TOWN_HALL = "pin-markup";
const FOUNTAIN = "photo-ok";
const WRAPPED_PIN = "pin-wrapped";
const ADDED_ELSEWHERE = "pin-elsewhere";

// ---------------------------------------------------------------------------
// The editor's draft (M6 E2c): edits survive a closed tab.
//
// A page is reopened with `context.newPage()` in the SAME browser context
// (a new context has an empty origin-private file system), and every page
// is closed only after the draft says it is backed up (`data-draft` =
// `saved`): `page.close()` skips `beforeunload`, so nothing else waits for
// the draft's writes (E2c plan review #12).
// ---------------------------------------------------------------------------

test("edits survive a closed tab: the same file reopened offers them, and Restore brings them back @pr", async ({
  page,
  context,
}) => {
  // Why (M6 E2c): a closed tab, a crash or a reload lost every edit not
  // yet saved; the draft keeps them in this browser and the next open of
  // the same file offers them - changes and deletions named apart.
  const buffer = await editorTour();
  await page.goto("/edit.html");
  await openFile(page, buffer, "editor-fixture.zip");
  await editText(page, TOWN_HALL, "Kept in the browser");
  await remove(page, FOUNTAIN);
  await expect(page.locator("#save-status")).toHaveText(
    "2 changes not saved - kept in this browser until you save",
  );
  await backedUp(page);
  await page.close();
  const next = await newEditorPage(context);
  await openFile(next, buffer, "editor-fixture.zip");
  const offer = next.locator(".toast.draft-offer");
  await expect(offer).toContainText("1 change and 1 deletion");
  // Until it is answered the tour is the file's.
  expect(await captionOf(next, FOUNTAIN)).toBe("Fountain");
  await offer.locator("button", { hasText: "Restore" }).click();
  await expect(offer).toHaveCount(0);
  await expectCaption(next, TOWN_HALL, "Kept in the browser");
  await expectCaption(next, FOUNTAIN, undefined);
  await expect(next.locator("#save-status")).toHaveText(
    "2 changes not saved - kept in this browser until you save",
  );
});

test("a station renamed through the editor session survives a closed tab: the draft offers it, and Restore brings it back", async ({
  page,
  context,
}) => {
  // Why: a station's name is a tour-level edit no object's record names,
  // so only the draft's whole stations bring it back after a reload. No
  // control of this page renames a station yet; the dev server's hook
  // reaches the editor session the way a later view will.
  const buffer = await editorTour({ station: true });
  await page.goto("/edit.html");
  await openFile(page, buffer, "editor-fixture.zip");
  await expect(page.locator("#tour-name")).toHaveText("Editor fixture");
  const outcome = await page.evaluate(() => {
    // @ts-expect-error - the editor's dev-only test hook.
    const hook = window.__tourEditor;
    const result = hook.editor().editStation("gate", {
      title: "The east gate",
    });
    hook.edited();
    return result.kind;
  });
  expect(outcome).toBe("edited");
  await expect(page.locator("#save-status")).toHaveText(
    "1 change not saved - kept in this browser until you save",
  );
  await backedUp(page);
  await page.close();
  const next = await newEditorPage(context);
  await openFile(next, buffer, "editor-fixture.zip");
  const offer = next.locator(".toast.draft-offer");
  await expect(offer).toContainText("a station");
  await offer.locator("button", { hasText: "Restore" }).click();
  await expect(offer).toHaveCount(0);
  await expect(next.locator("#save-status")).toHaveText(
    "1 change not saved - kept in this browser until you save",
  );
  const title = await next.evaluate(
    () =>
      // @ts-expect-error - the editor's dev-only test hook.
      window.__tourEditor
        .editor()
        .model()
        .items.find((i) => i.id === "station:gate")?.title,
  );
  expect(title).toBe("The east gate");
});

test("Not now keeps the earlier edits for the next open, and Delete it throws them away", async ({
  page,
  context,
}) => {
  // Why (E2c plan review #7): declining is not deleting - a mis-tap must
  // not cost the work - and "Delete it" is the one way to drop it.
  const buffer = await editorTour();
  await page.goto("/edit.html");
  await openFile(page, buffer, "editor-fixture.zip");
  await editText(page, TOWN_HALL, "Asked about twice");
  await backedUp(page);
  await page.close();
  const second = await newEditorPage(context);
  await openFile(second, buffer, "editor-fixture.zip");
  await second
    .locator(".toast.draft-offer button", { hasText: "Not now" })
    .click();
  await backedUp(second);
  await second.close();
  const third = await newEditorPage(context);
  await openFile(third, buffer, "editor-fixture.zip");
  await third
    .locator(".toast.draft-offer button", { hasText: "Delete it" })
    .click();
  await backedUp(third);
  await third.close();
  const fourth = await newEditorPage(context);
  await openFile(fourth, buffer, "editor-fixture.zip");
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
  await openFile(page, buffer, "editor-fixture.zip");
  await editText(page, TOWN_HALL, "Downloaded once");
  const saved = await saveAndRead(page);
  expect(JSON.stringify(saved.manifest)).toContain("Downloaded once");
  await backedUp(page);
  await page.close();
  const next = await newEditorPage(context);
  await openFile(next, buffer, "editor-fixture.zip");
  await expect(next.locator(".toast.draft-offer")).toContainText("1 change");
});

test("an edit after a download is offered by the downloaded file: the tour carries its own id from its first save", async ({
  page,
  context,
}) => {
  // Why (debug-captures plan, Q-I): a tour of notes alone was keyed by its
  // content, which every save rewrites - so the file a download made
  // opened under another key and an edit made after the download was not
  // offered by it. The first save writes the tour's own id; the file is
  // keyed by it and the draft follows it there, while the original keeps
  // what it offered.
  await noSavePicker(page);
  const buffer = await editorTour();
  await page.goto("/edit.html");
  await openFile(page, buffer, "editor-fixture.zip");
  await editText(page, TOWN_HALL, "Downloaded once");
  const download = page.waitForEvent("download");
  await save(page);
  const saved = readFileSync(await (await download).path());
  await remove(page, FOUNTAIN);
  await backedUp(page);
  await page.close();
  const copy = await newEditorPage(context);
  await openFile(copy, saved, "editor-fixture.zip");
  await expectCaption(copy, TOWN_HALL, "Downloaded once");
  await expect(copy.locator(".toast.draft-offer")).toContainText("1 deletion");
  await copy.close();
  const original = await newEditorPage(context);
  await openFile(original, buffer, "editor-fixture.zip");
  await expect(original.locator(".toast.draft-offer")).toContainText(
    "1 change",
  );
});

test("a download of a tour that carries a walk leaves it out by default, and keeps it only when the switch is ticked", async ({
  page,
  context,
}) => {
  // Why (M2 of the debug-captures plan, E2): the tour file people open
  // does not carry the debug data unless the creator asks (a co-author's
  // copy) - the walk is saved apart. The switch hides after a save, so the
  // tick is tried on a second open of the same tour. Changed expectation:
  // in M1 the switch started ticked whenever the file carried a walk, and
  // only an untick left it out.
  const tour = await wrappedTour({ pin: true });
  await noSavePicker(page);
  await page.goto("/edit.html");
  await openFile(page, tour, "wrapped.zip");
  await expect(fileItem(page, "keepWalk")).toHaveJSProperty("hidden", false);
  await expect(fileItem(page, "keepWalk")).toContainText(
    "Keep the debug data in the tour file",
  );
  await expect(fileItem(page, "keepWalk")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await editText(page, WRAPPED_PIN, "Lean by default");
  const lean = page.waitForEvent("download");
  await save(page);
  const leanNames = await downloadedNames(await lean);
  expect(leanNames).toContain("mytour/tour.json");
  expect(leanNames).not.toContain("mytour/actions/000001.json");
  expect(leanNames).not.toContain("mytour/session.json");
  expect(leanNames).not.toContain("mytour/images/frame-000002.png");
  await expect(
    page.locator(".toast", { hasText: "leaves out the debug data" }),
  ).toHaveCount(1);
  await page.close();
  const next = await newEditorPage(context);
  await openFile(next, tour, "wrapped.zip");
  await expect(fileItem(next, "keepWalk")).toHaveJSProperty("hidden", false);
  await fileCommand(next, "keepWalk");
  await expect(fileItem(next, "keepWalk")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await editText(next, WRAPPED_PIN, "Kept on request");
  const kept = next.waitForEvent("download");
  await save(next);
  const keptNames = await downloadedNames(await kept);
  expect(keptNames).toContain("mytour/actions/000001.json");
  expect(keptNames).toContain("mytour/session.json");
  expect(keptNames).toContain("mytour/images/frame-000002.png");
  await expect(
    next.locator(".toast", { hasText: "leaves out the debug data" }),
  ).toHaveCount(0);
});

test("a lean download of a recording tour: the original still offers, the lean copy opens without an offer", async ({
  page,
  context,
}) => {
  // Why (E2c plan review #5): the copy without the walk has another key
  // than the tour it came from. Since the tour carries its own id
  // (debug-captures plan, Q-I) the draft follows the download to it and
  // the copy, which holds the edit, offers nothing - while the original
  // keeps its draft, since a download clears nothing.
  await noSavePicker(page);
  const original = await wrappedTour({ pin: true });
  await page.goto("/edit.html");
  await openFile(page, original, "wrapped.zip");
  await editText(page, WRAPPED_PIN, "In the lean copy");
  // Lean by default (M2 of the debug-captures plan, E2). Changed: in M1
  // the switch started ticked here and the test unticked it.
  await expect(fileItem(page, "keepWalk")).toHaveJSProperty("hidden", false);
  await expect(fileItem(page, "keepWalk")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  const download = page.waitForEvent("download");
  await save(page);
  const lean = readFileSync(await (await download).path());
  await backedUp(page);
  await page.close();
  const leanPage = await newEditorPage(context);
  await openFile(leanPage, lean, "wrapped.zip");
  await expectCaption(leanPage, WRAPPED_PIN, "In the lean copy");
  await backedUp(leanPage);
  await expect(leanPage.locator(".toast.draft-offer")).toHaveCount(0);
  await leanPage.close();
  const originalPage = await newEditorPage(context);
  await openFile(originalPage, original, "wrapped.zip");
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
  await openOffered(page);
  await expect(page.locator("#tour-name")).toHaveText("Editor fixture");
  await editText(page, TOWN_HALL, "Saved in place");
  await save(page);
  await expect(page.locator("#save-status")).toHaveText(
    "Saved to editor-fixture.zip",
  );
  await remove(page, FOUNTAIN);
  await expect(page.locator("#save-status")).toHaveText("1 change not saved");
  await backedUp(page);
  await page.close();
  const next = await context.newPage();
  await answerTiles(next);
  await next.goto("/edit.html");
  await offerExistingOpfsFile(next, "editor-fixture.zip");
  await openOffered(next);
  await expectCaption(next, TOWN_HALL, "Saved in place");
  const offer = next.locator(".toast.draft-offer");
  await expect(offer).toContainText("1 deletion");
  await offer.locator("button", { hasText: "Restore" }).click();
  await expectCaption(next, FOUNTAIN, undefined);
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
  await openOffered(page);
  await expect(page.locator("#tour-name")).toHaveText("Wrapped fixture");
  await editText(page, WRAPPED_PIN, "Before the other program");
  await backedUp(page);
  const elsewhere = await wrappedTour({ pin: true, extra: true });
  await page.evaluate(async (b64) => {
    const root = await navigator.storage.getDirectory();
    const w = await (await root.getFileHandle("wrapped.zip")).createWritable();
    await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    await w.close();
  }, elsewhere.toString("base64"));
  await save(page);
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
  await openAnother(page);
  await page.locator("#choose-btn").click();
  // The file as the other program wrote it, then the draft offered on it.
  await expectCaption(page, ADDED_ELSEWHERE, "Added elsewhere");
  const offer = page.locator(".toast.draft-offer");
  await expect(offer).toContainText("1 change");
  await offer.locator("button", { hasText: "Restore" }).click();
  await expectCaption(page, WRAPPED_PIN, "Before the other program");
  await expectCaption(page, ADDED_ELSEWHERE, "Added elsewhere");
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
  await openFile(page, buffer, "editor-fixture.zip");
  await editText(page, TOWN_HALL, "The editor's text");
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
        format: 4,
        block: {
          id: "pin-markup",
          kind: "shortText",
          view: "pin",
          caption: "The phone's text",
          createdAtIso: "2026-10-13T00:00:00.000Z",
        },
        geo: { lat: 48.5204, lon: 9.0537, alt: 340, headingDeg: 0 },
      }),
    );
    return phone;
  });
  await page.close();
  const next = await newEditorPage(context);
  await openFile(next, buffer, "editor-fixture.zip");
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
  await openFile(page, buffer, "editor-fixture.zip");
  await backedUp(page);
  const second = await newEditorPage(context);
  await openFile(second, buffer, "editor-fixture.zip");
  await expect(
    second.locator(".toast", { hasText: "keeps no backup copy" }),
  ).toBeVisible();
  await expect(second.locator("body")).toHaveAttribute("data-draft", "off");
  // The first tab still backs up.
  await editText(page, TOWN_HALL, "The first tab's edit");
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
  await openOffered(page);
  await expect(page.locator("#tour-name")).toHaveText("Wrapped fixture");
  await editText(page, WRAPPED_PIN, "Not written, still kept");
  await save(page);
  await expect(
    page.locator(".toast", { hasText: "the disk is full" }),
  ).toBeVisible();
  await backedUp(page);
  await page.close();
  const next = await newEditorPage(context);
  await openFile(next, buffer, "wrapped.zip");
  const offer = next.locator(".toast.draft-offer");
  await expect(offer).toContainText("1 change");
  await offer.locator("button", { hasText: "Restore" }).click();
  await expectCaption(next, WRAPPED_PIN, "Not written, still kept");
});

test("an undo of a delete of an edited note keeps the edit for the next open", async ({
  page,
  context,
}) => {
  // Why (E2c plan review #11): the delete removed the edited record from
  // the draft; its undo must write it again, or the edit is on screen and
  // gone from the browser's copy. The undo is the page's own Ctrl+Z.
  const buffer = await editorTour();
  await page.goto("/edit.html");
  await openFile(page, buffer, "editor-fixture.zip");
  await editText(page, TOWN_HALL, "Edited, deleted, undone");
  await remove(page, TOWN_HALL);
  await expectCaption(page, TOWN_HALL, undefined);
  await page.keyboard.press("Control+z");
  await expectCaption(page, TOWN_HALL, "Edited, deleted, undone");
  await backedUp(page);
  await page.close();
  const next = await newEditorPage(context);
  await openFile(next, buffer, "editor-fixture.zip");
  const offer = next.locator(".toast.draft-offer");
  await expect(offer).toContainText("1 change");
  await expect(offer).not.toContainText("deletion");
  await offer.locator("button", { hasText: "Restore" }).click();
  await expectCaption(next, TOWN_HALL, "Edited, deleted, undone");
});

test("a moved photo note survives a closed tab", async ({ page, context }) => {
  // Why (E2c milestone review #1, confirmed data loss): a photo note's
  // edit carries no bytes - they are in the opened file - and the read
  // dropped a photo record without its bytes, so the move was lost.
  const buffer = await editorTour();
  await page.goto("/edit.html");
  await openFile(page, buffer, "editor-fixture.zip");
  const before = await placeOf(page, FOUNTAIN);
  // About 30 m north-east of where it stands (editor-tours.js's `geo`).
  await sessionEdit(
    page,
    {
      act: "move",
      id: FOUNTAIN,
      args: [48.5203 + 20 / 111_320, 9.0536 + 40 / 73_800],
    },
    "moved",
  );
  await expect(page.locator("#save-status")).toHaveText(
    "1 change not saved - kept in this browser until you save",
  );
  const moved = await placeOf(page, FOUNTAIN);
  expect(moved).toBeDefined();
  expect(moved).not.toEqual(before);
  await backedUp(page);
  await page.close();
  const next = await newEditorPage(context);
  await openFile(next, buffer, "editor-fixture.zip");
  const offer = next.locator(".toast.draft-offer");
  await expect(offer).toContainText("1 change");
  await offer.locator("button", { hasText: "Restore" }).click();
  await expect(next.locator("#save-status")).toHaveText(
    "1 change not saved - kept in this browser until you save",
  );
  // The move itself came back, not only a count of changes.
  expect(await placeOf(next, FOUNTAIN)).toEqual(moved);
});

test("an edit after a download, with the downloaded copy put in place, is offered by that copy", async ({
  page,
  context,
}) => {
  // Why (E2c milestone review #4): each build adds its versions to the
  // draft's `written` list. Without it the copy's own version of the note
  // is one this browser never SAW in a file, so the later edit reads as
  // "replaced by a newer one" and is dropped. The copy is known by the
  // tour's own id (Q-I), walk or not.
  await noSavePicker(page);
  await page.goto("/edit.html");
  await openFile(page, await wrappedTour({ pin: true }), "wrapped.zip");
  // Changed expectation: the walk was kept here (ticked by the creator,
  // then by default in M1 of the debug-captures plan) because only that
  // gave the copy the original's key. The tour carries its own id since
  // Q-I, so the lean default copy - unticked since M2 - keeps the draft
  // all the same.
  await expect(fileItem(page, "keepWalk")).toHaveJSProperty("hidden", false);
  await expect(fileItem(page, "keepWalk")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await editText(page, WRAPPED_PIN, "In the download");
  const download = page.waitForEvent("download");
  await save(page);
  const copy = readFileSync(await (await download).path());
  await editText(page, WRAPPED_PIN, "After the download");
  await expect(page.locator("#save-status")).toHaveText(
    "1 change not saved - kept in this browser until you save",
  );
  await backedUp(page);
  await page.close();
  const next = await newEditorPage(context);
  await openFile(next, copy, "wrapped.zip");
  await expectCaption(next, WRAPPED_PIN, "In the download");
  const offer = next.locator(".toast.draft-offer");
  await expect(offer).toContainText("1 change");
  await expect(
    next.locator(".toast", { hasText: "replaced by a newer one" }),
  ).toHaveCount(0);
  await offer.locator("button", { hasText: "Restore" }).click();
  await expectCaption(next, WRAPPED_PIN, "After the download");
});
