/**
 * The tour as the creator edits it (D29-D31, the shared state foundation):
 * ONE Redux slice for the open tour's document, shared by every page that
 * edits a tour - the desktop editor today, the phone's creator next. It
 * holds the tour as opened and as last written, the edits not yet written
 * (objects placed, edited, moved or deleted; station frames moved), the
 * tour-level settings and details, an undo history over the WHOLE document
 * and the save status. Its reducers are the shared pure rules
 * (`object-edits.ts`, `finish-rebuild.ts`, `tour-content.ts`); what a write
 * carries is `finishedManifest`, the Finish's own rule, so a selector and a
 * rebuild can never disagree. Blobs (a photo's picture) are never state:
 * the page keeps them in a side table keyed by id.
 *
 * It also holds the tour's codes (`codes`, debug-captures plan M3a): the
 * code book (`code-book.ts`, whose rules only its reducers apply) and the
 * hosted level texts it is judged against, held per open.
 *
 * @see tour-document.ts.md
 */

import {
  createSlice,
  current,
  isAnyOf,
  type Draft,
  type PayloadAction,
} from "@reduxjs/toolkit";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import { TOUR_ID_PATTERN } from "gps-plus-slam-app-framework/ar/tour-archive";
import {
  checkTourDescription,
  checkTourTitle,
  TOUR_TITLE_MAX_CHARS,
  tourImageIds,
} from "gps-plus-slam-app-framework/ar/tour-details";
import {
  TOUR_ITEM_MAX_OFFSET_M,
  TOUR_MODEL_MAX_SIZE_M,
  TOUR_MODEL_MIN_SIZE_M,
} from "gps-plus-slam-app-framework/ar/tour-items";
import type {
  TourManifest,
  TourObject,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  itemGeoPose,
  localPoseOf,
  tourObjects,
} from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { hostedObjects, objectContentKey } from "./authoring-draft.js";
import {
  afterFinish,
  codesNotHosted,
  codesToWrite,
  liveText,
  withDraft,
  withHand,
  withHosted,
  withMeasurement,
  withoutMeasurement,
  withReference,
  withSaved,
  type CodeBook,
  type LevelText,
  type TourCode,
} from "./code-book.js";
import { newObjectId } from "./content-placement.js";
import { finishedManifest, pendingAfterRebuild } from "./finish-rebuild.js";
import { keepsHomeDistance } from "./keeps-home.js";
import { horizontalM } from "./move-with-code.js";
import { stationHolding, type StationPoint } from "./station-assign.js";
import {
  duplicateItemGeo,
  duplicateStationGeo,
  isStationRadius,
  preloadRadiusM,
  rigidlyMoved,
} from "./station-geometry.js";
import {
  authoringObjects,
  deleteObject,
  moveObjectTo,
  pinTextEdit,
  upsertPlaced,
  type AuthoringObject,
  type EditEntry,
} from "./object-edits.js";
import {
  checkDetailsForm,
  DETAIL_FIELDS,
  detailsOf,
  withDetails,
  type DetailsForm,
  type TourDetailFields,
} from "./tour-details-form.js";
import {
  automaticStationFrame,
  imageAssetIds,
  keepsItself,
  objectAssetIds,
  routedTo,
  stepAssetIds,
  withoutRoutesTo,
} from "./tour-content.js";
import { sameJson } from "./same-json.js";
import type { CodeMeasurement } from "./visit-settle.js";

export type { LevelText } from "./code-book.js";

/** A station without its items: what the document edits of a station
 *  (its pose, D17); the items stay with the written tour. */
export type StationFrame = Omit<TourStation, "items">;

/** A station's pose: what a draft keeps of a frame moved here (D17), so
 *  a reload puts the station back with its items (the r875 milestone
 *  review #1). */
export interface StationPose {
  readonly id: string;
  readonly geo: QrGeoPose;
}

/** The tour as an undo step finds it: the station frames, the objects in
 *  the world, the setting and the details. A step goes BACK to such a
 *  state, whatever was saved since: what differs from the written file is
 *  pending again. */
export interface TourDocumentView {
  readonly stations: readonly StationFrame[];
  readonly objects: readonly TourObject[];
  readonly needsNoGps: boolean;
  readonly details: TourDetailFields;
  /** The written stations deleted at this step (`deletedStations`);
   *  absent for none. */
  readonly deletedStations?: readonly string[];
}

/** A code's saved text a step sets (plan M3b): `to`, while the code still
 *  holds `from` - the codes take no step of their own, so a code changed
 *  since is newer work than the step, and the step leaves it. */
interface StepCode {
  readonly id: string;
  readonly from: string | null;
  readonly to: string | null;
}

/** One step of the history: the view to go back (or forward) to, and the
 *  edit in words ("the move of "Fountain""); `codes`, the saved texts it
 *  sets (a settle's improved codes, plan M3b, Q-D). */
interface TourHistoryStep {
  readonly view: TourDocumentView;
  readonly what: string;
  readonly codes?: readonly StepCode[];
}

/** One change of a settle (`settleApplied`, plan M3b), in the settle's own
 *  order - the station rule reads the frames as they stand when an object
 *  moves: a station's frame moved, its items rigidly with it (as
 *  `stationMoved`), or an object moved (as `moved`; a station it starts
 *  takes `newStationId`). */
export type SettleChange =
  | {
      readonly kind: "station";
      readonly stationId: string;
      readonly geo: QrGeoPose;
    }
  | {
      readonly kind: "object";
      readonly object: TourObject;
      readonly newStationId: string;
    };

/** Who holds a page's one save slot: an explicit Save, the autosave, a
 *  step of the walk's move, or "Save a copy…" (a second file, never the
 *  tour's own: it takes neither a due resave nor the last error on). */
export type TourSaveHolder = "explicit" | "auto" | "walk" | "copy";

/** The save status (what used to be a page's module-scope save flags). */
export interface TourSaveStatus {
  /** idle; saving (the page's save slot is held, or a rebuild is queued
   *  or runs); error (the last save failed, `error` says why). */
  readonly status: "idle" | "saving" | "error";
  readonly error: string | null;
  /** Who holds the page's save slot; null while nobody does. */
  readonly by: TourSaveHolder | null;
  /** Rebuilds queued or running, one after another: an undo waits for
   *  them (the step is measured against the file they write). */
  readonly rebuilds: number;
  /** An explicit Save was asked for while the autosave ran: it runs next. */
  readonly queued: boolean;
  /** A save of this tour was built: the next rebuild starts from the
   *  page's own copy, whatever happens to the opened file. */
  readonly built: boolean;
  /** Where the last save arrived (in place, or downloaded), under which
   *  name; null while nothing was saved. */
  readonly delivered: {
    readonly inPlace: boolean;
    readonly name: string;
  } | null;
  /** The opened file is above the autosave cap: saved when Save is
   *  pressed. */
  readonly largeTour: boolean;
  /** The opened file no longer reads and nothing was built: Save cannot
   *  work here. */
  readonly cannotSave: boolean;
  /** Where the file last written IN PLACE stands in the history (D33): the
   *  `position` of the view it holds; `elsewhere` once a new edit dropped
   *  that view (it was undone, and is no longer on the history); null
   *  while no in-place write of this open arrived, and after a download.
   *  Named only once the write ARRIVED (`saveDelivered`): a write that was
   *  refused or failed leaves the view the disk still holds. */
  readonly inPlaceAt: number | "elsewhere" | null;
  /** The view the last in-place build holds, named when it was built
   *  (`saved`) until its write arrives (it then becomes `inPlaceAt`) or
   *  the next build replaces it. It outlives a write that failed: "tap
   *  Save again" re-delivers that same build, and its arrival names it. A
   *  step taken while a save holds the slot is measured against it as well
   *  as against `inPlaceAt` (the disk holds one of the two once the write
   *  ends); with the slot free the disk holds `inPlaceAt`, and it counts
   *  for nothing. */
  readonly inPlaceWriting: number | "elsewhere" | null;
  /** An undo or a redo crossed the in-place file (`stepCrossesInPlaceSave`)
   *  and no save was claimed since: the page writes the file again as soon
   *  as no save runs (D33). */
  readonly resave: boolean;
}

export interface TourDocumentState {
  /** Counts the opens: a page's late answer (a save of a tour closed
   *  meanwhile) checks it before it lands anything. */
  readonly generation: number;
  /** The tour as opened; null before any open. */
  readonly opened: TourManifest | null;
  /** The tour as last written (the opened one until a save landed). */
  readonly written: TourManifest | null;
  /** The station frames as they stand (the written ones, moved). */
  readonly stations: readonly StationFrame[];
  /** Objects placed, edited or moved and not yet in the written file -
   *  by content: one edited back to the file's own is no change. */
  readonly placed: readonly EditEntry[];
  /** Ids of the written file's objects deleted and not yet written. */
  readonly deleted: readonly string[];
  readonly needsNoGps: boolean;
  /** The details as set; the cover is shown and written only while its
   *  image is in the tour (`effectiveDetails`). */
  readonly details: TourDetailFields;
  /** Changed here since the open: live work, which a draft's offer never
   *  overrides. */
  readonly touched: {
    readonly needsNoGps: boolean;
    readonly details: boolean;
    /** A station's frame moved here since the open. */
    readonly stations: boolean;
  };
  /** The draft's settings record carries the details (once they were set
   *  or restored here: an untouched record has no opinion about them). */
  readonly detailsRecorded: boolean;
  /** The draft's settings record carries the station poses (once a frame
   *  was moved or restored here). */
  readonly stationsRecorded: boolean;
  /** The draft's settings record carries the stations WHOLE - every frame
   *  in its order, and the deleted ones (once a station was edited,
   *  added, deleted, reordered or duplicated here, or restored so). */
  readonly framesRecorded: boolean;
  /** Written stations a station's delete removed: they no longer follow
   *  the frames (`withFrames`), though a bare one would. Kept until a
   *  write leaves them out. */
  readonly deletedStations: readonly string[];
  /** The stations the creator added by hand since the open ("+" and "New
   *  station here", `stationAdded`): each keeps itself as a title would
   *  (`keptBare`, `withoutEmptied`), so an untitled one with nothing in it
   *  is written and comes back from a draft. Only grows while the tour is
   *  open (an id whose frame an undo took away keeps nothing); no step of
   *  the history, gone with the tour. */
  readonly handMade: readonly string[];
  readonly past: readonly TourHistoryStep[];
  readonly future: readonly TourHistoryStep[];
  /** Counts every edit, undo and redo. */
  readonly revision: number;
  /** Where the document stands in its history: 0 at the open, + 1 for an
   *  edit or a redo, - 1 for an undo. Absolute - the history's bound drops
   *  old steps, never renumbers them - so a save names the view it wrote
   *  (`save.inPlaceAt`). */
  readonly position: number;
  readonly save: TourSaveStatus;
  /** The phone's "New station here" is armed: the next placed item
   *  starts its own station.
   *  An authoring flag of the page, not of the tour - no edit, no undo
   *  step, no draft write; gone with the tour (`opened`, `closed`). */
  readonly newStationArmed: boolean;
  /** The tour's codes and the hosted texts they are judged against
   *  (debug-captures plan M3a): no history step and no draft write, and
   *  not reset by `opened` or `closed` - the levels and `tour.json` are
   *  read concurrently, so either may land first. Their own actions write
   *  them; the book goes at a tour's close (`codesForgotten`). */
  readonly codes: DocumentCodes;
}

/** How many steps are kept: enough for a working session, bounded. */
export const TOUR_HISTORY_LIMIT = 200;

const IDLE: TourSaveStatus = {
  status: "idle",
  error: null,
  by: null,
  rebuilds: 0,
  queued: false,
  built: false,
  delivered: null,
  largeTour: false,
  cannotSave: false,
  inPlaceAt: null,
  inPlaceWriting: null,
  resave: false,
};

/** `save` with `next` applied and its status following: saving while the
 *  slot is held or a rebuild runs, else error while one is said, else idle. */
function saveWith(
  save: TourSaveStatus,
  next: Partial<TourSaveStatus>,
): TourSaveStatus {
  const merged = { ...save, ...next };
  const status =
    merged.by !== null || merged.rebuilds > 0
      ? "saving"
      : merged.error === null
        ? "idle"
        : "error";
  return { ...merged, status };
}

// --- the codes (debug-captures plan M3a) -----------------------------------

/** One parsed level of the open tour, by id. */
interface ParsedLevel {
  readonly id: string;
  readonly level: QrLevel;
}

/** The open tour's level files as its zip holds them, for one open. */
interface HostedLevels {
  /** The open they belong to (the page's open counter): an answer of an
   *  older open is dropped, a newer open's replaces them. */
  readonly session: number;
  /** Each level's file text by id, in the zip's order, parseable or not;
   *  null until they arrived, and after their read failed. */
  readonly texts: readonly LevelText[] | null;
  /** The levels that parsed, in the zip's order (plan M3b): the viewer's
   *  level source, the numbering's order and the hosted poses the codes
   *  read; null until they arrived. Their own action (`levelsParsed`): the
   *  parse and the texts are two answers of one read. */
  readonly parsed: readonly ParsedLevel[] | null;
  /** Their read failed: they never come for this open. Every saved code
   *  then counts as one to write and one the draft keeps (there is no
   *  hosted text to compare with). */
  readonly unreadable: boolean;
}

/** The codes of the tour the creator edits (`code-book.ts`'s book) and the
 *  hosted texts they are judged against. */
interface DocumentCodes {
  /** Every code this page took, in the order it took them: its saved
   *  text, its hosted text from the first Finish on, its measurement in
   *  this page, and what this page's last Finish wrote. */
  readonly book: readonly TourCode[];
  readonly hosted: HostedLevels;
}

const NO_HOSTED: Omit<HostedLevels, "session"> = {
  texts: null,
  parsed: null,
  unreadable: false,
};

const NO_CODES: DocumentCodes = {
  book: [],
  hosted: { session: 0, ...NO_HOSTED },
};

/** The book as a map, one per array (the state is immutable, so a book
 *  array is built into a map once however often it is read). */
