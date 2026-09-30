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

import type {
  TourManifest,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

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
  /** The objects placed or changed on this device (an edit or a move of
   *  a hosted object keeps its id), not yet seen in the hosted zip. */
  objects: readonly TourObject[];
  /** The ids deleted on this device (tombstones, authoring plan
   *  2026-09-28-0953 §3.4): pending while the hosted zip still carries
   *  them. */
  deleted: readonly string[];
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
  const hosted = new Map(
    (manifest?.objects ?? []).map((o) => [o.id, objectContentKey(o)]),
  );
  return draft.objects.filter((o) => hosted.get(o.id) !== objectContentKey(o));
}

/** The draft's deletions the hosted zip still carries: not yet published. */
export function draftDeletionsNotYetHosted(
  draft: AuthoringDraft,
  manifest: TourManifest | null,
): readonly string[] {
  const hosted = new Set((manifest?.objects ?? []).map((o) => o.id));
  return draft.deleted.filter((id) => hosted.has(id));
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
 */
export function draftIsSpent(
  draft: AuthoringDraft,
  manifest: TourManifest | null,
  hostedLevelJson: string | null = null,
): boolean {
  if (draftObjectsNotYetHosted(draft, manifest).length > 0) return false;
  // A deletion the zip has not seen is work too: dropping the draft would
  // bring the deleted object back on the next Finish.
  if (draftDeletionsNotYetHosted(draft, manifest).length > 0) return false;
  return !draftHasUnhostedLevel(draft, hostedLevelJson);
}

/** Whether a draft holds a measurement the hosted zip does not have. */
export function draftHasUnhostedLevel(
  draft: AuthoringDraft,
  hostedLevelJson: string | null,
): boolean {
  return draft.level !== null && draft.level.json !== hostedLevelJson;
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
 *  object the zip carries, and a deletion). */
interface OtherWork {
  readonly changed?: number;
  readonly deleted?: number;
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
  if (total === 0) {
    return "Unsaved work from this tour is still on this device: the code's measured position. Add it back?";
  }
  if (hasLevel) parts.push("the code's measured position");
  return `Unsaved work from this tour is still on this device: ${listed(parts)}. ${total === 1 ? "Add it back?" : "Add them back?"}`;
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
  if (total === 0) {
    return `The code's measured position was restored - Finish is ready without walking to the poster again.`;
  }
  const measured = hasLevel
    ? " The code's measured position came back too, so Finish is ready without walking to the poster again."
    : "";
  return `${listed(parts)} restored - ${total === 1 ? "it goes" : "they go"} into the zip on the next Finish.${measured}`;
}
