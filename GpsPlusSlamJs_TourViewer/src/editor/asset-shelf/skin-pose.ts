/**
 * A skinned model's poses, for the level-of-detail pass to measure a
 * level's deviation in: the rest pose (the nodes as the file stores them)
 * and up to `CLIP_POSES` poses sampled from its clips, each as a world
 * matrix per node; and a primitive's positions skinned into one of them
 * (linear blend skinning, as glTF defines it).
 *
 * Everything is read from the untrusted file defensively: a node graph
 * that is no tree, a transform, clip or skin that does not read, or a
 * vertex bound to a joint the skin does not have gives null, and the pass
 * then leaves the skinned primitive as it is.
 *
 * @see skin-pose.ts.md
 */

import {
  type GlbParts,
  type GltfObject,
  indexOf,
  listOf,
  objectOf,
  readAccessor,
} from "./glb-file.js";

/** A 4 x 4 matrix, column-major (glTF's and three.js's order). */
export type Matrix = Float64Array;

/** Clip poses sampled, at most. */
export const CLIP_POSES = 3;
/** Where in a clip its poses are sampled, as shares of its length. */
const CLIP_SHARES = [1 / 3, 2 / 3, 1];

export interface Poses {
  /** Each pose's world matrix of every node; `worlds[0]` is the rest. */
  readonly worlds: readonly (readonly Matrix[])[];
  /** Whether any pose comes from a clip. */
  readonly fromClips: boolean;
}

interface Trs {
  t: number[];
  r: number[];
  s: number[];
}

type Local = { readonly matrix: Matrix } | { readonly trs: Trs };

const finite = (v: unknown, n: number): v is number[] =>
  Array.isArray(v) && v.length === n && v.every(Number.isFinite);

function localOf(node: GltfObject): Local | null {
  const m = node["matrix"];
  if (m !== undefined)
    return finite(m, 16) ? { matrix: Float64Array.from(m) } : null;
  const t = node["translation"] ?? [0, 0, 0];
  const r = node["rotation"] ?? [0, 0, 0, 1];
  const s = node["scale"] ?? [1, 1, 1];
  if (!finite(t, 3) || !finite(r, 4) || !finite(s, 3)) return null;
  return { trs: { t: [...t], r: [...r], s: [...s] } };
}

/** T * R * S as a matrix. */
function compose({ t, r, s }: Trs): Matrix {
  const l = Math.hypot(r[0]!, r[1]!, r[2]!, r[3]!) || 1;
  const [x, y, z, w] = r.map((v) => v / l) as [number, number, number, number];
  const m = new Float64Array(16);
  m[0] = (1 - 2 * (y * y + z * z)) * s[0]!;
  m[1] = 2 * (x * y + z * w) * s[0]!;
  m[2] = 2 * (x * z - y * w) * s[0]!;
  m[4] = 2 * (x * y - z * w) * s[1]!;
  m[5] = (1 - 2 * (x * x + z * z)) * s[1]!;
  m[6] = 2 * (y * z + x * w) * s[1]!;
  m[8] = 2 * (x * z + y * w) * s[2]!;
  m[9] = 2 * (y * z - x * w) * s[2]!;
  m[10] = (1 - 2 * (x * x + y * y)) * s[2]!;
  m[12] = t[0]!;
  m[13] = t[1]!;
  m[14] = t[2]!;
  m[15] = 1;
  return m;
}

function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = v;
    }
  }
  return out;
}

/** Each node's parent (-1 for a root), or null when the nodes are no
 *  forest (a child index out of range, two parents, or a cycle). */
function parentsOf(nodes: readonly GltfObject[]): Int32Array | null {
  const parent = new Int32Array(nodes.length).fill(-1);
  for (let i = 0; i < nodes.length; i++) {
    const children = nodes[i]!["children"] ?? [];
    if (!Array.isArray(children)) return null;
    for (const c of children) {
      const k = indexOf(c);
      if (k === null || k >= nodes.length || parent[k] !== -1 || k === i)
        return null;
      parent[k] = i;
    }
  }
  for (let i = 0; i < nodes.length; i++) {
    let at = i;
    for (let steps = 0; at !== -1; steps++) {
      if (steps > nodes.length) return null;
      at = parent[at]!;
    }
  }
  return parent;
}

function worldsOf(locals: readonly Matrix[], parent: Int32Array): Matrix[] {
  const worlds: (Matrix | undefined)[] = Array.from(
    { length: locals.length },
    () => undefined,
  );
  const world = (i: number): Matrix => {
    let w = worlds[i];
    if (w === undefined) {
      const p = parent[i]!;
      w = p === -1 ? locals[i]! : multiply(world(p), locals[i]!);
      worlds[i] = w;
    }
    return w;
  };
  return locals.map((_, i) => world(i));
}

