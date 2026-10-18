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
import { tourImageIds } from "gps-plus-slam-app-framework/ar/tour-details";
import { TOUR_ITEM_MAX_OFFSET_M } from "gps-plus-slam-app-framework/ar/tour-items";
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
import { hostedObjects } from "./authoring-draft.js";
import { finishedManifest, pendingAfterRebuild } from "./finish-rebuild.js";
import {
  authoringObjects,
  deleteObject,
  upsertPlaced,
  type AuthoringObject,
  type EditEntry,
} from "./object-edits.js";
import {
  DETAIL_FIELDS,
  detailsOf,
  withDetails,
  type TourDetailFields,
} from "./tour-details-form.js";
import type { CaptureSpotsInWorld } from "./tour-content.js";

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
}

/** One step of the history: the view to go back (or forward) to, and the
 *  edit in words ("the move of "Fountain""). */
interface TourHistoryStep {
  readonly view: TourDocumentView;
  readonly what: string;
}

/** Who holds a page's one save slot: an explicit Save, the autosave, or
 *  a step of the walk's move. */
export type TourSaveHolder = "explicit" | "auto" | "walk";

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
  readonly past: readonly TourHistoryStep[];
  readonly future: readonly TourHistoryStep[];
  /** Counts every edit, undo and redo. */
  readonly revision: number;
  readonly save: TourSaveStatus;
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
  past: [],
  future: [],
  revision: 0,
  save: IDLE,
};

// --- the pure rules ---------------------------------------------------------

/** A manifest's stations without their items. */
export function framesOf(manifest: TourManifest): StationFrame[] {
  return manifest.stations.map(({ items: _items, ...frame }) => frame);
}

/**
 * `written` with the document's station frames: each frame carries the
 * written items of its station (none for a station the file lacks); a
 * frame the file lacks is kept only while an edit names it (an undo
 * brought back an object whose emptied station a save dropped - it comes
 * back where it stood, M5a review M2); a written station no frame names
 * (an automatic one a save added after the step went back) follows, so
 * its items keep their home until a write prunes it.
 */
