/**
 * One table of draft behaviour, run on both drafts this browser keeps: the
 * phone page's (`creator-draft.ts`, composed by `wireCreatorSetup`) and the
 * desktop editor's (`editor/editor-draft.ts` under `createEditorSession`).
 *
 * Why this suite matters: the two pages keep two drafts of one tour, each
 * with its own code, and the work that joins them onto one core needs a
 * statement of what both do TODAY that it must keep. Each row is one
 * user-visible behaviour (a closed tab and a reopen, the offer and its
 * three answers, a write that did not land, a crash between two writes),
 * written once and run on each page through the same small adapter, so a
 * row that holds on one page and not the other shows as a red row of that
 * page, never as a difference two separate test files would hide. The
 * parity contract (`tour-document-parity.test.ts`) compares what the two
 * pages SAVE; this suite compares what their DRAFTS bring back.
 *
 * Where the two pages differ on disk today, the row says so and asserts
 * each page's own behaviour (the store order of a picture's two files, a
 * settings record kept or removed once it equals the file); what the
 * creator sees is the same on both. A change of either turns that row
 * red on purpose.
 *
 * Faults come from the one memory store (`test-support/memory-draft-stores.ts`):
 * refused writes, a refused meta write, and a crash after any number of
 * landed changes.
 */
import fc from "fast-check";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import {
  serializeTourManifest,
  type TourAsset,
  type TourObject,
  type TourPicture,
  type TourPin,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { packFilesAsZip } from "gps-plus-slam-app-framework/storage";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";

import { objectContentKey } from "./authoring-draft.js";
import { wireCreatorSetup, type CreatorSetupDom } from "./creator-setup.js";
import { createEditorDraft } from "./editor/editor-draft.js";
import { createEditorSession } from "./editor/editor-session.js";
import { NOT_BACKED_UP } from "./object-editing.js";
import type { ObjectListHandlers, ObjectListModel } from "./object-list.js";
import { openTourFile } from "./tour-session.js";
import { createTourViewerSession } from "./tour-viewer-session.js";
import {
  documentObjects,
  manifestToWrite,
  selectTourDocument,
} from "./tour-document.js";
import { SETTINGS_KEY } from "./tour-document-draft.js";
import { editorStore } from "./test-support/editor-store.js";
import {
  freeLocks,
  memoryDraftOps,
  memoryDraftStores,
  type MemoryDraftStores,
} from "./test-support/memory-draft-stores.js";
import { pngBlob } from "./test-support/png-blob.js";
import { settle } from "./test-support/settle.js";
import { tourOf } from "./test-support/tour-of.js";

// --- the tour both pages open ----------------------------------------------

function pin(id: string, caption = `pin ${id}`, lat = 48.52): TourPin {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption,
    createdAtIso: "2026-11-21T00:00:00.000Z",
    geo: { lat, lon: 9.05, alt: 340, headingDeg: 0 },
  };
}

/** Two pins, each in a station of its own (`st-a`, `st-b`). */
const OPENED = [pin("a"), pin("b", "pin b", 48.5202)];

/** About 33 m north of pin a: beyond every station's radius. */
const NORTH = 48.5205;

/** Where a station is moved to (a code's re-measure on the phone, a drag
 *  on the desktop). */
const MOVED: QrGeoPose = {
  lat: NORTH,
  lon: 9.0503,
  alt: 340,
  rotation: [0, 0, 0, 1],
};

async function tourFile(): Promise<File> {
  const zip = await packFilesAsZip([
    { path: "tour.json", data: serializeTourManifest(tourOf(OPENED)) },
  ]);
  return new File([zip], "tour.zip", { type: "application/zip" });
}

/** A level file's text for a code standing at `geo` (the phone's settle
 *  writes one with a station it moved). */
function levelAt(geo: QrGeoPose): string {
  return JSON.stringify({
    version: 1,
    qr: {
      text: "https://example.invalid/?qr=station",
      physicalSizeM: 0.16,
      geo,
    },
  });
}

