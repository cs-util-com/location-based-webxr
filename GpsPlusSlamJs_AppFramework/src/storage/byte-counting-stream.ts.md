# byte-counting-stream.ts

## Purpose

A pass-through `TransformStream` that counts the bytes flowing through it:
the one counter behind every capped whole read of an untrusted archive
(tour kit plan K0, K0 milestone review R5,
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`
§10). The capped reads used to collect each chunk in a JS array and build a
Blob at the end, so a cap was also a buffer of the same size in page
memory. Through this stream each chunk goes straight on and is never kept.

## Public API

- `byteCountingStream(onTotal: (total: number) => void): TransformStream<Uint8Array, Uint8Array>`
  - `onTotal` is called with the running byte total after each NON-empty
    chunk, before that chunk is passed on. Empty chunks are dropped
    without a call.
  - Throwing from `onTotal` refuses the chunk: it is not delivered, and the
    stream errors with exactly the thrown value on both sides.

## Invariants & assumptions

- Nothing is buffered beyond the stream's own queue (one chunk on each
  side by default), so a consumer must read while the producer writes -
  `new Response(stream.readable).blob()` started before the writes is the
  pattern (`capped-zip-entries.ts`).
- The error reaches both ends: a reader of the readable rejects with it,
  a writer of the writable rejects with it, a `pipeThrough` cancels its
  source with it (the rest of a network body is never pulled), and zip.js's
  `getData` rejects with it.
- Pure counting: no cap of its own. The caller's callback decides
  (`capped-response-body.ts`: the transport cap; `capped-zip-entries.ts`:
  the decompression budget).

## Example

```ts
const counted = res.body!.pipeThrough(
  byteCountingStream((total) => {
    if (total > maxBytes)
      throw new ArchiveLimitError('archive-bytes', maxBytes, total);
  })
);
const blob = await new Response(counted).blob();
```

## Tests

`byte-counting-stream.test.ts`: chunks passed through with the running
totals, nothing of the refused chunk delivered, the source cancelled after
a refusal (never drained), the writer rejected with the same error, and a
property that the totals are the prefix sums of the chunk sizes.
