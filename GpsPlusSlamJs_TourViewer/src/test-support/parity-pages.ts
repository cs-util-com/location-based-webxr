/**
 * The parity contract's two pages (the tour editor plan: one document,
 * shared by both pages), shared by
 * the table (`tour-document-parity.test.ts`) and its property
 * (`tour-document-parity.property.test.ts`): the same operations driven
 * through the phone's page (`wireCreatorSetup`: its object list, draft
 * and Finish) and through the desktop editor's (`createEditorSession`
 * with `createEditorDraft`), and the tour both open.
 */
import { finishErrorLine, finishRunning } from "../finish-status.js";
import { editorStore } from "./editor-store.js";
import { expect, vi } from "vitest";
import {
  serializeTourManifest,
  type TourManifest,
  type TourObject,
  type TourPicture,
  type TourPin,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  packFilesAsZip,
  type DraftFileStore,
} from "gps-plus-slam-app-framework/storage";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";

import { objectContentKey } from "../authoring-draft.js";
import { wireCreatorSetup, type CreatorSetupDom } from "../creator-setup.js";
import { readDraft } from "../draft-persistence.js";
import { createEditorDraft } from "../editor/editor-draft.js";
import {
  createEditorSession,
  type EditorSession,
} from "../editor/editor-session.js";
import type { EditorLock } from "../editor/save-target.js";
import type { ObjectListHandlers } from "../object-list.js";
import {
  openTourFile,
  tourFileKeyOfFile,
  type TourSession,
} from "../tour-session.js";
import { createTourViewerSession } from "../tour-viewer-session.js";
import { documentObjects, selectTourDocument } from "../tour-document.js";
import { memoryDraftOps } from "./memory-draft-stores.js";
import { settle } from "./settle.js";
import { tourOf } from "./tour-of.js";

// --- the tour both pages open ----------------------------------------------

export function pin(id: string, label = `pin ${id}`, lat = 48.52): TourPin {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption: label,
    createdAtIso: "2026-10-18T00:00:00.000Z",
    geo: { lat, lon: 9.05, alt: 340, headingDeg: 0 },
  };
}

function photo(id: string): TourPicture {
  return {
    id,
    kind: "picture",
    view: "plane",
    image: id,
    widthM: 1,
    imageAsset: {
      id: id,
      path: `content/${id}.jpg`,
      kind: "image",
      width: 4,
      height: 3,
    },
    createdAtIso: "2026-10-18T00:00:00.000Z",
    geo: { lat: 48.5201, lon: 9.05, alt: 340, rotation: [0, 0, 0, 1] },
  };
}

/** Two pins and a photo, each in a station of its own (`tourOf`). */
export const OPENED = [pin("a"), pin("b", "pin b", 48.5202), photo("f")];

