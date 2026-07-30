/**
 * Recording Discovery
 *
 * Enumerates scenarios and session recordings from a
 * `FileSystemDirectoryHandle`. Pure file-system/zip reading — no DOM, no
 * Leaflet, no UI state. Feeds the Replay Mode UX (Iteration 5 of
 * 2026-02-19-replay-mode.md), the recording-mode scenario dropdown, and the
 * `folder-manager` folder-pick flow.
 *
 * Also supports metadata-based discovery: reading session.json from inside
 * root-level zip files to determine the scenario name (Issue 1, 2026-03-01).
 *
 * Lived in `ui/session-browser.ts` until 2026-07-30. Sitting in `ui/` while
 * being a storage module forced two workarounds that are gone with the move:
 * `folder-manager` had to receive three of these functions as injected
 * callbacks (storage may not import ui) plus a structural copy of
 * `SessionEntry`, and the naming helpers had to be split into
 * `session-zip-naming.ts` and re-exported from here.
 *
 * The expected folder structure:
 *   <RootFolder>/
 *   ├── Scenario A/
 *   │   ├── refPoints/
 *   │   ├── recording-2026-01-27_14-30-11utc.zip
 *   │   └── ScenarioA-session-2026-02-06_03-52-13utc.zip
 *   └── Scenario B/
 *       └── recording-2026-02-10_09-00-00utc.zip
 *
 * @see gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-02-19-replay-mode.md Issue 6
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A session recording entry found within a scenario folder.
 */
export interface SessionEntry {
  /** Original zip filename (e.g., "recording-2026-02-19_10-15-00utc.zip") */
  filename: string;
  /** File handle for reading zip bytes */
  fileHandle: FileSystemFileHandle;
  /** Parsed UTC date from filename, or null if filename doesn't match pattern */
  date: Date | null;
  /**
   * Per-tour H3 coverage index (res-11 cells the GPS path crossed), read from
   * the recording's `session.json` during metadata discovery. Powers the
   * map-centric recording browser (tile → which tours cross it) without
   * unzipping GPS data.
   *
   * - An array (possibly empty) when the recording carries an `h3Cells` field.
   *   An empty array means the recording genuinely had no GPS coverage.
   * - `undefined` for legacy recordings that predate the field — the browser
   *   backfills these in memory from the GPS path (see `ui/recording-index.ts`).
   */
  h3Cells?: readonly string[];
}

/**
 * A map from scenario name to its session entries.
 * Used in replay mode to group recordings by scenario.
 */
export type ScenarioSessionMap = Map<string, SessionEntry[]>;

// ---------------------------------------------------------------------------
// Filename patterns
// ---------------------------------------------------------------------------

/**
 * Regex matching scenario-prefixed session zip filenames.
 *
 * Captures the scenario name before "-session-":
 * - "Paris-session-2026-01-30_14-30-45utc.zip" → "Paris"
 * - "Paris-Eiffeltower-session-2026-02-06_03-52-13utc.zip" → "Paris-Eiffeltower"
 *
 * Does NOT match timestamp-only filenames like "2026-02-19_10-15-00utc.zip"
 * or "recording-2026-01-27_14-30-11utc.zip".
 */
const SCENARIO_PREFIX_PATTERN =
  /^(.+)-session-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}utc\.zip$/;

import { isValidCell } from 'h3-js';
import { loadSessionMetadataFromBlob } from 'gps-plus-slam-app-framework/storage/zip-reader';
import { mapWithConcurrencyLimit } from 'gps-plus-slam-app-framework/utils/concurrency';
import {
  parseDateFromSessionFilename,
  resolveScenarioNameFromMetadata,
} from './session-zip-naming';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enumerate scenario names (top-level directories) from a folder handle.
 *
 * Filters to directory entries only and returns names sorted alphabetically.
 *
 * @param rootHandle - FileSystemDirectoryHandle from showDirectoryPicker()
 * @returns Array of scenario folder names, sorted alphabetically
 */
export async function listScenariosFromFolder(
  rootHandle: FileSystemDirectoryHandle
): Promise<string[]> {
  const scenarios: string[] = [];

  for await (const [name, handle] of rootHandle.entries()) {
    if (handle.kind === 'directory') {
      scenarios.push(name);
    }
  }

  return scenarios.sort();
}

