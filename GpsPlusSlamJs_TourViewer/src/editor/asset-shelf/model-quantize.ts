/**
 * A model's geometry stored in fewer bytes, by `KHR_mesh_quantization`
 * (read by three.js and every common glTF viewer, no decoder): positions
 * as 16- or 8-bit integers inside the mesh's box, undone by a node
 * transform; normals and tangents as 8- or 16-bit unit vectors; texture
 * coordinates as 16- or 8-bit fractions; index lists of fewer than 65 535
 * vertices as 16-bit numbers (core glTF, no extension).
 *
 * The position transform is uniform (one scale for all three axes) so the
 * renderer's normal matrix stays a rotation. It goes on a NEW child node
 * that carries the mesh, so the parent's own transform, children,
 * animations and skin joints stay exactly as they were.
 *
 * Left as they are, so nothing a viewer shows can change:
 * - positions of a mesh with morph targets, a skin, a node extension (GPU
 *   instancing), or no node at all, and every attribute of a mesh with
 *   morph targets;
 * - an accessor something else also reads (an animation, a skin, a morph
 *   target, a second kind of attribute), a sparse one, one already of
 *   integers;
 * - texture coordinates outside 0..1 (they would need a texture
 *   transform);
 * - a group whose largest position error would exceed the error budget.
 *
 * @see model-quantize.ts.md
 */

import {
  appendView,
  type GlbParts,
  type GltfObject,
  indexOf,
  listOf,
  objectOf,
  readAccessor,
} from "./glb-file.js";

export interface QuantizeSettings {
  readonly positionBits: 8 | 16;
  readonly normalBits: 8 | 16;
  readonly texcoordBits: 8 | 16;
  /** The largest position error allowed, as a share of the box's
   *  diagonal; a mesh group over it keeps float positions. */
  readonly maxPositionError: number;
}

export interface QuantizeReport {
  /** Accessors stored as integers, by attribute. */
  readonly positions: number;
  readonly normals: number;
  readonly tangents: number;
  readonly texcoords: number;
  readonly indices: number;
  /** The largest position error of a quantized group, as a share of its
   *  box's diagonal (0 when none was quantized). */
  readonly positionError: number;
  /** The largest angle between a normal and its quantized form, degrees. */
  readonly normalErrorDeg: number;
  /** The largest texture coordinate error, as a fraction of the texture. */
  readonly texcoordError: number;
}

const FLOAT = 5126;
const UINT32 = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
/** Index 65 535 is WebGL 2's primitive restart for 16-bit lists. */
const MAX_UINT16_INDEX = 65534;

const KHR = "KHR_mesh_quantization";

type Role = "POSITION" | "NORMAL" | "TANGENT" | "TEXCOORD" | "INDEX" | "other";

function roleOf(semantic: string): Role {
  if (semantic === "POSITION" || semantic === "NORMAL") return semantic;
  if (semantic === "TANGENT") return semantic;
  return semantic.startsWith("TEXCOORD_") ? "TEXCOORD" : "other";
}

interface Primitive {
  readonly attributes: GltfObject;
  readonly indices: number | null;
}

interface Mesh {
  readonly primitives: readonly Primitive[];
  readonly morphed: boolean;
}

function meshesOf(json: GltfObject): Mesh[] {
  return (listOf(json, "meshes") ?? []).map((item) => {
    const prims = listOf(objectOf(item) ?? {}, "primitives") ?? [];
    const primitives = prims.flatMap((p) => {
      const prim = objectOf(p);
      const attributes = objectOf(prim?.["attributes"]);
      if (prim === null || attributes === null) return [];
      return [{ attributes, indices: indexOf(prim["indices"]) }];
    });
    const morphed = prims.some((p) => {
      const targets = objectOf(p)?.["targets"];
      return Array.isArray(targets) && targets.length > 0;
    });
    return { primitives, morphed };
  });
}

/** Each accessor's one role, or "other" when it has several, plus every
 *  accessor something besides a primitive's attributes reads. */
function rolesOf(json: GltfObject, meshes: readonly Mesh[]): Map<number, Role> {
  const roles = new Map<number, Role>();
  const take = (index: number | null, role: Role) => {
    if (index === null) return;
    const had = roles.get(index);
    roles.set(index, had === undefined || had === role ? role : "other");
  };
  for (const mesh of meshes) {
    for (const prim of mesh.primitives) {
      for (const [semantic, index] of Object.entries(prim.attributes)) {
        take(indexOf(index), mesh.morphed ? "other" : roleOf(semantic));
      }
      take(prim.indices, mesh.morphed ? "other" : "INDEX");
    }
  }
  for (const index of otherReaders(json)) take(index, "other");
  return roles;
}

