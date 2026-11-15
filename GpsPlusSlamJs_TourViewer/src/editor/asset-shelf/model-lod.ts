/**
 * A model's levels of detail, decided once when it is dropped on the
 * shelf: each primitive is ordered by the progressive simplifier
 * (`mesh-simplify.ts`), and the level the tour keeps (the author's level)
 * is the fewest triangles whose measured deviation (`mesh-distance.ts`)
 * stays within an error budget, or the share of triangles the author chose
 * on the shelf's slider. That level becomes the primitive's index list,
 * the vertex buffer is cut down to the vertices the saved levels use, and
 * a chain of up to four coarser levels follows it in one buffer view,
 * named in `primitive.extras.lod` (no glTF extension: a viewer that does
 * not read it draws the author's level).
 *
 * A skinned primitive's deviation is measured in its poses
 * (`skin-pose.ts`): the rest pose and up to three poses of its clips, the
 * largest deviation in any pose deciding. Without a clip only the rest
 * pose can be measured, so its default level keeps at least
 * `SKINNED_REST_SHARE` of its triangles.
 *
 * Left as they are, so nothing a viewer shows can change unseen:
 * - a skinned primitive whose poses do not read (its nodes, clips or skin
 *   malformed, a joint its skin does not have, no skin binding it);
 * - a primitive with morph targets, a mode other than triangles, an
 *   accessor another primitive (or anything else) also reads, an
 *   attribute this code cannot read, extras that are no object, or levels
 *   already saved;
 * - a primitive under the triangle floor.
 *
 * Runs in the optimizer's Worker, between the texture pass and
 * quantizing, while the positions are still floats.
 *
 * @see model-lod.ts.md
 */

import {
  appendView,
  gatherAccessor,
  type GlbParts,
  type GltfObject,
  indexOf,
  listOf,
  objectOf,
  readAccessor,
} from "./glb-file.js";
import { SurfaceGrid, surfaceDistance } from "./mesh-distance.js";
import {
  buildProgressive,
  levelIndices,
  type Progressive,
  remapAttribute,
  stepsFor,
  weldVertices,
} from "./mesh-simplify.js";
import {
  jointMatrices,
  type Poses,
  posesOf,
  skinPositions,
} from "./skin-pose.js";

export interface LodSettings {
  /** The default level's largest deviation allowed, as a share of the
   *  primitive's bounding box diagonal. */
  readonly lodBudget: number;
  /** A primitive with fewer triangles is left as it is. */
  readonly lodMinTriangles: number;
  /** The author's share of triangles kept (0..1), overriding the budget;
   *  left out, the budget decides. */
  readonly detailShare?: number;
}

/** One stop of the shelf's slider. */
export interface LodChoice {
  /** Share of the triangles kept. */
  readonly share: number;
  readonly triangles: number;
  /** The largest deviation at this share, as a share of the size. */
  readonly deviation: number;
}

export interface LodReport {
  /** Why part of the model was left as it is (a skinned primitive that
   *  could not be posed), or null. */
  readonly skipped: string | null;
  /** Primitives given levels. */
  readonly primitives: number;
  /** Their triangles before, and in the author's level. */
  readonly trianglesBefore: number;
  readonly trianglesAfter: number;
  /** The author's level's largest deviation, as a share of the size (the
   *  largest over the primitives, each against its own size). */
  readonly deviation: number;
  /** The largest primitive's bounding box diagonal, in model units. */
  readonly size: number;
  /** Whether the budget chose the level (not the author's share). */
  readonly automatic: boolean;
  /** The slider's stops, from all triangles down (empty when no primitive
   *  was given levels). */
  readonly choices: readonly LodChoice[];
}

/** Coarser levels saved after the author's level, at most. */
export const LOD_CHAIN_LEVELS = 4;
/** Samples a side: the slider's stops (an estimate shown before the
 *  author picks one), the search and the chain (quick probes), and the
 *  author's level's stored deviation (the number the shelf shows after). */
