/**
 * The troubleshooting recordings ON DISK, across page lives (authoring
 * recording plan 2026-09-28-0953, M1b): which recording folders exist,
 * which of them were saved, packing a folder into its zip, rebuilding the
 * `session.json` of a folder whose page was killed, and which folders the
 * cleanup deletes.
 *
 * - SAVED IS A MARKER, WRITTEN AFTER THE HAND-OFF. A folder counts as saved
 *   when its marker (`saved` in a `DraftFileStore` over the folder - the
 *   draft machinery's never-throwing key file) names at least as many
 *   action files as the folder holds. The count is taken BEFORE the zip and
 *   counts only files with content, so an action written while the zip was
 *   built, still being written, or written after it (a recording keeps
 *   running after a save) makes the folder unsaved again: the error
 *   is always "offered once too often", never "deleted unsaved". A killed
 *   tab never wrote a marker, so its folder is unsaved.
 * - NOTHING UNSAVED IS DELETED WITHOUT THE AUTHOR. The cleanup deletes
 *   saved folders past an age or a count, and a folder with no action file
 *   at all (nothing to save); an unsaved recording goes only through the
 *   offer's "Delete it".
 * - ONLY THIS APP'S FOLDERS. Anything under `gps-plus-slam/tour-viewer/`
 *   that is not a `recording-<UTC timestamp>` directory is left alone.
 *
 * @see recording-folders.ts.md
 */

import {
  createDraftFileStore,
  exportSessionHandleAsZip,
  formatTimestamp,
  writeFileOrAbort,
} from "gps-plus-slam-app-framework/storage";
import { recordGpsEvent } from "gps-plus-slam-app-framework/state";
import {
  buildSessionMetadataRecord,
  type SessionMetadataRecord,
} from "gps-plus-slam-app-framework/storage/session-metadata-record";
import type { BuildInfo } from "gps-plus-slam-app-framework/utils/build-info";

/** Where this app's recordings live, under the OPFS root. Both apps share
 *  one origin; the Recorder's recordings are in `gps-plus-slam/sessions/`. */
const APP_DIR = "gps-plus-slam";
const RECORDINGS_DIR = "tour-viewer";

/** The metadata file's name in a recording folder (the Recorder's layout). */
const SESSION_METADATA_FILE = "session.json";
const ACTIONS_DIR = "actions";
/** The saved marker's key in the folder's `DraftFileStore`. */
const SAVED_MARKER_KEY = "saved";

/** `session.json`'s tag for each kind of recording. */
export const AUTHORING_CONTEXT_TAG = "tour-authoring";
export const VIEWING_CONTEXT_TAG = "tour-viewing";
export type RecordingContextTag =
  typeof AUTHORING_CONTEXT_TAG | typeof VIEWING_CONTEXT_TAG;

const HOUR_MS = 60 * 60 * 1000;

/**
 * How long a SAVED recording stays on the phone after its save, how many
 * saved ones are kept, and how long after its save a copy is safe from the
 * count (a field day's sessions all stay until the owner has looked at
 * them: "delivered" is optimistic). The sidecar's "Cleanup bound" weighs
 * them over a range against the measured ~125 MB per recorded hour.
 */
export const SAVED_RECORDING_MAX_AGE_MS = 7 * 24 * HOUR_MS;
export const SAVED_RECORDINGS_KEPT = 3;
export const SAVED_RECORDING_MIN_AGE_MS = 24 * HOUR_MS;

/**
 * How old (from its start) a folder with no action file must be before the
 * cleanup deletes it: younger, it may be a live page's that has not written
 * yet. Long, because keeping an empty folder costs nothing and deleting a
 * live one costs the recording (sidecar, "Cleanup bound").
 */
export const EMPTY_RECORDING_MIN_AGE_MS = HOUR_MS;

const FOLDER_NAME =
  /^recording-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})utc(?:-\d+)?$/;

/**
 * The start time a recording folder's name carries (`createSessionInDirectory`
 * names it `recording-<formatTimestamp>` with a `-N` suffix on a collision),
 * or null for any name this app did not write - a calendar-impossible date
 * included, which is why the parse is checked by formatting it back.
 */
