/**
 * What a page's draft writes when the tour document changes (D30): the
 * writes follow the STATE, not the gesture - each id whose standing
 * against the written file changed is written as the edits' own writes
 * would (`draft-actions.ts`'s order: a record before its tombstone goes),
 * and the settings record when it changed. One rule for an edit, a delete,
 * an undo, a redo and a restore alike, run by a listener after the
 * reducer (never from `store.subscribe`). Pure but for the draft's writes.
 *
 * @see tour-document-draft.ts.md
 */

import { parseGeoPose } from "gps-plus-slam-app-framework/ar/qr/geo-pose";
import {
  createEmptyTourManifest,
  parseTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { TOUR_ID_PATTERN } from "gps-plus-slam-app-framework/ar/tour-archive";
import { tourObjects } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { objectContentKey } from "./authoring-draft.js";
import type { DraftObjectWrites } from "./draft-actions.js";
import type { EditEntry } from "./object-edits.js";
import { DETAIL_FIELDS, type TourDetailFields } from "./tour-details-form.js";
import {
  createdStationFrames,
  documentFrames,
  framesOf,
  levelsNotHosted,
  objectAssetsHeld,
  type LevelText,
  recordedFrames,
  recordedOrder,
  type StationFrame,
  type StationPose,
  stationsGoneSinceOpen,
  type TourDocumentState,
} from "./tour-document.js";
import { sameJson } from "./same-json.js";

/** The tour-level settings a draft keeps: the setting, and the details
 *  once they were set or restored (`editor/editor-draft.ts` THE
 *  SETTINGS). */
export interface TourSettingsRecord {
  readonly needsNoGps: boolean;
  readonly details?: TourDetailFields;
  /** Every station's pose, once a frame was moved or restored here: a
   *  reload puts the moved stations back with their items (D17; the r875
   *  milestone review #1 - the objects alone came back at the moved spots
   *  inside unmoved stations). */
  readonly stations?: readonly StationPose[];
  /** The whole frames of the stations this page created
   *  (`createdStationFrames`): the objects' records name them, so a reload
   *  puts them back before the objects (`restored`). Absent when none. */
  readonly createdStations?: readonly StationFrame[];
  /** Once a station was edited beyond its pose here (a title, a radius, a
   *  description, a card image; added, deleted, reordered or copied:
   *  `framesRecorded`), the stations this page edited beyond their pose or
   *  added, whole (`recordedFrames`; empty when none). Absent: no opinion
   *  about them. */
  readonly frames?: readonly StationFrame[];
  /** The stations' order, recorded with `frames` only when a restore
   *  would not give it by itself (`recordedOrder`). */
  readonly order?: readonly string[];
  /** The stations of the opened or written tour the document no longer
   *  carries, recorded with `frames`; absent when none. */
  readonly deletedStations?: readonly string[];
  /** The stations the next write carries that were added by hand here
   *  (`handMade`): they keep themselves though untitled and empty.
   *  Recorded with `frames`; absent when none. */
  readonly handMadeStations?: readonly string[];
}

/** The settings record's file in a draft namespace, on both pages. Not a
 *  prefix `readDraft` (`draft-persistence.ts`) reads, so the objects'
 *  reader skips it. */
export const SETTINGS_KEY = "settings";

/** What both pages tell an author when a stored record, or a station in
 *  it, did not read (`parseSettingsRecord`'s `onLost`). */
export const DRAFT_PART_UNREAD =
  "Part of this tour's saved draft could not be read and was left out.";

/** The ids of `wanted`'s stations whose pose differs from the one
 *  `against` gives them; none without an opinion, and none for a station
 *  `against` does not carry (nothing a restore could move). */
export function changedStations(
  wanted: readonly StationPose[] | undefined,
  against: readonly StationPose[] | undefined,
): string[] {
  if (wanted === undefined) return [];
  const poses = new Map((against ?? []).map((p) => [p.id, p.geo]));
  return wanted
    .filter((p) => {
      const there = poses.get(p.id);
      return there !== undefined && !sameJson(there, p.geo);
    })
    .map((p) => p.id);
}

/** A stored record's station poses: undefined when absent, null when they
 *  do not read (each an id and a geo pose the format accepts). */
function parseStations(value: unknown): StationPose[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const poses: StationPose[] = [];
  for (const item of value as unknown[]) {
    if (item === null || typeof item !== "object") return null;
    const { id, geo } = item as Record<string, unknown>;
    if (typeof id !== "string") return null;
    try {
      poses.push({
        id,
        geo: parseGeoPose(geo, {
          path: "stations.geo",
          fail: (message) => {
            throw new Error(message);
          },
        }),
      });
    } catch {
      return null;
    }
  }
  return poses;
}

/** A stored record's frames (its created stations, or every station),
 * each read on its own as the format reads a station
 * (`parseTourManifest`, without items): undefined when absent; of two
 * under one id the first is kept. A frame that does not read is lost (the
 * objects naming it are seated by the station rule as they come back). A
 * frame naming an asset or a character reads only against `against`, which
 * declares them; without `against`, such a frame is lost. `onLost` hears
 * each frame lost, and a list that is none. */
function parseFrames(
  value: unknown,
  against: TourManifest | undefined,
  onLost: (() => void) | undefined,
): StationFrame[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    onLost?.();
    return undefined;
  }
  const frames: StationFrame[] = [];
  for (const entry of value as unknown[]) {
    const frame = parseFrame(entry, against);
    if (frame === undefined) onLost?.();
    else if (!frames.some((f) => f.id === frame.id)) frames.push(frame);
  }
  return frames;
}