/** Until every draft write and the page's store have stopped changing. */
function flush(page?: { getState(): unknown }): Promise<void> {
  return settle(() => [memoryDraftOps(), page?.getState()]);
}

// --- what a page shows ------------------------------------------------------

/** The document a page holds: every object's content and every station's
 *  pose, order-free. Two pages holding the same tour compare equal. */
interface DocumentShape {
  readonly objects: readonly string[];
  readonly stations: readonly string[];
}

function shapeOf(store: ReturnType<typeof editorStore>): DocumentShape {
  const state = selectTourDocument(store.getState());
  return {
    objects: documentObjects(state)
      .map((o) => objectContentKey(o.object))
      .sort(),
    stations: (manifestToWrite(state)?.stations ?? [])
      .map((s) => JSON.stringify({ id: s.id, geo: s.geo }))
      .sort(),
  };
}

/** One page over one browser's draft, driven through its own code path. */
interface DraftPage {
  edit(id: string, text: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** The document's last step taken back (the delete toast's Undo on the
   *  phone, the editor's undo). */
  undo(): Promise<void>;
  /** A new pin (the phone: as its AR placement places it). */
  place(object: TourObject): Promise<void>;
  /** A new photo `id` with its picture (the phone: a captured photo; the
   *  desktop: a picture file brought in, then placed). */
  placePhoto(id: string): Promise<void>;
  /** A station moved with its items (the phone: as its settle moves it
   *  after a code's re-measure; the desktop: a drag). */
  moveStation(stationId: string, geo: QrGeoPose): Promise<void>;
  /** The offer's words; "" while nothing is offered. */
  offer(): string;
  /** The offer's three answers. */
  restore(): Promise<void>;
  decline(): Promise<void>;
  discard(): Promise<void>;
  /** The document the page holds now. */
  shape(): DocumentShape;
  /** The page said something it should keep did not land: that this
   *  device keeps no backup copy, or that a "Delete it" did not delete. */
  saidNotKept(): boolean;
  /** The files of this page's draft namespace. */
  space(): Map<string, Blob | string>;
  /** The key of a picture's bytes for photo `id`, as this page's draft
   *  names it (the phone keeps them by object id, the desktop by asset). */
  pictureKey(id: string): string;
}

type PageName = "phone" | "desktop";

/** A new load of the tour over `browser`'s drafts, the offer unanswered. */
type OpenPage = (browser: MemoryDraftStores) => Promise<DraftPage>;

// --- the desktop editor -----------------------------------------------------

const openDesktop: OpenPage = async (browser) => {
  const session = await openTourFile(await tourFile());
  const manifest = tourOf(OPENED);
  let warned = false;
  let key: string | null = null;
  const draft = createEditorDraft({
    openStore: (k) => {
      key = k;
      return browser.open(k);
    },
    holdLock: freeLocks,
    noBackup: () => {
      warned = true;
    },
  });
  const opened = await draft.open(session.archive.url, manifest);
  const store = editorStore();
  const editor = createEditorSession({
    session,
    manifest,
    levels: new Map(),
    draft: draft.writes(),
    store,
  });
  let offer = opened.offer;
  const pictures = new Map<string, string>();
  const idle = async () => {
    await draft.idle();
    await flush(store);
  };
  // The open's own writes (its meta, rewritten with the pruned rejections)
  // land before the creator acts, as on the phone.
  await idle();
  return {
    edit: (id, text) => {
      editor.editText(id, text);
      return idle();
    },
    remove: (id) => {
      editor.remove(id);
      return idle();
    },
    undo: () => {
      editor.undo();
      return idle();
    },
    place: (object) => {
      editor.place(object);
      return idle();
    },
    placePhoto: async (id) => {
      // As the page's file drop brings a picture in and places it: the
      // shelf keeps it as made, so no optimizer runs here.
      const read = await editor.addFile(pngBlob(4, 3), `${id}.png`, undefined, {
        asMade: true,
      });
      if (read.kind === "refused") throw new Error(read.reason);
      pictures.set(id, read.asset.id);
      editor.place(photo(id, read.asset));
      await idle();
    },
    moveStation: (stationId, geo) => {
      editor.moveStation(stationId, geo);
      return idle();
    },
    offer: () => offer?.text ?? "",
    restore: async () => {
      // As `edit-main.ts`'s offer toast runs Restore.
      if (offer === null) throw new Error("the desktop offered nothing");
      editor.restore(offer);
      draft.restored();
      offer = null;
      await idle();
    },
    decline: () => {
      // "Not now" only closes the toast: the offer waits for the next open.
      offer = null;
      return idle();
    },
    discard: async () => {
      // "Delete it"; a refused discard is said in a toast of its own.
      if (!(await draft.discard())) warned = true;
      offer = null;
      await idle();
    },
    shape: () => shapeOf(store),
    saidNotKept: () => warned,
    space: () => {
      if (key === null) throw new Error("the desktop opened no draft");
      return browser.spaces.get(key) ?? new Map();
    },
    pictureKey: (id) => `asset:${pictures.get(id) ?? id}`,
  };
};

// --- the phone --------------------------------------------------------------

const PHONE_DOM_KEYS = [
  "panel",
  "controls",
  "finishBlock",
  "replaceHelp",
  "replaceHelpGeneric",
  "replaceHelpDrive",
  "replaceDriveCopy",
  "uploadAsk",
  "uploadAskText",
  "uploadYes",
  "uploadNo",
  "sizeInput",
  "printPanel",
  "status",
  "finishButton",
  "finishStatus",
  "downloadButton",
  "pinButton",
  "pinLabel",
  "pinSave",
  "pinCancel",
  "photoButton",
  "draftOffer",
  "draftOfferText",
  "draftRestore",
  "draftDismiss",
  "draftDiscard",
  "sizeOffer",
  "sizeOfferText",
  "sizeOfferUse",
  "sizeOfferKeep",
  "objectList",
  "keepScanRow",
  "keepScanInput",
  "debugSave",
  "debugSaveText",
  "debugSaveButton",
  "debugSaveStatus",
] as const;

function phoneElement() {
  const handlers = new Map<string, () => void>();
  return {
    hidden: false,
    textContent: "",
    disabled: false,
    value: "",
    checked: false,
    open: false,
    dataset: {} as Record<string, string>,
    focus: () => undefined,
    addEventListener: (type: string, handler: () => void) =>
      handlers.set(type, handler),
    click: () => handlers.get("click")?.(),
    scrollIntoView: () => undefined,
    listHandlers: null as ObjectListHandlers | null,
    bind(bound: ObjectListHandlers) {
      this.listHandlers = bound;
    },
    /** The object list's last note: a row's outcome. */
    note: "",
    render(model: ObjectListModel) {
      this.note = model.note;
    },
  };
}

/** The phone's words for a write that did not land: a row's outcome
 *  (`NOT_BACKED_UP`), the page's backup warning, or a "Delete it" that
 *  did not delete. */
const PHONE_NOT_KEPT = [
  NOT_BACKED_UP,
  "not saving a backup copy",
  "Could not delete the saved draft",
];

const openPhone: OpenPage = async (browser) => {
  const session = await openTourFile(await tourFile());
  const dom = Object.fromEntries(
    PHONE_DOM_KEYS.map((k) => [k, phoneElement()]),
  ) as Record<(typeof PHONE_DOM_KEYS)[number], ReturnType<typeof phoneElement>>;
  // One store for the page, as `main.ts` wires it.
  const store = editorStore();
  const ctx = createTourViewerSession(store);
  ctx.session = session;
  ctx.tourManifestStatus = "settled";
  ctx.tourDocument.open(tourOf(OPENED));
  ctx.currentLevels = await session.loadQrLevels();
  ctx.currentLevelTexts = session.levelTexts();
  let key: string | null = null;
  const setup = wireCreatorSetup({
    ctx,
    mode: "creator",
    arStore: store,
    arController: {
      getState: () => ({ status: "idle" }),
      disable: () => Promise.resolve(),
    } as never,
    seams: {
      canShareZip: () => false,
      downloadZip: () => Promise.resolve(true),
      getScene: () => null,
      schedule: (fn: () => void, ms: number) => {
        const timer = setTimeout(fn, ms);
        return () => {
          clearTimeout(timer);
        };
      },
    } as never,
    wizard: {
      openStep: () => undefined,
      revealStep: () => undefined,
    } as never,
    dom: dom as unknown as CreatorSetupDom,
    openDraftStore: (k) => {
      key = k;
      return browser.open(k);
    },
  });
  let warned = false;
  /** The page's notes are overwritten by later lines; remember the
   *  warning. The phone says a refused write where the creator acted: the
   *  object list's row note, or the page's line. */
  const idle = async () => {
    await flush(store);
    const notes = [ctx.placementNote ?? "", dom.objectList.note];
    if (PHONE_NOT_KEPT.some((w) => notes.some((n) => n.includes(w)))) {
      warned = true;
    }
  };
  /** A change this adapter takes on the document itself, said as the
   *  phone's caller of it says it: the undo (`creator-undo.ts`), the
   *  placement (`creator-placement.ts`) and the settle
   *  (`creator-settle.ts`) each warn on a `backedUp` false. */
  const sayUnlanded = (change: { backedUp: Promise<boolean> } | null) => {
    void change?.backedUp.then((ok) => {
      if (!ok) warned = true;
    });
  };
  setup.presentDraftForTour(session.archive.url);
  await idle();
  const list = (): ObjectListHandlers => {
    const bound = dom.objectList.listHandlers;
    if (bound === null) throw new Error("the object list was not bound");
    return bound;
  };
  const answer = async (button: ReturnType<typeof phoneElement>) => {
    if (dom.draftOfferText.textContent === "") {
      throw new Error("the phone offered nothing");
    }
    button.click();
    await idle();
  };
  return {
    edit: async (id, text) => {
      list().editText(id, text);
      await idle();
    },
    remove: async (id) => {
      list().remove(id);
      await idle();
    },
    undo: async () => {
      const undone = ctx.tourDocument.undo();
      sayUnlanded(undone.kind === "undone" ? undone : null);
      await idle();
    },
    place: async (object) => {
      // As `creator-placement.ts` places after a tap in AR.
      sayUnlanded(ctx.tourDocument.place(object, {}, "a pin"));
      await idle();
    },
    placePhoto: async (id) => {
      // As a captured photo is placed: its picture rides with it.
      const asset: TourAsset = {
        id,
        path: `content/${id}.jpg`,
        kind: "image",
        width: 4,
        height: 3,
      };
      sayUnlanded(
        ctx.tourDocument.place(
          photo(id, asset),
          { blob: pngBlob(4, 3) },
          "a photo",
        ),
      );
      await idle();
    },
    moveStation: async (stationId, geo) => {
      // As `creator-settle.ts`'s settle moves it once its code was
      // re-measured: the move and the code's new text as one step.
      const batch = ctx.tourDocument.settleBatch();
      batch.moveStation(stationId, geo);
      sayUnlanded(
        setup.codes.applySettle(
          batch,
          [{ id: `code-${stationId}`, json: levelAt(geo) }],
          "the settle of this visit",
        ),
      );
      await idle();
    },
    offer: () => (dom.draftOffer.hidden ? "" : dom.draftOfferText.textContent),
    restore: () => answer(dom.draftRestore),
    decline: () => answer(dom.draftDismiss),
    discard: () => answer(dom.draftDiscard),
    shape: () => shapeOf(store),
    saidNotKept: () => warned,
    space: () => {
      if (key === null) throw new Error("the phone opened no draft");
      return browser.spaces.get(key) ?? new Map();
    },
    pictureKey: (id) => `photo:${id}`,
  };
};

/** A photo object standing at pin a's station. */
function photo(id: string, asset: TourAsset): TourPicture {
  return {
    id,
    kind: "picture",
    view: "plane",
    image: asset.id,
    widthM: 1,
    imageAsset: asset,
    createdAtIso: "2026-11-21T00:00:00.000Z",
    geo: { lat: 48.5201, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
  };
}

const PAGES: readonly (readonly [PageName, OpenPage])[] = [
  ["phone", openPhone],
  ["desktop", openDesktop],
];

/** A page opened over a fresh browser, nothing in its drafts. */
async function freshPage(open: OpenPage): Promise<{
  browser: MemoryDraftStores;
  page: DraftPage;
  opened: DocumentShape;
}> {
  const browser = memoryDraftStores();
  const page = await open(browser);
  expect(page.offer()).toBe("");
  return { browser, page, opened: page.shape() };
}

/** The tab closed with `page` as it stands, and the tour opened again in
 *  the same browser: the next load and what it offers. */
async function reopen(
  open: OpenPage,
  browser: MemoryDraftStores,
): Promise<DraftPage> {
  browser.crashAfter = null;
  return open(browser);
}

// --- the table --------------------------------------------------------------

/** The common shape of most rows: work on a fresh page, then a reopen
 *  that offers it and a Restore that brings back what the page held. */
async function restoresWhatWasLeft(
  open: OpenPage,
  work: (page: DraftPage) => Promise<void>,
): Promise<DraftPage> {
  const { browser, page, opened } = await freshPage(open);
  await work(page);
  const left = page.shape();
  expect(left).not.toEqual(opened);
  expect(page.saidNotKept()).toBe(false);
  const next = await reopen(open, browser);
  expect(next.offer()).not.toBe("");
  expect(next.shape()).toEqual(opened);
  await next.restore();
  expect(next.shape()).toEqual(left);
  expect(next.offer()).toBe("");
  return next;
}

/** Whether the page holds an object with this id. */
function holds(page: DraftPage, id: string): boolean {
  return page.shape().objects.some((o) => o.includes(`"id":"${id}"`));
}

/** Each row once per page, through the page's adapter (`PAGES`). */
describe.each(PAGES)("the %s page's draft", (name, open) => {
  // Why: a placement only this device knows is the work a crash would
  // cost most; the next open must offer it and Restore bring it back.
  it("create: a new pin is offered at the next open and restored", async () => {
    const next = await restoresWhatWasLeft(open, (p) =>
      p.place(pin("new", "A new pin", NORTH)),
    );
    expect(holds(next, "new")).toBe(true);
  }, 60_000);

  it("edit: a pin's new text is offered at the next open and restored", async () => {
    const next = await restoresWhatWasLeft(open, (p) =>
      p.edit("a", "The gate"),
    );
    expect(next.shape().objects.some((o) => o.includes('"The gate"'))).toBe(
      true,
    );
  }, 60_000);

  // Why: a deletion of a pin the file carries is a tombstone, not a
  // missing record: the reopen must take the pin out again.
  it("delete: a deleted pin is offered as a deletion and stays gone after Restore", async () => {
    const next = await restoresWhatWasLeft(open, (p) => p.remove("b"));
    expect(holds(next, "b")).toBe(false);
  }, 60_000);

  // Why: an undo of a delete must take the tombstone away too, or the
  // next restore deletes the pin the creator took back.
  it("undo: a delete taken back is not offered as a deletion; the edit beside it is", async () => {
    const next = await restoresWhatWasLeft(open, async (p) => {
      await p.edit("a", "The gate");
      await p.remove("b");
      await p.undo();
    });
    expect(holds(next, "b")).toBe(true);
  }, 60_000);

  // Why: an edit undone back to the opened text leaves nothing to
  // offer; an offer of it would ask the creator about no change.
  it("undo: an edit undone back to the opened text leaves nothing to offer", async () => {
    const { browser, page, opened } = await freshPage(open);
    await page.edit("a", "The gate");
    await page.undo();
    expect(page.shape()).toEqual(opened);
    const next = await reopen(open, browser);
    expect(next.offer()).toBe("");
    expect(next.shape()).toEqual(opened);
  }, 60_000);

  // Why: "Not now" changes nothing on disk: the work waits, offered
  // again at every later open until it is answered.
  it("decline: after Not now the next open offers the same work again", async () => {
    const { browser, page, opened } = await freshPage(open);
    await page.edit("a", "The gate");
    const left = page.shape();
    const offered = await reopen(open, browser);
    const words = offered.offer();
    expect(words).not.toBe("");
    await offered.decline();
    expect(offered.offer()).toBe("");
    expect(offered.shape()).toEqual(opened);
    const again = await reopen(open, browser);
    expect(again.offer()).toBe(words);
    await again.restore();
    expect(again.shape()).toEqual(left);
  }, 60_000);

  // Why: "Delete it" is a rejection kept on disk (the meta): it must
  // survive the reopen after it, so the work is never offered again.
  it("discard: a rejection survives the next open; nothing is offered again", async () => {
    const { browser, page, opened } = await freshPage(open);
    await page.edit("a", "The gate");
    await page.remove("b");
    await page.moveStation("st-a", MOVED);
    const offered = await reopen(open, browser);
    await offered.discard();
    expect(offered.saidNotKept()).toBe(false);
    expect(offered.shape()).toEqual(opened);
    const after = await reopen(open, browser);
    expect(after.offer()).toBe("");
    expect(after.shape()).toEqual(opened);
    // And twice: the rejection is not spent by the first open after it.
    const later = await reopen(open, browser);
    expect(later.offer()).toBe("");
  }, 60_000);

  // Why: a rejection whose meta write did not land must not be half
  // done: the work stays whole and is offered again (the safe side),
  // never lost without the creator's answer having landed.
  it("discard with a refused meta write: the page says so and the next open offers the work again", async () => {
    const { browser, page } = await freshPage(open);
    await page.edit("a", "The gate");
    const left = page.shape();
    const offered = await reopen(open, browser);
    const words = offered.offer();
    browser.failMetaPuts = 1;
    await offered.discard();
    browser.failMetaPuts = 0;
    expect(offered.saidNotKept()).toBe(true);
    const again = await reopen(open, browser);
    expect(again.offer()).toBe(words);
    await again.restore();
    expect(again.shape()).toEqual(left);
  }, 60_000);

  // Why: a write that does not land must be said, never silently
  // promise a backup the device does not hold.
  it("a refused object write: the page says it keeps no backup", async () => {
    const { browser, page } = await freshPage(open);
    browser.failPutsOf = /^object:a$/;
    await page.edit("a", "The gate");
    expect(page.saidNotKept()).toBe(true);
  }, 60_000);

  // Why: a moved station is held by the settings record (the station
  // poses), not by any object's record; without it a reopen would put
  // the station back where the file has it, its items with it.
  it("the settings record holds a moved station's pose; the next open restores it", async () => {
    let settings = "";
    const next = await restoresWhatWasLeft(open, async (p) => {
      await p.moveStation("st-a", MOVED);
      const kept = p.space().get(SETTINGS_KEY);
      settings = typeof kept === "string" ? kept : "";
    });
    expect(settings).not.toBe("");
    const record = JSON.parse(settings) as {
      stations?: { id: string; geo: QrGeoPose }[];
    };
    expect(record.stations?.find((s) => s.id === "st-a")?.geo).toEqual(MOVED);
    expect(next.shape().stations).toContain(
      JSON.stringify({ id: "st-a", geo: MOVED }),
    );
  }, 60_000);

  // Why: a station moved back to where the file has it is no change:
  // the next open must offer nothing. What stays on disk differs today
  // and is pinned per page: the desktop removes the settings record
  // once it equals the file; the phone keeps it, holding the file's
  // poses, and its open offers no pose equal to the file's.
  it("a moved station undone: the next open offers nothing", async () => {
    const { browser, page, opened } = await freshPage(open);
    await page.moveStation("st-a", MOVED);
    expect(page.space().has(SETTINGS_KEY)).toBe(true);
    await page.undo();
    expect(page.shape()).toEqual(opened);
    expect(page.space().has(SETTINGS_KEY)).toBe(name === "phone");
    const next = await reopen(open, browser);
    expect(next.offer()).toBe("");
    expect(next.shape()).toEqual(opened);
  }, 60_000);

  // Why: the parts of one change land one file at a time. When an
  // object's record is refused but its station's move lands, the reopen
  // brings the move back and the object follows its station, with the
  // text the file had: the same on both pages, and said as no backup.
  it("a refused edit beside a landed station move: the station moves, the text stays the file's", async () => {
    const { browser, page } = await freshPage(open);
    browser.failPutsOf = /^object:/;
    await page.edit("a", "The gate");
    await page.moveStation("st-a", MOVED);
    browser.failPutsOf = null;
    expect(page.saidNotKept()).toBe(true);
    const next = await reopen(open, browser);
    expect(next.offer()).not.toBe("");
    await next.restore();
    const restored = next.shape();
    expect(restored.stations).toContain(
      JSON.stringify({ id: "st-a", geo: MOVED }),
    );
    const a = restored.objects
      .map(
        (o) => JSON.parse(o) as { id: string; caption: string; geo: QrGeoPose },
      )
      .find((o) => o.id === "a");
    expect(a?.caption).toBe("pin a");
    expect([a?.geo.lat, a?.geo.lon]).toEqual([MOVED.lat, MOVED.lon]);
  }, 60_000);

  it("a photo and its picture are offered at the next open and restored", async () => {
    const next = await restoresWhatWasLeft(open, (p) => p.placePhoto("q"));
    expect(holds(next, "q")).toBe(true);
  }, 60_000);

  // Why: a photo is two files, its picture and its record. Whatever
  // order they land in, a crash between them must never bring back a
  // record without the picture it names: the reopen restores the photo
  // whole or not at all. The store ORDER differs today and is pinned per
  // page (the desktop writes the picture first; the phone writes the
  // record first and its reader drops a record whose picture is
  // missing), so a change of either is seen here.
  it("the picture before the record: a crash between them never restores a photo without its picture", async () => {
    // The order, from one run without a crash.
    const { browser, page } = await freshPage(open);
    const from = browser.log.length;
    await page.placePhoto("q");
    const changes = browser.log.slice(from);
    const picture = changes.indexOf(`put ${page.pictureKey("q")}`);
    const record = changes.indexOf("put object:q");
    expect(picture).toBeGreaterThanOrEqual(0);
    expect(record).toBeGreaterThanOrEqual(0);
    expect(picture < record).toBe(name === "desktop");
    // A crash after each landed change of the placement.
    for (let landed = 0; landed <= changes.length; landed += 1) {
      const run = await freshPage(open);
      run.browser.crashAfter = landed;
      await run.page.placePhoto("q");
      const next = await reopen(open, run.browser);
      const whole =
        next.space().has(run.page.pictureKey("q")) &&
        next.space().has("object:q");
      if (next.offer() !== "") await next.restore();
      expect(holds(next, "q"), `a crash after ${String(landed)}`).toBe(whole);
    }
  }, 60_000);
});

// --- the property -----------------------------------------------------------

type Op =
  | { readonly kind: "edit"; readonly id: "a" | "b"; readonly text: string }
  | { readonly kind: "remove"; readonly id: "a" | "b" }
  | { readonly kind: "undo" }
  | { readonly kind: "place"; readonly n: number }
  | { readonly kind: "moveStation"; readonly id: "st-a" | "st-b" };

/** A fault set before one operation: a refused write of one record
 *  family, a refused meta write, or a whole namespace refusing. */
type Fault =
  | { readonly kind: "none" }
  | { readonly kind: "refuse"; readonly keys: RegExp }
  | { readonly kind: "meta" };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant("edit" as const),
    id: fc.constantFrom("a" as const, "b" as const),
    text: fc.constantFrom("The gate", "The well", "pin a"),
  }),
  fc.record({
    kind: fc.constant("remove" as const),
    id: fc.constantFrom("a" as const, "b" as const),
  }),
  fc.constant({ kind: "undo" as const }),
  fc.record({ kind: fc.constant("place" as const), n: fc.nat(2) }),
  fc.record({
    kind: fc.constant("moveStation" as const),
    id: fc.constantFrom("st-a" as const, "st-b" as const),
  }),
);

