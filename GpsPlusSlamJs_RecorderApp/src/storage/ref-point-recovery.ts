/**
 * Reference Point Indexing Module
 *
 * Indexes full RefPointDefinition objects from the recording ZIPs in a
 * folder, grouped per scenario (from each ZIP's session.json) with
 * observations merged/deduplicated per ref-point id. It preserves complete
 * observation data (AR poses, GPS, timestamps) needed for 3D display and
 * OPFS restoration after browser data loss. (A lat/lon-only sibling,
 * ref-point-importer.ts, was deleted 2026-09-04 - nothing called it.)
 *
 * Used by both folder-import flows in folder-manager.ts (2026-07-05 plan):
 * the eager full-folder pass at folder-pick time (D1) and the lazy
 * scenario-change recovery safety net — both persist via the same strict
 * per-scenario gap-fill (D4a/D4b).
 *
 * Uses @zip.js/zip.js for ZIP reading (same library as zip-export.ts).
 */

import type { RefPointDefinition } from './ref-point-loader';
import { mergeSiblingRefPoints } from './ref-point-merge';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import { loadSessionMetadataFromBlob } from 'gps-plus-slam-app-framework/storage/zip-reader';
import {
  extractRefPointEntriesFromZip,
  isRefPointDefinitionShape,
  isZipFileName,
} from './ref-point-zip-helpers';
import {
  parseDateFromSessionFilename,
  resolveScenarioNameFromMetadata,
} from './session-zip-naming';

const log = createLogger('RefPointRecovery');

// ============================================================================
// Types
// ============================================================================

/**
 * Progress of the full-folder indexing pass, emitted once per processed ZIP.
 * (Module-private until a consumer needs the named type — knip flags unused
 * exports; the Slice-2 folder-manager integration re-exports it when needed.)
 */
interface RefPointIndexProgress {
  /** ZIPs processed so far (including ZIPs that failed to read) */
  readonly done: number;
  /** Total ZIP files discovered in the folder */
  readonly total: number;
}

/**
 * Result of the scenario-aware full-folder indexing pass.
 */
export interface RefPointIndexResult {
  /**
   * Merged, deduplicated definitions grouped by the scenario each ZIP
   * belongs to (session.json `contextTag` → legacy `scenarioName` →
   * `DEFAULT_SCENARIO`; see `resolveScenarioNameFromMetadata`).
   * Each bucket is in first-encounter order — newest recording first
   * (D4b-ii) — which the folder-manager gap-fill acceptance relies on.
   */
  readonly definitionsByScenario: Map<string, RefPointDefinition[]>;
  /** Number of ZIP files successfully scanned */
  readonly zipFilesScanned: number;
  /** Error messages from failed ZIPs or malformed ref points */
  readonly errors: string[];
}

