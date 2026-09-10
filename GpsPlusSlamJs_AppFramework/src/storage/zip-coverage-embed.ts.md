# zip-coverage-embed.ts

## Purpose

One-line: produce a copy of a recording zip whose `session.json` gains the H3 coverage fields (`h3Cells` + `h3Resolution`), leaving every other entry byte-for-byte unchanged.

This is the **B3** primitive of the in-zip backfill (O3 — in-zip rewrite): it lets a one-time "upgrade" embed the derived coverage **inside the recording**, so legacy recordings index instantly on every future open in this app and any other reader. See the plan: `GpsPlusSlamJs_Docs/docs/2026-06-14-1924-progressive-map-browser-indexing-and-backfill-followup.md`.

## Public API

- `embedCoverageInSessionJson(zip: Blob, h3Cells: string[], h3Resolution: number): Promise<Blob>`
  - **Input:** a recording zip blob + the coverage cells/resolution to embed.
  - **Output:** a **new** zip blob with `session.json` merged to include `h3Cells` + `h3Resolution`; or the **input blob unchanged (same reference)** when it skips.
  - **Skips (returns input by reference):** no `session.json`; unparseable `session.json`; `session.json` that PARSES to a non-object, including an array or a bare number/string; `session.json` already has `h3Cells` (idempotent); or any unexpected read/write failure. Callers detect a skip via `result === zip`.
  - **Never throws** for zip-content reasons and **never emits a partial** zip — on a mid-write failure it abandons the half-built zip and returns the original.

## Invariants & assumptions

- **Pure transform, no I/O side effects.** It does not touch the filesystem — the caller (RecorderApp backfill, B4) owns the safe write-then-verify-then-overwrite protocol around it.
- **Byte-preserving.** A wrapper over `rebuildZipWithEntries` (see [zip-rebuild.ts](zip-rebuild.ts.md)) since 2026-09-08 - the package's ONE re-emit loop (DEC-H3); store mode, every non-`session.json` entry byte-identical, directory entries dropped. The rebuild throws on failure; this wrapper turns that into its own skip-and-return-input contract, because a backfill over many recordings wants "left untouched", not an exception per file.
- **Idempotent.** A zip already carrying `h3Cells` is returned unchanged, so re-running the upgrade is a no-op and new recordings (which already have the field) are skipped. It does **not** overwrite existing cells.
- **Defensive.** Missing, malformed, or non-object `session.json` returns the input untouched rather than writing over a broken recording. The non-object case is separate on purpose: `JSON.parse` SUCCEEDS on `3`, `"text"`, `null` and `[1,2]`, so those are neither missing nor unparseable - and merging into one would spread it into a fresh object and overwrite whatever the file actually held.

## Examples

```ts
const result = await embedCoverageInSessionJson(zipBlob, cells, 11);
if (result === zipBlob) {
  // skipped (no/broken session.json, or already embedded) — nothing to write
} else {
  // result is a new blob to verify, then atomically swap over the original
}
```

## Tests

- `zip-coverage-embed.test.ts` — embeds into a legacy `produceTestZip` and reads the fields back via `loadSessionMetadataFromBlob`; asserts every non-session entry is byte-identical (open-reader byte map); idempotent on an already-embedded zip (same reference, original cells preserved, not overwritten); returns the input untouched for absent and malformed `session.json` (hand-crafted zips).