const LOD_STOP_SAMPLES = 2000;
const LOD_SEARCH_SAMPLES = 5000;
const LOD_CHECK_SAMPLES = 20000;
/** The slider's stops, as shares of the triangles kept. */
const LOD_SHARES: readonly number[] = [
  1, 0.75, 0.5, 0.35, 0.25, 0.18, 0.12, 0.08, 0.05, 0.03, 0.02, 0.01,
];
/** A chain level under this many triangles is not worth a draw range. */
const CHAIN_MIN_TRIANGLES = 64;
/** Halvings of the triangle count's log range in the budget search. */
const SEARCH_ROUNDS = 8;
/** Retries, each 15 % finer, when the search's level fails the check. */
const CHECK_RETRIES = 4;
/** The share of a skinned primitive's triangles its default level keeps
 *  at least when the model has no clip (only its rest pose measured). */
const SKINNED_REST_SHARE = 0.5;
/** What a change of skin weights costs in the simplifier's order, against
 *  a move of the whole box diagonal: collapses across bones are ordered
 *  late, so the levels the poses allow come early in the order. */
const SKIN_WEIGHT = 1;
const NOT_POSED =
  "a skinned mesh could not be posed (its bones, skin or clips do not read), so it was left as it is";

const ELEMENT_ARRAY_BUFFER = 34963;
const UINT16 = 5123;
const UINT32 = 5125;
const FLOAT = 5126;
/** Index 65 535 is WebGL 2's primitive restart for 16-bit lists. */
const MAX_UINT16_INDEX = 65534;

/** How often each accessor is read, by anything in the model. */
function accessorUses(json: GltfObject): Map<number, number> {
  const uses = new Map<number, number>();
  const add = (value: unknown) => {
    if (typeof value === "number") {
      const i = indexOf(value);
      if (i !== null) uses.set(i, (uses.get(i) ?? 0) + 1);
    } else if (Array.isArray(value)) value.forEach(add);
    else if (objectOf(value) !== null)
      Object.values(value as object).forEach(add);
  };
  for (const mesh of listOf(json, "meshes") ?? []) {
    for (const p of listOf(objectOf(mesh) ?? {}, "primitives") ?? []) {
      const prim = objectOf(p);
      add(prim?.["attributes"]);
      add(prim?.["indices"]);
      add(prim?.["targets"]);
      add(objectOf(objectOf(prim?.["extras"])?.["lod"])?.["indices"]);
    }
  }
  for (const node of listOf(json, "nodes") ?? []) {
    add(objectOf(node)?.["extensions"]);
  }
  return uses;
}

/** One shape a primitive's levels are measured in. */
interface Shape {
  /** Positions, in input vertex order. */
  readonly positions: Float32Array;
  /** Its box diagonal. */
  readonly diag: number;
}

interface Candidate {
  readonly prim: GltfObject;
  /** Accessor index by attribute name. */
  readonly attributes: ReadonlyMap<string, number>;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  /** A skinned primitive's shape in each pose; empty for a still one,
   *  which is measured as it is. */
  readonly shapes: readonly Shape[];
  /** Whether `shapes` holds a clip's pose. */
  readonly fromClips: boolean;
  /** Skin weights, 4 a vertex per set; none for a still primitive. */
  readonly weights: readonly Float64Array[];
}

function diagonalOf(p: Float32Array): number {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3]!, p[i]!);
    hi[i % 3] = Math.max(hi[i % 3]!, p[i]!);
  }
  return Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!);
}

/** How a model's primitives may be posed: the skins of the nodes that
 *  draw each mesh (-1 for a node without one, -2 for one that does not
 *  read), and its poses, read once on first use. */
interface Posing {
  readonly skinsOfMesh: ReadonlyMap<number, ReadonlySet<number>>;
  readonly poses: () => Poses | null;
}

function posingOf(parts: GlbParts): Posing {
  const skinsOfMesh = new Map<number, Set<number>>();
  for (const value of listOf(parts.json, "nodes") ?? []) {
    const node = objectOf(value);
    const mesh = indexOf(node?.["mesh"]);
    if (node === null || mesh === null) continue;
    const skin =
      node["skin"] === undefined ? -1 : (indexOf(node["skin"]) ?? -2);
    skinsOfMesh.set(mesh, (skinsOfMesh.get(mesh) ?? new Set()).add(skin));
  }
  let poses: Poses | null | undefined;
  return {
    skinsOfMesh,
    poses: () => {
      if (poses === undefined) poses = posesOf(parts);
      return poses;
    },
  };
}

/** A primitive's skin sets (`JOINTS_n` with `WEIGHTS_n`) as accessor
 *  index pairs; null when one lacks its partner or is no 4-vector. */