const bookMaps = new WeakMap<readonly TourCode[], CodeBook>();
function bookOf(codes: DocumentCodes): CodeBook {
  let book = bookMaps.get(codes.book);
  if (book === undefined) {
    book = new Map(codes.book.map((c) => [c.levelId, c]));
    bookMaps.set(codes.book, book);
  }
  return book;
}

const hostedMaps = new WeakMap<
  readonly LevelText[],
  ReadonlyMap<string, string>
>();

/** The open tour's level texts by id as they arrived; null before they
 *  arrived and when their read failed. The same map until they change. */
export function hostedLevelTexts(
  state: TourDocumentState,
): ReadonlyMap<string, string> | null {
  const texts = state.codes.hosted.texts;
  if (texts === null) return null;
  let map = hostedMaps.get(texts);
  if (map === undefined) {
    map = new Map(texts.map((l) => [l.id, l.json]));
    hostedMaps.set(texts, map);
  }
  return map;
}

const parsedMaps = new WeakMap<
  readonly ParsedLevel[],
  ReadonlyMap<string, QrLevel>
>();

/** The open tour's parsed levels by id, in the zip's order; null before
 *  they arrived. The same map until they change. */
export function hostedLevels(
  state: TourDocumentState,
): ReadonlyMap<string, QrLevel> | null {
  const parsed = state.codes.hosted.parsed;
  if (parsed === null) return null;
  let map = parsedMaps.get(parsed);
  if (map === undefined) {
    map = new Map(parsed.map((l) => [l.id, l.level]));
    parsedMaps.set(parsed, map);
  }
  return map;
}

/** The open tour's levels could not be read: they never come. */
export function hostedLevelsUnreadable(state: TourDocumentState): boolean {
  return state.codes.hosted.unreadable;
}

/** Every code this page took, in the order it took them. */
export function documentCodes(state: TourDocumentState): readonly TourCode[] {
  return state.codes.book;
}

/** The book's saved level text for `levelId` (what the next Finish
 *  writes); null when the book does not hold the code. */
export function codeSavedText(
  state: TourDocumentState,
  levelId: string,
): string | null {
  return bookOf(state.codes).get(levelId)?.saved ?? null;
}

/** The code's saved text when this page changed it live (`liveText`),
 *  judged against the hosted texts as they stand; null otherwise. */
export function codeLiveText(
  state: TourDocumentState,
  levelId: string,
): string | null {
  return liveText(
    bookOf(state.codes),
    levelId,
    hostedLevelTexts(state) ?? undefined,
  );
}

/** The book with the hosted texts filled in (the Finish's baseline). */
function withHostedTexts(state: TourDocumentState): CodeBook {
  return withHosted(bookOf(state.codes), hostedLevelTexts(state) ?? new Map());
}

/** The codes a Finish writes now: every code whose saved text differs from
 *  what the zip it rebuilds from holds (the last Finish's text, else the
 *  hosted one), in the order they were taken. */
export function levelsToWrite(state: TourDocumentState): LevelText[] {
  return codesToWrite(withHostedTexts(state));
}

/** The codes the draft keeps: every code whose saved text the HOSTED zip
 *  does not hold yet, a Finish's among them. */
export function levelsNotHosted(state: TourDocumentState): LevelText[] {
  return codesNotHosted(withHostedTexts(state));
}

/** `before` with the codes' book changed to `book`, the code in hand's
 *  text winning for its own code (`withHand`). */
function withBook(
  before: TourDocumentState,
  book: CodeBook,
  hand: LevelText | null,
): TourDocumentState {
  return {
    ...before,
    codes: { ...before.codes, book: [...withHand(book, hand).values()] },
  };
}

/** `before` with the hosted levels of `session` changed by `change`,
 *  unless they are an older open's: a newer open starts from none, the
 *  same open keeps what `change` does not name. */
function withHostedLevels(
  before: TourDocumentState,
  session: number,
  change: Partial<Omit<HostedLevels, "session">>,
): TourDocumentState {
  const was = before.codes.hosted;
  if (session < was.session) return before;
  const base = session === was.session ? was : { ...NO_HOSTED, session };
  return {
    ...before,
    codes: { ...before.codes, hosted: { ...base, ...change, session } },
  };
}

export const initialTourDocumentState: TourDocumentState = {
  generation: 0,
  opened: null,
  written: null,
  stations: [],
  placed: [],
  deleted: [],
  needsNoGps: false,
  details: {},
  touched: { needsNoGps: false, details: false, stations: false },
  detailsRecorded: false,
  stationsRecorded: false,
  framesRecorded: false,
  deletedStations: [],
  handMade: [],
  past: [],
  future: [],
  revision: 0,
  position: 0,
  save: IDLE,
  newStationArmed: false,
  codes: NO_CODES,
};

// --- the pure rules ---------------------------------------------------------

/** A manifest's stations without their items. */
export function framesOf(manifest: TourManifest): StationFrame[] {
  return manifest.stations.map(({ items: _items, ...frame }) => frame);
}

/** The frames of the stations this page created (the station rule, "New
 *  station here"): the document's frames the tour as OPENED lacks. What a
 *  draft keeps whole, so a reload brings a pin's station back with it. */
export function createdStationFrames(state: TourDocumentState): StationFrame[] {
  const opened = new Set((state.opened?.stations ?? []).map((s) => s.id));
  return state.stations.filter((f) => !opened.has(f.id));
}

/** Every station the next write carries, whole and in its order, as the
 *  document holds it (a card image whose picture is gone included: it
 *  comes back with the picture): what a draft's record is cut from once
 *  the stations were edited beyond a pose (`recordedFrames`,
 *  `recordedOrder`). */
export function documentFrames(state: TourDocumentState): StationFrame[] {
  const base = manifestNow(state);
  if (base === null) return [];
  const carried = new Set(base.stations.map((s) => s.id));
  return allFrames(state).filter((f) => carried.has(f.id));
}

/** Whether two frames are alike in every field but their pose, whatever
 *  order a writer built their keys in (`sameJson`): no edit beyond a move
 *  tells them apart. */
export function sameBeyondPose(a: StationFrame, b: StationFrame): boolean {
  return sameJson({ ...a, geo: null }, { ...b, geo: null });
}

/** The tours a draft's record is read against on a reload: the one opened
 *  here (a download leaves it on disk), and the one last written over it
 *  in place. */
function filesOf(state: TourDocumentState): TourManifest[] {
  return [state.opened, state.written].filter((m) => m !== null);
}

/**
 * The frames a draft records once the stations were edited beyond a pose
 * (`framesRecorded`): those of `documentFrames` that the tour as opened or
 * as last written lacks (added or copied here), or carries otherwise beyond
 * its pose (edited here). A frame alike in both is no edit of this page's,
 * so a restore over a file changed elsewhere keeps that file's version of
 * it - and a pose is the poses' record's to bring back (`stationsRecorded`).
 */
export function recordedFrames(state: TourDocumentState): StationFrame[] {
  const files = filesOf(state).map(
    (m) => new Map(framesOf(m).map((f) => [f.id, f])),
  );
  return documentFrames(state).filter((frame) =>
    files.some((file) => {
      const there = file.get(frame.id);
      return there === undefined || !sameBeyondPose(frame, there);
    }),
  );
}

/**
 * The stations' order a draft records with the frames: every id of
 * `documentFrames` in its order, when a restore without it would order them
 * otherwise over the tour as opened or as last written - that tour's
 * stations in their order, then the ones it lacks in the document's - and
 * undefined when it would not (a delete or an edit alone orders nothing).
 */
export function recordedOrder(state: TourDocumentState): string[] | undefined {
  const ids = documentFrames(state).map((f) => f.id);
  const kept = new Set(ids);
  const needed = filesOf(state).some((file) => {
    const fileIds = file.stations.map((s) => s.id);
    const inFile = new Set(fileIds);
    const unordered = [
      ...fileIds.filter((id) => kept.has(id)),
      ...ids.filter((id) => !inFile.has(id)),
    ];
    return unordered.some((id, i) => id !== ids[i]);
  });
  return needed ? ids : undefined;
}

/**
 * The stations of the tour as opened or last written that the next write
 * no longer carries: deleted here, or dropped - except one a write dropped
 * as an emptied automatic station (bare, no `keepsItself`, holding items
 * in every file that carries it, and no station's delete pending for it):
 * it follows its items, as it does while the document holds their deletes
 * unwritten, so it is no station deleted.
 */
export function stationsGoneSinceOpen(state: TourDocumentState): string[] {
  const carried = new Set(
    (manifestNow(state)?.stations ?? []).map((s) => s.id),
  );
  const listed = new Set<string>();
  for (const file of filesOf(state)) {
    const imageAssets = imageAssetIds(file.assets);
    for (const station of file.stations) {
      if (carried.has(station.id)) continue;
      if (
        state.deletedStations.includes(station.id) ||
        station.items.length === 0 ||
        keepsItself(station, imageAssets)
      ) {
        listed.add(station.id);
      }
    }
  }
  return [...listed];
}

/**
 * `written` with the document's station frames: each frame carries the
 * written items of its station (none for a station the file lacks); a
 * frame the file lacks is kept only while an edit names it (a station a
 * placement started, or an undo brought back an object whose emptied
 * station a save dropped - it comes back where it stood), it carries the
 * creator's own work (`keepsItself`: a station added or duplicated here),
 * or it is one of `keptBare` (`bareEmptyStations` of the tour as opened:
 * a station with nothing of its own and no items, whose delete a save
 * wrote, comes back with an undo of that delete; or one added by hand,
 * `handMade`). A written station no frame names follows unless a
 * station's delete removed it (`deletedStations`): a bare one always (an
 * automatic one a save added after the step went back, or one its items
 * left: its items keep their home, and a write prunes it once they are
 * gone), one that keeps itself (or was added by hand) only while an
 * object of the document still stands in it - so one added, saved and
 * undone is gone rather than kept by its own title.
 */
function withFrames(
  written: TourManifest,
  frames: readonly StationFrame[],
  placed: readonly EditEntry[],
  deleted: readonly string[] = [],
  deletedStations: readonly string[] = [],
  keptBare: KeptStations = NONE_KEPT,
): TourManifest {
  const byId = new Map(written.stations.map((s) => [s.id, s]));
  const named = new Set(placed.map((p) => p.object.station));
  const listed = new Set([...frames.map((f) => f.id), ...deletedStations]);
  const gone = new Set(deleted);
  // A delete prunes the routes of the stations it lists; one that follows
  // unlisted loses its routes to a deleted station here.
  const removed = new Set(deletedStations);
  const movedTo = new Map(placed.map((p) => [p.object.id, p.object.station]));
  /** An object of the document stands in `station`: an entry names it, or
   *  one of its written items is neither deleted nor put elsewhere. */
  const inUse = (station: TourStation): boolean =>
    named.has(station.id) ||
    station.items.some(
      (item) =>
        !gone.has(item.id) &&
        (movedTo.get(item.id) ?? station.id) === station.id,
    );
  const imageAssets = imageAssetIds(written.assets);
  return {
    ...written,
    stations: [
      ...frames.flatMap((frame) => {
        const own = byId.get(frame.id);
        if (
          own === undefined &&
          !named.has(frame.id) &&
          !keepsItself(frame, imageAssets) &&
          !keptBare.bare.has(frame.id) &&
          !keptBare.handMade.has(frame.id)
        ) {
          return [];
        }
        return [{ ...frame, items: own?.items ?? [] }];
      }),
      ...written.stations
        .filter(
          (s) =>
            !listed.has(s.id) &&
            (inUse(s) ||
              !(keepsItself(s, imageAssets) || keptBare.handMade.has(s.id))),
        )
        .map((s) => ({ ...withoutRoutesTo(s, removed), items: s.items })),
    ],
  };
}

/** The stations of `manifest` with nothing of their own and no items:
 *  nothing else keeps one in the frames once a write left it out. */
function bareEmptyStations(manifest: TourManifest | null): Set<string> {
  if (manifest === null) return new Set();
  const imageAssets = imageAssetIds(manifest.assets);
  return new Set(
    manifest.stations
      .filter((s) => s.items.length === 0 && !keepsItself(s, imageAssets))
      .map((s) => s.id),
  );
}

/** The stations `withFrames` keeps though nothing names them: the bare
 *  empty ones of the tour as opened (`bareEmptyStations`), and those added
 *  by hand here (`handMade`), which keep themselves as a title would. */
interface KeptStations {
  readonly bare: ReadonlySet<string>;
  readonly handMade: ReadonlySet<string>;
}

const NONE_KEPT: KeptStations = { bare: new Set(), handMade: new Set() };

function keptStationsOf(state: TourDocumentState): KeptStations {
  return {
    bare: bareEmptyStations(state.opened),
    handMade: new Set(state.handMade),
  };
}

/** `manifest` with the "needs no GPS" flag set, or without the field:
 *  false is never written (`tour-manifest.ts`). */
function withNeedsNoGps(manifest: TourManifest, on: boolean): TourManifest {
  if (on) return { ...manifest, needsNoGps: true };
  const off = { ...manifest };
  delete off.needsNoGps;
  return off;
}

/** The written tour with the document's frames: the frame of reference the
 *  objects stand in now. */
function framed(state: TourDocumentState): TourManifest | null {
  return state.written === null
    ? null
    : withFrames(
        state.written,
        state.stations,
        state.placed,
        state.deleted,
        state.deletedStations,
        keptStationsOf(state),
      );
}

/** The tour's objects now, each with this page's entry for it. `hosted`
 *  is whether the written FILE holds the object, not the framed tour: one
 *  moved out of a station that was then deleted is still in the file (in
 *  the station's written items), so its delete needs a tombstone - the
 *  draft and the rebuild know a delete by its tombstone alone. */
export function documentObjects(state: TourDocumentState): AuthoringObject[] {
  const base = framed(state);
  if (base === null || state.written === null) return [];
  const inFile = new Set(tourObjects(state.written).map((o) => o.id));
  return authoringObjects(tourObjects(base), state.placed, state.deleted).map(
    (o) => (o.hosted || !inFile.has(o.object.id) ? o : { ...o, hosted: true }),
  );
}

/** The details as shown and written: a cover whose image is gone (a
 *  deleted photo) is none, and comes back with an undo of the delete. */