/** A stored frame's id, when it is one a station may carry. */
function idOf(entry: unknown): string | undefined {
  if (entry === null || typeof entry !== "object") return undefined;
  const id = (entry as { id?: unknown }).id;
  return typeof id === "string" && TOUR_ID_PATTERN.test(id) ? id : undefined;
}

/** One frame, read as the only station of the tour it is read `against`,
 *  so whatever its story names there resolves (the whole tour, never a
 *  picked list of its fields: a field left off that list loses every frame
 *  naming it); undefined when it does not read. Its card image is read
 *  apart: the probe holds no free blocks, so a captured photo of the
 *  station would read as gone - a well-formed id is kept, and the document
 *  shows and writes it only while it names a picture (its effective
 *  image). */
function parseFrame(
  entry: unknown,
  against: TourManifest | undefined,
): StationFrame | undefined {
  const id = idOf(entry);
  if (id === undefined) return undefined;
  try {
    const probe = parseTourManifest({
      ...(against ?? createEmptyTourManifest()),
      stations: [entry],
    });
    const frame = framesOf(probe).find((f) => f.id === id);
    const image = (entry as { image?: unknown }).image;
    if (
      frame === undefined ||
      frame.image !== undefined ||
      typeof image !== "string" ||
      !TOUR_ID_PATTERN.test(image)
    ) {
      return frame;
    }
    return { ...frame, image };
  } catch {
    return undefined;
  }
}

/** A stored record's deleted stations or order: the well-formed ids, once
 *  each; undefined when absent or not a list. */
function parseIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return [
    ...new Set(
      (value as unknown[]).filter(
        (id): id is string =>
          typeof id === "string" && TOUR_ID_PATTERN.test(id),
      ),
    ),
  ];
}

/** A stored record's details: undefined when absent, null when they do
 *  not read (a known field that is not a string). */
function parseDetails(value: unknown): TourDetailFields | undefined | null {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const details: Partial<Record<(typeof DETAIL_FIELDS)[number], string>> = {};
  for (const field of DETAIL_FIELDS) {
    const text = record[field];
    if (text === undefined) continue;
    if (typeof text !== "string") return null;
    details[field] = text;
  }
  return details;
}

/** A stored settings record (`SETTINGS_KEY`'s text); undefined for
 *  anything that does not read (a record that does not read costs
 *  itself, never the objects beside it). `against`: the tour it is read
 *  for (the one opened), whose assets and characters a recorded frame's
 *  story may name (`parseFrames`). A frame list or a
 *  deleted list that does not read costs only itself. `onLost` hears what
 *  did not read: the `record` once, or each `frame`; never when there is
 *  no record. A page tells the author (`DRAFT_PART_UNREAD`). */
export function parseSettingsRecord(
  text: string | undefined,
  against?: TourManifest,
  onLost?: (what: "record" | "frame") => void,
): TourSettingsRecord | undefined {
  if (text === undefined) return undefined;
  const lostFrame = onLost === undefined ? undefined : () => onLost("frame");
  const read = readSettingsRecord(text, against, lostFrame);
  if (read === undefined) onLost?.("record");
  return read;
}

function readSettingsRecord(
  text: string,
  against: TourManifest | undefined,
  lostFrame: (() => void) | undefined,
): TourSettingsRecord | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    const { needsNoGps } = record;
    const details = parseDetails(record["details"]);
    const stations = parseStations(record["stations"]);
    if (typeof needsNoGps !== "boolean" || details === null) return undefined;
    if (stations === null) return undefined;
    const created = parseFrames(record["createdStations"], against, lostFrame);
    const frames = parseFrames(record["frames"], against, lostFrame);
    const order = parseIds(record["order"]);
    const deletedStations = parseIds(record["deletedStations"]);
    const handMade = parseIds(record["handMadeStations"]);
    return {
      needsNoGps,
      ...(details === undefined ? {} : { details }),
      ...(stations === undefined ? {} : { stations }),
      ...(created === undefined || created.length === 0
        ? {}
        : { createdStations: created }),
      ...(frames === undefined ? {} : { frames }),
      ...(order === undefined || order.length === 0 ? {} : { order }),
      ...(deletedStations === undefined || deletedStations.length === 0
        ? {}
        : { deletedStations }),
      ...(handMade === undefined || handMade.length === 0
        ? {}
        : { handMadeStations: handMade }),
    };
  } catch {
    return undefined;
  }
}

