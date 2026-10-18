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
 *   object's content and each deletion's id - not the meta, which carries
 *   page-specific fields (the phone's code level and printed size).
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
  serializeTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourObjects } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import {
  packFilesAsZip,
  type DraftFileStore,
} from "gps-plus-slam-app-framework/storage";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";

import { objectContentKey } from "./authoring-draft.js";
import { wireCreatorSetup, type CreatorSetupDom } from "./creator-setup.js";
import { readDraft } from "./draft-persistence.js";
import { createEditorDraft } from "./editor/editor-draft.js";
import { createEditorSession } from "./editor/editor-session.js";
import type { EditorLock } from "./editor/save-target.js";
import type { ObjectListHandlers } from "./object-list.js";
import { authoringObjects, upsertPlaced } from "./object-edits.js";
import { tourObjectsOf } from "./tour-content.js";
import { openTourFile, type TourSession } from "./tour-session.js";
import {
  createTourViewerSession,
  createTourViewerStore,
} from "./tour-viewer-session.js";
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
  /** A note to `lat`/`lon`, height and facing kept (the phone: as its AR
   *  move leaves the page's lists). */
  move(id: string, lat: number, lon: number): Promise<void>;
  /** A station moved rigidly to `geo`, its items with it (D17; the phone:
   *  as its re-measured code leaves the page's manifest and lists). */
  moveStation(stationId: string, geo: QrGeoPose): Promise<void>;
  setNeedsNoGps(on: boolean): Promise<void>;
  setDetails(change: DetailsChange): Promise<void>;
  /** Save (the desktop) or Finish (the phone): the manifest written. */
  save(): Promise<TourManifest>;
  /** The draft as a later open reads it: object contents and deletions. */
  records(): Promise<{ objects: string[]; deleted: string[] }>;
  /** A new page load over the same file and the same draft, restoring
   *  what the draft offers. */
  reopenRestored(): Promise<Page>;
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
): Promise<Page> {
  const session: TourSession = await openTourFile(file);
  const manifest = tourOf(OPENED);
  const draft = createEditorDraft({
    openStore: stores,
    holdLock: freeLock,
    noBackup: () => undefined,
  });
  const opened = await draft.open(session.archive.url, manifest);
  const editor = createEditorSession({
    session,
    manifest,
    levels: new Map(),
    draft: draft.writes(),
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
    move: (id, lat, lon) => {
      editor.move(id, lat, lon);
      return draft.idle();
    },
    moveStation: (stationId, geo) => {
      editor.moveStation(stationId, geo);
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
    records: async () => readRecords(await stores(key), false),
    reopenRestored: () => desktopPage(file, stores, true),
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

async function phonePage(
  file: File,
  stores: (key: string) => Promise<DraftFileStore>,
  restore = false,
): Promise<Page> {
  const session: TourSession = await openTourFile(file);
  const dom = Object.fromEntries(
    PHONE_DOM_KEYS.map((k) => [k, phoneElement()]),
  ) as Record<(typeof PHONE_DOM_KEYS)[number], ReturnType<typeof phoneElement>>;
  const ctx = createTourViewerSession();
  ctx.session = session;
  ctx.tourManifestStatus = "settled";
  ctx.tourManifest = tourOf(OPENED);
  let typedName: string | null = null;
  let draftKey: string | null = null;
  const setup = wireCreatorSetup({
    ctx,
    mode: "creator",
    arStore: createTourViewerStore(),
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
    tourTitle: () => typedName,
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
    authoringObjects(
      tourObjectsOf(ctx.tourManifest),
      ctx.placedObjects,
      ctx.deletedObjectIds,
    ).map((o) => o.object);
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
      // As `creator-placement.ts` leaves the lists after a tap in AR.
      ctx.placedObjects = [...ctx.placedObjects, { object }];
      await flush();
    },
    move: async (id, lat, lon) => {
      // As `object-editing.ts`'s move leaves the lists (its AR geometry
      // decides the geo; here the same spot the desktop is given).
      const found = objects().find((o) => o.id === id);
      if (found === undefined) return;
      ctx.placedObjects = upsertPlaced(ctx.placedObjects, {
        object: { ...found, geo: { ...found.geo, lat, lon } },
      });
      await flush();
    },
    moveStation: async (stationId, geo) => {
      // As `creator-settle.ts`'s `moveStationsAlong` and `take` leave the
      // page: the station moved in the page's manifest, and each item an
      // edit at the place its moved station now gives it.
      const manifest = ctx.tourManifest!;
      const before = new Map(tourObjects(manifest).map((o) => [o.id, o]));
      ctx.tourManifest = {
        ...manifest,
        stations: manifest.stations.map((s) =>
          s.id === stationId ? { ...s, geo } : s,
        ),
      };
      for (const after of tourObjects(ctx.tourManifest)) {
        if (after.station !== stationId || !before.has(after.id)) continue;
        ctx.placedObjects = upsertPlaced(ctx.placedObjects, { object: after });
      }
      await flush();
    },
    setNeedsNoGps: () =>
      Promise.reject(new NoSuchOperation("phone: the needs-no-GPS setting")),
    setDetails: (change) => {
      if (change.description !== undefined || change.contact !== undefined) {
        return Promise.reject(
          new NoSuchOperation("phone: a description or a contact"),
        );
      }
      if (change.name !== undefined) typedName = change.name;
      return Promise.resolve();
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
      return readRecords(await stores(draftKey), true);
    },
    reopenRestored: () => phonePage(file, stores, true),
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
}

const NORTH = 48.5205;

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
    name: "delete a pin, save",
    records: true,
    run: async (p) => {
      await p.remove("b");
      return p;
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
    diverges:
      "the phone offers no undo once a Finish wrote the delete; the desktop does (the phone adoption, if the phone gets the document's undo - not decided, plan §9 round 5)",
    run: async (p) => {
      await p.remove("b");
      await p.save();
      await p.undoDelete();
      return p;
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
    name: "move a note, save",
    records: false,
    run: async (p) => {
      await p.move("a", NORTH, 9.0502);
      return p;
    },
  },
  {
    name: "place a new pin, save",
    records: false,
    run: async (p) => {
      await p.place(pin("new", "A new pin", NORTH));
      return p;
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
    name: "turn on 'needs no GPS', save",
    records: true,
    diverges:
      "the phone has no such setting (the phone adoption: `settingsChanged`)",
    run: async (p) => {
      await p.setNeedsNoGps(true);
      return p;
    },
  },
  {
    name: "name the tour, save",
    records: true,
    diverges:
      "the phone's Finish counts a changed name as no work, so a name alone is never saved there (the phone adoption: the name is a document change like any other)",
    run: async (p) => {
      await p.setDetails({ name: "Castle walk" });
      return p;
    },
  },
  {
    name: "give the tour a description and a contact, save",
    records: true,
    diverges:
      "the phone edits only the name (the phone adoption: `detailsChanged`)",
    run: async (p) => {
      await p.setDetails({
        description: "A walk around the castle.",
        contact: "https://example.org",
      });
      return p;
    },
  },
  {
    name: "a name longer than 80 characters is refused, save",
    records: true,
    diverges:
      "the desktop refuses a name over 80 characters, the phone's Finish writes what its field gives (the phone adoption: the name checked by `checkTourTitle` on both pages)",
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
): Promise<{ written: unknown; records: unknown }> {
  const file = await tourFile();
  const stores = memoryStores();
  const page = await row.run(await make(file, stores));
  const written = await page.save();
  await flush();
  return {
    written: withStationsByOrder(written),
    records: row.records ? await page.records() : null,
  };
}

/** The written manifest as JSON, the ids of stations the opened tour
 *  lacks named by their order: the automatic-station rule mints a random
 *  id on each page, which says nothing about whether they agree. */
function withStationsByOrder(written: TourManifest): unknown {
  const known = new Set(tourOf(OPENED).stations.map((s) => s.id));
  const names = new Map<string, string>();
  for (const station of written.stations) {
    if (!known.has(station.id)) {
      names.set(station.id, `new-${String(names.size)}`);
    }
  }
  return JSON.parse(serializeTourManifest(written), (_key, value: unknown) =>
    typeof value === "string" ? (names.get(value) ?? value) : value,
  ) as unknown;
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
    broken(row, err);
    return;
  }
  let phone: Awaited<ReturnType<typeof outcome>>;
  try {
    phone = await outcome(row, phonePage);
  } catch (err) {
    if (isDivergence(err)) throw err;
    broken(row, err);
    return;
  }
  if (row.diverges === undefined) {
    expect(desktop.written).toEqual(phone.written);
    expect(desktop.records).toEqual(phone.records);
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