/**
 * Extract unique scenario names from top-level ZIP filenames in a folder.
 *
 * Parses scenario-prefixed filenames (e.g., "Paris-session-2026-01-30_14-30-45utc.zip")
 * and extracts the scenario name ("Paris"). Timestamp-only ZIPs (e.g.,
 * "recording-...utc.zip" or "2026-...utc.zip") are ignored since they carry
 * no scenario information.
 *
 * Returns deduplicated, alphabetically sorted scenario names.
 *
 * @param rootHandle - FileSystemDirectoryHandle from showDirectoryPicker()
 * @returns Array of unique scenario names extracted from ZIP filenames, sorted alphabetically
 */
export async function extractScenarioNamesFromZips(
  rootHandle: FileSystemDirectoryHandle
): Promise<string[]> {
  const scenarioSet = new Set<string>();

  for await (const [name, handle] of rootHandle.entries()) {
    if (handle.kind !== 'file' || !name.endsWith('.zip')) {
      continue;
    }

    const match = SCENARIO_PREFIX_PATTERN.exec(name);
    if (match) {
      scenarioSet.add(match[1]!);
    }
  }

  return [...scenarioSet].sort();
}

// ---------------------------------------------------------------------------
// Zip metadata discovery (Issue 1 — 2026-03-01 user feedback)
// ---------------------------------------------------------------------------

/**
 * Result of discovering scenarios from root-level zip file metadata.
 * Each zip is opened and its session.json is read to determine the scenario name.
 */
interface ZipMetadataDiscoveryResult {
  /** Scenario names → session entries (with file handles for reading zip bytes) */
  scenarioSessions: ScenarioSessionMap;
  /** All unique scenario names found, sorted alphabetically */
  scenarioNames: string[];
}

/**
 * Maximum number of zip files to read concurrently during metadata discovery.
 * Limits peak I/O and memory when scanning folders with many recordings.
 * Each concurrent read uses BlobReader (only central directory + session.json),
 * so memory per zip is small, but we still cap it to avoid overwhelming the
 * browser's I/O subsystem.
 */
const METADATA_SCAN_CONCURRENCY = 4;

/**
 * Discover scenarios by reading session.json metadata from root-level zip files.
 *
 * For each `.zip` file in the root directory:
 * 1. Gets a File handle (Blob) — does NOT load the full file into memory
 * 2. Calls `loadSessionMetadataFromBlob()` which uses BlobReader to read
 *    only the zip central directory and the session.json entry
 * 3. Groups the zip by its `scenarioName` metadata field (or UNKNOWN_SCENARIO if absent)
 *
 * Memory efficiency: Uses BlobReader (not arrayBuffer) and limits concurrency
 * to METADATA_SCAN_CONCURRENCY to avoid excessive memory consumption when
 * scanning folders with many large recording zips.
 *
 * This is more accurate than filename-based discovery (`extractScenarioNamesFromZips`)
 * because it uses the actual metadata the recording app wrote, handling timestamp-only
 * filenames like `2026-03-01_09-08-48utc.zip` that carry no scenario information.
 *
 * @param rootHandle - FileSystemDirectoryHandle from showDirectoryPicker()
 * @returns Discovery result with scenario→sessions map and sorted scenario names
 */
/**
 * Defensively parse the `h3Cells` field read from a recording's `session.json`.
 *
 * Returns the array of H3 id strings when the field is present and well-formed
 * (an array whose entries are *all* valid H3 cell ids — including an empty
 * array, which means "no GPS coverage"), or `undefined` when the field is
 * absent (legacy recording) or malformed.
 *
 * Malformed is treated as all-or-nothing: if *any* entry is not a valid H3 cell
 * id — whether it is not a string at all (e.g. `123`) or a string that does not
 * decode to a real cell (e.g. `"garbage"`) — the whole array is rejected
 * (returns `undefined`), rather than silently keeping the good entries. The
 * metadata comes from a file on disk and must not be assumed well-formed
 * (defensive boundary per CLAUDE.md); a partially-corrupt array is
 * untrustworthy, and surfacing a truncated-but-valid-looking coverage is worse
 * than falling back to deriving coverage from the authoritative GPS path.
 * `undefined` is what triggers that legacy backfill downstream
 * (`ui/recording-index.ts`), so a non-empty array that filters to empty must NOT
 * be returned as a valid empty `[]` (which means "no coverage", no backfill).
 *
 * Validating the cell ids here (not just their type) is the only safe place to
 * catch this class of corruption: an invalid id does not fail loudly
 * downstream. `cellToLatLng('garbage')` does not throw — it returns a garbage
 * coordinate that would mis-frame the map in `map-browser.ts` `fitToCoverage`,
 * and `clusterCellsByZoom` silently drops invalid cells — so a bad id would
 * otherwise corrupt the view without ever raising an error.
 */
