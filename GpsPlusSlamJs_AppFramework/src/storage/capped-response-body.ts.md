# capped-response-body.ts

## Purpose

Read a `Response` body whole as a Blob, but never past a byte cap - the
transport half of the archive caps (`archive-limits.ts`, tour kit plan K0).
Used for every whole-body download of an archive: the range probe's 200
from a host that ignores `Range` (`remote-range-byte-source.ts`), the full
download, the background warm copy and the range-ignore recovery
(`open-remote-archive.ts`). Before K0 all four called `res.blob()` /
`arrayBuffer()` with no limit.

## Public API

- `readResponseBodyCapped(res, maxBytes): Promise<Blob>` - the body, typed
  with the response's `content-type`.
  - Throws `ArchiveLimitError` (`kind: 'archive-bytes'`, `observed` = the
    announced or counted size) once the body is, or announces to be, larger
    than `maxBytes`.
  - Throws `RangeError` for a cap that is not a positive safe integer.

## Invariants

- An announced `Content-Length` above the cap refuses the body WITHOUT
  reading it; the stream is cancelled.
- The stream is counted chunk by chunk and cancelled as soon as it passes
  the cap: a missing (chunked) or lying header cannot carry more bytes in.
  The chunk that passes the cap is never delivered.
- **No chunk is collected in page memory** (K0 milestone review R5): the
  count is a pass-through stream (`byte-counting-stream.ts`) feeding
  `new Response(stream).blob()`, which a browser assembles outside the JS
  heap. Before, every chunk sat in a JS array until the Blob was built, so
  the 1 GiB transport cap was also up to 1 GiB of page memory on a phone.
  The Blob is re-typed with the response's `content-type` (a Blob over a
  Blob is a reference, not a copy).
- An unreadable `Content-Length` (`abc`, negative, unsafe) is ignored, not
  trusted; the count still holds.
- A response without a stream (Response-shaped test fakes, some polyfills)
  falls back to `blob()` and checks the size afterwards.

## Example

```ts
const blob = await readResponseBodyCapped(
  res,
  DEFAULT_ARCHIVE_LIMITS.maxArchiveBytes
);
```

## Tests

`capped-response-body.test.ts`: an announced size refused before any chunk
is pulled, a header-less body stopped within a chunk of the cap, a lying
header stopped the same way, a body under the cap returned intact and typed,
the no-stream fallback, an unreadable header, and the cap's own validation.
