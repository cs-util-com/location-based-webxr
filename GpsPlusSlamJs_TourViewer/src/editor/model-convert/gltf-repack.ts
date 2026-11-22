/**
 * A `.gltf` and the files it names (`.bin` buffers, pictures, or `data:`
 * URIs inside it) repacked into the one self-contained `.glb` a tour may
 * carry. Lossless: no three.js, no re-encoding, every glTF field and
 * extension kept as written.
 *
 * - Every buffer view is kept at its index; only its `buffer` (now 0) and
 *   `byteOffset` change. The buffers are laid end to end in one binary
 *   chunk, each on a 4-byte boundary, so every accessor keeps its
 *   alignment. This is why the repack writes its own layout instead of
 *   `writeGlb`, which drops and renumbers views no accessor or image names
 *   and would break an unknown extension that names one.
 * - A picture named by URI is put into the chunk as a new view after the
 *   original ones, typed by its bytes (`image-sniff.ts`), and measured
 *   against the tour's pixel cap before anything could decode it.
 * - A picture that is missing, remote, outside the given files,
 *   undecodable, unreadable or of a kind a `.glb`
 *   cannot carry is left out with a note: the textures that show only
 *   left-out pictures are unlinked from the materials, and the image
 *   itself becomes a 1 x 1 placeholder, so no index anywhere changes.
 * - A buffer that is missing, remote, outside the given files or shorter
 *   than it says refuses the whole model, in words (`model-import-words`).
 *   A buffer must be where the model says (in some letter case); a picture
 *   may also be found by its file name alone. Every such guess is noted.
 *
 * The result passes `checkGlbInert` or is refused. Pure: no I/O, nothing
 * fetched; the same input gives the same bytes.
 *
 * @see gltf-repack.ts.md
 */

import {
  checkGlbInert,
  checkImageWithinCap,
  TOUR_MAX_IMAGE_PIXELS,
} from "gps-plus-slam-app-framework/ar/tour-media";
import { DEFAULT_ARCHIVE_LIMITS } from "gps-plus-slam-app-framework/storage";
import {
  decodeDataUri,
  isDataUri,
} from "gps-plus-slam-app-framework/utils/data-uri";

import {
  glbContainer,
  type GltfObject,
  indexOf,
  listOf,
  objectOf,
} from "../asset-shelf/glb-file.js";
import { ASSET_CEILING_BYTES } from "../tour-files.js";
import { resolveReference } from "./bundle-paths.js";
import { sniffImage } from "./image-sniff.js";
import { compressionOf, note, refusal } from "./model-import-words.js";

export interface RepackLimits {
  /** The `.gltf`'s text without its `data:` URIs. */
  readonly maxTextBytes: number;
  /** The `.gltf` file, and separately all its data together. */
  readonly maxBytes: number;
  readonly maxImagePixels: number;
}

const DEFAULT_REPACK_LIMITS: RepackLimits = Object.freeze({
  maxTextBytes: DEFAULT_ARCHIVE_LIMITS.maxTextEntryBytes,
  maxBytes: ASSET_CEILING_BYTES,
  maxImagePixels: TOUR_MAX_IMAGE_PIXELS,
});

export type RepackResult =
  | {
      readonly ok: true;
      readonly glb: Uint8Array<ArrayBuffer>;
      /** What was left out, in words; empty when nothing was. */
      readonly notes: readonly string[];
      /** The given files the model carries, besides the `.gltf` itself: a
       *  file that was left out (a picture of a kind a tour cannot carry,
       *  say) is not among them. */
      readonly used: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

/** The picture formats a repacked `.glb` carries, for the notes. */
const SHOWN = "PNG, JPEG, WebP and AVIF";

/** A valid 1 x 1 PNG: the stand-in for a picture that was left out. */
const PLACEHOLDER_PNG = ((): Uint8Array => {
  const read = decodeDataUri(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    128,
  );
  if (!read.ok) throw new Error("the placeholder picture does not decode");
  return read.bytes;
})();

const pad4 = (n: number) => (n + 3) & ~3;

const basenameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** The file name a URI ends in, for the words. */
function uriName(uri: string): string {
  const path = uri.replace(/[?#].*$/s, "").replace(/\\/g, "/");
  let name = basenameOf(path);
  try {
    name = decodeURIComponent(name);
  } catch {
    // kept as written
  }
  return name;
}

/** Thrown inside the repack and turned into `{ ok: false, reason }`. */
class Refusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "Refusal";
  }
}

type Fetched =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly file: string | null;
    }
  | { readonly ok: false; readonly why: string };