export function effectiveDetails(state: TourDocumentState): TourDetailFields {
  const { details } = state;
  if (details.cover === undefined) return details;
  if (coverImageIds(state).has(details.cover)) return details;
  const { cover: _gone, ...rest } = details;
  return rest;
}

/** The images the tour may show as its cover: its photos as they stand
 *  with the edits, and its image assets. */
export function coverImageIds(state: TourDocumentState): Set<string> {
  return tourImageIds({
    objects: documentObjects(state).map((o) => o.object),
    assets: state.written?.assets ?? [],
  });
}

/** What a details form would change, by the format's rules
 *  (`checkDetailsForm`, as both pages check it): the details to dispatch
 *  (`detailsChanged`), nothing, or why not in plain words. */
export function detailsChange(
  state: TourDocumentState,
  form: DetailsForm,
):
  | { readonly kind: "changed"; readonly details: TourDetailFields }
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused"; readonly reason: string } {
  const was = effectiveDetails(state);
  const checked = checkDetailsForm(form, coverImageIds(state), was);
  if (!checked.ok) return { kind: "refused", reason: checked.reason };
  if (DETAIL_FIELDS.every((f) => checked.details[f] === was[f])) {
    return { kind: "unchanged" };
  }
  return { kind: "changed", details: checked.details };
}

/** What a pin's new text would change, by the rule both pages share
 *  (`pinTextEdit`: trimmed, never empty): the object to dispatch
 *  (`edited`), nothing (the same text, or not a pin), why not in plain
 *  words, or `missing` for an id the tour does not carry. */
export function pinTextChange(
  state: TourDocumentState,
  id: string,
  text: string,
):
  | { readonly kind: "edited"; readonly after: TourObject }
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "missing" } {
  const found = documentObjects(state).find((o) => o.object.id === id);
  if (found === undefined) return { kind: "missing" };
  return pinTextEdit(found.object, text);
}

/** What a move of an object to `lat`/`lon` on the map would change
 *  (`moveObjectTo`: its height and facing kept): the object before and
 *  after (`moved`, to dispatch), or `missing` for an id the tour does not
 *  carry. No move is too far: one beyond its station's found radius
 *  re-runs the station rule (`moved`). Throws for a position nobody can
 *  draw, as `moveObjectTo` does. */
export function objectMoveChange(
  state: TourDocumentState,
  id: string,
  lat: number,
  lon: number,
):
  | {
      readonly kind: "moved";
      readonly before: TourObject;
      readonly after: TourObject;
    }
  | { readonly kind: "missing" } {
  const found = documentObjects(state).find((o) => o.object.id === id);
  if (found === undefined) return { kind: "missing" };
  const after = moveObjectTo(found.object, lat, lon);
  return { kind: "moved", before: found.object, after };
}

/** The changes of the tour's own fields not written yet - its station
 *  frames, its setting, its details: `changeCount` less the objects'. */
export function tourFieldChanges(state: TourDocumentState): number {
  return (
    changeCount(state) - unsavedEntries(state).length - state.deleted.length
  );
}

/** The manifest the next write starts from: the written tour with the
 *  frames, the setting and the details (`rebuildFinishedTour`'s
 *  `manifest`); null before any open. */
export function manifestNow(state: TourDocumentState): TourManifest | null {
  const base = framed(state);
  if (base === null) return null;
  return withDetails(
    withNeedsNoGps(withEffectiveImages(state, base), state.needsNoGps),
    effectiveDetails(state),
  );
}

/** The images each station's card may show now, by station id: a photo of
 *  that station as the document holds it, or an image asset of the written
 *  tour. The tour's objects are read once, however many stations are
 *  asked. */
function stationImages(
  state: TourDocumentState,
): (stationId: string) => ReadonlySet<string> {
  const assets = imageAssetIds(state.written?.assets ?? []);
  const byStation = new Map<string, Set<string>>();
  for (const { object } of documentObjects(state)) {
    if (object.kind !== "photo" || object.station === undefined) continue;
    const ids = byStation.get(object.station) ?? new Set(assets);
    ids.add(object.id);
    byStation.set(object.station, ids);
  }
  return (stationId) => byStation.get(stationId) ?? assets;
}

/** `manifest` with each station's card image as shown and written: one
 *  whose picture is gone (a deleted or moved photo) is none, and comes
 *  back with an undo, as the cover does (`effectiveDetails`). Without it
 *  the written tour the document holds kept an image the file left out. */
function withEffectiveImages(
  state: TourDocumentState,
  manifest: TourManifest,
): TourManifest {
  if (!manifest.stations.some((s) => s.image !== undefined)) return manifest;
  const imagesOf = stationImages(state);
  return {
    ...manifest,
    stations: manifest.stations.map((station) =>
      station.image === undefined || imagesOf(station.id).has(station.image)
        ? station
        : withoutField(station, "image"),
    ),
  };
}

