# `classify-editor-file.ts` - what a file given to the editor is

## Purpose

Sorts a chosen or dropped file into a **tour**, a **scan** (a debug
bundle a phone saved, or a plain Recorder recording) or **neither**,
before anything is opened. The editor then opens a tour, adds a scan
beside an open tour, or refuses in words. It reads the zip's central
directory once (`../zip-blob.ts` `withZipBlobDirectory`) and, for a
bundle, its small identity entry (`../debug-bundle.ts` `readDebugBundle`,
which caps it, inflated under its own cap `MAX_IDENTITY_BYTES`: a
directory can understate it) - never a scan's walk.

## Public API

- `classifyEditorFile(file) -> Promise<EditorFileKind>`, never rejects:
  - `{ kind: "tour", file, title, stations }` - the directory names a
    `tour.json` (`tourManifestEntryOf`) or a printed code's level
    (`qrLevelIdFromEntryName`). A tour carrying a walk is a tour.
    `title` (trimmed, cut at 80 characters, null when empty) and
    `stations` (the `stations` list's length) come from the `tour.json`
    when its declared size is at most `TOUR_SUMMARY_MAX_BYTES` (256 kB)
    and it parses; else null - the summary is for the open dialog's chip
    and never decides the kind.
  - `{ kind: "scan", file, scan, captures }` - no tour entry, but a
    recording (`recordingEntryNames`); `scan` is `readDebugBundle`'s
    `{ kind: "bundle", identity }` or `{ kind: "recording" }`;
    `captures` the count of recorded frames in the directory
    (`../tour-read-set.ts` `isRecordedFrameName`), names only.
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
  80-204 kB in 7-27 ms (measured once, not asserted). The read grows with the directory (entry count),
  not with the walk's bytes.

## Examples

```ts
const kind = await classifyEditorFile(file);
if (kind.kind === "scan") addScan(file);
```

## Tests

- `classify-editor-file.test.ts` - each kind, a tour's title and station
  count (wrapped too) and null for a broken, odd or oversized `tour.json`,
  a scan's capture count, the tour-wins rule, the
  refusals, bytes read stay a fixed block for a 4 MB scan, an identity
  entry that inflates far past its declared size stopped early (its read
  capped, the bytes inflated measured), an identity carried twice refused
  as ambiguous, a list in order, and a property over random entry names,
  wrapped ones included (never rejects; a tour entry always makes a tour;
  no recording and no tour is neither; the oracle is the archive's own
  predicates).
- `classify-editor-file.recordings.test.ts` - the example Recorder zips:
  each a scan under the read bound, bytes read printed per file (no clock
  assertion: the bytes are the machine-independent bound; `--reporter=default`
  shows them).
