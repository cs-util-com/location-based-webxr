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
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import { objectContentKey } from "./authoring-draft.js";
import type { DraftObjectWrites } from "./draft-actions.js";
import type { EditEntry } from "./object-edits.js";
import { DETAIL_FIELDS, type TourDetailFields } from "./tour-details-form.js";
import type { StationPose, TourDocumentState } from "./tour-document.js";

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
}

/** The settings record's file in a draft namespace, on both pages. Not a
 *  prefix `readDraft` (`draft-persistence.ts`) reads, so the objects'
 *  reader skips it. */
export const SETTINGS_KEY = "settings";

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
      return there !== undefined && !sameGeo(there, p.geo);
    })
    .map((p) => p.id);
}

function sameGeo(a: QrGeoPose, b: QrGeoPose): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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
 *  itself, never the objects beside it). */
export function parseSettingsRecord(
  text: string | undefined,
): TourSettingsRecord | undefined {
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    const { needsNoGps } = record;
    const details = parseDetails(record["details"]);
    const stations = parseStations(record["stations"]);
    if (typeof needsNoGps !== "boolean" || details === null) return undefined;
    if (stations === null) return undefined;
    return {
      needsNoGps,
      ...(details === undefined ? {} : { details }),
      ...(stations === undefined ? {} : { stations }),
    };
  } catch {
    return undefined;
  }
}

/** Where a page backs its edits up: the objects' writes the pages share
 *  and the settings record. */
export interface TourDocumentDraft extends DraftObjectWrites {
  saveSettings(settings: TourSettingsRecord): Promise<boolean>;
}

/** The settings record as the document holds it now. */
export function settingsRecord(state: TourDocumentState): TourSettingsRecord {
  return {
    needsNoGps: state.needsNoGps,
    ...(state.detailsRecorded ? { details: state.details } : {}),
    ...(state.stationsRecorded
      ? { stations: state.stations.map(({ id, geo }) => ({ id, geo })) }
      : {}),
  };
}

/** Where an id stands against the written file. */
type Standing = EditEntry | "deleted" | null;

function standing(state: TourDocumentState, id: string): Standing {
  if (state.deleted.includes(id)) return "deleted";
  return state.placed.find((p) => p.object.id === id) ?? null;
}

/** One id's draft writes for a change from `was` to `now`. */
function followId(
  draft: TourDocumentDraft,
  id: string,
  was: Standing,
  now: Standing,
  pictureOf: (id: string) => Blob | undefined,
): void {
  if (now === "deleted") {
    if (was !== "deleted") void draft.saveDeletion(id);
    return;
  }
  if (now === null) {
    if (was === "deleted") void draft.forgetDeletion(id);
    else if (was !== null) void draft.forgetObject(id);
    return;
  }
  const same =
    was !== null &&
    was !== "deleted" &&
    objectContentKey(was.object) === objectContentKey(now.object);
  if (!same) void draft.saveObject(now.object, pictureOf(id));
  if (was === "deleted") void draft.forgetDeletion(id);
}

/**
 * The draft follows the document from `before` to `after`: every write is
 * issued now, in order (each resolves on its own; the draft says its own
 * failures). Nothing is written across an open (`generation`): the new
 * tour's draft is not the old one's.
 */
export function followDocument(
  draft: TourDocumentDraft,
  before: TourDocumentState,
  after: TourDocumentState,
  pictureOf: (id: string) => Blob | undefined,
): void {
  if (before.generation !== after.generation) return;
  const ids = new Set([
    ...before.placed.map((p) => p.object.id),
    ...before.deleted,
    ...after.placed.map((p) => p.object.id),
    ...after.deleted,
  ]);
  for (const id of ids) {
    followId(draft, id, standing(before, id), standing(after, id), pictureOf);
  }
  const was = settingsRecord(before);
  const now = settingsRecord(after);
  if (JSON.stringify(was) !== JSON.stringify(now)) {
    void draft.saveSettings(now);
  }
}