function skinSetsOf(
  parts: GlbParts,
  attributes: ReadonlyMap<string, number>,
): [number, number][] | null {
  const sets: [number, number][] = [];
  for (const name of attributes.keys()) {
    const joint = name.startsWith("JOINTS_");
    if (!joint && !name.startsWith("WEIGHTS_")) continue;
    const n = name.slice(name.indexOf("_") + 1);
    const joints = attributes.get(`JOINTS_${n}`);
    const weights = attributes.get(`WEIGHTS_${n}`);
    if (joints === undefined || weights === undefined) return null;
    if (joint) sets.push([joints, weights]);
  }
  const vec4 = (i: number) => readAccessor(parts, i)!.size === 4;
  return sets.every(([j, w]) => vec4(j) && vec4(w)) ? sets : null;
}

/** A skinned primitive's shape in each pose, or null when it cannot be
 *  posed: no one skin binds its mesh, or the poses or the skin do not
 *  read, or a pose collapses it to a point. */
function posedShapes(
  parts: GlbParts,
  mesh: number,
  positions: Float32Array,
  sets: readonly [number, number][],
  posing: Posing,
): Pick<Candidate, "shapes" | "fromClips" | "weights"> | null {
  const skins = posing.skinsOfMesh.get(mesh);
  const skin = skins?.size === 1 ? [...skins][0]! : -1;
  const poses = skin < 0 ? null : posing.poses();
  if (poses === null) return null;
  const joints = sets.map(([j]) => readAccessor(parts, j)!.values);
  const weights = sets.map(([, w]) => readAccessor(parts, w)!.values);
  const shapes: Shape[] = [];
  for (const worlds of poses.worlds) {
    const matrices = jointMatrices(parts, skin, worlds);
    if (matrices === null) return null;
    const posed = skinPositions(positions, joints, weights, matrices);
    if (posed === null) return null;
    const diag = diagonalOf(posed);
    if (!(diag > 0) || !Number.isFinite(diag)) return null;
    shapes.push({ positions: posed, diag });
  }
  return { shapes, fromClips: poses.fromClips, weights };
}

/** The primitive's attributes, when each is read by it alone and can be
 *  read here; null otherwise. */
function attributesOf(
  parts: GlbParts,
  prim: GltfObject,
  uses: ReadonlyMap<number, number>,
): Map<string, number> | null {
  const attributes = objectOf(prim["attributes"]);
  if (attributes === null) return null;
  const found = new Map<string, number>();
  for (const [name, value] of Object.entries(attributes)) {
    const index = indexOf(value);
    if (index === null || uses.get(index) !== 1) return null;
    if (readAccessor(parts, index) === null) return null;
    found.set(name, index);
  }
  return found;
}

/** `prim` (of mesh `mesh`) as a primitive this pass may give levels;
 *  null, or "not posed" for a skinned one that cannot be posed. */
function candidateOf(
  parts: GlbParts,
  mesh: number,
  prim: GltfObject,
  uses: ReadonlyMap<number, number>,
  minTriangles: number,
  posing: Posing,
): Candidate | "not posed" | null {
  if ((prim["mode"] ?? 4) !== 4) return null;
  const targets = prim["targets"];
  if (Array.isArray(targets) && targets.length > 0) return null;
  const extras = prim["extras"];
  if (extras !== undefined && objectOf(extras) === null) return null;
  if (objectOf(extras)?.["lod"] !== undefined) return null;
  const attributes = attributesOf(parts, prim, uses);
  const position = attributes?.get("POSITION");
  if (attributes === undefined || attributes === null || position === undefined)
    return null;
  const accessor = objectOf((listOf(parts.json, "accessors") ?? [])[position]);
  const data = readAccessor(parts, position)!;
  if (accessor?.["componentType"] !== FLOAT || data.size !== 3) return null;
  if (!data.values.every(Number.isFinite)) return null;
  const vertices = data.count;
  const indices = indicesOf(parts, prim, uses, vertices);
  if (indices === null || indices.length / 3 < minTriangles) return null;
  const sets = skinSetsOf(parts, attributes);
  if (sets === null) return null;
  const positions = Float32Array.from(data.values);
  const posed =
    sets.length === 0
      ? { shapes: [], fromClips: false, weights: [] }
      : posedShapes(parts, mesh, positions, sets, posing);
  if (posed === null) return "not posed";
  return { prim, attributes, positions, indices, ...posed };
}