/** Options for {@link indexRefPointDefinitionsFromFolder}. */
export interface RefPointIndexOptions {
  /** Called with `{done: 0, total}` before the first ZIP, then after each ZIP. */
  onProgress?: (progress: RefPointIndexProgress) => void;
  /** Abort the pass (checked before each ZIP); throws DOMException AbortError. */
  signal?: AbortSignal;
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate parsed JSON matches RefPointDefinition shape.
 * Looser than ref-point-loader's validator: accepts empty observations
 * (schema-valid, preserves identity) and doesn't require arPose/gpsPoint
 * validation on every observation (the importer's validator already checks
 * first obs structure).
 */
const isValidRefPointDefinition = isRefPointDefinitionShape;

// ============================================================================
// ZIP Processing
// ============================================================================

/**
 * Extract full RefPointDefinition objects from a single ZIP file.
 */
async function extractDefinitionsFromZip(
  zipBlob: Blob,
  zipFileName: string
): Promise<{ definitions: RefPointDefinition[]; errors: string[] }> {
  const { items, errors } = await extractRefPointEntriesFromZip(
    zipBlob,
    zipFileName,
    isValidRefPointDefinition,
    (def) => def
  );
  return { definitions: items, errors };
}

// ============================================================================
// Merge Logic
// ============================================================================

// Definition merging (same-id observation union, sibling-cluster collapse,
// legacy-id re-mint, most-observations-wins name policy) is delegated to the
// shared `mergeSiblingRefPoints` (D6(a), 2026-07-06) — the same mechanism
// `loadAndDisplayRefPoints` applies at load time, so what a clean import
// persists is exactly what an existing store displays.

// ============================================================================
// Scenario-aware full-folder indexing pass (2026-07-05 folder-import plan)
//
// This pass replaced the earlier `recoverRefPointDefinitionsFromZips`, which
// merged ALL scenarios' definitions into one flat list — both the eager
// folder-pick flow and the lazy scenario-change recovery in folder-manager
// now route through this scenario-grouped API (strict routing, D4a).
// ============================================================================

/** Throw a DOMException AbortError when the signal has fired. */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

/**
 * Collect the folder's ZIP file entries sorted newest-first (D4b-ii): by the
 * timestamp in the filename (`..._YYYY-MM-DD_HH-MM-SSutc.zip`); non-conforming
 * names fall back to `File.lastModified` so renamed archives still sort
 * roughly by age instead of clumping at one end. Name-descending tiebreak
 * keeps the order deterministic.
 *
 * Collecting before processing lets the caller know the total up front — the
 * progress UI needs a determinate bar from the first event.
 */
async function collectZipEntriesNewestFirst(
  folderHandle: FileSystemDirectoryHandle
): Promise<Array<{ name: string; handle: FileSystemFileHandle }>> {
  const zips: Array<{
    name: string;
    handle: FileSystemFileHandle;
    sortKey: number;
  }> = [];
  for await (const entry of folderHandle.values()) {
    if (entry.kind !== 'file' || !isZipFileName(entry.name)) continue;
    const handle = entry as FileSystemFileHandle;
    let sortKey = parseDateFromSessionFilename(entry.name)?.getTime();
    if (sortKey === undefined) {
      try {
        sortKey = (await handle.getFile()).lastModified;
      } catch {
        sortKey = 0;
      }
    }
    zips.push({ name: entry.name, handle, sortKey });
  }
  zips.sort((a, b) => b.sortKey - a.sortKey || b.name.localeCompare(a.name));
  return zips;
}

/**
 * Resolve the scenario a recording ZIP belongs to from its `session.json`.
 * Unreadable/missing metadata resolves to the canonical default scenario,
 * consistent with `discoverScenariosFromZipMetadata`.
 */
async function resolveZipScenario(file: File): Promise<string> {
  let metadata: Record<string, unknown> | null;
  try {
    metadata = await loadSessionMetadataFromBlob(file);
  } catch {
    metadata = null;
  }
  return resolveScenarioNameFromMetadata(metadata);
}

/** Append definitions to a scenario's bucket, creating the bucket on demand. */
function appendToBucket(
  buckets: Map<string, RefPointDefinition[]>,
  scenario: string,
  definitions: RefPointDefinition[]
): void {
  const bucket = buckets.get(scenario);
  if (bucket) {
    bucket.push(...definitions);
  } else {
    buckets.set(scenario, [...definitions]);
  }
}

/**
 * Index every recording ZIP in the folder into per-scenario ref-point
 * definitions (decisions D1/D4/D4a/D4b-ii of the 2026-07-05 folder-import
 * feedback):
 *
 * - **Newest-first (D4b-ii):** ZIPs are sorted descending by the timestamp in
 *   their filename (`..._YYYY-MM-DD_HH-MM-SSutc.zip`; non-conforming names
 *   fall back to `File.lastModified`), so bucket order keeps the newest
 *   recording's definitions first. Per-bucket merging (observation union,
 *   sibling-cluster collapse, name policy) is `mergeSiblingRefPoints`
 *   (D6(a)): the name backed by the MOST observations wins (ties → newest
 *   backing observation) and `createdAt` keeps the earliest value.
 * - **Strict per-scenario routing (D4a):** each ZIP's definitions land only
 *   in the bucket of that ZIP's scenario (from its `session.json`); the same
 *   id under two scenarios stays in both buckets, unmerged.
 * - **Observable:** `onProgress` fires with `{done: 0, total}` before the
 *   first ZIP and once after each ZIP — including failed ones, so a progress
 *   bar never stalls on a corrupt archive (whose failure is reported via
 *   `errors` instead).
 * - **Abortable:** `signal` is checked before each ZIP; aborting throws a
 *   DOMException `AbortError`. The function is pure with respect to storage —
 *   persistence is the caller's job (folder-manager), so an abort never
 *   leaves a half-written store behind.
 *
 * @param folderHandle - Read-only directory handle from showDirectoryPicker
 * @param options - Optional progress callback and abort signal
 * @returns Per-scenario merged definitions, scan count, and errors
 */
export async function indexRefPointDefinitionsFromFolder(
  folderHandle: FileSystemDirectoryHandle,
  options: RefPointIndexOptions = {}
): Promise<RefPointIndexResult> {
  const { onProgress, signal } = options;
  throwIfAborted(signal);

  log.info(`Index scan: ${folderHandle.name}`);

  const zips = await collectZipEntriesNewestFirst(folderHandle);
  const total = zips.length;
  const rawByScenario = new Map<string, RefPointDefinition[]>();
  const allErrors: string[] = [];
  let done = 0;
  let zipFilesScanned = 0;
  onProgress?.({ done, total });

  for (const zip of zips) {
    throwIfAborted(signal);
    try {
      const file = await zip.handle.getFile();
      const scenario = await resolveZipScenario(file);
      const { definitions, errors } = await extractDefinitionsFromZip(
        file,
        zip.name
      );
      zipFilesScanned++;
      allErrors.push(...errors);
      appendToBucket(rawByScenario, scenario, definitions);
    } catch (zipErr) {
      const errorMsg = `Failed to process ${zip.name}: ${(zipErr as Error).message}`;
      log.warn(errorMsg);
      allErrors.push(errorMsg);
    }
    done++;
    onProgress?.({ done, total });
  }

  // Merge per scenario only (D4a) — cross-scenario ids stay unmerged. The
  // shared sibling merge (D6(a)) unions same-id observations, collapses
  // neighbor-cell/legacy sibling clusters, and applies the
  // most-observations-wins name policy. Buckets were filled newest-first
  // and the merge preserves first-encounter cluster order, so the gap-fill
  // acceptance loop in folder-manager still sees newest definitions first
  // (D4b-ii).
  const definitionsByScenario = new Map<string, RefPointDefinition[]>();
  for (const [scenario, defs] of rawByScenario) {
    definitionsByScenario.set(scenario, mergeSiblingRefPoints(defs));
  }

  log.info(
    `Indexed ${definitionsByScenario.size} scenario(s) from ${zipFilesScanned}/${total} ZIP files`
  );

  return { definitionsByScenario, zipFilesScanned, errors: allErrors };
}