export function recordingStartOf(name: string): number | null {
  const m = FOLDER_NAME.exec(name);
  if (m === null) return null;
  const [year, month, day, hour, minute, second] = m
    .slice(1, 7)
    .map((part) => Number(part));
  const ms = Date.UTC(
    year ?? 0,
    (month ?? 0) - 1,
    day ?? 0,
    hour ?? 0,
    minute ?? 0,
    second ?? 0,
  );
  const stamp = name.slice("recording-".length).replace(/-\d+$/, "");
  return formatTimestamp(new Date(ms)) === stamp ? ms : null;
}

/** The recording zip's name, from the folder's start time. */
export function recordingFileName(startedAt: Date): string {
  return `tour-recording-${formatTimestamp(startedAt)}.zip`;
}

const LOCK_PREFIX = "gps-plus-slam/tour-viewer/";

/**
 * The Web Lock a page holds on the folder it records into, for the page's
 * whole life. The browser releases it when the page goes - which is exactly
 * "the tab was killed" - so a folder whose lock is held belongs to a live
 * page (this one, or another tab) and is neither offered nor cleaned up.
 */
function recordingLockName(folderName: string): string {
  return `${LOCK_PREFIX}${folderName}`;
}

/** The Web Locks this module needs (`navigator.locks`). */
export type RecordingLocks = Pick<LockManager, "query" | "request">;

/**
 * Hold the folder's lock until the page goes: the request's callback
 * returns a promise that never settles, so the lock is released only when
 * the browser drops the page. Resolves once the browser answered - true
 * when the lock is now held, false when another page holds the name (the
 * request is `ifAvailable`, so it never waits for a lock held for a page's
 * life), without Web Locks, or when the request fails. The page takes it
 * BEFORE it creates the folder (M1b review #2), so a folder another page's
 * cleanup can see is already held. Without Web Locks nothing is held (and
 * the next page's offer may then offer a folder another open tab still
 * records into - the tab's own writes then fail visibly on its marker).
 */
export function holdRecordingFolder(
  locks: RecordingLocks | undefined,
  folderName: string,
): Promise<boolean> {
  if (locks === undefined) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    locks
      .request(
        recordingLockName(folderName),
        { ifAvailable: true },
        (lock: Lock | null) => {
          resolve(lock !== null);
          return lock === null ? undefined : new Promise<never>(() => {});
        },
      )
      .catch(() => {
        resolve(false);
      });
  });
}

/** The folders a live page holds or waits for (none without Web Locks, or
 *  when the query fails). A pending request counts: its page is alive and
 *  wants that folder. */
export async function heldRecordingFolders(
  locks: RecordingLocks | undefined,
): Promise<Set<string>> {
  const held = new Set<string>();
  try {
    const snapshot = await locks?.query();
    for (const lock of [
      ...(snapshot?.held ?? []),
      ...(snapshot?.pending ?? []),
    ]) {
      if (lock.name?.startsWith(LOCK_PREFIX) === true) {
        held.add(lock.name.slice(LOCK_PREFIX.length));
      }
    }
  } catch {
    // No answer: nothing is known to be held.
  }
  return held;
}

/** The recordings directory, or null when it does not exist (and `create`
 *  is false) or OPFS refuses. */
export async function openRecordingsDir(
  root: FileSystemDirectoryHandle,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    const app = await root.getDirectoryHandle(APP_DIR, { create });
    return await app.getDirectoryHandle(RECORDINGS_DIR, { create });
  } catch (err) {
    if (create) throw err;
    return null;
  }
}

/** One recording folder, as the disk describes it. */
export interface RecordingFolder {
  readonly name: string;
  readonly startedAtMs: number;
  readonly actionFiles: number;
  /** When the last save handed the folder over; null: never saved (or the
   *  marker does not read). */
  readonly savedAtMs: number | null;
  /** Everything in the folder was handed over by a save. */
  readonly saved: boolean;
}

interface SavedMarker {
  savedAtMs: number;
  actionFiles: number;
}

