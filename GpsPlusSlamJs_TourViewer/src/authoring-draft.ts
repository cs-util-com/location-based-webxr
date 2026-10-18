/**
 * The authoring draft: what survives a crash, and the rules about when it
 * is offered, when it is spent, and what restoring it actually adds.
 *
 * WHY A DRAFT EXISTS (second testing session, F13). Everything a creator
 * measures and places lives in page memory until they tap Finish. An AR
 * session on a phone can be killed by the OS at any moment - a call, a
 * memory reclaim, an accidental back gesture - and today that loses the
 * whole walk.
 *
 * WHY THE DRAFT IS "SINCE THE HOSTED ZIP", NOT "SINCE THE LAST FINISH".
 * This is the rule the milestone's cold review turned on, so it is worth
 * stating plainly. Finishing is not terminal: it merges the placed objects
 * into the in-memory manifest, empties the list, and leaves that batch
 * alive only inside `ctx.rebuiltZip` - a Blob that dies with the page. A
 * draft reset by each finish would therefore hold only the objects placed
 * AFTER the last download, while the finish itself would rebuild from the
 * hosted zip, which never had the earlier ones. The creator would end up
 * with two downloads, each missing the other's content, and nothing on
 * screen would say so. So the draft accumulates until the hosted zip is
 * seen to contain it.
 *
 * Everything here is pure: the OPFS mechanics live in the framework's
 * store, and this file is the part that can be wrong in ways a reader
 * cannot see.
 */

import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourObjects } from "gps-plus-slam-app-framework/ar/tour-station-pose";

import { asStored } from "./tour-content.js";

/**
 * What one draft holds.
 *
 * `sizeM` is in here because a crash loses it too: `creator-setup.ts`
 * rewrites the printed-size field from the framework default on every
 * load, so a creator who printed at 20 cm and crashed would re-enter AR
 * solving against 16 cm - silently, because the restored level's own copy
 * of the size still looks right.
 */
export interface AuthoringDraft {
  /** The creator-facing tour URL this draft belongs to. */
  tourUrl: string;
  /** The printed side length in metres, as it was when the code was
   *  measured. */
  sizeM: number;
  /** The measured level, or null when the creator placed content before
   *  measuring (possible: the mint gate blocks the FINISH, not placement
   *  in general). */
  level: { id: string; json: string } | null;
  /** Every code the draft keeps (M4c-1), `level` among them; absent in a
   *  draft built by hand, where `level` is the only one ({@link draftLevels}). */
  levels?: readonly { id: string; json: string }[];
  /** The objects placed or changed on this device (an edit or a move of
   *  a hosted object keeps its id), not yet seen in the hosted zip. */
  objects: readonly TourObject[];
  /** The ids deleted on this device (tombstones, authoring plan
   *  2026-09-28-0953 §3.4): pending while the hosted zip still carries
   *  them. */
  deleted: readonly string[];
  /** Per object id, the versions this device knows as its own line (M6
   *  E2p): absent in a draft from before E2p, which behaves as before. */
  bases?: ReadonlyMap<string, DraftBase>;
}

/**
 * An object's known versions, as content keys (`objectContentKey`), M6
 * E2p and its re-review #1. Only facts, so they only accumulate:
 *
 * - `seen` - versions this device saw in the hosted file (the tour as a
 *   page opened it, or a record found published there);
 * - `written` - versions this device's own Finishes wrote. A Finish's file
 *   may be uploaded from the same tab, so the hosted version can be one
 *   the device never saw hosted and still be its own work.
 *
 * A hosted version in neither list was made elsewhere.
 */
export interface DraftBase {
  readonly seen: readonly string[];
  readonly written: readonly string[];
}

/** The most keys a base list keeps (the newest): one is added per page
 *  load and per Finish at most, so this is never reached in practice. */
export const DRAFT_BASE_MAX_KEYS = 32;

/** `base` with `key` added to one of its lists, the newest last; the same
 *  object when the key is already there. */
