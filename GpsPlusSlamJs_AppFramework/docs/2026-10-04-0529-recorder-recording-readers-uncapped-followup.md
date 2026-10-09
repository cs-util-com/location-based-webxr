# The Recorder's recording readers inflate without the K0 caps - followup

Status: open. Filed 2026-10-04 from the K0 milestone review of the tour kit
(finding R10; plan `GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`
in the primary repo, §10). The review's verdict was "fix what the Tour
Viewer reaches, file the rest"; this is the rest.

## What K0 capped, and what it did not reach

K0 put every read the Tour Viewer makes of an untrusted tour under three
caps (`../src/storage/archive-limits.ts`): a single-read cap on the zip
reader (the central directory), the entry-count cap while the directory is
walked, and a count of the bytes ACTUALLY inflated, per entry and per
archive (`../src/storage/capped-zip-entries.ts`). The milestone review fixes
added the creator's Finish (`rebuildZipWithEntries`, which therefore also
caps `embedCoverageInSessionJson`'s re-emit) and the level-file read.

These framework readers still inflate with zip.js's own writers and list
the directory with `getEntries()`, uncapped:

- `loadGpsPathFromBlob` (`../src/storage/zip-reader.ts`) - every
  `actions/*.json` through `TextWriter`, skipping only entries whose
  DECLARED size passes `maxFileSize`. Reached from the Recorder's replay
  picker (`GpsPlusSlamJs_RecorderApp/src/replay/replay-handlers.ts`), which
  opens ANY zip the user picks, so its input is not always the user's own.
- `loadEntriesFromSubdir(...).getText()` (`zip-reader.ts`) - lazy
  `TextWriter` reads with no size check at all.
- `extractSessionMetadataFromReader` (`zip-reader.ts`, behind
  `loadSessionMetadata` and `loadSessionMetadataFromBlob`) - counts the
  inflated bytes of `session.json` since K0, but lists the directory with
  `getEntries()` (no entry cap, no single-read cap). Reached from the
  Recorder's recording discovery and coverage backfill.
- `embedCoverageInSessionJson` (`../src/storage/zip-coverage-embed.ts`) -
  reads `session.json` through `TextWriter` with no cap and lists with
  `getEntries()` before the (now capped) rebuild.
- `readZipEntries` / `loadActionsFromZip` (`zip-reader.ts`) - list with
  `getEntries()`; the actions are inflated under a budget since K0. The
  Tour Viewer reads them only after its own capped listing of the same
  bytes, through a reader with the single-read cap; other callers (the
  Recorder's replay, PhysicsDemo, the replayer) get no entry cap.

## Why it was not fixed with K0

The Recorder mostly reads recordings it wrote itself, the review rated the
risk accordingly, and each reader has its own error contract (empty array,
null, the input zip returned untouched) that a cap's refusal has to fit.
The replay picker is the exception: it accepts any zip.

## Suggested fix

- Route every listing through `listZipEntriesCapped` over a reader with the
  single-read cap (`new ByteSourceReader(new LocalCacheByteSource(blob),
DEFAULT_ARCHIVE_LIMITS.maxDirectoryBytes)` for a Blob).
- Inflate text through `readZipEntryText` under a `DecompressionBudget`
  sized from the archive (`DecompressionBudget.forArchive`), with
  `maxTextEntryBytes` as the per-entry cap.
- Map an `ArchiveLimitError` onto each reader's existing contract (empty
  path, null metadata, untouched zip) and log it, so a refusal is visible
  in the console rather than silent.
- Tests in the shape of `capped-zip-entries.test.ts`: a deflated bomb and a
  crafted end record per reader.

## Related

- `../src/storage/archive-limits.ts.md` (the caps and their sweep)
- `../src/storage/capped-zip-entries.ts.md` (the capped reads)
- `../src/storage/zip-reader.ts.md`, `../src/storage/zip-coverage-embed.ts.md`