export async function tourFile(): Promise<File> {
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

/** Until the page's draft writes and its store have stopped changing
 *  (`page` is the phone's store; the desktop awaits its draft itself). */
export function flush(page?: { getState(): unknown }): Promise<void> {
  return settle(() => [memoryDraftOps(), page?.getState()]);
}

// --- the operations ---------------------------------------------------------

interface DetailsChange {
  readonly name?: string;
  readonly description?: string;
  readonly contact?: string;
}

/** One page, driven through its own code path. */
export interface Page {
  edit(id: string, text: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Take back the last delete (the phone's Undo, the desktop's undo). */
  undoDelete(): Promise<void>;
  /** A new pin where `object` says (the phone: as its AR placement leaves
   *  the page's lists). */
  place(object: TourObject): Promise<void>;
  /** A new pin that starts its own station even within the automatic
   *  radius of another (the tour editor plan; the
   *  phone: its "New station here" chip, then a placement). */
  placeOwnStation(object: TourObject): Promise<void>;
  /** A note to `lat`/`lon`, height and facing kept (the phone: as its AR
   *  move leaves the page's lists). */
  move(
    id: string,
    lat: number,
    lon: number,
    joinStation?: string,
  ): Promise<void>;
  /** A station moved rigidly to `geo`, its items with it, by a code
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
export interface DesktopPage extends Page {
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
export const PHONE_FINISH_REFUSED = "the phone's Finish did not start";

/** No such operation on this page today: the row cannot be driven. */
export class NoSuchOperation extends Error {}

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

export async function desktopPage(
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
  const store = editorStore();
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
          "desktop: a new station for a placement (not built on the desktop yet)",
        ),
      ),
    move: (id, lat, lon, joinStation) => {
      // As the 3D view's drag ends: the whole pose, its height and turn kept.
      const found = documentObjects(selectTourDocument(store.getState())).find(
        (o) => o.object.id === id,
      );
      if (found !== undefined) {
        editor.pose(
          id,
          { ...found.object.geo, lat, lon },
          joinStation === undefined ? {} : { joinStation },
        );
      }
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
export interface PhonePage extends Page {
  lastFinished(): File;
  objects(): TourObject[];
  offer(): string;
  draftKey(): string | null;
  /** The placement line, where the page says it keeps no backup. */
  placementNote(): string | null;
}

export async function phonePage(
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
  const store = editorStore();
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
  await flush(store);
  if (restore) {
    await vi.waitFor(() => {
      expect(dom.draftOfferText.textContent).not.toBe("");
    });
    dom.draftRestore.click();
    await flush(store);
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
      await flush(store);
    },
    remove: async (id) => {
      list().remove(id);
      await flush(store);
    },
    undoDelete: async () => {
      list().undo();
      await flush(store);
    },
    place: async (object) => {
      // As `creator-placement.ts` places after a tap in AR.
      ctx.tourDocument.place(object, {}, "a pin");
      await flush(store);
    },
    placeOwnStation: async (object) => {
      // As `creator-placement.ts` places after "New station here" and a
      // tap in AR: the placement takes the arm and asks for the station.
      ctx.tourDocument.armNewStation(true);
      ctx.tourDocument.armNewStation(false);
      ctx.tourDocument.place(object, { ownStation: true }, "a pin");
      await flush(store);
    },
    move: async (id, lat, lon, joinStation) => {
      // As `object-editing.ts`'s move changes the document (its AR
      // geometry decides the geo; here the same spot the desktop is given).
      const found = objects().find((o) => o.id === id);
      if (found === undefined) return;
      ctx.tourDocument.move(
        { ...found, geo: { ...found.geo, lat, lon } },
        "a note",
        undefined,
        joinStation,
      );
      await flush(store);
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
      await flush(store);
    },
    undo: async () => {
      ctx.tourDocument.undo();
      await flush(store);
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
      return flush(store);
    },
    save: async () => {
      const started = setup.finishNow();
      if (!started) throw new Error(PHONE_FINISH_REFUSED);
      await vi.waitFor(
        () => {
          expect(finishRunning(ctx.tourDocument.state())).toBe(false);
        },
        { timeout: 20_000 },
      );
      const failed = finishErrorLine(ctx.tourDocument.state());
      if (failed !== null) throw new Error(failed);
      return ctx.saves!.newest()!.written;
    },
    records: async () => {
      if (draftKey === null) throw new Error("the phone opened no draft");
      const drafts = await stores(draftKey);
      if (drafts === undefined)
        throw new Error("the phone's draft did not open");
      return readRecords(drafts, true);
    },
    reopenRestored: () => phonePage(file, stores, true),
    lastFinished: () => {
      const made = ctx.saves?.newest() ?? null;
      if (made === null) throw new Error("the phone finished no tour");
      return new File([made.blob], ctx.saves!.fileName, {
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

/** The written manifest as JSON, the ids of stations the opened tour
 *  lacks named by their order: the automatic-station rule mints a random
 *  id on each page, which says nothing about whether they agree. So is
 *  the tour's own id, which each page's open mints for a file without
 *  one: it must be there, and is named `minted`. */
export function withStationsByOrder(written: TourManifest): unknown {
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