/** Accessors read by animations, skins, morph targets and node
 *  extensions. */
function otherReaders(json: GltfObject): number[] {
  const found: number[] = [];
  const add = (value: unknown) => {
    const index = indexOf(value);
    if (index !== null) found.push(index);
  };
  for (const anim of listOf(json, "animations") ?? []) {
    for (const s of listOf(objectOf(anim) ?? {}, "samplers") ?? []) {
      add(objectOf(s)?.["input"]);
      add(objectOf(s)?.["output"]);
    }
  }
  for (const skin of listOf(json, "skins") ?? []) {
    add(objectOf(skin)?.["inverseBindMatrices"]);
  }
  for (const mesh of listOf(json, "meshes") ?? []) {
    for (const p of listOf(objectOf(mesh) ?? {}, "primitives") ?? []) {
      for (const target of listOf(objectOf(p) ?? {}, "targets") ?? []) {
        Object.values(objectOf(target) ?? {}).forEach(add);
      }
    }
  }
  for (const node of listOf(json, "nodes") ?? []) {
    collectIndices(objectOf(node)?.["extensions"], add);
  }
  return found;
}

/** Every whole number inside `value`, however deep (a node extension's
 *  accessor indices). */
function collectIndices(value: unknown, add: (v: unknown) => void): void {
  if (typeof value === "number") add(value);
  else if (Array.isArray(value)) value.forEach((v) => collectIndices(v, add));
  else if (objectOf(value) !== null) {
    Object.values(value as GltfObject).forEach((v) => collectIndices(v, add));
  }
}

/** A float accessor of `role` that nothing else reads, as data. */
function floatOf(
  parts: GlbParts,
  roles: ReadonlyMap<number, Role>,
  index: unknown,
  role: Role,
): {
  index: number;
  accessor: GltfObject;
  size: number;
  count: number;
  values: Float64Array;
} | null {
  const i = indexOf(index);
  if (i === null || roles.get(i) !== role) return null;
  const accessor = objectOf((listOf(parts.json, "accessors") ?? [])[i]);
  if (accessor?.["componentType"] !== FLOAT) return null;
  const data = readAccessor(parts, i);
  if (data === null || !data.values.every(Number.isFinite)) return null;
  return { index: i, accessor, ...data };
}

interface Packing {
  readonly type: number;
  readonly max: number;
  readonly bytes: 1 | 2;
}

const SIGNED: Readonly<Record<8 | 16, Packing>> = {
  8: { type: 5120, max: 127, bytes: 1 },
  16: { type: 5122, max: 32767, bytes: 2 },
};
const UNSIGNED: Readonly<Record<8 | 16, Packing>> = {
  8: { type: 5121, max: 255, bytes: 1 },
  16: { type: 5123, max: 65535, bytes: 2 },
};

/** `ints` (`size` per element) packed as `packing`, each element padded to
 *  4 bytes as vertex attributes must be; the view's stride. */
function packInts(
  ints: Int32Array,
  size: number,
  packing: Packing,
): { bytes: Uint8Array; stride: number } {
  const stride = (size * packing.bytes + 3) & ~3;
  const count = ints.length / size;
  const bytes = new Uint8Array(stride * count);
  const view = new DataView(bytes.buffer);
  const write =
    packing.bytes === 1
      ? (at: number, v: number) =>
          packing.type === 5120 ? view.setInt8(at, v) : view.setUint8(at, v)
      : (at: number, v: number) =>
          packing.type === 5122
            ? view.setInt16(at, v, true)
            : view.setUint16(at, v, true);
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < size; c++) {
      write(i * stride + c * packing.bytes, ints[i * size + c]!);
    }
  }
  return { bytes, stride };
}

/** Points `accessor` at `ints` as normalized integers of `packing`. */
function storeInts(
  parts: GlbParts,
  accessor: GltfObject,
  ints: Int32Array,
  size: number,
  packing: Packing,
): void {
  const { bytes, stride } = packInts(ints, size, packing);
  accessor["bufferView"] = appendView(parts, bytes, {
    byteStride: stride,
    target: ARRAY_BUFFER,
  });
  accessor["byteOffset"] = 0;
  accessor["componentType"] = packing.type;
  accessor["normalized"] = true;
  delete accessor["min"];
  delete accessor["max"];
}

