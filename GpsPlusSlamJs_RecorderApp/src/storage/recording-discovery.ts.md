# recording-discovery.ts

## Purpose

Enumerates scenarios and session recordings from a `FileSystemDirectoryHandle`.
Pure file-system/zip reading — no DOM, no Leaflet, no UI state. Backs three
flows: the Replay Mode session picker, the recording-mode scenario dropdown, and
the [`folder-manager`](folder-manager.ts.md) folder-pick scan.

Lived at `ui/session-browser.ts` until 2026-07-30. It was never a UI module (its
own header always said "pure functions"), and sitting in `ui/` cost real
complexity: `storage/folder-manager.ts` may not import from `ui/`, so it
received `listScenariosFromFolder`, `extractScenarioNamesFromZips` and
`discoverScenariosFromZipMetadata` as injected callbacks and kept a structural
copy of `SessionEntry`; and the naming helpers had to be split out into
[`session-zip-naming`](session-zip-naming.ts.md) and re-exported from here so the
ref-point indexing pass could reach them. All of that is gone with the move.

## Public API

### `listScenariosFromFolder(rootHandle): Promise<string[]>`

Top-level **directory** names, sorted alphabetically. Files are ignored.
Propagates File System Access API errors.

### `extractScenarioNamesFromZips(rootHandle): Promise<string[]>`

Scenario names parsed from top-level **scenario-prefixed** zip filenames
(`{Name}-session-{timestamp}utc.zip` → `{Name}`), deduplicated and sorted.
Timestamp-only zips (`recording-…utc.zip`, bare `YYYY-…utc.zip`) carry no
scenario information and are intentionally skipped. The pattern splits on the
last `-session-` before the timestamp, so hyphenated names like
`Paris-Eiffeltower` survive intact.

### `discoverScenariosFromZipMetadata(rootHandle): Promise<{ scenarioSessions: ScenarioSessionMap; scenarioNames: string[] }>`

Opens every root-level `.zip`, reads its `session.json` via `BlobReader`
(`loadSessionMetadataFromBlob` — central directory + one entry, never the whole
file), and groups by scenario name. More accurate than the filename-based
variant because it handles timestamp-only filenames. Reads are capped at
`METADATA_SCAN_CONCURRENCY` (4, module-private) via `mapWithConcurrencyLimit`.
Unreadable/corrupt zips are skipped, not thrown. Scenario naming — including
the "missing metadata and explicit `Default Scenario` collapse into one group"
rule — is delegated to `resolveScenarioNameFromMetadata`.

The result type `ZipMetadataDiscoveryResult` is deliberately **not exported**
(knip flags exports with no external importer); consumers infer it.

### `listSessionZipsInScenario(scenarioHandle): Promise<SessionEntry[]>`

`.zip` files inside one scenario directory, sorted by filename descending.

### `SessionEntry` (type)

`{ filename, fileHandle, date, h3Cells? }`. `date` is `null` when the filename
does not match the timestamp pattern. `h3Cells` is the per-tour H3 coverage
index (res-11 cells the GPS path crossed) read from `session.json` during
metadata discovery only — `listSessionZipsInScenario` never sets it.

### `ScenarioSessionMap` (type)

`Map<string, SessionEntry[]>`.

## Invariants & assumptions

- Every returned array is sorted: scenario names ascending, session filenames
  descending. Reverse-alphabetical equals reverse-chronological for the standard
  year-first zero-padded naming, so "most recent first" holds.
- Requires the File System Access API (`FileSystemDirectoryHandle.entries()`).
- **`h3Cells` parsing is all-or-nothing** (`parseH3Cells`). An array is accepted
  only when _every_ entry is a string that `h3-js` `isValidCell` accepts;
  otherwise the whole field is rejected as `undefined`. The three states are
  load-bearing and distinct:
  - `[]` — the recording genuinely had no GPS coverage.
  - `undefined` — legacy recording (predates the field) **or** corrupt input;
    both trigger the GPS-path backfill in `ui/recording-index.ts`.
  - a non-empty array — trusted coverage, used as-is.

  Validating the ids rather than just their type is necessary because an invalid
  id fails _silently_ downstream: `cellToLatLng('garbage')` returns a garbage
  coordinate that mis-frames `map-browser.ts` `fitToCoverage`, and
  `clusterCellsByZoom` drops invalid cells without complaint. This parse is the
  only place that corruption can surface.

## Expected folder structure

```
<RootFolder>/
├── Scenario A/                                ← listScenariosFromFolder
│   ├── refPoints/
│   └── recording-2026-01-27_14-30-11utc.zip   ← listSessionZipsInScenario
├── Tokyo-session-2026-03-01_10-00-00utc.zip   ← extractScenarioNamesFromZips → "Tokyo"
├── 2026-02-20_09-00-00utc.zip                 ← discoverScenariosFromZipMetadata reads session.json
└── old-recording.zip                          ← no session.json → DEFAULT_SCENARIO group
```

## Examples

```typescript
import {
  listScenariosFromFolder,
  extractScenarioNamesFromZips,
  discoverScenariosFromZipMetadata,
} from './recording-discovery';

const folderHandle = await showDirectoryPicker({ mode: 'read' });

// Recording mode: sub-directories + scenario-prefixed zip filenames
const [dirScenarios, zipScenarios] = await Promise.all([
  listScenariosFromFolder(folderHandle),
  extractScenarioNamesFromZips(folderHandle),
]);
const scenarios = [...new Set([...dirScenarios, ...zipScenarios])].sort();

// Replay mode: sub-directories + session.json metadata
const discovery = await discoverScenariosFromZipMetadata(folderHandle);
// discovery.scenarioSessions: Map<string, SessionEntry[]> — cached for replay
```

## Tests

- `recording-discovery.test.ts` — all four public functions, including
  `discoverScenariosFromZipMetadata` against real zip round-trips (built with
  `produceTestZip`), with an `arrayBuffer` spy pinning that discovery never
  buffers a whole zip.
- `recording-discovery.property.test.ts` — randomized checks of the sort,
  dedupe, zip-only-filtering and directory-vs-file invariants, plus "no false
  positives from timestamp-only filenames".
- `replay-zip-discovery.test.ts` — bug-exploration tests documenting the
  2026-03-01 user-feedback bugs and pinning the fix.
- Test utility: `MockFSDirectoryHandle` from the framework's
  `test-utils/browser-mocks`.
