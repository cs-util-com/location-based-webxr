/**
 * Reading and writing an authoring draft through a key-addressed file
 * store. The RULES about drafts are in `authoring-draft.ts`; this is the
 * shape on disk.
 *
 * ONE FILE PER OBJECT, append-only. Rewriting a whole draft on every
 * placement would be O(n squared) bytes on the main thread during a live
 * XR session, and the full-resolution placed photo (deferred to its own
 * round) is about to make each object an order of magnitude bigger. Per
 * object it is O(1) - and it means a file that fails to write, or reads
 * back corrupt, costs exactly that one object instead of the walk.
 *
 * VALIDATION IS THE MANIFEST'S OWN. A draft object is checked by round-
 * tripping it through `parseTourManifest`, the same function the finish
 * serialises through - so a draft can never hold something the finish
 * would later reject. Writing a second validator here is how the two would
 * come to disagree about what a tour object is.
 */

import {
  parseTourManifest,
  TOUR_MANIFEST_VERSION,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { isWritableQrLevelId } from "gps-plus-slam-app-framework/ar/qr/qr-level-archive";
import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";

import {
  parseMoveAnswers,
  type RememberedMoveAnswer,
} from "./code-move-prompt.js";
import type { AuthoringDraft } from "./authoring-draft.js";
import {
  parseVisitLogEntry,
  serializeVisitLogEntry,
  type VisitLogEntry,
} from "./visit-log.js";

/** The draft's one non-object file: the tour it belongs to, the printed
 *  size, and the measured level. */
/**
 * The file that decides whether a draft EXISTS: no meta, no draft.
 *
 * IT IS ALSO THE COMMIT POINT FOR A REJECTION. Writing this file with an
 * id in `rejected` is the single moment the discard becomes true; the
 * object deletes that follow are housekeeping and may fail, be
 * interrupted, or never run at all without changing what the next read
 * sees. Nothing is deleted before this write lands, so the window costs
 * nothing in either direction.
 *
 * The ordering it replaces, and why: this file used to be deleted FIRST,
 * so a reload racing a discard found no draft at all - a race live at
 * about one run in six (PR #443). Deleting it first meant emptying the
 * whole namespace, which is what made a discard delete pins placed
 * seconds earlier; removing that shape (r680) inverted the guarantee,
 * because the discard then rewrote this file and deleted afterwards, and
 * a reload in between was offered the draft it had just rejected. Neither
 * shape was safe in both directions. This one is: the old lost work, the
 * next resurrected a rejection, and a single authoritative write does
 * neither.
 *
 * The r680 window had a THIRD state, not just "kept" and "discarded", and
 * it is worth naming because the commit point is what removes it: the
 * rewritten meta dropped the rejected level (`recordMeta` writes
 * `ctx.mintedLevel`, which is null right after a fresh open), so a tab
 * closing between that write and the deletes left a draft with its objects
 * and NO measurement - offered, restorable, and with Finish still refused
 * until the creator walked back to the poster. Now that same interruption
 * leaves the objects rejected, so nothing is offered at all (PR #455
 * review).
 *
 * Design and costs:
 * `docs/2026-09-10-1345-draft-rejection-commit-point-plan.md` (docs repo).
 */
export const META_KEY = "meta";
const OBJECT_PREFIX = "object:";
const PHOTO_PREFIX = "photo:";
const DELETED_PREFIX = "deleted:";
const VISIT_PREFIX = "visit:";

/** A placed object's file key. */
export function objectKey(id: string): string {
  return `${OBJECT_PREFIX}${id}`;
}

/** A placed photo's bytes. Separate from its record so the JSON stays
 *  small and a failed photo write does not cost the pin beside it. */
export function photoKey(id: string): string {
  return `${PHOTO_PREFIX}${id}`;
}

/** A deletion's file key (a tombstone, authoring plan 2026-09-28-0953
 *  §3.4). Its own file for the reason each object has one: the meta is
 *  rewritten from memory on every mint and finish, and a list kept there
 *  would lose the deletions a not-yet-restored draft holds. */
export function deletedKey(id: string): string {
  return `${DELETED_PREFIX}${id}`;
}

/**
 * One AR visit's log (`visit-log.ts`, authoring plan 2026-09-28-0953 M3b):
 * its walk and the codes it measured, for the summary after Finish. Its
 * own file per visit, written at the visit's settle, for the reason each
 * object has one: a visit settled again rewrites only itself, and a file
 * that reads back corrupt costs that visit, not the others. Its id is the
 * visit id, which never collides with an object id (`newVisitId`).
 */
export function visitKey(visitId: string): string {
  return `${VISIT_PREFIX}${visitId}`;
}

/**
 * Delete every file of one id: the record, the bytes and a tombstone -
 * or, for a visit id, the visit's log.
 *
 * Callers reject a LIST of ids, and an id is up to three files. None is a
 * failure when it is not there: a pin has no photo, a placement has no
 * tombstone, and a caller should not have to know which ever reached disk.
 */
export async function removeDraftObject(
  store: DraftFileStore,
  id: string,
): Promise<void> {
  await store.remove(objectKey(id));
  await store.remove(photoKey(id));
  await store.remove(deletedKey(id));
  await store.remove(visitKey(id));
}

/**
 * Record that `id` was deleted, then remove its record and bytes.
 *
 * THE TOMBSTONE IS THE COMMIT POINT, like the meta is for a rejection: it
 * is written first, and `readDraft` lets it outrank a record still on
 * disk, so a crash between the two steps leaves a deletion rather than an
 * object that comes back. A tombstone that did not land is reported and
 * the record is left alone - removing it then would lose the object from
 * the draft without recording that it was deleted on purpose.
 */
export async function writeDraftDeletion(
  store: DraftFileStore,
  id: string,
): Promise<boolean> {
  if (!(await store.put(deletedKey(id), "1"))) return false;
  await store.remove(objectKey(id));
  await store.remove(photoKey(id));
  return true;
}

/**
 * Take back a deletion: remove `id`'s tombstone (an Undo, M4 review #5).
 * A record written for the id BEFORE this call (an edited object's) then
 * counts again; until then the tombstone outranks it, so an Undo cut short
 * leaves the object deleted rather than half restored.
 */
export async function removeDraftDeletion(
  store: DraftFileStore,
  id: string,
): Promise<boolean> {
  await store.remove(deletedKey(id));
  return true;
}

/** What the meta file holds. */
interface DraftMeta {
  tourUrl: string;
  sizeM: number;
  level: { id: string; json: string } | null;
  /**
   * Object ids the creator has thrown away, which `readDraft` refuses
   * whether or not their files are still on disk.
   *
   * OPTIONAL, and absent from every meta file already on a device. It is
   * PRUNED rather than accumulated: `readDraft` hands back only the ids
   * that still have files, and the next meta write stores that shorter
   * list, so it cannot grow for the life of a tour.
   */
  rejected?: readonly string[];
  /**
   * The move prompt's remembered answers (authoring plan 2026-09-28-0953
   * §3.6, M5b): "It's a second copy" and "Not now", per level and spot,
   * so a reload does not ask again. OPTIONAL like `rejected`, bounded by
   * `MOVE_ANSWERS_MAX`, re-stated on every write; an unreadable list
   * reads as no answers (the cost is one prompt asked again).
   */
  moveAnswers?: readonly RememberedMoveAnswer[];
}

/**
 * The rejected ids in a meta value, ignoring anything that is not a
 * string.
 *
 * WHICH WAY THIS FAILS IS THE DECISION. A list that does not read is
 * treated as NO rejection, never as a total one: hiding objects the
 * creator never discarded is silent data loss, the failure this feature
 * has produced four times, while offering a discarded draft a second time
 * costs a prompt with a "Delete it" button on it.
 */
function rejectedIdsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string");
}

