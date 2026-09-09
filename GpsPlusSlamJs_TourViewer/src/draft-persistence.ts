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
import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";

import type { AuthoringDraft } from "./authoring-draft.js";

/** The draft's one non-object file: the tour it belongs to, the printed
 *  size, and the measured level. */
const META_KEY = "meta";
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
    meta = parsed;
  } catch {
    return undefined;
  }

  const keys = await store.keys();
  const objects: TourObject[] = [];
  const photos = new Map<string, Blob>();
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
  };
}

function isMeta(value: unknown): value is DraftMeta {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["tourUrl"] === "string" &&
    typeof record["sizeM"] === "number" &&
    Number.isFinite(record["sizeM"]) &&
    (record["level"] === null || typeof record["level"] === "object")
  );
}