interface Context {
  readonly model: string;
  readonly path: string;
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly paths: readonly string[];
  readonly limits: RepackLimits;
  readonly used: Set<string>;
  /** What was left out or guessed, in words. */
  readonly notes: string[];
  /** Bytes of data taken so far, against `limits.maxBytes`. */
  budget: number;
}

/** `uri` percent-decoded where it can be, for the words. */
function decodedUri(uri: string): string {
  try {
    return decodeURIComponent(uri);
  } catch {
    return uri;
  }
}

/** The bytes `uri` names, or the kind of failure ("missing", "outside",
 *  "elsewhere", "scheme", "broken"), and the given file they came from
 *  (null for embedded data), which the caller marks as used once it keeps
 *  the bytes; an over-budget `data:` URI refuses at once. A file found
 *  other than by its exact path is noted. */
function fetchUri(ctx: Context, uri: string, byBasename: boolean): Fetched {
  const ref = resolveReference(uri, ctx.path, ctx.paths, { byBasename });
  if (ref.kind === "data") {
    const read = decodeDataUri(ref.uri, ctx.limits.maxBytes - ctx.budget);
    if (read.ok) return { ok: true, bytes: read.bytes, file: null };
    if (read.why === "too-large") {
      throw new Refusal(
        refusal.tooLarge(
          ctx.model,
          ctx.budget + read.size,
          ctx.limits.maxBytes,
        ),
      );
    }
    return { ok: false, why: "broken" };
  }
  if (ref.kind !== "file") return { ok: false, why: ref.kind };
  if (ref.match !== "exact") {
    ctx.notes.push(note.stoodIn(decodedUri(uri), ref.path));
  }
  return { ok: true, bytes: ctx.files.get(ref.path)!, file: ref.path };
}

/** Records `file` (null for embedded data) as one the model carries. */
function markUsed(ctx: Context, file: string | null): void {
  if (file !== null) ctx.used.add(file);
}

function take(ctx: Context, bytes: number): void {
  ctx.budget += bytes;
  if (ctx.budget > ctx.limits.maxBytes) {
    throw new Refusal(
      refusal.tooLarge(ctx.model, ctx.budget, ctx.limits.maxBytes),
    );
  }
}

/** The refusal for a buffer that could not be fetched, by why. */
function bufferRefusal(model: string, why: string, name: string): string {
  if (why === "scheme") return refusal.remotePart(model);
  if (why === "outside") return refusal.outsideFolder(model, name);
  if (why === "elsewhere") return refusal.otherComputer(model, name);
  if (why === "broken") return refusal.brokenPart(model);
  return refusal.missingFile(model, name);
}

/** Each buffer's bytes, cut to its `byteLength`. A buffer is never found
 *  by its file name alone: a wrong `.bin` would look like a broken model,
 *  with nothing to tell the creator why. */
function readBuffers(ctx: Context, json: GltfObject): Uint8Array[] {
  const list = listOf(json, "buffers");
  if (list === null) throw new Refusal(refusal.unreadable(ctx.model));
  return list.map((item) => {
    const buffer = objectOf(item);
    const length = indexOf(buffer?.["byteLength"]);
    const uri = buffer?.["uri"];
    if (length === null || typeof uri !== "string") {
      throw new Refusal(refusal.unreadable(ctx.model));
    }
    const fetched = fetchUri(ctx, uri, false);
    if (!fetched.ok) {
      throw new Refusal(bufferRefusal(ctx.model, fetched.why, uriName(uri)));
    }
    if (fetched.bytes.length < length) {
      throw new Refusal(
        isDataUri(uri)
          ? refusal.embeddedPartTooShort(ctx.model)
          : refusal.partTooShort(ctx.model, uriName(uri)),
      );
    }
    take(ctx, length);
    markUsed(ctx, fetched.file);
    return fetched.bytes.subarray(0, length);
  });
}