/** `value` without its optional field `key`. */
function withoutField<T extends object, K extends keyof T>(
  value: T,
  key: K,
): T {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

/**
 * The assets the undo and redo steps' views name - their stations' steps
 * and card images, their objects and their covers: a write keeps them
 * (`keepAssets`), so a step back across a save finds them. Without it a
 * cover image no step uses was dropped (with its file) by the save after a
 * cover change, and the undo of that change had no image to show. Kept
 * until the history no longer names them (a new edit drops the redo steps,
 * the bound the oldest).
 */
export function historyAssetIds(state: TourDocumentState): Set<string> {
  const ids = new Set<string>();
  for (const { view } of [...state.past, ...state.future]) {
    for (const frame of view.stations) {
      for (const id of stepAssetIds(frame)) ids.add(id);
      if (frame.image !== undefined) ids.add(frame.image);
    }
    for (const object of view.objects) {
      for (const id of objectAssetIds(object)) ids.add(id);
    }
    if (view.details.cover !== undefined) ids.add(view.details.cover);
  }
  return ids;
}

/** The manifest a write carries now (the Finish's rule,
 *  `finishedManifest`): what a save would write, without the zip - the
 *  same manifest (the r875 milestone review #7). The stations are the
 *  document's as they are: a write assigns nothing. */
export function manifestToWrite(state: TourDocumentState): TourManifest | null {
  const base = manifestNow(state);
  if (base === null) return null;
  return finishedManifest({
    manifest: base,
    placed: state.placed,
    deleted: state.deleted,
    keepAssets: historyAssetIds(state),
  });
}

/** The entries whose content the written file does not carry yet, read
 *  through the document's frames (`contentAt`): a note the file holds at
 *  its spot under a frame that moved since is pending. */
export function unsavedEntries(state: TourDocumentState): EditEntry[] {
  if (state.written === null) return [];
  // The frames the entries name, kept even where the file lacks them: an
  // object put into a station the file lacks, at the very spot it had,
  // is no content the file holds.
  const hosted = hostedObjects(
    withFrames(
      state.written,
      state.stations,
      state.placed,
      state.deleted,
      state.deletedStations,
      keptStationsOf(state),
    ),
  );
  return state.placed.filter((p) => !hosted.holds(p.object));
}

// --- the rules the reducers keep -----------------------------------------
// A dispatch that breaks one changes nothing; a page says why in its own
// words by asking the same guard first.

/** Whether `geo` fits the frame of the station `stationId` names, as the
 *  format bounds it (`TOUR_ITEM_MAX_OFFSET_M` per axis); false for a
 *  station the document does not carry - no object may name one (every
 *  object belongs to one of the document's stations). Module-private: a
 *  page asks `objectFits` or `canPlace`. */
function fitsStation(
  geo: TourObject["geo"],
  stationId: string,
  stations: readonly StationFrame[],
): boolean {
  const station = stations.find((s) => s.id === stationId);
  if (station === undefined) return false;
  return localPoseOf(geo, station.geo).position.every(
    (v) => Math.abs(v) <= TOUR_ITEM_MAX_OFFSET_M,
  );
}

/** Whether `object` fits its station's frame - its own, or, without one,
 *  the station the document's object of that id stands in. An object no
 *  station holds yet (a new one naming none) fits: the station rule seats
 *  it (`placed`). One naming a station the document lacks does not. */
export function objectFits(
  state: TourDocumentState,
  object: TourObject,
): boolean {
  const home =
    object.station ??
    documentObjects(state).find((o) => o.object.id === object.id)?.object
      .station;
  if (home === undefined) return true;
  return fitsStation(object.geo, home, state.stations);
}

/** What a placement or a move hands the station rule: the id a station the
 *  rule starts gets - minted outside the reducer (by the caller, or the
 *  action's `prepare`), so the reducer stays pure - and, for "New station
 *  here", that the object starts its own station even within another's
 *  radius. */
interface Seating {
  readonly newStationId: string;
  readonly newStation?: boolean;
  /** With `newStation`, on a move: the new station right after the one
   *  the object leaves (in its place when that one goes), not at the
   *  tour's end. */
  readonly afterHome?: boolean;
}

/** `frames` with `back` (one frame) where it stood in `file`: before the
 *  first of them the file lists after it, else after them all. */
function atFilePlace(
  frames: readonly StationFrame[],
  back: readonly StationFrame[],
  file: readonly { readonly id: string }[],
): StationFrame[] {
  const ids = file.map((s) => s.id);
  const at = ids.indexOf(back[0]?.id ?? "");
  const later = new Set(at < 0 ? [] : ids.slice(at + 1));
  const i = frames.findIndex((f) => later.has(f.id));
  return i < 0
    ? [...frames, ...back]
    : [...frames.slice(0, i), ...back, ...frames.slice(i)];
}

/**
 * The station rule (everything belongs to a station): `object`
 * (naming no station) joins the nearest station of the document whose OWN
 * found radius holds it (`stationHolding`: inclusive, a tie to the earlier
 * station) and whose frame can carry it (`fitsStation`: a found radius
 * has no upper bound, the format's reach does), or starts a new automatic one anchored where it stands
 * (`automaticStationFrame`, 25 m / 50 m) under `seating.newStationId`;
 * "New station here" starts one in any case. The stations read are
 * `manifestNow`'s - the tour as the next write starts from it. Null when
 * the id is taken (two stations under one id would merge their items) or
 * no tour is open.
 */
function seatByRule(
  state: TourDocumentState,
  object: TourObject,
  seating: Seating,
): { object: TourObject; stations: readonly StationFrame[] } | null {
  const base = manifestNow(state);
  if (base === null) return null;
  if (seating.newStation !== true) {
    const frames = framesOf(base);
    const holder = stationHolding(
      base.stations.filter((s) => fitsStation(object.geo, s.id, frames)),
      object.geo,
    );
    if (holder !== null) {
      // A station the file carries that the document dropped since (it
      // emptied after it was written) comes back with the object: every
      // object names one of the document's frames. It comes back where it
      // stood in the file, as a reload from the draft puts it.
      const written = base.stations.find((s) => s.id === holder);
      const known = state.stations.some((f) => f.id === holder);
      return {
        object: { ...object, station: holder },
        stations:
          known || written === undefined
            ? state.stations
            : atFilePlace(
                state.stations,
                framesOf({ ...base, stations: [written] }),
                state.written?.stations ?? [],
              ),
      };
    }
  }
  const id = seating.newStationId;
  if (base.stations.some((s) => s.id === id)) return null;
  return {
    object: { ...object, station: id },
    stations: [...state.stations, automaticStationFrame(id, object.geo)],
  };
}

/**
 * `state`'s frames without those of `candidates` that are now EMPTY
 * AUTOMATIC stations: no object of the document names them, and nothing
 * else keeps them - nothing of their own (a title, story steps, a
 * description, a card image naming an image asset: `keepsItself`), no
 * route from another station, and not added by hand (`handMade`). Such a
 * station existed only for its elements; left behind, a visitor's guide
 * would still lead to it. The same array when nothing goes.
 */
function withoutEmptied(
  state: TourDocumentState,
  candidates: Iterable<string | undefined>,
): readonly StationFrame[] {
  const ids = new Set([...candidates].filter((id) => id !== undefined));
  if (ids.size === 0) return state.stations;
  const named = new Set(documentObjects(state).map((o) => o.object.station));
  const routed = new Set(state.stations.flatMap(routedTo));
  const imageAssets = imageAssetIds(state.written?.assets ?? []);
  const handMade = new Set(state.handMade);
  const gone = (frame: StationFrame): boolean =>
    ids.has(frame.id) &&
    !named.has(frame.id) &&
    !keepsItself(frame, imageAssets) &&
    !routed.has(frame.id) &&
    !handMade.has(frame.id);
  return state.stations.some(gone)
    ? state.stations.filter((f) => !gone(f))
    : state.stations;
}

/** Why `object` may not be placed, or null when it may: an id the tour
 *  deleted (its tombstone would hide the placement, and leave a station
 *  started for it empty), an id the tour carries, or a spot its station
 *  cannot carry. */
export function placeRefusal(
  state: TourDocumentState,
  object: TourObject,
): "deleted" | "exists" | "too-far" | null {
  if (state.deleted.includes(object.id)) return "deleted";
  if (documentObjects(state).some((o) => o.object.id === object.id)) {
    return "exists";
  }
  return objectFits(state, object) ? null : "too-far";
}

/** Whether `object` may be placed (`placeRefusal` names none). */
export function canPlace(
  state: TourDocumentState,
  object: TourObject,
): boolean {
  return placeRefusal(state, object) === null;
}

/** Whether an undo or a redo may run: not while a rebuild is queued or
 *  runs - the step is measured against the file it writes. */
export function canStep(state: TourDocumentState): boolean {
  return state.save.rebuilds === 0;
}

/** The same frame: every field but the items alike, whatever order a
 *  writer built their keys in (`sameJson`). */
function sameFrame(a: StationFrame, b: StationFrame | undefined): boolean {
  return b !== undefined && sameJson(a, b);
}

/** Changes not yet written, counted as a page shows them: each object
 *  edited, placed or deleted, each station frame changed (moved, renamed,
 *  ...), each station added that no object's placement accounts for, each
 *  empty station deleted (one holding items is counted by their deletes),
 *  one for a new order of the stations, the setting, and each detail
 *  field. The frames are compared as the next write carries them
 *  (`manifestNow`). */
export function changeCount(state: TourDocumentState): number {
  const written = state.written;
  const base = manifestNow(state);
  if (written === null || base === null) return 0;
  const writtenFrames = new Map(framesOf(written).map((f) => [f.id, f]));
  const nowFrames = framesOf(base);
  const nowIds = new Set(nowFrames.map((f) => f.id));
  const named = new Set(documentObjects(state).map((o) => o.object.station));
  const changed = nowFrames.filter(
    (f) => writtenFrames.has(f.id) && !sameFrame(f, writtenFrames.get(f.id)),
  ).length;
  const added = nowFrames.filter(
    (f) => !writtenFrames.has(f.id) && !named.has(f.id),
  ).length;
  const removed = written.stations.filter(
    (s) => !nowIds.has(s.id) && s.items.length === 0,
  ).length;
  const now = effectiveDetails(state);
  const details = DETAIL_FIELDS.filter((f) => now[f] !== written[f]).length;
  return (
    unsavedEntries(state).length +
    state.deleted.length +
    changed +
    added +
    removed +
    // The document's own frames only: a written station no frame names
    // follows at the end (`withFrames`), which is no new order.
    (sameOrder(state.stations, written.stations) ? 0 : 1) +
    (state.needsNoGps !== (written.needsNoGps === true) ? 1 : 0) +
    details
  );
}

/** How many changes of the stations beyond their poses lead from `before`
 *  to `after`, counted as `changeCount` counts them: each frame both carry
 *  that differs in more than its pose, each station `after` adds that no
 *  object accounts for, each one it drops that held no object, and one
 *  for a new order. What a restore says it brought back. */
export function stationEditsBetween(
  before: TourDocumentState,
  after: TourDocumentState,
): number {
  const was = new Map(documentFrames(before).map((f) => [f.id, f]));
  const now = documentFrames(after);
  const nowIds = new Set(now.map((f) => f.id));
  const namedAfter = new Set(
    documentObjects(after).map((o) => o.object.station),
  );
  const namedBefore = new Set(
    documentObjects(before).map((o) => o.object.station),
  );
  const reworked = now.filter((f) => {
    const other = was.get(f.id);
    return other !== undefined && !sameBeyondPose(f, other);
  }).length;
  const added = now.filter(
    (f) => !was.has(f.id) && !namedAfter.has(f.id),
  ).length;
  const removed = [...was.keys()].filter(
    (id) => !nowIds.has(id) && !namedBefore.has(id),
  ).length;
  // The order of the document's own frames, as `changeCount` reads it: a
  // written station no frame names follows at the end, which is no new
  // order.
  const reordered = !sameOrder(after.stations, before.stations);
  return reworked + added + removed + (reordered ? 1 : 0);
}

/** Whether the stations both lists carry stand in the same order. */
function sameOrder(
  a: readonly { readonly id: string }[],
  b: readonly { readonly id: string }[],
): boolean {
  const inA = new Set(a.map((s) => s.id));
  const inB = new Set(b.map((s) => s.id));
  const sharedB = b.filter((s) => inA.has(s.id));
  return a
    .filter((s) => inB.has(s.id))
    .every((s, i) => s.id === sharedB[i]?.id);
}

/** The document as an undo step keeps it. */
export function viewOf(state: TourDocumentState): TourDocumentView {
  return {
    stations: state.stations,
    objects: documentObjects(state).map((o) => o.object),
    needsNoGps: state.needsNoGps,
    details: state.details,
    ...(state.deletedStations.length === 0
      ? {}
      : { deletedStations: state.deletedStations }),
  };
}

/**
 * What the document holds at `view`, measured against the written file:
 * the objects the file does not hold as they are become entries, the
 * file's objects the view lacks become deletions. "As they are" is read
 * through the VIEW's frames, as `documentObjects` reads it: an item the
 * file holds at a local pose under a frame the view moves elsewhere
 * stands elsewhere, so it needs an entry (a save under a moved frame,
 * then an undo of the move). The view's objects ride along as entries,
 * so a station only one of them names (one the rule started) is in that
 * reading: without it, an object the view seats there would match the
 * file's copy in its old station and leave its own station empty.
 * `keptBare` as `withFrames` reads it.
 */
function contentAt(
  written: TourManifest,
  view: TourDocumentView,
  keptBare: KeptStations,
): { placed: EditEntry[]; deleted: string[] } {
  const kept = new Set(view.objects.map((o) => o.id));
  const deleted = tourObjects(written)
    .filter((o) => !kept.has(o.id))
    .map((o) => o.id);
  const hosted = hostedObjects(
    withFrames(
      written,
      view.stations,
      view.objects.map((object) => ({ object })),
      deleted,
      view.deletedStations,
      keptBare,
    ),
  );
  return {
    placed: view.objects
      .filter((o) => !hosted.holds(o))
      .map((object) => ({ object })),
    deleted,
  };
}

/** The photos a step to `view` brings back that the written file has no
 *  picture for: the page must hold each one's picture, or the step is
 *  refused. */
export function picturesNeeded(
  state: TourDocumentState,
  view: TourDocumentView,
): string[] {
  if (state.written === null) return [];
  const hosted = hostedObjects(state.written);
  return contentAt(state.written, view, keptStationsOf(state))
    .placed.filter(
      (p) => p.object.kind === "photo" && hosted.key(p.object.id) === undefined,
    )
    .map((p) => p.object.id);
}

/** The step an undo (or a redo) goes to; undefined when there is none. */
export function nextStep(
  state: TourDocumentState,
  which: "undo" | "redo",
): TourHistoryStep | undefined {
  return (which === "undo" ? state.past : state.future).at(-1);
}

// --- the slice --------------------------------------------------------------

/** A plain copy of a reducer's (Immer) draft: the pure rules compute
 *  from it, and the reducer returns their result. */
function plain(state: Draft<TourDocumentState>): TourDocumentState {
  return current(state);
}

/** `state` after an edit made from `before`: one step to undo, nothing
 *  left to redo. */
function edited(
  before: TourDocumentState,
  next: Partial<TourDocumentState>,
  what: string,
): TourDocumentState {
  const past = [...before.past, { view: viewOf(before), what }];
  if (past.length > TOUR_HISTORY_LIMIT) past.shift();
  // The in-place file's view (or the one being written) was undone, and
  // the redo that led back to it is dropped now: no view on the history is
  // that file's any more.
  const dropped = (
    at: number | "elsewhere" | null,
  ): number | "elsewhere" | null =>
    typeof at === "number" && at > before.position ? "elsewhere" : at;
  const inPlaceAt = dropped(before.save.inPlaceAt);
  const inPlaceWriting = dropped(before.save.inPlaceWriting);
  return {
    ...before,
    ...next,
    past,
    future: [],
    revision: before.revision + 1,
    position: before.position + 1,
    save:
      inPlaceAt === before.save.inPlaceAt &&
      inPlaceWriting === before.save.inPlaceWriting
        ? before.save
        : saveWith(before.save, { inPlaceAt, inPlaceWriting }),
  };
}

/**
 * Whether a step (undo or redo) from `state` crosses the file last written
 * in place (D33): it undoes an edit that file holds (the file's view is at
 * or past the document's position), or redoes one that file lacks (the
 * file's view is at or before it). With the file's view off the history
 * (`elsewhere`) every step crosses: the file differs from the document on
 * a step it cannot name. False with no in-place save, or no step to take.
 * Positions, not times: a redo of an edit made after the file was written,
 * and undone since, crosses it too - the redo takes the document away from
 * what the file holds. While a save holds the slot, the view an in-place
 * write of it holds counts as well (`inPlaceWriting`): the disk holds one
 * of the two once it ends.
 */
function stepCrossesInPlaceSave(
  state: TourDocumentState,
  which: "undo" | "redo",
): boolean {
  if (nextStep(state, which) === undefined) return false;
  const crosses = (at: number | "elsewhere" | null): boolean =>
    at !== null &&
    (at === "elsewhere" ||
      (which === "undo" ? at >= state.position : at <= state.position));
  return (
    crosses(state.save.inPlaceAt) ||
    (state.save.by !== null && crosses(state.save.inPlaceWriting))
  );
}

/** Whether a frame both lists carry differs between them: a station
 *  MOVED. A station the rule started or dropped is no move - the
 *  objects it holds are the record of it. */
function framesMoved(
  a: readonly StationFrame[],
  b: readonly StationFrame[],
): boolean {
  const byId = new Map(b.map((f) => [f.id, f]));
  return a.some((f) => {
    const other = byId.get(f.id);
    return other !== undefined && !sameJson(f, other);
  });
}

/** The document moved to `view` (an undo or a redo step). */
function goTo(
  state: TourDocumentState,
  view: TourDocumentView,
): TourDocumentState {
  if (state.written === null) return state;
  const settingMoved = view.needsNoGps !== state.needsNoGps;
  const detailsMoved = DETAIL_FIELDS.some(
    (f) => view.details[f] !== state.details[f],
  );
  const stationsMoved = framesMoved(view.stations, state.stations);
  const framesChanged = framesEdited(view.stations, state.stations);
  return {
    ...state,
    ...contentAt(state.written, view, keptStationsOf(state)),
    stations: view.stations,
    deletedStations: view.deletedStations ?? [],
    needsNoGps: view.needsNoGps,
    details: view.details,
    touched: {
      needsNoGps: state.touched.needsNoGps || settingMoved,
      details: state.touched.details || detailsMoved,
      stations: state.touched.stations || stationsMoved || framesChanged,
    },
    detailsRecorded: state.detailsRecorded || detailsMoved,
    stationsRecorded: state.stationsRecorded || stationsMoved,
    framesRecorded: state.framesRecorded || framesChanged,
  };
}

/** Whether the frames `a` and `b` differ beyond a pose and beyond a
 *  station added or dropped (each set `framesRecorded` when it was made):
 *  a frame both carry differs in anything but its pose, or the shared ones
 *  stand in another order. A step across such a change is recorded whole
 *  (`framesRecorded`), as the edit was. */
function framesEdited(
  a: readonly StationFrame[],
  b: readonly StationFrame[],
): boolean {
  if (!sameOrder(a, b)) return true;
  const byId = new Map(b.map((f) => [f.id, f]));
  return a.some((f) => {
    const other = byId.get(f.id);
    return other !== undefined && !sameBeyondPose(f, other);
  });
}

/** `state` with each of `codes` at its `to` text where it still holds its
 *  `from` one, and the codes that moved. */
function codesAt(
  state: TourDocumentState,
  codes: readonly StepCode[],
): { readonly state: TourDocumentState; readonly moved: StepCode[] } {
  const book = new Map(bookOf(state.codes));
  const moved: StepCode[] = [];
  for (const code of codes) {
    const now = book.get(code.id);
    if (now === undefined || now.saved !== code.from) continue;
    book.set(code.id, { ...now, saved: code.to });
    moved.push(code);
  }
  if (moved.length === 0) return { state, moved };
  return {
    state: { ...state, codes: { ...state.codes, book: [...book.values()] } },
    moved,
  };
}

/** The step back to `state` from a step named `what`: its view, and the
 *  codes the step moved, set again to the texts they had. */
function wayBack(
  state: TourDocumentState,
  what: string,
  moved: readonly StepCode[],
): TourHistoryStep {
  const view = viewOf(state);
  if (moved.length === 0) return { view, what };
  return {
    view,
    what,
    codes: moved.map((c) => ({ id: c.id, from: c.to, to: c.from })),
  };
}

/** A step from one end of the history to the other. */
function step(
  state: TourDocumentState,
  which: "undo" | "redo",
): TourDocumentState {
  const target = nextStep(state, which);
  if (target === undefined || state.written === null) return state;
  const crosses = stepCrossesInPlaceSave(state, which);
  const codes = codesAt(goTo(state, target.view), target.codes ?? []);
  const here = wayBack(state, target.what, codes.moved);
  const moved = codes.state;
  const from = which === "undo" ? state.past : state.future;
  const to = which === "undo" ? state.future : state.past;
  const rest = from.slice(0, -1);
  const kept = [...to, here];
  return {
    ...moved,
    past: which === "undo" ? rest : kept,
    future: which === "undo" ? kept : rest,
    revision: state.revision + 1,
    position: state.position + (which === "undo" ? -1 : 1),
    save: crosses ? saveWith(state.save, { resave: true }) : state.save,
  };
}

/** What a draft's offer puts back, already checked by the page's rules
 *  (`editor-session.ts` `restore`): each applied as an edit would be. */
interface TourRestore {
  readonly objects: readonly TourObject[];
  readonly deleted: readonly string[];
  readonly needsNoGps?: boolean;
  readonly details?: TourDetailFields;
  /** Station poses: each frame of that id moves there (D17), before the
   *  objects - whose spots the moved frames carry - are put back. */
  readonly stations?: readonly StationPose[];
  /** Whole frames of stations a page created that the document lacks (a
   *  draft keeps them, so a reload brings a pin's station back with it):
   *  added after the poses, before the objects. */
  readonly createdStations?: readonly StationFrame[];
  /** The stations a draft recorded edited beyond their pose, or added
   *  (`recordedFrames`): each replaces the document's frame of its id at
   *  the document's pose (a pose is `stations`' to move), or is added
   *  whole, after the poses; one whose steps name an asset the written
   *  tour lacks is skipped. */
  readonly frames?: readonly StationFrame[];
  /** The stations' order a draft recorded (`recordedOrder`): the stations
   *  it names follow it, the others after them in their own order. */
  readonly order?: readonly string[];
  /** Stations the draft deleted: each goes once the objects are back,
   *  unless an object still names it. */
  readonly deletedStations?: readonly string[];
  /** Stations the draft's page added by hand (`handMade`): they keep
   *  themselves here too, before the frames and objects come back. */
  readonly handMadeStations?: readonly string[];
  /** The objects were made in ANOTHER document (work carried into a tour
   *  just opened): the station each named is not this tour's, so each is
   *  seated afresh by the station rule against the opened tour's
   *  stations. */
  readonly rerun?: boolean;
}

/**
 * A restore's station deletions and order (`restored`, after the objects
 * are back): each deleted station no object names goes, every route to a
 * station the tour no longer
 * carries is pruned (the format refuses a dangling one), and the stations
 * follow the recorded order, the others after them.
 */
function restoredStations(
  state: TourDocumentState,
  work: Pick<TourRestore, "frames" | "order" | "deletedStations">,
): TourDocumentState {
  if (state.written === null) return state;
  if (!recordsStations(work)) return withoutDanglingRoutes(state);
  const named = new Set(documentObjects(state).map((o) => o.object.station));
  const gone = new Set(
    (work.deletedStations ?? []).filter((id) => !named.has(id)),
  );
  let frames = allFrames(state).filter((f) => !gone.has(f.id));
  const writtenIds = new Set(state.written.stations.map((s) => s.id));
  const deletedStations = [
    ...state.deletedStations,
    ...[...gone].filter(
      (id) => writtenIds.has(id) && !state.deletedStations.includes(id),
    ),
  ];
  const ids = new Set(frames.map((f) => f.id));
  const missing = new Set(
    frames.flatMap(routedTo).filter((id) => !ids.has(id)),
  );
  if (missing.size > 0) frames = frames.map((f) => withoutRoutesTo(f, missing));
  if (work.order !== undefined) {
    const order = new Map(work.order.map((id, i) => [id, i]));
    const rank = (f: StationFrame): number =>
      order.get(f.id) ?? Number.POSITIVE_INFINITY;
    // A stable sort: the frames the record does not name keep their order.
    frames = frames
      .map((f, i) => ({ f, i }))
      .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
      .map(({ f }) => f);
  }
  return { ...state, stations: frames, deletedStations };
}

/** Whether a restore carries a record of the stations beyond their poses
 *  (frames, an order or deletions): the document records them on. */
function recordsStations(
  work: Pick<TourRestore, "frames" | "order" | "deletedStations">,
): boolean {
  return (
    work.frames !== undefined ||
    work.order !== undefined ||
    work.deletedStations !== undefined
  );
}

/** `state` without a route of its frames to a station the tour does not
 *  carry (a created station restored from a draft written against
 *  another tour); the same state when there is none. */
function withoutDanglingRoutes(state: TourDocumentState): TourDocumentState {
  const carried = new Set([
    ...state.stations.map((f) => f.id),
    ...(manifestNow(state)?.stations ?? []).map((s) => s.id),
  ]);
  const missing = new Set(
    state.stations.flatMap(routedTo).filter((id) => !carried.has(id)),
  );
  if (missing.size === 0) return state;
  return {
    ...state,
    stations: state.stations.map((f) => withoutRoutesTo(f, missing)),
  };
}

/** `TourRestore` as the reducer reads it: with one minted id per object,
 *  for a station the rule may start for it (`prepare` mints them). */
interface TourRestorePayload extends TourRestore {
  readonly what: string;
  readonly newStationIds: readonly string[];
}

/** A placement as the reducer reads it (`Seating` minted by `prepare`). */
interface PlacedPayload extends Seating {
  readonly object: TourObject;
  readonly what: string;
}

/** What a page dispatches for a placement or a move: the id is minted
 *  for it when absent. */
interface SeatingInput {
  readonly object: TourObject;
  readonly what: string;
  readonly newStationId?: string;
  readonly newStation?: boolean;
  readonly afterHome?: boolean;
}

/** `input` with a station id minted for the rule when it carries none
 *  (`newObjectId`: outside the reducer, so the reducer stays pure). */
function prepareSeating(input: SeatingInput): { payload: PlacedPayload } {
  return {
    payload: {
      ...input,
      newStationId: input.newStationId ?? newObjectId(),
    },
  };
}

/** The written save that landed: the manifest the zip carries, the
 *  deletions it applied, and the frames it started from. */
interface TourSaved {
  readonly generation: number;
  readonly written: TourManifest;
  readonly appliedDeletions: readonly string[];
  readonly stationsAtStart: readonly StationFrame[];
  /** The write goes over the opened file (the desktop's in place), and
   *  holds the view at this history `position` (the save's snapshot's).
   *  Absent for a download and for the phone's Finish. */
  readonly inPlaceAt?: number;
}

/** A fresh save status that keeps who holds the page's save slot: the
 *  slot is the page's, and a save of the tour before lets it go itself
 *  once it sees the tour gone - until then the next tour waits, as the
 *  page's own flag made it wait before the store held it. */
function slotKept(save: TourSaveStatus): TourSaveStatus {
  return saveWith(IDLE, { by: save.by });
}

/**
 * A new version of an object (or a new one): one entry per id, with the
 * station frames `stations` (the one a placement or a move started), and
 * then without the station it left if that is now an empty automatic one
 * (`withoutEmptied`) - all one step.
 */
function putObject(
  before: TourDocumentState,
  object: TourObject,
  what: string,
  stations: readonly StationFrame[] = before.stations,
  left?: string,
): TourDocumentState {
  if (before.written === null) return before;
  // A pending object put again unchanged (an AR settle re-poses every
  // object of a visit) is no step: it would withdraw a delete's Undo.
  const pending = before.placed.find((p) => p.object.id === object.id);
  if (
    pending !== undefined &&
    stations === before.stations &&
    objectContentKey(pending.object) === objectContentKey(object)
  ) {
    return before;
  }
  const placed = upsertPlaced(before.placed, { object });
  return edited(
    before,
    {
      placed,
      stations: withoutEmptied({ ...before, placed, stations }, [left]),
    },
    what,
  );
}

/** `object` naming no station: what the station rule seats. */
function unseated(object: TourObject): TourObject {
  const { station: _station, ...rest } = object;
  return rest;
}

/** Whether a move of `object` to its new spot keeps it in its station
 *  `frame`: the station's own found radius holds the spot; or, by
 *  distance (`keepsHomeDistance`), it stands within the radius and its
 *  tolerance, or no farther from the anchor than it stood before the move
 *  (an item outside the radius already) - and the move takes it into no
 *  other station's radius: a station whose radius held the old spot too
 *  (radii overlap) is not one it moved into. */
function keepsHome(
  state: TourDocumentState,
  frame: StationFrame,
  object: TourObject,
): boolean {
  if (stationHolding([frame], object.geo) !== null) return true;
  const was = documentObjects(state).find((o) => o.object.id === object.id)
    ?.object.geo;
  if (was === undefined) return false;
  const kept = keepsHomeDistance({
    radiusM: frame.foundRadiusM,
    wasM: horizontalM(frame.geo, was),
    nowM: horizontalM(frame.geo, object.geo),
  });
  if (!kept) return false;
  const base = manifestNow(state);
  if (base === null) return false;
  const movedInto = base.stations.filter(
    (s) => stationHolding([s], was) === null,
  );
  return stationHolding(movedInto, object.geo) === null;
}

/** The station the document's object `id` stands in, if any. */
function homeOf(state: TourDocumentState, id: string): string | undefined {
  return documentObjects(state).find((o) => o.object.id === id)?.object.station;
}

/** `stationMoved`'s rule: the frame of `stationId` at `geo`, its items
 *  rigidly with it, as one step; `before` for a station it lacks. */
function stationMove(
  before: TourDocumentState,
  stationId: string,
  geo: QrGeoPose,
  what: string,
): TourDocumentState {
  const frame = before.stations.find((s) => s.id === stationId);
  if (frame === undefined) return before;
  let placed = before.placed;
  for (const { object } of documentObjects(before)) {
    if (object.station !== stationId) continue;
    const moved: TourObject = {
      ...object,
      geo: itemGeoPose(localPoseOf(object.geo, frame.geo), geo),
    };
    placed = upsertPlaced(placed, { object: moved });
  }
  return edited(
    before,
    {
      placed,
      stations: before.stations.map((s) =>
        s.id === stationId ? { ...s, geo } : s,
      ),
      touched: { ...before.touched, stations: true },
      stationsRecorded: true,
    },
    what,
  );
}

/** `moved`'s rule: the object at its new spot, keeping its station or
 *  seated anew (see `moved`), as one step; `before` for an unknown id. */
function objectMove(
  before: TourDocumentState,
  { object, what, newStationId, newStation, afterHome }: PlacedPayload,
): TourDocumentState {
  const home = homeOf(before, object.id);
  const frame = before.stations.find((s) => s.id === home);
  if (home === undefined || frame === undefined) return before;
  const kept = { ...object, station: home };
  if (
    newStation !== true &&
    keepsHome(before, frame, object) &&
    objectFits(before, kept)
  ) {
    return putObject(before, kept, what);
  }
  const seated = seatByRule(before, unseated(object), {
    newStationId,
    ...(newStation === true ? { newStation } : {}),
  });
  if (seated === null) return before;
  if (newStation !== true || afterHome !== true) {
    return putObject(before, seated.object, what, seated.stations, home);
  }
  // The rule appends the new frame; it moves to right after the home.
  const made = seated.stations.filter((f) => !before.stations.includes(f));
  const others = seated.stations.filter((f) => before.stations.includes(f));
  const at = others.findIndex((f) => f.id === home) + 1;
  const next = putObject(
    before,
    seated.object,
    what,
    [...others.slice(0, at), ...made, ...others.slice(at)],
    home,
  );
  // An order a reload would not give by itself: the draft records it.
  return next === before ? before : { ...next, framesRecorded: true };
}

// --- the stations as the creator edits them ---------------------------------

/** A station's own fields as an editor sets them: a field left out stays;
 *  a blank title or description, or a null one, removes it; a null image
 *  removes the card image. The found radius sets the preload radius with
 *  it (`preloadRadiusM`). */
export interface StationEdit {
  readonly title?: string | null;
  readonly foundRadiusM?: number;
  readonly description?: string | null;
  readonly image?: string | null;
}

/** What `stationEditChange` finds: the frame to dispatch, nothing, why
 *  not (the field), or `missing` for a station the document lacks. */
export type StationEditChange =
  | { readonly kind: "edited"; readonly frame: StationFrame }
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "refused";
      readonly reason: "title" | "radius" | "description" | "image";
    }
  | { readonly kind: "missing" };