function parseMarker(text: string | undefined): SavedMarker | null {
  if (text === undefined) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return null;
    const { savedAtMs, actionFiles } = value as Record<string, unknown>;
    if (typeof savedAtMs !== "number" || !Number.isFinite(savedAtMs)) {
      return null;
    }
    if (
      typeof actionFiles !== "number" ||
      !Number.isInteger(actionFiles) ||
      actionFiles < 0
    ) {
      return null;
    }
    return { savedAtMs, actionFiles };
  } catch {
    return null;
  }
}

/** The names of a recording folder's action files, with their directory
 *  (none without an `actions/`). */
async function actionFileNames(
  folder: FileSystemDirectoryHandle,
): Promise<{ actions: FileSystemDirectoryHandle | null; names: string[] }> {
  const names: string[] = [];
  let actions: FileSystemDirectoryHandle | null = null;
  try {
    actions = await folder.getDirectoryHandle(ACTIONS_DIR);
    for await (const name of actions.keys()) {
      if (name.endsWith(".json")) names.push(name);
    }
  } catch {
    // No actions directory: nothing was written.
  }
  return { actions, names };
}

/** The action files in a recording folder, by name (0 without an
 *  `actions/`): a directory listing, no file reads - the page-open count. */
export async function countActionFiles(
  folder: FileSystemDirectoryHandle,
): Promise<number> {
  return (await actionFileNames(folder)).names.length;
}

/**
 * The action files that hold content - the count a saved marker carries.
 * OPFS creates a file empty at `getFileHandle({ create: true })` and fills
 * it only when the write closes, so a write in flight is a name with no
 * content yet, and a zip taken then holds it empty. Leaving it out of the
 * marker makes the folder unsaved once the write lands (M1b review #3). A
 * file that cannot be read counts as empty, the same safe direction.
 */
async function countWrittenActionFiles(
  folder: FileSystemDirectoryHandle,
): Promise<number> {
  const { actions, names } = await actionFileNames(folder);
  if (actions === null) return 0;
  let count = 0;
  for (const name of names) {
    try {
      const file = await (await actions.getFileHandle(name)).getFile();
      if (file.size > 0) count += 1;
    } catch {
      // Unreadable: not counted (see above).
    }
  }
  return count;
}

/**
 * Every recording folder of this app, oldest first, except those named in
 * `skip` (the folders a live page holds). A folder that cannot be read is
 * left out rather than failing the listing: the offer and the cleanup are
 * best effort, and a folder left out is neither offered nor deleted.
 */
export async function listRecordingFolders(
  dir: FileSystemDirectoryHandle,
  skip: ReadonlySet<string> = new Set(),
): Promise<RecordingFolder[]> {
  // Names first, then the reads: nothing here deletes, but reading while
  // iterating a directory another page may be writing is the same hazard
  // the draft store's `clear` documents.
  const names: string[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "directory" && !skip.has(name)) names.push(name);
  }
  const folders: RecordingFolder[] = [];
  for (const name of names) {
    const startedAtMs = recordingStartOf(name);
    if (startedAtMs === null) continue;
    try {
      const folder = await dir.getDirectoryHandle(name);
      const actionFiles = await countActionFiles(folder);
      const marker = parseMarker(
        await createDraftFileStore(folder).getText(SAVED_MARKER_KEY),
      );
      folders.push({
        name,
        startedAtMs,
        actionFiles,
        savedAtMs: marker?.savedAtMs ?? null,
        saved: marker !== null && actionFiles <= marker.actionFiles,
      });
    } catch {
      // Unreadable: left out (see above).
    }
  }
  return folders.sort(
    (a, b) => a.startedAtMs - b.startedAtMs || a.name.localeCompare(b.name),
  );
}

/** Record that a save handed over `actionFiles` action files at `atMs`.
 *  False when the marker could not be written (the folder is then offered
 *  again on the next open - the harmless direction). */
async function markRecordingSaved(
  folder: FileSystemDirectoryHandle,
  actionFiles: number,
  atMs: number,
): Promise<boolean> {
  const marker: SavedMarker = { savedAtMs: atMs, actionFiles };
  return createDraftFileStore(folder).put(
    SAVED_MARKER_KEY,
    JSON.stringify(marker),
  );
}

/** The bounds `recordingsToDelete` applies (the exported constants by
 *  default). */
