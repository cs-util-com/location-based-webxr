/**
 * The media a tour archive may carry, as one allowlist of extensions and
 * MIME types (tour kit plan K0, review finding D12: content stays inert).
 *
 * A tour opens from any link, and its page runs on the same origin that
 * will later hold a creator's signing key (K2), so nothing in a tour may
 * be able to run as code there: raster images only (never SVG, which can
 * carry script), `.glb` only for models (one self-contained binary; no
 * external or http URIs, no extensions that need a decoder fetched from a
 * CDN), and the audio and video containers every current browser decodes
 * itself. Nothing here is ever served as HTML, XML or script. Pure: no I/O.
 *
 * A raster image is also measured from its header before anything decodes
 * it, against one pixel cap (`TOUR_MAX_IMAGE_PIXELS`), and so is every
 * image inside a `.glb`: a few kilobytes of crafted header can otherwise
 * make a phone allocate gigabytes (tour kit K4 review R2).
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

function uriProblem(owner: string, value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    const uri = (item as { uri?: unknown } | null)?.uri;
    if (uri === undefined) continue;
    if (typeof uri !== 'string' || !uri.startsWith('data:')) {
      return `a ${owner} points outside the file`;
    }
  }
  return null;
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
    uriProblem('buffer', json['buffers']) ??
    uriProblem('image', json['images']) ??
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

/** A buffer view's bytes in the binary chunk (buffer 0), or null. */
function bufferViewBytes(
  bin: Uint8Array | null,
  json: Record<string, unknown>,
  index: unknown
): Uint8Array | null {
  const views = json['bufferViews'];
  if (!Array.isArray(views) || !Number.isSafeInteger(index)) return null;
  const view = views[index as number] as
    | { buffer?: unknown; byteOffset?: unknown; byteLength?: unknown }
    | undefined;
  if (bin === null || view?.buffer !== 0) return null;
  const range = rangeIn(view.byteOffset ?? 0, view.byteLength, bin.length);
  return range === null ? null : bin.subarray(range[0], range[1]);
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

/** The bytes of one glTF image: its `data:` URI decoded (capped at the
 *  file's own length, `fileBytes`), or its buffer view in the binary
 *  chunk; null when they cannot be found. */
function imageBytes(
  bin: Uint8Array | null,
  json: Record<string, unknown>,
  image: unknown,
  fileBytes: number
): Uint8Array | null {
  const record = image as { uri?: unknown; bufferView?: unknown } | null;
  return typeof record?.uri === 'string'
    ? dataUriBytes(record.uri, fileBytes)
    : bufferViewBytes(bin, json, record?.bufferView);
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
