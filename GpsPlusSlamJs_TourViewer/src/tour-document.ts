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
import { hostedObjects, objectContentKey } from "./authoring-draft.js";
import { newObjectId } from "./content-placement.js";
import { finishedManifest, pendingAfterRebuild } from "./finish-rebuild.js";
import { horizontalM } from "./move-with-code.js";
import { stationHolding } from "./station-assign.js";
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
  objectAssetIds,
  routedTo,
  stepAssetIds,
} from "./tour-content.js";
import { sameJson } from "./same-json.js";

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
  /** The phone's "New station here" is armed (owner decision D8 of the
   *  editor round-2 plan): the next placed item starts its own station.
   *  An authoring flag of the page, not of the tour - no edit, no undo
   *  step, no draft write; gone with the tour (`opened`, `closed`). */
  readonly newStationArmed: boolean;
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
  position: 0,
  save: IDLE,
  newStationArmed: false,
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

/**
 * `written` with the document's station frames: each frame carries the
 * written items of its station (none for a station the file lacks); a
 * frame the file lacks is kept only while an edit names it (a station a
 * placement started, or an undo brought back an object whose emptied
 * station a save dropped - it comes back where it stood, M5a review M2); a
 * written station no frame names (an automatic one a save added after the
 * step went back) follows, so its items keep their home until a write
 * prunes it.
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
    withNeedsNoGps(base, state.needsNoGps),
    effectiveDetails(state),
  );
}

/**
 * The assets the undo and redo steps' views name - their stations' steps,
 * their objects and their covers: a write keeps them (`keepAssets`), so
 * a step back across a save finds them. Without it a cover image no step
 * uses was dropped (with its file) by the save after a cover change, and
 * the undo of that change had no image to show. Kept until the history no
 * longer names them (a new edit drops the redo steps, the bound the
 * oldest).
 */
export function historyAssetIds(state: TourDocumentState): Set<string> {
  const ids = new Set<string>();
  for (const { view } of [...state.past, ...state.future]) {
    for (const frame of view.stations) {
      for (const id of stepAssetIds(frame)) ids.add(id);
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
  const hosted = hostedObjects(withFrames(state.written, state.stations, []));
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
      // object names one of the document's frames.
      const written = base.stations.find((s) => s.id === holder);
      const known = state.stations.some((f) => f.id === holder);
      return {
        object: { ...object, station: holder },
        stations:
          known || written === undefined
            ? state.stations
            : [
                ...state.stations,
                ...framesOf({ ...base, stations: [written] }),
              ],
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
 * else keeps them - no title, no story steps, no route from another
 * station. Such a station existed only for its
 * elements; left behind, a visitor's guide would still lead to it.
 * The same array when nothing goes.
 */
function withoutEmptied(
  state: TourDocumentState,
  candidates: Iterable<string | undefined>,
): readonly StationFrame[] {
  const ids = new Set([...candidates].filter((id) => id !== undefined));
  if (ids.size === 0) return state.stations;
  const named = new Set(documentObjects(state).map((o) => o.object.station));
  const routed = new Set(state.stations.flatMap(routedTo));
  const gone = (frame: StationFrame): boolean =>
    ids.has(frame.id) &&
    !named.has(frame.id) &&
    (frame.title ?? "").trim() === "" &&
    frame.steps.length === 0 &&
    !routed.has(frame.id);
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
  const crosses = stepCrossesInPlaceSave(state, which);
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
  /** The objects were made in ANOTHER document (work carried into a tour
   *  just opened): the station each named is not this tour's, so each is
   *  seated afresh by the station rule against the opened tour's
   *  stations. */
  readonly rerun?: boolean;
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
 *  `frame`: the station's own found radius holds the spot; or the object
 *  stood outside that radius already, and the move takes it no farther
 *  from the anchor (strict: a centimetre farther runs the rule) and into
 *  no other station's radius - a station whose radius held the old spot
 *  too (radii overlap) is not one it moved into. */
function keepsHome(
  state: TourDocumentState,
  frame: StationFrame,
  object: TourObject,
): boolean {
  if (stationHolding([frame], object.geo) !== null) return true;
  const was = documentObjects(state).find((o) => o.object.id === object.id)
    ?.object.geo;
  if (was === undefined) return false;
  if (horizontalM(frame.geo, object.geo) > horizontalM(frame.geo, was)) {
    return false;
  }
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
     *  anchor stays put), and so does one already outside that radius
     *  moved no farther out (`keepsHome`); otherwise the station rule
     *  runs again (`seatByRule`): it joins the station holding its new
     *  spot, or starts one there under the payload's `newStationId`, and
     *  the station it left goes when that leaves it an empty automatic
     *  one. An unknown id changes nothing. */
    moved: {
      reducer(state, action: PayloadAction<PlacedPayload>) {
        const before = plain(state);
        const { object, what } = action.payload;
        const home = homeOf(before, object.id);
        const frame = before.stations.find((s) => s.id === home);
        if (home === undefined || frame === undefined) return before;
        const kept = { ...object, station: home };
        if (keepsHome(before, frame, object) && objectFits(before, kept)) {
          return putObject(before, kept, what);
        }
        const seated = seatByRule(before, unseated(object), {
          newStationId: action.payload.newStationId,
        });
        if (seated === null) return before;
        return putObject(before, seated.object, what, seated.stations, home);
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
        const posed = plainBefore.stations.map((s) => {
          const geo = poses.get(s.id);
          return geo === undefined ? s : { ...s, geo };
        });
        const known = new Set(posed.map((f) => f.id));
        const created: StationFrame[] = [];
        for (const frame of work.createdStations ?? []) {
          if (known.has(frame.id)) continue;
          known.add(frame.id);
          created.push(frame);
        }
        let next: TourDocumentState = {
          ...plainBefore,
          stations: [...posed, ...created],
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
        return edited(
          plainBefore,
          {
            placed: next.placed,
            deleted: next.deleted,
            stations: withoutEmptied(next, left),
            ...(work.stations === undefined ? {} : { stationsRecorded: true }),
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
        unmoved ? written : withFrames(written, before.stations, before.placed),
        appliedDeletions,
      );
      return {
        ...before,
        written,
        placed: pending.placed,
        deleted: pending.deleted,
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
    /** A page took its one save slot (a save, or a step of the walk's
     *  move). */
    saveClaimed(state, action: PayloadAction<{ by: TourSaveHolder }>) {
      const before = plain(state);
      return {
        ...before,
        // A save claimed after a step writes the document as it stands
        // then, or says why it could not: the resave is taken on (D33).
        save: saveWith(before.save, {
          by: action.payload.by,
          error: null,
          resave: false,
        }),
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