/** The pictures a texture names, by `source` (extension null) or by an
 *  extension's `source` (`EXT_texture_webp` and the like). */
function sourcesOf(
  texture: GltfObject,
): { extension: string | null; image: number }[] {
  const out: { extension: string | null; image: number }[] = [];
  const own = indexOf(texture["source"]);
  if (own !== null) out.push({ extension: null, image: own });
  const extensions = objectOf(texture["extensions"]) ?? {};
  for (const key of Object.keys(extensions)) {
    const image = indexOf(objectOf(extensions[key])?.["source"]);
    if (image !== null) out.push({ extension: key, image });
  }
  return out;
}

/** Unlinks from the materials every texture that names only left-out
 *  pictures (`leftOut`: image index to its label). A texture that still
 *  names another picture is kept: an extension naming a left-out one is
 *  dropped from it (its `source` keeps the placeholder as the fallback),
 *  and a note says another picture shows in its place. */
function unlinkLeftOut(
  json: GltfObject,
  leftOut: ReadonlyMap<number, string>,
  notes: string[],
): void {
  if (leftOut.size === 0) return;
  const unlinked = new Set<number>();
  (listOf(json, "textures") ?? []).forEach((item, t) => {
    const texture = objectOf(item);
    const sources = texture === null ? [] : sourcesOf(texture);
    const lost = sources.filter((s) => leftOut.has(s.image));
    if (lost.length === 0) return;
    if (lost.length === sources.length) {
      unlinked.add(t);
      return;
    }
    const extensions = objectOf(texture!["extensions"]);
    for (const { extension, image } of lost) {
      if (extension !== null) delete extensions![extension];
      const words = note.otherPictureShown(leftOut.get(image)!);
      if (!notes.includes(words)) notes.push(words);
    }
  });
  for (const material of listOf(json, "materials") ?? []) {
    unlinkTextures(material, unlinked);
  }
}

/** Removes from `value` (a material, recursively, `extras` aside) every
 *  texture reference `{ index }` to one of `textures`. */
function unlinkTextures(value: unknown, textures: ReadonlySet<number>): void {
  const object = objectOf(value);
  if (object === null) {
    if (Array.isArray(value)) value.forEach((v) => unlinkTextures(v, textures));
    return;
  }
  for (const key of Object.keys(object)) {
    if (key === "extras") continue;
    const child = objectOf(object[key]);
    const index = child === null ? null : indexOf(child["index"]);
    if (index !== null && textures.has(index)) {
      delete object[key];
    } else {
      unlinkTextures(object[key], textures);
    }
  }
}

/** The note for a picture that could not be fetched, by why. */
function pictureNote(why: string, name: string): string {
  if (why === "scheme") return note.remotePicture(name);
  if (why === "broken") return note.brokenPicture(name);
  if (why === "elsewhere") return note.otherComputerPicture(name);
  if (why === "outside") return note.outsidePicture(name);
  return note.missingPicture(name);
}

/** The pictures named by URI, as `[image, bytes, mime]` to embed; the
 *  ones left out are given the placeholder, noted, and unlinked where no
 *  other picture can stand in. */
