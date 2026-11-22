/**
 * The media a tour archive may carry, as one allowlist of extensions and
 * MIME types: tour content stays inert.
 *
 * A tour opens from any link, and its page runs on the same origin that
 * will later hold a creator's signing key, so nothing in a tour may
 * be able to run as code there: raster images only (never SVG, which can
 * carry script), `.glb` only for models (one self-contained binary; no
 * external or http URIs, no extensions that need a decoder fetched from a
 * CDN), and the audio and video containers every current browser decodes
 * itself. Nothing here is ever served as HTML, XML or script. Pure: no I/O.
 *
 * A raster image is also measured from its header before anything decodes
 * it, against one pixel cap (`TOUR_MAX_IMAGE_PIXELS`), and so is every
 * image inside a `.glb`: a few kilobytes of crafted header can otherwise
 * make a phone allocate gigabytes.
 */

import { decodeDataUri } from '../utils/data-uri.js';
import { readGlbChunks } from '../utils/glb-chunks.js';
import { imageInfo } from '../utils/image-header.js';

type TourMediaKind = 'image' | 'model' | 'audio' | 'video';

export interface TourMediaType {
  readonly kind: TourMediaKind;
  readonly mime: string;
}

/** Extension (lower case, without the dot) -> what it is. */
const TOUR_MEDIA_TYPES: Readonly<Record<string, TourMediaType>> = Object.freeze(
  {
    jpg: { kind: 'image', mime: 'image/jpeg' },
    jpeg: { kind: 'image', mime: 'image/jpeg' },
    png: { kind: 'image', mime: 'image/png' },
    webp: { kind: 'image', mime: 'image/webp' },
    gif: { kind: 'image', mime: 'image/gif' },
    avif: { kind: 'image', mime: 'image/avif' },
    glb: { kind: 'model', mime: 'model/gltf-binary' },
    mp3: { kind: 'audio', mime: 'audio/mpeg' },
    m4a: { kind: 'audio', mime: 'audio/mp4' },
    aac: { kind: 'audio', mime: 'audio/aac' },
    ogg: { kind: 'audio', mime: 'audio/ogg' },
    oga: { kind: 'audio', mime: 'audio/ogg' },
    opus: { kind: 'audio', mime: 'audio/ogg' },
    wav: { kind: 'audio', mime: 'audio/wav' },
    flac: { kind: 'audio', mime: 'audio/flac' },
    mp4: { kind: 'video', mime: 'video/mp4' },
    webm: { kind: 'video', mime: 'video/webm' },
  }
);

/** Every allowlisted extension, lower case. */
export const TOUR_MEDIA_EXTENSIONS: readonly string[] = Object.freeze(
  Object.keys(TOUR_MEDIA_TYPES)
);

/** The allowlisted type of a lower-case extension (no dot), or null. The
 *  match is exact: the writer emits lower case, and `JPG` is a different
 *  string, not a variant to be guessed at. */
export function tourMediaTypeOf(extension: string): TourMediaType | null {
  if (typeof extension !== 'string') return null;
  return Object.hasOwn(TOUR_MEDIA_TYPES, extension)
    ? TOUR_MEDIA_TYPES[extension]!
    : null;
}

/** The allowlisted type of an archive entry by its name's extension (case
 *  folded: a recording's `frame.JPG` is still a JPEG), or null. */
export function tourMediaTypeOfEntry(name: string): TourMediaType | null {
  if (typeof name !== 'string') return null;
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot < name.lastIndexOf('/')) return null;
  return tourMediaTypeOf(name.slice(dot + 1).toLowerCase());
}

/** glTF extensions that need a decoder the page would have to fetch (in
 *  practice from a CDN) - refused, so a model never pulls in code. */
const DECODER_EXTENSIONS: ReadonlySet<string> = new Set([
  'KHR_draco_mesh_compression',
  'EXT_meshopt_compression',
  'KHR_meshopt_compression',
  'KHR_texture_basisu',
]);

export type GlbCheck = { ok: true } | { ok: false; reason: string };

