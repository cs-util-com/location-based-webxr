# tour-session.ts

> Geo-join addition (2026-08-26): `loadRecordingActions()` (the parsed
> action stream via the framework parser over a second range-streaming
> reader) and `loadSessionMeta()` (`session.json`, the era gate's input) —
> BOTH null-tolerant: a hand-built zip or a corrupt stream reads as "keep
> the ring", never a broken archive.
>
> M3 addition: `loadQrLevels(): Promise<ReadonlyMap<string, QrLevel>>` —
> every `qr/<id>.json` in the archive, keyed by `<id>` — the hash of the
> printed code's decoded text. NULL-TOLERANT by design: zero files is the
> common tour,
> and a corrupt file degrades to "that code has no level", never a broken
> archive. Covered by the 0/1/2-files and corrupt-file tests.

## Purpose

One open tour archive: the framework's `openRemoteArchive` wired to zip.js
(`ByteSourceReader`), plus what the viewer needs on top — entry summaries
with image classification, live streaming-stats aggregation, per-entry Blob
loading with MIME types, and the poisoned-cache recovery loop.

## Public API

- `openTourSession(url, options?): Promise<TourSession>` with
  `OpenTourOptions { fetchImpl?; cacheStore?; googleDriveApiKey?; corsProxyBaseUrl?; onStats?; limits? }`
  — `limits` overrides the zip-bomb caps (`DEFAULT_ARCHIVE_LIMITS`) for
  tests; the page always opens with the defaults.
- `TourSession { entries; archive; hasRecording; manifestWrap; stats(); loadEntry(filename); loadContentEntry(image); close() }`
  — `hasRecording` is the synchronous `actions/` pre-check
  `loadRecordingActions()` applies (a wrapping folder tolerated), exposed
  for the page's flow copy (`tour-flow.ts`, flows plan M1).
- `TourEntry { filename; size; isImage }` (reached via `TourSession.entries`, not separately exported),
  `StreamStats { networkRequests; networkBytes; cacheReads; cacheBytes; origin }`
  — `origin` tracks the LATEST read, flipping to `'cache'` once the warm
  swap serves reads locally (the archive's own `origin` field is only the
  initial state).

- `loadTourManifest(): Promise<TourManifest | null>` (guided-setup plan M3)
  - null without `tour.json`; a broken manifest REJECTS (the framework's
    rule for this file: it is the whole placement, not one bad level).
- `manifestWrap: string` and `loadContentEntry(image)` (PR #435 review) -
  the folder `tour.json` was found under, with its trailing slash (`""`
  for a flat zip, `"mytour/"` for one made by re-zipping a folder), and
  the entry reader that joins it. **The one place that prefix is
  derived:** the manifest can only ever carry the unwrapped
  `content/<id>.<ext>` (the framework's parser pins that shape), so a
  wrapped archive's photo bytes live at `mytour/content/…` while the
  record says `content/…`. The finish step writes through the same
  value. Deriving it twice is exactly how the writer and the reader
  drifted apart.
- `readWholeArchive(): Promise<Blob>` - the rebuild's input: the warmed
  cache copy under the archive's NORMALISED url when the store has it AND
  its size matches, else the archive in 4 MiB range slices gathered into
  one Blob (each request keeps the transport's per-slice timeout; the
  slices are views, not copies).
- `hostedFileName(): string | null` - the hosted file's name as its host
  sends it (`content-disposition`, parsed by `content-disposition.ts`), or
  null (an offline cache hit, a host that sends none). Recorded by a thin
  wrapper around the open's `fetchImpl` from the requests the open already
  makes (the probe's HEAD) - never an extra request - and it closes with
  the session (Drive replace plan §5 #8).
- `archiveFileName(url): string` (pure) - the hosted file's name for the
  same-name re-upload: the last path segment when it ends in `.zip`
  (decoded), else `tour.zip`.
- `tourLabel(url): string` (pure, never throws) - what the creator's panel
  calls a tour (scan-to-open plan §9 #11): a real `.zip` name (cut at 24),
  else `Google Drive file <first 10 of the id>…` for every Drive spelling
  and the proxy route, else `host/<first 12 of the last segment>…`, else
  "the tour". Short on purpose: it shares a line with the live readout.

## Invariants & assumptions

- **Poison recovery:** a parse failure on a CACHE-served archive evicts the
  copy and reopens with `skipCache` (the loop the framework's
  `open-remote-archive.ts.md` prescribes) — without it one corrupted copy
  bricks the viewer for that URL on every future visit. A parse failure on a
  network-served archive propagates: the hosted file itself is broken.
- `stats()` returns a snapshot; `onStats` fires after every read the archive
  serves (network and cache separately counted).
- `close()` disposes the archive (aborting any warm download) and closes the
  zip reader.
- Directory entries are dropped from `entries`; images are recognized by
  extension (jpg/jpeg/png/webp/gif/avif).
- **The zip-bomb caps (tour kit plan K0, K-D1, review F1).** A tour comes
  from any link (or file), so it is read as untrusted input: the open
  carries the transport cap (`maxArchiveBytes`, cause `'too-large'`), the
  directory is walked with `listZipEntriesCapped` (an `ArchiveLimitError`
  past `maxEntries` fails the open), and EVERY entry the page reads -
  `loadEntry`, `loadContentEntry`, `tour.json`, the levels, `session.json`
  and the action stream - is inflated under ONE `DecompressionBudget` per
  archive that counts the bytes actually produced (per entry, the text
  entries at `maxTextEntryBytes`, and the archive total; a re-read of the
  same entry is not charged twice). A cap hit fails only the read that hit
  it: a level over the text cap degrades to "no level" like a corrupt one,
  a content bomb fails that photo, and the tour stays open. Values and
  their measurement: the framework's `archive-limits.ts.md`.

## Examples

```ts
const session = await openTourSession(url, { cacheStore, onStats: render });
const blob = await session.loadEntry(session.entries[0].filename);
```

## Tests

`tour-session.test.ts` — listing + classification + typed Blob loading, the
live stats feed, unknown-entry rejection, the poisoned-cache evict-and-retry,
and the broken-remote-archive propagate case; "the zip-bomb caps (K0)" -
the entry-count refusal, the text cap on `tour.json`, a deflated content
bomb stopped with the tour still open, the shared total (a re-read free),
and a level over the text cap degrading to no level.