/** The primitive's triangle list (0, 1, 2, ... when it has none), or
 *  null when it is shared, unreadable or names a vertex past `vertices`. */
function indicesOf(
  parts: GlbParts,
  prim: GltfObject,
  uses: ReadonlyMap<number, number>,
  vertices: number,
): Uint32Array | null {
  if (prim["indices"] === undefined) {
    if (vertices % 3 !== 0) return null;
    return Uint32Array.from({ length: vertices }, (_, i) => i);
  }
  const index = indexOf(prim["indices"]);
  if (index === null || uses.get(index) !== 1) return null;
  const data = readAccessor(parts, index);
  if (data === null || data.size !== 1 || data.count % 3 !== 0) return null;
  if (data.values.some((v) => !Number.isInteger(v) || v < 0 || v >= vertices))
    return null;
  return Uint32Array.from(data.values);
}

/** One primitive ordered once: its levels' deviations, measured on
 *  demand and kept. */
interface Ordered {
  readonly prog: Progressive;
  /** Input vertex of each welded vertex. */
  readonly first: Uint32Array;
  /** A level's largest deviation as a share of `prog.diag`. */
  readonly deviation: (steps: number, samples: number) => number;
}

function floatsOf(parts: GlbParts, index: number | undefined, size: number) {
  if (index === undefined) return undefined;
  const data = readAccessor(parts, index);
  return data?.size === size ? Float32Array.from(data.values) : undefined;
}

function order(parts: GlbParts, c: Candidate): Ordered {
  const normal = floatsOf(parts, c.attributes.get("NORMAL"), 3);
  const uv = floatsOf(parts, c.attributes.get("TEXCOORD_0"), 2);
  // every other attribute must match exactly for two copies to merge
  const exact = [...c.attributes]
    .filter(([name]) => !["POSITION", "NORMAL", "TEXCOORD_0"].includes(name))
    .map(([, index]) => Float32Array.from(readAccessor(parts, index)!.values));
  const weld = weldVertices(
    {
      position: c.positions,
      exact,
      ...(uv === undefined ? {} : { uv }),
      ...(normal === undefined ? {} : { normal }),
    },
    c.indices,
  );
  const positions = remapAttribute(c.positions, 3, weld);
  const prog = buildProgressive(
    {
      positions,
      indices: weld.indices,
      attributes: [
        ...(uv === undefined
          ? []
          : [{ data: remapAttribute(uv, 2, weld), size: 2, weight: 1 }]),
        ...c.weights.map((w) => ({
          data: remapAttribute(Float32Array.from(w), 4, weld),
          size: 4,
          weight: SKIN_WEIGHT,
        })),
      ],
    },
    {
      ...(normal === undefined
        ? {}
        : { normals: remapAttribute(normal, 3, weld) }),
    },
  );
  const shapes =
    c.shapes.length === 0
      ? [{ positions, diag: prog.diag }]
      : c.shapes.map((s) => ({
          positions: remapAttribute(s.positions, 3, weld),
          diag: s.diag,
        }));
  const grids = shapes.map((s) => new SurfaceGrid(s.positions, weld.indices));
  const measured = new Map<string, number>();
  // the largest deviation in any of the shapes, each against its own size
  const deviation = (steps: number, samples: number) => {
    if (steps <= 0) return 0;
    const key = `${steps}:${samples}`;
    let d = measured.get(key);
    if (d === undefined) {
      const level = levelIndices(prog, steps);
      d = Math.max(
        ...shapes.map(
          (s, k) =>
            surfaceDistance(
              s.positions,
              weld.indices,
              s.positions,
              level,
              samples,
              grids[k],
            ).max / s.diag,
        ),
      );
      measured.set(key, d);
    }
    return d;
  };
  return { prog, first: weld.first, deviation };
}

/** The last step that leaves a triangle: an open patch can collapse to
 *  nothing, and no saved level may be empty. */
function lastStep(prog: Progressive): number {
  let s = prog.stepAlive.length - 1;
  while (s > 0 && prog.stepAlive[s] === 0) s--;
  return s;
}