/** Validate one object by the manifest's own rules. Returns null for
 *  anything the finish would later refuse - a truncated file, a record
 *  written by an older version of this app. */
export function parseDraftObject(text: string): TourObject | null {
  try {
    const parsed: unknown = JSON.parse(text);
    const manifest = parseTourManifest({
      version: TOUR_MANIFEST_VERSION,
      objects: [parsed],
    });
    return manifest.objects[0] ?? null;
  } catch {
    return null;
  }
}

/** Record the tour, the printed size and the measured level. */
export async function writeDraftMeta(
  store: DraftFileStore,
  meta: DraftMeta,
): Promise<boolean> {
  return store.put(META_KEY, JSON.stringify(meta));
}

/** Record one placement. The photo's bytes go in their own file. */
export async function writeDraftObject(
  store: DraftFileStore,
  object: TourObject,
  blob?: Blob,
): Promise<boolean> {
  const wroteObject = await store.put(
    objectKey(object.id),
    JSON.stringify(object),
  );
  if (blob === undefined) return wroteObject;
  const wrotePhoto = await store.put(photoKey(object.id), blob);
  return wroteObject && wrotePhoto;
}

/** Record one AR visit's log (one file per visit; a visit settled again
 *  replaces its file). */
export async function writeDraftVisit(
  store: DraftFileStore,
  entry: VisitLogEntry,
): Promise<boolean> {
  return store.put(visitKey(entry.visitId), serializeVisitLogEntry(entry));
}

