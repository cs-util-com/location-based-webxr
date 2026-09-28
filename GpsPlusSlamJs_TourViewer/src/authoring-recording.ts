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
 * a camera read-back per sample. The size per hour and the frame-time cost
 * on a phone are not measured yet (plan §5).
 */
export const RECORDING_DEPTH: Partial<DepthSamplerConfig> = {
  intervalMs: 1000,
  gridSize: 16,
  rgb: false,
};

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
   * or when a write fails - the caller surfaces it (a save the creator
   * asked for must not fail silently).
   */
  save(input: {
    flush: () => Promise<void>;
    nowMs: number;
    userAgent: string;
    pageUrl: string | undefined;
  }): Promise<SavedRecording>;
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
      await storageBackend.writeSessionMetadata(
        buildSessionMetadataRecord({
          endTime: input.nowMs,
          startTime: startedAt.getTime(),
          contextTag: RECORDING_CONTEXT_TAG,
          gpsPositions: fixes,
          frameCount: 0,
          userAgent: input.userAgent,
          pageUrl: input.pageUrl,
        }),
      );
      const { blob } = await exportSessionHandleAsZip(session);
      return {
        blob,
        filename: recordingFileName(startedAt),
        actionCount: actionFiles,
      };
    },
  };
}
