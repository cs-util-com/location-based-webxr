/**
 * The page's troubleshooting recording (authoring recording plan
 * 2026-09-28-0953 §3.1, M1a; the visitor's `?debug=1` recording since M1b):
 * once the creator (or a debugging visitor) opts in, every persisted action
 * of the page's store - GPS with its paired poses, QR detections, depth
 * samples, the `tourAuthoring/*` or `tourViewing/*` log actions, the
 * per-visit resets - is written to an OPFS folder of its own, and "Save the
 * recording" hands the folder over as `tour-recording-<UTC timestamp>.zip`,
 * a zip the Recorder's desktop replay loads.
 *
 * - SILENT UNTIL STARTED. The store is created at page boot with this
 *   module's `StorageBackend` and `persistWhile` gate; before `start()` the
 *   gate is false and the backend writes nothing, so a creator who never
 *   opts in (and every visitor) pays nothing and nothing is written behind
 *   anyone's back.
 * - ITS OWN FOLDER: `gps-plus-slam/tour-viewer/recording-<ts>/`. Both apps
 *   share one origin, and the framework's `OpfsStorageBackend` writes into
 *   the Recorder's `sessions/` folder, which must never receive a Tour Viewer
 *   recording (review finding 16). The folder is made by the framework's
 *   `createSessionInDirectory`, and the writes go through the framework's
 *   OPFS write functions. Across page lives the folders are
 *   `recording-folders.ts`'s: the saved marker, the orphan offer, the
 *   cleanup.
 * - NEVER PART OF THE TOUR ZIP. The visitor's capture-time geo join replays
 *   any `actions/` + `session.json` it finds in a tour zip, so this zip is
 *   only ever handed over on its own, under a name that cannot collide with
 *   the tour's.
 *
 * @see authoring-recording.ts.md
 */

import type { DepthSamplerConfig } from "gps-plus-slam-app-framework/ar/depth-sampler";
import {
  formatTimestamp,
  type StorageBackend,
} from "gps-plus-slam-app-framework/storage";
import {
  createSessionInDirectory,
  getSessionHandle,
  writeAction as opfsWriteAction,
  writeSessionMetadata as opfsWriteSessionMetadata,
} from "gps-plus-slam-app-framework/storage/opfs-storage";
import { buildSessionMetadataRecord } from "gps-plus-slam-app-framework/storage/session-metadata-record";
import type { BuildInfo } from "gps-plus-slam-app-framework/utils/build-info";

import {
  AUTHORING_CONTEXT_TAG,
  openRecordingsDir,
  packRecordingFolder,
  recordedFixes,
  type PackedRecording,
  type RecordingContextTag,
} from "./recording-folders.js";

/**
 * Depth while a recording runs (owner decision D4: depth, not camera
 * pictures). One sample per 1000 ms, as the plan asks ("about 1 Hz"); a
 * 16 x 16 grid (the framework sampler's own default, 256 points - the
 * Recorder records 24 x 24 at 5 Hz for reconstruction, which a
 * troubleshooting recording does not need); no per-point colour, which costs
 * a camera read-back per sample. Its size on disk is measured (below); the
 * frame-time cost on a phone is not (plan §5).
 */
export const RECORDING_DEPTH: Partial<DepthSamplerConfig> = {
  intervalMs: 1000,
  gridSize: 16,
  rgb: false,
};

/**
 * The non-depth actions per second of the owner's field recording
 * (2026-10-06, 211 s - GPS fixes, QR detections, authoring events), as
 * written since scan pass S2 (compact JSON): 411 617 bytes, MEASURED by the
 * opt-in field test (`tour-recording.field.test.ts`).
 */
export const FIELD_OTHER_ACTIONS_BYTES_PER_SECOND = 1_950;

/**
 * What one second of recording writes, as files on disk: one depth sample
 * (1 Hz, packed since scan pass S2 - MEASURED: the test writes a
 * phone-like sample through the real store) plus the other actions at
 * {@link FIELD_OTHER_ACTIONS_BYTES_PER_SECOND}. The test holds this number
 * within 25 % above their sum (the sidecar has the bytes).
 */
