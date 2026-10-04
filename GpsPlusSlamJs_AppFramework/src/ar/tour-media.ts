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
 */

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

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"

export type GlbCheck = { ok: true } | { ok: false; reason: string };

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

function glbJson(bytes: Uint8Array): Record<string, unknown> | string {
  if (bytes.length < 20) return 'it is too short to be a .glb';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) return 'it is not a .glb file';
  if (view.getUint32(4, true) !== 2) return 'only glTF 2.0 is supported';
  const chunkLength = view.getUint32(12, true);
  if (
    view.getUint32(16, true) !== CHUNK_JSON ||
    20 + chunkLength > bytes.length
  ) {
    return 'its JSON chunk is missing or truncated';
  }
  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder().decode(bytes.subarray(20, 20 + chunkLength))
    );
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : 'its JSON chunk is not an object';
  } catch {
    return 'its JSON chunk does not parse';
  }
}

/**
 * Whether a `.glb` is self-contained and inert: glTF 2.0 binary, every
 * buffer and image either in the file's own binary chunk or a `data:` URI
 * (never a relative path or an http URL the page would fetch), and no
 * extension that needs a decoder from outside. The reason is plain words.
 */
export function checkGlbInert(bytes: Uint8Array): GlbCheck {
  const json = glbJson(bytes);
  if (typeof json === 'string') return { ok: false, reason: json };
  const problem =
    uriProblem('buffer', json['buffers']) ??
    uriProblem('image', json['images']) ??
    extensionProblem(json);
  return problem === null ? { ok: true } : { ok: false, reason: problem };
}
