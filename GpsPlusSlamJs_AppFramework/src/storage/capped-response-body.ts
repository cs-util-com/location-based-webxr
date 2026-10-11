/**
 * A response body read whole, but never past a byte cap - the transport
 * half of the archive caps (`archive-limits.ts`).
 *
 * Two checks, because neither alone is enough:
 * - BEFORE reading: an announced `Content-Length` above the cap refuses
 *   the body without fetching it (the stream is cancelled, so the bytes
 *   never cross the wire beyond what the network already buffered);
 * - WHILE reading: the stream is counted chunk by chunk and cancelled the
 *   moment it passes the cap, because the header may be missing (chunked
 *   transfer) or lie.
 *
 * The count is a stream (`byte-counting-stream.ts`) feeding
 * `Response.blob()`, so no chunk is collected in page memory on the way
 * (K0 milestone review R5): the cap bounds the download, and the browser
 * assembles the Blob outside the JS heap.
 */

import { ArchiveLimitError } from './archive-limits.js';
import { byteCountingStream } from './byte-counting-stream.js';

function announcedLength(headers: Headers): number | null {
  const raw = headers.get('content-length');
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** `blob` with the response's type: `Response.blob()` types it from its
 *  own (absent) headers. A Blob over a Blob is a reference, not a copy. */
function typed(blob: Blob, type: string): Blob {
  return type === '' || blob.type === type ? blob : new Blob([blob], { type });
}

function refuse(maxBytes: number, observed: number): never {
  throw new ArchiveLimitError('archive-bytes', maxBytes, observed);
}

/**
 * The whole body as a Blob (typed by the response's `content-type`), or
 * an {@link ArchiveLimitError} of kind `archive-bytes` once it is, or
 * announces to be, larger than `maxBytes`.
 *
 * @throws RangeError for a cap that is not a positive safe integer.
 */
export async function readResponseBodyCapped(
  res: Response,
  maxBytes: number
): Promise<Blob> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError(
      `readResponseBodyCapped: cap must be a positive integer, got ${String(maxBytes)}`
    );
  }
  const announced = announcedLength(res.headers);
  if (announced !== null && announced > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    refuse(maxBytes, announced);
  }
  const type = res.headers.get('content-type') ?? '';
  if (!res.body) {
    // No stream to count (Response-shaped fakes, some polyfills): the cap
    // still holds, after the fact.
    const blob = await res.blob();
    return blob.size > maxBytes ? refuse(maxBytes, blob.size) : blob;
  }
  // Past the cap the counter throws: the pipe cancels the body with that
  // error and `blob()` rejects with it.
  const counted = res.body.pipeThrough(
    byteCountingStream((total) => {
      if (total > maxBytes) refuse(maxBytes, total);
    })
  );
  return typed(await new Response(counted).blob(), type);
}