export const RECORDING_BYTES_PER_SECOND = 4_500;

/**
 * Below this much free storage, opting in warns: one hour of recording at
 * the measured rate. The sidecar's "Storage cost" gives the reasoning and
 * the range it was weighed over.
 */
export const LOW_STORAGE_BYTES = RECORDING_BYTES_PER_SECOND * 60 * 60;

const BYTES_PER_MB = 1024 * 1024;

/**
 * The warning for a storage estimate, or null when there is room - or when
 * the browser gives no usable estimate (it is a warning; silence is the
 * safe failure). The free space is this page's share (`quota - usage`),
 * which is what the recording can use, not the disk's.
 */
export function lowStorageWarning(
  estimate: StorageEstimate | undefined,
): string | null {
  const quota = estimate?.quota;
  const usage = estimate?.usage;
  if (
    typeof quota !== "number" ||
    typeof usage !== "number" ||
    !Number.isFinite(quota) ||
    !Number.isFinite(usage)
  ) {
    return null;
  }
  const free = Math.max(0, quota - usage);
  if (free >= LOW_STORAGE_BYTES) return null;
  const mb = Math.floor(free / BYTES_PER_MB);
  const minutes = Math.floor(free / RECORDING_BYTES_PER_SECOND / 60);
  return `Only ${String(mb)} MB of storage is left for this page - about ${String(minutes)} minutes of recording.`;
}

/** Where the recording stands, for the page to show. */
export type RecordingStatus =
  | { kind: "off" }
  | { kind: "on"; failedWrites: number }
  | { kind: "failed"; error: string };

export interface AuthoringRecording {
  /** The backend the page's store is created with. */
  readonly storageBackend: StorageBackend;
  /** The store's persistence gate: true from `start()` until a failure. */
  persistWhile(): boolean;
  status(): RecordingStatus;
  /** Start recording into a new folder, named after `at`. Idempotent: a
   *  recording runs for the rest of the page's life once started. */
  start(at: Date): void;
  /**
   * Flush the queued writes, write `session.json`, and zip the folder.
   * Rejects when nothing was started, when the folder could not be made,
   * or when the flush or the zip fails - the caller surfaces it (a save the
   * creator asked for must not fail silently). A `session.json` that cannot
   * be written does NOT reject: the actions on disk are zipped all the same
   * and the reason comes back as `metadataError`. After a hand-off that
   * delivered, the caller marks the folder saved (`markSaved`).
   */
  save(input: {
    flush: () => Promise<void>;
    nowMs: number;
    userAgent: string;
    pageUrl: string | undefined;
    /** The page's build stamp (`getBuildInfo`); may throw where the
     *  build constants were never injected, which only drops the field. */
    getBuildInfo?: () => BuildInfo;
  }): Promise<PackedRecording>;
}

/**
 * The name `createSessionInDirectory` will give a folder started at `at`:
 * `recording-<ts>`, or the first free `-N` suffix. Its probe's rules, run
 * ahead of it so the lock can be taken first: only NotFoundError means
 * free, a file on the name (TypeMismatchError) means taken, and anything
 * else is a storage failure that fails the start.
 */
async function freeFolderName(
  parent: FileSystemDirectoryHandle,
  at: Date,
): Promise<string> {
  const base = `recording-${formatTimestamp(at)}`;
  for (let suffix = 1; ; suffix += 1) {
    const name = suffix === 1 ? base : `${base}-${String(suffix)}`;
    try {
      await parent.getDirectoryHandle(name);
    } catch (err) {
      const kind = err instanceof DOMException ? err.name : "";
      if (kind === "NotFoundError") return name;
      if (kind !== "TypeMismatchError") throw err;
    }
  }
}