/** What a read gives back: the draft's rules-facing shape, plus the photo
 *  bytes keyed by object id so the finish can write them as content. */
export interface StoredDraft {
  draft: AuthoringDraft;
  photos: ReadonlyMap<string, Blob>;
  /**
   * Ids the meta lists as rejected that STILL HAVE FILES.
   *
   * Two jobs in one list, both of which need exactly this set:
   * - **the prune** - it is what the next meta write stores, so an id
   *   whose files are gone drops out and the list stays bounded;
   * - **the sweep** - those are deletes that did not finish, and since
   *   `clear` lost its last caller nothing else would ever reclaim them.
   */
  rejectedIds: readonly string[];
  /**
   * The AR visits' logs (M3b), oldest first: what the summary after Finish
   * needs from visits of an earlier page load. Not part of `draft`: a visit
   * is never written into the zip - but it is offered with the draft and
   * keeps it from counting as spent (`draftIsSpent`, M3a/M3b review #5),
   * so only a discard drops it. A visit id the meta
   * rejects is skipped like an object's, and its file is among
   * `storedIds`, so a discard or a spent draft sweeps it with the rest.
   */
  visits: readonly VisitLogEntry[];
  /** The move prompt's remembered answers (M5b), well-formed ones only. */
  moveAnswers: readonly RememberedMoveAnswer[];
  /**
   * EVERY object id this read saw on disk, including the ones it refused
   * and the ones the meta rejects.
   *
   * `draft.objects` is what could be PARSED: a record written by an older
   * version, or a photo record whose bytes are missing, is skipped - and
   * both leave their files behind. `clear` used to sweep those, and with
   * its last caller gone nothing reclaims them, so they would survive for
   * the life of the origin in a namespace keyed by tour url. The
   * half-written photo is not hypothetical: `writeDraftObject` returns
   * false when the photo write hits a quota wall, and the record it
   * already wrote stays.
   *
   * Captured at READ time, exactly like `draft.objects`, so nothing this
   * session writes afterwards can be in the list.
   */
  storedIds: readonly string[];
}

/**
 * Read the whole draft, skipping anything unreadable.
 *
 * Returns undefined when there is no meta file - a directory with objects
 * but no meta cannot say which tour it belongs to, and guessing is how a
 * draft ends up appended to the wrong zip.
 */