/** `frame` with its text field `key` set from `value` by `check` (the
 *  format's own rule: trimmed, bounded); a blank or null value removes
 *  it; undefined leaves it. Null when `check` refuses it. */
function withText(
  frame: StationFrame,
  key: "title" | "description",
  value: string | null | undefined,
  check: typeof checkTourTitle,
): StationFrame | null {
  if (value === undefined) return frame;
  if (value === null || value.trim() === "") return withoutField(frame, key);
  const checked = check(value);
  return checked.ok ? { ...frame, [key]: checked.value } : null;
}

/**
 * What `edit` would make of the station `stationId`, by the format's rules
 * (both a page and the reducer ask it): a title of at most 80 characters
 * (`checkTourTitle`), a found radius from 2 m to 300 m (`isStationRadius`)
 * with the preload radius twice it, a description of at most 2000
 * (`checkTourDescription`), a card image naming a photo of THIS station or
 * an image asset of the tour (`stationImages`).
 */
export function stationEditChange(
  state: TourDocumentState,
  stationId: string,
  edit: StationEdit,
): StationEditChange {
  const frame = allFrames(state).find((s) => s.id === stationId);
  if (frame === undefined) return { kind: "missing" };
  const titled = withText(frame, "title", edit.title, checkTourTitle);
  if (titled === null) return { kind: "refused", reason: "title" };
  const described = withText(
    titled,
    "description",
    edit.description,
    checkTourDescription,
  );
  if (described === null) return { kind: "refused", reason: "description" };
  let next = described;
  if (edit.foundRadiusM !== undefined) {
    if (!isStationRadius(edit.foundRadiusM)) {
      return { kind: "refused", reason: "radius" };
    }
    next = {
      ...next,
      foundRadiusM: edit.foundRadiusM,
      activateRadiusM: preloadRadiusM(edit.foundRadiusM),
    };
  }
  if (edit.image === null) {
    next = withoutField(next, "image");
  } else if (edit.image !== undefined) {
    if (!stationImages(state)(stationId).has(edit.image)) {
      return { kind: "refused", reason: "image" };
    }
    next = { ...next, image: edit.image };
  }
  return sameJson(next, frame)
    ? { kind: "unchanged" }
    : { kind: "edited", frame: next };
}

/** Why the station `stationId` may not be deleted, or null when it may:
 *  the tour does not carry it (as the next write would), or it is the
 *  tour's last station (a tour has at least one). */
export function stationDeleteRefusal(
  state: TourDocumentState,
  stationId: string,
): "missing" | "last" | null {
  const stations = manifestNow(state)?.stations ?? [];
  if (!stations.some((s) => s.id === stationId)) return "missing";
  return stations.length === 1 ? "last" : null;
}

/** Whether `id` may name a new station: a well-formed id no station of the
 *  document, the written or the opened tour carries (a deleted station's
 *  id comes back with an undo). */
function freeStationId(state: TourDocumentState, id: string): boolean {
  return (
    TOUR_ID_PATTERN.test(id) &&
    ![
      ...state.stations,
      ...(state.written?.stations ?? []),
      ...(state.opened?.stations ?? []),
    ].some((s) => s.id === id)
  );
}

/** Whether `id` may name a new item: a well-formed id that no object of
 *  the document, no deleted one, no written item and no asset carries
 *  (items and assets share one namespace). */
function freeObjectId(state: TourDocumentState, id: string): boolean {
  if (!TOUR_ID_PATTERN.test(id) || state.deleted.includes(id)) return false;
  const written = state.written;
  return ![
    ...documentObjects(state).map((o) => o.object.id),
    ...(written === null ? [] : tourObjects(written).map((o) => o.id)),
    ...(written?.assets ?? []).map((a) => a.id),
  ].includes(id);
}

/** Whether `at` is a point on the globe: finite, latitude within +-90,
 *  longitude within +-180. */
function isGlobePoint(at: StationPoint): boolean {
  return (
    Number.isFinite(at.lat) &&
    Number.isFinite(at.lon) &&
    Number.isFinite(at.alt) &&
    Math.abs(at.lat) <= 90 &&
    Math.abs(at.lon) <= 180
  );
}

/** Every frame the next write carries, in its order (written stations no
 *  frame names included), then the document's frames it does not carry:
 *  what a station's delete or a reorder works on. */
