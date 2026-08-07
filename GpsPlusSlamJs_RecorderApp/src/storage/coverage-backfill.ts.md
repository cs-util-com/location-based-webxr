# coverage-backfill.ts

## Purpose

One-line: the one-time, opt-in upgrade that embeds each legacy recording's H3 coverage into its own `session.json` (O3 — in-zip rewrite), so legacy recordings index instantly on every future open in this app **and any other reader**.

The coverage cells are already derived in memory while the map browser streams its index (Slice A) — this step only **writes** them; it never re-reads GPS paths. See the plan: `GpsPlusSlamJs_Docs/docs/2026-06-14-1924-progressive-map-browser-indexing-and-backfill-followup.md` (B1/B2/B4) and the B3 primitive `GpsPlusSlamJs_AppFramework/src/storage/zip-coverage-embed.ts`.

## Public API

- `backfillCoverageIntoZips(rootHandle, candidates, handlers?): Promise<BackfillResult>`
  - **rootHandle** — the directory the candidates came from (the `readwrite` upgrade covers its file handles).
  - **candidates** — `BackfillCandidate[]` = `{ fileHandle; filename; cells }` (decoupled from the UI `RecordingCoverage`).
  - **handlers** — `{ onProgress?({done,total}); signal? }`.
  - **Returns** `BackfillResult` = `{ embedded; skipped; failed; permissionDenied }`.
- `BackfillCandidate`, `BackfillHandlers`, `BackfillResult` interfaces (`BackfillProgress` — the `{done,total}` passed to `onProgress` — is module-internal).

## Invariants & assumptions

- **Opt-in + confirmed (B1):** the caller invokes this only from an explicit, confirmed user gesture (the map-browser "Speed up future loads" button) — never as a side effect of opening a folder. The button click is also the gesture the permission upgrade needs.
- **Permission (B2):** upgrades `rootHandle` to `readwrite` on entry. If denied (or it throws) → writes nothing, returns `permissionDenied: true`; the caller degrades (the progressive in-memory index still works).
- **Verify-before-overwrite (B4):** each rewrite is built in memory by `embedCoverageInSessionJson` and its `session.json` re-read to confirm `h3Cells` landed **before** the original is touched. The write uses `FileSystemFileHandle.createWritable()`, which the FS-Access spec implements as write-to-temp + **atomic swap on `close()`** — a crash mid-write leaves the original intact.
  - **Deliberate deviation from the plan's B4:** the plan prescribed a manual `<name>.h3.tmp` sibling + read-back. That assumed the FS-Access API has no atomic rename, but `createWritable()` already provides one; the manual sibling also needs per-file parent-directory handles and leaves `.tmp` litter. The in-memory verify + atomic `createWritable` is simpler, has no litter, and is at least as safe.
- **Idempotent / no-op safe:** a candidate whose zip has no/broken/already-embedded `session.json` is counted as `skipped` and left untouched (the B3 primitive returns the input by reference). Re-running the upgrade only rewrites what still needs it.
- **Isolated failures:** a per-file read/verify/write error is logged, counted in `failed`, and does not abort the rest. Bounded concurrency (`BACKFILL_WRITE_CONCURRENCY = 4`); abortable via `signal` (stops pulling new files, skips the in-flight write).
  - **Write-failure cleanup uses `abort()`, never `close()`** — now delegated to the framework helper `writeFileOrAbort` rather than hand-rolled here. If `write()`/`close()` throws mid-rewrite the temp swap holds a partial/empty result, so the helper `abort()`s the writable: the temp is **discarded without** the atomic swap (calling `close()` would commit the corruption over the user's recording) and the stream's file-handle lock is finalized rather than leaked. The original file is left byte-for-byte intact and the file is counted in `failed`.

## Examples

```ts
const candidates = recordings
  .filter((r) => r.backfilled)
  .map((r) => ({
    fileHandle: r.entry.fileHandle,
    filename: r.entry.filename,
    cells: r.cells,
  }));
const result = await backfillCoverageIntoZips(folderHandle, candidates, {
  onProgress: ({ done, total }) => browser.setIndexingProgress(done, total),
  signal,
});
if (result.permissionDenied)
  showError(
    'Couldn’t get write access — recordings will be re-indexed each open.'
  );
```

## Tests

- `coverage-backfill.test.ts` (purpose-built fake file handles, since the shared `MockFSFileHandle.createWritable` stores strings not Blobs): embeds coverage into legacy `produceTestZip`s and re-reads `h3Cells` back; permission denied → no writes + `permissionDenied`; a per-file `createWritable` failure is isolated and counted while the rest embed; a `write()` failure mid-rewrite `abort()`s the writable (asserts `abort` ran, `close` did not, and the original blob is untouched) so no partial commit/handle leak occurs; a zip without `session.json` is `skipped` (no write); an already-aborted signal prompts no permission and writes nothing.
