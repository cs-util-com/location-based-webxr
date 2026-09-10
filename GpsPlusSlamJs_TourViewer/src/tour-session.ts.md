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
  `OpenTourOptions { fetchImpl?; cacheStore?; googleDriveApiKey?; corsProxyBaseUrl?; onStats? }`
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
- `archiveFileName(url): string` (pure) - the hosted file's name for the
  same-name re-upload: the last path segment when it ends in `.zip`
  (decoded), else `tour.zip`.

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

## Examples

```ts
const session = await openTourSession(url, { cacheStore, onStats: render });
const blob = await session.loadEntry(session.entries[0].filename);
```

## Tests

`tour-session.test.ts` — listing + classification + typed Blob loading, the
live stats feed, unknown-entry rejection, the poisoned-cache evict-and-retry,
and the broken-remote-archive propagate case.
