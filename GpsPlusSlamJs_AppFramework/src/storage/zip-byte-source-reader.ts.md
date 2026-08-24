# zip-byte-source-reader.ts

## Purpose

Adapts a `ByteSource` (see `byte-source.ts`) to a zip.js `Reader`, so
`@zip.js/zip.js` can parse a central directory and decompress entries while
every actual byte read is delegated to a source that may be a remote Range
fetch or a local cache, and may switch between them mid-session.

## Public API

- `class ByteSourceReader extends Reader<ByteSource>` — `constructor(source: ByteSource)`.

## Invariants & assumptions

- `readUint8Array(index, length)` clamps `length` to the remaining bytes —
  zip.js may request past EOF while locating the central directory near the
  archive's tail.

## Examples

```ts
const source = new SwitchableByteSource(remote);
const entries = await new ZipReader(new ByteSourceReader(source)).getEntries();
```

## Tests

No dedicated unit test — exercised through a consumer's integration test
against a real zip (e.g. TourBuilder's `cloud-loader` component).