const unitOf = (v: Float64Array, at: number): [number, number, number] => {
  const x = v[at]!;
  const y = v[at + 1]!;
  const z = v[at + 2]!;
  const length = Math.hypot(x, y, z);
  return length === 0 ? [0, 0, 0] : [x / length, y / length, z / length];
};

/** The angle between unit `a` and `b` scaled by 1/`max`, in degrees. */
function angleDeg(a: readonly number[], b: readonly number[]): number {
  const length = Math.hypot(b[0]!, b[1]!, b[2]!);
  if (length === 0) return 0;
  const dot = (a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) / length;
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
}

/** Normals or tangents (`size` 3 or 4, w kept as a sign) as unit vectors
 *  of `bits`; the largest angle error. */
function quantizeDirections(
  parts: GlbParts,
  data: NonNullable<ReturnType<typeof floatOf>>,
  bits: 8 | 16,
): number {
  const packing = SIGNED[bits];
  const { size, count, values } = data;
  const ints = new Int32Array(count * size);
  let worst = 0;
  for (let i = 0; i < count; i++) {
    const unit = unitOf(values, i * size);
    const q = unit.map((u) => Math.round(u * packing.max));
    ints.set(q, i * size);
    if (size === 4)
      ints[i * size + 3] = values[i * 4 + 3]! < 0 ? -packing.max : packing.max;
    worst = Math.max(worst, angleDeg(unit, q));
  }
  storeInts(parts, data.accessor, ints, size, packing);
  return worst;
}

const TEXCOORD_SLACK = 1e-6;

/** Texture coordinates within 0..1 as fractions of `bits`; the largest
 *  error, or null when one lies outside (left as floats). */
function quantizeTexcoords(
  parts: GlbParts,
  data: NonNullable<ReturnType<typeof floatOf>>,
  bits: 8 | 16,
): number | null {
  const { values } = data;
  const inRange = values.every(
    (v) => v >= -TEXCOORD_SLACK && v <= 1 + TEXCOORD_SLACK,
  );
  if (!inRange) return null;
  const packing = UNSIGNED[bits];
  const ints = new Int32Array(values.length);
  let worst = 0;
  for (let i = 0; i < values.length; i++) {
    const v = Math.min(1, Math.max(0, values[i]!));
    ints[i] = Math.round(v * packing.max);
    worst = Math.max(worst, Math.abs(ints[i]! / packing.max - values[i]!));
  }
  storeInts(parts, data.accessor, ints, data.size, packing);
  return worst;
}

/** 32-bit index lists that fit 16 bits, rewritten; how many. */
function narrowIndices(
  parts: GlbParts,
  meshes: readonly Mesh[],
  roles: ReadonlyMap<number, Role>,
): number {
  const done = new Set<number>();
  for (const prim of meshes.flatMap((m) => m.primitives)) {
    const i = prim.indices;
    if (i === null || done.has(i) || roles.get(i) !== "INDEX") continue;
    const accessor = objectOf((listOf(parts.json, "accessors") ?? [])[i]);
    if (accessor?.["componentType"] !== UINT32) continue;
    const data = readAccessor(parts, i);
    if (data === null || data.values.some((v) => v > MAX_UINT16_INDEX))
      continue;
    accessor["bufferView"] = appendView(
      parts,
      new Uint8Array(Uint16Array.from(data.values).buffer),
      { target: ELEMENT_ARRAY_BUFFER },
    );
    accessor["byteOffset"] = 0;
    accessor["componentType"] = 5123;
    done.add(i);
  }
  return done.size;
}

/** Meshes joined into groups that share a position accessor: a group
 *  shares one box, since one accessor can only be stored one way. */
function positionGroups(meshes: readonly Mesh[]): number[][] {
  const parent = meshes.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  const firstMesh = new Map<unknown, number>();
  meshes.forEach((mesh, m) => {
    for (const prim of mesh.primitives) {
      const position = prim.attributes["POSITION"];
      const other = firstMesh.get(position);
      if (other === undefined) firstMesh.set(position, m);
      else parent[find(m)] = find(other);
    }
  });
  const groups = new Map<number, number[]>();
  meshes.forEach((_, m) => {
    const root = find(m);
    groups.set(root, [...(groups.get(root) ?? []), m]);
  });
  return [...groups.values()];
}