/** A settings record as a draft stores it: the record as it is, its
 *  frames already in the tour file's shape (the step's `action` is the
 *  file's own key), which `parseSettingsRecord` reads as the format reads
 *  a station. */
export function settingsRecordText<
  R extends Pick<
    TourSettingsRecord,
    "needsNoGps" | "createdStations" | "frames"
  >,
>(record: R): string {
  return JSON.stringify(record);
}

/** The codes a draft keeps (plan M3b): the code in hand, and every code
 *  whose saved text the hosted zip does not hold yet (`levelsNotHosted`),
 *  the hand's among them. */
export interface TourCodesRecord {
  readonly level: LevelText | null;
  readonly levels: readonly LevelText[];
}

/** The codes record as the document holds it now, with `hand` in hand. */
function codesRecord(
  state: TourDocumentState,
  hand: LevelText | null,
): TourCodesRecord {
  return { level: hand, levels: levelsNotHosted(state) };
}

/** Where a page backs its edits up: the objects' writes the pages share,
 *  the settings record, and the codes record (a page that measures codes:
 *  the phone's). */
export interface TourDocumentDraft extends DraftObjectWrites {
  saveSettings(settings: TourSettingsRecord): Promise<boolean>;
  saveCodes?(codes: TourCodesRecord): Promise<boolean>;
  /** Whether the draft holds a file brought in (absent: every one). */
  holdsFile?(id: string): boolean;
}

/** The settings record as the document holds it now. */
export function settingsRecord(state: TourDocumentState): TourSettingsRecord {
  const created = createdStationFrames(state);
  const gone = state.framesRecorded ? stationsGoneSinceOpen(state) : [];
  const order = state.framesRecorded ? recordedOrder(state) : undefined;
  const carried = new Set(documentFrames(state).map((f) => f.id));
  const handMade = state.handMade.filter((id) => carried.has(id));
  return {
    needsNoGps: state.needsNoGps,
    ...(state.detailsRecorded ? { details: state.details } : {}),
    ...(state.stationsRecorded
      ? { stations: state.stations.map(({ id, geo }) => ({ id, geo })) }
      : {}),
    ...(created.length === 0 ? {} : { createdStations: created }),
    ...(state.framesRecorded ? { frames: recordedFrames(state) } : {}),
    ...(order === undefined ? {} : { order }),
    ...(gone.length === 0 ? {} : { deletedStations: gone }),
    ...(handMade.length === 0 ? {} : { handMadeStations: handMade }),
  };
}

/** Where an id stands against the written file. */
type Standing = EditEntry | "deleted" | null;

function standing(state: TourDocumentState, id: string): Standing {
  if (state.deleted.includes(id)) return "deleted";
  return state.placed.find((p) => p.object.id === id) ?? null;
}

/** Whether the written file, and the opened file, hold an id. */
interface Holders {
  written(id: string): boolean;
  opened(id: string): boolean;
}

/**
 * `object` as a draft can keep it, or null when it cannot keep it at all.
 * A draft keeps the records and the files brought in (`addedAssets`,
 * written before the records naming them), never a timing's text: a
 * reload offering a record naming a file the tour lacks would fail every
 * save, so the restore leaves such a record out whole. A file brought in
 * whose write did not land (`holdsFile` false) is held nowhere either.
 * So a record naming what only this page holds is drafted otherwise:
 * - a long text keeps its words with the narration the written file gives
 *   it (none when it has none);
 * - any other kind (a model, a video, a picture of a file) is drafted as
 *   the written file has it, or - written nowhere - not at all.
 */
export function draftableObject(
  object: TourObject,
  state: TourDocumentState,
  holdsFile: (id: string) => boolean = () => true,
): TourObject | null {
  const assets = new Set([
    ...(state.written?.assets ?? []).map((a) => a.id),
    ...state.addedAssets.map((a) => a.id).filter(holdsFile),
  ]);
  const timing =
    object.kind === "longText" ? object.narration?.timing : undefined;
  const timingHeld =
    timing === undefined ||
    !Object.hasOwn(state.timingsWritten, timing) ||
    state.timingsWritten[timing] !== null;
  if (objectAssetsHeld(object, assets) && timingHeld) return object;
  const fallback =
    object.kind === "longText"
      ? withFiledNarration(object, state.written)
      : (writtenObject(state.written, object.id) ?? null);
  return fallback !== null && objectAssetsHeld(fallback, assets)
    ? fallback
    : null;
}