export async function readDraft(
  store: DraftFileStore,
): Promise<StoredDraft | undefined> {
  const metaText = await store.getText(META_KEY);
  if (metaText === undefined) return undefined;
  let meta: DraftMeta;
  try {
    const parsed: unknown = JSON.parse(metaText);
    if (!isMeta(parsed)) return undefined;
    // An unreadable LEVEL costs the measurement, not the walk. The two
    // other meta fields say which tour a draft belongs to and how big the
    // printed code is - without them the draft cannot be used at all - but
    // a level that does not read is "this draft has no measurement yet",
    // which is a shape the whole flow already supports. Discarding the
    // draft instead would throw away every placement the creator made,
    // which is the opposite of the rule two screens up: a record that does
    // not read costs itself and nothing else (M1/M3 review #10).
    meta = isLevel(parsed.level) ? parsed : { ...parsed, level: null };
  } catch {
    return undefined;
  }

  const keys = await store.keys();
  // The committed rejections. Read from the raw parsed value, not through
  // the interface: `isMeta` does not validate this field, deliberately -
  // see `rejectedIdsOf`.
  const rejected = new Set(rejectedIdsOf(meta.rejected));
  const objects: TourObject[] = [];
  const photos = new Map<string, Blob>();
  // One snapshot, both prefixes: a photo file whose record never landed has
  // no `object:` key at all, so listing only those would miss it.
  // Sliced by the prefix that MATCHED, not by the first colon. The colon
  // version was coupled to "every prefix contains exactly one colon"
  // rather than to the constants: rename `PHOTO_PREFIX` to `photo-` and
  // `indexOf` returns -1, `slice(0)` hands back the whole key, and the
  // deletes become two no-ops - a silent leak no current test could catch,
  // because every one of them builds its keys with `objectKey`/`photoKey`
  // on both sides (PR #455 review).
  const storedIds = [
    ...new Set(
      keys.flatMap((key) => {
        for (const prefix of [
          OBJECT_PREFIX,
          PHOTO_PREFIX,
          DELETED_PREFIX,
          VISIT_PREFIX,
        ]) {
          if (key.startsWith(prefix)) return [key.slice(prefix.length)];
        }
        return [];
      }),
    ),
  ];
  // The deletions (tombstones), unless rejected: a discarded draft's
  // deletions go with it.
  const deleted = keys.flatMap((key) =>
    key.startsWith(DELETED_PREFIX) &&
    !rejected.has(key.slice(DELETED_PREFIX.length))
      ? [key.slice(DELETED_PREFIX.length)]
      : [],
  );
  const tombstoned = new Set(deleted);
  for (const key of keys) {
    if (!key.startsWith(OBJECT_PREFIX)) continue;
    // A tombstone outranks a record a crash left behind it
    // (`writeDraftDeletion`).
    if (tombstoned.has(key.slice(OBJECT_PREFIX.length))) continue;
    // A committed rejection outranks the file. Skipping here also skips
    // the photo read below, so a rejected photo's bytes never reach the
    // finish either.
    if (rejected.has(key.slice(OBJECT_PREFIX.length))) continue;
    const text = await store.getText(key);
    if (text === undefined) continue;
    const object = parseDraftObject(text);
    // A corrupt record costs itself and nothing else - the reason each one
    // has its own file.
    if (object === null) continue;
    objects.push(object);
    if (object.kind !== "photo") continue;
    const blob = await store.getBlob(photoKey(object.id));
    // A photo record whose bytes are gone would name a content entry the
    // rebuilt zip does not contain, which is the failure mode PR #435 was
    // about. Drop the record with them.
    if (blob === undefined) {
      objects.pop();
      continue;
    }
    photos.set(object.id, blob);
  }
  // Stable order: the store lists in whatever order the directory yields,
  // and a tour's objects should not shuffle between restores.
  objects.sort(
    (a, b) =>
      a.createdAtIso.localeCompare(b.createdAtIso) || a.id.localeCompare(b.id),
  );
  const visits = await readVisits(store, keys, rejected);
  const onDisk = new Set(storedIds);
  return {
    draft: {
      tourUrl: meta.tourUrl,
      sizeM: meta.sizeM,
      level: meta.level,
      objects,
      deleted: deleted.sort(),
    },
    photos,
    rejectedIds: [...rejected].filter((id) => onDisk.has(id)),
    visits,
    // From the raw parsed value, like `rejected`: `isMeta` does not
    // validate it, `parseMoveAnswers` does.
    moveAnswers: parseMoveAnswers(meta.moveAnswers),
    storedIds,
  };
}

/** The visits' logs among `keys`, minus rejected ids, oldest first. A
 *  corrupt visit file costs itself, like an object. */
async function readVisits(
  store: DraftFileStore,
  keys: readonly string[],
  rejected: ReadonlySet<string>,
): Promise<VisitLogEntry[]> {
  const visits: VisitLogEntry[] = [];
  for (const key of keys) {
    if (!key.startsWith(VISIT_PREFIX)) continue;
    if (rejected.has(key.slice(VISIT_PREFIX.length))) continue;
    const text = await store.getText(key);
    const entry = text === undefined ? null : parseVisitLogEntry(text);
    if (entry !== null) visits.push(entry);
  }
  return visits.sort(
    (a, b) => a.atMs - b.atMs || a.visitId.localeCompare(b.visitId),
  );
}

function isMeta(value: unknown): value is DraftMeta {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["tourUrl"] === "string" &&
    typeof record["sizeM"] === "number" &&
    Number.isFinite(record["sizeM"])
  );
}

/**
 * The measured level, or null - checked field by field for the same reason
 * an object is (PR #438 review).
 *
 * `typeof x === "object"` accepted `{}`, `[]` and `{ id: 5 }`, which were
 * then used as `{ id: string; json: string }`. This field travels further
 * than any other: it reaches `hostedLevelJson(level.id)`, then
 * `ctx.mintedLevel`, then `qrLevelEntryName(minted.id)`, which throws on an
 * id that is not a safe string. The creator would get an opaque finish
 * failure and no way forward but to re-measure or discard the draft - the
 * failure this feature exists to prevent. A record this cannot read must
 * come back as "no draft", never as a level the finish cannot name.
 */
function isLevel(value: unknown): value is DraftMeta["level"] {
  if (value === null) return true;
  if (typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  // The framework's OWN id rule, not `typeof === "string"`: the throw this
  // guard exists to prevent is `qrLevelFileName`'s, and that rejects a
  // string carrying a path separator or a `..` segment. A weaker check here
  // reads as closed while the failure path stays open (PR #438 review,
  // second pass).
  return (
    isWritableQrLevelId(record["id"]) && typeof record["json"] === "string"
  );
}