/**
 * The most pixels one tour image may have before it is decoded: 4096 x
 * 4096 (16.8 MP, 64 MiB once decoded to RGBA), also the largest canvas iOS
 * Safari allows. It admits a 12 MP phone photo (4032 x 3024) and a 4096 px
 * model texture; it refuses a 48 MP photo (8064 x 6048, 186 MiB decoded)
 * and an 8192 px texture (256 MiB). Swept in `tour-media.test.ts`
 * ("the cap sweep"): 4.2 MP would refuse ordinary phone photos, 33.6 MP
 * would let one decode take 128 MiB beside an AR session. What would
 * reverse it: a phone that cannot hold one 64 MiB decode next to its AR
 * session (unmeasured), or tours that need 8K textures.
 */
export const TOUR_MAX_IMAGE_PIXELS = 4096 * 4096;

/**
 * The most bytes a model's accessors may ask for together: 64 MiB (one
 * image decode at the pixel cap), or 8 times the file's length when that
 * is more. three.js allocates an accessor without a buffer view, and a
 * sparse one, as a new array of `count` elements, and uploads every
 * accessor to the GPU. Measured on 48 real models: the most any asked for
 * was 3.7 MB (17 times under the floor), and the highest ratio to its
 * file's length 3.69, for a 44 KB model (so at least 2.2 times under the
 * factor even without the floor). What would reverse it: a real model of
 * more than 8 MiB whose accessors ask for more than 8 times its length
 * (overlapping accessors, or many sparse morph targets).
 */
const ACCESSOR_BYTES_FLOOR = 64 * 2 ** 20;
const ACCESSOR_BYTES_PER_FILE_BYTE = 8;

/** Elements per accessor item, by glTF accessor type. */
const ITEM_SIZES: ReadonlyMap<unknown, number> = new Map([
  ['SCALAR', 1],
  ['VEC2', 2],
  ['VEC3', 3],
  ['VEC4', 4],
  ['MAT2', 4],
  ['MAT3', 9],
  ['MAT4', 16],
]);

/** Bytes per element, by glTF accessor component type. */
const COMPONENT_BYTES: ReadonlyMap<unknown, number> = new Map([
  [5120, 1],
  [5121, 1],
  [5122, 2],
  [5123, 2],
  [5125, 4],
  [5126, 4],
]);

/** The bytes one accessor asks three.js for (`count` items), or null when
 *  its count, type or component type cannot be read. */
function accessorBytes(accessor: unknown): number | null {
  const record = accessor as {
    count?: unknown;
    type?: unknown;
    componentType?: unknown;
  } | null;
  const size = ITEM_SIZES.get(record?.type);
  const bytes = COMPONENT_BYTES.get(record?.componentType);
  if (size === undefined || bytes === undefined) return null;
  return isIndex(record?.count)
    ? (record!.count as number) * size * bytes
    : null;
}

/** Why the model's accessors together ask for more memory than a phone
 *  should give a file `fileBytes` long, or null. `accessors` is a list
 *  or undefined. */
function accessorsProblem(
  accessors: unknown,
  fileBytes: number
): string | null {
  if (!Array.isArray(accessors)) return null;
  const cap = Math.max(
    ACCESSOR_BYTES_FLOOR,
    ACCESSOR_BYTES_PER_FILE_BYTE * fileBytes
  );
  let total = 0;
  for (const [i, accessor] of accessors.entries()) {
    const bytes = accessorBytes(accessor);
    if (bytes === null) return `its accessor ${String(i)} cannot be read`;
    total += bytes;
  }
  if (total <= cap) return null;
  const mib = (n: number) => String(Math.ceil(n / 2 ** 20));
  return `its accessors ask for ${mib(total)} MiB, more than a phone can safely hold for this file (${mib(cap)} MiB)`;
}

/** Whether an image's header states a size within `maxPixels`. An image
 *  whose size cannot be read from its first bytes is refused too: it is
 *  not decoded unmeasured. The reason is plain words. */
export function checkImageWithinCap(
  bytes: Uint8Array,
  maxPixels: number = TOUR_MAX_IMAGE_PIXELS
): GlbCheck {
  const info = imageInfo(bytes);
  if (info === null) {
    return { ok: false, reason: 'its size could not be read from its file' };
  }
  if (info.width * info.height > maxPixels) {
    return {
      ok: false,
      reason: `it is ${String(info.width)} x ${String(info.height)} pixels, more than a phone can safely decode (${String(maxPixels)} pixels)`,
    };
  }
  return { ok: true };
}

