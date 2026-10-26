/**
 * The parity contract (tour editor plan 2026-10-17-1816, D30, D31): the
 * same operations, driven through the phone's page (`wireCreatorSetup`,
 * the creator's object list, draft and Finish) and through the desktop
 * editor's (`createEditorSession` with `createEditorDraft`), must write
 * the same tour file and leave the same draft records.
 *
 * Why this test matters: the two pages kept two working copies of one
 * tour that meant different things (the state audit
 * 2026-10-18-1126-tour-viewer-shared-state-foundation-audit.md), and two
 * real bugs came from that split in one review (plan §19 #1, #2). Every
 * row here is one operation sequence; a row the two pages disagree on is
 * marked `it.fails` and names the step that removes the divergence. When
 * that step lands the marked row turns red, and the marker comes off:
 * the assertion itself is never weakened. Kept in the gate for good (D31).
 *
 * What is compared:
 * - the manifest the save wrote (`tour.json` as serialized), and
 * - the draft's records as a later open reads them (`readDraft`): each
 *   object's content and each deletion's id - not the meta (the phone's
 *   printed size) nor the codes record, which are the phone's alone. A
 *   tour's level files are compared on their own (a save keeps them byte
 *   for byte).
 *
 * What is NOT driven here, on purpose: the phone's AR geometry (where a
 * reticle tap lands, a code's re-measure). Its placement, move and
 * station move run only in an AR session, which `authoring-settle.test.ts`
 * drives with a stood-in device. For those rows the phone side applies
 * the result its AR path leaves in the page's lists (named per row), and
 * the row compares what the document makes of it from there on.
 */
import { isDeepStrictEqual } from "node:util";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
  type TourObject,
  type TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  packFilesAsZip,
  type DraftFileStore,
} from "gps-plus-slam-app-framework/storage";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";

import { objectContentKey } from "./authoring-draft.js";
import { wireCreatorSetup, type CreatorSetupDom } from "./creator-setup.js";
import { readDraft } from "./draft-persistence.js";
import { createEditorDraft } from "./editor/editor-draft.js";
import {
  createEditorSession,
  type EditorSession,
} from "./editor/editor-session.js";
import type { EditorLock } from "./editor/save-target.js";
import type { ObjectListHandlers } from "./object-list.js";
import {
  openTourFile,
  tourFileKeyOfFile,
  type TourSession,
} from "./tour-session.js";
import {
  createTourViewerSession,
  createTourViewerStore,
} from "./tour-viewer-session.js";
import { documentObjects, selectTourDocument } from "./tour-document.js";
import { tourOf } from "./test-support/v3-tour.js";

beforeAll(() => {
  createTourViewerStore();
});

// --- the tour both pages open ----------------------------------------------

function pin(id: string, label = `pin ${id}`, lat = 48.52): TourObject {
  return {
    id,
    kind: "pin",
    label,
    createdAtIso: "2026-10-18T00:00:00.000Z",
    geo: { lat, lon: 9.05, alt: 340, headingDeg: 0 },
  };
}

