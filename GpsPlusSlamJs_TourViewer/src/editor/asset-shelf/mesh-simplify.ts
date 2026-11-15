/**
 * A progressive mesh simplifier: quadric-error half-edge collapse with a
 * priority queue, run once over a triangle list. Every level keeps the
 * ORIGINAL vertex buffer (a half-edge collapse moves a vertex onto an
 * existing neighbour), so a level is only an index list, and the levels
 * are nested: a coarser level's triangles are a prefix of a finer one's
 * (`order`).
 *
 * - Error: generalized quadrics per render vertex over position plus
 *   weighted attributes (texture coordinates), and edge-constraint
 *   quadrics along open borders and attribute seams.
 * - Seams and borders: a vertex on a seam or border moves only along it,
 *   priced by the border's edge constraints (so a corner of an outline
 *   moves only at a cost, never for free); a vertex where more than two
 *   seam or border edges meet, and any non-manifold vertex, never moves.
 * - No flips: a collapse is refused when a remaining triangle would turn
 *   by more than `maxTurnDeg`, become degenerate, or face away from its
 *   corners' shading normals.
 * - Manifold: the link condition is checked for every collapse.
 *
 * Speed: typed arrays throughout, per-vertex triangle lists pooled in one
 * Int32Array, an indexed binary heap with decrease and increase of a key;
 * after a collapse u -> v only v is fully re-evaluated, a neighbour prices
 * just its move onto v and falls back on its cached runner-up move.
 *
 * meshoptimizer (MIT) was the reference this was measured against; no
 * code is translated from it.
 *
 * @see mesh-simplify.ts.md
 */
/* eslint-disable complexity, max-depth -- numeric kernels: one pass each,
   split further only at the cost of their typed scratch state */

/** Render vertices merged where position, texture coordinate and every
 *  `exact` attribute are equal and normals differ by at most
 *  `normalAngleDeg`. Exporters often split vertices on float noise of the
 *  normals, which would lock a seam everywhere. */
export interface WeldInput {
  readonly position: Float32Array;
  readonly uv?: Float32Array;
  readonly normal?: Float32Array;
  /** More attributes that must match exactly (colours, tangents). */
  readonly exact?: readonly Float32Array[];
}

export interface Weld {
  /** Welded vertex of each input vertex. */
  readonly remap: Uint32Array;
  /** Welded vertex count. */
  readonly count: number;
  /** The index list over the welded vertices. */
  readonly indices: Uint32Array;
  /** The first input vertex of each welded vertex. */
  readonly first: Uint32Array;
}

/** FNV-like mixing constant of the weld's key hash. */
const KEY_MIX = 0x9e3779b1;

export function weldVertices(
  attrs: WeldInput,
  indices: Uint32Array,
  normalAngleDeg = 2,
): Weld {
  const n = attrs.position.length / 3;
  const exact = [attrs.position, attrs.uv, ...(attrs.exact ?? [])].filter(
    (a): a is Float32Array => a !== undefined,
  );
  const sizes = exact.map((a) => a.length / n);
  // one whole entry a vertex in every attribute, or the key would mix
  // one vertex's values with the next one's
  if (
    !Number.isInteger(n) ||
    !sizes.every((size) => Number.isInteger(size) && size > 0) ||
    (attrs.normal !== undefined && attrs.normal.length !== 3 * n)
  ) {
    throw new RangeError("every attribute must have one entry a vertex");
  }
  const K = sizes.reduce((s, x) => s + x, 0);
  const cosMax = Math.cos((normalAngleDeg * Math.PI) / 180);
  // the exact key of every vertex as doubles (-0 counts as 0), hashed
  const key = new Float64Array(n * K);
  for (let i = 0; i < n; i++) {
    let o = i * K;
    for (let a = 0; a < exact.length; a++) {
      const s = sizes[a]!;
      const A = exact[a]!;
      for (let c = 0; c < s; c++) key[o++] = A[i * s + c]! + 0;
    }
  }
  const bits = new Uint32Array(key.buffer);
  let size = 1;
  while (size < 2 * n) size <<= 1;
  const mask = size - 1;
  const head = new Int32Array(size).fill(-1); // first vertex of a key group
  const next = new Int32Array(n).fill(-1); // next member with the same key
  const remap = new Uint32Array(n);
  const firsts: number[] = [];
  let count = 0;
  const N = attrs.normal;
  for (let i = 0; i < n; i++) {
    let h = 0;
    for (let k = 0; k < 2 * K; k++)
      h = Math.imul(h ^ bits[2 * K * i + k]!, KEY_MIX);
    h = (h ^ (h >>> 16)) & mask;
    let j = head[h]!;
    // find the key group (linear probing over distinct keys)
    while (j >= 0) {
      let same = true;
      for (let k = 0; k < K; k++) {
        if (key[j * K + k] !== key[i * K + k]) {
          same = false;
          break;
        }
      }
      if (same) break;
      h = (h + 1) & mask;
      j = head[h]!;
    }
    let found = -1;
    if (j >= 0) {
      if (N !== undefined) {
        for (let m = j; m >= 0; m = next[m]!) {
          const d =
            N[3 * i]! * N[3 * m]! +
            N[3 * i + 1]! * N[3 * m + 1]! +
            N[3 * i + 2]! * N[3 * m + 2]!;
          if (d >= cosMax) {
            found = m;
            break;
          }
        }
      } else found = j;
    }
    if (found >= 0) {
      remap[i] = remap[found]!;
      continue;
    }
    remap[i] = count++;
    firsts.push(i);
    // append i as a group member (kept in first-seen order)
    if (j < 0) head[h] = i;
    else {
      let m = j;
      while (next[m]! >= 0) m = next[m]!;
      next[m] = i;
    }
  }
  const out = new Uint32Array(indices.length);
  for (let k = 0; k < indices.length; k++) out[k] = remap[indices[k]!]!;
  return { remap, count, indices: out, first: Uint32Array.from(firsts) };
}