export interface CleanupBounds {
  /** A saved copy goes this long after its save, whatever else. */
  readonly maxAgeMs: number;
  /** The most recently saved copies the count keeps. */
  readonly kept: number;
  /** A saved copy younger than this (since its save) is never deleted by
   *  the count. */
  readonly minAgeMs: number;
  /** A folder with no action file goes once older than this (since its
   *  start). */
  readonly emptyMinAgeMs: number;
}

const DEFAULT_BOUNDS: CleanupBounds = {
  maxAgeMs: SAVED_RECORDING_MAX_AGE_MS,
  kept: SAVED_RECORDINGS_KEPT,
  minAgeMs: SAVED_RECORDING_MIN_AGE_MS,
  emptyMinAgeMs: EMPTY_RECORDING_MIN_AGE_MS,
};

/**
 * The folders the cleanup deletes. Pure.
 * - A folder with no action file (nothing to save, saved or not), once it
 *   is older than `emptyMinAgeMs` since its start: younger, it may be a
 *   live page's that has not written yet (M1b review #2, #9).
 * - A saved copy saved more than `maxAgeMs` ago.
 * - A saved copy beyond the `kept` most recently saved, once it is older
 *   than `minAgeMs` since its save: a hand-off counted as delivered may not
 *   have reached the owner, and a field day's sessions must all survive
 *   until the owner has looked at them (M1b review #1).
 * Never an unsaved folder that holds actions.
 */
export function recordingsToDelete(
  folders: readonly RecordingFolder[],
  nowMs: number,
  bounds: CleanupBounds = DEFAULT_BOUNDS,
): string[] {
  const doomed = new Set<string>();
  for (const folder of folders) {
    if (
      folder.actionFiles === 0 &&
      nowMs - folder.startedAtMs > bounds.emptyMinAgeMs
    ) {
      doomed.add(folder.name);
    }
  }
  const saved = folders
    .filter((folder) => folder.saved && folder.actionFiles > 0)
    .sort(
      (a, b) =>
        (b.savedAtMs ?? 0) - (a.savedAtMs ?? 0) ||
        b.startedAtMs - a.startedAtMs,
    );
  for (const [rank, folder] of saved.entries()) {
    const age = nowMs - (folder.savedAtMs ?? Number.NEGATIVE_INFINITY);
    const beyondCount = rank >= bounds.kept && age > bounds.minAgeMs;
    if (beyondCount || age > bounds.maxAgeMs) doomed.add(folder.name);
  }
  return folders
    .filter((folder) => doomed.has(folder.name))
    .map((folder) => folder.name);
}

/** Delete a recording folder and everything in it. Rejects when OPFS
 *  refuses; the caller says so (an offer's "Delete it") or moves on (the
 *  cleanup). */
export async function deleteRecordingFolder(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  await dir.removeEntry(name, { recursive: true });
}