function allFrames(state: TourDocumentState): StationFrame[] {
  const base = framed(state);
  if (base === null) return [...state.stations];
  const listed = new Set(base.stations.map((s) => s.id));
  const own = new Map(state.stations.map((f) => [f.id, f]));
  return [
    ...framesOf(base).map((f) => own.get(f.id) ?? f),
    ...state.stations.filter((f) => !listed.has(f.id)),
  ];
}

/** `allFrames` as an edit of the stations lists them back as the
 *  document's frames: without a written station no frame lists and
 *  nothing stands in any more (an emptied automatic one, which the next
 *  write leaves out). Listed back as a frame it would order the items
 *  moved out of it ahead of their new station's own, which a reload from
 *  the draft does not - whichever edit listed it: a reorder, a delete, a
 *  copy or an edit of another station. `editedId` is the station an edit
 *  works on, listed whatever it holds. */
function framesToList(
  state: TourDocumentState,
  editedId?: string,
): StationFrame[] {
  const own = new Set(state.stations.map((f) => f.id));
  const named = new Set(documentObjects(state).map((o) => o.object.station));
  return allFrames(state).filter(
    (f) => own.has(f.id) || named.has(f.id) || f.id === editedId,
  );
}

/** The frames a station edit of `stationId` replaces: the document's own
 *  when they name it, else the frames an edit lists back with it
 *  (`framesToList`: a written station no frame names, which follows its
 *  items until a write prunes it, is edited as it is shown; another
 *  emptied one stays unlisted). */
function framesHolding(
  state: TourDocumentState,
  stationId: string,
): readonly StationFrame[] {
  return state.stations.some((s) => s.id === stationId)
    ? state.stations
    : framesToList(state, stationId);
}

/** What a copy's title adds to the original's. */
const COPY_MARK = " copy";

/** A copy's title: `title` and the mark, `title` shortened to fit the
 *  title's bound (`TOUR_TITLE_MAX_CHARS`, counted as the field counts
 *  it, in code points). */
function copyTitle(title: string): string {
  const room = TOUR_TITLE_MAX_CHARS - [...COPY_MARK].length;
  const chars = [...title];
  const kept =
    chars.length <= room ? title : chars.slice(0, room).join("").trimEnd();
  return `${kept}${COPY_MARK}`;
}

/** The title a station without one is shown by: its place in the tour. */
function shownTitle(state: TourDocumentState, frame: StationFrame): string {
  if (frame.title !== undefined) return frame.title;
  const at = (manifestNow(state)?.stations ?? []).findIndex(
    (s) => s.id === frame.id,
  );
  return `Station ${String(at + 1)}`;
}

/** `object` as a new item `newId` at `geo` in `station`: made now
 *  (`createdAtIso`), a photo under its own content file (`content/<id>.`
 *  its extension), a label marked as a copy. */
function copiedObject(
  object: TourObject,
  copy: {
    readonly id: string;
    readonly createdAtIso: string;
    readonly geo: QrGeoPose;
    readonly station: string;
  },
): TourObject {
  const base = {
    ...object,
    id: copy.id,
    createdAtIso: copy.createdAtIso,
    geo: copy.geo,
    station: copy.station,
  };
  const marked =
    object.label === undefined
      ? base
      : { ...base, label: `${object.label} copy` };
  if (marked.kind !== "photo") return marked;
  const ext = /\.([a-z0-9]{1,5})$/.exec(marked.image)?.[1] ?? "jpg";
  return { ...marked, image: `content/${copy.id}.${ext}` };
}

/**
 * A station's frame replaced (`stationEdited`), as one step. An edit that
 * leaves an emptied station with nothing of its own - its radius, a title
 * set and then cleared - does not list it (`withoutEmptied`): the next
 * write leaves it out and a reload from the draft does not list it, so the
 * live document must not either. Such an edit of a station the frames do
 * not list changes nothing.
 */
function stationEdit(
  before: TourDocumentState,
  payload: { stationId: string; edit: StationEdit; what: string },
): TourDocumentState {
  if (before.written === null) return before;
  const { stationId } = payload;
  const change = stationEditChange(before, stationId, payload.edit);
  if (change.kind !== "edited") return before;
  const frames = framesHolding(before, stationId).map((s) =>
    s.id === stationId ? change.frame : s,
  );
  const stations = withoutEmptied({ ...before, stations: frames }, [stationId]);
  const listed = (list: readonly StationFrame[]) =>
    list.some((s) => s.id === stationId);
  if (!listed(stations) && !listed(before.stations)) return before;
  return edited(
    before,
    {
      stations,
      touched: { ...before.touched, stations: true },
      framesRecorded: true,
    },
    payload.what,
  );
}

/** A station added at `at` (`stationAdded`), as one step: untitled (named
 *  by its place in the tour) and made by hand (`handMade`). */
function stationAdd(
  before: TourDocumentState,
  payload: { at: StationPoint; stationId: string; what: string },
): TourDocumentState {
  if (before.written === null) return before;
  if (!isGlobePoint(payload.at) || !freeStationId(before, payload.stationId)) {
    return before;
  }
  const frame: StationFrame = automaticStationFrame(
    payload.stationId,
    payload.at,
  );
  return edited(
    before,
    {
      stations: [...before.stations, frame],
      handMade: [...before.handMade, payload.stationId],
      touched: { ...before.touched, stations: true },
      framesRecorded: true,
    },
    payload.what,
  );
}

/** A station deleted with its items (`stationDeleted`), every route to it
 *  pruned, as one step. */
function stationDelete(
  before: TourDocumentState,
  payload: { stationId: string; what: string },
): TourDocumentState {
  const { stationId } = payload;
  if (before.written === null) return before;
  if (stationDeleteRefusal(before, stationId) !== null) return before;
  let next = before;
  for (const found of documentObjects(before)) {
    if (found.object.station !== stationId) continue;
    const gone = deleteObject(next, found);
    next = { ...next, placed: gone.placed, deleted: gone.deleted };
  }
  const gone = new Set([stationId]);
  const written = before.written.stations.some((s) => s.id === stationId);
  return edited(
    before,
    {
      placed: next.placed,
      deleted: next.deleted,
      stations: framesToList(before)
        .filter((f) => f.id !== stationId)
        .map((f) => withoutRoutesTo(f, gone)),
      ...(written
        ? { deletedStations: [...before.deletedStations, stationId] }
        : {}),
      touched: { ...before.touched, stations: true },
      framesRecorded: true,
    },
    payload.what,
  );
}

/** The stations in a new order (`stationsReordered`), as one step. */
function stationsReorder(
  before: TourDocumentState,
  payload: { order: readonly string[]; what: string },
): TourDocumentState {
  const base = manifestNow(before);
  if (base === null) return before;
  const ids = base.stations.map((s) => s.id);
  const { order } = payload;
  if (
    order.length !== ids.length ||
    new Set(order).size !== order.length ||
    !order.every((id) => ids.includes(id)) ||
    order.every((id, i) => id === ids[i])
  ) {
    return before;
  }
  const frames = framesToList(before);
  const byId = new Map(frames.map((f) => [f.id, f]));
  const listed = new Set(order);
  return edited(
    before,
    {
      stations: [
        ...order.flatMap((id) => {
          const frame = byId.get(id);
          return frame === undefined ? [] : [frame];
        }),
        ...frames.filter((f) => !listed.has(f.id)),
      ],
      touched: { ...before.touched, stations: true },
      framesRecorded: true,
    },
    payload.what,
  );
}

/** What `stationDuplicated` carries: the new ids are minted outside the
 *  reducer, the items' by the page (it copies their pictures first). */
interface StationDuplicatePayload {
  readonly stationId: string;
  readonly newStationId: string;
  /** A new id for EVERY item of the station, by its old id. */
  readonly newItemIds: Readonly<Record<string, string>>;
  readonly createdAtIso: string;
  /** Where the copy stands; beside the original when absent
   *  (`duplicateStationGeo`). */
  readonly geo?: QrGeoPose;
  readonly what: string;
}

/** A station copied beside itself with its items (`stationDuplicated`),
 *  as one step. */
function stationDuplicate(
  before: TourDocumentState,
  payload: StationDuplicatePayload,
): TourDocumentState {
  if (before.written === null) return before;
  // The copy follows its original. An original the frames do not list
  // back (`framesToList`: an emptied automatic station, which the next
  // write leaves out) stays unlisted, and the copy takes its place:
  // listed back it would order the items moved out of it ahead of their
  // new station's own, which a reload from the draft does not.
  const all = allFrames(before);
  const frame = all.find((s) => s.id === payload.stationId);
  const frames = before.stations.some((s) => s.id === payload.stationId)
    ? before.stations
    : framesToList(before);
  if (frame === undefined || !freeStationId(before, payload.newStationId)) {
    return before;
  }
  const items = documentObjects(before)
    .map((o) => o.object)
    .filter((o) => o.station === frame.id);
  const newIds = items.map((o) => payload.newItemIds[o.id]);
  if (
    newIds.some((id) => id === undefined || !freeObjectId(before, id)) ||
    new Set(newIds).size !== newIds.length
  ) {
    return before;
  }
  const geo = payload.geo ?? duplicateStationGeo(frame);
  if (!isGlobePoint(geo)) return before;
  // A card image of an image asset stays valid on the copy; one of the
  // station's own photo names a photo the copy does not hold.
  const keepsImage =
    frame.image !== undefined &&
    imageAssetIds(before.written.assets).has(frame.image);
  const copy: StationFrame = {
    ...(keepsImage ? frame : withoutField(frame, "image")),
    id: payload.newStationId,
    geo,
    title: copyTitle(shownTitle(before, frame)),
  };
  let placed = before.placed;
  for (const [i, item] of items.entries()) {
    const id = newIds[i];
    if (id === undefined) return before;
    placed = upsertPlaced(placed, {
      object: copiedObject(item, {
        id,
        createdAtIso: payload.createdAtIso,
        geo: rigidlyMoved(item.geo, frame.geo, geo),
        station: copy.id,
      }),
    });
  }
  const listed = new Set(frames.map((f) => f.id));
  const at = listed.has(frame.id)
    ? frames.indexOf(frame) + 1
    : all.slice(0, all.indexOf(frame)).filter((f) => listed.has(f.id)).length;
  return edited(
    before,
    {
      placed,
      stations: [...frames.slice(0, at), copy, ...frames.slice(at)],
      touched: { ...before.touched, stations: true },
      framesRecorded: true,
    },
    payload.what,
  );
}

/** An item copied beside itself in its station (`objectDuplicated`). */
function objectDuplicate(
  before: TourDocumentState,
  payload: {
    id: string;
    newId: string;
    createdAtIso: string;
    geo?: QrGeoPose;
    what: string;
  },
): TourDocumentState {
  const found = documentObjects(before).find((o) => o.object.id === payload.id);
  const station = found?.object.station;
  if (found === undefined || station === undefined) return before;
  if (!freeObjectId(before, payload.newId)) return before;
  const copy = copiedObject(found.object, {
    id: payload.newId,
    createdAtIso: payload.createdAtIso,
    geo: payload.geo ?? duplicateItemGeo(found.object.geo),
    station,
  });
  if (!objectFits(before, copy)) return before;
  return putObject(before, copy, payload.what);
}

/** Items set to the given altitudes (`itemsGrounded`), as one step. */
function itemsGround(
  before: TourDocumentState,
  payload: {
    items: readonly { readonly id: string; readonly alt: number }[];
    what: string;
  },
): TourDocumentState {
  if (before.written === null) return before;
  const objects = new Map(
    documentObjects(before).map((o) => [o.object.id, o.object]),
  );
  let placed = before.placed;
  for (const { id, alt } of payload.items) {
    const object = objects.get(id);
    if (object === undefined || !Number.isFinite(alt)) return before;
    if (object.geo.alt === alt) continue;
    const grounded = { ...object, geo: { ...object.geo, alt } };
    if (!objectFits(before, grounded)) return before;
    placed = upsertPlaced(placed, { object: grounded });
  }
  if (placed === before.placed) return before;
  return edited(before, { placed }, payload.what);
}

/** A model's size set (`modelResized`). */
function modelResize(
  before: TourDocumentState,
  payload: { id: string; sizeM: number; what: string },
): TourDocumentState {
  const { sizeM } = payload;
  const object = documentObjects(before).find(
    (o) => o.object.id === payload.id,
  )?.object;
  if (
    object?.kind !== "model" ||
    !(sizeM >= TOUR_MODEL_MIN_SIZE_M && sizeM <= TOUR_MODEL_MAX_SIZE_M) ||
    object.sizeM === sizeM
  ) {
    return before;
  }
  return putObject(before, { ...object, sizeM }, payload.what);
}

/** What a settle hands the document (`settleApplied`). */
interface SettleApplied {
  readonly changes: readonly SettleChange[];
  /** The codes it re-minted or improved, saved in this order. */
  readonly codes: readonly LevelText[];
  /** The code in hand after them (its text wins, `withHand`). */
  readonly hand: LevelText | null;
  readonly what: string;
}

/** A settle's changes and codes as ONE step (plan M3b, Q-D): each change
 *  by its own rule in order, then the codes saved, the hand's text
 *  winning; the step keeps each code's earlier text, so its undo puts it
 *  back. `before` when it moves nothing and changes no saved text. */
function applySettle(
  before: TourDocumentState,
  { changes, codes, hand, what }: SettleApplied,
): TourDocumentState {
  if (before.written === null) return before;
  let moved = before;
  for (const change of changes) {
    moved =
      change.kind === "station"
        ? stationMove(moved, change.stationId, change.geo, what)
        : objectMove(moved, {
            object: change.object,
            what,
            newStationId: change.newStationId,
          });
  }
  const was = bookOf(before.codes);
  let book = was;
  for (const level of codes) book = withSaved(book, level);
  const coded = withBook(before, book, hand).codes;
  // Undone: each code back from its new text to the one it had.
  const stepCodes = coded.book.flatMap((code): StepCode[] => {
    const earlier = was.get(code.levelId)?.saved ?? null;
    return code.saved === earlier
      ? []
      : [{ id: code.levelId, from: code.saved, to: earlier }];
  });
  if (moved === before && stepCodes.length === 0) return before;
  const after = edited(
    before,
    {
      placed: moved.placed,
      stations: moved.stations,
      touched: moved.touched,
      stationsRecorded: moved.stationsRecorded,
      codes: coded,
    },
    what,
  );
  if (stepCodes.length === 0) return after;
  const past = [...after.past];
  const last = past.pop();
  if (last !== undefined) past.push({ ...last, codes: stepCodes });
  return { ...after, past };
}