/** The object of `id` as `file` holds it, if it does. */
function writtenObject(
  file: TourManifest | null,
  id: string,
): TourObject | undefined {
  return file === null ? undefined : tourObjects(file).find((o) => o.id === id);
}

/** `object` with the narration `file` gives it in place of its own (none
 *  when the file gives none): a long text whose narration names what is
 *  held nowhere keeps its words. Any other object is returned as it is. */
export function withFiledNarration(
  object: TourObject,
  file: TourManifest | null,
): TourObject {
  if (object.kind !== "longText" || object.narration === undefined) {
    return object;
  }
  const filed =
    file === null
      ? undefined
      : tourObjects(file).find((o) => o.id === object.id);
  const { narration: _unheld, ...rest } = object;
  return filed?.kind === "longText" && filed.narration !== undefined
    ? { ...rest, narration: filed.narration }
    : rest;
}

/** One id's draft writes for a change from `was` to `now`; `kept` gives
 *  an object as the draft can keep it (`draftableObject`). */
function followId(
  draft: TourDocumentDraft,
  id: string,
  was: Standing,
  now: Standing,
  pictureOf: (id: string) => Blob | undefined,
  holds: Holders,
  kept: (object: TourObject) => TourObject | null,
): void {
  if (now === "deleted") {
    if (was !== "deleted") void draft.saveDeletion(id);
    return;
  }
  if (now === null) {
    if (was === "deleted") void draft.forgetDeletion(id);
    // Gone, and the written file lacks it, while the opened file holds
    // it: a delete a save wrote, taken again (a redo after the undo
    // across that save). A reload opens a file that may still hold it (a
    // download is not in place), so the draft keeps the delete - as its
    // tombstone, not a forgotten record (the r880 fix re-review, L1).
    else if (was !== null && !holds.written(id) && holds.opened(id)) {
      void draft.saveDeletion(id);
    } else if (was !== null) void draft.forgetObject(id);
    return;
  }
  const same =
    was !== null &&
    was !== "deleted" &&
    objectContentKey(was.object) === objectContentKey(now.object);
  // A record the draft cannot keep (`draftableObject` null) is not
  // written: the draft keeps what it had for the id.
  const keep = same ? null : kept(now.object);
  if (keep !== null) void draft.saveObject(keep, pictureOf(id));
  // An object back that the written file lacks may be a delete a save
  // already wrote (and took out of the document's deletions, not the
  // draft's tombstone): an undo across that save. Its tombstone goes too,
  // after the record, or a later restore deletes it again.
  if (was === "deleted" || (was === null && !holds.written(id))) {
    void draft.forgetDeletion(id);
  }
}

/** Whether `manifest` holds an object of an id, its ids read once, when
 *  first asked. */
function holderOf(manifest: TourManifest | null): (id: string) => boolean {
  let ids: ReadonlySet<string> | undefined;
  return (id) => {
    ids ??= new Set(
      manifest === null ? [] : tourObjects(manifest).map((o) => o.id),
    );
    return ids.has(id);
  };
}

/**
 * The draft follows the document from `before` to `after`: every write is
 * issued now, in order (each resolves on its own; the draft says its own
 * failures). Nothing is written across an open (`generation`): the new
 * tour's draft is not the old one's. The codes record follows too when
 * the draft keeps one and `hands` names the code in hand before and after
 * (the hand is the page's, not the document's).
 */
export function followDocument(
  draft: TourDocumentDraft,
  before: TourDocumentState,
  after: TourDocumentState,
  pictureOf: (id: string) => Blob | undefined,
  hands?: {
    readonly before: LevelText | null;
    readonly after: LevelText | null;
  },
): void {
  if (before.generation !== after.generation) return;
  const ids = new Set([
    ...before.placed.map((p) => p.object.id),
    ...before.deleted,
    ...after.placed.map((p) => p.object.id),
    ...after.deleted,
  ]);
  const holds: Holders = {
    written: holderOf(before.written),
    opened: holderOf(before.opened),
  };
  for (const id of ids) {
    followId(
      draft,
      id,
      standing(before, id),
      standing(after, id),
      pictureOf,
      holds,
      (object) =>
        draftableObject(
          object,
          after,
          (asset) => draft.holdsFile?.(asset) ?? true,
        ),
    );
  }
  const was = settingsRecord(before);
  const now = settingsRecord(after);
  if (!sameJson(was, now)) {
    void draft.saveSettings(now);
  }
  if (draft.saveCodes === undefined || hands === undefined) return;
  const codesWere = codesRecord(before, hands.before);
  const codesNow = codesRecord(after, hands.after);
  if (!sameJson(codesWere, codesNow)) void draft.saveCodes(codesNow);
}