/** The URIs three.js reads as data rather than resolving them against
 *  its path and fetching them (`LoaderUtils.resolveURL`, three 0.170 to
 *  0.185): a comma is required and `.` matches no line break. */
const DATA_URI = /^data:.*,.*$/;

/** Why one of the lists three.js reads by key is not a list, or null.
 *  three reads `json.buffers[0]` from an object as readily as from an
 *  array, so an object would hide its entries from every check here. */
function listsProblem(json: Record<string, unknown>): string | null {
  for (const key of ['buffers', 'bufferViews', 'accessors', 'images']) {
    const value = json[key];
    if (value !== undefined && !Array.isArray(value)) {
      return `"${key}" is not a list`;
    }
  }
  return null;
}

/** Why a buffer or image would make three.js fetch from outside the file,
 *  or null. Only buffer 0 may leave out its `uri` (it is then the binary
 *  chunk); three.js resolves a later buffer without one to the empty URL
 *  and fetches the page itself. `value` is a list or undefined. */
function uriProblem(owner: string, value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const [i, item] of value.entries()) {
    const uri = (item as { uri?: unknown } | null)?.uri;
    if (uri === undefined && (owner === 'image' || i === 0)) continue;
    if (typeof uri !== 'string' || !DATA_URI.test(uri)) {
      return `a ${owner} points outside the file`;
    }
  }
  return null;
}

const isIndex = (value: unknown): boolean =>
  Number.isSafeInteger(value) && (value as number) >= 0;

/** Why a buffer view would make three.js load a buffer by a key that is no
 *  index (`"0"` is not buffer 0 to its `=== 0`, so it fetches the page),
 *  or null. Its `buffer` and every extension's `buffer` are checked: the
 *  meshopt plugin loads the buffer its extension names before it looks
 *  for a decoder, declared or not. */
function viewsProblem(views: unknown): string | null {
  if (!Array.isArray(views)) return null;
  for (const item of views) {
    const view = item as { buffer?: unknown; extensions?: unknown } | null;
    if (![view?.buffer, ...extensionBuffers(view?.extensions)].every(isIndex)) {
      return 'a buffer view names no buffer of the file';
    }
  }
  return null;
}

/** The `buffer` of every extension object in `extensions` that has one. */
function extensionBuffers(extensions: unknown): unknown[] {
  if (typeof extensions !== 'object' || extensions === null) return [];
  return Object.values(extensions)
    .filter(
      (extension): extension is { buffer?: unknown } =>
        typeof extension === 'object' &&
        extension !== null &&
        'buffer' in extension
    )
    .map((extension) => extension.buffer);
}

function extensionProblem(json: Record<string, unknown>): string | null {
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    const list = json[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) return `"${key}" is not a list`;
    const decoder = (list as unknown[]).find(
      (name): name is string =>
        typeof name === 'string' && DECODER_EXTENSIONS.has(name)
    );
    if (decoder !== undefined) return `it needs a decoder (${decoder})`;
  }
  return null;
}

/** Why the model's lists, URIs or buffer names would let three.js reach
 *  outside the file, or null. */
function referencesProblem(json: Record<string, unknown>): string | null {
  return (
    listsProblem(json) ??
    uriProblem('buffer', json['buffers']) ??
    viewsProblem(json['bufferViews']) ??
    uriProblem('image', json['images'])
  );
}

/**
 * Whether a `.glb` is self-contained and inert: glTF 2.0 binary of exactly
 * one JSON chunk, an optional binary chunk and nothing else (the shared
 * chunk reader, `utils/glb-chunks`, which also refuses the later chunks
 * three.js would read), every
 * buffer and image either in the file's own binary chunk or a `data:` URI
 * (never a relative path or an http URL the page would fetch), and no
 * extension that needs a decoder from outside. The reason is plain words.
 */