interface Channel {
  readonly node: number;
  readonly path: "translation" | "rotation" | "scale";
  readonly times: Float64Array;
  readonly values: Float64Array;
  readonly size: number;
  readonly interpolation: "LINEAR" | "STEP" | "CUBICSPLINE";
}

const PATH_SIZE = { translation: 3, rotation: 4, scale: 3 } as const;

function channelOf(
  parts: GlbParts,
  animation: GltfObject,
  value: unknown,
  nodes: number,
): Channel | null | "ignored" {
  const channel = objectOf(value);
  const target = objectOf(channel?.["target"]);
  const path = target?.["path"];
  if (path === "weights" || path === "pointer") return "ignored";
  if (path !== "translation" && path !== "rotation" && path !== "scale")
    return null;
  const node = indexOf(target?.["node"]);
  const samplerIndex = indexOf(channel?.["sampler"]);
  const sampler = objectOf(
    (listOf(animation, "samplers") ?? [])[samplerIndex ?? -1],
  );
  if (node === null || node >= nodes || sampler === null) return null;
  const interpolation = sampler["interpolation"] ?? "LINEAR";
  if (
    interpolation !== "LINEAR" &&
    interpolation !== "STEP" &&
    interpolation !== "CUBICSPLINE"
  )
    return null;
  const input = readAccessor(parts, indexOf(sampler["input"]) ?? -1);
  const output = readAccessor(parts, indexOf(sampler["output"]) ?? -1);
  const size = PATH_SIZE[path];
  const keys = interpolation === "CUBICSPLINE" ? 3 : 1;
  if (input === null || output === null || input.size !== 1) return null;
  if (output.size !== size || output.count !== input.count * keys) return null;
  if (input.count === 0 || !output.values.every(Number.isFinite)) return null;
  const times = input.values;
  for (let i = 0; i < times.length; i++) {
    if (!Number.isFinite(times[i]) || (i > 0 && times[i]! <= times[i - 1]!))
      return null;
  }
  return { node, path, times, values: output.values, size, interpolation };
}

/** The rotation `u` of the way from quaternion `a` to `b`, the shorter
 *  way round, as glTF interpolates a rotation. */
function slerp(a: number[], b: number[], u: number): number[] {
  let dot = a.reduce((d, v, k) => d + v * b[k]!, 0);
  const sign = dot < 0 ? -1 : 1;
  dot = Math.min(1, Math.abs(dot));
  const angle = Math.acos(dot);
  if (angle < 1e-6) return a.map((v, k) => v + (sign * b[k]! - v) * u);
  const wa = Math.sin((1 - u) * angle) / Math.sin(angle);
  const wb = (sign * Math.sin(u * angle)) / Math.sin(angle);
  return a.map((v, k) => wa * v + wb * b[k]!);
}

/** Channel `c`'s value at time `t`. A cubic spline is sampled linearly
 *  between its key values, which is close enough to measure a shape in. */
function sample(c: Channel, t: number): number[] {
  const keys = c.interpolation === "CUBICSPLINE" ? 3 : 1;
  const at = (k: number) => {
    const from = (k * keys + (keys === 3 ? 1 : 0)) * c.size;
    return Array.from(c.values.subarray(from, from + c.size));
  };
  const n = c.times.length;
  if (t <= c.times[0]!) return at(0);
  if (t >= c.times[n - 1]!) return at(n - 1);
  let i = 0;
  while (c.times[i + 1]! <= t) i++;
  if (c.interpolation === "STEP") return at(i);
  const u = (t - c.times[i]!) / (c.times[i + 1]! - c.times[i]!);
  const a = at(i);
  const b = at(i + 1);
  return c.path === "rotation"
    ? slerp(a, b, u)
    : a.map((v, k) => v + (b[k]! - v) * u);
}

/** The clips' channels, or null when one does not read. */
function clipsOf(parts: GlbParts, nodes: number): Channel[][] | null {
  const clips: Channel[][] = [];
  for (const value of listOf(parts.json, "animations") ?? []) {
    const animation = objectOf(value);
    if (animation === null) return null;
    const channels: Channel[] = [];
    for (const item of listOf(animation, "channels") ?? []) {
      const channel = channelOf(parts, animation, item, nodes);
      if (channel === null) return null;
      if (channel !== "ignored") channels.push(channel);
    }
    if (channels.length > 0) clips.push(channels);
  }
  return clips;
}

/** The clip poses sampled: each clip at a third, two thirds and its end,
 *  and of all of those at most `CLIP_POSES`, spread evenly. */
