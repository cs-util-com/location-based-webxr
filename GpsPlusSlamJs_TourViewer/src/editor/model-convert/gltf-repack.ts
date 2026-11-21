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
 * - A picture that is missing, remote, undecodable or of a kind a `.glb`
 *   cannot carry is left out with a note: the textures that show it are
 *   unlinked from the materials, and the image itself becomes a 1 x 1
 *   placeholder, so no index anywhere changes.
 * - A buffer that is missing, remote, outside the given files or shorter
 *   than it says refuses the whole model, in words (`model-import-words`).
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
  glbContainer,
  type GltfObject,
  indexOf,
  listOf,
  objectOf,
} from "../asset-shelf/glb-file.js";
import { ASSET_CEILING_BYTES } from "../tour-files.js";
import { resolveReference } from "./bundle-paths.js";
import { decodeDataUri } from "./data-uri.js";
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
      /** The given files the model used, besides the `.gltf` itself. */
      readonly used: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

/** The picture formats a repacked `.glb` carries, for the notes. */
const SHOWN = "PNG, JPEG, WebP and AVIF";

/** A valid 1 x 1 PNG: the stand-in for a picture that was left out. */
const PLACEHOLDER_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);

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
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly why: string };

interface Context {
  readonly model: string;
  readonly path: string;
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly paths: readonly string[];
  readonly limits: RepackLimits;
  readonly used: Set<string>;
  /** Bytes of data taken so far, against `limits.maxBytes`. */
  budget: number;
}

/** The bytes `uri` names, or the kind of failure ("missing", "outside",
 *  "scheme", "broken"); an over-budget `data:` URI refuses at once. */
function fetchUri(ctx: Context, uri: string): Fetched {
  const ref = resolveReference(uri, ctx.path, ctx.paths);
  if (ref.kind === "data") {
    const read = decodeDataUri(ref.uri, ctx.limits.maxBytes - ctx.budget);
    if (read.ok) return { ok: true, bytes: read.bytes };
    if (read.why === "too-large") {
      throw new Refusal(
        refusal.tooLarge(
          ctx.model,
          ctx.limits.maxBytes + 1,
          ctx.limits.maxBytes,
        ),
      );
    }
    return { ok: false, why: "broken" };
  }
  if (ref.kind !== "file") return { ok: false, why: ref.kind };
  ctx.used.add(ref.path);
  return { ok: true, bytes: ctx.files.get(ref.path)! };
}

function take(ctx: Context, bytes: number): void {
  ctx.budget += bytes;
  if (ctx.budget > ctx.limits.maxBytes) {
    throw new Refusal(
      refusal.tooLarge(ctx.model, ctx.budget, ctx.limits.maxBytes),
    );
  }
}

/** Each buffer's bytes, cut to its `byteLength`. */
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
    const fetched = fetchUri(ctx, uri);
    if (!fetched.ok) {
      const name = uriName(uri);
      throw new Refusal(
        fetched.why === "scheme"
          ? refusal.remotePart(ctx.model)
          : fetched.why === "outside"
            ? refusal.outsideFolder(ctx.model, name)
            : fetched.why === "broken"
              ? refusal.brokenPart(ctx.model)
              : refusal.missingFile(ctx.model, name),
      );
    }
    if (fetched.bytes.length < length) {
      throw new Refusal(refusal.partTooShort(ctx.model, uriName(uri)));
    }
    take(ctx, length);
    return fetched.bytes.subarray(0, length);
  });
}

/** The textures that show image `index`, by `source` or by an
 *  extension's `source` (`EXT_texture_webp` and the like). */
function texturesShowing(json: GltfObject, index: number): Set<number> {
  const out = new Set<number>();
  (listOf(json, "textures") ?? []).forEach((item, t) => {
    const texture = objectOf(item);
    if (texture === null) return;
    const sources = [texture["source"]];
    const extensions = objectOf(texture["extensions"]);
    for (const key of Object.keys(extensions ?? {})) {
      sources.push(objectOf(extensions![key])?.["source"]);
    }
    if (sources.some((s) => s === index)) out.add(t);
  });
  return out;
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
  return note.missingPicture(name);
}

