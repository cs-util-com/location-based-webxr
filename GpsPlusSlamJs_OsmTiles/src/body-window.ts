/**
 * Bounded views of a tile body: the inflated head of a gzip answer, and the
 * first and last bytes of a whole (possibly gzip) stream, without ever
 * holding the decoded tile in memory.
 *
 * @see body-window.ts.md
 */

/** Gzip bytes of an answer's start that are inflated for its head. */
const GZIP_HEAD_INPUT_BYTES = 16_384;

/**
 * The largest gzip answer a fill stores. The densest city tiles measured
 * were a few MB of gzip; this leaves wide room and still refuses a body
 * that no client should have to download.
 */
export const MAX_TILE_GZIP_BYTES = 20 * 2 ** 20;

/**
 * The largest decoded tile: what a fill accepts by the gzip trailer, a raw
 * answer by its length, and where a verify stops reading and calls the
 * tile bad. The densest measured tiles decode to a few tens of MB.
 */
export const MAX_TILE_DECODED_BYTES = 150 * 2 ** 20;

/** Thrown by `readBodyEnds` once the decoded stream passed its bound. */
export class BodyTooLarge extends Error {
  constructor(maxDecodedBytes: number) {
    super(`decoded body larger than ${String(maxDecodedBytes)} bytes`);
    this.name = "BodyTooLarge";
  }
}

/**
 * Thrown by `readBodyEnds` when reading the source stream itself failed
 * (a torn connection, a transient storage error). It says nothing about
 * the bytes, unlike a gzip error, so a caller must not judge a tile by it.
 */
export class SourceReadError extends Error {
  constructor(cause: unknown) {
    super(
      `source stream read failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "SourceReadError";
  }
}

/**
 * `stream` passed through unchanged, noting when a read of it fails. The
 * error a decoder downstream reports for a failed source differs between
 * runtimes, so the note, not that error, tells a read error from a decode
 * error.
 */
function watchReads(stream: ReadableStream<Uint8Array>): {
  readonly stream: ReadableStream<Uint8Array>;
  readonly failure: () => { readonly error: unknown } | undefined;
} {
  const reader = stream.getReader();
  let failure: { readonly error: unknown } | undefined;
  const watched = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (error) {
        failure = { error };
        controller.error(error);
        return;
      }
      if (result.done) controller.close();
      else controller.enqueue(result.value);
    },
    cancel(reason) {
      return reader.cancel(reason).catch(() => undefined);
    },
  });
  return { stream: watched, failure: () => failure };
}

/**
 * The decoded size a gzip stream declares in its trailer (ISIZE, the last
 * four bytes, little-endian), or undefined for bytes too short to be gzip.
 * It is the size modulo 2^32 and nothing checks it before the stream is
 * inflated, so a crafted stream can understate it; it bounds honest
 * answers for free, and the verify's decoded limit is the backstop.
 */
export function gzipDecodedSize(bytes: Uint8Array): number | undefined {
  // 10 header bytes, at least 2 of deflate data, 8 of trailer.
  if (bytes.length < 20) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(bytes.length - 4, true);
}

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
 * a cut gzip stream included, with `BodyTooLarge` (the stream cancelled)
 * once more than `maxDecodedBytes` came out, and with `SourceReadError`
 * when reading `stream` itself failed, whatever the decoder made of it.
 */
export async function readBodyEnds(
  stream: ReadableStream<Uint8Array>,
  gzip: boolean,
  headBytes: number,
  tailBytes: number,
  maxDecodedBytes = MAX_TILE_DECODED_BYTES,
): Promise<BodyEnds> {
  const source = watchReads(stream);
  const decoded: ReadableStream<Uint8Array> = gzip
    ? (source.stream as ReadableStream<BufferSource>).pipeThrough(
        new DecompressionStream("gzip"),
      )
    : source.stream;
  const reader = decoded.getReader();
  const head = new Uint8Array(headBytes);
  let headLength = 0;
  let tail = new Uint8Array(0);
  let decodedBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      decodedBytes += value.length;
      if (decodedBytes > maxDecodedBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BodyTooLarge(maxDecodedBytes);
      }
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
  } catch (error) {
    const failed = source.failure();
    throw failed === undefined ? error : new SourceReadError(failed.error);
  } finally {
    reader.releaseLock();
  }
  return { head: head.slice(0, headLength), tail };
}
