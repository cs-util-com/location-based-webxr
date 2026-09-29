/**
 * The creator's troubleshooting recording (authoring recording plan
 * 2026-09-28-0953 §3.1, M1a): once the creator opts in, every persisted
 * action of the page's store - GPS with its paired poses, QR detections,
 * depth samples, the `tourAuthoring/*` log actions, the per-visit resets -
 * is written to an OPFS folder of its own, and "Save the recording" hands
 * the folder over as `tour-recording-<UTC timestamp>.zip`, a zip the
 * Recorder's desktop replay loads.
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
 *   OPFS write functions.
 * - NEVER PART OF THE TOUR ZIP. The visitor's capture-time geo join replays
 *   any `actions/` + `session.json` it finds in a tour zip, so this zip is
 *   only ever handed over on its own, under a name that cannot collide with
 *   the tour's.
 *
 * @see authoring-recording.ts.md
 */

import type { DepthSamplerConfig } from "gps-plus-slam-app-framework/ar/depth-sampler";
import { recordGpsEvent } from "gps-plus-slam-app-framework/state";
import {
  exportSessionHandleAsZip,
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

/** `session.json`'s tag: what kind of recording this is. */
export const RECORDING_CONTEXT_TAG = "tour-authoring";

/** The folder under `gps-plus-slam/` that holds this app's recordings. */
const RECORDINGS_DIR = "tour-viewer";

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
 * What one second of recording writes: one depth sample and one GPS fix
 * (both 1 Hz), as files on disk. MEASURED, not computed: the test writes a
 * phone-like sample and fix through the real store and holds this number
 * within 25 % above what they took (the sidecar has the bytes). QR
 * detections are not in it - they are written only while a code is in
 * view (see the sidecar).
 */
export const RECORDING_BYTES_PER_SECOND = 40_000;

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

/** What "Save the recording" hands over. */
interface SavedRecording {
  blob: Blob;
  filename: string;
  /** Action files in the zip. */
  actionCount: number;
  /** Why `session.json` could not be written; absent when it was. The zip
   *  then holds the actions without it (or with an earlier save's). */
  metadataError?: string;
}

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
   * and the reason comes back as `metadataError`.
   */
  save(input: {
    flush: () => Promise<void>;
    nowMs: number;
    userAgent: string;
    pageUrl: string | undefined;
    /** The page's build stamp (`getBuildInfo`); may throw where the
     *  build constants were never injected, which only drops the field. */
    getBuildInfo?: () => BuildInfo;
  }): Promise<SavedRecording>;
}

/** The metadata file's name in a recording folder (the Recorder's layout). */
const SESSION_METADATA_FILE = "session.json";

/**
 * Remove `name` from `folder` when it is EMPTY - what a write refused after
 * its file was created leaves behind. An earlier save's complete file is
 * kept (an aborted write leaves the old content). Best effort: a folder that
 * cannot even be read here has nothing better to offer.
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

/** The recording zip's name, from the folder's start time. */
export function recordingFileName(startedAt: Date): string {
  return `tour-recording-${formatTimestamp(startedAt)}.zip`;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A recorded GPS action's fix, or null for anything else. */
function recordedFix(
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

export function createAuthoringRecording(deps: {
  /** The OPFS root (`navigator.storage.getDirectory`), or a rejection
   *  where there is none. */
  openRoot: () => Promise<FileSystemDirectoryHandle>;
}): AuthoringRecording {
  let startedAt: Date | null = null;
  let folder: Promise<FileSystemDirectoryHandle> | null = null;
  let failure: string | null = null;
  let failedWrites = 0;
  let actionFiles = 0;
  /** The fixes this recording wrote: `session.json`'s coverage comes from
   *  here, because the store's GPS data is wiped at every AR exit. */
  const fixes: { latitude: number; longitude: number }[] = [];

  async function makeFolder(at: Date): Promise<FileSystemDirectoryHandle> {
    const root = await deps.openRoot();
    const app = await root.getDirectoryHandle("gps-plus-slam", {
      create: true,
    });
    const parent = await app.getDirectoryHandle(RECORDINGS_DIR, {
      create: true,
    });
    await createSessionInDirectory(parent, at);
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
      actionFiles += 1;
      const fix = recordedFix(action);
      if (fix !== null) fixes.push(fix);
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
      const session = await folder;
      await input.flush();
      let metadataError: string | undefined;
      try {
        await storageBackend.writeSessionMetadata(
          buildSessionMetadataRecord({
            endTime: input.nowMs,
            startTime: startedAt.getTime(),
            contextTag: RECORDING_CONTEXT_TAG,
            gpsPositions: fixes,
            frameCount: 0,
            userAgent: input.userAgent,
            pageUrl: input.pageUrl,
            ...(input.getBuildInfo === undefined
              ? {}
              : { getBuildInfo: input.getBuildInfo }),
          }),
        );
      } catch (err) {
        // The actions ARE the recording; the metadata only describes it. A
        // full disk that refuses this last small file must not cost the
        // creator what is already written - the caller reports the loss.
        metadataError = err instanceof Error ? err.message : String(err);
        await dropEmptyFile(session, SESSION_METADATA_FILE);
      }
      const { blob } = await exportSessionHandleAsZip(session);
      return {
        blob,
        filename: recordingFileName(startedAt),
        actionCount: actionFiles,
        ...(metadataError === undefined ? {} : { metadataError }),
      };
    },
  };
}