/** The pictures named by URI, as `[image, bytes, mime]` to embed; the
 *  ones left out are unlinked, given the placeholder and noted. */
function readImages(
  ctx: Context,
  json: GltfObject,
  notes: string[],
): [GltfObject, Uint8Array, string][] {
  const list = listOf(json, "images");
  if (list === null) throw new Refusal(refusal.unreadable(ctx.model));
  const out: [GltfObject, Uint8Array, string][] = [];
  list.forEach((item, i) => {
    const image = objectOf(item);
    if (image === null) throw new Refusal(refusal.unreadable(ctx.model));
    if (!Object.hasOwn(image, "uri")) return;
    const uri = image["uri"];
    if (typeof uri !== "string")
      throw new Refusal(refusal.unreadable(ctx.model));
    const label = uri.startsWith("data:")
      ? typeof image["name"] === "string" && image["name"] !== ""
        ? image["name"]
        : `picture ${String(i + 1)}`
      : uriName(uri);
    const leaveOut = (words: string) => {
      notes.push(words);
      const textures = texturesShowing(json, i);
      for (const material of listOf(json, "materials") ?? []) {
        unlinkTextures(material, textures);
      }
      out.push([image, PLACEHOLDER_PNG, "image/png"]);
    };
    const fetched = fetchUri(ctx, uri);
    if (!fetched.ok) return leaveOut(pictureNote(fetched.why, label));
    const sniffed = sniffImage(fetched.bytes);
    if (sniffed === null || !sniffed.embeddable) {
      return leaveOut(note.unsupportedPicture(label, SHOWN));
    }
    const cap = checkImageWithinCap(fetched.bytes, ctx.limits.maxImagePixels);
    if (!cap.ok) {
      throw new Refusal(refusal.pictureTooLarge(ctx.model, label, cap.reason));
    }
    take(ctx, fetched.bytes.length);
    out.push([image, fetched.bytes, sniffed.mime]);
  });
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
      if (typeof uri === "string" && uri.startsWith("data:")) {
        total += uri.length;
      }
    }
  }
  return total;
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
  const json = parse(text);
  const problem = modelProblem(ctx.model, json);
  if (problem !== null || json === null) {
    throw new Refusal(problem ?? refusal.unreadable(ctx.model));
  }
  const textOnly = text.length - dataUriLength(json);
  if (textOnly > ctx.limits.maxTextBytes) {
    throw new Refusal(
      refusal.textTooLarge(ctx.model, textOnly, ctx.limits.maxTextBytes),
    );
  }
  const buffers = readBuffers(ctx, json);
  const starts: number[] = [];
  let length = 0;
  for (const buffer of buffers) {
    starts.push(length);
    length = pad4(length + buffer.length);
  }
  rebaseViews(ctx, json, buffers, starts);
  const notes: string[] = [];
  const pictures = readImages(ctx, json, notes);
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
  const bin =
    length === 0 && buffers.length === 0 ? null : new Uint8Array(length);
  buffers.forEach((buffer, b) => bin!.set(buffer, starts[b]));
  pictures.forEach(([, bytes], k) => bin!.set(bytes, pictureStarts[k]));
  if (bin === null) {
    delete json["buffers"];
  } else {
    const first = { ...objectOf((listOf(json, "buffers") ?? [])[0]) };
    delete first["uri"];
    json["buffers"] = [{ ...first, byteLength: bin.length }];
  }
  const glb = glbContainer(json, bin);
  const inert = checkGlbInert(glb, {
    maxImagePixels: ctx.limits.maxImagePixels,
  });
  if (!inert.ok) throw new Refusal(refusal.notInert(ctx.model, inert.reason));
  return { ok: true, glb, notes, used: [...ctx.used] };
}
