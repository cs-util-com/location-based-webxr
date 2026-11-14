/**
 * A `.glb` taken apart into its JSON and the bytes of each buffer view,
 * read as numbers where an optimizer needs them, and put back together
 * with only the buffer views something still names. The model optimizer's
 * passes (`model-textures.ts`, `model-quantize.ts`) work on these parts.
 *
 * Tours are untrusted input: the bytes must pass the tour's own check
 * (`checkGlbInert`) first, every range is checked against the binary
 * chunk, and a model this code does not fully understand (a glTF
 * extension outside `KNOWN_EXTENSIONS`, a second buffer) is kept as it is
 * rather than rewritten, since rewriting renumbers the buffer views and an
 * unknown extension may name one.
 *
 * @see glb-file.ts.md
 */

import { checkGlbInert } from "gps-plus-slam-app-framework/ar/tour-media";

/** A glTF JSON object, as parsed (untrusted: every field is checked where
 *  it is read). */
export type GltfObject = Record<string, unknown>;

export interface GlbParts {
  /** The model's JSON, the passes' to change. */
  readonly json: GltfObject;
  /** Each buffer view's bytes, by its index in `json.bufferViews`. */
  readonly views: Uint8Array[];
}

export type GlbRead =
  | { readonly ok: true; readonly parts: GlbParts }
  /** `unreadable`: the tour would refuse the file; `unsupported`: a valid
   *  model this code leaves as it is. */
  | {
      readonly ok: false;
      readonly why: "unreadable" | "unsupported";
      readonly reason: string;
    };

/** glTF extensions a rewrite keeps correct: none of them names a buffer
 *  view, so renumbering the views cannot break them. A `KHR_materials_`
 *  prefix covers the material family. */
const KNOWN_EXTENSIONS: ReadonlySet<string> = new Set([
  "KHR_texture_transform",
  "KHR_lights_punctual",
  "KHR_mesh_quantization",
  "KHR_animation_pointer",
  "KHR_xmp_json_ld",
  "EXT_texture_webp",
  "EXT_mesh_gpu_instancing",
]);

function isKnownExtension(name: unknown): boolean {
  return (
    typeof name === "string" &&
    (KNOWN_EXTENSIONS.has(name) || name.startsWith("KHR_materials_"))
  );
}

/** `json[key]` as a list: absent is empty; anything else that is no list
 *  is null (a malformed model). */
export function listOf(json: GltfObject, key: string): unknown[] | null {
  const value = json[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : null;
}

/** `value` as an object, or null. */
export function objectOf(value: unknown): GltfObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as GltfObject)
    : null;
}

/** A whole number at least 0, or null. */
export function indexOf(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : null;
}

function unsupported(reason: string): GlbRead {
  return { ok: false, why: "unsupported", reason };
}

/** Why the model's buffers are not exactly the GLB's own binary chunk, or
 *  null. */
function bufferProblem(json: GltfObject): string | null {
  const buffers = listOf(json, "buffers");
  if (buffers === null) return "its buffer list is malformed";
  if (buffers.length > 1) return "it keeps its data in more than one buffer";
  const only = objectOf(buffers[0]);
  if (buffers.length === 1 && (only === null || only["uri"] !== undefined)) {
    return "its data is not in the file's own binary chunk";
  }
  return null;
}

function extensionProblem(json: GltfObject): string | null {
  const used = listOf(json, "extensionsUsed");
  if (used === null) return "its extension list is malformed";
  const unknown = used.find((name) => !isKnownExtension(name));
  return unknown === undefined
    ? null
    : `it uses a glTF extension this optimizer does not know (${JSON.stringify(unknown)})`;
}

/** The binary chunk (empty when the model has none). The bytes passed
 *  `checkGlbInert`, so the chunk layout is already known to be sound. */
function binChunkOf(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = 20 + view.getUint32(12, true);
  if (at + 8 > bytes.length) return new Uint8Array(0);
  return bytes.subarray(at + 8, at + 8 + view.getUint32(at, true));
}

function jsonOf(bytes: Uint8Array): GltfObject {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parsed: unknown = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true))),
  );
  const json = objectOf(parsed);
  if (json === null) throw new Error("its JSON chunk is not an object");
  return json;
}

