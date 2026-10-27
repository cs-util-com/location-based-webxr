/**
 * The Finish's rules, page-free (M6 E0, B10's "shared business logic",
 * root CLAUDE.md DEC-H3): from an open tour and the edits to it, the
 * finished zip - the manifest with the edits applied, the files to write
 * and to remove, a listed tour's series continued, rebuilt from the NEWEST
 * bytes. The phone's Finish (`creator-finish.ts`) and the desktop editor
 * call this one module; the page state around it (progress, the hand-off,
 * the session's end) stays with each page.
 *
 * @see finish-rebuild.ts.md
 */

import { TOUR_MANIFEST_ENTRY } from "gps-plus-slam-app-framework/ar/tour-archive";
import {
  serializeTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourObjects } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import {
  serializeSignedTourManifest,
  signedManifestFilesOf,
  successorManifest,
  type SignedTourManifest,
  type TourFileRecord,
} from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import { rebuildZipWithEntries } from "gps-plus-slam-app-framework/storage";
import { sha256Hex } from "gps-plus-slam-app-framework/utils/sha256-hex";
import {
  applyObjectChanges,
  hostedObjects,
} from "./authoring-draft.js";
import type { LevelText } from "./code-book.js";
import { finishEntries, type FinishEntry } from "./finish-entries.js";
import { scanEntryNames } from "./tour-read-set.js";
import {
  downloadSafeName,
  nameSurvivesDownload,
} from "./content-disposition.js";
import {
  isCapturedPhoto,
  withReferencedAssets,
  withTourContent,
} from "./tour-content.js";
import { archiveFileName, type TourSession } from "./tour-session.js";

/** The open tour, as far as a rebuild reads it. */
type FinishTour = Pick<
  TourSession,
  "entries" | "manifestWrap" | "integrity" | "budget" | "readWholeArchive"
>;

/** A previous rebuild of the same open tour: the newest bytes. */
interface PreviousFinish {
  readonly blob: Blob;
  readonly signedManifest?: SignedTourManifest;
}

export interface FinishInput {
  readonly tour: FinishTour;
  /** The manifest the tour carries now (after any earlier rebuild). */
  readonly manifest: TourManifest;
  /** Objects placed or edited, each replacing its id's record; a photo
   *  with bytes writes them as its content file. Read synchronously at the
   *  call, before the first await: pass a snapshot, never a list the page
   *  keeps changing (E0 review #6). */
  readonly placed: readonly {
    readonly object: TourObject;
    readonly blob?: Blob;
  }[];
  /** Ids to delete; a deleted photo takes its content file with it. */
  readonly deleted: readonly string[];
  /** The code levels to write, in order. */
  readonly levels: readonly LevelText[];
  /** The tour's name as typed: one that says something becomes `title`,
   *  an emptied one removes it, null (or absent) keeps the tour's own. */
  readonly title?: string | null;
  /** Assets the page's undo history still names (`historyAssetIds`):
   *  kept, with their files, though the written tour does not name them. */
  readonly keepAssets?: ReadonlySet<string>;
  /** Keep the entries visitors never read (the walk, S-D10). */
  readonly keepScan: boolean;
  /** The last rebuild of this open tour; null or absent for the first,
   *  which reads the tour and inflates it under its budget. */
  readonly previous?: PreviousFinish | null;
  /** The clock for the series version's `createdAt`. */
  readonly now?: () => Date;
  /** False once the caller no longer wants the result (the tour was
   *  closed meanwhile): checked after the read, before the rebuild. */
  readonly shouldContinue?: () => boolean;
  readonly onProgress?: (done: number, total: number) => void;
}

export interface FinishedTour {
  readonly blob: Blob;
  /** The manifest the zip carries. */
  readonly written: TourManifest;
  /** A listed tour's continued file list. */
  readonly signedManifest?: SignedTourManifest;
  /** The entries visitors never read that were left out. */
  readonly scanLeftOut: readonly string[];
  /** The bytes this rebuild read: the open tour's own (`readWholeArchive`)
   *  for the first, the previous rebuild's after it. The phone's "Save the
   *  debug data" keeps the first one's (debug-captures plan M2:
   *  never read again - a link's file may have been replaced). */
  readonly source: Blob;
}

/** The title a finished tour carries (polish round M4a: the visitor's
 *  start page leads with it): the name as typed, none when the name was
 *  emptied (W2 of the tour editor plan: an emptied name no longer keeps
 *  the old title silently), and the title the tour had when no name was
 *  typed (null). */
function finishTitle(
  current: string | undefined,
  typed: string | null,
): string | undefined {
  if (typed === null) return current;
  const name = typed.trim();
  return name === "" ? undefined : name;
}