const tourDocumentSlice = createSlice({
  name: "tourDocument",
  initialState: initialTourDocumentState,
  reducers: {
    /** A tour opened: everything before it is gone. A tour without an id
     *  of its own takes `newTourId` (debug-captures plan, Q-I): minted here once, by the page that opens it (a reducer draws
     *  no random numbers), so every write carries it and a file saved from
     *  this tour is known by it (`tour-file-key.ts`). `opened` stays the
     *  file's tour as read (the draft's hosted comparisons read it). */
    opened(
      state,
      action: PayloadAction<{ manifest: TourManifest; newTourId?: string }>,
    ) {
      const { manifest, newTourId } = action.payload;
      // `opened` stays the file's tour as read; the writes start from
      // `written`, which carries the id.
      const written =
        manifest.tourId === undefined && newTourId !== undefined
          ? { ...manifest, tourId: newTourId }
          : manifest;
      return {
        ...initialTourDocumentState,
        generation: state.generation + 1,
        save: slotKept(state.save),
        codes: plain(state).codes,
        opened: manifest,
        written,
        stations: framesOf(manifest),
        needsNoGps: manifest.needsNoGps === true,
        details: detailsOf(manifest),
      };
    },
    /** A new object (placed in AR, or on the map): not for an id the
     *  tour carries, nor naming a station the document lacks or beyond its
     *  reach (`canPlace`). One naming no station is seated by the station
     *  rule (`seatByRule`): the station that holds it, or a new one
     *  anchored at it under the payload's `newStationId` - always one
     *  under "New station here" (`newStation`). */
    placed: {
      reducer(state, action: PayloadAction<PlacedPayload>) {
        const before = plain(state);
        const { object, what } = action.payload;
        if (!canPlace(before, object)) return before;
        if (
          action.payload.newStation !== true &&
          object.station !== undefined
        ) {
          return putObject(before, object, what);
        }
        const seated = seatByRule(before, unseated(object), action.payload);
        if (seated === null) return before;
        return putObject(before, seated.object, what, seated.stations);
      },
      prepare: prepareSeating,
    },
    /** A pin's text edited (`objectFits`): it keeps its station. One
     *  naming no station, of an id the document lacks, changes nothing: it
     *  would be an object in no station. */
    edited(state, action: PayloadAction<{ object: TourObject; what: string }>) {
      const before = plain(state);
      const { object, what } = action.payload;
      if (!objectFits(before, object)) return before;
      const station = object.station ?? homeOf(before, object.id);
      if (station === undefined) return before;
      return putObject(before, { ...object, station }, what);
    },
    /** An object moved (on the map, or in AR). Within its station's own
     *  found radius and the format's reach it keeps its station (whose
     *  anchor stays put), and so does one within the radius and its
     *  tolerance, or already outside it and moved no farther out
     *  (`keepsHome`); otherwise the station rule
     *  runs again (`seatByRule`): it joins the station holding its new
     *  spot, or starts one there under the payload's `newStationId`, and
     *  the station it left goes when that leaves it an empty automatic
     *  one. With `newStation` it starts its own station in any case, and
     *  with `afterHome` too that station stands right after the one it
     *  left (in its place when that one goes), its order recorded for the
     *  draft. An unknown id changes nothing. */
    moved: {
      reducer(state, action: PayloadAction<PlacedPayload>) {
        return objectMove(plain(state), action.payload);
      },
      prepare: prepareSeating,
    },
    /** An object deleted: its entry goes, a written one gets a tombstone;
     *  the station it leaves goes too when that leaves it an empty
     *  automatic one (`withoutEmptied`) - in the same step, so an undo
     *  brings both back. */
    deleted(state, action: PayloadAction<{ id: string; what: string }>) {
      const before = plain(state);
      const found = documentObjects(before).find(
        (o) => o.object.id === action.payload.id,
      );
      if (found === undefined) return before;
      const gone = deleteObject(before, found);
      const after = { ...before, placed: gone.placed, deleted: gone.deleted };
      return edited(
        before,
        {
          placed: gone.placed,
          deleted: gone.deleted,
          stations: withoutEmptied(after, [found.object.station]),
        },
        action.payload.what,
      );
    },
    /** A station's frame moved (D17): its items move rigidly with it, each
     *  an edit at the spot the moved frame gives it. */
    stationMoved(
      state,
      action: PayloadAction<{
        stationId: string;
        geo: QrGeoPose;
        what: string;
      }>,
    ) {
      const { stationId, geo, what } = action.payload;
      return stationMove(plain(state), stationId, geo, what);
    },
    /** A station's title, found radius (the preload radius twice it),
     *  description or card image set, by the format's rules
     *  (`stationEditChange`): one step; a refused or unchanged edit, or an
     *  unknown station, changes nothing. */
    stationEdited(
      state,
      action: PayloadAction<{
        stationId: string;
        edit: StationEdit;
        what: string;
      }>,
    ) {
      return stationEdit(plain(state), action.payload);
    },
    /** A station added at `at`, untitled (the tree names it by its
     *  number), with the automatic radii and nothing in it: it keeps
     *  itself as added by hand (`handMade`). Its id is minted outside the
     *  reducer; a taken id or a point off the globe changes nothing. */
    stationAdded: {
      reducer(
        state,
        action: PayloadAction<{
          at: StationPoint;
          stationId: string;
          what: string;
        }>,
      ) {
        return stationAdd(plain(state), action.payload);
      },
      prepare(input: { at: StationPoint; what: string; stationId?: string }) {
        return {
          payload: { ...input, stationId: input.stationId ?? newObjectId() },
        };
      },
    },
    /** A station deleted with its items, and every route to it pruned (a
     *  `next`, a quiz's targets): one step. Not the tour's last station,
     *  nor one it lacks (`stationDeleteRefusal`). */
    stationDeleted(
      state,
      action: PayloadAction<{ stationId: string; what: string }>,
    ) {
      return stationDelete(plain(state), action.payload);
    },
    /** The stations in `order`, which must name each of them once: one
     *  step; the same order changes nothing. */
    stationsReordered(
      state,
      action: PayloadAction<{ order: readonly string[]; what: string }>,
    ) {
      return stationsReorder(plain(state), action.payload);
    },
    /** A station copied beside itself (`duplicateStationGeo`) right after
     *  it, titled "... copy" (shortened to fit), a card image of its own
     *  photo dropped (one of an image asset kept), its steps and routes
     *  kept and its items copied rigidly under the new ids the page gives:
     *  one step. A taken id, or an item without a new id, changes nothing. */
    stationDuplicated: {
      reducer(state, action: PayloadAction<StationDuplicatePayload>) {
        return stationDuplicate(plain(state), action.payload);
      },
      prepare(
        input: Omit<
          StationDuplicatePayload,
          "newStationId" | "createdAtIso"
        > & {
          readonly newStationId?: string;
          readonly createdAtIso?: string;
        },
      ): { payload: StationDuplicatePayload } {
        return {
          payload: {
            ...input,
            newStationId: input.newStationId ?? newObjectId(),
            createdAtIso: input.createdAtIso ?? new Date().toISOString(),
          },
        };
      },
    },
    /** An item copied 1.5 m east of itself in its own station, its label
     *  marked as a copy: one step. A taken id, or a spot the station cannot
     *  carry, changes nothing. */
    objectDuplicated: {
      reducer(
        state,
        action: PayloadAction<{
          id: string;
          newId: string;
          createdAtIso: string;
          geo?: QrGeoPose;
          what: string;
        }>,
      ) {
        return objectDuplicate(plain(state), action.payload);
      },
      prepare(input: {
        id: string;
        what: string;
        newId?: string;
        createdAtIso?: string;
        geo?: QrGeoPose;
      }) {
        return {
          payload: {
            ...input,
            newId: input.newId ?? newObjectId(),
            createdAtIso: input.createdAtIso ?? new Date().toISOString(),
          },
        };
      },
    },
    /** Items put at the given altitudes (on the ground the page measured),
     *  each in its station: ONE step for all of them. An unknown id, an
     *  altitude that is no number or beyond a station's reach refuses the
     *  whole; altitudes they already have change nothing. */
    itemsGrounded(
      state,
      action: PayloadAction<{
        items: readonly { readonly id: string; readonly alt: number }[];
        what: string;
      }>,
    ) {
      return itemsGround(plain(state), action.payload);
    },
    /** A model's size (its largest side) set, from 0.05 m to 500 m: one
     *  step. Not for another kind, an unknown id, or a size out of bounds. */
    modelResized(
      state,
      action: PayloadAction<{ id: string; sizeM: number; what: string }>,
    ) {
      return modelResize(plain(state), action.payload);
    },
    /** A settle (plan M3b, Q-D): its station and object moves in its own
     *  order and the codes it re-minted, as ONE step - its undo takes them
     *  all back, each code's earlier text included (`applySettle`). The
     *  hand is named after the codes, as every code action names it. */
    settleApplied(state, action: PayloadAction<SettleApplied>) {
      return applySettle(plain(state), action.payload);
    },
    /** The setting turned on or off; nothing before an open (an undo
     *  could never take the step back: a step needs a written file). */
    settingsChanged(
      state,
      action: PayloadAction<{ needsNoGps: boolean; what: string }>,
    ) {
      const before = plain(state);
      if (before.written === null) return before;
      if (action.payload.needsNoGps === before.needsNoGps) return before;
      return edited(
        before,
        {
          needsNoGps: action.payload.needsNoGps,
          touched: { ...before.touched, needsNoGps: true },
        },
        action.payload.what,
      );
    },
    /** The details replaced, as checked (`checkDetailsForm`); nothing
     *  before an open, as for the setting. */
    detailsChanged(
      state,
      action: PayloadAction<{ details: TourDetailFields; what: string }>,
    ) {
      const before = plain(state);
      if (before.written === null) return before;
      return edited(
        before,
        {
          details: action.payload.details,
          touched: { ...before.touched, details: true },
          detailsRecorded: true,
        },
        action.payload.what,
      );
    },
    /** One step back - not while a save runs (`canStep`). */
    undone(state) {
      const before = plain(state);
      return canStep(before) ? step(before, "undo") : before;
    },
    redone(state) {
      const before = plain(state);
      return canStep(before) ? step(before, "redo") : before;
    },
    /** A draft's work put back: one step to undo. The frames first (the
     *  poses, then the created stations the document lacks), then each
     *  object: in its own station when the document carries it and it
     *  fits there, else seated by the station rule under its minted id (a
     *  station a draft no longer has, or work carried into another tour,
     *  `rerun`); then the deletions. A station this leaves an empty
     *  automatic one goes (`withoutEmptied`). */
    restored: {
      reducer(state, action: PayloadAction<TourRestorePayload>) {
        const plainBefore = plain(state);
        if (plainBefore.written === null) return plainBefore;
        const work = action.payload;
        const poses = new Map((work.stations ?? []).map((p) => [p.id, p.geo]));
        let posed = plainBefore.stations.map((s) => {
          const geo = poses.get(s.id);
          return geo === undefined ? s : { ...s, geo };
        });
        const writtenAssets = new Set(
          plainBefore.written.assets.map((a) => a.id),
        );
        // A frame whose story names an asset the tour lacks is left out:
        // the format refuses it, so every later save would fail.
        const fits = (frame: StationFrame): boolean =>
          stepAssetIds(frame).every((id) => writtenAssets.has(id));
        const recorded = (work.frames ?? []).filter(fits);
        const replaced = new Map(recorded.map((f) => [f.id, f]));
        // A recorded frame the document carries is an edit beyond its pose:
        // it takes the document's pose (the file's, or the draft's poses'
        // record above), never the one the frame was recorded at.
        posed = [
          ...posed.map((s) => {
            const frame = replaced.get(s.id);
            return frame === undefined ? s : { ...frame, geo: s.geo };
          }),
          ...recorded.filter((f) => !posed.some((s) => s.id === f.id)),
        ];
        const known = new Set(posed.map((f) => f.id));
        const created: StationFrame[] = [];
        for (const frame of work.createdStations ?? []) {
          if (known.has(frame.id) || !fits(frame)) continue;
          known.add(frame.id);
          created.push(frame);
        }
        // Stations the draft's page added by hand keep themselves here as
        // there (before anything below asks whether one emptied).
        const handMade = [
          ...plainBefore.handMade,
          ...(work.handMadeStations ?? []).filter(
            (id) => known.has(id) && !plainBefore.handMade.includes(id),
          ),
        ];
        let next: TourDocumentState = {
          ...plainBefore,
          stations: [...posed, ...created],
          handMade,
        };
        /** Stations an object or a delete may have left empty. */
        const left: (string | undefined)[] = created.map((f) => f.id);
        for (const [i, given] of work.objects.entries()) {
          // The deletion of its id would hide it (as for a placement,
          // `canPlace`), and a station started for it would stand empty.
          if (next.deleted.includes(given.id)) continue;
          const home = homeOf(next, given.id);
          left.push(home);
          const named = work.rerun === true ? undefined : given.station;
          const own = named ?? (work.rerun === true ? undefined : home);
          const object =
            own === undefined ? unseated(given) : { ...given, station: own };
          const newStationId = work.newStationIds[i];
          const seated =
            own !== undefined && objectFits(next, object)
              ? { object, stations: next.stations }
              : newStationId === undefined
                ? null
                : seatByRule(next, unseated(given), { newStationId });
          if (seated === null) continue;
          next = {
            ...next,
            stations: seated.stations,
            placed: upsertPlaced(next.placed, { object: seated.object }),
          };
        }
        for (const id of work.deleted) {
          const found = documentObjects(next).find((o) => o.object.id === id);
          if (found === undefined) continue;
          left.push(found.object.station);
          const gone = deleteObject(next, found);
          next = { ...next, placed: gone.placed, deleted: gone.deleted };
        }
        next = restoredStations(next, work);
        return edited(
          plainBefore,
          {
            placed: next.placed,
            deleted: next.deleted,
            deletedStations: next.deletedStations,
            stations: withoutEmptied(next, left),
            handMade,
            ...(work.stations === undefined ? {} : { stationsRecorded: true }),
            ...(recordsStations(work) ? { framesRecorded: true } : {}),
            ...(work.needsNoGps === undefined
              ? {}
              : { needsNoGps: work.needsNoGps }),
            ...(work.details === undefined
              ? {}
              : { details: work.details, detailsRecorded: true }),
          },
          work.what,
        );
      },
      prepare(
        input: TourRestore & {
          readonly what: string;
          readonly newStationIds?: readonly string[];
        },
      ): { payload: TourRestorePayload } {
        return {
          payload: {
            ...input,
            newStationIds:
              input.newStationIds ?? input.objects.map(() => newObjectId()),
          },
        };
      },
    },
    /** A rebuild was queued: undo and redo wait until it ends. */
    saveStarted(state, action: PayloadAction<{ generation: number }>) {
      const before = plain(state);
      if (action.payload.generation !== before.generation) return before;
      return {
        ...before,
        save: saveWith(before.save, { rebuilds: before.save.rebuilds + 1 }),
      };
    },
    /** A write landed: its manifest is the written file now, and what it
     *  carries is no longer pending (edits made while it ran stay). Its
     *  frames become the document's unless one moved while it ran. Ignored
     *  for a tour opened since the write began. */
    saved(state, action: PayloadAction<TourSaved>) {
      const before = plain(state);
      const { written, appliedDeletions, stationsAtStart, generation } =
        action.payload;
      if (generation !== before.generation) return before;
      // A station started while the write ran (a pin placed meanwhile) is
      // not a moved frame: the write lacks it, and it stays the
      // document's beside the written ones - or its pin would name nothing.
      const atStart = new Set(stationsAtStart.map((f) => f.id));
      const startedSince = before.stations.filter((f) => !atStart.has(f.id));
      const unmoved = sameJson(
        before.stations.filter((f) => atStart.has(f.id)),
        stationsAtStart,
      );
      // A frame moved (or dropped) while the write ran stays the
      // document's: what the file holds is read through it, as
      // `documentObjects` will read it.
      const pending = pendingAfterRebuild(
        before,
        unmoved
          ? written
          : withFrames(
              written,
              before.stations,
              before.placed,
              [],
              before.deletedStations,
              keptStationsOf(before),
            ),
        appliedDeletions,
      );
      return {
        ...before,
        written,
        placed: pending.placed,
        deleted: pending.deleted,
        // A station the write left out is gone for good; one deleted while
        // it ran is still to be left out.
        deletedStations: before.deletedStations.filter((id) =>
          written.stations.some((s) => s.id === id),
        ),
        stations: unmoved
          ? [...framesOf(written), ...startedSince]
          : before.stations,
        // An in-place write names its view once it arrives
        // (`saveDelivered`); a download leaves no in-place file.
        save: saveWith(
          before.save,
          action.payload.inPlaceAt === undefined
            ? { inPlaceAt: null, inPlaceWriting: null }
            : { inPlaceWriting: action.payload.inPlaceAt },
        ),
      };
    },
    /** A queued rebuild ended, landed or not (`error`: why it failed). */
    saveEnded(
      state,
      action: PayloadAction<{ generation: number; error?: string }>,
    ) {
      const before = plain(state);
      if (action.payload.generation !== before.generation) return before;
      return {
        ...before,
        save: saveWith(before.save, {
          rebuilds: Math.max(0, before.save.rebuilds - 1),
          error: action.payload.error ?? null,
        }),
      };
    },
    /** A page took its one save slot (a save, a step of the walk's move,
     *  or a copy). */
    saveClaimed(state, action: PayloadAction<{ by: TourSaveHolder }>) {
      const before = plain(state);
      const { by } = action.payload;
      return {
        ...before,
        // A save claimed after a step writes the document as it stands
        // then, or says why it could not: the resave is taken on (D33). A
        // copy writes another file: the tour's own stays due, and the last
        // save's error stays said.
        save: saveWith(
          before.save,
          by === "copy" ? { by } : { by, error: null, resave: false },
        ),
      };
    },
    /** The page let its save slot go; `error` says why the save failed.
     *  An in-place write that has not arrived by then never did: the disk
     *  keeps the view it held (`inPlaceAt`), and the build's view stays
     *  named (`inPlaceWriting`) for a retry that re-delivers it. */
    saveReleased(state, action: PayloadAction<{ error?: string }>) {
      const before = plain(state);
      return {
        ...before,
        save: saveWith(before.save, {
          by: null,
          ...(action.payload.error === undefined
            ? {}
            : { error: action.payload.error }),
        }),
      };
    },
    /** An explicit Save waits for the autosave that runs (or no longer). */
    saveQueued(state, action: PayloadAction<{ queued: boolean }>) {
      const before = plain(state);
      return {
        ...before,
        save: saveWith(before.save, { queued: action.payload.queued }),
      };
    },
    /** A save of this tour was built. */
    saveBuilt(state) {
      const before = plain(state);
      return { ...before, save: saveWith(before.save, { built: true }) };
    },
    /** A save arrived: in place or as a download, under `name`. */
    saveDelivered(
      state,
      action: PayloadAction<{ inPlace: boolean; name: string }>,
    ) {
      const before = plain(state);
      return {
        ...before,
        save: saveWith(before.save, {
          delivered: action.payload,
          error: null,
          // The in-place write arrived: the disk holds its view now.
          ...(action.payload.inPlace && before.save.inPlaceWriting !== null
            ? { inPlaceAt: before.save.inPlaceWriting, inPlaceWriting: null }
            : {}),
        }),
      };
    },
    /** What the opened file allows: too large to save by itself, or no
     *  longer readable. */
    saveLimited(
      state,
      action: PayloadAction<{ largeTour?: boolean; cannotSave?: boolean }>,
    ) {
      const before = plain(state);
      return {
        ...before,
        save: saveWith(before.save, {
          ...(action.payload.largeTour === undefined
            ? {}
            : { largeTour: action.payload.largeTour }),
          ...(action.payload.cannotSave === undefined
            ? {}
            : { cannotSave: action.payload.cannotSave }),
        }),
      };
    },
    /** "New station here" armed or disarmed (D8): no edit of the tour. */
    newStationArmed(state, action: PayloadAction<{ armed: boolean }>) {
      const before = plain(state);
      if (before.newStationArmed === action.payload.armed) return before;
      return { ...before, newStationArmed: action.payload.armed };
    },
    /** The tour closed without another opening (a late integrity
     *  failure): nothing of it stays, and its sessions' late answers land
     *  nowhere. */
    closed(state) {
      return {
        ...initialTourDocumentState,
        generation: state.generation + 1,
        save: slotKept(state.save),
        codes: plain(state).codes,
      };
    },
    // --- the codes (debug-captures plan M3a) -------------------------------
    // No history step, no draft write, and not reset by `opened` or
    // `closed`: the hosted levels are held per open (`levelsArrived`), and
    // the book goes at a tour's close (`codesForgotten`). Each change of the
    // book names the code in hand after it (`hand`), whose text wins for
    // its own code (`withHand`); `creatorCodes` takes the hand from the same
    // action.
    /** `level` taken in hand with its measurement (null: a stored
     *  reference, saved and taken as one); no level: the hand empties, and
     *  the book is as it was. */
    codeTaken(
      state,
      action: PayloadAction<{
        level: LevelText | null;
        measurement: CodeMeasurement | null;
      }>,
    ) {
      const before = plain(state);
      const { level, measurement } = action.payload;
      if (level === null) return before;
      const book = bookOf(before.codes);
      return withBook(
        before,
        measurement === null
          ? withReference(withSaved(book, level), level.id)
          : withMeasurement(book, level, measurement),
        level,
      );
    },
    /** A restored draft's level taken into the empty hand, at the text the
     *  page gives (its live text where it has one, `codeLiveText`). */
    codeTakenFromDraft(state, action: PayloadAction<{ level: LevelText }>) {
      const before = plain(state);
      const { level } = action.payload;
      return withBook(
        before,
        withReference(withSaved(bookOf(before.codes), level), level.id),
        level,
      );
    },
    /** Nothing in hand (a new print size): the code it held (`levelId`) is
     *  measured again, so its measurement goes and its saved text falls
     *  back to the zip's. */
    codeLetGo(state, action: PayloadAction<{ levelId: string | null }>) {
      const before = plain(state);
      const { levelId } = action.payload;
      if (levelId === null) return before;
      return withBook(
        before,
        withoutMeasurement(bookOf(before.codes), levelId),
        null,
      );
    },
    /** A code not in hand measured again: its measurement is dropped and
     *  its saved text falls back to the zip's. */
    codeMeasurementDropped(
      state,
      action: PayloadAction<{ levelId: string; hand: LevelText | null }>,
    ) {
      const before = plain(state);
      const { levelId, hand } = action.payload;
      return withBook(
        before,
        withoutMeasurement(bookOf(before.codes), levelId),
        hand,
      );
    },
    /** A code re-minted by the settle: saved; `hand` takes it only if it
     *  already held that code. */
    codeSaved(
      state,
      action: PayloadAction<{ level: LevelText; hand: LevelText | null }>,
    ) {
      const before = plain(state);
      const { level, hand } = action.payload;
      return withBook(before, withSaved(bookOf(before.codes), level), hand);
    },
    /** A restored draft's codes, saved and taken as references; a code
     *  changed live in this page keeps its live text (`withDraft`, judged
     *  against the hosted texts as they stand). */
    codesRestored(
      state,
      action: PayloadAction<{
        levels: readonly LevelText[];
        hand: LevelText | null;
      }>,
    ) {
      const before = plain(state);
      const { levels, hand } = action.payload;
      return withBook(
        before,
        withDraft(
          bookOf(before.codes),
          levels,
          hostedLevelTexts(before) ?? undefined,
        ),
        hand,
      );
    },
    /** A Finish wrote `written`: the hosted texts enter the book, and each
     *  written text is what the next Finish builds on. */
    codesFinished(
      state,
      action: PayloadAction<{
        written: readonly LevelText[];
        hand: LevelText | null;
      }>,
    ) {
      const before = plain(state);
      const { written, hand } = action.payload;
      return withBook(
        before,
        afterFinish(withHostedTexts(before), written),
        hand,
      );
    },
    /** The hand lets go of `levelIds` (an undo took their saved texts
     *  back): the book is as it is; `creatorCodes` empties a hand that
     *  holds one of them. */
    handReleased(
      state,
      _action: PayloadAction<{ levelIds: readonly string[] }>,
    ) {
      return plain(state);
    },
    /** A tour closed: its book goes (the hosted levels are the open's,
     *  `levelsCleared`). */
    codesForgotten(state) {
      const before = plain(state);
      if (before.codes.book.length === 0) return before;
      return { ...before, codes: { ...before.codes, book: [] } };
    },
    /** The open `session`'s level files arrived (`TourSession.levelTexts`):
     *  in either order with `opened`, and dropped for an older open. */
    levelsArrived(
      state,
      action: PayloadAction<{ session: number; texts: readonly LevelText[] }>,
    ) {
      const { session, texts } = action.payload;
      return withHostedLevels(plain(state), session, {
        texts,
        unreadable: false,
      });
    },
    /** The open `session`'s level files could not be read: they never
     *  come. */
    levelsUnreadable(state, action: PayloadAction<{ session: number }>) {
      return withHostedLevels(plain(state), action.payload.session, {
        texts: null,
        unreadable: true,
      });
    },
    /** A tour closed, and `session` opens next: no level texts yet (a
     *  newer open has no parsed levels either). */
    levelsCleared(state, action: PayloadAction<{ session: number }>) {
      return withHostedLevels(plain(state), action.payload.session, {
        texts: null,
        unreadable: false,
      });
    },
    /** The open `session`'s levels as they parsed, in the zip's order
     *  (null: none, the tour closing); dropped for an older open. */
    levelsParsed(
      state,
      action: PayloadAction<{
        session: number;
        levels: readonly ParsedLevel[] | null;
      }>,
    ) {
      const { session, levels } = action.payload;
      return withHostedLevels(plain(state), session, { parsed: levels });
    },
  },
});