export function withBaseKey(
  base: DraftBase | undefined,
  list: keyof DraftBase,
  key: string,
): DraftBase {
  const now = base ?? { seen: [], written: [] };
  if (now[list].includes(key)) return now;
  return {
    ...now,
    [list]: [...now[list], key].slice(-DRAFT_BASE_MAX_KEYS),
  };
}

/**
 * The storage key for a tour.
 *
 * The CREATOR-FACING url, never `session.archive.url`: that one is
 * normalised, and for a Drive-hosted tour it becomes the proxy route -
 * which is a RELATIVE path on a deployment and an absolute one on a dev
 * host, so the same tour would key differently between them. This is the
 * same string `wizardStepKey` keys by, deliberately: one tour, one
 * identity, wherever the page is served from.
 */
export function draftKeyForTour(tourUrl: string): string {
  return tourUrl.trim();
}

/**
 * The draft's objects that the hosted manifest does not already carry.
 *
 * This is the whole state machine in one function. It answers both
 * questions the draft has:
 *
 * - **What does restoring add?** Exactly these. Never an object the zip
 *   already contains, because `serializeTourManifest` rejects duplicate
 *   ids - so appending one would make every future finish throw, forever,
 *   with no way out inside the app.
 * - **Is the draft spent?** When this is empty. That is the only staleness
 *   this design can honestly act on: proof that the content reached the
 *   file the world sees.
 */
export function draftObjectsNotYetHosted(
  draft: AuthoringDraft,
  manifest: TourManifest | null,
): readonly TourObject[] {
  // CONTENT, not ids (authoring plan 2026-09-28-0953 §3.4, cold review
  // #8): an edit or a move of a hosted object keeps its id, so "the zip has
  // this id" said the edit was already published - the restore dropped it
  // and the spent rule deleted the draft that held it.
  const hosted = hostedObjects(manifest);
  return draft.objects.filter(
    (o) =>
      !hosted.holds(o) &&
      !(manifest !== null && superseded(draft, hosted, o.id)),
  );
}

/** The hosted file's pins and photos, as a draft and a save compare
 *  against them. */
export interface HostedObjects {
  /** The world view of the file's pins and photos, in station order. */
  readonly objects: readonly TourObject[];
  /** The hosted version of `id` as a content key, or undefined. */
  key(id: string): string | undefined;
  /**
   * Whether the file stores `object` as it is: the same content, or the
   * same once stored in its station. A placement and its saved copy
   * differ by the micrometres of the round trip through the station's
   * frame (tour editor plan W3; `tour-content.ts` `asStored`), and must
   * still compare equal - else a saved placement read as unsaved forever.
   * An object naming ANOTHER station of the file is never held, however
   * close it stands: that is a re-assignment. A station the file does not
   * have is no move (the writer keeps such an object where it is).
   */
  holds(object: TourObject): boolean;
}

/** The hosted file's pins and photos; none without a file. */
export function hostedObjects(manifest: TourManifest | null): HostedObjects {
  const objects = manifest === null ? [] : tourObjects(manifest);
  const byId = new Map(objects.map((o) => [o.id, o]));
  const keys = new Map(objects.map((o) => [o.id, objectContentKey(o)]));
  const stations = new Map((manifest?.stations ?? []).map((s) => [s.id, s]));
  return {
    objects,
    key: (id) => keys.get(id),
    holds(object) {
      const key = keys.get(object.id);
      if (key === undefined) return false;
      if (key === objectContentKey(object)) return true;
      const home = byId.get(object.id)?.station;
      // Compared BEFORE the round trip, which writes the hosted station
      // into the object and would hide a re-assignment (M5a review L2).
      // Only to a station the file has, as the writer reads it
      // (`withTourContent`): a station it does not have is no move.
      if (
        object.station !== undefined &&
        object.station !== home &&
        stations.has(object.station)
      ) {
        return false;
      }
      const station = home === undefined ? undefined : stations.get(home);
      return (
        station !== undefined &&
        key === objectContentKey(asStored(object, station))
      );
    },
  };
}