const faultArb: fc.Arbitrary<Fault> = fc.oneof(
  { weight: 3, arbitrary: fc.constant({ kind: "none" as const }) },
  fc.constantFrom(
    { kind: "refuse" as const, keys: /^object:/ },
    { kind: "refuse" as const, keys: /^deleted:/ },
    { kind: "refuse" as const, keys: new RegExp(`^${SETTINGS_KEY}$`) },
  ),
  fc.constant({ kind: "meta" as const }),
);

async function apply(page: DraftPage, op: Op): Promise<void> {
  switch (op.kind) {
    case "edit":
      return page.edit(op.id, op.text);
    case "remove":
      return page.remove(op.id);
    case "undo":
      return page.undo();
    case "place":
      // Each beyond every radius, so each starts a station of its own.
      return page.place(
        pin(`n${String(op.n)}`, `new ${String(op.n)}`, NORTH + op.n * 0.001),
      );
    case "moveStation":
      return page.moveStation(op.id, {
        ...MOVED,
        lat: op.id === "st-a" ? NORTH + 0.003 : NORTH + 0.004,
      });
  }
}

/** An object's content apart from where it stands: without its station
 *  id and its place, which follow its station. */
function seenOf(content: string): string {
  const {
    station: _station,
    geo: _geo,
    ...shown
  } = JSON.parse(content) as Record<string, unknown>;
  return JSON.stringify(shown);
}

