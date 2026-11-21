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
import { Group, Matrix4, type Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { MIN_ALIGNMENT_SAMPLES } from "gps-plus-slam-app-framework/ar/qr/qr-mint-level";
import type { UnknownAction } from "@reduxjs/toolkit";
import {
  serializeTourManifest,
  type TourAsset,
  type TourManifest,
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
  effectiveDetails,
  manifestToWrite,
  selectTourDocument,
  tourDocumentActions,
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

/** A picture the opened tour lists, which a character may show. */
const CAST: TourAsset = {
  id: "cast1",
  path: "content/cast1.png",
  kind: "image",
  width: 4,
  height: 2,
};

/** The tour both pages open: `OPENED`, its file listing `CAST`. */
function openedTour(): TourManifest {
  const manifest = tourOf(OPENED);
  return { ...manifest, assets: [...manifest.assets, CAST] };
}

/** About 33 m north of pin a: beyond every station's radius. */
const NORTH = 48.5205;

/** A new pin's spot `at`: 100 m apart, north of everything else. */
const SPOT_NORTH_M = (at: number): number => 100 * (at + 1);
/** The same spot's latitude (one degree of latitude is about 111 km). */
const spotLat = (at: number): number => NORTH + SPOT_NORTH_M(at) / 111_000;

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
    { path: "tour.json", data: serializeTourManifest(openedTour()) },
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

/** What the document holds beyond its objects' content and its stations'
 *  poses: the tour's details, the stations' order and titles, and the
 *  declared characters. */
function extrasOf(store: ReturnType<typeof editorStore>): string {
  const state = selectTourDocument(store.getState());
  const written = manifestToWrite(state);
  return JSON.stringify({
    details: effectiveDetails(state),
    stations: (written?.stations ?? []).map((s) => [s.id, s.title ?? null]),
    characters: written?.characters ?? [],
  });
}

/** One page over one browser's draft, driven through its own code path. */
interface DraftPage {
  edit(id: string, text: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** The document's last step taken back, as this page's creator takes
   *  it back: the editor's undo; on the phone the delete's Undo beside its
   *  note, or a settle's Undo. False: no creator of this page can take
   *  that step back (an edit or a placement on the phone), nothing done. */
  undo(): Promise<boolean>;
  /** A new pin at spot `at` (0, 1 or 2), each spot beyond every other
   *  station's radius (the phone: its AR placement's Save); its id. */
  place(at: number): Promise<string>;
  /** A new photo `id` with its picture (the phone: a captured photo; the
   *  desktop: a picture file brought in, then placed). */
  placePhoto(id: string): Promise<void>;
  /** A station moved with its items (the phone: as its settle moves it
   *  after a code's re-measure; the desktop: a drag). */
  moveStation(stationId: string, geo: QrGeoPose): Promise<void>;
  /** A change of the document made through the page's store: work this
   *  page's own controls may not reach (the phone renames no station,
   *  reorders none and declares no character), which its draft keeps all
   *  the same. */
  act(action: UnknownAction): Promise<void>;
  /** The offer's words; "" while nothing is offered. While a draft is
   *  undecided, an edit waits and the offer is shown again as the
   *  question the edit waits for. */
  offer(): string;
  /** The offer's three answers. Restore and "Delete it" then let a
   *  waiting edit through; "Not now" drops it. */
  restore(): Promise<void>;
  decline(): Promise<void>;
  discard(): Promise<void>;
  /** The document the page holds now. */
  shape(): DocumentShape;
  /** The document's details, station order and titles, and characters. */
  extras(): string;
  /** Whether the draft is undecided (offered, or put off with "Not
   *  now"): an edit then waits for the answer. */
  undecided(): boolean;
  /** The page said something it should keep did not land: that this
   *  device keeps no backup copy, or that a "Delete it" did not delete. */
  saidNotKept(): boolean;
  /** The files of this page's draft namespace. */
  space(): Map<string, Blob | string>;
  /** The key of a picture's bytes for photo `id`, as this page's draft
   *  names it (the phone keeps them by object id, the desktop by asset). */
  pictureKey(id: string): string;
  /** The tab closes: the page lets go of its draft. */
  close(): void;
}

/** The ids of the objects a document holds. */
function idsOf(shape: DocumentShape): string[] {
  return shape.objects.map((o) => (JSON.parse(o) as { id: string }).id);
}

type PageName = "phone" | "desktop";

/** A new load of the tour over `browser`'s drafts, the offer unanswered. */
type OpenPage = (browser: MemoryDraftStores) => Promise<DraftPage>;

// --- the desktop editor -----------------------------------------------------

const openDesktop: OpenPage = async (browser) => {
  const session = await openTourFile(await tourFile());
  const manifest = openedTour();
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
  // As `edit-main.ts` arms it with its offer: an edit waits for the
  // answer, and asking shows the offer again.
  let shown = offer !== null;
  if (offer !== null) {
    store.draftGate.hold(() => {
      shown = true;
    });
  }
  const pictures = new Map<string, string>();
  let placed = 0;
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
    undo: async () => {
      editor.undo();
      await idle();
      return true;
    },
    place: async (at) => {
      placed += 1;
      const id = `n${String(at)}-${String(placed)}`;
      editor.place(pin(id, `new ${String(at)}`, spotLat(at)));
      await idle();
      return id;
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
    act: (action) => {
      store.dispatch(action);
      return idle();
    },
    offer: () => (shown ? (offer?.text ?? "") : ""),
    restore: async () => {
      // As `edit-main.ts`'s offer toast runs Restore: the draft, then the
      // edits that waited for it.
      if (offer === null) throw new Error("the desktop offered nothing");
      editor.restore(offer);
      draft.restored();
      store.draftGate.release();
      offer = null;
      shown = false;
      await idle();
    },
    decline: () => {
      // "Not now" closes the toast and drops a waiting edit: the offer
      // waits for the next open, or the next edit.
      shown = false;
      store.draftGate.drop();
      return idle();
    },
    discard: async () => {
      // "Delete it", then the edits that waited; a refused discard is
      // said, and the question stays with the edits still waiting.
      if (!(await draft.discard())) {
        warned = true;
      } else {
        store.draftGate.release();
        offer = null;
        shown = false;
      }
      await idle();
    },
    shape: () => shapeOf(store),
    extras: () => extrasOf(store),
    undecided: () => store.draftGate.holding(),
    saidNotKept: () => warned,
    space: () => {
      if (key === null) throw new Error("the desktop opened no draft");
      return browser.spaces.get(key) ?? new Map();
    },
    pictureKey: (id) => `asset:${pictures.get(id) ?? id}`,
    close: () => {
      draft.close();
    },
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
    /** The object list's last note (a row's outcome) and whether it
     *  offers the delete's Undo beside it. */
    note: "",
    undo: false,
    render(model: ObjectListModel) {
      this.note = model.note;
      this.undo = model.undo;
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
  ctx.tourDocument.open(openedTour());
  ctx.currentLevels = await session.loadQrLevels();
  ctx.currentLevelTexts = session.levelTexts();
  let key: string | null = null;
  // What a placement reads, as in a running AR visit lined up on GPS: a
  // ring with a surface under it, a world group, the GPS zero and enough
  // fixes. The session runs only while a Save is tapped: outside it the
  // object list offers the delete's Undo, as on the page.
  let arStatus = "idle";
  let spot = 0;
  ctx.reticle = {
    isVisible: () => true,
    getWorldPosition: (v: Vector3) => v.set(SPOT_NORTH_M(spot), 0, 0),
  } as never;
  const worldGroup = new Group();
  worldGroup.updateMatrixWorld();
  const gpsData = {
    zero: { lat: NORTH, lon: 9.05 },
    gpsEvents: {
      alignmentMatrix: new Matrix4(),
      gpsPositions: Array.from({ length: MIN_ALIGNMENT_SAMPLES }, () => ({
        latitude: NORTH,
        longitude: 9.05,
      })),
    },
  };
  const arStore = {
    ...store,
    getState: () => ({ ...store.getState(), gpsData }),
  };
  const setup = wireCreatorSetup({
    ctx,
    mode: "creator",
    arStore: arStore as never,
    arController: {
      getState: () => ({ status: arStatus }),
      disable: () => Promise.resolve(),
    } as never,
    seams: {
      getArWorldGroup: () => worldGroup,
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
  /** A change this adapter takes on the document itself, read at its
   *  `backedUp` as the phone's caller of it reads it: a settle and its
   *  Undo (`creator-settle.ts`, `creator-undo.ts`) and a captured
   *  photo's placement (`creator-placement.ts`) each say a false. */
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
  /** The step an Undo would take back, by the way the creator made it. */
  let last: "remove" | "settle" | "other" = "other";
  const answer = async (button: ReturnType<typeof phoneElement>) => {
    if (dom.draftOfferText.textContent === "") {
      throw new Error("the phone offered nothing");
    }
    button.click();
    await idle();
  };
  return {
    edit: async (id, text) => {
      last = "other";
      list().editText(id, text);
      await idle();
    },
    remove: async (id) => {
      last = "remove";
      list().remove(id);
      await idle();
    },
    undo: async () => {
      const step = last;
      last = "other";
      if (step === "remove" && dom.objectList.undo) {
        // The Undo beside the delete's note.
        list().undo();
        await idle();
        return true;
      }
      if (step !== "settle") return false;
      // As the settle's Undo runs `undoSettle`: the document's undo.
      const undone = ctx.tourDocument.undo();
      sayUnlanded(undone.kind === "undone" ? undone : null);
      await idle();
      return undone.kind === "undone";
    },
    place: async (at) => {
      // The pin's text typed, then Save, as `creator-setup.test.ts` taps it.
      last = "other";
      const before = new Set(idsOf(shapeOf(store)));
      spot = at;
      arStatus = "running";
      dom.pinLabel.value = `new ${String(at)}`;
      dom.pinSave.click();
      arStatus = "idle";
      await idle();
      const id = idsOf(shapeOf(store)).find((i) => !before.has(i));
      // A placement that waits for the draft's answer places nothing yet.
      if (id === undefined && !dom.draftOffer.hidden) return "";
      if (id === undefined) {
        throw new Error(`the phone placed nothing: ${ctx.placementNote ?? ""}`);
      }
      return id;
    },
    placePhoto: async (id) => {
      last = "other";
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
      last = "settle";
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
    act: (action) => {
      store.dispatch(action);
      return idle();
    },
    offer: () => (dom.draftOffer.hidden ? "" : dom.draftOfferText.textContent),
    restore: () => answer(dom.draftRestore),
    decline: () => answer(dom.draftDismiss),
    discard: () => answer(dom.draftDiscard),
    shape: () => shapeOf(store),
    extras: () => extrasOf(store),
    undecided: () => store.draftGate.holding(),
    saidNotKept: () => warned,
    space: () => {
      if (key === null) throw new Error("the phone opened no draft");
      return browser.spaces.get(key) ?? new Map();
    },
    pictureKey: (id) => `photo:${id}`,
    close: () => {
      // As a tour closes on the page: its draft namespace goes with it.
      setup.resetFinishStep();
    },
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
  closing?: DraftPage,
): Promise<DraftPage> {
  closing?.close();
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
  return holdsIn(page.shape(), id);
}

/** Whether a document holds an object with this id. */
function holdsIn(shape: DocumentShape, id: string): boolean {
  return shape.objects.some((o) => o.includes(`"id":"${id}"`));
}

/** Each row once per page, through the page's adapter (`PAGES`). */
describe.each(PAGES)("the %s page's draft", (name, open) => {
  // Why: a placement only this device knows is the work a crash would
  // cost most; the next open must offer it and Restore bring it back.
  it("create: a new pin is offered at the next open and restored", async () => {
    let id = "";
    const next = await restoresWhatWasLeft(open, async (p) => {
      id = await p.place(0);
    });
    expect(holds(next, id)).toBe(true);
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
      expect(await p.undo()).toBe(true);
    });
    expect(holds(next, "b")).toBe(true);
  }, 60_000);

  // Why: an edit undone back to the opened text leaves nothing to
  // offer; an offer of it would ask the creator about no change. The
  // phone offers no Undo of an edit (its list says the outcome only), so
  // the row is the desktop's; its phone half pins that.
  it("undo: an edit undone back to the opened text leaves nothing to offer", async () => {
    const { browser, page, opened } = await freshPage(open);
    await page.edit("a", "The gate");
    expect(await page.undo()).toBe(name === "desktop");
    if (name === "phone") return;
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
    expect(await page.undo()).toBe(true);
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

  // Why: "Not now" is for looking only. An edit made after it waits for
  // the answer to the offer, asked again, and never lands on the
  // undecided draft: every part of the draft survives - the parts the
  // settings record holds (the tour's name, the stations' order, a
  // character) as much as a deletion - until "Delete it" takes it all.
  // Each written on its own, so a part the page loses shows by name.
  const DECLINED: readonly (readonly [
    string,
    (page: DraftPage) => Promise<void>,
  ])[] = [
    [
      "a rename of the tour",
      (p) =>
        p.act(
          tourDocumentActions.detailsChanged({
            details: { title: "The castle walk" },
            what: "the tour's name",
          }),
        ),
    ],
    [
      "a reorder of the stations",
      (p) =>
        p.act(
          tourDocumentActions.stationsReordered({
            order: ["st-b", "st-a"],
            what: "the stations' order",
          }),
        ),
    ],
    ["a deletion", (p) => p.remove("b")],
    [
      "a character",
      (p) =>
        p.act(
          tourDocumentActions.characterDeclared({
            character: { id: "c1abc", name: "Ranger Rita", image: CAST.id },
            what: "a character",
          }),
        ),
    ],
  ];

  /** The phone offers and restores the objects, the deletions and the
   *  station poses of a draft, not the rest of its settings record (the
   *  tour's details, the stations' own fields and order, the characters):
   *  a draft holding only those reads as spent there and is swept at the
   *  next open, Not now or not. A known gap of the phone page, recorded
   *  here so it turns green (and must be flipped) once the phone restores
   *  the whole record; only the deletion row holds on both pages. */
  const settingsGap = (work: string) =>
    name === "phone" && work !== "a deletion";

  describe.each(DECLINED)("%s declined with Not now", (workName, work) => {
    const gap = settingsGap(workName);
    /** The work left on a fresh page, the tour opened again, "Not now",
     *  and the first edit, which waits for the answer. */
    async function declinedThenEdited() {
      const { browser, page, opened } = await freshPage(open);
      const openedExtras = page.extras();
      await work(page);
      const left = { shape: page.shape(), extras: page.extras() };
      expect(left).not.toEqual({ shape: opened, extras: openedExtras });
      expect(page.saidNotKept()).toBe(false);
      const offered = await reopen(open, browser, page);
      await offered.decline();
      expect(offered.offer()).toBe("");
      await offered.edit("a", "The gate");
      // The edit waits: nothing is applied, and the offer asks again.
      expect(offered.shape()).toEqual(opened);
      expect(offered.extras()).toBe(openedExtras);
      expect(offered.offer()).not.toBe("");
      return { browser, offered, opened, openedExtras, left };
    }

    const caption = (p: DraftPage, id: string) =>
      p
        .shape()
        .objects.map((o) => JSON.parse(o) as { id: string; caption?: string })
        .find((o) => o.id === id)?.caption;

    async function survivesRestore(): Promise<void> {
      const { browser, offered, left } = await declinedThenEdited();
      await offered.restore();
      expect(offered.offer()).toBe("");
      expect(offered.extras()).toBe(left.extras);
      expect(holds(offered, "b")).toBe(holdsIn(left.shape, "b"));
      expect(caption(offered, "a")).toBe("The gate");
      // No question comes again in this session.
      await offered.edit("a", "The well");
      expect(offered.offer()).toBe("");
      expect(caption(offered, "a")).toBe("The well");
      const next = await reopen(open, browser, offered);
      expect(next.offer()).not.toBe("");
      await next.restore();
      expect(next.extras()).toBe(left.extras);
      expect(caption(next, "a")).toBe("The well");
    }
    it("survives the first edit and Restore, and the next open", async () => {
      // Expected to fail while it shows the gap (as `it.fails` would):
      // red once the gap is closed, and flipped then.
      const failed = await survivesRestore().then(
        () => null,
        (e: unknown) => e,
      );
      expect(failed instanceof Error, String(failed)).toBe(gap);
    }, 60_000);

    async function goneOnDelete(): Promise<void> {
      const { browser, offered, openedExtras } = await declinedThenEdited();
      await offered.discard();
      expect(offered.saidNotKept()).toBe(false);
      expect(offered.offer()).toBe("");
      expect(offered.extras()).toBe(openedExtras);
      expect(holds(offered, "b")).toBe(true);
      expect(caption(offered, "a")).toBe("The gate");
      // The next open offers the edit alone.
      const next = await reopen(open, browser, offered);
      expect(next.offer()).not.toBe("");
      await next.restore();
      expect(next.extras()).toBe(openedExtras);
      expect(holds(next, "b")).toBe(true);
      expect(caption(next, "a")).toBe("The gate");
    }
    it("is gone after the first edit and Delete it; the edit is kept", async () => {
      // Expected to fail while it shows the gap (as `it.fails` would):
      // red once the gap is closed, and flipped then.
      const failed = await goneOnDelete().then(
        () => null,
        (e: unknown) => e,
      );
      expect(failed instanceof Error, String(failed)).toBe(gap);
    }, 60_000);
  });

  // Why: the question's own "Not now" applies nothing: the waiting edit is
  // dropped, the draft stays undecided, and the next edit asks again.
  it("the question put off: the edit is dropped and the next edit asks again", async () => {
    const { browser, page, opened } = await freshPage(open);
    await page.edit("b", "The well");
    const offered = await reopen(open, browser, page);
    await offered.decline();
    await offered.edit("a", "The gate");
    expect(offered.offer()).not.toBe("");
    await offered.decline();
    expect(offered.offer()).toBe("");
    expect(offered.shape()).toEqual(opened);
    await offered.edit("a", "The gate");
    expect(offered.offer()).not.toBe("");
    expect(offered.shape()).toEqual(opened);
  }, 60_000);

  // Why: a station the draft renamed must survive a station moved while
  // the offer stands and then Restore: the move waits for the answer, so
  // Restore brings the whole draft back first, and the move lands on it.
  // The phone does not restore a station's own fields (`settingsGap`).
  async function renameKept(): Promise<void> {
    const { browser, page, opened } = await freshPage(open);
    await page.act(
      tourDocumentActions.stationEdited({
        stationId: "st-b",
        edit: { title: "The well" },
        what: "the station's title",
      }),
    );
    const renamed = page.extras();
    const offered = await reopen(open, browser, page);
    expect(offered.offer()).not.toBe("");
    await offered.moveStation("st-a", MOVED);
    expect(offered.shape()).toEqual(opened);
    await offered.restore();
    expect(offered.extras()).toBe(renamed);
    expect(offered.shape().stations).toContain(
      JSON.stringify({ id: "st-a", geo: MOVED }),
    );
    const next = await reopen(open, browser, offered);
    await next.restore();
    expect(next.extras()).toBe(renamed);
    expect(next.shape().stations).toContain(
      JSON.stringify({ id: "st-a", geo: MOVED }),
    );
  }
  it("while the offer stands, a station move and then Restore keep the draft's station rename", async () => {
    // Expected to fail while it shows the gap (as `it.fails` would):
    // red once the gap is closed, and flipped then.
    const failed = await renameKept().then(
      () => null,
      (e: unknown) => e,
    );
    expect(failed instanceof Error, String(failed)).toBe(
      settingsGap("a station rename"),
    );
  }, 60_000);
});

// --- the property -----------------------------------------------------------

type Answer = "restore" | "decline" | "discard";

type Op =
  | { readonly kind: "edit"; readonly id: "a" | "b"; readonly text: string }
  | { readonly kind: "remove"; readonly id: "a" | "b" }
  | { readonly kind: "undo" }
  | { readonly kind: "place"; readonly at: number }
  | { readonly kind: "moveStation"; readonly id: "st-a" | "st-b" }
  /** The tab closed and the tour opened again, its offer answered - or,
   *  `later`, left standing while the steps after it work on the page. */
  | { readonly kind: "reopen"; readonly answer: Answer | "later" }
  /** A standing offer answered (nothing, when none stands). */
  | { readonly kind: "answer"; readonly answer: Answer };

/** A fault set for one step: a refused write of one record family, the
 *  next meta write refused (a Restore and a "Delete it" write the meta),
 *  or the tab closing after that many more changes landed - then the tour
 *  is opened again at once. */
type Fault =
  | { readonly kind: "none" }
  | { readonly kind: "refuse"; readonly keys: RegExp }
  | { readonly kind: "meta" }
  | { readonly kind: "crash"; readonly after: number };

/** A step: an op, its fault, and the answer to the question the op asks
 *  when it is an edit made while the draft is undecided. */
type Step = readonly [Op, Fault, Answer];

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
  fc.record({ kind: fc.constant("place" as const), at: fc.nat(2) }),
  fc.record({
    kind: fc.constant("moveStation" as const),
    id: fc.constantFrom("st-a" as const, "st-b" as const),
  }),
  fc.record({
    kind: fc.constant("reopen" as const),
    answer: fc.constantFrom<Answer | "later">(
      "restore",
      "decline",
      "discard",
      "later",
    ),
  }),
  fc.record({
    kind: fc.constant("answer" as const),
    answer: fc.constantFrom<Answer>("restore", "decline", "discard"),
  }),
);

const OBJECT_KEYS = /^object:/;

const faultArb: fc.Arbitrary<Fault> = fc.oneof(
  { weight: 4, arbitrary: fc.constant({ kind: "none" as const }) },
  fc.constantFrom(
    { kind: "refuse" as const, keys: OBJECT_KEYS },
    { kind: "refuse" as const, keys: /^deleted:/ },
    { kind: "refuse" as const, keys: new RegExp(`^${SETTINGS_KEY}$`) },
  ),
  fc.constant({ kind: "meta" as const }),
  fc.record({ kind: fc.constant("crash" as const), after: fc.nat(4) }),
);

/** An edit and a station move write object records: a refusal of those
 *  is drawn more often for them. */
const answerArb = fc.constantFrom<Answer>("restore", "decline", "discard");

const stepArb: fc.Arbitrary<Step> = opArb.chain((op) =>
  fc.tuple(
    fc.constant(op),
    op.kind === "edit" || op.kind === "moveStation"
      ? fc.oneof(
          {
            weight: 1,
            arbitrary: fc.constant({
              kind: "refuse" as const,
              keys: OBJECT_KEYS,
            }),
          },
          { weight: 3, arbitrary: faultArb },
        )
      : faultArb,
    answerArb,
  ),
);

/** The ops and faults every run tries first: each turns red on a draft that
 *  stops writing an id after one of its writes was refused, that removes a
 *  deleted object's record before its tombstone, or that loses a meta
 *  written by a Restore or a "Delete it"; and the sequences that once
 *  found a gap: a declined station move (or a placement's new station)
 *  lost by a later write, a refused tombstone of a station's last object,
 *  an edit at a declined station, a crash inside a station move, a station
 *  moved while the offer stands and then Restore. */
const SEEDED_PAIRS: (readonly [Op, Fault])[][] = [
  [
    [
      { kind: "edit", id: "a", text: "The gate" },
      { kind: "refuse", keys: OBJECT_KEYS },
    ],
    [{ kind: "edit", id: "a", text: "The well" }, { kind: "none" }],
  ],
  [
    [{ kind: "edit", id: "b", text: "The gate" }, { kind: "none" }],
    [
      { kind: "remove", id: "b" },
      { kind: "crash", after: 1 },
    ],
  ],
  [
    [{ kind: "edit", id: "a", text: "The gate" }, { kind: "none" }],
    [{ kind: "reopen", answer: "discard" }, { kind: "meta" }],
    [{ kind: "reopen", answer: "restore" }, { kind: "meta" }],
  ],
  [
    [{ kind: "moveStation", id: "st-b" }, { kind: "none" }],
    [{ kind: "reopen", answer: "decline" }, { kind: "none" }],
    [{ kind: "moveStation", id: "st-a" }, { kind: "none" }],
  ],
  [
    [{ kind: "place", at: 0 }, { kind: "none" }],
    [{ kind: "reopen", answer: "decline" }, { kind: "none" }],
    [
      { kind: "moveStation", id: "st-a" },
      { kind: "refuse", keys: OBJECT_KEYS },
    ],
    [{ kind: "edit", id: "a", text: "The gate" }, { kind: "none" }],
  ],
  [
    [
      { kind: "moveStation", id: "st-a" },
      { kind: "refuse", keys: /^deleted:/ },
    ],
    [
      { kind: "remove", id: "a" },
      { kind: "refuse", keys: /^deleted:/ },
    ],
  ],
  [
    [{ kind: "moveStation", id: "st-a" }, { kind: "meta" }],
    [{ kind: "reopen", answer: "decline" }, { kind: "none" }],
    [{ kind: "edit", id: "a", text: "The gate" }, { kind: "meta" }],
  ],
  [
    [
      { kind: "moveStation", id: "st-a" },
      { kind: "crash", after: 1 },
    ],
  ],
  [
    [{ kind: "moveStation", id: "st-b" }, { kind: "none" }],
    [{ kind: "reopen", answer: "decline" }, { kind: "meta" }],
    [{ kind: "remove", id: "b" }, { kind: "none" }],
    [{ kind: "undo" }, { kind: "none" }],
  ],
  [
    [
      { kind: "remove", id: "b" },
      { kind: "crash", after: 1 },
    ],
    [{ kind: "reopen", answer: "decline" }, { kind: "none" }],
    [{ kind: "edit", id: "b", text: "The gate" }, { kind: "none" }],
    [{ kind: "moveStation", id: "st-a" }, { kind: "none" }],
  ],
  [
    [{ kind: "moveStation", id: "st-b" }, { kind: "none" }],
    [{ kind: "reopen", answer: "later" }, { kind: "none" }],
    [{ kind: "moveStation", id: "st-a" }, { kind: "none" }],
    [{ kind: "answer", answer: "restore" }, { kind: "none" }],
  ],
];

/** The sequences every run tries first: the ones above, each question an
 *  edit asks answered with Restore; an edit at a declined station
 *  answered with "Delete it"; a placement left offered, then a delete
 *  put off and an edit restored, both with a refused meta write. */
const SEEDED: Step[][] = [
  ...SEEDED_PAIRS.map((steps) =>
    steps.map(([op, fault]): Step => [op, fault, "restore"]),
  ),
  [
    [{ kind: "moveStation", id: "st-a" }, { kind: "none" }, "restore"],
    [{ kind: "reopen", answer: "decline" }, { kind: "none" }, "restore"],
    [{ kind: "edit", id: "a", text: "The gate" }, { kind: "none" }, "discard"],
  ],
  [
    [{ kind: "place", at: 0 }, { kind: "none" }, "restore"],
    [{ kind: "reopen", answer: "later" }, { kind: "none" }, "restore"],
    [{ kind: "remove", id: "a" }, { kind: "meta" }, "decline"],
    [{ kind: "edit", id: "b", text: "The well" }, { kind: "meta" }, "restore"],
  ],
];

async function apply(
  page: DraftPage,
  op: Exclude<Op, { kind: "reopen" | "answer" }>,
): Promise<void> {
  switch (op.kind) {
    case "edit":
      return page.edit(op.id, op.text);
    case "remove":
      return page.remove(op.id);
    case "undo":
      await page.undo();
      return;
    case "place":
      await page.place(op.at);
      return;
    case "moveStation":
      return page.moveStation(op.id, {
        ...MOVED,
        lat: op.id === "st-a" ? NORTH + 0.003 : NORTH + 0.004,
      });
  }
}

const round = (x: number): number => Math.round(x * 1e9) / 1e9;

/**
 * Each object of a document as compared, by id: its station id left out (a
 * station minted again keeps its place, not its id), and its place as its
 * offset from its own station's pose in the same document, so an object
 * that followed its station compares equal to where it stood in it. With
 * `absolute`, its place as it stands, whatever its station.
 */
function objectsById(
  shape: DocumentShape,
  absolute = false,
): Map<string, string> {
  const poses = new Map(
    shape.stations.map((s) => {
      const { id, geo } = JSON.parse(s) as { id: string; geo: QrGeoPose };
      return [id, geo] as const;
    }),
  );
  const out = new Map<string, string>();
  for (const content of shape.objects) {
    const { station, geo, ...rest } = JSON.parse(content) as {
      id: string;
      station?: string;
      geo?: { lat: number; lon: number; alt?: number };
    };
    const at = station === undefined ? undefined : poses.get(station);
    const place =
      absolute || geo === undefined || at === undefined
        ? { geo }
        : {
            offset: {
              ...geo,
              lat: round(geo.lat - at.lat),
              lon: round(geo.lon - at.lon),
              alt: round((geo.alt ?? 0) - at.alt),
            },
          };
    out.set(rest.id, JSON.stringify({ ...rest, ...place }));
  }
  return out;
}

/** The opened tour's stations (`OPENED`, one per pin). */
const FILE_STATIONS = new Set(["st-a", "st-b"]);

/** Each station by key: a station of the opened tour by its id, one a
 *  placement made by its pose (a restore mints such a station again: the
 *  same place, a new id). */
function stationsByKey(shape: DocumentShape): Map<string, string> {
  return new Map(
    shape.stations.map((s) => {
      const { id, geo } = JSON.parse(s) as { id: string; geo: QrGeoPose };
      return FILE_STATIONS.has(id)
        ? ([`station:${id}`, s] as const)
        : ([`station@${JSON.stringify(geo)}`, JSON.stringify(geo)] as const);
    }),
  );
}

/**
 * Everything the draft must bring back, by key: `object:<id>` for each
 * object (as `objectsById` compares it) and each station's pose (as
 * `stationsByKey` keys it).
 */
function entriesOf(
  shape: DocumentShape,
  absolute = false,
): Map<string, string> {
  return new Map([
    ...[...objectsById(shape, absolute)].map(
      ([id, c]) => [`object:${id}`, c] as const,
    ),
    ...stationsByKey(shape),
  ]);
}

/** A station shows only while an object stands at it, so its key coming
 *  or going is not a change of its own: only its pose is. */
const isStation = (key: string): boolean => key.startsWith("station");

/**
 * What the draft must bring back, as the run goes, by `entriesOf` key. A
 * key is TAINTED while its last change came in a step that lost a write (a
 * refused one): what comes back for it is then not pinned, but the page
 * must have said a write did not land. A later change of it in a step that
 * lost none writes it whole again and untaints it.
 */
interface Expected {
  entries: Map<string, string>;
  tainted: Set<string>;
}

const expectedOf = (shape: DocumentShape): Expected => ({
  entries: entriesOf(shape),
  tainted: new Set(),
});

/** The key of the station `key`'s object stands at in `shape`, if any. */
function stationKeyOf(shape: DocumentShape, key: string): string | undefined {
  const object = shape.objects
    .map((o) => JSON.parse(o) as { id: string; station?: string })
    .find((o) => `object:${o.id}` === key);
  const station = shape.stations.find(
    (st) => (JSON.parse(st) as { id: string }).id === object?.station,
  );
  if (station === undefined) return undefined;
  const [stationKey] = stationsByKey({ ...shape, stations: [station] }).keys();
  return stationKey;
}

/** A step on the live page: what changed is now what the draft must hold,
 *  tainted when the step lost a write. An object changed when its record
 *  did: an object that followed its moved station was written again, so
 *  it counts as changed although its offset is not. A station that
 *  stopped showing keeps the pose the draft holds for it - unless the
 *  step lost a write: a refused tombstone of its last object brings the
 *  object back with its station, at a pose the record no longer holds (the
 *  removal took it off the record). The page said the write was refused,
 *  so that is a said loss, not a draft defect: the station is tainted. */
function follow(
  expected: Expected,
  before: DocumentShape,
  after: DocumentShape,
  lostWrite: boolean,
): void {
  const was = entriesOf(before, true);
  const stands = entriesOf(after, true);
  const now = entriesOf(after);
  // The stations first: a station moved in this step is decided before
  // its objects are read against it.
  const keys = [...new Set([...was.keys(), ...stands.keys()])].sort(
    (x, y) => Number(isStation(y)) - Number(isStation(x)),
  );
  for (const key of keys) {
    if (stands.get(key) === was.get(key)) continue;
    const content = now.get(key);
    if (content === undefined && isStation(key)) {
      if (lostWrite) expected.tainted.add(key);
      continue;
    }
    // A station showing again (an object back at it) is no change of its
    // own either: it keeps the pose the draft holds for it.
    if (isStation(key) && !was.has(key) && expected.entries.has(key)) continue;
    if (content === undefined) expected.entries.delete(key);
    else expected.entries.set(key, content);
    if (lostWrite) expected.tainted.add(key);
    else expected.tainted.delete(key);
  }
  // A station the draft holds no pose for that shows now (its object
  // written again after the draft lost it) is held where it shows.
  for (const [key, content] of now) {
    if (isStation(key) && !expected.entries.has(key)) {
      expected.entries.set(key, content);
    }
  }
}

/** The keys to compare in a reopened document: every key either side
 *  holds, but a station only while it shows. */
function comparedKeys(
  sides: readonly Map<string, string>[],
  got: Map<string, string>,
): string[] {
  const keys = new Set(sides.flatMap((side) => [...side.keys()]));
  return [...keys, ...got.keys()].filter(
    (key, i, all) =>
      all.indexOf(key) === i && (!isStation(key) || got.has(key)),
  );
}

/** Whether `key` is not pinned in `shape`: tainted, or an object whose
 *  place is read from a tainted station (a refused settings write leaves
 *  the station's pose behind, so the object's offset from it is not
 *  pinned either; where it stands still is). */
function unpinned(
  expected: Expected,
  shape: DocumentShape,
  key: string,
): boolean {
  if (expected.tainted.has(key)) return true;
  if (isStation(key)) return false;
  const stationKey = stationKeyOf(shape, key);
  return stationKey !== undefined && expected.tainted.has(stationKey);
}

/** A reopened page holds exactly what the draft must hold, for every key
 *  not tainted; a taint the page must have said. */
function holdsExpected(
  expected: Expected,
  shape: DocumentShape,
  said: boolean,
  where: string,
): void {
  const got = entriesOf(shape);
  for (const key of comparedKeys([expected.entries], got)) {
    if (unpinned(expected, shape, key)) continue;
    expect(got.get(key), `${where}: ${key}`).toBe(expected.entries.get(key));
  }
  expect(
    said || expected.tainted.size === 0,
    `${where}: a write did not land and the page did not say so`,
  ).toBe(true);
}

/** An entry without the object's place: what a crash check compares. */
function withoutPlace(
  key: string,
  content: string | undefined,
): string | undefined {
  if (content === undefined || isStation(key)) return content;
  const {
    offset: _o,
    geo: _g,
    ...rest
  } = JSON.parse(content) as Record<string, unknown>;
  return JSON.stringify(rest);
}

/** After a crash in a step, each key comes back as it was before the step
 *  or as the step left it, never as anything else: a change cut short is
 *  never half applied, and an older version never outranks a newer one (a
 *  deleted object's file text after its edit). An object's place is not
 *  compared here: a crash between a station move's records can leave an
 *  object where it stood while its station moved (the known gap pinned
 *  below by "known gap: a crash inside a station move keeps each object
 *  at its station"); the never-held check still holds its place to one it
 *  had. This narrowing applies to crash runs only, and is removed when
 *  that row turns green. */
function beforeOrAfter(
  expected: Expected,
  stepAfter: DocumentShape,
  shape: DocumentShape,
): void {
  const got = entriesOf(shape);
  const after = entriesOf(stepAfter);
  for (const key of comparedKeys([expected.entries, after], got)) {
    if (expected.tainted.has(key)) continue;
    expect(
      [
        withoutPlace(key, expected.entries.get(key)),
        withoutPlace(key, after.get(key)),
      ],
      `after a crash: ${key}`,
    ).toContain(withoutPlace(key, got.get(key)));
  }
}

/** Sequences and their faults per page; `DRAFT_PROPERTY_RUNS` raises it
 *  for a sweep. */
const RUNS = Number(process.env["DRAFT_PROPERTY_RUNS"] ?? 25);

/** One run of the property on one page. */
async function runSteps(open: OpenPage, steps: readonly Step[]): Promise<void> {
  const { browser, page: first, opened } = await freshPage(open);
  let page = first;
  let said = false;
  let expected = expectedOf(opened);
  // A crash in a station move can leave a mix the creator never saw (the
  // known gap "a crash inside a station move keeps each object at its
  // station"): in a run with a crash, the last open is held to places as
  // they stood only. Removed when that row turns green.
  let crashed = false;
  // Every version of an object the creator saw: relative to its station,
  // and as it stood (what a crash is held to, see `beforeOrAfter`).
  const held = new Set<string>();
  const heldAsItStood = new Set<string>();
  const saw = (shape: DocumentShape) => {
    for (const content of objectsById(shape).values()) held.add(content);
    for (const content of objectsById(shape, true).values())
      heldAsItStood.add(content);
  };
  // Every object not tainted was seen as it stands, and relative to its
  // station too (a crash is held to the first only, see `beforeOrAfter`).
  // A tainted one is not: a refused write may leave its record behind its
  // moved station, or its old text at the new place, and the page said so.
  const neverUnseen = (
    shape: DocumentShape,
    where: string,
    relative: boolean,
  ) => {
    for (const [id, content] of objectsById(shape, true)) {
      if (expected.tainted.has(`object:${id}`)) continue;
      expect(heldAsItStood, `${where}: a place never held`).toContain(content);
    }
    for (const [id, content] of objectsById(shape)) {
      if (!relative || unpinned(expected, shape, `object:${id}`)) continue;
      expect(held, `${where}: a version never held`).toContain(content);
    }
  };
  saw(opened);
  /** The tab closed: the next load over the same browser. */
  const next = async (): Promise<DraftPage> => {
    said ||= page.saidNotKept();
    page = await reopen(open, browser, page);
    return page;
  };
  /** One answer to the offer, or one step on the live page, with its
   *  fault. */
  const take = async (
    op: Exclude<Op, { kind: "reopen" | "answer" }> | null,
    answer: Answer | null,
    fault: Fault,
  ): Promise<void> => {
    const before = page.shape();
    const refusedBefore = browser.refused.length;
    browser.failPutsOf = fault.kind === "refuse" ? fault.keys : null;
    browser.failMetaPuts = fault.kind === "meta" ? 1 : 0;
    browser.crashAfter = fault.kind === "crash" ? fault.after : null;
    if (answer !== null) await page[answer]();
    else if (op !== null) await apply(page, op);
    browser.failPutsOf = null;
    browser.failMetaPuts = 0;
    const lostWrite = browser.refused.length > refusedBefore;
    const after = page.shape();
    saw(after);
    if (fault.kind === "crash") {
      // The tab closed midway: whatever landed is what the next load
      // finds, and its Restore brings it back.
      const loaded = await next();
      if (loaded.offer() !== "") await loaded.restore();
      const restored = loaded.shape();
      beforeOrAfter(expected, after, restored);
      neverUnseen(restored, "after a crash", false);
      crashed = true;
      // What came back is what the draft now holds; a record a refused
      // write left behind stays as it is until it is written again.
      expected = { ...expected, entries: entriesOf(restored) };
      return;
    }
    if (answer === null) {
      follow(expected, before, after, lostWrite);
      return;
    }
    said ||= page.saidNotKept();
    if (answer === "restore") {
      holdsExpected(expected, after, said, "a Restore");
      // A refused meta leaves the work as it was to be offered again.
      expected = {
        entries: entriesOf(after),
        tainted: lostWrite ? expected.tainted : new Set(),
      };
    }
    // A "Delete it" that landed decides the draft and leaves the file; one
    // that did not is said, and the work stays to be offered again. "Not
    // now" keeps it.
    if (answer === "discard" && !page.undecided()) {
      expected = expectedOf(after);
    }
  };
  for (const [op, fault, asked] of steps) {
    // A reopen's own load comes first; the fault is set for its answer.
    if (op.kind === "reopen") {
      const loaded = await next();
      if (loaded.offer() === "") {
        holdsExpected(
          expected,
          loaded.shape(),
          said,
          "an open that offered nothing",
        );
        continue;
      }
      if (op.answer === "later") continue;
      await take(null, op.answer, fault);
      continue;
    }
    if (op.kind === "answer") {
      if (page.offer() !== "") await take(null, op.answer, fault);
      continue;
    }
    if (!page.undecided()) {
      await take(op, null, fault);
      continue;
    }
    // An edit while the draft is undecided waits for the answer: nothing
    // of it is applied before, and the page asks (shows the offer).
    const before = page.shape();
    await apply(page, op);
    expect(page.shape(), "an edit applied before the answer").toEqual(before);
    // Nothing waits: the op took no step (an undo with nothing to undo).
    if (page.offer() === "") continue;
    // The question's "Not now" drops the waiting edit; Restore and
    // "Delete it" let it through after their own change. The property
    // takes those as the answer, then the same edit again, so each half
    // is held to its own rule (the order a waiting edit is let through
    // in is the gate's, `draft-edit-gate.test.ts`, and the rows above).
    await page.decline();
    expect(page.shape(), "an edit applied after Not now").toEqual(before);
    if (asked === "decline") continue;
    await take(null, asked, fault);
    if (!page.undecided()) await take(op, null, { kind: "none" });
  }
  const last = await next();
  if (last.offer() !== "") await last.restore();
  const restored = last.shape();
  holdsExpected(expected, restored, said, "the last open");
  neverUnseen(restored, "the last open", !crashed);
}

describe.each(PAGES)("the %s page's draft, a property", (_name, open) => {
  it("for random steps with faults and crashes, every reopen brings back what the draft must hold", async () => {
    // Why this test matters: the rows pin each behaviour alone; the
    // composed sequences (an edit after a refused write of the same
    // object, a delete cut short by a crash, a Restore or "Delete it"
    // whose meta write is refused, a reopen in the middle) are where two
    // drafts' rules drift. What must hold on both pages: every reopen
    // brings back, per object and for the stations, exactly what the last
    // change of it left - unless a write of that change was refused, which
    // the page must then have said; a crash leaves each as it was before
    // the step or after it; and nothing comes back the creator never saw.
    expect.hasAssertions();
    await fc.assert(
      fc.asyncProperty(
        fc.array(stepArb, { minLength: 1, maxLength: 6 }),
        (steps) => runSteps(open, steps),
      ),
      { numRuns: RUNS, examples: SEEDED.map((steps) => [steps]) },
    );
  }, 600_000);

  // Why: "Not now" keeps the work for the next open, a moved station
  // among it, and is for looking only: another station's move made then
  // waits for the answer, asked again. Restore brings the declined move
  // back first and the new one lands beside it, both kept by the next
  // open - never the file's pose written over the declined one, which
  // would bring its object back off its station.
  it("after Not now, another station's move waits for Restore and keeps the declined move", async () => {
    const { browser, page, opened } = await freshPage(open);
    await page.moveStation("st-b", { ...MOVED, lat: NORTH + 0.004 });
    const moved = page.shape();
    const offered = await reopen(open, browser, page);
    await offered.decline();
    await offered.moveStation("st-a", { ...MOVED, lat: NORTH + 0.003 });
    expect(offered.shape()).toEqual(opened);
    expect(offered.offer()).not.toBe("");
    await offered.restore();
    const both = offered.shape();
    expect(objectsById(both).get("b")).toBe(objectsById(moved).get("b"));
    expect(stationsByKey(both).get("station:st-a")).toBe(
      JSON.stringify({ id: "st-a", geo: { ...MOVED, lat: NORTH + 0.003 } }),
    );
    const next = await reopen(open, browser, offered);
    await next.restore();
    expect(entriesOf(next.shape())).toEqual(entriesOf(both));
  }, 60_000);

  // Why: a placement may start a station of its own, which the settings
  // record holds whole while its object's record names it. After "Not
  // now" a station move waits for the answer; Restore brings that station
  // back first, so the next open still finds the placement's station and
  // never drops the object that names it.
  it("after Not now, a station move waits for Restore and keeps the station a placement started", async () => {
    const { browser, page } = await freshPage(open);
    await page.place(0);
    const placed = page.shape();
    const offered = await reopen(open, browser, page);
    await offered.decline();
    await offered.moveStation("st-a", { ...MOVED, lat: NORTH + 0.003 });
    expect(offered.offer()).not.toBe("");
    await offered.restore();
    const next = await reopen(open, browser, offered);
    await next.restore();
    const added = [...objectsById(placed).keys()].filter(
      (id) => id !== "a" && id !== "b",
    );
    expect(added).toHaveLength(1);
    expect(objectsById(next.shape()).get(added[0]!)).toBe(
      objectsById(placed).get(added[0]!),
    );
  }, 60_000);

  // Why: the offer stands until it is answered, and the creator may move
  // a station meanwhile. The move waits for the answer: Restore puts back
  // every offered pose first, and the move lands on top - the moved
  // station where the creator put it, every other the draft's, its
  // objects at their offsets from it.
  it("while the offer stands, a station move and then Restore keep the other station's offered move", async () => {
    const { browser, page, opened } = await freshPage(open);
    await page.moveStation("st-b", { ...MOVED, lat: NORTH + 0.004 });
    const moved = page.shape();
    const offered = await reopen(open, browser, page);
    expect(offered.offer()).not.toBe("");
    await offered.moveStation("st-a", { ...MOVED, lat: NORTH + 0.003 });
    expect(offered.shape()).toEqual(opened);
    await offered.restore();
    const shape = offered.shape();
    expect(stationsByKey(shape).get("station:st-b")).toBe(
      stationsByKey(moved).get("station:st-b"),
    );
    expect(objectsById(shape).get("b")).toBe(objectsById(moved).get("b"));
    expect(stationsByKey(shape).get("station:st-a")).toBe(
      JSON.stringify({ id: "st-a", geo: { ...MOVED, lat: NORTH + 0.003 } }),
    );
  }, 60_000);

  // Why: after "Not now" a moved station is undecided, and an edit of an
  // object at it waits for the answer instead of being written where the
  // page shows it (at the file's pose of its station). Restore brings the
  // moved station back first and the edit lands at it, so the object
  // keeps its offset from its station across the next open.
  it("after Not now, an edit of a moved station's object waits for Restore and keeps it at its station", async () => {
    const { browser, page } = await freshPage(open);
    await page.moveStation("st-a", { ...MOVED, lat: NORTH + 0.003 });
    const offered = await reopen(open, browser, page);
    await offered.decline();
    await offered.edit("a", "The gate");
    expect(offered.offer()).not.toBe("");
    await offered.restore();
    const next = await reopen(open, browser, offered);
    await next.restore();
    const shape = next.shape();
    expect(entriesOf(shape).get("object:a")).toBe(
      entriesOf(offered.shape()).get("object:a"),
    );
    expect(entriesOf(shape).get("object:a")).toContain('"The gate"');
  }, 60_000);

  // Why: a station move writes its objects' records and the settings
  // record one by one, so a tab closed between them brings an object back
  // where it stood while its station moved: a mix the creator never saw
  // (both pages, a crash after the first landed change). A known gap,
  // pinned so it is not forgotten: this turns red (an unexpected pass)
  // once a move's records land together, and then the crash check above
  // can compare places too.
  it.fails(
    "known gap: a crash inside a station move keeps each object at its station",
    async () => {
      const { browser, page, opened } = await freshPage(open);
      browser.crashAfter = 1;
      await page.moveStation("st-b", { ...MOVED, lat: NORTH + 0.004 });
      const after = page.shape();
      const next = await reopen(open, browser, page);
      if (next.offer() !== "") await next.restore();
      const places = (shape: DocumentShape) =>
        JSON.stringify([...objectsById(shape)]);
      expect([places(opened), places(after)]).toContain(places(next.shape()));
    },
    60_000,
  );
});