/** `stepsFor`, never past `lastStep`. */
const stepsTo = (prog: Progressive, triangles: number) =>
  Math.min(stepsFor(prog, triangles), lastStep(prog));

/** The most steps whose level stays within `budget`: a search on the
 *  triangle count's log scale with quick probes, then a check of its
 *  answer with the full sampling, stepping finer while that fails. */
function automaticSteps(o: Ordered, budget: number): number {
  const { prog } = o;
  const within = (steps: number, samples: number) =>
    o.deviation(steps, samples) <= budget;
  let found = 0;
  if (within(lastStep(prog), LOD_SEARCH_SAMPLES)) found = lastStep(prog);
  else {
    let fine = prog.triangleCount;
    let coarse = Math.max(1, prog.stepAlive[lastStep(prog)]!);
    for (let r = 0; r < SEARCH_ROUNDS; r++) {
      const mid = Math.sqrt(fine * coarse);
      const steps = stepsTo(prog, Math.round(mid));
      if (within(steps, LOD_SEARCH_SAMPLES)) {
        found = Math.max(found, steps);
        fine = mid;
      } else coarse = mid;
    }
  }
  for (let r = 0; found > 0 && r < CHECK_RETRIES; r++) {
    if (within(found, LOD_CHECK_SAMPLES)) return found;
    found = stepsTo(prog, Math.round(prog.stepAlive[found]! * 1.15));
  }
  return found > 0 && within(found, LOD_CHECK_SAMPLES) ? found : 0;
}

/** The most steps that keep at least `share` of the triangles. */
function stepsKeeping(prog: Progressive, share: number): number {
  const least = Math.ceil(share * prog.triangleCount);
  let s = stepsTo(prog, least);
  while (s > 0 && prog.stepAlive[s]! < least) s--;
  return s;
}

function authorSteps(o: Ordered, c: Candidate, settings: LodSettings): number {
  const share = settings.detailShare;
  if (share === undefined || !Number.isFinite(share)) {
    const steps = automaticSteps(o, settings.lodBudget);
    const restOnly = c.weights.length > 0 && !c.fromClips;
    return restOnly
      ? Math.min(steps, stepsKeeping(o.prog, SKINNED_REST_SHARE))
      : steps;
  }
  const kept = Math.min(1, Math.max(0, share));
  return stepsTo(o.prog, Math.round(kept * o.prog.triangleCount));
}

interface Level {
  readonly steps: number;
  readonly error: number;
}

/** A stored deviation, to four significant digits. */
const stored = (d: number) => Number(d.toPrecision(4));

/** The author's level and up to `LOD_CHAIN_LEVELS` coarser ones, each at
 *  about half the triangles of the one before. A level's error never reads
 *  below a finer one's (sampling noise is clamped), so a renderer may walk
 *  the chain one way. */
function chainOf(o: Ordered, author: number): Level[] {
  const { prog } = o;
  const levels: Level[] = [
    { steps: author, error: stored(o.deviation(author, LOD_CHECK_SAMPLES)) },
  ];
  const top = prog.stepAlive[author]!;
  let previous = top;
  for (let k = 1; k <= LOD_CHAIN_LEVELS; k++) {
    const target = Math.floor(top / 2 ** k);
    if (target < CHAIN_MIN_TRIANGLES) break;
    const steps = stepsTo(prog, target);
    if (prog.stepAlive[steps]! >= previous) break;
    previous = prog.stepAlive[steps]!;
    const error = stored(o.deviation(steps, LOD_SEARCH_SAMPLES));
    levels.push({ steps, error: Math.max(error, levels.at(-1)!.error) });
  }
  return levels;
}

/** The levels as index lists into the compacted vertex buffer, and the
 *  input vertices kept, in their order. */
function compact(
  o: Ordered,
  levels: readonly Level[],
  vertices: number,
): { readonly lists: Uint32Array[]; readonly keep: Uint32Array } {
  const lists = levels.map((l) => {
    const welded = levelIndices(o.prog, l.steps);
    return welded.map((w) => o.first[w]!);
  });
  const used = new Uint8Array(vertices);
  for (const list of lists) for (const v of list) used[v] = 1;
  const renumber = new Int32Array(vertices).fill(-1);
  const keep: number[] = [];
  for (let v = 0; v < vertices; v++) {
    if (used[v] === 1) {
      renumber[v] = keep.length;
      keep.push(v);
    }
  }
  return {
    lists: lists.map((list) => list.map((v) => renumber[v]!)),
    keep: Uint32Array.from(keep),
  };
}