/** One attribute after a weld: the first input vertex of each welded
 *  vertex wins. */
export function remapAttribute(
  data: Float32Array,
  size: number,
  weld: Weld,
): Float32Array {
  const out = new Float32Array(weld.count * size);
  for (let r = 0; r < weld.count; r++) {
    const i = weld.first[r]!;
    for (let c = 0; c < size; c++) out[r * size + c] = data[i * size + c]!;
  }
  return out;
}

/** Indexed binary min-heap over vertices, with decrease and increase of a
 *  key. */
class IndexedHeap {
  readonly key: Float64Array;
  readonly h: Int32Array;
  private readonly pos: Int32Array;
  size = 0;

  constructor(n: number) {
    this.key = new Float64Array(n);
    this.h = new Int32Array(n);
    this.pos = new Int32Array(n).fill(-1);
  }

  private up(at: number): void {
    const { h, key, pos } = this;
    let i = at;
    const x = h[i]!;
    const k = key[x]!;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const y = h[p]!;
      if (key[y]! <= k) break;
      h[i] = y;
      pos[y] = i;
      i = p;
    }
    h[i] = x;
    pos[x] = i;
  }

  private down(at: number): void {
    const { h, key, pos, size: n } = this;
    let i = at;
    const x = h[i]!;
    const k = key[x]!;
    for (;;) {
      let m = 2 * i + 1;
      if (m >= n) break;
      if (m + 1 < n && key[h[m + 1]!]! < key[h[m]!]!) m++;
      const y = h[m]!;
      if (key[y]! >= k) break;
      h[i] = y;
      pos[y] = i;
      i = m;
    }
    h[i] = x;
    pos[x] = i;
  }

  set(x: number, k: number): void {
    const i = this.pos[x]!;
    if (i < 0) {
      this.key[x] = k;
      this.h[this.size] = x;
      this.pos[x] = this.size;
      this.up(this.size++);
      return;
    }
    const old = this.key[x]!;
    this.key[x] = k;
    if (k < old) this.up(i);
    else this.down(i);
  }

  remove(x: number): void {
    const i = this.pos[x]!;
    if (i < 0) return;
    this.pos[x] = -1;
    const last = this.h[--this.size]!;
    if (i === this.size) return;
    this.h[i] = last;
    this.pos[last] = i;
    this.up(i);
    this.down(this.pos[last]);
  }

  /** Removes and returns the vertex with the smallest key. */
  pop(): number {
    const x = this.h[0]!;
    this.remove(x);
    return x;
  }
}

const INTERIOR = 0;
const SPECIAL = 1;
const LOCKED = 2;

export interface SimplifyMesh {
  /** xyz per render vertex. */
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  /** Attributes in the error metric, `size` floats per vertex. */
  readonly attributes?: readonly {
    readonly data: Float32Array;
    readonly size: number;
    readonly weight: number;
  }[];
}

export interface SimplifyOptions {
  /** The largest turn a remaining triangle may take, degrees (45). */
  readonly maxTurnDeg?: number;
  /** Scales the border and seam constraints (1). */
  readonly edgeWeight?: number;
  /** Shading normals per render vertex: enable the facing check. */
  readonly normals?: Float32Array;
}

/** The full collapse sequence; any level is extracted with
 *  `levelIndices`. */
export interface Progressive {
  readonly vertexCount: number;
  /** Non-degenerate triangles before any collapse. */
  readonly triangleCount: number;
  /** The bounding box diagonal the metric was normalized to. */
  readonly diag: number;
  readonly indices: Uint32Array;
  /** Triangles, latest to die first: any level is a prefix. */
  readonly order: Uint32Array;
  /** The step each triangle dies at (-1 degenerate from the start). */
  readonly triDeath: Int32Array;
  readonly wParent: Int32Array;
  readonly wStep: Int32Array;
  /** Live triangles after each step (non-increasing). */
  readonly stepAlive: Int32Array;
  /** The largest quadric error so far after each step. */
  readonly stepError: Float64Array;
  /** Triangles left when no collapse is allowed any more. */
  readonly minTriangles: number;
}