/** A folder's action count now, or null when it cannot be read (gone). */
async function actionFilesNow(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<number | null> {
  try {
    return await countActionFiles(await dir.getDirectoryHandle(name));
  } catch {
    return null;
  }
}

/**
 * The page-open housekeeping: list the folders, THEN ask which of them a
 * live page holds (`heldNow`, e.g. `heldRecordingFolders`) and leave those
 * alone, delete what `recordingsToDelete` names, and return the unsaved
 * recordings to offer, oldest first.
 *
 * - The held set is read AFTER the listing: a page takes its folder's lock
 *   before it creates the folder, so every folder the listing saw is held
 *   by then if its page is alive. Read before, a tab that started recording
 *   in between would have its folder offered here (M1b review #2).
 * - Each folder's action files are counted again right before its delete,
 *   and a folder whose count changed since the listing is kept: the verdict
 *   rested on the old count.
 * - A delete OPFS refuses is skipped - the folder is tried again on the next
 *   open, and it is never offered (only unsaved folders with actions are,
 *   and those are never deleted here).
 */
export async function tidyRecordings(
  dir: FileSystemDirectoryHandle,
  heldNow: () => Promise<ReadonlySet<string>>,
  nowMs: number,
): Promise<RecordingFolder[]> {
  const listed = await listRecordingFolders(dir);
  const held = await heldNow();
  const folders = listed.filter((folder) => !held.has(folder.name));
  for (const name of recordingsToDelete(folders, nowMs)) {
    const before = folders.find((folder) => folder.name === name);
    if ((await actionFilesNow(dir, name)) !== before?.actionFiles) continue;
    try {
      await deleteRecordingFolder(dir, name);
    } catch {
      // Tried again on the next open.
    }
  }
  return folders.filter((folder) => !folder.saved && folder.actionFiles > 0);
}

/** A recording folder, packed for the hand-off. */
export interface PackedRecording {
  blob: Blob;
  filename: string;
  /** Action files counted before the zip was built. */
  actionCount: number;
  /** Why `session.json` could not be written; absent when it was. */
  metadataError?: string;
  /** After a hand-off that delivered: mark the folder saved, for the
   *  actions this zip holds. False when the marker did not persist. */
  markSaved(atMs: number): Promise<boolean>;
}

/**
 * Remove `name` from `folder` when it is EMPTY - what a write refused after
 * its file was created leaves behind. An earlier complete file is kept (an
 * aborted write leaves the old content). Best effort.
 */
async function dropEmptyFile(
  folder: FileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  try {
    const file = await (await folder.getFileHandle(name)).getFile();
    if (file.size === 0) await folder.removeEntry(name);
  } catch {
    // Absent (the create itself failed) or unreadable: nothing to drop.
  }
}

/**
 * Write `session.json` (through `writeMetadata`), count the action files,
 * and zip the folder.
 *
 * A `session.json` that cannot be written does NOT reject: the actions ARE
 * the recording and the metadata only describes it, so a full disk that
 * refuses this last small file must not cost the author what is already
 * written - `metadataError` carries the reason, and an empty file the
 * refused write left behind is removed (the Recorder's loader parses any
 * `session.json` it finds). A failing zip rejects.
 */
export async function packRecordingFolder(
  folder: FileSystemDirectoryHandle,
  startedAt: Date,
  writeMetadata: () => Promise<void>,
  /** The zip step; the tests wrap it to write while the zip is built. */
  zip: (
    folder: FileSystemDirectoryHandle,
  ) => Promise<{ blob: Blob }> = exportSessionHandleAsZip,
): Promise<PackedRecording> {
  let metadataError: string | undefined;
  try {
    await writeMetadata();
  } catch (err) {
    metadataError = err instanceof Error ? err.message : String(err);
    await dropEmptyFile(folder, SESSION_METADATA_FILE);
  }
  // Counted BEFORE the zip reads the folder, and only files with content:
  // an action created meanwhile, or one still being written, may be in the
  // zip (empty, for the latter) but is not in the count, so the marker
  // under-counts and the folder is offered once more - never the other way
  // round.
  const actionCount = await countWrittenActionFiles(folder);
  const { blob } = await zip(folder);
  return {
    blob,
    filename: recordingFileName(startedAt),
    actionCount,
    ...(metadataError === undefined ? {} : { metadataError }),
    markSaved: (atMs) => markRecordingSaved(folder, actionCount, atMs),
  };
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A recorded GPS action's fix, or null for anything else. */
export function recordedFix(
  action: unknown,
): { latitude: number; longitude: number } | null {
  const { type, payload } = (action ?? {}) as {
    type?: unknown;
    payload?: { rawGpsPoint?: { latitude?: unknown; longitude?: unknown } };
  };
  if (type !== recordGpsEvent.type) return null;
  const point = payload?.rawGpsPoint;
  const latitude = finiteOrNull(point?.latitude);
  const longitude = finiteOrNull(point?.longitude);
  return latitude === null || longitude === null
    ? null
    : { latitude, longitude };
}

/** What the page that saves an orphan knows about itself. */
export interface RecordingEnvironment {
  userAgent: string;
  pageUrl: string | undefined;
  /** The page's build stamp; may throw where it was never injected. */
  getBuildInfo?: () => BuildInfo;
}

/** The tag an earlier save wrote into the folder, or null. */
async function earlierContextTag(
  folder: FileSystemDirectoryHandle,
): Promise<string | null> {
  try {
    const text = await (
      await (await folder.getFileHandle(SESSION_METADATA_FILE)).getFile()
    ).text();
    const tag = (JSON.parse(text) as { contextTag?: unknown }).contextTag;
    return tag === AUTHORING_CONTEXT_TAG || tag === VIEWING_CONTEXT_TAG
      ? tag
      : null;
  } catch {
    return null;
  }
}

/**
 * `session.json` for a folder whose page never wrote one (it was killed),
 * built from the folder's own files, as the live save builds it from what
 * it wrote:
 * - the start from the folder's name, the end from the newest action
 *   file's modification time;
 * - the coverage and count from its GPS actions;
 * - the tag from an earlier save's `session.json`, else from its log
 *   actions (`tourAuthoring/*` or `tourViewing/*`), else `fallbackTag`
 *   (the saving page's own - a recording with neither kind of log action
 *   is one where nothing was placed or locked, so the label decides
 *   nothing).
 * An action file that does not parse is skipped: a killed tab can leave a
 * truncated last write, which the Recorder's loader skips the same way.
 */
async function buildOrphanSessionMetadata(
  folder: FileSystemDirectoryHandle,
  startedAtMs: number,
  environment: RecordingEnvironment,
  fallbackTag: RecordingContextTag,
): Promise<SessionMetadataRecord> {
  const fixes: { latitude: number; longitude: number }[] = [];
  let endTime = startedAtMs;
  let authoring = false;
  let viewing = false;
  let actions: FileSystemDirectoryHandle | null = null;
  try {
    actions = await folder.getDirectoryHandle(ACTIONS_DIR);
  } catch {
    // No actions directory: an empty recording.
  }
  if (actions !== null) {
    const names: string[] = [];
    for await (const name of actions.keys()) {
      if (name.endsWith(".json")) names.push(name);
    }
    for (const name of names.sort()) {
      const file = await (await actions.getFileHandle(name)).getFile();
      endTime = Math.max(endTime, file.lastModified);
      let action: unknown;
      try {
        action = JSON.parse(await file.text());
      } catch {
        continue;
      }
      const type = (action as { type?: unknown } | null)?.type;
      if (typeof type === "string") {
        authoring ||= type.startsWith("tourAuthoring/");
        viewing ||= type.startsWith("tourViewing/");
      }
      const fix = recordedFix(action);
      if (fix !== null) fixes.push(fix);
    }
  }
  const contextTag =
    (await earlierContextTag(folder)) ??
    (viewing && !authoring
      ? VIEWING_CONTEXT_TAG
      : authoring && !viewing
        ? AUTHORING_CONTEXT_TAG
        : fallbackTag);
  return buildSessionMetadataRecord({
    startTime: startedAtMs,
    endTime,
    contextTag,
    gpsPositions: fixes,
    frameCount: 0,
    userAgent: environment.userAgent,
    pageUrl: environment.pageUrl,
    ...(environment.getBuildInfo === undefined
      ? {}
      : { getBuildInfo: environment.getBuildInfo }),
  });
}

/**
 * Save an orphan: rebuild its `session.json` from its own files, write it
 * into the folder, and pack the folder. Rejects when the folder is gone or
 * the zip fails; a refused `session.json` is `metadataError`, as in a live
 * save.
 */
export async function packOrphanRecording(
  dir: FileSystemDirectoryHandle,
  name: string,
  environment: RecordingEnvironment,
  fallbackTag: RecordingContextTag,
): Promise<PackedRecording> {
  const startedAtMs = recordingStartOf(name);
  if (startedAtMs === null) {
    throw new Error(`${name} is not a recording folder`);
  }
  const folder = await dir.getDirectoryHandle(name);
  // A killed tab's unclosed writes: empty, and nothing will fill them. Left
  // in place, the page-open listing (which counts names) would find more
  // files than the marker (which counts content) and offer the saved
  // orphan on every open.
  const { actions, names } = await actionFileNames(folder);
  if (actions !== null) {
    for (const file of names) await dropEmptyFile(actions, file);
  }
  return packRecordingFolder(folder, new Date(startedAtMs), async () => {
    const record = await buildOrphanSessionMetadata(
      folder,
      startedAtMs,
      environment,
      fallbackTag,
    );
    const handle = await folder.getFileHandle(SESSION_METADATA_FILE, {
      create: true,
    });
    await writeFileOrAbort(handle, JSON.stringify(record, null, 2));
  });
}
