/**
 * Coverage Backfill — one-time in-zip upgrade (Slice B, O3 = in-zip rewrite).
 *
 * Rewrites legacy recordings so they carry their H3 coverage in `session.json`,
 * making them index instantly on every future open in this app and any other
 * reader. The coverage cells were already derived in memory while the map
 * browser streamed its index (Slice A), so this step only *writes* them — it
 * never re-reads GPS paths.
 *
 * Safety (this mutates the user's files):
 *   - **Opt-in + confirmed (B1):** the caller invokes this only from an explicit,
 *     confirmed user gesture — never as a side effect of opening a folder.
 *   - **Permission (B2):** upgrades the folder handle to `readwrite` on entry;
 *     if denied it writes nothing and reports `permissionDenied` so the caller
 *     can degrade gracefully (the progressive in-memory index still works).
 *   - **Verify-before-overwrite (B4):** each rewritten zip is produced in memory
 *     by `embedCoverageInSessionJson` and its `session.json` is re-read to
 *     confirm coverage landed BEFORE the original is touched. The actual write
 *     uses `FileSystemFileHandle.createWritable()`, which the File System Access
 *     spec implements as write-to-temp + **atomic swap on `close()`** — so a
 *     crash mid-write leaves the original intact. This replaces the plan's
 *     manual `<name>.h3.tmp` sibling (which needed per-file parent-directory
 *     handles and left litter): the in-memory verify is stronger and the
 *     browser already gives us the atomic rename the plan assumed absent.
 *   - **Isolated failures:** one bad file is counted and skipped; the rest run.
 *
 * @see ./coverage-backfill.ts.md
 * @see GpsPlusSlamJs_AppFramework/src/storage/zip-coverage-embed.ts (B3 primitive)
 * @see GpsPlusSlamJs_Docs/docs/2026-06-14-1924-progressive-map-browser-indexing-and-backfill-followup.md (B1/B2/B4)
 */

import { embedCoverageInSessionJson } from 'gps-plus-slam-app-framework/storage/zip-coverage-embed';
import { loadSessionMetadataFromBlob } from 'gps-plus-slam-app-framework/storage/zip-reader';
import { writeFileOrAbort } from 'gps-plus-slam-app-framework/storage/write-file-or-abort';
import { forEachWithConcurrencyLimit } from 'gps-plus-slam-app-framework/utils/concurrency';
import { H3_RESOLUTION } from 'gps-plus-slam-app-framework/geo';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';

const log = createLogger('CoverageBackfill');

/**
 * Maximum number of zips rewritten concurrently. Each rewrite reads the whole
 * zip into memory and writes it back, so the cap keeps memory/I/O bounded.
 */
const BACKFILL_WRITE_CONCURRENCY = 4;

/** A single recording to embed coverage into. */
export interface BackfillCandidate {
  /** The recording's file handle (must be writable after the permission upgrade). */
  readonly fileHandle: FileSystemFileHandle;
  /** Filename, for logging only. */
  readonly filename: string;
  /** The res-11 coverage cells to embed (already derived in memory by Slice A). */
  readonly cells: readonly string[];
}

/** Progress of an in-flight backfill. */
interface BackfillProgress {
  readonly done: number;
  readonly total: number;
}

/** Callbacks/controls for {@link backfillCoverageIntoZips}. */
export interface BackfillHandlers {
  /** Called after each file settles; `done` ends at `total` unless aborted. */
  onProgress?: (progress: BackfillProgress) => void;
  /** Aborts the run: stops pulling new files and skips the in-flight write. */
  signal?: AbortSignal;
}

/** Outcome counts of a backfill run. */
export interface BackfillResult {
  /** Files whose `session.json` was rewritten with coverage. */
  readonly embedded: number;
  /** Files left untouched (no/broken/already-embedded `session.json`). */
  readonly skipped: number;
  /** Files that errored (read/verify/write); isolated, not fatal. */
  readonly failed: number;
  /** True when the `readwrite` permission upgrade was refused (nothing written). */
  readonly permissionDenied: boolean;
}

const EMPTY_RESULT: BackfillResult = {
  embedded: 0,
  skipped: 0,
  failed: 0,
  permissionDenied: false,
};

/**
 * Embed coverage into each candidate recording's `session.json`, in place.
 *
 * Requires `rootHandle` to be the directory the candidates came from (so the
 * `readwrite` permission upgrade covers their file handles). Returns the outcome
 * counts; surfaces nothing to the UI itself — the caller owns user feedback.
 */
export async function backfillCoverageIntoZips(
  rootHandle: FileSystemDirectoryHandle,
  candidates: readonly BackfillCandidate[],
  handlers: BackfillHandlers = {}
): Promise<BackfillResult> {
  const { onProgress, signal } = handlers;
  const total = candidates.length;

  if (total === 0 || signal?.aborted) {
    return EMPTY_RESULT;
  }

  // B2 — upgrade to readwrite. Driven by the caller's confirmed user gesture.
  let permission: PermissionState;
  try {
    permission = await rootHandle.requestPermission({ mode: 'readwrite' });
  } catch (err) {
    log.warn('requestPermission(readwrite) threw; treating as denied', err);
    permission = 'denied';
  }
  if (permission !== 'granted') {
    return { ...EMPTY_RESULT, permissionDenied: true };
  }

  let embedded = 0;
  let skipped = 0;
  let failed = 0;
  let done = 0;

  await forEachWithConcurrencyLimit(
    candidates,
    BACKFILL_WRITE_CONCURRENCY,
    async (candidate) => {
      try {
        const file = await candidate.fileHandle.getFile();
        const rewritten = await embedCoverageInSessionJson(
          file,
          [...candidate.cells],
          H3_RESOLUTION
        );
        if (rewritten === file) {
          // No / broken / already-embedded session.json — nothing to write.
          skipped += 1;
          return;
        }
        // B4 verify: confirm coverage actually landed BEFORE touching the
        // original. Never overwrite with a zip that didn't gain h3Cells.
        const meta = await loadSessionMetadataFromBlob(rewritten);
        if (!Array.isArray(meta?.h3Cells)) {
          log.warn(
            `Backfill verify failed for ${candidate.filename}; skipping`
          );
          failed += 1;
          return;
        }
        if (signal?.aborted) {
          return;
        }
        // Throws on failure (having aborted the temp rather than committing a
        // partial zip over the original), so the outer catch isolates this
        // file and counts it as failed.
        await writeFileOrAbort(candidate.fileHandle, rewritten);
        embedded += 1;
      } catch (err) {
        log.warn(`Backfill failed for ${candidate.filename}:`, err);
        failed += 1;
      } finally {
        done += 1;
        onProgress?.({ done, total });
      }
    },
    signal
  );

  return { embedded, skipped, failed, permissionDenied: false };
}