/** Sequences and their faults per page; raised for a sweep. */
const RUNS = 25;

describe.each(PAGES)("the %s page's draft, a property", (_name, open) => {
  it("for random edits with faults, a reopen restores the document the page held, or the page said a write did not land; it never restores a text the page never held", async () => {
    // Why this test matters: the rows pin each behaviour alone; the
    // composed sequences (an undo after a refused write, a delete over a
    // moved station, a place after a refused meta) are where two drafts'
    // rules drift. What must hold on both pages after ANY sequence: a
    // closed tab and a Restore bring back exactly what the page held -
    // unless a write did not land, which the page must then have said -
    // and never a text or kind of an object the creator never saw
    // (`seenOf`). Where an object stands is left out of that: after a
    // refused write an object may stand where its moved station put it
    // with the text the file had (the row "a refused edit beside a
    // landed station move"), and after a refused settings write the phone
    // seats a new pin in a station minted again under another id; both
    // are said to the creator as no backup.
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(opArb, faultArb), { minLength: 1, maxLength: 6 }),
        async (steps) => {
          const { browser, page, opened } = await freshPage(open);
          const held = new Set(opened.objects.map(seenOf));
          for (const [op, fault] of steps) {
            browser.failPutsOf = fault.kind === "refuse" ? fault.keys : null;
            browser.failMetaPuts = fault.kind === "meta" ? 1 : 0;
            await apply(page, op);
            browser.failPutsOf = null;
            browser.failMetaPuts = 0;
            for (const o of page.shape().objects) held.add(seenOf(o));
          }
          const left = page.shape();
          const next = await reopen(open, browser);
          if (next.offer() !== "") await next.restore();
          const restored = next.shape();
          for (const o of restored.objects) expect(held).toContain(seenOf(o));
          // Exactly what the page held, unless the page said otherwise.
          expect(
            page.saidNotKept() || isDeepStrictEqual(restored, left),
            "restored another document without saying a write did not land",
          ).toBe(true);
        },
      ),
      { numRuns: RUNS },
    );
  }, 600_000);
});