export function createAuthoringRecording(deps: {
  /** The OPFS root (`navigator.storage.getDirectory`), or a rejection
   *  where there is none. */
  openRoot: () => Promise<FileSystemDirectoryHandle>;
  /** `session.json`'s tag: `tour-authoring` (the default) for a creator,
   *  `tour-viewing` for a visitor's `?debug=1` recording. */
  contextTag?: RecordingContextTag;
  /**
   * Hold the folder's Web Lock for the rest of the page's life
   * (`holdRecordingFolder`): the next page's orphan offer and cleanup skip
   * a folder a live page holds. Awaited BEFORE the folder is created (M1b
   * review #2), so it must settle once the browser answered, granted or
   * not. Absent (tests, a browser without Web Locks): nothing is held.
   */
  holdFolder?: (folderName: string) => Promise<unknown>;
}): AuthoringRecording {
  const contextTag = deps.contextTag ?? AUTHORING_CONTEXT_TAG;
  let startedAt: Date | null = null;
  let folder: Promise<FileSystemDirectoryHandle> | null = null;
  let failure: string | null = null;
  let failedWrites = 0;
  /** The fixes this recording wrote: `session.json`'s coverage comes from
   *  here, because the store's GPS data is wiped at every AR exit. */
  const fixes: ReturnType<typeof recordedFixes> = [];

  async function makeFolder(at: Date): Promise<FileSystemDirectoryHandle> {
    const parent = await openRecordingsDir(await deps.openRoot(), true);
    if (parent === null) throw new Error("the recordings folder is missing");
    // The lock first, the folder after: another tab's page-open cleanup
    // deletes an empty folder nobody holds, and a folder created before its
    // lock was exposed in between (M1b review #2).
    const name = await freeFolderName(parent, at);
    await deps.holdFolder?.(name);
    const { sessionName } = await createSessionInDirectory(parent, at);
    // Another tab took the name in between (both started in the same
    // second): the framework picked the next one, locked right after.
    if (sessionName !== name) await deps.holdFolder?.(sessionName);
    const session = getSessionHandle();
    if (session === null) throw new Error("the recording folder is missing");
    return session;
  }

  const storageBackend: StorageBackend = {
    createSession: (timestamp) =>
      Promise.resolve({
        sessionName: `recording-${formatTimestamp(timestamp)}`,
      }),
    listSessions: () => Promise.resolve([]),
    async writeAction(action, index) {
      // The gate keeps unstarted writes from reaching here; this is the
      // backstop for a write queued before a failure switched it off.
      if (folder === null) return;
      try {
        await folder;
        await opfsWriteAction(action, index);
      } catch (err) {
        failedWrites += 1;
        throw err;
      }
      fixes.push(...recordedFixes(action));
    },
    writeFrame: () =>
      Promise.reject(new Error("the tour recording captures no frames")),
    writeSessionMetadata: async (metadata) => {
      if (folder === null) throw new Error("no recording was started");
      await folder;
      await opfsWriteSessionMetadata(metadata);
    },
  };

  return {
    storageBackend,
    persistWhile: () => folder !== null && failure === null,
    status: () =>
      failure !== null
        ? { kind: "failed", error: failure }
        : folder === null
          ? { kind: "off" }
          : { kind: "on", failedWrites },
    start(at) {
      if (folder !== null) return;
      startedAt = at;
      folder = makeFolder(at);
      folder.catch((err: unknown) => {
        failure = err instanceof Error ? err.message : String(err);
      });
    },
    async save(input) {
      if (folder === null || startedAt === null) {
        throw new Error("nothing is being recorded");
      }
      const started = startedAt;
      const session = await folder;
      await input.flush();
      // The metadata write, the empty-file cleanup after a refused one, the
      // count the saved marker will carry and the zip are the same for a
      // folder whose page was killed (`recording-folders.ts`).
      return packRecordingFolder(session, started, () =>
        storageBackend.writeSessionMetadata(
          buildSessionMetadataRecord({
            endTime: input.nowMs,
            startTime: started.getTime(),
            contextTag,
            gpsPositions: fixes,
            frameCount: 0,
            userAgent: input.userAgent,
            pageUrl: input.pageUrl,
            ...(input.getBuildInfo === undefined
              ? {}
              : { getBuildInfo: input.getBuildInfo }),
          }),
        ),
      );
    },
  };
}