/** The nodes that carry each mesh, by mesh index. */
function carriersOf(json: GltfObject): Map<number, GltfObject[]> {
  const carriers = new Map<number, GltfObject[]>();
  for (const item of listOf(json, "nodes") ?? []) {
    const node = objectOf(item);
    const mesh = indexOf(node?.["mesh"]);
    if (node === null || mesh === null) continue;
    carriers.set(mesh, [...(carriers.get(mesh) ?? []), node]);
  }
  return carriers;
}

/** Whether the group's positions may move into a box: every mesh drawn
 *  by a plain node (no skin, which ignores the node's transform; no node
 *  extension; no morph targets, whose offsets would need the same box). */
function movable(
  group: readonly number[],
  meshes: readonly Mesh[],
  carriers: ReadonlyMap<number, GltfObject[]>,
): boolean {
  return group.every((m) => {
    const nodes = carriers.get(m) ?? [];
    return (
      !meshes[m]!.morphed &&
      nodes.length > 0 &&
      nodes.every(
        (n) => n["skin"] === undefined && n["extensions"] === undefined,
      )
    );
  });
}

type FloatData = NonNullable<ReturnType<typeof floatOf>>;

/** The group's position accessors, or null when one cannot be stored as
 *  integers (another reader, sparse, not floats, no VEC3). */
function groupPositions(
  parts: GlbParts,
  roles: ReadonlyMap<number, Role>,
  group: readonly number[],
  meshes: readonly Mesh[],
): FloatData[] | null {
  const found = new Map<number, FloatData>();
  for (const prim of group.flatMap((m) => meshes[m]!.primitives)) {
    const position = prim.attributes["POSITION"];
    if (position === undefined) continue;
    const data = floatOf(parts, roles, position, "POSITION");
    if (data === null || data.size !== 3) return null;
    found.set(data.index, data);
  }
  return found.size > 0 ? [...found.values()] : null;
}

interface Box {
  readonly center: readonly [number, number, number];
  readonly scale: number;
  readonly diagonal: number;
}

function boxOf(data: readonly FloatData[]): Box | null {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const { values } of data) {
    for (let i = 0; i < values.length; i++) {
      min[i % 3] = Math.min(min[i % 3]!, values[i]!);
      max[i % 3] = Math.max(max[i % 3]!, values[i]!);
    }
  }
  const half = [0, 1, 2].map((c) => (max[c]! - min[c]!) / 2);
  const scale = Math.max(...half);
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  const center = [0, 1, 2].map((c) => (max[c]! + min[c]!) / 2);
  return {
    center: center as [number, number, number],
    scale,
    diagonal: 2 * Math.hypot(half[0]!, half[1]!, half[2]!),
  };
}

/** The group's positions as integers in its box, when the largest error
 *  stays within the budget; that error, or null when left as floats. */
function quantizePositions(
  parts: GlbParts,
  data: readonly FloatData[],
  box: Box,
  settings: QuantizeSettings,
): number | null {
  const packing = SIGNED[settings.positionBits];
  const step = box.scale / packing.max;
  const packed = data.map(({ values }) => {
    const ints = new Int32Array(values.length);
    let worst = 0;
    for (let i = 0; i < values.length; i += 3) {
      let squared = 0;
      for (let c = 0; c < 3; c++) {
        const q = Math.round((values[i + c]! - box.center[c]!) / step);
        ints[i + c] = Math.max(-packing.max, Math.min(packing.max, q));
        squared += (box.center[c]! + ints[i + c]! * step - values[i + c]!) ** 2;
      }
      worst = Math.max(worst, Math.sqrt(squared));
    }
    return { ints, worst };
  });
  const error = Math.max(...packed.map((p) => p.worst)) / box.diagonal;
  if (error > settings.maxPositionError) return null;
  data.forEach(({ accessor }, i) => {
    const { ints } = packed[i]!;
    storeInts(parts, accessor, ints, 3, packing);
    accessor["min"] = [0, 1, 2].map((c) => minOf(ints, c));
    accessor["max"] = [0, 1, 2].map((c) => maxOf(ints, c));
  });
  return error;
}

