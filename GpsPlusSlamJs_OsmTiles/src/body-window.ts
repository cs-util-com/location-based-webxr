/**
 * Bounded views of a tile body: the inflated head of a gzip answer, and the
 * first and last bytes of a whole (possibly gzip) stream, without ever
 * holding the decoded tile in memory.
 *
 * @see body-window.ts.md
 */

/** Gzip bytes of an answer's start that are inflated for its head. */
const GZIP_HEAD_INPUT_BYTES = 16_384;

/** Whether `bytes` start with the gzip magic number (1f 8b). */
export function hasGzipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function concat(parts: readonly Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part.subarray(0, length - offset), offset);
    offset += Math.min(part.length, length - offset);
    if (offset >= length) break;
  }
  return out;
}

/**
 * The first `maxBytes` decoded bytes of a gzip body, inflating at most its
 * first GZIP_HEAD_INPUT_BYTES: the cost is bounded by these constants, not
 * by the tile. Rejects when those bytes are no valid gzip start; a stream
 * merely cut at the input bound is fine once `maxBytes` came out.
 */
export async function inflateHead(
  gzip: Uint8Array,
  maxBytes: number,
): Promise<Uint8Array> {
  const whole = gzip.length <= GZIP_HEAD_INPUT_BYTES;
  const input = gzip.subarray(0, GZIP_HEAD_INPUT_BYTES);
  const reader = new Blob([input as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (length < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      length += value.length;
    }
  } catch (error) {
    // The cut at the input bound ends the stream in an error; that is only
    // a fault when the whole body was given, or nothing came out at all.
    if (whole || length === 0) throw error;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return concat(parts, Math.min(length, maxBytes));
}

/** The first and last bytes of a decoded stream. */
export interface BodyEnds {
  readonly head: Uint8Array;
  readonly tail: Uint8Array;
}

/**
 * Reads `stream` to its end (inflating it first when `gzip`), keeping only
 * its first `headBytes` and its last `tailBytes`. Rejects on a gzip error,
 * a cut gzip stream included.
 */
export async function readBodyEnds(
  stream: ReadableStream<Uint8Array>,
  gzip: boolean,
  headBytes: number,
  tailBytes: number,
): Promise<BodyEnds> {
  const decoded: ReadableStream<Uint8Array> = gzip
    ? (stream as ReadableStream<BufferSource>).pipeThrough(
        new DecompressionStream("gzip"),
      )
    : stream;
  const reader = decoded.getReader();
  const head = new Uint8Array(headBytes);
  let headLength = 0;
  let tail = new Uint8Array(0);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (headLength < headBytes) {
        const take = Math.min(headBytes - headLength, value.length);
        head.set(value.subarray(0, take), headLength);
        headLength += take;
      }
      // The last `tailBytes` of what came so far, never more held.
      if (value.length >= tailBytes) {
        tail = value.slice(value.length - tailBytes);
      } else {
        const joined = new Uint8Array(tail.length + value.length);
        joined.set(tail);
        joined.set(value, tail.length);
        tail = joined.slice(Math.max(0, joined.length - tailBytes));
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { head: head.slice(0, headLength), tail };
}
