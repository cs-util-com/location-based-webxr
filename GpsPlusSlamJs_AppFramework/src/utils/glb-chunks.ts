/**
 * The one reader of a `.glb`'s chunk layout: the 12-byte header, the JSON
 * chunk and the optional binary chunk, refused with plain words unless the
 * bytes are exactly the shape glTF 2.0 binary allows. Pure: no I/O, never
 * throws.
 *
 * Shared by the tour's inertness check (`ar/tour-media`) and the Tour
 * Viewer's model optimizer and its check page, so every reader of a model
 * agrees on which files are models at all.
 *
 * @see glb-chunks.ts.md
 */

/** "glTF", little-endian: the first four bytes of every `.glb`. */
export const GLB_MAGIC = 0x46546c67;
/** "JSON": the type of the first chunk. */
export const GLB_CHUNK_JSON = 0x4e4f534a;
/** "BIN\0": the type of the optional second chunk. */
export const GLB_CHUNK_BIN = 0x004e4942;

export type GlbChunksRead =
  | {
      readonly ok: true;
      /** The JSON chunk, parsed (an object; every field still untrusted). */
      readonly json: Record<string, unknown>;
      /** The binary chunk's bytes (a view into the input), or null when
       *  the file has none. */
      readonly bin: Uint8Array | null;
    }
  | { readonly ok: false; readonly reason: string };

/** Why the 12-byte header and the first chunk header are not a glTF 2.0
 *  binary opening with a JSON chunk that fits the data, or null. */
function headerProblem(view: DataView): string | null {
  if (view.byteLength < 20) return 'it is too short to be a .glb';
  if (view.getUint32(0, true) !== GLB_MAGIC) return 'it is not a .glb file';
  if (view.getUint32(4, true) !== 2) return 'only glTF 2.0 is supported';
  return view.getUint32(16, true) !== GLB_CHUNK_JSON ||
    20 + view.getUint32(12, true) > view.byteLength
    ? 'its JSON chunk is missing or truncated'
    : null;
}

/**
 * Where the binary chunk's data starts, or why the chunks after the JSON
 * chunk are not exactly one optional binary chunk and then the end, with
 * the header's length equal to the data's. three.js's loader walks EVERY
 * chunk and takes a later JSON chunk over the first, so a reader that
 * looked at the first chunk alone would pass a model whose second chunk
 * points outside the file.
 */
function binStart(
  view: DataView,
  jsonEnd: number
): number | null | { readonly reason: string } {
  if (view.getUint32(8, true) !== view.byteLength) {
    return { reason: 'its declared length does not match the file' };
  }
  let end = jsonEnd;
  let start: number | null = null;
  if (end + 8 <= view.byteLength) {
    if (view.getUint32(end + 4, true) !== GLB_CHUNK_BIN) {
      return {
        reason: 'it has a chunk other than one JSON and one binary chunk',
      };
    }
    start = end + 8;
    end = start + view.getUint32(end, true);
  }
  return end === view.byteLength
    ? start
    : {
        reason:
          'it has data past its last chunk, or a chunk that runs past the end',
      };
}

/** The chunks of `bytes`, or why they are not a well-formed `.glb`. A JSON
 *  chunk need not be padded to 4 bytes: three.js reads one that is not,
 *  and tours have always been allowed it. */
export function readGlbChunks(bytes: Uint8Array): GlbChunksRead {
  if (!(bytes instanceof Uint8Array)) {
    return { ok: false, reason: 'it is not a .glb file' };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = headerProblem(view);
  if (header !== null) return { ok: false, reason: header };
  const jsonEnd = 20 + view.getUint32(12, true);
  const start = binStart(view, jsonEnd);
  if (typeof start === 'object' && start !== null) {
    return { ok: false, reason: start.reason };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes.subarray(20, jsonEnd)));
  } catch {
    return { ok: false, reason: 'its JSON chunk does not parse' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'its JSON chunk is not an object' };
  }
  return {
    ok: true,
    json: parsed as Record<string, unknown>,
    bin: start === null ? null : bytes.subarray(start, bytes.length),
  };
}