function photo(id: string): TourObject {
  return {
    id,
    kind: "photo",
    image: `content/${id}.jpg`,
    imageWidth: 4,
    imageHeight: 3,
    createdAtIso: "2026-10-18T00:00:00.000Z",
    geo: { lat: 48.5201, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
  };
}

/** Two pins and a photo, each in a station of its own (`tourOf`). */
const OPENED = [pin("a"), pin("b", "pin b", 48.5202), photo("f")];

async function tourFile(): Promise<File> {
  const manifest = tourOf(OPENED);
  const zip = await packFilesAsZip([
    { path: "tour.json", data: serializeTourManifest(manifest) },
    { path: "content/f.jpg", data: "f" },
  ]);
  return new File([zip], "tour.zip", { type: "application/zip" });
}

/** A level file's text for a code standing at `geo`. */
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

/** One browser's draft namespaces, in memory: both pages' stores. */
function memoryStores(): (key: string) => Promise<DraftFileStore> {
  const spaces = new Map<string, Map<string, Blob | string>>();
  return (key) => {
    const files = spaces.get(key) ?? new Map<string, Blob | string>();
    spaces.set(key, files);
    return Promise.resolve({
      put: (k, data) => {
        files.set(k, data as Blob | string);
        return Promise.resolve(true);
      },
      remove: (k) => {
        files.delete(k);
        return Promise.resolve();
      },
      getText: async (k) => {
        const v = files.get(k);
        return v === undefined
          ? undefined
          : typeof v === "string"
            ? v
            : v.text();
      },
      getBlob: (k) => {
        const v = files.get(k);
        return Promise.resolve(
          v === undefined
            ? undefined
            : typeof v === "string"
              ? new Blob([v])
              : v,
        );
      },
      keys: () => Promise.resolve([...files.keys()]),
      clear: () => {
        files.clear();
        return Promise.resolve();
      },
    });
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 40; i += 1) await new Promise((r) => setTimeout(r, 0));
}

// --- the operations ---------------------------------------------------------

interface DetailsChange {
  readonly name?: string;
  readonly description?: string;
  readonly contact?: string;
}

/** One page, driven through its own code path. */
interface Page {
  edit(id: string, text: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Take back the last delete (the phone's Undo, the desktop's undo). */
  undoDelete(): Promise<void>;
  /** A new pin where `object` says (the phone: as its AR placement leaves
   *  the page's lists). */
  place(object: TourObject): Promise<void>;
  /** A new pin that starts its own station even within the automatic
   *  radius of another (owner decision D8 of the editor round-2 plan; the
   *  phone: its "New station here" chip, then a placement). */
  placeOwnStation(object: TourObject): Promise<void>;
  /** A note to `lat`/`lon`, height and facing kept (the phone: as its AR
   *  move leaves the page's lists). */
  move(id: string, lat: number, lon: number): Promise<void>;
  /** A station moved rigidly to `geo`, its items with it (D17), by a code
   *  (the phone: as its settle moves it once the station's code was
   *  re-measured, the code's new text in the same step; the desktop
   *  measures no code and moves the station alone). */
  moveStation(stationId: string, geo: QrGeoPose): Promise<void>;
  /** Take back the document's last step (the desktop's undo; the phone:
   *  the document's undo, which its Undo button runs - offered there only
   *  after a delete today). */
  undo(): Promise<void>;
  setNeedsNoGps(on: boolean): Promise<void>;
  setDetails(change: DetailsChange): Promise<void>;
  /** Save (the desktop) or Finish (the phone): the manifest written. */
  save(): Promise<TourManifest>;
  /** The draft as a later open reads it: object contents and deletions. */
  records(): Promise<{ objects: string[]; deleted: string[] }>;
  /** A new page load over the same file and the same draft, restoring
   *  what the draft offers. */
  reopenRestored(): Promise<Page>;
  /** The stations the page holds now that the opened tour lacks: id and
   *  position, sorted by id. */
  addedStations(): AddedStation[];
  /** The 3D editor's station edits, through the editor session (a
   *  station's details, added, deleted, reordered or copied; an item
   *  copied, grounded or moved into a station of its own): the desktop's
   *  alone - the phone edits stations only by placing in AR. */
  editStations(edit: (editor: EditorSession) => unknown): Promise<void>;
}

/** The desktop page, with its download (the save path's other half). */
interface DesktopPage extends Page {
  /** Save as a download that arrived: the file it made and its tour. */
  download(): Promise<{ file: File; written: TourManifest }>;
  /** The tour as the page shows it. */
  objects(): TourObject[];
}

interface AddedStation {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
}

/** `stations` minus the opened tour's, as `addedStations` reports them. */
function addedOf(stations: readonly AddedStation[]): AddedStation[] {
  const opened = new Set(tourOf(OPENED).stations.map((s) => s.id));
  return stations
    .filter((s) => !opened.has(s.id))
    .map(({ id, lat, lon }) => ({ id, lat, lon }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** The phone's Finish found nothing to save: it would not start. */
const PHONE_FINISH_REFUSED = "the phone's Finish did not start";

/** No such operation on this page today: the row cannot be driven. */
class NoSuchOperation extends Error {}

async function readRecords(
  store: DraftFileStore,
  photoBytesRequired: boolean,
): Promise<{ objects: string[]; deleted: string[] }> {
  const stored = await readDraft(store, { photoBytesRequired });
  return {
    objects: (stored?.draft.objects ?? []).map(objectContentKey).sort(),
    deleted: [...(stored?.draft.deleted ?? [])].sort(),
  };
}

// --- the desktop editor -----------------------------------------------------

function freeLock(): Promise<EditorLock> {
  return Promise.resolve({
    granted: true,
    release: () => undefined,
    released: Promise.resolve(),
  });
}

async function desktopPage(
  file: File,
  stores: (key: string) => Promise<DraftFileStore>,
  restore = false,
  /** The tour.json the page opens (default: the table's tour). */
  manifest: TourManifest = tourOf(OPENED),
): Promise<DesktopPage> {
  const session: TourSession = await openTourFile(file);
  const draft = createEditorDraft({
    openStore: stores,
    holdLock: freeLock,
    noBackup: () => undefined,
  });
  const opened = await draft.open(session.archive.url, manifest);
  const store = createTourViewerStore();
  const editor = createEditorSession({
    session,
    manifest,
    levels: new Map(),
    draft: draft.writes(),
    store,
  });
  if (restore) {
    // The offer's Restore, as `edit-main.ts`'s toast runs it.
    if (opened.offer === null) throw new Error("the desktop offered nothing");
    editor.restore(opened.offer);
    draft.restored();
    await draft.idle();
  }
  const key = `editor:${session.archive.url}`;
  return {
    edit: (id, text) => {
      editor.editText(id, text);
      return draft.idle();
    },
    remove: (id) => {
      editor.remove(id);
      return draft.idle();
    },
    undoDelete: () => {
      editor.undo();
      return draft.idle();
    },
    place: (object) => {
      editor.place(object);
      return draft.idle();
    },
    placeOwnStation: () =>
      Promise.reject(
        new NoSuchOperation(
          "desktop: a new station for a placement (D8's desktop half)",
        ),
      ),
    move: (id, lat, lon) => {
      editor.move(id, lat, lon);
      return draft.idle();
    },
    moveStation: (stationId, geo) => {
      editor.moveStation(stationId, geo);
      return draft.idle();
    },
    undo: () => {
      editor.undo();
      return draft.idle();
    },
    setNeedsNoGps: (on) => {
      editor.setNeedsNoGps(on);
      return draft.idle();
    },
    setDetails: (change) => {
      const now = editor.details();
      editor.setDetails({
        name: change.name ?? now.name,
        description: change.description ?? now.description,
        cover: now.cover,
        contact: change.contact ?? now.contact,
      });
      return draft.idle();
    },
    save: async () => (await editor.save({ keepScan: false })).written,
    download: async () => {
      // As `edit-main.ts`'s save path runs a download that arrived: the
      // build noted, and the draft moved to the saved file's key.
      const made = await editor.save({ keepScan: false });
      draft.writes().built(made.written);
      const saved = new File([made.blob], made.filename, {
        type: "application/zip",
      });
      draft.writes().moved(await tourFileKeyOfFile(saved));
      await draft.idle();
      return { file: saved, written: made.written };
    },
    editStations: async (edit) => {
      await edit(editor);
      await draft.idle();
    },
    records: async () => readRecords(await stores(key), false),
    objects: () =>
      documentObjects(selectTourDocument(store.getState())).map(
        (o) => o.object,
      ),
    reopenRestored: () => desktopPage(file, stores, true),
    addedStations: () =>
      addedOf(
        editor
          .model()
          .items.filter((item) => item.kind === "station")
          .map((item) => ({
            id: item.id.slice("station:".length),
            lat: item.at?.lat ?? Number.NaN,
            lon: item.at?.lng ?? Number.NaN,
          })),
      ),
  };
}

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
    /** The object list's view: what the setup binds. */
    listHandlers: null as ObjectListHandlers | null,
    bind(bound: ObjectListHandlers) {
      this.listHandlers = bound;
    },
    render: () => undefined,
  };
}

/** What only the phone's page offers here: the file its last Finish
 *  made, the objects its document holds, the draft offer's words (empty
 *  while it offers nothing) and the key its draft is kept under. */
interface PhonePage extends Page {
  lastFinished(): File;
  objects(): TourObject[];
  offer(): string;
  draftKey(): string | null;
  /** The placement line, where the page says it keeps no backup. */
  placementNote(): string | null;
}

async function phonePage(
  file: File,
  stores: (key: string) => Promise<DraftFileStore | undefined>,
  restore = false,
  /** The tour.json the page opens (default: the table's tour). */
  manifest: TourManifest = tourOf(OPENED),
): Promise<PhonePage> {
  const session: TourSession = await openTourFile(file);
  const dom = Object.fromEntries(
    PHONE_DOM_KEYS.map((k) => [k, phoneElement()]),
  ) as Record<(typeof PHONE_DOM_KEYS)[number], ReturnType<typeof phoneElement>>;
  // One store for the page, as `main.ts` wires it: the session's tour
  // document is the store's `tourDocument` slice.
  const store = createTourViewerStore();
  const ctx = createTourViewerSession(store);
  ctx.session = session;
  ctx.tourManifestStatus = "settled";
  ctx.tourDocument.open(manifest);
  // The zip's level files, as `archive-open.ts` installs them for the open.
  ctx.currentLevels = await session.loadQrLevels();
  ctx.currentLevelTexts = session.levelTexts();
  let draftKey: string | null = null;
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
    openDraftStore: (key) => {
      draftKey = key;
      return stores(key);
    },
  });
  setup.presentDraftForTour(session.archive.url);
  await flush();
  if (restore) {
    await vi.waitFor(() => {
      expect(dom.draftOfferText.textContent).not.toBe("");
    });
    dom.draftRestore.click();
    await flush();
  }
  const list = (): ObjectListHandlers => {
    const bound = dom.objectList.listHandlers;
    if (bound === null) throw new Error("the object list was not bound");
    return bound;
  };
  /** The tour as the phone's object list shows it (`object-editing.ts`). */
  const objects = (): TourObject[] =>
    ctx.tourDocument.objects().map((o) => o.object);
  return {
    edit: async (id, text) => {
      list().editText(id, text);
      await flush();
    },
    remove: async (id) => {
      list().remove(id);
      await flush();
    },
    undoDelete: async () => {
      list().undo();
      await flush();
    },
    place: async (object) => {
      // As `creator-placement.ts` places after a tap in AR.
      ctx.tourDocument.place(object, {}, "a pin");
      await flush();
    },
    placeOwnStation: async (object) => {
      // As `creator-placement.ts` places after "New station here" and a
      // tap in AR: the placement takes the arm and asks for the station.
      ctx.tourDocument.armNewStation(true);
      ctx.tourDocument.armNewStation(false);
      ctx.tourDocument.place(object, { ownStation: true }, "a pin");
      await flush();
    },
    move: async (id, lat, lon) => {
      // As `object-editing.ts`'s move changes the document (its AR
      // geometry decides the geo; here the same spot the desktop is given).
      const found = objects().find((o) => o.id === id);
      if (found === undefined) return;
      ctx.tourDocument.move(
        { ...found, geo: { ...found.geo, lat, lon } },
        "a note",
      );
      await flush();
    },
    moveStation: async (stationId, geo) => {
      // As `creator-settle.ts`'s settle moves it once its code was
      // re-measured in AR (`moveStationsAlong`; the geo is what the AR path
      // computed): the move staged in the settle's batch, then the batch
      // and the code's re-minted text applied as one step of the document.
      const batch = ctx.tourDocument.settleBatch();
      batch.moveStation(stationId, geo);
      setup.codes.applySettle(
        batch,
        [{ id: `code-${stationId}`, json: levelAt(geo) }],
        "the settle of this visit",
      );
      await flush();
    },
    undo: async () => {
      ctx.tourDocument.undo();
      await flush();
    },
    setNeedsNoGps: () =>
      Promise.reject(new NoSuchOperation("phone: the needs-no-GPS setting")),
    editStations: () =>
      Promise.reject(
        new NoSuchOperation("phone: the 3D editor's station edits"),
      ),
    setDetails: (change) => {
      if (change.description !== undefined || change.contact !== undefined) {
        return Promise.reject(
          new NoSuchOperation("phone: a description or a contact"),
        );
      }
      // As step 3's name field hands it over (`main.ts`, on "change"); a
      // refusal is said beside the field and changes nothing, as on the
      // desktop.
      if (change.name !== undefined) setup.renameTour(change.name);
      return flush();
    },
    save: async () => {
      const started = setup.finishNow();
      if (!started) throw new Error(PHONE_FINISH_REFUSED);
      await vi.waitFor(
        () => {
          expect(ctx.finishing).toBe(false);
        },
        { timeout: 20_000 },
      );
      if (ctx.finishError !== null) throw new Error(ctx.finishError);
      return ctx.rebuiltZip!.written;
    },
    records: async () => {
      if (draftKey === null) throw new Error("the phone opened no draft");
      const store = await stores(draftKey);
      if (store === undefined)
        throw new Error("the phone's draft did not open");
      return readRecords(store, true);
    },
    reopenRestored: () => phonePage(file, stores, true),
    lastFinished: () => {
      const made = ctx.rebuiltZip;
      if (made === null) throw new Error("the phone finished no tour");
      return new File([made.blob], made.filename, {
        type: "application/zip",
      });
    },
    objects,
    offer: () => dom.draftOfferText.textContent,
    draftKey: () => draftKey,
    placementNote: () => ctx.placementNote,
    addedStations: () =>
      addedOf(
        (ctx.tourDocument.manifest()?.stations ?? []).map((s) => ({
          id: s.id,
          lat: s.geo.lat,
          lon: s.geo.lon,
        })),
      ),
  };
}

// --- the table --------------------------------------------------------------

interface Row {
  readonly name: string;
  /** The operations, from the opened tour; a row that reopens continues on
   *  the page `run` returns. */
  readonly run: (page: Page) => Promise<Page>;
  /** Compare the draft's records too (rows whose phone side is the result
   *  of an AR path write no records here, see the file's comment). */
  readonly records: boolean;
  /** Where the two pages diverge today, and the step that ends it. */
  readonly diverges?: string;
  /** A divergence by design: one page has no such operation (the phone,
   *  or since D8 the desktop), and the row may fail for that reason only
   *  (`NoSuchOperation`) - the phone refusing a Finish, or writing
   *  something else, is a red row (the r880 milestone review LOW-6). */
  readonly byDesign?: true;
  /** What each page must leave, beyond agreeing with the other: two pages
   *  that share a bug agree too (the r880 milestone review, HIGH-1). */
  /** It sees each page's records (null for a row that compares none)
   *  and written tour. A by-design row whose DESKTOP lacks the operation
   *  still runs it on the phone against this (the r886 review M2:
   *  otherwise the phone's half never ran). */
  readonly each?: (page: {
    readonly records: { objects: string[]; deleted: string[] } | null;
    readonly written: TourManifest;
  }) => void;
}

const NORTH = 48.5205;

/** Why the station rows run on the desktop alone. */
const STATIONS_DESKTOP_ONLY =
  "by design: the 3D editor's station edits are the desktop's; the phone edits stations only by placing in AR";

/** The item ids of a written tour, station by station: the opened tour's
 *  stations, and the stations the write added. */
/** A station's title, or its id when it has none. */
function titleOrId(station: TourStation): string {
  return station.title ?? station.id;
}

/** An item's kind. */
function kindOf(item: TourStation["items"][number]): string {
  return item.kind;
}

function itemsByStation(written: TourManifest): {
  opened: string[][];
  added: string[][];
} {
  const opened = new Set(tourOf(OPENED).stations.map((s) => s.id));
  const itemsOf = (stations: readonly TourStation[]) =>
    stations.map((s) => s.items.map((i) => i.id).sort());
  return {
    opened: itemsOf(written.stations.filter((s) => opened.has(s.id))),
    added: itemsOf(written.stations.filter((s) => !opened.has(s.id))),
  };
}

/** The written station holding item `id`. */
function stationHolding(
  written: TourManifest,
  id: string,
): TourStation | undefined {
  return written.stations.find((s) => s.items.some((i) => i.id === id));
}

const ROWS: readonly Row[] = [
  {
    name: "edit a pin's text, save",
    records: true,
    run: async (p) => {
      await p.edit("a", "The gate");
      return p;
    },
  },
  {
    // Why (review #2a): a name change rides along with a real edit, so
    // the phone's Finish starts - both pages must write the same name.
    name: "edit a pin and name the tour, save",
    records: true,
    run: async (p) => {
      await p.edit("a", "The gate");
      await p.setDetails({ name: "Castle walk" });
      return p;
    },
  },
  {
    // Why: pin b is its station's only object, and the station has no
    // title, story or route: deleting the pin drops the station with it.
    name: "delete a pin, save",
    records: true,
    run: async (p) => {
      await p.remove("b");
      return p;
    },
    each: ({ written }) => {
      expect(written.stations.map((s) => s.id)).toEqual(["st-a", "st-f"]);
    },
  },
  {
    name: "delete a photo the file carries, save",
    records: true,
    run: async (p) => {
      await p.remove("f");
      return p;
    },
  },
  {
    name: "delete a pin and undo the delete, save",
    records: true,
    run: async (p) => {
      await p.edit("a", "The gate");
      await p.remove("b");
      await p.undoDelete();
      return p;
    },
  },
  {
    name: "edit, save, edit again, save",
    records: true,
    run: async (p) => {
      await p.edit("a", "The gate");
      await p.save();
      await p.edit("b", "The well");
      return p;
    },
  },
  {
    name: "delete, save, undo the delete, save",
    records: true,
    run: async (p) => {
      await p.remove("b");
      await p.save();
      await p.undoDelete();
      return p;
    },
    // Why: the first save wrote the deletion and took "b" out of the
    // document's deletions, but not the draft's tombstone; an undo that
    // left it would delete "b" again on the next restore.
    each: ({ records }) => {
      expect(records?.deleted).not.toContain("b");
    },
  },
  {
    name: "restore a draft's edit and delete on a later open, save",
    records: true,
    run: async (p) => {
      await p.edit("a", "The gate");
      await p.remove("b");
      return p.reopenRestored();
    },
  },
  {
    // Why: a move out of its station's found radius re-runs the station
    // rule. About 57 m from its station and 36 m from the nearest other
    // one (25 m radii): the note starts a station at its new spot, and the
    // station it left, now empty and automatic, goes.
    name: "move a note out of its station's radius, save",
    records: false,
    run: async (p) => {
      await p.move("a", NORTH, 9.0502);
      return p;
    },
    each: ({ written }) => {
      expect(itemsByStation(written)).toEqual({
        opened: [["b"], ["f"]],
        added: [["a"]],
      });
    },
  },
  {
    // Why: the same rule, the other way: a note moved to about 11 m from
    // another station (inside its 25 m radius) joins that station.
    name: "move a note into another station's radius, save",
    records: false,
    run: async (p) => {
      await p.move("a", 48.5203, 9.05);
      return p;
    },
    each: ({ written }) => {
      expect(itemsByStation(written)).toEqual({
        opened: [["a", "b"], ["f"]],
        added: [],
      });
    },
  },
  {
    // Why: a new pin about 33 m from the nearest station is beyond every
    // station's 25 m radius: it starts a station anchored where it stands.
    name: "place a new pin beyond every station's radius, save",
    records: false,
    run: async (p) => {
      await p.place(pin("new", "A new pin", NORTH));
      return p;
    },
    each: ({ written }) => {
      expect(itemsByStation(written)).toEqual({
        opened: [["a"], ["b"], ["f"]],
        added: [["new"]],
      });
      expect(stationHolding(written, "new")?.geo.lat).toBeCloseTo(NORTH, 9);
      expect(stationHolding(written, "new")).toMatchObject({
        foundRadiusM: 25,
        activateRadiusM: 50,
      });
    },
  },
  {
    // Why: the station a move started is the document's from that moment,
    // not the next write's, so the draft must keep it: after a reload the
    // note comes back in THAT station (same id, same spot), on both pages,
    // not in one the rule seats it in again under a new id - which the
    // written items alone cannot tell apart. (A placement's reload is the
    // phone's alone - the desktop places nothing a draft offers back - and
    // is held by the creator document's tests and the phone's end-to-end
    // run.)
    name: "move a note out of its station's radius, reload and restore the draft, save",
    records: false,
    run: async (p) => {
      await p.move("a", NORTH, 9.0502);
      const before = p.addedStations();
      expect(before).toHaveLength(1);
      const after = await p.reopenRestored();
      expect(after.addedStations()).toEqual(before);
      return after;
    },
    each: ({ written }) => {
      expect(itemsByStation(written)).toEqual({
        opened: [["b"], ["f"]],
        added: [["a"]],
      });
    },
  },
  {
    // Why: a new pin about 11 m from pin b's station, within its radius,
    // joins it rather than starting one of its own.
    name: "place a new pin within a station's radius, save",
    records: false,
    run: async (p) => {
      await p.place(pin("near", "A near pin", 48.5203));
      return p;
    },
    each: ({ written }) => {
      expect(itemsByStation(written)).toEqual({
        opened: [["a"], ["b", "near"], ["f"]],
        added: [],
      });
    },
  },
  {
    name: "move a station with its items (D17), save",
    records: false,
    run: async (p) => {
      await p.moveStation("st-a", {
        lat: NORTH,
        lon: 9.0503,
        alt: 340,
        rotation: [0, 0, 0, 1],
      });
      return p;
    },
  },
  {
    // Why (the r875 milestone review #1): a moved station must survive a
    // reload with its items (D17), not come back as its items at the
    // moved spots inside the unmoved station.
    name: "move a station, reload and restore the draft, save",
    records: false,
    run: async (p) => {
      await p.moveStation("st-a", {
        lat: NORTH,
        lon: 9.0503,
        alt: 340,
        rotation: [0, 0, 0, 1],
      });
      return p.reopenRestored();
    },
  },
  {
    // Why (plan M3b, Q-D): the phone's settle moves a station and saves
    // its code's new text as ONE step, so one undo takes the move back
    // whole - the station and its items where the opened tour has them,
    // as the desktop's undo of its move leaves them.
    name: "edit a pin, move a station by a code, undo the move, save",
    records: false,
    run: async (p) => {
      await p.edit("a", "The gate");
      await p.moveStation("st-a", {
        lat: NORTH,
        lon: 9.0503,
        alt: 340,
        rotation: [0, 0, 0, 1],
      });
      await p.undo();
      return p;
    },
    each: ({ written }) => {
      expect(stationHolding(written, "a")?.geo).toEqual(
        stationHolding(tourOf(OPENED), "a")?.geo,
      );
      expect(itemsByStation(written)).toEqual({
        opened: [["a"], ["b"], ["f"]],
        added: [],
      });
    },
  },
  {
    // Why (owner decision D8 of the editor round-2 plan): the phone's
    // "New station here" goes through the document's own path; the
    // desktop's "+" in the tree and "Move to a new station" come with the
    // 3D editor. When they land this row turns red and becomes a parity
    // row.
    name: "place a pin that starts its own station within the radius (D8), save",
    records: false,
    byDesign: true,
    diverges:
      "by design until the 3D editor: D8's desktop half (the tree's '+', the inspector's 'Move to a new station') is not built yet",
    run: async (p) => {
      // About 11 m north of pin b: within R, so only its own station
      // keeps it out of b's.
      await p.placeOwnStation(pin("own", "Its own station", 48.5203));
      return p;
    },
    each: ({ written }) => {
      expect(itemsByStation(written)).toEqual({
        opened: [["a"], ["b"], ["f"]],
        added: [["own"]],
      });
    },
  },
  {
    name: "turn on 'needs no GPS', save",
    records: true,
    byDesign: true,
    diverges:
      "by design: the setting is marked in the editor (Q-QF-1, the QR-first field study plan), the phone offers none - removed only if the owner wants it on the phone",
    run: async (p) => {
      await p.setNeedsNoGps(true);
      return p;
    },
  },
  {
    name: "name the tour, save",
    records: true,
    run: async (p) => {
      await p.setDetails({ name: "Castle walk" });
      return p;
    },
  },
  {
    name: "give the tour a description and a contact, save",
    records: true,
    byDesign: true,
    diverges:
      "by design: the phone has a tour name field only (W2 of the tour editor plan), the full details dialog is the editor's - removed only if the owner wants it on the phone",
    run: async (p) => {
      await p.setDetails({
        description: "A walk around the castle.",
        contact: "https://example.org",
      });
      return p;
    },
  },
  {
    // Why: a station's details are the 3D editor's (desktop only); they
    // must reach the saved tour and survive a reload through the draft.
    name: "rename a station and set its radius, reload and restore the draft, save",
    records: false,
    byDesign: true,
    diverges: STATIONS_DESKTOP_ONLY,
    run: async (p) => {
      await p.editStations((e) =>
        e.editStation("st-a", { title: "The gate", foundRadiusM: 40 }),
      );
      return p.reopenRestored();
    },
    each: ({ written }) => {
      expect(written.stations.find((s) => s.id === "st-a")).toMatchObject({
        title: "The gate",
        foundRadiusM: 40,
        activateRadiusM: 80,
      });
    },
  },
  {
    // Why: an added, a deleted and a reordered station each change the
    // tour's stations without any object's record naming them: only the
    // draft's whole frames bring them back after a reload.
    name: "add a station, delete another, reverse the order, reload and restore the draft, save",
    records: false,
    byDesign: true,
    diverges: STATIONS_DESKTOP_ONLY,
    run: async (p) => {
      await p.editStations((e) => {
        e.addStation({ lat: NORTH, lon: 9.0505, alt: 340 });
        e.deleteStation("st-b");
        e.reorderStations(
          e
            .model()
            .items.filter((i) => i.kind === "station")
            .map((i) => i.id.slice("station:".length))
            .reverse(),
        );
      });
      return p.reopenRestored();
    },
    each: ({ written }) => {
      // The added station is untitled: the tree names it by its number.
      const [added, ...rest] = written.stations;
      expect(added?.id.startsWith("st-")).toBe(false);
      expect(added?.title).toBeUndefined();
      expect(rest.map(titleOrId)).toEqual(["st-f", "st-a"]);
      expect(itemsByStation(written).opened).toEqual([["f"], ["a"]]);
    },
  },
  {
    // Why: a copy of a photo names a content file of its own; the copy
    // must save with its picture, and come back from the draft with it.
    name: "copy a photo's station and a pin, reload and restore the draft, save",
    records: false,
    byDesign: true,
    diverges: STATIONS_DESKTOP_ONLY,
    run: async (p) => {
      await p.editStations(async (e) => {
        await e.duplicateStation("st-f");
        await e.duplicateObject("a");
      });
      return p.reopenRestored();
    },
    each: ({ written }) => {
      const copy = written.stations[3];
      expect(copy?.title).toBe("Station 3 copy");
      expect(copy?.items.map(kindOf)).toEqual(["photo"]);
      expect(itemsByStation(written).opened[0]).toHaveLength(2);
    },
  },
  {
    // Why: "Move to a new station" starts a station where the item stands
    // even within its own station's radius, and "put on the ground" sets
    // its height; both must reach the saved tour after a reload.
    name: "move a pin into a station of its own and set its height, reload and restore the draft, save",
    records: false,
    byDesign: true,
    diverges: STATIONS_DESKTOP_ONLY,
    run: async (p) => {
      await p.editStations((e) => {
        e.pose(
          "a",
          { lat: 48.52, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
          { newStation: true },
        );
        e.groundItems([{ id: "a", alt: 338.5 }]);
      });
      return p.reopenRestored();
    },
    each: ({ written }) => {
      expect(itemsByStation(written)).toEqual({
        opened: [["b"], ["f"]],
        added: [["a"]],
      });
      const home = stationHolding(written, "a");
      expect(home?.items[0]?.pose.position[1]).toBeCloseTo(-1.5, 6);
    },
  },
  {
    name: "a name longer than 80 characters is refused, save",
    records: true,
    run: async (p) => {
      await p.edit("a", "The gate");
      await p.setDetails({ name: "x".repeat(81) });
      return p;
    },
  },
];

/** The pages wrote different tours or drafts: the one divergence a
 *  comparison raises. */
class PagesDisagree extends Error {}

/** What a marked row may fail with: the pages disagreeing, an operation
 *  the phone does not have, or the phone's Finish refusing to start. Not
 *  any assertion (the r875 milestone review #2c): a `vi.waitFor` timeout
 *  or a harness assertion is a broken row, never a divergence. */
function isDivergence(err: unknown): boolean {
  return (
    err instanceof PagesDisagree ||
    err instanceof NoSuchOperation ||
    (err instanceof Error && err.message === PHONE_FINISH_REFUSED)
  );
}

/** What a row leaves on one page: the file written and the draft. */
async function outcome(
  row: Row,
  make: (
    file: File,
    stores: (key: string) => Promise<DraftFileStore>,
  ) => Promise<Page>,
): Promise<{
  written: unknown;
  manifest: TourManifest;
  records: { objects: string[]; deleted: string[] } | null;
}> {
  const file = await tourFile();
  const stores = memoryStores();
  const page = await row.run(await make(file, stores));
  const written = await page.save();
  await flush();
  return {
    written: withStationsByOrder(written),
    manifest: written,
    records: row.records ? await page.records() : null,
  };
}

/** The written manifest as JSON, the ids of stations the opened tour
 *  lacks named by their order: the automatic-station rule mints a random
 *  id on each page, which says nothing about whether they agree. So is
 *  the tour's own id, which each page's open mints for a file without
 *  one (Q-I): it must be there, and is named `minted`. */
function withStationsByOrder(written: TourManifest): unknown {
  const known = new Set(tourOf(OPENED).stations.map((s) => s.id));
  const names = new Map<string, string>();
  expect(written.tourId).toMatch(/^[0-9a-f]{32}$/);
  if (written.tourId !== undefined) names.set(written.tourId, "minted");
  for (const station of written.stations) {
    if (!known.has(station.id)) {
      names.set(station.id, `new-${String(names.size)}`);
    }
  }
  return JSON.parse(serializeTourManifest(written), (_key, value: unknown) =>
    typeof value === "string" ? (names.get(value) ?? value) : value,
  ) as unknown;
}

/** What `row` asks of each page's outcome (`each`). */
function expectEach(row: Row, page: Awaited<ReturnType<typeof outcome>>): void {
  row.each?.({ records: page.records, written: page.manifest });
}

/** A marked row broke for a reason that is not a divergence: swallowed,
 *  so the row PASSES and `it.fails` turns it red. An unmarked row fails. */
function broken(row: Row, err: unknown): void {
  if (row.diverges === undefined) throw err;
  console.error(`${row.name}: not a divergence`, err);
}

/** Runs `row` on both pages and asserts they wrote the same. A marked
 *  row must fail for the reason it names - the pages disagree, or the
 *  phone has no such operation - never because the harness broke. The
 *  desktop runs FIRST and outside the divergence net (review #2b): a
 *  desktop that breaks in a row whose phone refuses is a red row, not an
 *  expected failure. */
async function samePages(row: Row): Promise<void> {
  let desktop: Awaited<ReturnType<typeof outcome>>;
  try {
    desktop = await outcome(row, desktopPage);
  } catch (err) {
    // The desktop lacking an operation by design (D8's desktop half): the
    // phone's half still runs and must leave what the row says, or the
    // row is red - only then the desktop's reason ends it.
    if (row.byDesign === true && err instanceof NoSuchOperation) {
      try {
        expectEach(row, await outcome(row, phonePage));
      } catch (phoneErr) {
        broken(row, phoneErr);
        return;
      }
      throw err;
    }
    broken(row, err);
    return;
  }
  let phone: Awaited<ReturnType<typeof outcome>>;
  try {
    phone = await outcome(row, phonePage);
  } catch (err) {
    const named =
      row.byDesign === true
        ? err instanceof NoSuchOperation
        : isDivergence(err);
    // The phone lacking an operation by design: the desktop's half ran and
    // must leave what the row says, or the row is red - only then the
    // phone's reason ends it.
    if (named && row.byDesign === true) {
      try {
        expectEach(row, desktop);
      } catch (desktopErr) {
        broken(row, desktopErr);
        return;
      }
    }
    if (named) throw err;
    broken(row, err);
    return;
  }
  if (row.diverges === undefined) {
    expect(desktop.written).toEqual(phone.written);
    expect(desktop.records).toEqual(phone.records);
    expectEach(row, desktop);
    expectEach(row, phone);
    return;
  }
  if (row.byDesign === true) {
    // Both pages ran an operation one of them is meant to lack.
    broken(row, new Error(`${row.name}: both pages have the operation now`));
    return;
  }
  if (
    !isDeepStrictEqual(desktop.written, phone.written) ||
    !isDeepStrictEqual(desktop.records, phone.records)
  ) {
    throw new PagesDisagree(`${row.name}: the pages wrote different tours`);
  }
}

describe("the parity contract: the phone's and the desktop's paths write the same tour and the same draft (D30)", () => {
  for (const row of ROWS) {
    const test = row.diverges === undefined ? it : it.fails;
    const name =
      row.diverges === undefined
        ? row.name
        : `${row.name} [DIVERGES until: ${row.diverges}]`;
    test(name, () => samePages(row), 60_000);
  }
});

describe("the parity contract: an earlier file carrying debug camera captures", () => {
  // Why this row matters: a file written while the walk's frames were
  // baked into the tour carries them as captureSpots, one frame in a
  // station of the tour and one in an automatic walk-1 station only it
  // kept. The field is gone from the format, so both pages open the same
  // document from it (the field ignored, walk-1 an empty station like any
  // other), an edit and a save on either writes the same tour, and
  // neither writes the field.
  // (Changed expectation: both pages once dropped walk-1 with the frames.
  // Without the field nothing names it, and no tour was published with it,
  // D5/D43.)
  const fileJson = JSON.parse(serializeTourManifest(tourOf(OPENED))) as {
    stations: unknown[];
  };
  const withCaptures: TourManifest = parseTourManifest({
    ...fileJson,
    stations: [
      ...fileJson.stations,
      {
        id: "walk-1",
        geo: { lat: 48.53, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
        activateRadiusM: 50,
        foundRadiusM: 25,
        hint: "arrow",
        steps: [],
        items: [],
      },
    ],
    captureSpots: {
      fixes: 3,
      gpsAccuracyMedianM: 4,
      captures: [
        {
          image: "images/frame-0.jpg",
          station: tourOf(OPENED).stations[0]!.id,
          pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        },
        {
          image: "images/frame-1.jpg",
          station: "walk-1",
          pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        },
      ],
    },
  });

  it("both pages write the same tour, walk-1 kept as a station and without the field", async () => {
    const file = await tourFile();
    const written = await Promise.all(
      [desktopPage, phonePage].map(async (page) => {
        const p = await page(file, memoryStores(), false, withCaptures);
        await p.edit("a", "The gate");
        return p.save();
      }),
    );
    const [desktop, phone] = written;
    // (Changed expectation, Q-I: compared with the tour id each page
    // minted named alike, as every other row compares.)
    expect(withStationsByOrder(desktop!)).toEqual(withStationsByOrder(phone!));
    for (const w of written) {
      expect(w !== undefined && "captureSpots" in w).toBe(false);
      expect(w?.stations.map((st) => st.id)).toEqual([
        ...tourOf(OPENED).stations.map((st) => st.id),
        "walk-1",
      ]);
    }
  }, 60_000);
});

describe("the parity contract: a save keeps the tour's level files as they are (plan M3b)", () => {
  // Why this test matters: a level file is a printed code's measured pose.
  // The phone's Finish writes one only when this page changed that code
  // (`codesToWrite`); the desktop measures no code and writes none. A save
  // that wrote one again would change bytes a diff or a later check
  // reads, and one that dropped it would strand the printed code. So after
  // an edit, both pages' saves hand each `qr/*.json` back byte for byte.
  // The text is not in `JSON.stringify`'s own form, so a file written
  // again from the parsed level shows.
  const LEVEL =
    '{ "version": 1,\n  "qr": { "text": "https://example.invalid/?qr=q1",' +
    ' "physicalSizeM": 0.16,\n    "geo": { "lat": 48.52, "lon": 9.05,' +
    ' "alt": 340, "rotation": [0, 0, 0, 1] } } }\n';

  async function fileWithLevel(): Promise<File> {
    const zip = await packFilesAsZip([
      { path: "tour.json", data: serializeTourManifest(tourOf(OPENED)) },
      { path: "content/f.jpg", data: "f" },
      { path: "qr/q1.json", data: LEVEL },
    ]);
    return new File([zip], "tour.zip", { type: "application/zip" });
  }

  it("the desktop's download and the phone's Finish keep qr/q1.json byte for byte", async () => {
    const file = await fileWithLevel();
    const desktop = await desktopPage(file, memoryStores());
    await desktop.edit("a", "The gate");
    const downloaded = (await desktop.download()).file;
    const phone = await phonePage(file, memoryStores());
    await phone.edit("a", "The gate");
    await phone.save();
    for (const [page, saved] of [
      ["desktop", downloaded],
      ["phone", phone.lastFinished()],
    ] as const) {
      const reopened = await openTourFile(saved);
      expect(await reopened.loadEntryText("qr/q1.json"), page).toBe(LEVEL);
    }
  }, 60_000);
});

describe("a draft of a file-opened tour across saves", () => {
  // The marker came off (debug-captures plan, Q-I): the tour carries its
  // own id from its first save, a file is keyed by it, and the save that
  // wrote it took the draft to that key once - on the phone at the
  // Finish's delivered save, on the desktop at a download that arrived -
  // leaving the opened file's draft as it was.
  it("a phone draft of a file-opened tour stays reachable across two Finishes", async () => {
    // Why this test matters: a tour opened from a FILE is known by a key
    // taken from its content (`tour-file-key.ts`), and the draft is kept
    // under it. A finished tour without a walk holds only what the tour
    // kit writes, so that key hashes its tour.json - and every Finish
    // writes a new one. The file a creator opens next is the one the last
    // Finish made; an edit made after that Finish must be offered there,
    // or it is lost with the page.
    const stores = memoryStores();
    const page = await phonePage(await tourFile(), stores);
    await page.edit("a", "Before the first Finish");
    await page.save();
    await page.edit("b", "Before the second Finish");
    const written = await page.save();
    await page.edit("a", "After the second Finish");
    const next = await phonePage(page.lastFinished(), stores, true, written);
    expect(next.objects().find((o) => o.id === "a")).toMatchObject({
      label: "After the second Finish",
    });
  }, 60_000);

  it("says the phone keeps no backup when the draft could not follow the saved file", async () => {
    // Why (r901 review #7): the file a Finish saved opens under the tour's
    // own id, so the draft moves to that key. A move that did not land
    // leaves the saved file without the draft it should offer: the page
    // must say it keeps no backup rather than promise one (the opened
    // file's draft stays as it was, so it still offers its edits).
    const stores = memoryStores();
    const refusingTheIdKey = (key: string) =>
      key.includes(":tour:") ? Promise.resolve(undefined) : stores(key);
    const page = await phonePage(await tourFile(), refusingTheIdKey);
    await page.edit("a", "Before the Finish");
    expect(page.placementNote() ?? "").not.toContain("backup");
    await page.save();
    await vi.waitFor(() => {
      expect(page.placementNote()).toContain(
        "This device is not saving a backup copy",
      );
    });
  }, 60_000);

  it("how: every Finish's file is known by the tour's own id, the draft followed it there once, and its open offers the edit", async () => {
    // Why (debug-captures M1, then Q-I): the row above says only that the
    // edit is offered; this one pins WHY, plainly, so a change of the
    // mechanism is seen here. (Changed expectation: it pinned the old
    // mechanism - the second Finish's file under another key, nothing
    // offered - which the tour's own id replaced.) The opened file has no
    // id, so it keeps its content key; the files both Finishes made carry
    // the one id its open minted; the draft followed the first of them.
    const stores = memoryStores();
    const file = await tourFile();
    const page = await phonePage(file, stores);
    const openedKey = page.draftKey();
    expect(openedKey).toBe(await tourFileKeyOfFile(file));
    await page.edit("a", "Before the first Finish");
    const first = await page.save();
    const firstKey = await tourFileKeyOfFile(page.lastFinished());
    expect(first.tourId).toMatch(/^[0-9a-f]{32}$/);
    expect(firstKey).toBe(`local-file:tour:${first.tourId!}`);
    await page.edit("b", "Before the second Finish");
    const written = await page.save();
    expect(written.tourId).toBe(first.tourId);
    await page.edit("a", "After the second Finish");
    const finished = page.lastFinished();
    expect(await tourFileKeyOfFile(finished)).toBe(firstKey);
    expect(page.draftKey()).toBe(firstKey);
    const next = await phonePage(finished, stores, false, written);
    expect(next.draftKey()).toBe(firstKey);
    expect(next.offer()).not.toBe("");
    // A saved file is not known to be put anywhere, so the opened file's
    // draft keeps what it held: opened again, it still offers its edits.
    const before = await phonePage(file, stores, false);
    expect(before.offer()).not.toBe("");
  }, 60_000);

  it("a desktop draft of a file-opened tour follows its downloads the same way", async () => {
    // Why (Q-I): the desktop saves a tour it cannot write in place as a
    // download. Its first one writes the tour's id, so the file it made
    // opens under the id's key; an edit made after it must be offered
    // there, as on the phone.
    const stores = memoryStores();
    const page = await desktopPage(await tourFile(), stores);
    await page.edit("a", "Before the first download");
    await page.download();
    await page.edit("b", "Before the second download");
    const second = await page.download();
    await page.edit("a", "After the second download");
    const next = await desktopPage(second.file, stores, true, second.written);
    expect(next.objects().find((o) => o.id === "a")).toMatchObject({
      label: "After the second download",
    });
  }, 60_000);
});