/** A newer edit elsewhere won (M6 E2p): the hosted version is one this
 *  device neither saw hosted nor wrote, or the object is gone though this
 *  device saw it hosted. Never true without a base (a draft from before
 *  E2p) - and a new placement never seen hosted is never "deleted
 *  elsewhere": its Finish may simply not be uploaded yet. */
function superseded(
  draft: AuthoringDraft,
  hosted: HostedObjects,
  id: string,
): boolean {
  const base = draft.bases?.get(id);
  if (base === undefined) return false;
  const now = hosted.key(id);
  if (now === undefined) return base.seen.length > 0;
  return !base.seen.includes(now) && !base.written.includes(now);
}

/**
 * The draft's objects a newer edit elsewhere replaced (M6 E2p, the E2
 * plan review #1): edited or deleted in the hosted file since this device
 * changed them. They are not offered back - the hosted file wins (owner
 * question Q-E2-2's default) - and the page says so.
 */
export function draftObjectsSuperseded(
  draft: AuthoringDraft,
  manifest: TourManifest | null,
): readonly TourObject[] {
  // No hosted manifest is no evidence about any object (PR #612 review):
  // a wrong upload or another file answering must not read as "everything
  // deleted elsewhere".
  if (manifest === null) return [];
  const hosted = hostedObjects(manifest);
  return draft.objects.filter(
    (o) => !hosted.holds(o) && superseded(draft, hosted, o.id),
  );
}

/**
 * The draft's objects the hosted zip carries with the same content, not
 * yet in their base's `seen` list: they reached the file the world sees,
 * so the page records that - a later delete elsewhere is then not undone
 * by this draft (M6 E2p). The key to record is the hosted one
 * (`hostedObjects(manifest).key`), which a stored copy reads back as.
 */
export function draftObjectsPublished(
  draft: AuthoringDraft,
  manifest: TourManifest | null,
): readonly TourObject[] {
  const hosted = hostedObjects(manifest);
  return draft.objects.filter((o) => {
    const key = hosted.key(o.id);
    return (
      key !== undefined &&
      hosted.holds(o) &&
      !(draft.bases?.get(o.id)?.seen.includes(key) ?? false)
    );
  });
}

/** The draft's deletions the hosted zip still carries: not yet published.
 *  A deletion has no base (M6 E2p): it is offered back even when the
 *  hosted object was edited elsewhere since, and a restore then deletes
 *  that newer edit. Named as not covered; whether a phone deletion should
 *  yield too is part of owner question Q-E2-2 (PR #613 review). */
export function draftDeletionsNotYetHosted(
  draft: AuthoringDraft,
  manifest: TourManifest | null,
): readonly string[] {
  const hosted = hostedObjects(manifest);
  return draft.deleted.filter((id) => hosted.key(id) !== undefined);
}

/**
 * An object's content as one comparable string: its JSON with every
 * object's keys sorted. A record read back from disk and one minted in
 * memory carry their fields in different orders, and they are the same
 * object.
 */