function parseH3Cells(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const cells = value.filter(
    (c): c is string => typeof c === 'string' && isValidCell(c)
  );
  // All-or-nothing: a non-empty array that lost entries to filtering contained
  // a non-string or an invalid H3 id and is untrustworthy — reject it
  // (undefined) so coverage is backfilled from the GPS path, rather than
  // surfaced as a valid (possibly empty/truncated) array.
  return cells.length === value.length ? cells : undefined;
}

export async function discoverScenariosFromZipMetadata(
  rootHandle: FileSystemDirectoryHandle
): Promise<ZipMetadataDiscoveryResult> {
  const scenarioSessions: ScenarioSessionMap = new Map();

  // Collect all zip file handles first
  const zipHandles: { name: string; handle: FileSystemFileHandle }[] = [];
  for await (const [name, handle] of rootHandle.entries()) {
    if (handle.kind === 'file' && name.endsWith('.zip')) {
      zipHandles.push({ name, handle: handle as FileSystemFileHandle });
    }
  }

  // Read metadata from each zip with concurrency limit.
  // Uses BlobReader (via loadSessionMetadataFromBlob) so only the zip
  // central directory and session.json entry are read — not the full file.
  const metadataResults = await mapWithConcurrencyLimit(
    zipHandles,
    METADATA_SCAN_CONCURRENCY,
    async ({ name, handle }) => {
      try {
        const file = await handle.getFile();
        const metadata = await loadSessionMetadataFromBlob(file);
        return { name, handle, metadata };
      } catch {
        // Skip zips that can't be read (corrupted, too large, etc.)
        return { name, handle, metadata: null };
      }
    }
  );

  // Group by scenarioName from metadata.
  // The framework now stores the recorder's scenario name in the opaque
  // `contextTag` field (post-Iter 0 of the AppFramework/RecorderApp boundary
  // migration). Older zips used a dedicated `scenarioName` field — fall back
  // to it for backwards compatibility with previously-exported recordings.
  for (const { name, handle, metadata } of metadataResults) {
    // Merge missing metadata and "Default Scenario" into the same canonical
    // group (UX feedback 2026-03-23 Issue 2) — shared resolver, see
    // resolveScenarioNameFromMetadata.
    const scenarioName = resolveScenarioNameFromMetadata(metadata);

    const h3Cells = parseH3Cells(metadata?.h3Cells);
    const entry: SessionEntry = {
      filename: name,
      fileHandle: handle,
      date: parseDateFromSessionFilename(name),
      ...(h3Cells !== undefined ? { h3Cells } : {}),
    };

    const existing = scenarioSessions.get(scenarioName);
    if (existing) {
      existing.push(entry);
    } else {
      scenarioSessions.set(scenarioName, [entry]);
    }
  }

  // Sort sessions within each scenario by filename (reverse order — most recent first)
  for (const sessions of scenarioSessions.values()) {
    sessions.sort((a, b) => b.filename.localeCompare(a.filename));
  }

  const scenarioNames = [...scenarioSessions.keys()].sort();
  return { scenarioSessions, scenarioNames };
}

/**
 * Enumerate session zip files within a scenario directory.
 *
 * Filters to files ending in `.zip`, parses dates from filenames, and
 * returns entries sorted by filename (chronological for standard naming).
 *
 * @param scenarioHandle - FileSystemDirectoryHandle for the scenario folder
 * @returns Array of SessionEntry objects sorted by filename
 */
export async function listSessionZipsInScenario(
  scenarioHandle: FileSystemDirectoryHandle
): Promise<SessionEntry[]> {
  const sessions: SessionEntry[] = [];

  for await (const [name, handle] of scenarioHandle.entries()) {
    if (handle.kind === 'file' && name.endsWith('.zip')) {
      sessions.push({
        filename: name,
        fileHandle: handle as FileSystemFileHandle,
        date: parseDateFromSessionFilename(name),
      });
    }
  }

  return sessions.sort((a, b) => b.filename.localeCompare(a.filename));
}