export function checkGlbInert(
  bytes: Uint8Array,
  options: { readonly maxImagePixels?: number } = {}
): GlbCheck {
  const chunks = readGlbChunks(bytes);
  if (!chunks.ok) return { ok: false, reason: chunks.reason };
  const { json, bin } = chunks;
  const problem =
    referencesProblem(json) ??
    accessorsProblem(json['accessors'], bytes.length) ??
    extensionProblem(json) ??
    imagesProblem(
      bin,
      json,
      options.maxImagePixels ?? TOUR_MAX_IMAGE_PIXELS,
      bytes.length
    );
  return problem === null ? { ok: true } : { ok: false, reason: problem };
}

/** A strict base64 `data:` URI's bytes, or null. The URI is part of the
 *  file, so its decoded bytes are never more than the file's own. */
function dataUriBytes(uri: string, fileBytes: number): Uint8Array | null {
  const read = decodeDataUri(uri, fileBytes);
  return read.ok ? read.bytes : null;
}

/** A buffer's bytes as three.js's GLTFLoader (`loadBuffer`) loads them:
 *  from its `data:` URI whenever it has a `uri` (buffer 0 too), from the
 *  binary chunk only for buffer 0 without one; null when neither reads. */
function bufferBytes(
  bin: Uint8Array | null,
  json: Record<string, unknown>,
  index: unknown,
  fileBytes: number
): Uint8Array | null {
  const buffers = json['buffers'];
  if (!Array.isArray(buffers) || !Number.isSafeInteger(index)) return null;
  const uri = (buffers[index as number] as { uri?: unknown } | null)?.uri;
  if (typeof uri === 'string') return dataUriBytes(uri, fileBytes);
  return index === 0 && uri === undefined ? bin : null;
}

/** A buffer view's bytes in the buffer three.js loads for it, or null. */
function bufferViewBytes(
  bin: Uint8Array | null,
  json: Record<string, unknown>,
  index: unknown,
  fileBytes: number
): Uint8Array | null {
  const views = json['bufferViews'];
  if (!Array.isArray(views) || !Number.isSafeInteger(index)) return null;
  const view = views[index as number] as
    | { buffer?: unknown; byteOffset?: unknown; byteLength?: unknown }
    | undefined;
  const buffer = bufferBytes(bin, json, view?.buffer, fileBytes);
  if (buffer === null || view === undefined) return null;
  const range = rangeIn(view.byteOffset ?? 0, view.byteLength, buffer.length);
  return range === null ? null : buffer.subarray(range[0], range[1]);
}

/** `[offset, offset + length]` when both are safe integers that fit in
 *  `size` bytes, else null. */
function rangeIn(
  offset: unknown,
  length: unknown,
  size: number
): readonly [number, number] | null {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)) {
    return null;
  }
  const start = offset as number;
  const end = start + (length as number);
  return start >= 0 && end >= start && end <= size ? [start, end] : null;
}

/** The bytes of one glTF image as three.js loads them: its buffer view
 *  whenever it names one (even beside a `uri`), else its `data:` URI
 *  decoded (capped at the file's own length, `fileBytes`); null when they
 *  cannot be found. */
function imageBytes(
  bin: Uint8Array | null,
  json: Record<string, unknown>,
  image: unknown,
  fileBytes: number
): Uint8Array | null {
  const record = image as { uri?: unknown; bufferView?: unknown } | null;
  if (record?.bufferView !== undefined) {
    return bufferViewBytes(bin, json, record.bufferView, fileBytes);
  }
  return typeof record?.uri === 'string'
    ? dataUriBytes(record.uri, fileBytes)
    : null;
}

/** Why one of the model's images may not be decoded, or null. The binary
 *  chunk is `bin` (null when the model has none); the whole file is
 *  `fileBytes` long, the cap on any image's decoded `data:` URI. */
function imagesProblem(
  bin: Uint8Array | null,
  json: Record<string, unknown>,
  maxPixels: number,
  fileBytes: number
): string | null {
  const images = json['images'];
  if (images === undefined) return null;
  if (!Array.isArray(images)) return '"images" is not a list';
  for (const [i, image] of images.entries()) {
    const data = imageBytes(bin, json, image, fileBytes);
    if (data === null) {
      return `its image ${String(i)} cannot be found in the file`;
    }
    const check = checkImageWithinCap(data, maxPixels);
    if (!check.ok) return `its image ${String(i)}: ${check.reason}`;
  }
  return null;
}