/** Each buffer view's bytes in `bin`, or the reason one does not fit. */
function viewsOf(json: GltfObject, bin: Uint8Array): Uint8Array[] | string {
  const list = listOf(json, "bufferViews");
  if (list === null) return "its buffer view list is malformed";
  const views: Uint8Array[] = [];
  for (const item of list) {
    const view = objectOf(item);
    const offset = indexOf(view?.["byteOffset"] ?? 0);
    const length = indexOf(view?.["byteLength"]);
    if (
      view === null ||
      view["buffer"] !== 0 ||
      offset === null ||
      length === null ||
      offset + length > bin.length
    ) {
      return "a buffer view lies outside the file's data";
    }
    views.push(bin.subarray(offset, offset + length));
  }
  return views;
}

/** `bytes` as parts, after the tour's own check. */
export function readGlb(bytes: Uint8Array): GlbRead {
  const inert = checkGlbInert(bytes);
  if (!inert.ok) return { ok: false, why: "unreadable", reason: inert.reason };
  let json: GltfObject;
  try {
    json = jsonOf(bytes);
  } catch {
    return { ok: false, why: "unreadable", reason: "its JSON does not parse" };
  }
  const problem = bufferProblem(json) ?? extensionProblem(json);
  if (problem !== null) return unsupported(problem);
  const views = viewsOf(json, binChunkOf(bytes));
  if (typeof views === "string") {
    return { ok: false, why: "unreadable", reason: views };
  }
  if (!namesOnlyViewsOf(json, views.length)) {
    return {
      ok: false,
      why: "unreadable",
      reason: "an accessor or image names a buffer view the file does not have",
    };
  }
  return { ok: true, parts: { json, views } };
}

/** Adds a buffer view holding `bytes` (with `fields` such as
 *  `byteStride` and `target`); its index. */
export function appendView(
  parts: GlbParts,
  bytes: Uint8Array,
  fields: GltfObject = {},
): number {
  const list = listOf(parts.json, "bufferViews") ?? [];
  parts.json["bufferViews"] = list;
  list.push({ ...fields, buffer: 0, byteLength: bytes.length });
  parts.views.push(bytes);
  return list.length - 1;
}

/** Every object of `json` that names a buffer view by `bufferView`: the
 *  accessors, their sparse parts and the images. */
function viewUsers(json: GltfObject): GltfObject[] {
  const users: GltfObject[] = [];
  for (const item of listOf(json, "accessors") ?? []) {
    const accessor = objectOf(item);
    if (accessor === null) continue;
    users.push(accessor);
    const sparse = objectOf(accessor["sparse"]);
    for (const part of [sparse?.["indices"], sparse?.["values"]]) {
      const named = objectOf(part);
      if (named !== null) users.push(named);
    }
  }
  for (const item of listOf(json, "images") ?? []) {
    const image = objectOf(item);
    if (image !== null) users.push(image);
  }
  return users;
}

/** Whether every `bufferView` an accessor, a sparse part or an image
 *  names is a whole number below `count`. A rewrite renumbers the views by
 *  these names, so one the file does not have would come out as nothing
 *  (or as a stale index) and the model would lose its geometry. */
function namesOnlyViewsOf(json: GltfObject, count: number): boolean {
  return viewUsers(json).every((user) => {
    const named = user["bufferView"];
    if (named === undefined) return true;
    const index = indexOf(named);
    return index !== null && index < count;
  });
}

const pad4 = (n: number) => (n + 3) & ~3;

/** The views still named, renumbered in their order, and laid out in one
 *  binary chunk (each start on a 4-byte boundary, as accessors need). */
function packViews(parts: GlbParts): {
  readonly views: GltfObject[];
  readonly bin: Uint8Array<ArrayBuffer>;
} {
  const users = viewUsers(parts.json).filter(
    (user) => indexOf(user["bufferView"]) !== null,
  );
  const named = new Set(users.map((user) => user["bufferView"] as number));
  const old = listOf(parts.json, "bufferViews") ?? [];
  const renumbered = new Map<number, number>();
  const views: GltfObject[] = [];
  let length = 0;
  for (let i = 0; i < old.length; i++) {
    if (!named.has(i)) continue;
    renumbered.set(i, views.length);
    const bytes = parts.views[i] ?? new Uint8Array(0);
    views.push({ ...objectOf(old[i]), buffer: 0, byteOffset: length });
    length = pad4(length + bytes.length);
  }
  const bin = new Uint8Array(length);
  for (const [from, to] of renumbered) {
    bin.set(parts.views[from] ?? [], views[to]!["byteOffset"] as number);
  }
  for (const user of users) {
    user["bufferView"] = renumbered.get(user["bufferView"] as number);
  }
  return { views, bin };
}

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** `parts` as a `.glb`: one JSON chunk and, when any view is still named,
 *  one binary chunk holding exactly those views. Views no accessor or
 *  image names are left out. `parts` is changed (the views renumbered). */