/** Writes the levels into the primitive: its attributes cut down to
 *  `keep`, its index list the author's level, the chain after it in the
 *  same view, and `extras.lod` naming the chain. */
function save(
  parts: GlbParts,
  c: Candidate,
  levels: readonly Level[],
  lists: readonly Uint32Array[],
  keep: Uint32Array,
): void {
  for (const index of c.attributes.values()) {
    if (!gatherAccessor(parts, index, keep)) {
      throw new Error("an attribute checked as readable could not be cut down");
    }
  }
  const total = lists.reduce((n, l) => n + l.length, 0);
  const narrow = keep.length - 1 <= MAX_UINT16_INDEX;
  const all = narrow ? new Uint16Array(total) : new Uint32Array(total);
  const ranges: { start: number; count: number; error: number }[] = [];
  let at = 0;
  lists.forEach((list, l) => {
    all.set(list, at);
    ranges.push({ start: at, count: list.length, error: levels[l]!.error });
    at += list.length;
  });
  const view = appendView(parts, new Uint8Array(all.buffer), {
    target: ELEMENT_ARRAY_BUFFER,
  });
  const componentType = narrow ? UINT16 : UINT32;
  const accessors = listOf(parts.json, "accessors") ?? [];
  parts.json["accessors"] = accessors;
  const own = indexOf(c.prim["indices"]);
  const fields = { bufferView: view, byteOffset: 0, componentType };
  const authorCount = lists[0]!.length;
  if (own === null) {
    accessors.push({ ...fields, type: "SCALAR", count: authorCount });
    c.prim["indices"] = accessors.length - 1;
  } else {
    const accessor = objectOf(accessors[own])!;
    Object.assign(accessor, fields, { count: authorCount });
    delete accessor["min"];
    delete accessor["max"];
  }
  accessors.push({ ...fields, type: "SCALAR", count: total });
  c.prim["extras"] = {
    ...objectOf(c.prim["extras"]),
    lod: { indices: accessors.length - 1, levels: ranges },
  };
}

function choicesOf(o: Ordered): LodChoice[] {
  return LOD_SHARES.map((share) => {
    const steps = stepsTo(o.prog, Math.round(share * o.prog.triangleCount));
    return {
      share,
      triangles: o.prog.stepAlive[steps]!,
      deviation: stored(o.deviation(steps, LOD_STOP_SAMPLES)),
    };
  });
}

/** Bytes of an index component, by glTF component type. */
const INDEX_BYTES: Readonly<Record<number, number>> = {
  5121: 1,
  5123: 2,
  5125: 4,
};

/** A primitive's saved levels as whole ranges, or null when they do not
 *  read. */
function rangesOf(lod: GltfObject): { start: number; count: number }[] | null {
  const levels = lod["levels"];
  if (!Array.isArray(levels) || levels.length === 0) return null;
  const ranges = levels.map((value) => {
    const level = objectOf(value);
    const start = level?.["start"];
    const count = level?.["count"];
    return Number.isInteger(start) && Number.isInteger(count)
      ? { start: start as number, count: count as number }
      : null;
  });
  return ranges.every((r) => r !== null) ? ranges : null;
}

/** Drops the coarsest saved level of every primitive with a chain, and
 *  the chain itself (`extras.lod`) where only the author's level would be
 *  left; the chain's index list and its buffer view are cut to the levels
 *  kept, so the dropped levels' bytes leave the file. The author's level
 *  (the primitive's index list) is never touched. Whether anything was
 *  dropped. */
