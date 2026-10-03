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
 */

import { ArchiveLimitError } from './archive-limits.js';

function announcedLength(headers: Headers): number | null {
  const raw = headers.get('content-length');
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function refuse(maxBytes: number, observed: number): never {
  throw new ArchiveLimitError('archive-bytes', maxBytes, observed);
}

/** The stream's chunks, cancelled the moment their sum passes the cap. */
async function readStreamCapped(
  body: ReadableStream<Uint8Array>,
  maxBytes: number
): Promise<Uint8Array[]> {
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return parts;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      refuse(maxBytes, total);
    }
    parts.push(value);
  }
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
  if (!res.body) {
    // No stream to count (Response-shaped fakes, some polyfills): the cap
    // still holds, after the fact.
    const blob = await res.blob();
    return blob.size > maxBytes ? refuse(maxBytes, blob.size) : blob;
  }
  const parts = await readStreamCapped(res.body, maxBytes);
  return new Blob(parts as BlobPart[], {
    type: res.headers.get('content-type') ?? '',
  });
}