function readImages(
  ctx: Context,
  json: GltfObject,
): [GltfObject, Uint8Array, string][] {
  const list = listOf(json, "images");
  if (list === null) throw new Refusal(refusal.unreadable(ctx.model));
  const out: [GltfObject, Uint8Array, string][] = [];
  const leftOut = new Map<number, string>();
  list.forEach((item, i) => {
    const image = objectOf(item);
    if (image === null) throw new Refusal(refusal.unreadable(ctx.model));
    if (!Object.hasOwn(image, "uri")) return;
    const uri = image["uri"];
    if (typeof uri !== "string")
      throw new Refusal(refusal.unreadable(ctx.model));
    const label = isDataUri(uri)
      ? typeof image["name"] === "string" && image["name"] !== ""
        ? image["name"]
        : `picture ${String(i + 1)}`
      : uriName(uri);
    const leaveOut = (words: string) => {
      ctx.notes.push(words);
      leftOut.set(i, label);
      out.push([image, PLACEHOLDER_PNG, "image/png"]);
    };
    const fetched = fetchUri(ctx, uri, true);
    if (!fetched.ok) return leaveOut(pictureNote(fetched.why, label));
    // Null is bytes no known picture starts with, or a known one whose
    // header is cut: broken and unknown cannot be told apart, so the note
    // claims neither. A known kind a .glb cannot carry is named as such.
    const sniffed = sniffImage(fetched.bytes);
    if (sniffed === null) return leaveOut(note.unreadablePicture(label));
    if (!sniffed.embeddable) {
      return leaveOut(note.unsupportedPicture(label, SHOWN));
    }
    const cap = checkImageWithinCap(fetched.bytes, ctx.limits.maxImagePixels);
    if (!cap.ok) {
      throw new Refusal(refusal.pictureTooLarge(ctx.model, label, cap.reason));
    }
    take(ctx, fetched.bytes.length);
    markUsed(ctx, fetched.file);
    out.push([image, fetched.bytes, sniffed.mime]);
  });
  unlinkLeftOut(json, leftOut, ctx.notes);
  return out;
}

/** Points every buffer view into the one chunk, buffer `b` starting at
 *  `starts[b]`; refuses a view outside its buffer. */
function rebaseViews(
  ctx: Context,
  json: GltfObject,
  buffers: readonly Uint8Array[],
  starts: readonly number[],
): void {
  const list = listOf(json, "bufferViews");
  if (list === null) throw new Refusal(refusal.unreadable(ctx.model));
  for (const item of list) {
    const view = objectOf(item);
    const buffer = indexOf(view?.["buffer"]);
    const offset = indexOf(view?.["byteOffset"] ?? 0);
    const length = indexOf(view?.["byteLength"]);
    if (
      view === null ||
      buffer === null ||
      offset === null ||
      length === null ||
      buffer >= buffers.length ||
      offset + length > buffers[buffer]!.length
    ) {
      throw new Refusal(refusal.unreadable(ctx.model));
    }
    view["buffer"] = 0;
    view["byteOffset"] = starts[buffer]! + offset;
  }
}

/** Why the parsed `json` is no glTF 2.0 model a tour can open, or null. */
function modelProblem(model: string, json: GltfObject | null): string | null {
  if (json === null) return refusal.unreadable(model);
  const version = objectOf(json["asset"])?.["version"];
  if (typeof version !== "string" || !/^2\.\d+$/.test(version)) {
    return refusal.notVersion2(model);
  }
  for (const key of ["extensionsUsed", "extensionsRequired"]) {
    const list = listOf(json, key);
    if (list === null) return refusal.unreadable(model);
    const kind = list.map(compressionOf).find((k) => k !== null);
    if (kind !== undefined && kind !== null) return refusal.compressed(kind);
  }
  return null;
}

/** The length of the text's `data:` URIs (buffers' and images'), which
 *  count against the data cap rather than the text cap. */
function dataUriLength(json: GltfObject): number {
  let total = 0;
  for (const key of ["buffers", "images"]) {
    for (const item of listOf(json, key) ?? []) {
      const uri = objectOf(item)?.["uri"];
      if (isDataUri(uri)) {
        total += uri.length;
      }
    }
  }
  return total;
}

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
/** The bytes of `data:`, lower case. */
const DATA_PREFIX = [0x64, 0x61, 0x74, 0x61, 0x3a];
/** ASCII letters' lower-case bit: `data` in any case matches with it set. */
const LOWER = 0x20;

/** The bytes inside the raw text's string literals that start with
 *  `data:` (in any letter case, as three.js reads the scheme), found
 *  without decoding or parsing anything. Every data URI is
 *  such a literal, so the text minus this is at most the text the exact
 *  count after parsing finds: a cap on it refuses nothing that count
 *  would pass, and runs before a parse that a structure-heavy text could
 *  make exhaust memory. */
