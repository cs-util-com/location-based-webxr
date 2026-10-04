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
- `openTourFile(file, options?): Promise<TourSession>` (tour kit plan K0)
  - a tour zip on the device, `options.limits` as above. Its
    `archive.url` is `tour-file-key.ts`'s key: the series id when the
    zip carries `manifest.json` (tour kit plan K1, R7), else the content
    key.
- `TourSession { entries; archive; fromFile; hasRecording; manifestWrap; budget; stats(); loadEntry(filename); loadEntryText(filename); loadContentEntry(image); close() }`
  - `integrity` (tour kit plan K1, §8 D3) - TIER 1's result
    (`tour-integrity.ts`): `none` for a tour without `manifest.json`,
    else the manifest whose names and sizes the archive matched. Run in
    the build, before the session exists: an archive that does not match
    its manifest rejects the open (`TourIntegrityError`), and a
    cache-served one takes the poison path (evict, reopen remote).
  - TIER 2: every entry read (`loadEntry`, `loadEntryText`,
    `loadContentEntry`, the levels, `session.json`, the recording's action
    entries through `loadActionsFromZip`'s reader parameter) goes through
    ONE capped read that also hashes the bytes against the manifest
    (`TourIntegrityGuard`); a tour without a manifest reads unhashed.
  - `wholeArchiveCheck` - TIER 3's outcome (`checked | failed |
not-checked`): a link's complete copies are checked through
    `openRemoteArchive`'s `acceptLocalCopy` before they back the session or
    are cached; a saved copy and a file are checked in the background after
    open; without a cache a ranged link is `not-checked`.
  - `integrityFailure()` - the LATE failure (tier 2 or 3), once found. It
    is latched: every later read rejects with it, `readWholeArchive` too;
    the session evicts its cached copy and calls
    `options.onIntegrityFailure(err, session)` once (the page removes the
    tour's content).
  - `budget` - the archive's one `DecompressionBudget`; the creator's
    Finish passes it to `rebuildZipWithEntries` when the rebuild's input
    is this archive (K0 milestone review R1).
  - `loadEntryText(filename)` - one entry as UTF-8 under the text cap
    (`maxTextEntryBytes`), for JSON a caller parses itself (the hosted
    level file, K0 milestone review R10).
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
  extension (jpg/jpeg/png/webp/gif/avif), through the framework's media
  allowlist (`ar/tour-media.ts`).
- **The media allowlist (tour kit plan K0, review D12).** A Blob gets the
  allowlisted MIME type of its entry, or `application/octet-stream` -
  never a type a browser renders as a page. `loadContentEntry` refuses any
  name outside the allowlist (an SVG in `content/` included, even when the
  zip holds one) and a `.glb` that fails `checkGlbInert` (an outside URI, a
  decoder extension), with a plain-words error.
- **The zip-bomb caps (tour kit plan K0, K-D1, review F1).** A tour comes
  from any link (or file), so it is read as untrusted input: the open
  carries the transport cap (`maxArchiveBytes`, cause `'too-large'`), the
  directory is read through `ByteSourceReader`'s single-read cap
  (`maxDirectoryBytes`: zip.js reads a declared directory in one piece,
  K0 milestone review R4; the action stream's second reader carries it
  too) and walked with `listZipEntriesCapped` (an `ArchiveLimitError`
  past either cap fails the open), and EVERY entry the page reads -
  `loadEntry`, `loadContentEntry`, `tour.json`, the levels, `session.json`
  and the action stream - is inflated under ONE `DecompressionBudget` per
  archive that counts the bytes actually produced (per entry, the text
  entries at `maxTextEntryBytes`, and the archive total; a re-read of the
  same entry is not charged twice). A cap hit fails only the read that hit
  it: a level over the text cap degrades to "no level" like a corrupt one,
  a content bomb fails that photo, and the tour stays open. Values and
  their measurement: the framework's `archive-limits.ts.md`.
- **A refusal of the recording is never "no recording"** (K0 milestone
  review R9): `loadRecordingActions` and `loadSessionMeta` still read a
  corrupt stream or file as null (the join declines, the tour works), but
  REJECT with the `ArchiveLimitError` when a cap refuses them, so the
  join's caller (`viewer-placement.ts`) shows it in the AR status line
  ("photo ring (reading the recording failed: ...)") instead of a silent
  ring.
- **Opening a FILE (`openTourFile`, tour kit plan K0).** The same session
  over the file's own bytes (`LocalCacheByteSource`): the same caps (the
  transport cap from `file.size`, cause `'too-large'`), no network, no
  cache, no warm download, no poison retry. `archive.url` is the content
  key of `tour-file-key.ts` (`local-file:` + 128 bits of SHA-256 over the
  sorted name / size / CRC list of the central directory, the tour kit's own
  files left out so a Finish keeps it, K0 milestone review R7; the
  reasoning is in that sidecar) - the draft store and the scan comparisons key on it;
  `hostedFileName()` is the file's name, so a finished zip is offered under
  it; `readWholeArchive()` returns the file itself; `fromFile` is true and
  the stats stay at zero. A file that is not a zip fails in plain words
  ("... is not a readable tour zip"), with the zip error as its cause.

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
and a level over the text cap degrading to no level; "the media allowlist
(K0)" - an SVG content entry refused and never an image, a self-contained
`.glb` served as a model while one with an outside buffer URI is refused,
and Blob types from the allowlist (plain bytes otherwise); "openTourFile
(K0)" - a full session keyed by content, the same key under any file name,
the plain-words non-zip error, and the transport and entry caps.
