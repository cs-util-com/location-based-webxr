# zip-byte-source-reader.ts

## Purpose

Adapts a `ByteSource` (see `byte-source.ts`) to a zip.js `Reader`, so
`@zip.js/zip.js` can parse a central directory and decompress entries while
every actual byte read is delegated to a source that may be a remote Range
fetch or a local cache, and may switch between them mid-session.

## Public API

- `class ByteSourceReader extends Reader<ByteSource>` — `constructor(source: ByteSource)`.

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

## Examples

```ts
const source = new SwitchableByteSource(remote);
const entries = await new ZipReader(new ByteSourceReader(source)).getEntries();
```

## Tests

`zip-byte-source-reader.test.ts` — size exposure, in-bounds delegation, EOF
clamping, and the zero-length/past-EOF local resolve (source never called).
