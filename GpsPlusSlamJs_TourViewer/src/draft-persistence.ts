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

import type { AuthoringDraft } from "./authoring-draft.js";

/** The draft's one non-object file: the tour it belongs to, the printed
 *  size, and the measured level. */
/**
 * The file that decides whether a draft EXISTS: no meta, no draft.
 *
 * It used to be deleted FIRST when a draft was thrown away, so a reload
 * racing a discard found nothing rather than the draft just rejected -
 * a race that was live at about one run in six (PR #443). **That
 * guarantee is gone as of 2026-09-10** and the sentence describing it has
 * been removed rather than left to be believed: the discard now REWRITES
 * this file (dropping the rejected level, keeping this session's) and
 * deletes the rejected objects afterwards. A reload inside that window
 * finds a valid meta and some un-deleted objects, so the discarded draft
 * can be offered once more.
 *
 * That is the deliberate side of the trade - the alternative deleted work
 * the creator had NOT discarded - but it is a real inversion of what this
 * comment used to promise. Closing it properly means recording the
 * rejection IN this file so the meta write is the commit point; see
 * `docs/2026-09-10-1345-draft-rejection-commit-point-plan.md` in the docs
 * repo.
 */
export const META_KEY = "meta";
const OBJECT_PREFIX = "object:";
const PHOTO_PREFIX = "photo:";

/** A placed object's file key. */
export function objectKey(id: string): string {
  return `${OBJECT_PREFIX}${id}`;
}

/** A placed photo's bytes. Separate from its record so the JSON stays
 *  small and a failed photo write does not cost the pin beside it. */
export function photoKey(id: string): string {
  return `${PHOTO_PREFIX}${id}`;
}

/**
 * Delete one placed object and its photo.
 *
 * Callers reject a LIST of ids, and an object is two files - the record and
 * the bytes. Neither is a failure when it is not there: a pin has no photo,
 * and a caller should not have to know which half ever reached disk.
 */
export async function removeDraftObject(
  store: DraftFileStore,
  id: string,
): Promise<void> {
  await store.remove(objectKey(id));
  await store.remove(photoKey(id));
}

/** What the meta file holds. */
interface DraftMeta {
  tourUrl: string;
  sizeM: number;
  level: { id: string; json: string } | null;
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

/** What a read gives back: the draft's rules-facing shape, plus the photo
 *  bytes keyed by object id so the finish can write them as content. */
export interface StoredDraft {
  draft: AuthoringDraft;
  photos: ReadonlyMap<string, Blob>;
  /**
   * EVERY object id this read saw on disk, including the ones it refused.
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
  const objects: TourObject[] = [];
  const photos = new Map<string, Blob>();
  // One snapshot, both prefixes: a photo file whose record never landed has
  // no `object:` key at all, so listing only those would miss it.
  const storedIds = [
    ...new Set(
      keys
        .filter(
          (key) =>
            key.startsWith(OBJECT_PREFIX) || key.startsWith(PHOTO_PREFIX),
        )
        .map((key) => key.slice(key.indexOf(":") + 1)),
    ),
  ];
  for (const key of keys) {
    if (!key.startsWith(OBJECT_PREFIX)) continue;
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
  return {
    draft: {
      tourUrl: meta.tourUrl,
      sizeM: meta.sizeM,
      level: meta.level,
      objects,
    },
    photos,
    storedIds,
  };
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