/** The slice's actions, as a namespace: `tourDocumentActions.placed`
 *  (the phone's `tourAuthoring` slice has an `objectPlaced` of its own). */
export const tourDocumentActions = tourDocumentSlice.actions;

export const tourDocumentReducer = tourDocumentSlice.reducer;

/** Whether `action` changes what the document holds (not its file):
 *  the actions a page's draft follows. A landed save is not one - it
 *  takes entries off the pending list, which a draft must not read as
 *  forgotten work. */
export const isDocumentEdit = isAnyOf(
  tourDocumentActions.placed,
  tourDocumentActions.edited,
  tourDocumentActions.moved,
  tourDocumentActions.deleted,
  tourDocumentActions.stationMoved,
  tourDocumentActions.stationEdited,
  tourDocumentActions.stationAdded,
  tourDocumentActions.stationDeleted,
  tourDocumentActions.stationsReordered,
  tourDocumentActions.stationDuplicated,
  tourDocumentActions.objectDuplicated,
  tourDocumentActions.itemsGrounded,
  tourDocumentActions.modelResized,
  tourDocumentActions.settleApplied,
  tourDocumentActions.settingsChanged,
  tourDocumentActions.detailsChanged,
  tourDocumentActions.undone,
  tourDocumentActions.redone,
  tourDocumentActions.restored,
);

/** Whether `action` changes the codes a draft keeps (plan M3b): the
 *  book's saved texts or the code in hand. Not a tour's close
 *  (`codesForgotten`): the closed tour's codes stay in its draft. */
export const isCodeChange = isAnyOf(
  tourDocumentActions.codeTaken,
  tourDocumentActions.codeTakenFromDraft,
  tourDocumentActions.codeLetGo,
  tourDocumentActions.codeMeasurementDropped,
  tourDocumentActions.codeSaved,
  tourDocumentActions.codesRestored,
  tourDocumentActions.codesFinished,
  tourDocumentActions.handReleased,
);

/** The slice inside a store's state. */
export function selectTourDocument(root: {
  readonly tourDocument: TourDocumentState;
}): TourDocumentState {
  return root.tourDocument;
}