function withFrames(
  written: TourManifest,
  frames: readonly StationFrame[],
  placed: readonly EditEntry[],
): TourManifest {
  const byId = new Map(written.stations.map((s) => [s.id, s]));
  const named = new Set(placed.map((p) => p.object.station));
  const listed = new Set(frames.map((f) => f.id));
  return {
    ...written,
    stations: [
      ...frames.flatMap((frame) => {
        const own = byId.get(frame.id);
        if (own === undefined && !named.has(frame.id)) return [];
        return [{ ...frame, items: own?.items ?? [] }];
      }),
      ...written.stations.filter((s) => !listed.has(s.id)),
    ],
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
    : withFrames(state.written, state.stations, state.placed);
}

/** The tour's objects now, each with this page's entry for it. */
export function documentObjects(state: TourDocumentState): AuthoringObject[] {
  const base = framed(state);
  if (base === null) return [];
  return authoringObjects(tourObjects(base), state.placed, state.deleted);
}

/** The details as shown and written: a cover whose image is gone (a
 *  deleted photo) is none, and comes back with an undo of the delete. */
export function effectiveDetails(state: TourDocumentState): TourDetailFields {
  const { details } = state;
  if (details.cover === undefined) return details;
  const ids = tourImageIds({
    objects: documentObjects(state).map((o) => o.object),
    assets: state.written?.assets ?? [],
  });
  if (ids.has(details.cover)) return details;
  const { cover: _gone, ...rest } = details;
  return rest;
}

/** The manifest the next write starts from: the written tour with the
 *  frames, the setting and the details (`rebuildFinishedTour`'s
 *  `manifest`); null before any open. */
export function manifestNow(state: TourDocumentState): TourManifest | null {
  const base = framed(state);
  if (base === null) return null;
  return withDetails(
    withNeedsNoGps(base, state.needsNoGps),
    effectiveDetails(state),
  );
}

/** The manifest a write carries now (the Finish's rule,
 *  `finishedManifest`): what a save would write, without the zip.
 *  `captureSpots` is the save's own input (the walk's photo spots, which
 *  a page decides once per open, `captureSpotsForRebuild`): given the same,
 *  this is the manifest the save writes (the r875 milestone review #7). */
export function manifestToWrite(
  state: TourDocumentState,
  captureSpots?: CaptureSpotsInWorld,
): TourManifest | null {
  const base = manifestNow(state);
  if (base === null) return null;
  return finishedManifest({
    manifest: base,
    placed: state.placed,
    deleted: state.deleted,
    ...(captureSpots === undefined ? {} : { captureSpots }),
  });
}

/** The entries whose content the written file does not carry yet, read
 *  through the document's frames (`contentAt`): a note the file holds at
 *  its spot under a frame that moved since is pending. */
export function unsavedEntries(state: TourDocumentState): EditEntry[] {
  if (state.written === null) return [];
  const hosted = hostedObjects(withFrames(state.written, state.stations, []));
  return state.placed.filter((p) => !hosted.holds(p.object));
}

// --- the rules the reducers keep -----------------------------------------
// A dispatch that breaks one changes nothing; a page says why in its own
// words by asking the same guard first.

/** Whether `geo` fits the frame of the station `stationId` names, as the
 *  format bounds it (`TOUR_ITEM_MAX_OFFSET_M` per axis); true for a
 *  station the document does not carry (a write recreates that one where
 *  the object stands, `tour-content.ts`). */
export function fitsStation(
  geo: TourObject["geo"],
  stationId: string | undefined,
  stations: readonly StationFrame[],
): boolean {
  const station = stations.find((s) => s.id === stationId);
  if (station === undefined) return true;
  return localPoseOf(geo, station.geo).position.every(
    (v) => Math.abs(v) <= TOUR_ITEM_MAX_OFFSET_M,
  );
}

/** Whether `object` fits its station's frame - its own, or, without one,
 *  the station the document's object of that id stands in. */
export function objectFits(
  state: TourDocumentState,
  object: TourObject,
): boolean {
  const home =
    object.station ??
    documentObjects(state).find((o) => o.object.id === object.id)?.object
      .station;
  return fitsStation(object.geo, home, state.stations);
}

/** Whether `object` may be placed: an id the tour does not carry, at a
 *  spot its station can carry. */
export function canPlace(
  state: TourDocumentState,
  object: TourObject,
): boolean {
  return (
    documentObjects(state).every((o) => o.object.id !== object.id) &&
    objectFits(state, object)
  );
}

/** Whether an undo or a redo may run: not while a rebuild is queued or
 *  runs - the step is measured against the file it writes. */
export function canStep(state: TourDocumentState): boolean {
  return state.save.rebuilds === 0;
}

/** The same frame: every field but the items alike. */
function sameFrame(a: StationFrame, b: StationFrame | undefined): boolean {
  return b !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

/** Changes not yet written, counted as a page shows them: each object
 *  edited, placed or deleted, each station frame moved, the setting, and
 *  each detail field. */
export function changeCount(state: TourDocumentState): number {
  const written = state.written;
  if (written === null) return 0;
  const writtenFrames = new Map(framesOf(written).map((f) => [f.id, f]));
  const frames = state.stations.filter(
    (f) => writtenFrames.has(f.id) && !sameFrame(f, writtenFrames.get(f.id)),
  ).length;
  const now = effectiveDetails(state);
  const details = DETAIL_FIELDS.filter((f) => now[f] !== written[f]).length;
  return (
    unsavedEntries(state).length +
    state.deleted.length +
    frames +
    (state.needsNoGps !== (written.needsNoGps === true) ? 1 : 0) +
    details
  );
}

/** The document as an undo step keeps it. */
export function viewOf(state: TourDocumentState): TourDocumentView {
  return {
    stations: state.stations,
    objects: documentObjects(state).map((o) => o.object),
    needsNoGps: state.needsNoGps,
    details: state.details,
  };
}

/**
 * What the document holds at `view`, measured against the written file:
 * the objects the file does not hold as they are become entries, the
 * file's objects the view lacks become deletions. "As they are" is read
 * through the VIEW's frames, as `documentObjects` reads it: an item the
 * file holds at a local pose under a frame the view moves elsewhere
 * stands elsewhere, so it needs an entry (a save under a moved frame,
 * then an undo of the move).
 */
function contentAt(
  written: TourManifest,
  view: TourDocumentView,
): { placed: EditEntry[]; deleted: string[] } {
  const hosted = hostedObjects(withFrames(written, view.stations, []));
  const kept = new Set(view.objects.map((o) => o.id));
  return {
    placed: view.objects
      .filter((o) => !hosted.holds(o))
      .map((object) => ({ object })),
    deleted: tourObjects(written)
      .filter((o) => !kept.has(o.id))
      .map((o) => o.id),
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
  return contentAt(state.written, view)
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
  return {
    ...before,
    ...next,
    past,
    future: [],
    revision: before.revision + 1,
  };
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
  const stationsMoved =
    JSON.stringify(view.stations) !== JSON.stringify(state.stations);
  return {
    ...state,
    ...contentAt(state.written, view),
    stations: view.stations,
    needsNoGps: view.needsNoGps,
    details: view.details,
    touched: {
      needsNoGps: state.touched.needsNoGps || settingMoved,
      details: state.touched.details || detailsMoved,
      stations: state.touched.stations || stationsMoved,
    },
    detailsRecorded: state.detailsRecorded || detailsMoved,
    stationsRecorded: state.stationsRecorded || stationsMoved,
  };
}

/** A step from one end of the history to the other. */
function step(
  state: TourDocumentState,
  which: "undo" | "redo",
): TourDocumentState {
  const target = nextStep(state, which);
  if (target === undefined || state.written === null) return state;
  const here: TourHistoryStep = { view: viewOf(state), what: target.what };
  const moved = goTo(state, target.view);
  const from = which === "undo" ? state.past : state.future;
  const to = which === "undo" ? state.future : state.past;
  const rest = from.slice(0, -1);
  const kept = [...to, here];
  return {
    ...moved,
    past: which === "undo" ? rest : kept,
    future: which === "undo" ? kept : rest,
    revision: state.revision + 1,
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
}

/** The written save that landed: the manifest the zip carries, the
 *  deletions it applied, and the frames it started from. */
interface TourSaved {
  readonly generation: number;
  readonly written: TourManifest;
  readonly appliedDeletions: readonly string[];
  readonly stationsAtStart: readonly StationFrame[];
}

/** A fresh save status that keeps who holds the page's save slot: the
 *  slot is the page's, and a save of the tour before lets it go itself
 *  once it sees the tour gone - until then the next tour waits, as the
 *  page's own flag made it wait before the store held it. */
function slotKept(save: TourSaveStatus): TourSaveStatus {
  return saveWith(IDLE, { by: save.by });
}

/** A new version of an object (or a new one): one entry per id. */
function putObject(
  before: TourDocumentState,
  action: PayloadAction<{ object: TourObject; what: string }>,
): TourDocumentState {
  if (before.written === null) return before;
  const { object, what } = action.payload;
  return edited(
    before,
    { placed: upsertPlaced(before.placed, { object }) },
    what,
  );
}

const tourDocumentSlice = createSlice({
  name: "tourDocument",
  initialState: initialTourDocumentState,
  reducers: {
    /** A tour opened: everything before it is gone. */
    opened(state, action: PayloadAction<{ manifest: TourManifest }>) {
      const { manifest } = action.payload;
      return {
        ...initialTourDocumentState,
        generation: state.generation + 1,
        save: slotKept(state.save),
        opened: manifest,
        written: manifest,
        stations: framesOf(manifest),
        needsNoGps: manifest.needsNoGps === true,
        details: detailsOf(manifest),
      };
    },
    /** A new object (placed in AR, or on the map): not for an id the
     *  tour carries, nor beyond its station's reach (`canPlace`). */
    placed(state, action: PayloadAction<{ object: TourObject; what: string }>) {
      const before = plain(state);
      if (!canPlace(before, action.payload.object)) return before;
      return putObject(before, action);
    },
    /** A pin's text edited (`objectFits`, as a move). */
    edited(state, action: PayloadAction<{ object: TourObject; what: string }>) {
      const before = plain(state);
      if (!objectFits(before, action.payload.object)) return before;
      return putObject(before, action);
    },
    /** An object moved (on the map, or in AR): not beyond its station's
     *  reach (`objectFits`). */
    moved(state, action: PayloadAction<{ object: TourObject; what: string }>) {
      const before = plain(state);
      if (!objectFits(before, action.payload.object)) return before;
      return putObject(before, action);
    },
    /** An object deleted: its entry goes, a written one gets a tombstone. */
    deleted(state, action: PayloadAction<{ id: string; what: string }>) {
      const before = plain(state);
      const found = documentObjects(before).find(
        (o) => o.object.id === action.payload.id,
      );
      if (found === undefined) return before;
      const gone = deleteObject(before, found);
      return edited(
        before,
        { placed: gone.placed, deleted: gone.deleted },
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
      const before = plain(state);
      const { stationId, geo, what } = action.payload;
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
    },
    settingsChanged(
      state,
      action: PayloadAction<{ needsNoGps: boolean; what: string }>,
    ) {
      const before = plain(state);
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
    /** The details replaced, as checked (`checkDetailsForm`). */
    detailsChanged(
      state,
      action: PayloadAction<{ details: TourDetailFields; what: string }>,
    ) {
      const before = plain(state);
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
    /** A draft's work put back: one step to undo. */
    restored(state, action: PayloadAction<TourRestore & { what: string }>) {
      const plainBefore = plain(state);
      const work = action.payload;
      const poses = new Map((work.stations ?? []).map((p) => [p.id, p.geo]));
      // The frames first: the objects' spots stand in them.
      const before: TourDocumentState = {
        ...plainBefore,
        stations: plainBefore.stations.map((s) => {
          const geo = poses.get(s.id);
          return geo === undefined ? s : { ...s, geo };
        }),
      };
      let placed = before.placed;
      let deleted = before.deleted;
      for (const object of work.objects) {
        // A draft written before far moves were refused may offer one; it
        // would make every save fail (the M5a milestone review L1).
        if (!objectFits(before, object)) continue;
        placed = upsertPlaced(placed, { object });
      }
      for (const id of work.deleted) {
        const found = documentObjects({ ...before, placed, deleted }).find(
          (o) => o.object.id === id,
        );
        if (found === undefined) continue;
        const gone = deleteObject({ placed, deleted }, found);
        placed = gone.placed;
        deleted = gone.deleted;
      }
      return edited(
        plainBefore,
        {
          placed,
          deleted,
          ...(work.stations === undefined
            ? {}
            : { stations: before.stations, stationsRecorded: true }),
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
      const unmoved =
        JSON.stringify(before.stations) === JSON.stringify(stationsAtStart);
      // A frame moved while the write ran stays the document's: what the
      // file holds is read through it, as `documentObjects` will read it.
      const pending = pendingAfterRebuild(
        before,
        unmoved ? written : withFrames(written, before.stations, before.placed),
        appliedDeletions,
      );
      return {
        ...before,
        written,
        placed: pending.placed,
        deleted: pending.deleted,
        stations: unmoved ? framesOf(written) : before.stations,
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
    /** A page took its one save slot (a save, or a step of the walk's
     *  move). */
    saveClaimed(state, action: PayloadAction<{ by: TourSaveHolder }>) {
      const before = plain(state);
      return {
        ...before,
        save: saveWith(before.save, { by: action.payload.by, error: null }),
      };
    },
    /** The page let its save slot go; `error` says why the save failed. */
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
    /** The tour closed without another opening (a late integrity
     *  failure): nothing of it stays, and its sessions' late answers land
     *  nowhere. */
    closed(state) {
      return {
        ...initialTourDocumentState,
        generation: state.generation + 1,
        save: slotKept(state.save),
      };
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
  tourDocumentActions.settingsChanged,
  tourDocumentActions.detailsChanged,
  tourDocumentActions.undone,
  tourDocumentActions.redone,
  tourDocumentActions.restored,
);

/** The slice inside a store's state. */
export function selectTourDocument(root: {
  readonly tourDocument: TourDocumentState;
}): TourDocumentState {
  return root.tourDocument;
}