export function buildProgressive(
  mesh: SimplifyMesh,
  opts: SimplifyOptions = {},
): Progressive {
  const P = mesh.positions;
  const I = mesh.indices;
  const W = P.length / 3;
  const T = I.length / 3;
  const attrs = mesh.attributes ?? [];
  const D = 3 + attrs.reduce((s, a) => s + a.size, 0);
  const AQ = (D * (D + 1)) / 2;
  const QS = AQ + D + 1;
  const cosTurn = Math.cos(((opts.maxTurnDeg ?? 45) * Math.PI) / 180);
  const SN = opts.normals ?? null;
  const edgeWeight = opts.edgeWeight ?? 1;

  // Positions normalized to the unit bounding box diagonal for the metric.
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < W; i++) {
    for (let c = 0; c < 3; c++) {
      const x = P[3 * i + c]!;
      if (x < lo[c]!) lo[c] = x;
      if (x > hi[c]!) hi[c] = x;
    }
  }
  const diag =
    Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) || 1;
  const X = new Float64Array(W * D); // feature vector per render vertex
  for (let i = 0; i < W; i++) {
    for (let c = 0; c < 3; c++) X[i * D + c] = (P[3 * i + c]! - lo[c]!) / diag;
    let o = 3;
    for (const a of attrs) {
      for (let c = 0; c < a.size; c++) {
        X[i * D + o + c] = a.data[i * a.size + c]! * a.weight;
      }
      o += a.size;
    }
  }

  // Position vertices: render vertices with bit-identical positions.
  const wPos = new Int32Array(W);
  let V = 0;
  {
    const F = new Float64Array(3 * W);
    for (let k = 0; k < 3 * W; k++) F[k] = P[k]! + 0;
    const bits = new Uint32Array(F.buffer);
    let size = 1;
    while (size < 2 * W) size <<= 1;
    const mask = size - 1;
    const table = new Int32Array(size).fill(-1);
    for (let i = 0; i < W; i++) {
      const o = 6 * i;
      let h =
        Math.imul(bits[o]! ^ bits[o + 1]!, 73856093) ^
        Math.imul(bits[o + 2]! ^ bits[o + 3]!, 19349663) ^
        Math.imul(bits[o + 4]! ^ bits[o + 5]!, 83492791);
      h = (h ^ (h >>> 15)) & mask;
      for (;;) {
        const j = table[h]!;
        if (j < 0) {
          table[h] = i;
          wPos[i] = V++;
          break;
        }
        if (
          F[3 * j] === F[3 * i] &&
          F[3 * j + 1] === F[3 * i + 1] &&
          F[3 * j + 2] === F[3 * i + 2]
        ) {
          wPos[i] = wPos[j]!;
          break;
        }
        h = (h + 1) & mask;
      }
    }
  }
  const vRep = new Int32Array(V).fill(-1); // a render vertex at that position
  for (let i = 0; i < W; i++) if (vRep[wPos[i]!]! < 0) vRep[wPos[i]!] = i;
  const PX = new Float64Array(V * 3); // normalized position per position
  for (let v = 0; v < V; v++) {
    for (let c = 0; c < 3; c++) PX[3 * v + c] = X[vRep[v]! * D + c]!;
  }

  const triW = new Int32Array(I); // corners as render vertices (mutable)
  const triDead = new Uint8Array(T);
  const triDeath = new Int32Array(T).fill(0x7fffffff);
  const posOf = (t: number, c: number) => wPos[triW[3 * t + c]!]!;

  // Per position vertex triangle lists, pooled in one typed array. A list
  // that outgrows its slot moves to the end of the pool with double room.
  const tOff = new Int32Array(V);
  const tCnt = new Int32Array(V);
  const tCap = new Int32Array(V);
  for (let t = 0; t < T; t++) {
    const a = posOf(t, 0);
    const b = posOf(t, 1);
    const c = posOf(t, 2);
    if (a === b || b === c || a === c) {
      triDead[t] = 1;
      triDeath[t] = -1;
      continue;
    }
    tCnt[a]!++;
    tCnt[b]!++;
    tCnt[c]!++;
  }
  let poolTop = 0;
  for (let v = 0; v < V; v++) {
    tOff[v] = poolTop;
    tCap[v] = tCnt[v]!;
    poolTop += tCnt[v]!;
    tCnt[v] = 0;
  }
  let pool = new Int32Array(Math.max(64, poolTop * 2));
  for (let t = 0; t < T; t++) {
    if (triDead[t]) continue;
    for (let c = 0; c < 3; c++) {
      const v = posOf(t, c);
      pool[tOff[v]! + tCnt[v]!++] = t;
    }
  }
  const reserve = (v: number, need: number) => {
    if (need <= tCap[v]!) return;
    const cap = Math.max(8, 2 * need);
    if (poolTop + cap > pool.length) {
      const np = new Int32Array(Math.max(pool.length * 2, poolTop + cap));
      np.set(pool.subarray(0, poolTop));
      pool = np;
    }
    pool.copyWithin(poolTop, tOff[v]!, tOff[v]! + tCnt[v]!);
    tOff[v] = poolTop;
    tCap[v] = cap;
    poolTop += cap;
  };

  // ---- quadrics ----
  const Q = new Float64Array(W * QS); // generalized quadric per render vertex
  const PQ = new Float64Array(V * 10); // edge-constraint quadric per position
  const p0 = new Float64Array(D);
  const e1 = new Float64Array(D);
  const e2 = new Float64Array(D);
  for (let t = 0; t < T; t++) {
    if (triDead[t]) continue;
    const a = triW[3 * t]! * D;
    const b = triW[3 * t + 1]! * D;
    const c = triW[3 * t + 2]! * D;
    let l1 = 0;
    for (let k = 0; k < D; k++) {
      p0[k] = X[a + k]!;
      e1[k] = X[b + k]! - X[a + k]!;
      l1 += e1[k]! * e1[k]!;
    }
    l1 = Math.sqrt(l1);
    if (l1 < 1e-20) continue;
    let d12 = 0;
    for (let k = 0; k < D; k++) {
      e1[k] = e1[k]! / l1;
      e2[k] = X[c + k]! - X[a + k]!;
      d12 += e2[k]! * e1[k]!;
    }
    let l2 = 0;
    for (let k = 0; k < D; k++) {
      e2[k] = e2[k]! - d12 * e1[k]!;
      l2 += e2[k]! * e2[k]!;
    }
    l2 = Math.sqrt(l2);
    if (l2 < 1e-20) continue;
    for (let k = 0; k < D; k++) e2[k] = e2[k]! / l2;
    // area weight from the 3D part
    const ux = X[b]! - X[a]!;
    const uy = X[b + 1]! - X[a + 1]!;
    const uz = X[b + 2]! - X[a + 2]!;
    const vx = X[c]! - X[a]!;
    const vy = X[c + 1]! - X[a + 1]!;
    const vz = X[c + 2]! - X[a + 2]!;
    const area =
      0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    let pe1 = 0;
    let pe2 = 0;
    let pp = 0;
    for (let k = 0; k < D; k++) {
      pe1 += p0[k]! * e1[k]!;
      pe2 += p0[k]! * e2[k]!;
      pp += p0[k]! * p0[k]!;
    }
    for (let corner = 0; corner < 3; corner++) {
      const q = triW[3 * t + corner]! * QS;
      let m = 0;
      for (let i = 0; i < D; i++) {
        for (let j = i; j < D; j++) {
          Q[q + m] =
            Q[q + m]! +
            area * ((i === j ? 1 : 0) - e1[i]! * e1[j]! - e2[i]! * e2[j]!);
          m++;
        }
      }
      for (let i = 0; i < D; i++) {
        Q[q + AQ + i] =
          Q[q + AQ + i]! + area * (pe1 * e1[i]! + pe2 * e2[i]! - p0[i]!);
      }
      Q[q + AQ + D] = Q[q + AQ + D]! + area * (pp - pe1 * pe1 - pe2 * pe2);
    }
  }

  // ---- edge classification and vertex kinds (static) ----
  const kind = new Uint8Array(V);
  const special = new Int32Array(V);
  const edges = new Int32Array(V);
  const multiW = new Uint8Array(V);
  const wedgeOf = (t: number, v: number): number => {
    const b = 3 * t;
    if (wPos[triW[b]!] === v) return triW[b]!;
    if (wPos[triW[b + 1]!] === v) return triW[b + 1]!;
    if (wPos[triW[b + 2]!] === v) return triW[b + 2]!;
    return -1;
  };
  const addEdgePlane = (a: number, b: number, t: number) => {
    // plane through edge ab, perpendicular to triangle t
    const A = vRep[a]! * D;
    const B = vRep[b]! * D;
    const ex = X[B]! - X[A]!;
    const ey = X[B + 1]! - X[A + 1]!;
    const ez = X[B + 2]! - X[A + 2]!;
    const w0 = triW[3 * t]! * D;
    const w1 = triW[3 * t + 1]! * D;
    const w2 = triW[3 * t + 2]! * D;
    const ux = X[w1]! - X[w0]!;
    const uy = X[w1 + 1]! - X[w0 + 1]!;
    const uz = X[w1 + 2]! - X[w0 + 2]!;
    const vx = X[w2]! - X[w0]!;
    const vy = X[w2 + 1]! - X[w0 + 1]!;
    const vz = X[w2 + 2]! - X[w0 + 2]!;
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    let nx = ey * fz - ez * fy;
    let ny = ez * fx - ex * fz;
    let nz = ex * fy - ey * fx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-30) return;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const d = -(nx * X[A]! + ny * X[A + 1]! + nz * X[A + 2]!);
    const w = edgeWeight * (ex * ex + ey * ey + ez * ez);
    const terms = [
      nx * nx,
      nx * ny,
      nx * nz,
      ny * ny,
      ny * nz,
      nz * nz,
      nx * d,
      ny * d,
      nz * d,
      d * d,
    ];
    for (const end of [a, b]) {
      for (let k = 0; k < 10; k++) {
        PQ[end * 10 + k] = PQ[end * 10 + k]! + w * terms[k]!;
      }
    }
  };
  {
    // Edges from the per-vertex triangle lists: for each vertex a, its
    // neighbours b with the triangles shared with each (at most 3 kept).
    const mark = new Int32Array(V).fill(-1);
    const slot = new Int32Array(V);
    let nb = new Int32Array(64);
    let cnt = new Int32Array(64);
    let tl = new Int32Array(192);
    for (let a = 0; a < V; a++) {
      const o = tOff[a]!;
      const n = tCnt[a]!;
      if (nb.length < 2 * n) {
        nb = new Int32Array(4 * n);
        cnt = new Int32Array(4 * n);
        tl = new Int32Array(12 * n);
      }
      let nn = 0;
      for (let i = 0; i < n; i++) {
        const t = pool[o + i]!;
        for (let c = 0; c < 3; c++) {
          const x = posOf(t, c);
          if (x === a) continue;
          if (mark[x] !== a) {
            mark[x] = a;
            slot[x] = nn;
            nb[nn] = x;
            cnt[nn] = 0;
            nn++;
          }
          const sl = slot[x]!;
          if (cnt[sl]! < 3) tl[3 * sl + cnt[sl]!] = t;
          cnt[sl]!++;
        }
      }
      edges[a]! += nn;
      for (let sl = 0; sl < nn; sl++) {
        const b = nb[sl]!;
        if (b < a) continue;
        const m = cnt[sl]!;
        if (m > 2) {
          kind[a] = LOCKED;
          kind[b] = LOCKED;
          continue;
        }
        const t0 = tl[3 * sl]!;
        const t1 = tl[3 * sl + 1]!;
        const isSpecial =
          m === 1 ||
          wedgeOf(t0, a) !== wedgeOf(t1, a) ||
          wedgeOf(t0, b) !== wedgeOf(t1, b);
        if (isSpecial) {
          special[a]!++;
          special[b]!++;
          addEdgePlane(a, b, t0);
          if (m === 2) addEdgePlane(a, b, t1);
        }
      }
    }
    for (let v = 0; v < V; v++) {
      let first = -1;
      const o = tOff[v]!;
      const n = tCnt[v]!;
      for (let i = 0; i < n; i++) {
        const w = wedgeOf(pool[o + i]!, v);
        if (first < 0) first = w;
        else if (w !== first) multiW[v] = 1;
      }
      if (kind[v] === LOCKED) continue;
      if (n === 0) {
        kind[v] = LOCKED;
        continue;
      }
      if (special[v] === 0) {
        kind[v] = !multiW[v] && edges[v] === n ? INTERIOR : LOCKED;
      } else if (special[v] === 2 && (edges[v] === n || edges[v] === n + 1)) {
        kind[v] = SPECIAL;
      } else kind[v] = LOCKED;
    }
  }

  // ---- candidate evaluation (typed scratch, no allocation per move) ----
  const stamp = new Int32Array(V);
  let stampId = 1;
  const best = new Int32Array(V).fill(-1);
  // runner-up move per vertex (target and cost, geometry not yet checked)
  const second = new Int32Array(V).fill(-1);
  const secondCost = new Float64Array(V);
  const vDead = new Uint8Array(V);
  const heap = new IndexedHeap(V);
  const MAXW = 64;
  const mapFrom = new Int32Array(MAXW);
  const mapTo = new Int32Array(MAXW);
  let mapN = 0;
  const uWedges = new Int32Array(MAXW);
  let uwN = 0;
  const tsBuf = new Int32Array(3);
  let tsN = 0;
  const nMark = new Int32Array(V);
  const nSlot = new Int32Array(V);
  let nMarkId = 0;
  let sCnt = new Int32Array(256);
  let sT = new Int32Array(512);
  let nbr = new Int32Array(256);
  let cCost = new Float64Array(256);
  let cV = new Int32Array(256);
  let touched = new Int32Array(256);
  /** The quadric at Q[q..] evaluated at render vertex w's feature point. */
  const evalQ = (q: number, w: number): number => {
    const x = w * D;
    let s = 0;
    let m = q;
    for (let i = 0; i < D; i++) {
      const xi = X[x + i]!;
      s += Q[m++]! * xi * xi;
      for (let j = i + 1; j < D; j++) s += 2 * Q[m++]! * xi * X[x + j]!;
    }
    for (let i = 0; i < D; i++) s += 2 * Q[q + AQ + i]! * X[x + i]!;
    return s + Q[q + AQ + D]!;
  };
  /** Position quadric `u` evaluated at position `v`. */
  const evalPQ = (u: number, v: number): number => {
    const a = u * 10;
    const x = PX[3 * v]!;
    const y = PX[3 * v + 1]!;
    const z = PX[3 * v + 2]!;
    return (
      PQ[a]! * x * x +
      2 * PQ[a + 1]! * x * y +
      2 * PQ[a + 2]! * x * z +
      PQ[a + 3]! * y * y +
      2 * PQ[a + 4]! * y * z +
      PQ[a + 5]! * z * z +
      2 * (PQ[a + 6]! * x + PQ[a + 7]! * y + PQ[a + 8]! * z) +
      PQ[a + 9]!
    );
  };
  // A target's own quadric at its own point is the same for every move
  // onto it: cached per render vertex (SELF) and per position (PSELF),
  // refreshed when a collapse adds to that quadric.
  const SELF = new Float64Array(W);
  const PSELF = new Float64Array(V);
  for (let w = 0; w < W; w++) SELF[w] = evalQ(w * QS, w);
  for (let v = 0; v < V; v++) PSELF[v] = evalPQ(v, v);
  const mapOf = (w: number): number => {
    for (let i = 0; i < mapN; i++) if (mapFrom[i] === w) return mapTo[i]!;
    return -1;
  };

  /** Drops dead triangles from x's list in place; the live count. */
  const live = (x: number): number => {
    const o = tOff[x]!;
    const n = tCnt[x]!;
    let j = 0;
    for (let i = 0; i < n; i++) {
      const t = pool[o + i]!;
      if (!triDead[t]) pool[o + j++] = t;
    }
    tCnt[x] = j;
    return j;
  };
  const collectUWedges = (u: number) => {
    uwN = 0;
    const o = tOff[u]!;
    const n = tCnt[u]!;
    for (let i = 0; i < n; i++) {
      const w = wedgeOf(pool[o + i]!, u);
      let seen = false;
      for (let k = 0; k < uwN; k++) {
        if (uWedges[k] === w) {
          seen = true;
          break;
        }
      }
      if (!seen && uwN < MAXW) uWedges[uwN++] = w;
    }
  };

  /** The rest of `buildMap`, with the shared triangles already in tsBuf. */
  const mapShared = (u: number, v: number): boolean => {
    if (tsN === 0) return false;
    mapN = 0;
    const isSpecialEdge =
      tsN === 1 ||
      wedgeOf(tsBuf[0]!, u) !== wedgeOf(tsBuf[1]!, u) ||
      wedgeOf(tsBuf[0]!, v) !== wedgeOf(tsBuf[1]!, v);
    if (kind[u] === INTERIOR) {
      if (isSpecialEdge) return false;
    } else if (!isSpecialEdge) return false;
    for (let i = 0; i < tsN; i++) {
      const t = tsBuf[i]!;
      const wu = wedgeOf(t, u);
      const wv = wedgeOf(t, v);
      const at = mapOf(wu);
      if (at >= 0) {
        if (at !== wv) return false;
      } else {
        mapFrom[mapN] = wu;
        mapTo[mapN] = wv;
        mapN++;
      }
    }
    return mapN === uwN; // every wedge u uses is mapped
  };
  /** Fills the wedge map and tsBuf for u -> v (u's list live, its wedges
   *  in uWedges); false when not allowed. */
  const buildMap = (u: number, v: number): boolean => {
    tsN = 0;
    const o = tOff[u]!;
    const n = tCnt[u]!;
    for (let i = 0; i < n; i++) {
      const t = pool[o + i]!;
      if (posOf(t, 0) === v || posOf(t, 1) === v || posOf(t, 2) === v) {
        if (tsN === 2) return false;
        tsBuf[tsN++] = t;
      }
    }
    return mapShared(u, v);
  };

  const costOf = (u: number, v: number): number => {
    // accumulated quadric error at the target, summed over target wedges
    let s = evalPQ(u, v) + PSELF[v]!;
    for (let i = 0; i < mapN; i++) {
      let seenBefore = false;
      for (let j = 0; j < i; j++) if (mapTo[j] === mapTo[i]) seenBefore = true;
      if (seenBefore) continue;
      const wv = mapTo[i]!;
      s += SELF[wv]!;
      for (let j = 0; j < mapN; j++) {
        if (mapTo[j] === wv) s += evalQ(mapFrom[j]! * QS, wv);
      }
    }
    return Math.max(0, s);
  };

  const geometryOk = (u: number, v: number): boolean => {
    // link condition: common neighbours == third vertices of tsBuf
    stampId++;
    const uo = tOff[u]!;
    const un = tCnt[u]!;
    for (let i = 0; i < un; i++) {
      const t = pool[uo + i]!;
      for (let c = 0; c < 3; c++) stamp[posOf(t, c)] = stampId;
    }
    let common = 0;
    stampId++;
    const mark = stampId;
    const vn = live(v);
    const vo = tOff[v]!;
    for (let i = 0; i < vn; i++) {
      const t = pool[vo + i]!;
      for (let c = 0; c < 3; c++) {
        const x = posOf(t, c);
        if (x !== u && x !== v && stamp[x] === mark - 1) {
          stamp[x] = mark;
          common++;
        }
      }
    }
    if (common !== tsN) return false;
    // flip and turn check
    const vx = PX[3 * v]!;
    const vy = PX[3 * v + 1]!;
    const vz = PX[3 * v + 2]!;
    const ux = PX[3 * u]!;
    const uy = PX[3 * u + 1]!;
    const uz = PX[3 * u + 2]!;
    for (let i = 0; i < un; i++) {
      const t = pool[uo + i]!;
      if (t === tsBuf[0] || (tsN > 1 && t === tsBuf[1])) continue;
      const q0 = posOf(t, 0);
      const q1 = posOf(t, 1);
      const q2 = posOf(t, 2);
      const a = q0 === u ? q1 : q1 === u ? q2 : q0;
      const b = q0 === u ? q2 : q1 === u ? q0 : q1;
      const ax = PX[3 * a]!;
      const ay = PX[3 * a + 1]!;
      const az = PX[3 * a + 2]!;
      const bx = PX[3 * b]!;
      const by = PX[3 * b + 1]!;
      const bz = PX[3 * b + 2]!;
      // old normal (u,a,b), new normal (v,a,b)
      let e1x = ax - ux;
      let e1y = ay - uy;
      let e1z = az - uz;
      let e2x = bx - ux;
      let e2y = by - uy;
      let e2z = bz - uz;
      const ox = e1y * e2z - e1z * e2y;
      const oy = e1z * e2x - e1x * e2z;
      const oz = e1x * e2y - e1y * e2x;
      e1x = ax - vx;
      e1y = ay - vy;
      e1z = az - vz;
      e2x = bx - vx;
      e2y = by - vy;
      e2z = bz - vz;
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      const lo2 = Math.sqrt(ox * ox + oy * oy + oz * oz);
      const ln = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (ln === 0 || ln < 1e-8 * lo2) return false;
      if (ox * nx + oy * ny + oz * nz < cosTurn * lo2 * ln) return false;
      if (SN !== null) {
        // the new face must not face away from its corners' shading normals
        let sx = 0;
        let sy = 0;
        let sz = 0;
        for (let c = 0; c < 3; c++) {
          let w = triW[3 * t + c]!;
          if (wPos[w] === u) w = mapOf(w);
          sx += SN[3 * w]!;
          sy += SN[3 * w + 1]!;
          sz += SN[3 * w + 2]!;
        }
        if (nx * sx + ny * sy + nz * sz <= 0) return false;
      }
    }
    return true;
  };

  const loadShared = (sl: number) => {
    if (sCnt[sl]! > 2) {
      tsN = 0;
      return;
    }
    tsN = sCnt[sl]!;
    tsBuf[0] = sT[2 * sl]!;
    tsBuf[1] = sT[2 * sl + 1]!;
  };
  const candidate = (u: number) => {
    best[u] = -1;
    second[u] = -1;
    heap.remove(u);
    if (vDead[u] || kind[u] === LOCKED) return;
    const un = live(u);
    const uo = tOff[u]!;
    collectUWedges(u);
    // one pass over u's triangles: each neighbour with the triangles shared
    nMarkId++;
    let nn = 0;
    if (nbr.length < 3 * un) {
      nbr = new Int32Array(6 * un);
      cCost = new Float64Array(6 * un);
      cV = new Int32Array(6 * un);
      sCnt = new Int32Array(6 * un);
      sT = new Int32Array(12 * un);
    }
    for (let i = 0; i < un; i++) {
      const t = pool[uo + i]!;
      for (let c = 0; c < 3; c++) {
        const x = posOf(t, c);
        if (x === u) continue;
        let sl: number;
        if (nMark[x] !== nMarkId) {
          nMark[x] = nMarkId;
          nSlot[x] = sl = nn;
          nbr[nn] = x;
          sCnt[nn] = 0;
          nn++;
        } else sl = nSlot[x]!;
        if (sCnt[sl]! < 2) sT[2 * sl + sCnt[sl]!] = t;
        sCnt[sl]!++;
      }
    }
    let cn = 0;
    for (let i = 0; i < nn; i++) {
      const v = nbr[i]!;
      loadShared(i);
      if (!mapShared(u, v)) continue;
      cCost[cn] = costOf(u, v);
      cV[cn] = i;
      cn++;
    }
    // try cheapest first (selection; the lists are short)
    while (cn > 0) {
      let m = 0;
      for (let i = 1; i < cn; i++) if (cCost[i]! < cCost[m]!) m = i;
      const c = cCost[m]!;
      const sl = cV[m]!;
      const v = nbr[sl]!;
      cn--;
      cCost[m] = cCost[cn]!;
      cV[m] = cV[cn]!;
      loadShared(sl);
      mapShared(u, v);
      if (geometryOk(u, v)) {
        best[u] = v;
        heap.set(u, c);
        if (cn > 0) {
          let r = 0;
          for (let i = 1; i < cn; i++) if (cCost[i]! < cCost[r]!) r = i;
          second[u] = nbr[cV[r]!]!;
          secondCost[u] = cCost[r]!;
        }
        return;
      }
    }
  };

  for (let u = 0; u < V; u++) candidate(u);

  // ---- collapse loop ----
  const wParent = new Int32Array(W).fill(-1);
  const wStep = new Int32Array(W).fill(0x7fffffff);
  let alive = 0;
  for (let t = 0; t < T; t++) if (!triDead[t]) alive++;
  let stepAlive = new Int32Array(Math.max(16, V + 1));
  let stepError = new Float64Array(Math.max(16, V + 1));
  stepAlive[0] = alive;
  stepError[0] = 0;
  let step = 0;
  let maxErr = 0;
  while (heap.size > 0) {
    const key = heap.key[heap.h[0]!]!;
    const u = heap.pop();
    if (vDead[u] || best[u]! < 0) continue;
    const v = best[u]!;
    live(u);
    collectUWedges(u);
    if (vDead[v] || !buildMap(u, v) || !geometryOk(u, v)) {
      candidate(u);
      continue;
    }
    const cost = costOf(u, v);
    if (cost > key * 1.0001 + 1e-18) {
      candidate(u); // stale: re-queue
      continue;
    }
    step++;
    for (let i = 0; i < tsN; i++) {
      const t = tsBuf[i]!;
      triDead[t] = 1;
      triDeath[t] = step;
      alive--;
    }
    // quadrics
    for (let i = 0; i < mapN; i++) {
      const a = mapFrom[i]! * QS;
      const b = mapTo[i]! * QS;
      for (let k = 0; k < QS; k++) Q[b + k] = Q[b + k]! + Q[a + k]!;
      wParent[mapFrom[i]!] = mapTo[i]!;
      wStep[mapFrom[i]!] = step;
    }
    for (let k = 0; k < 10; k++) {
      PQ[v * 10 + k] = PQ[v * 10 + k]! + PQ[u * 10 + k]!;
    }
    PSELF[v] = evalPQ(v, v);
    for (let i = 0; i < mapN; i++) {
      SELF[mapTo[i]!] = evalQ(mapTo[i]! * QS, mapTo[i]!);
    }
    // remap corners and move u's surviving triangles to v's list
    const vn0 = live(v);
    const un = tCnt[u]!;
    reserve(v, vn0 + un);
    const uo = tOff[u]!;
    let vn = vn0;
    for (let i = 0; i < un; i++) {
      const t = pool[uo + i]!;
      if (triDead[t]) continue;
      for (let c = 0; c < 3; c++) {
        const w = triW[3 * t + c]!;
        if (wPos[w] === u) triW[3 * t + c] = mapOf(w);
      }
      pool[tOff[v]! + vn++] = t;
    }
    tCnt[v] = vn;
    vDead[u] = 1;
    tCnt[u] = 0;
    maxErr = Math.max(maxErr, Math.sqrt(cost));
    if (step >= stepAlive.length) {
      const a2 = new Int32Array(stepAlive.length * 2);
      a2.set(stepAlive);
      stepAlive = a2;
      const e2b = new Float64Array(stepError.length * 2);
      e2b.set(stepError);
      stepError = e2b;
    }
    stepAlive[step] = alive;
    stepError[step] = maxErr;
    // re-evaluate v and its neighbours
    stampId++;
    let nt = 0;
    if (touched.length < 3 * vn + 1) touched = new Int32Array(6 * vn + 2);
    touched[nt++] = v;
    stamp[v] = stampId;
    const vo = tOff[v]!;
    for (let i = 0; i < vn; i++) {
      const t = pool[vo + i]!;
      for (let c = 0; c < 3; c++) {
        const x = posOf(t, c);
        if (stamp[x] !== stampId) {
          stamp[x] = stampId;
          touched[nt++] = x;
        }
      }
    }
    // v's moves all changed. A neighbour's moves changed only towards v
    // (its other edges keep their cost), so it is fully re-evaluated only
    // when its best move pointed at u or v, or it had none; otherwise only
    // x -> v is priced. A best move made invalid here is caught at pop.
    candidate(v);
    for (let i = 1; i < nt; i++) {
      const x = touched[i]!;
      if (vDead[x] || kind[x] === LOCKED) continue;
      const bx = best[x]!;
      if (bx < 0) {
        candidate(x);
        continue;
      }
      live(x);
      collectUWedges(x);
      const ok = buildMap(x, v);
      const c = ok ? costOf(x, v) : Infinity;
      // the runner-up is kept current for moves onto v (u is now v)
      if (second[x] === u || second[x] === v) {
        second[x] = ok ? v : -1;
        secondCost[x] = c;
      }
      if (bx === u || bx === v) {
        // best move gone or repriced: the cheaper of x -> v and runner-up
        const s2 = second[x] === v ? -1 : second[x]!;
        const c2 = s2 < 0 ? Infinity : secondCost[x]!;
        if (ok && c <= c2) {
          if (geometryOk(x, v)) {
            best[x] = v;
            heap.set(x, c);
            second[x] = s2;
            secondCost[x] = c2;
            continue;
          }
        } else if (s2 >= 0 && !vDead[s2]) {
          if (buildMap(x, s2) && geometryOk(x, s2)) {
            const cs = costOf(x, s2);
            best[x] = s2;
            heap.set(x, cs);
            if (ok) {
              second[x] = v;
              secondCost[x] = c;
            } else second[x] = -1;
            continue;
          }
        }
        candidate(x);
        continue;
      }
      if (!ok) continue;
      if (c < heap.key[x]!) {
        if (geometryOk(x, v)) {
          second[x] = bx;
          secondCost[x] = heap.key[x]!;
          best[x] = v;
          heap.set(x, c);
        }
      } else if (second[x]! < 0 || c < secondCost[x]!) {
        second[x] = v;
        secondCost[x] = c;
      }
    }
  }

  // Triangles ordered so that any level's live triangles are a prefix
  // (counting sort by death step, latest first, stable in t).
  const never = step + 1; // triangles alive at the floor sort first
  const bucket = new Int32Array(never + 2);
  let kept = 0;
  const bucketOf = (t: number) => never - Math.min(triDeath[t]!, never);
  for (let t = 0; t < T; t++) {
    if (triDeath[t]! >= 0) {
      bucket[bucketOf(t)]!++;
      kept++;
    }
  }
  for (let i = 0, acc = 0; i < bucket.length; i++) {
    const c = bucket[i]!;
    bucket[i] = acc;
    acc += c;
  }
  const order = new Uint32Array(kept);
  for (let t = 0; t < T; t++) {
    if (triDeath[t]! >= 0) order[bucket[bucketOf(t)]!++] = t;
  }
  return {
    vertexCount: W,
    triangleCount: stepAlive[0]!,
    diag,
    indices: I,
    order,
    triDeath,
    wParent,
    wStep,
    stepAlive: stepAlive.slice(0, step + 1),
    stepError: stepError.slice(0, step + 1),
    minTriangles: stepAlive[step]!,
  };
}

/** The fewest collapse steps whose result has at most `targetTris`
 *  triangles (the last step when even it has more). */
export function stepsFor(prog: Progressive, targetTris: number): number {
  const a = prog.stepAlive; // non-increasing
  let lo = 0;
  let hi = a.length - 1;
  if (a[hi]! > targetTris) return hi;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m]! <= targetTris) hi = m;
    else lo = m + 1;
  }
  return lo;
}

/** The triangles alive after `steps` collapses (a prefix of `order`). */
export function levelTriangles(prog: Progressive, steps: number): number {
  const { order, triDeath } = prog;
  let n = 0;
  while (n < order.length && triDeath[order[n]!]! > steps) n++;
  return n;
}

/** The index list of the level after `steps` collapses, into the original
 *  vertex buffer. Its triangles are a prefix of `prog.order`. */
export function levelIndices(prog: Progressive, steps: number): Uint32Array {
  const { order, indices, wParent, wStep } = prog;
  const n = levelTriangles(prog, steps);
  const out = new Uint32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = order[i]!;
    for (let c = 0; c < 3; c++) {
      let w = indices[3 * t + c]!;
      while (wStep[w]! <= steps) w = wParent[w]!;
      out[3 * i + c] = w;
    }
  }
  return out;
}
