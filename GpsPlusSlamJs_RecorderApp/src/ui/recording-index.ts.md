# recording-index.ts

## Purpose

Builds the **in-memory recording-coverage index** that backs the map-centric recording browser: for every recording in a folder, the deduplicated res-11 H3 cells its GPS path crossed. The map view clusters these per zoom level (via `clusterCellsByZoom`) to draw tiles and answer "which tours cross this tile?".

See the plan: `GpsPlusSlamJs_Docs/docs/2026-06-14-1048-map-centric-recording-browser-and-h3-index-user-feedback.md` (D2 — in-memory only, no disk cache).

## Public API

- `RecordingCoverage` (interface) — `{ entry: SessionEntry; scenario: string; cells: readonly string[]; backfilled: boolean }`. `backfilled` is `true` when `cells` were derived from the GPS path because the recording carried no `h3Cells` metadata (legacy recording).
- `loadCoverageCellsForEntry(entry): Promise<{ cells: string[]; backfilled: boolean }>` — resolves coverage for one recording.
  - Fast path: when `entry.h3Cells` is defined (including an empty array), returns it verbatim **without reading the zip's GPS data**.
  - Legacy fallback: when `entry.h3Cells` is `undefined`, reads the GPS path (`loadGpsPathFromBlob`) and derives coverage (`gpsPathToCoverageCells`) **in memory**.
- `streamRecordingIndex(rootHandle, handlers): Promise<void>` — **progressive** variant. Discovers all recordings, reports the count via `handlers.onTotal`, then emits each via `handlers.onRecording` as its coverage resolves: metadata-present recordings first (no I/O, effectively instant), then legacy recordings backfilled with bounded concurrency. `handlers.onProgress` fires after each emission with a monotonic `{ done, total }`. An optional `handlers.signal` (`AbortSignal`) aborts the run — no further emissions, and the legacy backfill stops pulling new zips. This is what lets the map mount immediately and stream tours in (Slice A of the progressive-indexing follow-up).
  - `IndexProgress` — `{ done: number; total: number }`.
  - `StreamRecordingIndexHandlers` — `{ onTotal?; onRecording; onProgress?; signal? }`.
- `buildRecordingIndex(rootHandle): Promise<RecordingCoverage[]>` — a thin `await`-all wrapper over `streamRecordingIndex` for non-progressive callers and tests. Resolves every recording before returning, flat across scenarios. Order follows the stream: metadata-present recordings first, then legacy ones.

## Invariants & assumptions

- **Empty vs. undefined `h3Cells`.** An empty array means the recording genuinely had no GPS coverage and is returned as-is (`backfilled: false`). Only `undefined` (the field is absent — a legacy recording) triggers the GPS-path backfill. Conflating the two would needlessly re-read zips with no GPS.
- **No disk cache (D2).** Backfill is purely in memory for the session. If re-scanning large _legacy_ folders proves too slow, the persistent index (plan option 2-B) is the documented escape hatch — but only if measured.
- **Defensive:** a zip that cannot be read degrades to empty coverage (`backfilled: true`) with a warning, so one corrupt recording cannot abort the whole folder index.
- **Bounded concurrency:** legacy backfills read every action file, so reads are capped at `COVERAGE_BACKFILL_CONCURRENCY` (4) via `forEachWithConcurrencyLimit`, mirroring the metadata-scan cap in [`storage/recording-discovery.ts`](../storage/recording-discovery.ts.md).
- **Abort drops in-flight results.** `streamRecordingIndex` checks the signal both before pulling a new legacy zip and again before each emission, so a read that was already in flight when the abort fired resolves but is **not** emitted — a torn-down consumer never receives stray recordings.

## Examples

```ts
const index = await buildRecordingIndex(rootHandle);
// index: RecordingCoverage[] — one per recording, with res-11 coverage cells.
// The map view then clusters per zoom:
const tilesAtZoom = clusterCellsByZoom(
  index.flatMap((r) => r.cells),
  targetRes
);
```

## Tests

- `recording-index.test.ts` — `loadCoverageCellsForEntry` (metadata fast path with no file read, empty-vs-undefined semantics, legacy GPS-path backfill against `produceTestZip`, corrupt-zip degradation), `buildRecordingIndex` (mixed metadata/legacy folder, empty folder), and `streamRecordingIndex` (emits each recording once with correct total, metadata-present before legacy, monotonic progress ending at total, already-aborted signal emits nothing, mid-stream abort halts further emission). The legacy-path test pins that derived cells equal `gpsPathToCoverageCells` of the known recorded GPS coordinates.