function clipTimes(clips: readonly Channel[][]): [number, number][] {
  const all: [number, number][] = [];
  clips.forEach((channels, k) => {
    const start = Math.min(...channels.map((c) => c.times[0]!));
    const end = Math.max(...channels.map((c) => c.times.at(-1)!));
    for (const share of CLIP_SHARES)
      all.push([k, start + (end - start) * share]);
  });
  if (all.length <= CLIP_POSES) return all;
  return Array.from(
    { length: CLIP_POSES },
    (_, i) => all[Math.round((i * (all.length - 1)) / (CLIP_POSES - 1))]!,
  );
}

/** The model's poses, or null when its nodes or clips do not read. */
export function posesOf(parts: GlbParts): Poses | null {
  const list = listOf(parts.json, "nodes");
  if (list === null) return null;
  const nodes = list.map(objectOf);
  if (nodes.some((n) => n === null)) return null;
  const parent = parentsOf(nodes as GltfObject[]);
  const locals = (nodes as GltfObject[]).map(localOf);
  if (parent === null || locals.some((l) => l === null)) return null;
  const rest = (locals as Local[]).map((l) =>
    "matrix" in l ? l.matrix : compose(l.trs),
  );
  const clips = clipsOf(parts, nodes.length);
  if (clips === null) return null;
  const worlds = [worldsOf(rest, parent)];
  for (const [k, t] of clipTimes(clips)) {
    const trs = (locals as Local[]).map((l) =>
      "trs" in l ? { t: [...l.trs.t], r: [...l.trs.r], s: [...l.trs.s] } : null,
    );
    for (const c of clips[k]!) {
      const target = trs[c.node];
      // glTF does not animate a node given by a matrix
      if (target === null || target === undefined) return null;
      target[
        c.path === "translation" ? "t" : c.path === "rotation" ? "r" : "s"
      ] = sample(c, t);
    }
    worlds.push(
      worldsOf(
        trs.map((l, i) => (l === null ? rest[i]! : compose(l))),
        parent,
      ),
    );
  }
  return { worlds, fromClips: worlds.length > 1 };
}

/** Skin `skin`'s joint matrices in a pose (each joint's world matrix times
 *  its inverse bind matrix), or null when the skin does not read. */
export function jointMatrices(
  parts: GlbParts,
  skin: number,
  worlds: readonly Matrix[],
): Matrix[] | null {
  const s = objectOf((listOf(parts.json, "skins") ?? [])[skin]);
  const joints = s?.["joints"];
  if (s === null || !Array.isArray(joints) || joints.length === 0) return null;
  const nodes = joints.map(indexOf);
  if (nodes.some((n) => n === null || n >= worlds.length)) return null;
  let inverse: Float64Array | null = null;
  if (s["inverseBindMatrices"] !== undefined) {
    const index = indexOf(s["inverseBindMatrices"]);
    const data = index === null ? null : readAccessor(parts, index);
    if (data === null || data.size !== 16 || data.count !== joints.length)
      return null;
    if (!data.values.every(Number.isFinite)) return null;
    inverse = data.values;
  }
  return nodes.map((n, j) =>
    inverse === null
      ? worlds[n!]!
      : multiply(worlds[n!]!, inverse.subarray(16 * j, 16 * j + 16)),
  );
}

/** Positions skinned by `matrices`: each vertex the weighted sum of its
 *  joints' transforms of it, its weights normalized to sum to 1. `joints`
 *  and `weights` hold 4 values a vertex per influence set (`JOINTS_n`,
 *  `WEIGHTS_n`). Null when a vertex names a joint `matrices` does not have
 *  or its weights are not finite, at least 0, and above 0 in sum. */
export function skinPositions(
  positions: Float32Array,
  joints: readonly Float64Array[],
  weights: readonly Float64Array[],
  matrices: readonly Matrix[],
): Float32Array | null {
  const n = positions.length / 3;
  if (joints.length === 0 || joints.length !== weights.length) return null;
  if (joints.some((j, k) => j.length !== 4 * n || weights[k]!.length !== 4 * n))
    return null;
  const out = new Float32Array(positions.length);
  for (let v = 0; v < n; v++) {
    const [x, y, z] = [
      positions[3 * v]!,
      positions[3 * v + 1]!,
      positions[3 * v + 2]!,
    ];
    let sum = 0;
    let ox = 0;
    let oy = 0;
    let oz = 0;
    for (let set = 0; set < joints.length; set++) {
      for (let c = 0; c < 4; c++) {
        const w = weights[set]![4 * v + c]!;
        if (!Number.isFinite(w) || w < 0) return null;
        if (w === 0) continue;
        const m = matrices[joints[set]![4 * v + c]!];
        if (m === undefined) return null;
        sum += w;
        ox += w * (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!);
        oy += w * (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!);
        oz += w * (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!);
      }
    }
    if (!(sum > 0)) return null;
    out[3 * v] = ox / sum;
    out[3 * v + 1] = oy / sum;
    out[3 * v + 2] = oz / sum;
  }
  return out;
}