export function writeGlb(parts: GlbParts): Uint8Array<ArrayBuffer> {
  const { views, bin } = packViews(parts);
  const json = parts.json;
  if (views.length === 0) {
    delete json["bufferViews"];
    delete json["buffers"];
  } else {
    json["bufferViews"] = views;
    const first = objectOf((listOf(json, "buffers") ?? [])[0]) ?? {};
    json["buffers"] = [{ ...first, byteLength: bin.length }];
  }
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = pad4(text.length);
  const binPart = views.length === 0 ? 0 : 8 + bin.length;
  const out = new Uint8Array(12 + 8 + jsonLength + binPart);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(text, 20);
  out.fill(0x20, 20 + text.length, 20 + jsonLength);
  if (binPart > 0) {
    const at = 20 + jsonLength;
    view.setUint32(at, bin.length, true);
    view.setUint32(at + 4, CHUNK_BIN, true);
    out.set(bin, at + 8);
  }
  return out;
}

/** Bytes of one component, by glTF component type. */
const COMPONENT_BYTES: Readonly<Record<number, number>> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

/** Components per element, for the types an optimizer reads. */
const TYPE_SIZE: Readonly<Record<string, number>> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
};

export interface AccessorData {
  /** Components per element. */
  readonly size: number;
  readonly count: number;
  /** `count * size` values, normalized integers already turned into
   *  their -1..1 or 0..1 values. */
  readonly values: Float64Array;
}

type Reader = (view: DataView, at: number) => number;

const READERS: Readonly<Record<number, readonly [Reader, number]>> = {
  5120: [(v, at) => v.getInt8(at), 127],
  5121: [(v, at) => v.getUint8(at), 255],
  5122: [(v, at) => v.getInt16(at, true), 32767],
  5123: [(v, at) => v.getUint16(at, true), 65535],
  5125: [(v, at) => v.getUint32(at, true), 4294967295],
  5126: [(v, at) => v.getFloat32(at, true), 1],
};

/** The layout of accessor `index` (a dense one of a type in `TYPE_SIZE`
 *  whose elements all lie inside its view), or null. */
function layoutOf(
  parts: GlbParts,
  index: number,
): {
  readonly accessor: GltfObject;
  readonly bytes: Uint8Array;
  readonly size: number;
  readonly count: number;
  readonly stride: number;
  readonly offset: number;
} | null {
  const accessor = objectOf((listOf(parts.json, "accessors") ?? [])[index]);
  if (accessor === null || accessor["sparse"] !== undefined) return null;
  const viewIndex = indexOf(accessor["bufferView"]);
  const size = TYPE_SIZE[String(accessor["type"])];
  const component = COMPONENT_BYTES[Number(accessor["componentType"])];
  const count = indexOf(accessor["count"]);
  const offset = indexOf(accessor["byteOffset"] ?? 0);
  if (viewIndex === null || size === undefined || component === undefined) {
    return null;
  }
  const bytes = parts.views[viewIndex];
  const view = objectOf((listOf(parts.json, "bufferViews") ?? [])[viewIndex]);
  const stride = indexOf(view?.["byteStride"] ?? size * component);
  if (bytes === undefined || count === null || offset === null || !stride) {
    return null;
  }
  const end =
    count === 0 ? 0 : offset + stride * (count - 1) + size * component;
  return end <= bytes.length
    ? { accessor, bytes, size, count, stride, offset }
    : null;
}

/** Accessor `index`'s values, or null when it cannot be read here (no
 *  such accessor, sparse, a matrix type, no buffer view, or elements past
 *  the end of its view). */
export function readAccessor(
  parts: GlbParts,
  index: number,
): AccessorData | null {
  const layout = layoutOf(parts, index);
  if (layout === null) return null;
  const { accessor, bytes, size, count, stride, offset } = layout;
  const type = Number(accessor["componentType"]);
  const [read, max] = READERS[type]!;
  const normalized = accessor["normalized"] === true && type !== 5126;
  const component = COMPONENT_BYTES[type]!;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = new Float64Array(count * size);
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < size; c++) {
      const raw = read(view, offset + i * stride + c * component);
      values[i * size + c] = normalized ? Math.max(raw / max, -1) : raw;
    }
  }
  return { size, count, values };
}
