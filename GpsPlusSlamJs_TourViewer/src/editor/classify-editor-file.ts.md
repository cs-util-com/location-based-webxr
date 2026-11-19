# `classify-editor-file.ts` - what a file given to the editor is

## Purpose

Sorts a chosen or dropped file into a **tour**, a **scan** (a debug
bundle a phone saved, or a plain Recorder recording) or **neither**,
before anything is opened. The editor then opens a tour, adds a scan
beside an open tour, or refuses in words. It reads the zip's central
directory once (`../zip-blob.ts` `withZipBlobDirectory`) and, for a
bundle, its small identity entry (`../debug-bundle.ts` `readDebugBundle`,
which caps it) - never a scan's walk.

## Public API

- `classifyEditorFile(file) -> Promise<EditorFileKind>`, never rejects:
  - `{ kind: "tour", file }` - the directory names a `tour.json`
    (`tourManifestEntryOf`) or a printed code's level
    (`qrLevelIdFromEntryName`). A tour carrying a walk is a tour.
  - `{ kind: "scan", file, scan }` - no tour entry, but a recording
    (`recordingEntryNames`); `scan` is `readDebugBundle`'s
    `{ kind: "bundle", identity }` or `{ kind: "recording" }`.
  - `{ kind: "neither", file, reason }` - `NOT_A_ZIP` for a name and type
    that are no zip, `describeOpenError` words for bytes that are not a
    readable zip, `NOT_A_TOUR` for a zip with neither a tour nor a
    recording (the same words the open used), or the bundle reader's
    refusal (two identities, an oversized or broken one).
- `classifyEditorFiles(files) -> Promise<EditorFileKind[]>` - each file,
  in the list's order; one bad file costs only itself.

## Invariants & assumptions

- The file is untrusted: every failure is a `neither` with a reason.
- Classifying is not admitting: a tour sorted as a tour may still be
  refused by the open (an unreadable `tour.json`, an older format), and a
  scan by the add (its archive caps); those say why themselves.
- Cost (measured on the repo's example Recorder zips, Node, 2026-11): the
  largest, 71.5 MB, read 204 kB in 27 ms; the eight files 3.6-71.5 MB read
  80-204 kB in 7-27 ms. The read grows with the directory (entry count),
  not with the walk's bytes.

## Examples

```ts
const kind = await classifyEditorFile(file);
if (kind.kind === "scan") addScan(file);
```

## Tests

- `classify-editor-file.test.ts` - each kind, the tour-wins rule, the
  refusals, bytes read stay a fixed block for a 4 MB scan, a list in
  order, and a property over random entry names (never rejects; a tour
  entry always makes a tour; no recording and no tour is neither).
- `classify-editor-file.recordings.test.ts` - the example Recorder zips:
  each a scan, bytes read and time printed per file (`--reporter=default`
  shows them).