function dataLiteralBytes(text: Uint8Array): number {
  let total = 0;
  let open = text.indexOf(QUOTE);
  while (open >= 0) {
    let close = text.indexOf(QUOTE, open + 1);
    while (close >= 0) {
      let slashes = 0;
      while (text[close - 1 - slashes] === BACKSLASH) slashes++;
      if (slashes % 2 === 0) break;
      close = text.indexOf(QUOTE, close + 1);
    }
    const end = close < 0 ? text.length : close;
    const startsData = DATA_PREFIX.every((byte, k) => {
      const at = text[open + 1 + k];
      return at !== undefined && (byte === 0x3a ? at : at | LOWER) === byte;
    });
    if (startsData) {
      total += end - open - 1;
    }
    open = close < 0 ? -1 : text.indexOf(QUOTE, close + 1);
  }
  return total;
}

/** Refuses when `textOnly` bytes of text are above the text cap. */
function capText(ctx: Context, textOnly: number): void {
  if (textOnly > ctx.limits.maxTextBytes) {
    throw new Refusal(
      refusal.textTooLarge(ctx.model, textOnly, ctx.limits.maxTextBytes),
    );
  }
}

function parse(text: Uint8Array): GltfObject | null {
  try {
    return objectOf(JSON.parse(new TextDecoder().decode(text)));
  } catch {
    return null;
  }
}

/** The `.gltf` at `gltfPath` in `files`, with every file it names, as one
 *  `.glb`; or the reason it cannot be, in words. */
export function repackGltf(
  gltfPath: string,
  files: ReadonlyMap<string, Uint8Array>,
  limits: Partial<RepackLimits> = {},
): RepackResult {
  const ctx: Context = {
    model: basenameOf(String(gltfPath).replace(/\\/g, "/")),
    path: gltfPath,
    files,
    paths: [...files.keys()],
    limits: { ...DEFAULT_REPACK_LIMITS, ...limits },
    used: new Set(),
    notes: [],
    budget: 0,
  };
  try {
    return repack(ctx);
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, reason: error.reason };
    throw error;
  }
}

function repack(ctx: Context): RepackResult {
  const text = ctx.files.get(ctx.path);
  if (text === undefined) throw new Refusal(refusal.unreadable(ctx.model));
  if (text.length > ctx.limits.maxBytes) {
    throw new Refusal(
      refusal.tooLarge(ctx.model, text.length, ctx.limits.maxBytes),
    );
  }
  capText(ctx, text.length - dataLiteralBytes(text));
  const json = parse(text);
  const problem = modelProblem(ctx.model, json);
  if (problem !== null || json === null) {
    throw new Refusal(problem ?? refusal.unreadable(ctx.model));
  }
  capText(ctx, text.length - dataUriLength(json));
  const buffers = readBuffers(ctx, json);
  const starts: number[] = [];
  let length = 0;
  for (const buffer of buffers) {
    starts.push(length);
    length = pad4(length + buffer.length);
  }
  rebaseViews(ctx, json, buffers, starts);
  const pictures = readImages(ctx, json);
  const views = listOf(json, "bufferViews") ?? [];
  const pictureStarts = pictures.map(([image, bytes, mime]) => {
    const start = length;
    image["bufferView"] = views.length;
    image["mimeType"] = mime;
    delete image["uri"];
    views.push({ buffer: 0, byteOffset: start, byteLength: bytes.length });
    length = pad4(length + bytes.length);
    return start;
  });
  if (views.length > 0) json["bufferViews"] = views;
  // No bytes and no view to name a buffer: no binary chunk and no buffer.
  const bin =
    length === 0 && views.length === 0 ? null : new Uint8Array(length);
  if (bin === null) {
    delete json["buffers"];
  } else {
    buffers.forEach((buffer, b) => bin.set(buffer, starts[b]));
    pictures.forEach(([, bytes], k) => bin.set(bytes, pictureStarts[k]));
    const first = { ...objectOf((listOf(json, "buffers") ?? [])[0]) };
    delete first["uri"];
    json["buffers"] = [{ ...first, byteLength: bin.length }];
  }
  const glb = glbContainer(json, bin);
  const inert = checkGlbInert(glb, {
    maxImagePixels: ctx.limits.maxImagePixels,
  });
  if (!inert.ok) throw new Refusal(refusal.notInert(ctx.model, inert.reason));
  return { ok: true, glb, notes: ctx.notes, used: [...ctx.used] };
}