export function objectContentKey(object: TourObject): string {
  return JSON.stringify(object, (_key, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : value,
  );
}

/**
 * A draft has done its job and may be DELETED.
 *
 * Two conditions, and the second is the whole reason this is not just "no
 * objects left". A creator's most expensive act is measuring: walking to
 * the poster, holding the phone until the pose is stable and GPS has
 * aligned. If they mint and the tab dies before the first pin, the draft
 * holds a level and no objects - and judging that by objects alone would
 * delete the measurement and send them back to the wall. Not offering and
 * DELETING are different actions, and only the second is destructive.
 *
 * @param hostedLevelJson what the hosted zip currently stores for this
 *   draft's level id, or null when it stores nothing for it. It is the
 *   CONTENT and not the id, because a level's id is a hash of the printed
 *   TEXT: re-measuring the same poster produces a new measurement under
 *   the same id, so "the zip has a level with this id" is not evidence
 *   that it has THIS measurement.
 * @param visitCount the AR visits' logs the draft holds (`visit-log.ts`,
 *   M3b). The zip never carries them, so a draft holding one is never
 *   spent: a visit that only re-scanned a hosted code leaves nothing else,
 *   and deleting it lost the summary's only evidence for that code
 *   (M3a/M3b review #5). Only the author's discard drops visits.
 */
export function draftIsSpent(
  draft: AuthoringDraft,
  manifest: TourManifest | null,
  hostedLevelJson: HostedLevelText = null,
  visitCount = 0,
): boolean {
  if (visitCount > 0) return false;
  if (draftObjectsNotYetHosted(draft, manifest).length > 0) return false;
  // A deletion the zip has not seen is work too: dropping the draft would
  // bring the deleted object back on the next Finish.
  if (draftDeletionsNotYetHosted(draft, manifest).length > 0) return false;
  return !draftHasUnhostedLevel(draft, hostedLevelJson);
}

/**
 * What the hosted zip stores for a level: the text for the draft's ONE
 * `level` (the form before M4c-1), or per level id (a draft with several
 * codes); null where it stores nothing.
 */
export type HostedLevelText =
  string | null | ((levelId: string) => string | null);

/** Every code a draft keeps: `levels`, else its one `level` (M4c-1). */
export function draftLevels(
  draft: AuthoringDraft,
): readonly { id: string; json: string }[] {
  return draft.levels ?? (draft.level === null ? [] : [draft.level]);
}

/** Whether a draft holds a measurement the hosted zip does not have - any
 *  of its codes (M4c-1). */
export function draftHasUnhostedLevel(
  draft: AuthoringDraft,
  hostedLevelJson: HostedLevelText,
): boolean {
  const hostedOf =
    typeof hostedLevelJson === "function"
      ? hostedLevelJson
      : (id: string) => (id === draft.level?.id ? hostedLevelJson : null);
  return draftLevels(draft).some((level) => level.json !== hostedOf(level.id));
}

/**
 * The objects the Finish writes (authoring plan 2026-09-28-0953 §3.4):
 * `existing` (the manifest) with each `changes` record REPLACING the one
 * with its id, the rest of `changes` appended in order, and every id in
 * `deleted` filtered out.
 *
 * Replace, not append-and-skip: the finish used to skip ids the manifest
 * carried, which dropped every edit or move of a hosted object silently.
 * No id is ever written twice - `serializeTourManifest` rejects duplicates,
 * so one would make every later finish throw with no way out inside the
 * app - and a deleted id never comes back, whatever `changes` holds.
 */
export function applyObjectChanges(
  existing: readonly TourObject[],
  changes: readonly TourObject[],
  deleted: readonly string[],
): TourObject[] {
  const gone = new Set(deleted);
  const latest = new Map<string, TourObject>();
  for (const change of changes) latest.set(change.id, change);
  const out: TourObject[] = [];
  const written = new Set<string>();
  for (const object of [...existing, ...latest.values()]) {
    if (gone.has(object.id) || written.has(object.id)) continue;
    written.add(object.id);
    out.push(latest.get(object.id) ?? object);
  }
  return out;
}

/**
 * The zip entries a Finish removes: the content file of each deleted
 * photo, under the zip's wrap (`TourSession.manifestWrap`), so a deleted
 * photo takes its jpg with it (plan §3.4). Pins have no content file.
 */
export function contentEntriesToRemove(
  existing: readonly TourObject[],
  deleted: readonly string[],
  wrap: string,
): string[] {
  const gone = new Set(deleted);
  return existing.flatMap((object) =>
    object.kind === "photo" && gone.has(object.id)
      ? [`${wrap}${object.image}`]
      : [],
  );
}

/** Counts of work other than new placements (an edit or a move of an
 *  object the zip carries, a deletion, and an AR visit's log - which goes
 *  to the summary, never into the zip). */
interface OtherWork {
  readonly changed?: number;
  readonly deleted?: number;
  readonly visits?: number;
}

function counted(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** "a", "a and b", "a, b and c". */
function listed(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`;
}

/** The named parts of a draft's work, and how many things they are. */
function workParts(
  count: number,
  placed: readonly [one: string, many: string],
  other: OtherWork,
): { parts: string[]; total: number } {
  const changed = other.changed ?? 0;
  const deleted = other.deleted ?? 0;
  const parts: string[] = [];
  if (count > 0) parts.push(counted(count, ...placed));
  if (changed > 0) parts.push(counted(changed, "change", "changes"));
  if (deleted > 0) parts.push(counted(deleted, "deletion", "deletions"));
  return { parts, total: count + changed + deleted };
}

/**
 * What the setup panel says when a draft is found. Plain words: the
 * creator is being asked to decide about work they may not remember.
 *
 * `hasLevel` matters because a measurement alone is a real offer - the
 * expensive part of the walk - and "0 things you placed" would read as an
 * offer of nothing. Changes and deletions are named apart from new
 * placements: "Add it back?" over a bare count would read as bringing a
 * deleted object back.
 */
export function restoreOfferText(
  count: number,
  hasLevel = false,
  other: OtherWork = {},
): string {
  const { parts, total } = workParts(
    count,
    ["thing you placed", "things you placed"],
    other,
  );
  const visits = other.visits ?? 0;
  if (visits > 0) {
    parts.push(
      counted(
        visits,
        "AR visit for the summary map",
        "AR visits for the summary map",
      ),
    );
  }
  const all = total + visits;
  if (all === 0) {
    return "Unsaved work from this tour is still on this device: the code's measured position. Add it back?";
  }
  if (hasLevel) parts.push("the code's measured position");
  return `Unsaved work from this tour is still on this device: ${listed(parts)}. ${all === 1 ? "Add it back?" : "Add them back?"}`;
}

/** What it says once the creator has taken it back. */
export function restoredText(
  count: number,
  hasLevel = false,
  other: OtherWork = {},
): string {
  const { parts, total } = workParts(
    count,
    ["placed object", "placed objects"],
    other,
  );
  const visits = other.visits ?? 0;
  const visitWords = counted(visits, "AR visit", "AR visits");
  if (total === 0 && visits === 0) {
    return `The code's measured position was restored - Finish is ready without walking to the poster again.`;
  }
  const measured = hasLevel
    ? " The code's measured position came back too, so Finish is ready without walking to the poster again."
    : "";
  // Visits go to the summary, never into the zip: said apart.
  if (total === 0) {
    return `${visitWords} restored - the summary after the next Finish shows ${visits === 1 ? "it" : "them"}.${measured}`;
  }
  const alsoVisits =
    visits > 0 ? ` ${visitWords} came back for the summary too.` : "";
  return `${listed(parts)} restored - ${total === 1 ? "it goes" : "they go"} into the zip on the next Finish.${alsoVisits}${measured}`;
}

/** Said when a draft gave way to newer edits in the tour file (M6 E2p;
 *  owner question Q-E2-2's default: the file wins, said once). `where`
 *  names where the draft was kept: the phone's, or the desktop editor's
 *  "in this browser" (M6 E2c). */
export function supersededLine(count: number, where = "on this phone"): string {
  return count === 1
    ? `1 change ${where} was replaced by a newer one in the tour file.`
    : `${String(count)} changes ${where} were replaced by newer ones in the tour file.`;
}

/**
 * `manifest` as a reader of the written file sees it (the E2p third
 * review #5): the parser normalises some fields (a heading into
 * [0, 360)), and every base comparison is between parsed versions. The
 * manifest itself when the round trip fails - a key that may not match
 * only offers too much. The phone's `creator-draft.ts` and the desktop
 * editor's `editor/editor-draft.ts` key their written versions by it.
 */
export function manifestAsRead(manifest: TourManifest): TourManifest {
  try {
    return parseTourManifest(JSON.parse(serializeTourManifest(manifest)));
  } catch {
    return manifest;
  }
}
