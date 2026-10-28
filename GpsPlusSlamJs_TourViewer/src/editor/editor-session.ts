/**
 * The desktop editor's open tour and its edits (M6 E2a): the shared rules
 * of the phone's object list (`object-edits.ts`) over the tour the page
 * opened, and a Save built by the phone's own Finish rules
 * (`finish-rebuild.ts`). Page-free: the page shows `model()`, calls the
 * edits, and downloads what `save()` returns.
 *
 * @see editor-session.ts.md
 */

import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type {
  TourManifest,
  TourObject,
  TourPicture,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { TOUR_ITEM_MAX_OFFSET_M } from "gps-plus-slam-app-framework/ar/tour-items";
import {
  TOUR_MODEL_MAX_SIZE_M,
  TOUR_MODEL_MIN_SIZE_M,
} from "gps-plus-slam-app-framework/ar/tour-blocks";
import {
  TOUR_DESCRIPTION_MAX_CHARS,
  TOUR_TITLE_MAX_CHARS,
  tourCoverEntry,
} from "gps-plus-slam-app-framework/ar/tour-details";
import {
  buildDebugBundle,
  type DebugBundleBuilt,
  type DebugBundleTour,
} from "../debug-bundle.js";
import { scanEntryNames } from "../tour-read-set.js";
import type { DraftObjectWrites } from "../draft-actions.js";
import type { TourSession } from "../tour-session.js";
import {
  checkDetailsForm,
  DETAIL_FIELDS,
  type DetailsForm,
  type TourDetailFields,
} from "../tour-details-form.js";
import {
  canStep,
  changeCount,
  coverImageIds,
  detailsChange,
  documentObjects,
  effectiveDetails,
  isCapturedPhoto,
  isDocumentEdit,
  manifestNow,
  objectFits,
  nextStep,
  objectMoveChange,
  picturesNeeded,
  pinTextChange,
  selectTourDocument,
  stationDeleteRefusal,
  stationEditChange,
  stationEditsBetween,
  tourDocumentActions,
  tourDocumentReducer,
  unsavedEntries,
  type StationEdit,
  type TourDocumentState,
} from "../tour-document.js";
import { newObjectId } from "../content-placement.js";
import {
  STATION_RADIUS_MAX_M,
  STATION_RADIUS_MIN_M,
} from "../station-geometry.js";
import { followDocument } from "../tour-document-draft.js";
import { newTourId } from "../tour-file-key.js";
import {
  createTourSaves,
  dispatchThunk,
  TOUR_REPLACED,
} from "../tour-document-save.js";
import type { FinishedTour } from "../finish-rebuild.js";
import {
  createTourViewerStore,
  type TourViewerStore,
} from "../tour-viewer-session.js";
import type { DetailsOutcome } from "./details-dialog.js";
import type { EditorTourSettings } from "./editor-draft.js";
import { blockFieldEdit, blockFields } from "./block-fields.js";
import { buildEditorModel, type EditorModel } from "./editor-model.js";
import { STATION_LOCKED } from "./editor-view.js";
import { checkNoGps, type NoGpsCheck } from "./no-gps-check.js";
import { readZipBlobEntry, zipBlobEntryNames } from "../zip-blob.js";

/** One of the tour's objects as it stands, with this page's entry. */
type AuthoringObject = ReturnType<typeof documentObjects>[number];

/** Said for an undo or a redo asked for while a save runs: the save's end
 *  decides what the file carries, so the step waits (W2). */
const SAVE_RUNNING = "A save is running - undo or redo once it has finished.";

/** Said when an undo would bring back a photo a save already took out of
 *  the file, and its picture could not be kept. */
const PICTURE_GONE =
  "This photo's picture is no longer at hand, so its delete cannot be undone here.";

/** An object as the undo's words name it: its text, shortened, or what
 *  it is. */
function objectName(object: TourObject): string {
  const label = (
    (object.kind === "model" ? object.title : object.caption) ?? ""
  ).trim();
  if (label === "") return object.kind === "picture" ? "a photo" : "a note";
  const chars = [...label];
  return `"${chars.length > 40 ? `${chars.slice(0, 39).join("")}…` : label}"`;
}

/** The outcome of an undo or a redo: the step taken (in words), nothing
 *  to take, or a refusal in words. */
type UndoOutcome =
  | { readonly kind: "undone" | "redone"; readonly what: string }
  | { readonly kind: "nothing" }
  | EditorRefusal;

/** A copy's file name ("Save a copy…"): the tour's, with " copy" before
 *  its `.zip` (any case), so the copy is never taken for the tour's own
 *  file. */
export function copyFileName(name: string): string {
  return beforeZip(name, " copy");
}

/** The name the save dialog suggests for a tour opened from a link or the
 *  sample: `name` with `-YYYY-MM-DD-HHMMSS` (`now`, local time) before
 *  its `.zip` (any case), so reopening the same link never suggests the
 *  file that holds the edited tour - Enter, then Replace, would write the
 *  original over it. Two opens in the same local second still share a
 *  name (so do two in the hour a daylight-saving change repeats). */
export function datedFileName(name: string, now: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  const day = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  const time = `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return beforeZip(name, `-${day}-${time}`);
}

/** The stamp `datedFileName` puts before a name's `.zip` (or at its end). */
const DATE_STAMP = /-\d{4}-\d{2}-\d{2}-\d{6}(\.zip)?$/i;

/** The inverse of `datedFileName`: `name` without its
 *  `-YYYY-MM-\-HHMMSS` stamp before the `.zip` (any case) or at its
 *  end; any other name as it is. Done names the hosted file by it when the
 *  tour was not opened from its link in this session (the dated save
 *  reopened, a draft restored after a reload). */
export function undatedFileName(name: string): string {
  return name.replace(DATE_STAMP, (_stamp, zip?: string) => zip ?? "");
}

/** `name` with `insert` before its `.zip` ending (any case), else at its
 *  end: a ".zip" that is not the end is part of the name. */
function beforeZip(name: string, insert: string): string {
  const at = /\.zip$/i.test(name) ? name.length - 4 : name.length;
  return `${name.slice(0, at)}${insert}${name.slice(at)}`;
}

export interface EditorSave {
  readonly blob: Blob;
  /** The opened file's name, made safe to save (the Finish's rule). */
  readonly filename: string;
  /** Entries visitors never read that the save left out. */
  readonly scanLeftOut: readonly string[];
  /** The manifest the zip carries (the draft's `written` versions, M6
   *  E2c). */
  readonly written: TourManifest;
}

/** Said when "Move the debug data out" finds no walk in the newest
 *  bytes. */
const NO_WALK = "This tour carries no walk recording to move out.";

/**
 * A built move of the walk out of the tour (W2, D19): the debug bundle
 * (`debug-bundle.ts`, M2 of the debug-captures plan: the whole recording
 * of the newest bytes, byte for byte, under its own paths, with the
 * identity and the note naming the tour) and the tour without the walk,
 * with the pending edits. Nothing of the
 * session changes until `commit()`: the page writes the walk's zip first,
 * then the tour, and commits only when both landed - a commit before that
 * would let the next save rebuild from walk-free bytes the creator never
 * received. The page holds every save while a move runs.
 */
interface WalkMove {
  readonly kind: "ready";
  readonly walk: { readonly blob: Blob; readonly filename: string };
  readonly save: EditorSave;
  /** No other save landed since the move was built: asked before the
   *  tour is written, so a stale move writes nothing (the M4b milestone
   *  review #2: the page's second click may come after an autosave). */
  current(): boolean;
  /** Make the walk-free tour the session's newest bytes, as a landed save
   *  does; throws when another save landed since the move was built.
   *  `inPlace`: the tour was written over the opened file (D33). */
  commit(inPlace?: boolean): void;
}

/** Said for an id the tour no longer carries (a restore or a save took
 *  it away while its card was open, M6 E2c review #11). */
export const NOT_IN_TOUR = "That note is no longer in this tour.";

/** Said for a placement of an id the tour already carries. */
const ALREADY_IN_TOUR = "That note is already in this tour.";

/** Said for a move of a station the tour does not carry. */
const NO_SUCH_STATION = "That station is no longer in this tour.";

/** Said for a move further from the note's station than a tour can carry
 *  (`TOUR_ITEM_MAX_OFFSET_M` per axis): the format would refuse the tour,
 *  so every later save failed with the parser's own words (the M5a
 *  milestone review L1). A note stays in its station however far it is
 *  moved (`tour-content.ts`). */
export const TOO_FAR_FROM_STATION = `It cannot go that far: a note must stay within ${String(TOUR_ITEM_MAX_OFFSET_M / 1000)} km of its station.`;

/** An edit, move or delete of an id the tour no longer carries, said in
 *  words (`NOT_IN_TOUR`) by all three alike (PR #622 bot finding C). */
interface EditorRefusal {
  readonly kind: "refused";
  readonly reason: string;
}

/** What a draft offers back (`editor-draft.ts`). */
interface EditorRestore {
  readonly objects: readonly TourObject[];
  readonly deleted: readonly string[];
  /** The tour-level settings, when the draft holds a change of them. */
  readonly settings?: EditorTourSettings;
  /** The ids among `objects` the tour does not carry that are copies made
   *  here: put back (an object of any other id the tour lacks is skipped). */
  readonly made?: readonly string[];
  /** The pictures of offered photos the opened file lacks (copies made
   *  here): a photo among them without its picture is not put back. */
  readonly pictures?: ReadonlyMap<string, Blob>;
}

/** Said for a station's edit the format refuses, by the field. */
const STATION_REFUSALS: Readonly<
  Record<"title" | "radius" | "description" | "image", string>
> = {
  title: `A station's name can be at most ${String(TOUR_TITLE_MAX_CHARS)} characters long.`,
  radius: `A station's radius must be from ${String(STATION_RADIUS_MIN_M)} m to ${String(STATION_RADIUS_MAX_M)} m.`,
  description: `A station's description can be at most ${String(TOUR_DESCRIPTION_MAX_CHARS)} characters long.`,
  image:
    "A station's picture must be a photo of that station or an image of this tour.",
};

/** Said for a delete of the tour's last station. */
const LAST_STATION =
  "A tour needs at least one station, so its last station cannot be deleted.";

/** Said for a station placed where no map has a spot. */
const NOT_ON_MAP = "That spot is not on the map.";

/** Whether a pose is a spot on the map: finite numbers, latitude and
 *  longitude in range, and a heading or rotation (where it has one) of
 *  finite numbers. */
function onMap(geo: QrGeoPose): boolean {
  return (
    [geo.lat, geo.lon, geo.alt].every(Number.isFinite) &&
    Math.abs(geo.lat) <= 90 &&
    Math.abs(geo.lon) <= 180 &&
    (geo.headingDeg === undefined || Number.isFinite(geo.headingDeg)) &&
    (geo.rotation === undefined || geo.rotation.every(Number.isFinite))
  );
}

/** Said for a new order that does not name every station once. */
const NOT_AN_ORDER = "The new order must name every station of the tour once.";

/** Said for a size given to anything but a model. */
const NOT_A_MODEL = "Only a 3D model has a size.";

/** Said for a model size out of bounds. */
const MODEL_SIZE = `A model's size must be from ${String(TOUR_MODEL_MIN_SIZE_M)} m to ${String(TOUR_MODEL_MAX_SIZE_M)} m.`;

/** Said when a photo's picture cannot be read for its copy. */
const PICTURE_UNREAD =
  "This photo's picture could not be read, so it cannot be copied.";

/** Said for heights that cannot be set: no number, or beyond what the
 *  item's station can carry. */
const HEIGHT_REFUSED = `That height cannot be set: an item must stay within ${String(TOUR_ITEM_MAX_OFFSET_M / 1000)} km of its station.`;

/** Said when an edit could not be applied (the tour changed under it). */
const NOT_APPLIED = "That change could not be made to the tour as it is now.";

/** A station as the undo's words name it. */
function stationName(frame: { readonly title?: string }): string {
  return frame.title === undefined ? "a station" : `"${frame.title}"`;
}

/** Where the session backs its edits up: the objects' writes the phone
 *  shares (`draft-actions.ts`), and the tour's settings (QR-first M1b-2)
 *  with its details (W2). */
export interface EditorSessionDraft extends DraftObjectWrites {
  saveSettings(settings: EditorTourSettings): Promise<boolean>;
}

/** One image a tour may show as its cover (W2): a placed photo, or an
 *  image the tour carries as a content asset. */
interface CoverChoice {
  readonly id: string;
  /** Its entry in the zip (`content/<id>.jpg`). */
  readonly image: string;
}

export interface EditorSession {
  /** The tour as it stands with the edits, for the rail and the map. */
  model(): EditorModel;
  /** Edits and deletions not yet in a saved file, by content: a text
   *  edited back to the tour's own is no change (E2a review #10). */
  changeCount(): number;
  /** The ids of the notes with an edit or a move not yet saved. */
  pendingIds(): string[];
  /** The name every save of this open is written under: the opened
   *  file's, made safe (the Finish's rule). The page names the walk's
   *  file after it before a save ran. */
  savedName(): string;
  /** The tour's "needs no GPS" setting as it stands with the edits
   *  (QR-first M1b-2, owner Q-QF-1). */
  needsNoGps(): boolean;
  /** Turn it on or off: one pending change while it differs from the
   *  saved file, none once it is back at the file's own value. */
  setNeedsNoGps(on: boolean): { kind: "changed" | "unchanged" };
  /** The tour's name, description, cover and contact as they stand with
   *  the edits (W2); a cover whose image is gone (a deleted photo) is
   *  none. */
  details(): DetailsForm;
  /** Change them all at once (the "Tour details" dialog): each field that
   *  differs from the saved file is one pending change, an emptied field
   *  removes the detail. Refused in plain words, changing nothing, for
   *  what the format would drop. */
  setDetails(next: DetailsForm): DetailsOutcome;
  /** The images the tour may show as its cover: its placed photos and
   *  image assets, as they stand with the edits. */
  coverChoices(): CoverChoice[];
  /** What the setting's warnings are about: the code-less stations, the
   *  stations on a code the viewer cannot use, and whether a code can
   *  place the tour (`no-gps-check.ts`). */
  noGpsCheck(): NoGpsCheck;
  editText(
    id: string,
    text: string,
  ): { kind: "edited" | "unchanged" } | EditorRefusal;
  /** Set one of a free block's other text fields (`block-fields.ts`: a
   *  short text's description, a picture's title, caption or alt text, a
   *  model's title): one step; a blank text removes the field; refused in
   *  words, changing nothing, over its cap or for an id the tour does not
   *  carry (B2c). */
  editBlockField(
    id: string,
    field: string,
    value: string,
  ): { kind: "edited" | "unchanged" } | EditorRefusal;
  /** Move a note on the map (its height and facing kept): beyond its
   *  station's found radius the station rule seats it anew - the station
   *  holding its new spot, or a new one there - so no move is too far.
   *  Refused for an id the tour no longer carries. Throws for a position
   *  nobody can draw (`moveObjectTo`). */
  move(id: string, lat: number, lon: number): { kind: "moved" } | EditorRefusal;
  /** Delete (undone by `undo`, also after a save wrote it: a photo's
   *  picture is kept for that). Refused, deleting nothing, for an id the
   *  tour no longer carries. */
  remove(id: string): { kind: "deleted" } | EditorRefusal;
  /** Place a new object (the phone places in AR; the 3D view's Add pin
   *  places one in the selected station): refused for an id the tour
   *  carries and for a spot further from its station than a tour can
   *  carry. */
  place(object: TourObject): { kind: "placed" } | EditorRefusal;
  /** Move a station's frame (D17): its items move rigidly with it.
   *  Refused for a station the tour does not carry, and for a locked one
   *  (`stationLocked`): position, height and heading alike. */
  moveStation(
    stationId: string,
    geo: QrGeoPose,
  ): { kind: "moved" } | EditorRefusal;
  /** Set a station's name, found radius (its preload radius twice it),
   *  description or card picture (`StationEdit`): one step; refused in
   *  words, changing nothing, for what the format would refuse. */
  editStation(
    stationId: string,
    edit: StationEdit,
  ): { kind: "edited" | "unchanged" } | EditorRefusal;
  /** Add an empty station at a point, named by its place in the tour. */
  addStation(at: {
    readonly lat: number;
    readonly lon: number;
    readonly alt: number;
  }): { kind: "added"; stationId: string } | EditorRefusal;
  /** Delete a station with its items: one step.
   *  Refused for the tour's last station. */
  deleteStation(stationId: string): { kind: "deleted" } | EditorRefusal;
  /** Put the stations in `order` (every station once): one step. */
  reorderStations(
    order: readonly string[],
  ): { kind: "reordered" | "unchanged" } | EditorRefusal;
  /** Copy a station beside itself with its items (a photo's picture read
   *  first, and held under the copy's id): one step. */
  duplicateStation(
    stationId: string,
  ): Promise<{ kind: "duplicated"; stationId: string } | EditorRefusal>;
  /** Copy an item 1.5 m beside itself in its station: one step. */
  duplicateObject(
    id: string,
  ): Promise<{ kind: "duplicated"; id: string } | EditorRefusal>;
  /** Set items' altitudes (the ground the page measured under them): ONE
   *  step for all; refused whole for an unknown id or a height that cannot
   *  be set. */
  groundItems(
    items: readonly { readonly id: string; readonly alt: number }[],
  ): { kind: "grounded" | "unchanged" } | EditorRefusal;
  /** Set a model's size (its largest side, 0.05 m to 500 m): one step. */
  resizeModel(
    id: string,
    sizeM: number,
  ): { kind: "resized" | "unchanged" } | EditorRefusal;
  /** Put an item at a whole pose (position, height and turn): beyond its
   *  station's radius the station rule seats it anew; `newStation` starts
   *  a station of its own where it stands. One step. */
  pose(
    id: string,
    geo: QrGeoPose,
    options?: { readonly newStation?: boolean },
  ): { kind: "moved" } | EditorRefusal;
  /** Give an item a station of its own where it stands, turned as it is
   *  ("Move to a new station"): one step; says the station it made. */
  moveToNewStation(
    id: string,
  ): { kind: "moved"; stationId: string } | EditorRefusal;
  /** Take back the newest edit (W2): the tour goes back to how it stood
   *  before it - an edit like any other, pending until saved and written
   *  to the draft. A note brought back after a save wrote its delete is
   *  not offered by a later open's draft, though (it places nothing new):
   *  that undo lasts this tab (M4a review #2). Refused while a save runs. */
  undo(): UndoOutcome;
  /** Take an undone edit again; a new edit drops what could be redone. */
  redo(): UndoOutcome;
  /** Counts every edit, undo and redo: a page holding an older offer
   *  (the delete toast's Undo) tells whether it is still the newest. */
  revision(): number;
  /** A photo's picture this session holds and the opened file may not (one
   *  an undo brought back after a save took it out), for the card. */
  pictureOf(id: string): Blob | undefined;
  /** Put a draft's work back by the session's own rules (M6 E2c): an
   *  object the tour carries gets the draft's version, a deletion its
   *  tombstone; live work on an id wins, and an id the tour no longer
   *  carries is skipped. The settings likewise: a change made here since
   *  the open wins, and an applied one counts among `changed`. What was
   *  applied is written to the draft again; it is one step to undo. */
  restore(work: EditorRestore): { changed: number; deleted: number };
  /** Build the saved zip from the newest bytes; edits made while it runs
   *  wait for the next save. Saves run one after another: one called
   *  while another runs starts when it ends (E2a review #9). */
  save(options: {
    readonly keepScan: boolean;
    /** The page writes it over the opened file (D33's resave reads where
     *  that file stands in the history). Default: a download. */
    readonly inPlace?: boolean;
  }): Promise<EditorSave>;
  /** A copy of the tour as it stands, built from the newest bytes as a
   *  save is ("Save a copy…"), queued with the saves - but not landed:
   *  the tour's own file and its pending edits stay as they were. Rejects
   *  with `TOUR_REPLACED` once another open replaced this one. */
  saveCopy(options: { readonly keepScan: boolean }): Promise<EditorSave>;
  /** The walk recording's entries in the newest bytes (W2, D19): none
   *  once it was moved out, or when the last save left it out. */
  walkEntries(): Promise<string[]>;
  /** Build the move of the walk out (`WalkMove`), queued with the saves;
   *  refused, in words, when there is no walk. Bringing a walk back is a
   *  later feature. */
  moveWalkOut(): Promise<WalkMove | EditorRefusal>;
  /** The debug data of the OPENED file as a debug bundle (M2 of the
   *  debug-captures plan: "Save the debug data" after a save
   *  that left the walk out - the newest bytes then carry none, and the
   *  move refuses), queued with the saves; refused, in words, when the
   *  opened file carries no walk. Changes nothing of the session. */
  debugData(): Promise<DebugBundleBuilt>;
  /** The tour a debug bundle saved now names, and the one an added debug
   *  data file is compared with (`bundleMatchesTour`, M2 step 5 of the
   *  debug-captures plan): a listed tour's series, the title of the newest
   *  written file (an edit not yet saved is not the file's), the file's
   *  name. */
  debugTour(): DebugBundleTour;
}

export function createEditorSession(input: {
  readonly session: TourSession;
  /** The tour as opened (`openTourForEditing`). */
  readonly manifest: TourManifest;
  readonly levels: ReadonlyMap<string, QrLevel>;
  /** The file's name for the model's title (default: the session's). */
  readonly fileName?: string;
  /** Where every edit, move, delete and undo is backed up (M6 E2c); none
   *  in a test that does not need it. */
  readonly draft?: EditorSessionDraft;
  /** Read a photo's picture by its entry (`content/<id>.jpg`) when it is
   *  deleted, so an undo after a save can bring it back (default: the
   *  opened file's; the page reads its copy of what it last wrote). */
  readonly loadPhoto?: (image: string) => Promise<Blob>;
  /** The store holding the tour document (D29): the page's own, so its
   *  views read the same state; a fresh one when absent (tests). Opening
   *  the session opens the document in it - whatever it held is gone. */
  readonly store?: TourViewerStore;
  /** Whether a station's pose is locked (the page's view state): its move,
   *  turn and lift are then refused; its radius, name, delete and copy
   *  stay open. None: nothing is locked (the phone, a test). */
  readonly stationLocked?: (stationId: string) => boolean;
}): EditorSession {
  const { session, levels } = input;
  const store: TourViewerStore = input.store ?? createTourViewerStore();
  // A tour without an id of its own is given one, once (Q-I).
  store.dispatch(
    tourDocumentActions.opened({
      manifest: input.manifest,
      newTourId: newTourId(),
    }),
  );
  /** This session's open: a later one in the same store makes every edit
   *  here refused and every save of it land nowhere. */
  const generation = doc().generation;

  // What follows is imperative resources only (root CLAUDE.md, "App state
  // lives in the Redux store"): the pictures' side table, and the saves'
  // own (the newest bytes, the queue) in the
  // document's save (`tour-document-save.ts`), whose status is the slice's.
  /** Deleted photos' pictures, for an undo after a save took them out
   *  (the side table: Blobs are never state). */
  const pictures = new Map<string, Blob>();
  /** Pictures being read: a save waits for them, so an undo right after
   *  the save that wrote a photo's delete finds its picture. */
  const pictureReads = new Set<Promise<void>>();
  const loadPhoto =
    input.loadPhoto ?? ((image: string) => session.loadContentEntry(image));
  const saves = createTourSaves({
    tour: session,
    generation,
    pictureOf: (id) => pictures.get(id),
    picturesRead: () => Promise.all(pictureReads),
  });
  /** The saved file's name: the opened one's, made safe (the Finish's rule). */
  const savedName = saves.fileName;
  /** The name the page shows when the tour has no title. */
  const shownName = input.fileName ?? savedName;

  const draft = input.draft;
  if (draft !== undefined) {
    // The draft follows the document (`tour-document-draft.ts`), after
    // each reducer - never from `store.subscribe`.
    store.listenToDocument({
      predicate: isDocumentEdit,
      effect: (_action, api) => {
        const after = selectTourDocument(api.getState());
        if (after.generation !== generation) {
          api.unsubscribe();
          return;
        }
        followDocument(
          draft,
          selectTourDocument(api.getOriginalState()),
          after,
          (id) => pictures.get(id),
        );
      },
    });
  }

  function doc(): TourDocumentState {
    return selectTourDocument(store.getState());
  }

  /** The document as this session opened it; null once another open
   *  replaced it. */
  function mine(): TourDocumentState | null {
    const state = doc();
    return state.generation === generation ? state : null;
  }

  /** The document as this session reads it: the store's while this open
   *  is the newest, else as it stood when another open replaced it - a
   *  replaced session never reads another tour (the r875 milestone review
   *  #4). */
  let last = doc();
  // Kept after every change of the document while this open is the newest
  // - an edit or a save's landing that no read of the session followed
  // included - so "as it stood when replaced" is that, not the last read
  // before it. The listener middleware runs the effect synchronously
  // after the reducer, inside the dispatch, so `last` is never behind.
  store.listenToDocument({
    predicate: (_action, after, before) =>
      selectTourDocument(after) !== selectTourDocument(before),
    effect: (_action, api) => {
      const state = selectTourDocument(api.getState());
      if (state.generation === generation) last = state;
      else api.unsubscribe();
    },
  });
  function own(): TourDocumentState {
    const state = mine();
    if (state !== null) last = state;
    return last;
  }

  /** The written tour (this session's). */
  function written(): TourManifest {
    return own().written ?? input.manifest;
  }

  /** The tour as it stands, frames and settings applied. */
  function now(): TourManifest {
    return manifestNow(own()) ?? input.manifest;
  }

  const notInTour: EditorRefusal = { kind: "refused", reason: NOT_IN_TOUR };

  /** Undefined for an id the tour no longer carries, or a tour no longer
   *  open: a page holding an older card gets a refusal, never a throw (E2c
   *  plan review #11). */
  function find(id: string): AuthoringObject | undefined {
    const state = mine();
    if (state === null) return undefined;
    return documentObjects(state).find((o) => o.object.id === id);
  }

  /** The tour's pins and photos as they stand with the edits, for what
   *  reads its images. */
  function current(): TourObject[] {
    return documentObjects(own()).map((o) => o.object);
  }

  function coverIds(state: TourDocumentState = own()): Set<string> {
    return coverImageIds(state);
  }

  /** A photo's picture: the one this session holds, else read from the
   *  page's copy of the file, failing that from this session's own last
   *  bytes - the page's copy may not read right after an in-place write.
   *  Rejects when every way fails. */
  function readPicture(object: TourPicture): Promise<Blob> {
    const held = pictures.get(object.id);
    if (held !== undefined) return Promise.resolve(held);
    const newest = saves.newest()?.blob;
    const entry = object.imageAsset.path;
    return loadPhoto(entry).catch((err: unknown) =>
      newest === undefined
        ? Promise.reject(err instanceof Error ? err : new Error(String(err)))
        : readZipBlobEntry(newest, `${session.manifestWrap}${entry}`),
    );
  }

  /** Keep a deleted photo's picture for an undo after a save. */
  function keepPicture(found: AuthoringObject): void {
    const object = found.object;
    if (!isCapturedPhoto(object)) return;
    const id = object.id;
    if (pictures.has(id)) return;
    // Read now, while the copy that carries it is at hand. A read that
    // fails every way leaves an undo after a save refused, in words.
    const read = readPicture(object)
      .then(
        (blob) => {
          pictures.set(id, blob);
        },
        () => undefined,
      )
      .finally(() => {
        pictureReads.delete(read);
      });
    pictureReads.add(read);
  }

  /** One step of the history (undo or redo); refused while a save runs,
   *  and when a photo it brings back has no picture. */
  function step(which: "undo" | "redo"): UndoOutcome {
    const state = mine();
    if (state === null) return notInTour;
    if (!canStep(state)) return { kind: "refused", reason: SAVE_RUNNING };
    const next = nextStep(state, which);
    if (next === undefined) return { kind: "nothing" };
    if (picturesNeeded(state, next.view).some((id) => !pictures.has(id))) {
      return { kind: "refused", reason: PICTURE_GONE };
    }
    store.dispatch(
      which === "undo"
        ? tourDocumentActions.undone()
        : tourDocumentActions.redone(),
    );
    return { kind: which === "undo" ? "undone" : "redone", what: next.what };
  }

  /** A draft's details put back by the dialog's own checks (a record
   *  whose details the format would drop leaves them as they are), against
   *  `state` (the draft's objects already put back: a cover may name one). */
  function restoredDetails(
    state: TourDocumentState,
    offered: TourDetailFields,
  ): TourDetailFields | null {
    const was = effectiveDetails(state);
    const checked = checkDetailsForm(
      {
        name: offered.title ?? "",
        description: offered.description ?? "",
        cover: offered.cover ?? null,
        contact: offered.contact ?? "",
      },
      coverIds(state),
      was,
      "drop",
    );
    if (!checked.ok) return null;
    return DETAIL_FIELDS.some((f) => checked.details[f] !== was[f])
      ? checked.details
      : null;
  }

  /** `edit` dispatched, and whether the document took it (a reducer that
   *  refuses returns the state it had). */
  function took(edit: () => void): boolean {
    const was = doc().revision;
    edit();
    return doc().revision !== was;
  }

  const notApplied: EditorRefusal = { kind: "refused", reason: NOT_APPLIED };
  const noSuchStation: EditorRefusal = {
    kind: "refused",
    reason: NO_SUCH_STATION,
  };

  /** The pictures of `objects`' photos, by id; null when one cannot be
   *  read (a copy without its picture would save a broken tour). */
  async function picturesOf(
    objects: readonly TourObject[],
  ): Promise<Map<string, Blob> | null> {
    const read = new Map<string, Blob>();
    for (const object of objects) {
      if (!isCapturedPhoto(object)) continue;
      try {
        read.set(object.id, await readPicture(object));
      } catch {
        return null;
      }
    }
    return read;
  }

  return {
    model() {
      return buildEditorModel({
        manifest: now(),
        objects: current(),
        levels,
        fileName: shownName,
      });
    },
    changeCount() {
      return changeCount(own());
    },
    pendingIds() {
      return unsavedEntries(own()).map((p) => p.object.id);
    },
    savedName() {
      return savedName;
    },
    needsNoGps() {
      return own().needsNoGps;
    },
    setNeedsNoGps(on) {
      const state = mine();
      if (state === null || on === state.needsNoGps) {
        return { kind: "unchanged" };
      }
      store.dispatch(
        tourDocumentActions.settingsChanged({
          needsNoGps: on,
          what: 'the "needs no GPS" setting',
        }),
      );
      return { kind: "changed" };
    },
    details() {
      const shown = effectiveDetails(own());
      return {
        name: shown.title ?? "",
        description: shown.description ?? "",
        cover: shown.cover ?? null,
        contact: shown.contact ?? "",
      };
    },
    setDetails(next) {
      const state = mine();
      if (state === null) return notInTour;
      const change = detailsChange(state, next);
      if (change.kind !== "changed") return change;
      store.dispatch(
        tourDocumentActions.detailsChanged({
          details: change.details,
          what: "the tour details",
        }),
      );
      return { kind: "changed" };
    },
    coverChoices() {
      const tour = { objects: current(), assets: written().assets };
      return [...coverIds()].flatMap((id) => {
        const image = tourCoverEntry({ ...tour, cover: id });
        return image === null ? [] : [{ id, image }];
      });
    },
    noGpsCheck() {
      return checkNoGps({ stations: now().stations, levels });
    },
    editText(id, text) {
      const state = mine();
      if (state === null) return notInTour;
      const edit = pinTextChange(state, id, text);
      if (edit.kind === "missing") return notInTour;
      if (edit.kind !== "edited") return edit;
      store.dispatch(
        tourDocumentActions.edited({
          object: edit.after,
          what: `the text of ${objectName(edit.after)}`,
        }),
      );
      return { kind: "edited" };
    },
    editBlockField(id, field, value) {
      const found = find(id);
      if (found === undefined) return notInTour;
      const edit = blockFieldEdit(found.object, field, value);
      if (edit.kind !== "edited") return edit;
      const label =
        blockFields(found.object).find((f) => f.name === field)?.label ?? field;
      store.dispatch(
        tourDocumentActions.edited({
          object: edit.after,
          what: `the ${label.toLowerCase()} of ${objectName(edit.after)}`,
        }),
      );
      return { kind: "edited" };
    },
    move(id, lat, lon) {
      const state = mine();
      if (state === null) return notInTour;
      const change = objectMoveChange(state, id, lat, lon);
      if (change.kind === "missing") return notInTour;
      store.dispatch(
        tourDocumentActions.moved({
          object: change.after,
          what: `the move of ${objectName(change.before)}`,
        }),
      );
      return { kind: "moved" };
    },
    place(object) {
      const state = mine();
      if (state === null) return notInTour;
      if (find(object.id) !== undefined) {
        return { kind: "refused", reason: ALREADY_IN_TOUR };
      }
      if (!objectFits(state, object)) {
        return { kind: "refused", reason: TOO_FAR_FROM_STATION };
      }
      store.dispatch(
        tourDocumentActions.placed({
          object,
          what: `the placement of ${objectName(object)}`,
        }),
      );
      return { kind: "placed" };
    },
    moveStation(stationId, geo) {
      const state = mine();
      const station = state?.stations.find((s) => s.id === stationId);
      if (station === undefined) {
        return { kind: "refused", reason: NO_SUCH_STATION };
      }
      // Every move, turn and lift of a station comes through here: the
      // lock holds whatever asked (a drag, a key, a later control).
      if (input.stationLocked?.(stationId) === true) {
        return { kind: "refused", reason: STATION_LOCKED };
      }
      if (!onMap(geo)) return { kind: "refused", reason: NOT_ON_MAP };
      store.dispatch(
        tourDocumentActions.stationMoved({
          stationId,
          geo,
          what: `the move of ${station.title === undefined ? "a station" : `"${station.title}"`}`,
        }),
      );
      return { kind: "moved" };
    },
    editStation(stationId, edit) {
      const state = mine();
      if (state === null) return notInTour;
      const change = stationEditChange(state, stationId, edit);
      if (change.kind === "missing") return noSuchStation;
      if (change.kind === "refused") {
        return { kind: "refused", reason: STATION_REFUSALS[change.reason] };
      }
      if (change.kind === "unchanged") return change;
      const frame = manifestNow(state)?.stations.find(
        (s) => s.id === stationId,
      );
      // The document may drop the edit (a station a delete emptied, left
      // with nothing of its own): no step was taken, so none is said.
      const applied = took(() =>
        store.dispatch(
          tourDocumentActions.stationEdited({
            stationId,
            edit,
            what: `the change of ${stationName(frame ?? {})}`,
          }),
        ),
      );
      return applied ? { kind: "edited" } : { kind: "unchanged" };
    },
    addStation(at) {
      if (mine() === null) return notInTour;
      const stationId = newObjectId();
      return took(() =>
        store.dispatch(
          tourDocumentActions.stationAdded({
            at,
            stationId,
            what: "the new station",
          }),
        ),
      )
        ? { kind: "added", stationId }
        : { kind: "refused", reason: NOT_ON_MAP };
    },
    deleteStation(stationId) {
      const state = mine();
      if (state === null) return notInTour;
      const refusal = stationDeleteRefusal(state, stationId);
      if (refusal === "missing") return noSuchStation;
      if (refusal === "last") return { kind: "refused", reason: LAST_STATION };
      for (const found of documentObjects(state)) {
        if (found.object.station === stationId) keepPicture(found);
      }
      const frame = manifestNow(state)?.stations.find(
        (s) => s.id === stationId,
      );
      return took(() =>
        store.dispatch(
          tourDocumentActions.stationDeleted({
            stationId,
            what: `the delete of ${stationName(frame ?? {})}`,
          }),
        ),
      )
        ? { kind: "deleted" }
        : notApplied;
    },
    reorderStations(order) {
      const state = mine();
      if (state === null) return notInTour;
      const ids = (manifestNow(state)?.stations ?? []).map((s) => s.id);
      if (
        order.length === ids.length &&
        order.every((id, i) => id === ids[i])
      ) {
        return { kind: "unchanged" };
      }
      return took(() =>
        store.dispatch(
          tourDocumentActions.stationsReordered({
            order,
            what: "the order of the stations",
          }),
        ),
      )
        ? { kind: "reordered" }
        : { kind: "refused", reason: NOT_AN_ORDER };
    },
    async duplicateStation(stationId) {
      const state = mine();
      if (state === null) return notInTour;
      // Any station the next write carries, as the reducer reads it.
      const frame = manifestNow(state)?.stations.find(
        (s) => s.id === stationId,
      );
      if (frame === undefined) return noSuchStation;
      const items = documentObjects(state)
        .map((o) => o.object)
        .filter((o) => o.station === stationId);
      const read = await picturesOf(items);
      if (read === null) return { kind: "refused", reason: PICTURE_UNREAD };
      // Every block of the station gets a new id, its story's too: block
      // ids are unique across the tour.
      const blockIds = new Set([
        ...items.map((o) => o.id),
        ...frame.blocks.map((b) => b.id),
      ]);
      const newItemIds = Object.fromEntries(
        [...blockIds].map((id) => [id, newObjectId()]),
      );
      const newStationId = newObjectId();
      // The pictures under the copies' ids before the copies exist: the
      // draft's write of each copy carries its picture.
      for (const [id, blob] of read) {
        const copyId = newItemIds[id];
        if (copyId !== undefined) pictures.set(copyId, blob);
      }
      if (
        took(() =>
          store.dispatch(
            tourDocumentActions.stationDuplicated({
              stationId,
              newStationId,
              newItemIds,
              what: `the copy of ${stationName(frame)}`,
            }),
          ),
        )
      ) {
        return { kind: "duplicated", stationId: newStationId };
      }
      for (const copyId of Object.values(newItemIds)) pictures.delete(copyId);
      return mine() === null ? notInTour : notApplied;
    },
    async duplicateObject(id) {
      const found = find(id);
      if (found === undefined) return notInTour;
      const read = await picturesOf([found.object]);
      if (read === null) return { kind: "refused", reason: PICTURE_UNREAD };
      const newId = newObjectId();
      const blob = read.get(id);
      if (blob !== undefined) pictures.set(newId, blob);
      if (
        took(() =>
          store.dispatch(
            tourDocumentActions.objectDuplicated({
              id,
              newId,
              what: `the copy of ${objectName(found.object)}`,
            }),
          ),
        )
      ) {
        return { kind: "duplicated", id: newId };
      }
      pictures.delete(newId);
      return find(id) === undefined
        ? notInTour
        : { kind: "refused", reason: TOO_FAR_FROM_STATION };
    },
    groundItems(items) {
      const state = mine();
      if (state === null) return notInTour;
      if (items.some(({ id }) => find(id) === undefined)) return notInTour;
      if (items.every(({ id, alt }) => find(id)?.object.geo.alt === alt)) {
        return { kind: "unchanged" };
      }
      return took(() =>
        store.dispatch(
          tourDocumentActions.itemsGrounded({
            items,
            what:
              items.length === 1
                ? "the height of an item"
                : `the heights of ${String(items.length)} items`,
          }),
        ),
      )
        ? { kind: "grounded" }
        : { kind: "refused", reason: HEIGHT_REFUSED };
    },
    resizeModel(id, sizeM) {
      const found = find(id);
      if (found === undefined) return notInTour;
      const object = found.object;
      if (object.kind !== "model") {
        return { kind: "refused", reason: NOT_A_MODEL };
      }
      if (!(sizeM >= TOUR_MODEL_MIN_SIZE_M && sizeM <= TOUR_MODEL_MAX_SIZE_M)) {
        return { kind: "refused", reason: MODEL_SIZE };
      }
      if (object.sizeM === sizeM) return { kind: "unchanged" };
      return took(() =>
        store.dispatch(
          tourDocumentActions.modelResized({
            id,
            sizeM,
            what: `the size of ${objectName(object)}`,
          }),
        ),
      )
        ? { kind: "resized" }
        : notApplied;
    },
    pose(id, geo, options = {}) {
      const found = find(id);
      if (found === undefined) return notInTour;
      if (
        ![geo.lat, geo.lon, geo.alt].every(Number.isFinite) ||
        Math.abs(geo.lat) > 90 ||
        Math.abs(geo.lon) > 180
      ) {
        return { kind: "refused", reason: NOT_ON_MAP };
      }
      store.dispatch(
        tourDocumentActions.moved({
          object: { ...found.object, geo },
          ...(options.newStation === true ? { newStation: true } : {}),
          what: `the move of ${objectName(found.object)}`,
        }),
      );
      return { kind: "moved" };
    },
    moveToNewStation(id) {
      const found = find(id);
      if (found === undefined) return notInTour;
      // Where it stands and as it is turned: only its station changes.
      store.dispatch(
        tourDocumentActions.moved({
          object: found.object,
          newStation: true,
          // Right after the station it leaves, not at the tour's end.
          afterHome: true,
          what: `the move of ${objectName(found.object)} to a new station`,
        }),
      );
      const stationId = find(id)?.object.station;
      return stationId === undefined || stationId === found.object.station
        ? notApplied
        : { kind: "moved", stationId };
    },
    remove(id) {
      const found = find(id);
      if (found === undefined) return notInTour;
      keepPicture(found);
      store.dispatch(
        tourDocumentActions.deleted({
          id,
          what: `the delete of ${objectName(found.object)}`,
        }),
      );
      return { kind: "deleted" };
    },
    undo() {
      return step("undo");
    },
    redo() {
      return step("redo");
    },
    revision() {
      return own().revision;
    },
    pictureOf(id) {
      return unsavedEntries(own()).some((p) => p.object.id === id)
        ? pictures.get(id)
        : undefined;
    },
    restore(work) {
      const state = mine();
      if (state === null) return { changed: 0, deleted: 0 };
      const live = new Set([
        ...state.placed.map((p) => p.object.id),
        ...state.deleted,
      ]);
      const settings = work.settings;
      // The draft's station poses (D17; the r875 milestone review #1) -
      // unless a frame was moved here meanwhile: live work wins. Only a
      // station the tour carries, at a pose other than its own.
      const stations = (
        settings?.stations === undefined || state.touched.stations
          ? []
          : settings.stations
      ).filter((pose) => {
        const frame = state.stations.find((s) => s.id === pose.id);
        return (
          frame !== undefined &&
          JSON.stringify(frame.geo) !== JSON.stringify(pose.geo)
        );
      });
      // An object its station cannot carry (a draft written before far
      // moves re-ran the station rule) is seated by the rule as the
      // restore puts it back (`restored`), never skipped. One the tour
      // does not carry is skipped unless the offer names it a copy made
      // here: that is put back with its picture (a photo without one is
      // not), unless deleted here since.
      const offeredPicture = (object: TourObject): Blob | undefined =>
        work.pictures?.get(object.id) ?? pictures.get(object.id);
      const madeIds = new Set(work.made ?? []);
      const made = work.objects.filter(
        (object) =>
          madeIds.has(object.id) &&
          !live.has(object.id) &&
          find(object.id) === undefined &&
          (!isCapturedPhoto(object) || offeredPicture(object) !== undefined),
      );
      const objects = [
        ...work.objects.filter(
          (object) => !live.has(object.id) && find(object.id) !== undefined,
        ),
        ...made,
      ];
      // The stations edited, added, deleted, reordered or copied there,
      // whole - unless a station was changed here meanwhile: live work
      // wins.
      const framesWork =
        settings === undefined || state.touched.stations
          ? {}
          : {
              ...(settings.frames === undefined
                ? {}
                : { frames: settings.frames }),
              ...(settings.order === undefined
                ? {}
                : { order: settings.order }),
              ...(settings.deletedStations === undefined
                ? {}
                : { deletedStations: settings.deletedStations }),
            };
      const deleted = work.deleted.filter(
        (id) => !live.has(id) && find(id) !== undefined,
      );
      // The stations the draft's objects were seated in that the tour
      // lacks (a far move started one), whole: back before the objects.
      const created = settings?.createdStations ?? [];
      // With the stations added by hand there: untitled and empty, each
      // keeps itself here as it did there.
      const handMade = settings?.handMadeStations ?? [];
      const createdStations = {
        ...(created.length === 0 ? {} : { createdStations: created }),
        ...(handMade.length === 0 ? {} : { handMadeStations: handMade }),
      };
      const needsNoGps =
        settings !== undefined &&
        !state.touched.needsNoGps &&
        settings.needsNoGps !== state.needsNoGps
          ? settings.needsNoGps
          : undefined;
      // The details against the tour with the draft's objects back: a
      // cover may name a photo they bring.
      const withObjects = tourDocumentReducer(
        state,
        tourDocumentActions.restored({
          objects,
          deleted,
          ...(stations.length === 0 ? {} : { stations }),
          ...createdStations,
          ...framesWork,
          what: "",
        }),
      );
      const details =
        settings?.details === undefined || state.touched.details
          ? null
          : restoredDetails(withObjects, settings.details);
      const was = effectiveDetails(withObjects);
      const detailFields =
        details === null
          ? 0
          : DETAIL_FIELDS.filter((f) => details[f] !== was[f]).length;
      const changed =
        objects.length +
        stations.length +
        stationEditsBetween(state, withObjects) +
        (needsNoGps === undefined ? 0 : 1) +
        detailFields;
      if (changed + deleted.length > 0) {
        // The copies' pictures first: the draft's write of each restored
        // copy carries its picture, and a save needs it.
        for (const object of made) {
          const blob = offeredPicture(object);
          if (blob !== undefined) pictures.set(object.id, blob);
        }
        store.dispatch(
          tourDocumentActions.restored({
            objects,
            deleted,
            ...(needsNoGps === undefined ? {} : { needsNoGps }),
            ...(details === null ? {} : { details }),
            ...(stations.length === 0 ? {} : { stations }),
            ...createdStations,
            ...framesWork,
            what: "the restored changes",
          }),
        );
      }
      return { changed, deleted: deleted.length };
    },
    save(options) {
      // The document's save (`tour-document-save.ts`): a thunk, queued with
      // the moves of the walk.
      return dispatchThunk(store, saves.save(options)).then(saveOf);
    },
    saveCopy(options) {
      return dispatchThunk(
        store,
        saves.queued(async () => {
          if (mine() === null) throw new Error(TOUR_REPLACED);
          const snap = dispatchThunk(store, saves.snapshot());
          await saves.picturesRead();
          const copy = saveOf(await saves.rebuild(snap, options.keepScan));
          return { ...copy, filename: copyFileName(copy.filename) };
        }),
      );
    },
    async walkEntries() {
      return scanEntryNames(
        await newestNames(),
        written(),
        session.manifestWrap,
      );
    },
    moveWalkOut() {
      return dispatchThunk(store, saves.queued(buildWalkMove));
    },
    debugTour() {
      // Compared by the id the opened file itself carries: the one its
      // open minted is in no file until a save writes it, and a bundle
      // naming that id was saved from such a copy, which the names still
      // match (a reopened original would otherwise call it another's).
      return debugTourOf(written(), input.manifest.tourId);
    },
    debugData() {
      return dispatchThunk(
        store,
        saves.queued(async (): Promise<DebugBundleBuilt> => {
          if (mine() === null)
            return { kind: "refused", reason: TOUR_REPLACED };
          // The opened file is untrusted: read under the session's budget.
          return buildDebugBundle(
            await session.readWholeArchive(),
            debugTourOf(written(), written().tourId),
            { budget: session.budget },
          );
        }),
      );
    },
  };

  /** The newest bytes' entry names: the last save's, else the opened
   *  file's. */
  async function newestNames(): Promise<string[]> {
    const newest = saves.newest();
    return newest === null
      ? session.entries.map((e) => e.filename)
      : zipBlobEntryNames(newest.blob);
  }

  function saveOf(finished: FinishedTour): EditorSave {
    return {
      blob: finished.blob,
      filename: savedName,
      scanLeftOut: finished.scanLeftOut,
      written: finished.written,
    };
  }

  /** The tour a debug bundle names (`debug-bundle.json`): a listed
   *  tour's series, `tourId`, the title the tour carries now and the
   *  file's name. */
  function debugTourOf(
    manifest: TourManifest,
    tourId: string | undefined,
  ): DebugBundleTour {
    return {
      seriesId:
        session.integrity.kind === "listed"
          ? session.integrity.manifest.seriesId
          : null,
      ...(tourId === undefined ? {} : { tourId }),
      title: manifest.title,
      fileName: savedName,
    };
  }

  /** The move of the walk out (D19), built from the newest bytes. */
  async function buildWalkMove(): Promise<WalkMove | EditorRefusal> {
    if (mine() === null) return { kind: "refused", reason: TOUR_REPLACED };
    const snap = dispatchThunk(store, saves.snapshot());
    const base = saves.newest();
    const wrap = session.manifestWrap;
    const names = await newestNames();
    if (scanEntryNames(names, snap.manifest, wrap).length === 0) {
      return { kind: "refused", reason: NO_WALK };
    }
    // The rebuild below replaces the bytes a picture may be read from.
    await saves.picturesRead();
    // The debug bundle is the whole recording (the M4b milestone review
    // #8), so it is a complete recording on its own, and names the tour it
    // came from (one format for both pages, M2 of the debug-captures plan).
    const source = base === null ? await session.readWholeArchive() : base.blob;
    const bundle = await buildDebugBundle(
      source,
      debugTourOf(snap.manifest, snap.manifest.tourId),
      {
        // The opened file is untrusted: read under the session's budget, as
        // the rebuild below reads it (K0 milestone review R1).
        ...(base === null ? { budget: session.budget } : {}),
      },
    );
    if (bundle.kind === "refused") {
      return { kind: "refused", reason: bundle.reason };
    }
    // From the same bytes, read once (review #11).
    const finished = await saves.rebuild(
      snap,
      false,
      base === null ? source : undefined,
    );
    return {
      kind: "ready",
      walk: { blob: bundle.blob, filename: bundle.filename },
      save: saveOf(finished),
      current: () => saves.newest() === base,
      commit(inPlace) {
        if (saves.newest() !== base) {
          throw new Error(
            "another save landed while the walk was moved out - move it again",
          );
        }
        dispatchThunk(store, saves.land(finished, snap, inPlace));
      },
    };
  }
}