export function dropCoarsestLevel(parts: GlbParts): boolean {
  const accessors = listOf(parts.json, "accessors") ?? [];
  const views = listOf(parts.json, "bufferViews") ?? [];
  let dropped = false;
  for (const mesh of listOf(parts.json, "meshes") ?? []) {
    for (const p of listOf(objectOf(mesh) ?? {}, "primitives") ?? []) {
      const prim = objectOf(p);
      const extras = objectOf(prim?.["extras"]);
      const lod = objectOf(extras?.["lod"]);
      const ranges = lod === null ? null : rangesOf(lod);
      const chain = indexOf(lod?.["indices"]);
      const accessor = chain === null ? null : objectOf(accessors[chain]);
      const bytes = INDEX_BYTES[accessor?.["componentType"] as number];
      if (extras === null || ranges === null || accessor === null || !bytes)
        continue;
      const kept = ranges.slice(0, ranges.length <= 2 ? 1 : -1);
      const count = Math.max(...kept.map((r) => r.start + r.count));
      if (!(count <= (accessor["count"] as number))) continue;
      accessor["count"] = count;
      if (kept.length === 1) delete extras["lod"];
      else lod!["levels"] = (lod!["levels"] as unknown[]).slice(0, -1);
      if (Object.keys(extras).length === 0) delete prim!["extras"];
      cutView(parts, accessors, views, accessor, count * bytes);
      dropped = true;
    }
  }
  return dropped;
}

/** Cuts the view under `chain` to end where its first `length` bytes do,
 *  when no other accessor reads past that. */
function cutView(
  parts: GlbParts,
  accessors: readonly unknown[],
  views: readonly unknown[],
  chain: GltfObject,
  length: number,
): void {
  const v = indexOf(chain["bufferView"]);
  const view = v === null ? null : objectOf(views[v]);
  const data = v === null ? undefined : parts.views[v];
  if (view === null || data === undefined) return;
  const end = ((chain["byteOffset"] as number | undefined) ?? 0) + length;
  const readsPast = accessors.some((value) => {
    const other = objectOf(value);
    if (other === null || other === chain || other["bufferView"] !== v)
      return false;
    const size = INDEX_BYTES[other["componentType"] as number];
    const offset = (other["byteOffset"] as number | undefined) ?? 0;
    return (
      !size ||
      other["type"] !== "SCALAR" ||
      offset + (other["count"] as number) * size > end
    );
  });
  if (readsPast || end > data.length) return;
  parts.views[v!] = data.subarray(0, end);
  view["byteLength"] = end;
}

const NOTHING: Omit<LodReport, "skipped" | "automatic"> = {
  primitives: 0,
  trianglesBefore: 0,
  trianglesAfter: 0,
  deviation: 0,
  size: 0,
  choices: [],
};

/** Gives `parts`' primitives levels of detail (changed in place).
 *  `progress`, when given, hears the share of primitives done. */
export function simplifyModel(
  parts: GlbParts,
  settings: LodSettings,
  progress?: (fraction: number) => void,
): LodReport {
  const automatic =
    settings.detailShare === undefined ||
    !Number.isFinite(settings.detailShare);
  const uses = accessorUses(parts.json);
  const posing = posingOf(parts);
  const found = (listOf(parts.json, "meshes") ?? []).flatMap((mesh, m) =>
    (listOf(objectOf(mesh) ?? {}, "primitives") ?? [])
      .map(objectOf)
      .filter((prim): prim is GltfObject => prim !== null)
      .map((prim) =>
        candidateOf(parts, m, prim, uses, settings.lodMinTriangles, posing),
      ),
  );
  const candidates = found.filter(
    (c): c is Candidate => c !== null && c !== "not posed",
  );
  const skipped = found.includes("not posed") ? NOT_POSED : null;
  let report: LodReport = { ...NOTHING, skipped, automatic };
  let choices: LodChoice[] = [];
  candidates.forEach((c, i) => {
    const o = order(parts, c);
    if (o.prog.triangleCount === 0) return;
    const levels = chainOf(o, authorSteps(o, c, settings));
    const { lists, keep } = compact(o, levels, c.positions.length / 3);
    const mine = choicesOf(o);
    choices =
      choices.length === 0
        ? mine
        : choices.map((ch, k) => ({
            share: ch.share,
            triangles: ch.triangles + mine[k]!.triangles,
            deviation: Math.max(ch.deviation, mine[k]!.deviation),
          }));
    save(parts, c, levels, lists, keep);
    report = {
      ...report,
      primitives: report.primitives + 1,
      trianglesBefore: report.trianglesBefore + c.indices.length / 3,
      trianglesAfter: report.trianglesAfter + lists[0]!.length / 3,
      deviation: Math.max(report.deviation, levels[0]!.error),
      size: Math.max(report.size, o.prog.diag),
    };
    progress?.((i + 1) / candidates.length);
  });
  return { ...report, choices };
}