/** What a Finish writes into the manifest, without the zip. */
export interface FinishedManifestInput {
  /** The manifest the tour carries now (after any earlier rebuild). */
  readonly manifest: TourManifest;
  /** Objects placed or edited, each replacing its id's record. */
  readonly placed: readonly { readonly object: TourObject }[];
  /** Ids to delete. */
  readonly deleted: readonly string[];
  /** The tour's name as typed (`FinishInput.title`). */
  readonly title?: string | null;
  /** Assets another view of the tour still names (its undo history,
   *  `historyAssetIds`): kept though the written tour does not. */
  readonly keepAssets?: ReadonlySet<string>;
}

/**
 * The manifest a Finish writes (the rule `rebuildFinishedTour` applies,
 * pure, so the tour document's selector and the rebuild share it): what
 * the zip carried, with this device's records REPLACING theirs by id (an
 * edit or a move of a hosted object), the new ones appended and the
 * deleted ones filtered out (plan §3.4, M4), every pin and photo in the
 * station it names: the stations are the
 * manifest's as they are (the tour document made them), so two calls on
 * the same input agree exactly. Throws for an object in no station of
 * the manifest (`withTourContent`).
 */
export function finishedManifest(input: FinishedManifestInput): TourManifest {
  const { manifest } = input;
  const title = finishTitle(manifest.title, input.title ?? null);
  const untitled = { ...manifest };
  delete untitled.title;
  // The unmoved ones keep their local poses; every object is written
  // into the station it names, and an asset nothing names any more is
  // dropped (`tour-content.ts`).
  return withReferencedAssets(
    withTourContent(
      { ...untitled, ...(title === undefined ? {} : { title }) },
      {
        // Never an id twice, and not for tidiness: the serializer REJECTS
        // duplicates, so one restored object that is already in the
        // manifest would make every finish throw - for as long as the
        // draft is restored, with no escape inside the app (M5 review #4).
        objects: applyObjectChanges(
          tourObjects(manifest),
          input.placed.map((p) => p.object),
          input.deleted,
        ),
      },
    ),
    input.keepAssets,
  );
}

/** The zip entries a write removes: the file of every asset the write
 *  dropped (a deleted photo's own included, and only when nothing else
 *  names it: B2a review 2, never by the picture alone), the entries
 *  visitors never read that were left out, the old signatures, and a list
 *  that does not continue (`listName`, undefined when it does or there is
 *  none). */
function entriesToRemove(input: {
  readonly wrap: string;
  readonly before: TourManifest;
  readonly written: TourManifest;
  readonly scanLeftOut: readonly string[];
  readonly signatureNames: readonly string[];
  readonly listName: string | undefined;
}): string[] {
  const { wrap } = input;
  const keptAssets = new Set(input.written.assets.map((a) => a.id));
  return [
    ...input.before.assets.flatMap((a) =>
      keptAssets.has(a.id) ? [] : [`${wrap}${a.path}`],
    ),
    ...input.scanLeftOut,
    ...input.signatureNames,
    ...(input.listName === undefined ? [] : [input.listName]),
  ];
}

/** A written entry's record for `manifest.json`: the SHA-256 and size of
 *  the bytes the zip will hold (a string is written as UTF-8). */
async function fileRecordOf(
  data: Blob | Uint8Array | string,
): Promise<TourFileRecord> {
  const bytes =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : data instanceof Uint8Array
        ? data
        : new Uint8Array(await data.arrayBuffer());
  return { sha256: await sha256Hex(bytes), size: bytes.length };
}

/**
 * The finished tour, or null when `shouldContinue` said stop. Throws what
 * the serializer, the read and the rebuild throw (a duplicate id, a cap, a
 * failed integrity check): the caller shows it.
 */
