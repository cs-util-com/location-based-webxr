# zip-byte-source-reader.ts

## Purpose

Adapts a `ByteSource` (see `byte-source.ts`) to a zip.js `Reader`, so
`@zip.js/zip.js` can parse a central directory and decompress entries while
every actual byte read is delegated to a source that may be a remote Range
fetch or a local cache, and may switch between them mid-session.

## Public API

- `class ByteSourceReader extends Reader<ByteSource>` - `constructor(source: ByteSource, maxReadBytes = Infinity)`.
  - `maxReadBytes` (K0 milestone review R4): the largest single read zip.js
    may make through this reader; a longer one rejects with
    `ArchiveLimitError('directory-bytes')` BEFORE the source is asked.
    Pass `ArchiveLimits.maxDirectoryBytes` for an untrusted archive:
    zip.js reads a central directory (and each zip64 record) in ONE read of
    the size the end record declares, before any entry is counted, while
    entry data comes in 64 KiB chunks.

## Why not zip.js's built-in `HttpRangeReader`

zip.js ships an HTTP range reader of its own, and the framework's peer floor
(`>=2.7.0`) includes it. It is deliberately not used: it binds the reader to
one URL for the archive's lifetime, so it cannot express the remote→local
mid-session switch (`SwitchableByteSource`), the probe/fallback policy
(`range-probe.ts`), share-link normalization, or the cache/warm story the
orchestrator (`open-remote-archive.ts`) runs. The `ByteSource` seam is the
part that carries all of that; this adapter is the thin bridge back into
zip.js.

## Invariants & assumptions

- `readUint8Array(index, length)` clamps `length` to the remaining bytes —
  zip.js may request past EOF while locating the central directory near the
  archive's tail.
- A read that clamps to zero (at/past EOF, or zero-length) resolves to an
  empty array **without touching the source** — a remote source would turn it
  into an invalid HTTP Range header.
- The single-read cap is measured AFTER the EOF clamp: zip.js asking past
  the end of a small archive is not a large read.

## Examples

```ts
const source = new SwitchableByteSource(remote);
const entries = await new ZipReader(new ByteSourceReader(source)).getEntries();
```

## Tests

`zip-byte-source-reader.test.ts` — size exposure, in-bounds delegation, EOF
clamping, and the zero-length/past-EOF local resolve (source never called);
the single-read cap refusing before the source is asked, measured after the
clamp. `capped-zip-entries.test.ts` drives it with a crafted 64 MiB archive
whose end record declares a 32 MiB directory.