function minOf(ints: Int32Array, c: number): number {
  let m = Infinity;
  for (let i = c; i < ints.length; i += 3) m = Math.min(m, ints[i]!);
  return m;
}

function maxOf(ints: Int32Array, c: number): number {
  let m = -Infinity;
  for (let i = c; i < ints.length; i += 3) m = Math.max(m, ints[i]!);
  return m;
}

/** Moves each carrier's mesh onto a new child node that undoes the box
 *  (a normalized integer `v` stands for `center + scale * v`): the
 *  carrier keeps its own transform, children and animation. */
function addUndoNodes(
  json: GltfObject,
  group: readonly number[],
  carriers: ReadonlyMap<number, GltfObject[]>,
  box: Box,
): void {
  const nodes = listOf(json, "nodes") ?? [];
  json["nodes"] = nodes;
  for (const m of group) {
    for (const carrier of carriers.get(m) ?? []) {
      nodes.push({
        mesh: m,
        translation: [...box.center],
        scale: [box.scale, box.scale, box.scale],
      });
      delete carrier["mesh"];
      const children = listOf(carrier, "children") ?? [];
      carrier["children"] = [...children, nodes.length - 1];
    }
  }
}

function declare(json: GltfObject): void {
  for (const key of ["extensionsUsed", "extensionsRequired"]) {
    const list = listOf(json, key) ?? [];
    if (!list.includes(KHR)) json[key] = [...list, KHR];
  }
}

interface Tally {
  positions: number;
  normals: number;
  tangents: number;
  texcoords: number;
  positionError: number;
  normalErrorDeg: number;
  texcoordError: number;
}

/** Positions per group, then the remaining attributes per accessor. */
function quantizeAttributes(
  parts: GlbParts,
  meshes: readonly Mesh[],
  roles: ReadonlyMap<number, Role>,
  settings: QuantizeSettings,
): Tally {
  const tally: Tally = {
    positions: 0,
    normals: 0,
    tangents: 0,
    texcoords: 0,
    positionError: 0,
    normalErrorDeg: 0,
    texcoordError: 0,
  };
  const carriers = carriersOf(parts.json);
  for (const group of positionGroups(meshes)) {
    if (!movable(group, meshes, carriers)) continue;
    const data = groupPositions(parts, roles, group, meshes);
    const box = data === null ? null : boxOf(data);
    if (data === null || box === null) continue;
    const error = quantizePositions(parts, data, box, settings);
    if (error === null) continue;
    addUndoNodes(parts.json, group, carriers, box);
    tally.positions += data.length;
    tally.positionError = Math.max(tally.positionError, error);
  }
  const seen = new Set<number>();
  for (const prim of meshes.flatMap((m) => m.primitives)) {
    for (const [semantic, index] of Object.entries(prim.attributes)) {
      const role = roleOf(semantic);
      if (role === "POSITION") continue;
      const data = floatOf(parts, roles, index, role);
      if (data === null || seen.has(data.index)) continue;
      seen.add(data.index);
      quantizeOne(parts, data, role, settings, tally);
    }
  }
  return tally;
}

function quantizeOne(
  parts: GlbParts,
  data: FloatData,
  role: Role,
  settings: QuantizeSettings,
  tally: Tally,
): void {
  if (role === "NORMAL" && data.size === 3) {
    const error = quantizeDirections(parts, data, settings.normalBits);
    tally.normals++;
    tally.normalErrorDeg = Math.max(tally.normalErrorDeg, error);
  } else if (role === "TANGENT" && data.size === 4) {
    quantizeDirections(parts, data, settings.normalBits);
    tally.tangents++;
  } else if (role === "TEXCOORD" && data.size === 2) {
    const error = quantizeTexcoords(parts, data, settings.texcoordBits);
    if (error === null) return;
    tally.texcoords++;
    tally.texcoordError = Math.max(tally.texcoordError, error);
  }
}

/** Stores `parts`' geometry in fewer bytes (changed in place). */
export function quantizeModel(
  parts: GlbParts,
  settings: QuantizeSettings,
): QuantizeReport {
  const meshes = meshesOf(parts.json);
  const roles = rolesOf(parts.json, meshes);
  const tally = quantizeAttributes(parts, meshes, roles, settings);
  const indices = narrowIndices(parts, meshes, roles);
  if (tally.positions + tally.normals + tally.tangents + tally.texcoords > 0) {
    declare(parts.json);
  }
  return { ...tally, indices };
}