export async function rebuildFinishedTour(
  input: FinishInput,
): Promise<FinishedTour | null> {
  const { tour, manifest } = input;
  // One expression for "is there a previous rebuild": the read and the
  // budget rule below must never disagree (E0 review #8).
  const previous = input.previous ?? null;
  const entryNames = tour.entries.map((e) => e.filename);
  // The session derived this prefix when it opened the zip; deriving
  // it a second time here is how the writer and the reader drifted
  // apart in the first place (PR #435 review).
  const wrap = tour.manifestWrap;
  const manifestPath = `${wrap}${TOUR_MANIFEST_ENTRY}`;
  // The manifest (`finishedManifest`); the photos' bytes become content
  // entries next to it.
  const deleted = [...input.deleted];
  const written: TourManifest = finishedManifest({ ...input, deleted });
  // A deleted photo takes its content file with it when nothing else
  // names its image (the dropped assets' files). A signature over
  // the old list cannot cover the files this Finish rewrites, so it
  // goes - the output is unsigned until K2 signs on export. The list
  // itself CONTINUES for a listed tour (K1 milestone review R7, below);
  // anything else carrying the name is dropped with it.
  const [listName, ...signatureNames] = signedManifestFilesOf(entryNames);
  const listed =
    tour.integrity.kind === "listed" && listName !== undefined
      ? { integrity: tour.integrity, entry: listName }
      : null;
  // The published copy carries only what visitors read unless the
  // creator keeps the walk (S-D10): the walk, its unbaked frames, depth.
  // With or without baked spots: a visitor shows baked photos only and
  // never reads the walk. The hosted file may be the creator's only copy
  // of it, which the Finish says (`FINISH_LABELS.scanLeftOut`).
  const scanLeftOut = input.keepScan
    ? []
    : scanEntryNames(entryNames, written, wrap);
  const removed = entriesToRemove({
    wrap,
    before: manifest,
    written,
    scanLeftOut,
    signatureNames,
    listName: listed === null ? listName : undefined,
  });
  // The level replaced where the zip holds it (also wrapped), a new
  // one inside a listed tour's folder or at the root
  // (`finish-entries.ts`), then the manifest and the photos.
  const entries: FinishEntry[] = finishEntries({
    entryNames,
    levels: input.levels,
    wrap,
    listed: listed !== null,
    manifestPath,
    manifestJson: serializeTourManifest(written),
    photos: input.placed.flatMap((p) =>
      isCapturedPhoto(p.object) && p.blob !== undefined
        ? [{ image: p.object.imageAsset.path, blob: p.blob }]
        : [],
    ),
  });
  // The input is the NEWEST bytes for this tour: a previous finish's
  // rebuild when there is one, because it already carries that
  // batch's content entries - rebuilding from the hosted zip again
  // would write a manifest referencing photos the archive does not
  // contain (PR #435 review, the second half of the second-finish
  // bug). A caller passes no previous rebuild for a tour it has just
  // opened, so that one starts from what is actually hosted.
  const source =
    previous === null ? await tour.readWholeArchive() : previous.blob;
  if (input.shouldContinue?.() === false) return null;
  // The series' list, continued: the same series id, the next
  // version, and the hash of every file this zip will hold - the
  // kept ones from the list the input carries (checked at open and
  // as a whole by readWholeArchive, or written by the last Finish),
  // the written ones hashed here. Without it the series id's only
  // home was dropped (R7).
  let signedManifest: SignedTourManifest | undefined;
  if (listed !== null) {
    signedManifest = successorManifest(
      listed.integrity.manifest,
      listed.entry,
      {
        ...(previous?.signedManifest === undefined
          ? {}
          : { baseFiles: previous.signedManifest.files }),
        removed,
        written: new Map(
          await Promise.all(
            entries.map(
              async (e) => [e.path, await fileRecordOf(e.data)] as const,
            ),
          ),
        ),
        createdAt: (input.now?.() ?? new Date()).toISOString(),
      },
    );
    entries.push({
      path: listed.entry,
      data: serializeSignedTourManifest(signedManifest),
    });
  }
  const blob = await rebuildZipWithEntries(source, entries, {
    remove: removed,
    // The open archive is untrusted, so its rebuild inflates under
    // the session's own budget (K0 milestone review R1). A previous
    // Finish's zip is this page's own output, stored and bounded:
    // the rebuild sizes a budget for it itself.
    ...(previous === null ? { budget: tour.budget } : {}),
    ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
  });
  return {
    blob,
    written,
    ...(signedManifest === undefined ? {} : { signedManifest }),
    scanLeftOut,
    source,
  };
}

/**
 * What is still to save after a write (M6 E0b): the placed objects whose
 * content the written zip does not carry - by CONTENT, not id, so an
 * object edited again while the zip was rebuilt waits for the next save
 * (M2c review #6) - the ones that left (`finished`; the caller keeps a
 * photo's bytes for its preview), and the deletions the write did not
 * apply. The caller passes its lists as they are NOW, after the write.
 */
export function pendingAfterRebuild<P extends { readonly object: TourObject }>(
  pending: {
    readonly placed: readonly P[];
    readonly deleted: readonly string[];
  },
  written: TourManifest,
  appliedDeletions: readonly string[],
): { placed: P[]; finished: P[]; deleted: string[] } {
  // As stored: a placement reads back through its station's frame.
  const inZip = hostedObjects(written);
  const placed: P[] = [];
  const finished: P[] = [];
  for (const p of pending.placed) {
    if (inZip.holds(p.object)) finished.push(p);
    else placed.push(p);
  }
  // The deletions are applied: the manifest no longer carries them.
  const deleted = pending.deleted.filter(
    (id) => !appliedDeletions.includes(id),
  );
  return { placed, finished, deleted };
}

/**
 * The name a finished tour is saved under: the hosted file's own name -
 * Drive offers "Replace" only for the same name (Drive replace plan §2
 * decision 3) - made safe where a download would change it, else the
 * link's file name, else `tour.zip`. The phone's Finish and the desktop
 * editor's Save (M6 E2a, E2 plan review #7).
 */
export function finishedFileName(
  tour: Pick<TourSession, "hostedFileName"> & {
    readonly archive: { readonly url: string };
  },
): string {
  const hosted = tour.hostedFileName();
  if (hosted === null) return archiveFileName(tour.archive.url);
  return nameSurvivesDownload(hosted) ? hosted : downloadSafeName(hosted);
}
