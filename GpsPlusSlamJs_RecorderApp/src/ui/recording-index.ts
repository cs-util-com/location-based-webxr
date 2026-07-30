/**
 * Recording Coverage Index
 *
 * Builds the in-memory index that backs the map-centric recording browser:
 * for every recording in a folder, the deduplicated res-11 H3 cells its GPS
 * path crossed. The map view then clusters these per zoom level (via
 * `clusterCellsByZoom`) to draw tiles and answer "which tours cross this tile?".
 *
 * Coverage comes from one of two sources (D2 — in-memory only, no disk cache):
 *   1. The recording's `session.json` `h3Cells` field, read during metadata
 *      discovery — cheap, no GPS unzip (new recordings, Step 2).
 *   2. A legacy fallback: recordings that predate the `h3Cells` field have their
 *      GPS path read from the zip (`loadGpsPathFromBlob`) and coverage derived
 *      in memory (`gpsPathToCoverageCells`). Still no disk persistence — the
 *      persistent cache (2-B) is the documented escape hatch only if real
 *      folders prove too slow to re-scan.
 *
 * @see GpsPlusSlamJs_Docs/docs/2026-06-14-1048-map-centric-recording-browser-and-h3-index-user-feedback.md (D2)
 */

import { loadGpsPathFromBlob } from 'gps-plus-slam-app-framework/storage/zip-reader';
import { gpsPathToCoverageCells } from 'gps-plus-slam-app-framework/geo';
import { forEachWithConcurrencyLimit } from 'gps-plus-slam-app-framework/utils/concurrency';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import {
  discoverScenariosFromZipMetadata,
  type SessionEntry,
} from '../storage/recording-discovery';

const log = createLogger('RecordingIndex');

/**
 * Maximum number of legacy zips whose GPS path is read concurrently while
 * backfilling coverage. Mirrors the metadata-scan cap in
 * `storage/recording-discovery.ts`:
 * each read uses BlobReader but a legacy backfill reads every action file, so
 * we keep concurrency bounded to avoid overwhelming browser I/O.
 */
const COVERAGE_BACKFILL_CONCURRENCY = 4;

/** A recording paired with its H3 coverage cells. */
export interface RecordingCoverage {
  /** The recording entry (filename, file handle, parsed date). */
  readonly entry: SessionEntry;
  /** Scenario name the recording was grouped under during discovery. */
  readonly scenario: string;
  /** Deduplicated res-11 H3 cells the recording's GPS path crossed. */
  readonly cells: readonly string[];
  /**
   * True when `cells` were derived from the GPS path because the recording
   * carried no `h3Cells` metadata (a legacy recording). Lets the UI surface or
   * log how much of a folder needed the slower backfill path.
   */
  readonly backfilled: boolean;
}

/**
 * Resolve the H3 coverage cells for a single recording.
 *
 * Returns the metadata `h3Cells` verbatim when present (including an empty array
 * — a recording with no GPS coverage), without touching the zip's GPS data.
 * Only when the field is absent (legacy recording) does it read the GPS path and
 * derive coverage in memory. A read failure degrades to empty coverage rather
 * than throwing, so one corrupt zip cannot abort the whole folder index.
 */
export async function loadCoverageCellsForEntry(
  entry: SessionEntry
): Promise<{ cells: string[]; backfilled: boolean }> {
  if (entry.h3Cells !== undefined) {
    return { cells: [...entry.h3Cells], backfilled: false };
  }
  try {
    const file = await entry.fileHandle.getFile();
    const path = await loadGpsPathFromBlob(file);
    return { cells: gpsPathToCoverageCells(path), backfilled: true };
  } catch (err) {
    log.warn(`Failed to backfill coverage for ${entry.filename}:`, err);
    return { cells: [], backfilled: true };
  }
}

/** Progress of an in-flight {@link streamRecordingIndex} run. */
export interface IndexProgress {
  /** Recordings resolved and emitted so far. */
  readonly done: number;
  /** Total recordings discovered in the folder. */
  readonly total: number;
}

