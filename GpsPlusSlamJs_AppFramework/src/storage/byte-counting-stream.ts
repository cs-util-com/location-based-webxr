/**
 * A pass-through stream that counts the bytes flowing through it - the one
 * counter behind every capped whole read (K0 milestone review R5).
 *
 * The capped reads used to collect each chunk in a JS array and build the
 * Blob at the end, so a 1 GiB cap was also up to 1 GiB of page memory. A
 * chunk that passes through here goes straight on - into
 * `new Response(stream).blob()`, which a browser assembles outside the JS
 * heap, or into whatever reads the stream - and is never kept.
 *
 * `onTotal` sees the running total after each non-empty chunk, BEFORE that
 * chunk is passed on; throwing refuses it. The error then reaches both
 * ends: whoever reads the stream, and whoever writes into it (a pipe
 * cancels its source with it; zip.js's `getData` rejects with it).
 */
export function byteCountingStream(
  onTotal: (total: number) => void
): TransformStream<Uint8Array, Uint8Array> {
  let total = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (chunk.byteLength === 0) return;
      total += chunk.byteLength;
      onTotal(total);
      controller.enqueue(chunk);
    },
  });
}