/** Callbacks driving a progressive {@link streamRecordingIndex} run. */
export interface StreamRecordingIndexHandlers {
  /**
   * Called once after discovery (metadata-only) completes, before any coverage
   * is resolved. Lets the UI show "0 / total" immediately.
   */
  onTotal?: (total: number) => void;
  /** Called once per resolved recording, as soon as its coverage is known. */
  onRecording: (rec: RecordingCoverage) => void;
  /** Called after each `onRecording`; `done` is monotonic, ending at `total`. */
  onProgress?: (progress: IndexProgress) => void;
  /**
   * Aborts the stream: once aborted, no further recordings are emitted and the
   * legacy backfill stops pulling new zips. In-flight reads run to completion
   * but their results are dropped (not emitted).
   */
  signal?: AbortSignal;
}

/** Flatten discovered scenarios into a single ordered recording list. */
async function discoverFlatRecordings(
  rootHandle: FileSystemDirectoryHandle
): Promise<{ scenario: string; entry: SessionEntry }[]> {
  const { scenarioSessions } =
    await discoverScenariosFromZipMetadata(rootHandle);

  const flat: { scenario: string; entry: SessionEntry }[] = [];
  for (const [scenario, entries] of scenarioSessions) {
    for (const entry of entries) {
      flat.push({ scenario, entry });
    }
  }
  return flat;
}

/**
 * Progressively build the in-memory recording-coverage index for a folder,
 * emitting each recording as soon as its coverage is resolved.
 *
 * The flow (D2 — in-memory only, no disk cache):
 *   1. Discover all recordings via `discoverScenariosFromZipMetadata` (cheap,
 *      metadata-only) and report the count via `onTotal`.
 *   2. Emit **metadata-present** recordings first — their `h3Cells` are already
 *      in hand from discovery, so this needs no further I/O and is effectively
 *      instant. This is what lets the map populate immediately for new folders.
 *   3. Backfill **legacy** recordings (no `h3Cells`) with bounded concurrency,
 *      reading each zip's GPS path in memory and emitting as each resolves.
 *
 * `signal` makes the whole run abortable: closing the browser or opening another
 * folder cancels further emission and stops pulling new legacy zips, so a torn
 * -down map never receives stray tiles. Nothing is written to disk.
 *
 * @see ./recording-index.md
 */
export async function streamRecordingIndex(
  rootHandle: FileSystemDirectoryHandle,
  handlers: StreamRecordingIndexHandlers
): Promise<void> {
  const { onTotal, onRecording, onProgress, signal } = handlers;

  const flat = await discoverFlatRecordings(rootHandle);
  onTotal?.(flat.length);

  let done = 0;
  const emit = (rec: RecordingCoverage): void => {
    // Drop emissions once aborted, even for reads that were already in flight,
    // so a destroyed consumer never receives stray recordings.
    if (signal?.aborted) {
      return;
    }
    onRecording(rec);
    done += 1;
    onProgress?.({ done, total: flat.length });
  };

  // Phase 1 — metadata-present recordings: no GPS unzip, emitted first/instantly.
  const legacy: { scenario: string; entry: SessionEntry }[] = [];
  for (const item of flat) {
    if (signal?.aborted) {
      return;
    }
    if (item.entry.h3Cells === undefined) {
      legacy.push(item);
      continue;
    }
    const { cells, backfilled } = await loadCoverageCellsForEntry(item.entry);
    emit({ entry: item.entry, scenario: item.scenario, cells, backfilled });
  }

  // Phase 2 — legacy backfill: read each zip's GPS path with bounded concurrency.
  await forEachWithConcurrencyLimit(
    legacy,
    COVERAGE_BACKFILL_CONCURRENCY,
    async ({ scenario, entry }) => {
      const { cells, backfilled } = await loadCoverageCellsForEntry(entry);
      emit({ entry, scenario, cells, backfilled });
    },
    signal
  );
}

/**
 * Build the in-memory recording-coverage index for a folder, resolving every
 * recording before returning. A thin `await`-all wrapper over
 * {@link streamRecordingIndex} for non-progressive callers and tests.
 *
 * The returned list is flat across scenarios; callers that need grouping can use
 * `RecordingCoverage.scenario`. Coverage comes from metadata when present, or an
 * in-memory GPS-path backfill for legacy recordings (D2). Order follows the
 * stream: metadata-present recordings first, then legacy ones.
 */
export async function buildRecordingIndex(
  rootHandle: FileSystemDirectoryHandle
): Promise<RecordingCoverage[]> {
  const result: RecordingCoverage[] = [];
  await streamRecordingIndex(rootHandle, {
    onRecording: (rec) => result.push(rec),
  });
  return result;
}
