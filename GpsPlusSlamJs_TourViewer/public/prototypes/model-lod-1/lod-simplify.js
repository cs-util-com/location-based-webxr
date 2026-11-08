/* eslint-disable complexity, max-depth -- numeric kernels of a throwaway prototype */
// Progressive mesh simplifier (throwaway spike): quadric-error half-edge
// collapse with a priority queue. Every level keeps the ORIGINAL vertex
// buffer (a half-edge collapse moves a vertex onto an existing neighbour),
// so a level is only an index buffer.
//
// - Error: Garland-Heckbert generalized quadrics per render vertex over
//   position plus weighted attributes (texture coordinates, normals), and
//   edge-constraint quadrics along open borders and attribute seams.
// - Seams and borders: a vertex on a seam or border moves only along it;
//   a seam or border corner, and any non-manifold vertex, never moves.
// - No flips: a collapse is refused when any remaining triangle would turn
//   by more than `maxTurnDeg` or become degenerate.
// - Manifold: the link condition is checked for every collapse.
//
// Speed (optimization rounds, 2026-11-08; see the model LOD spike findings):
// - typed arrays throughout, per-vertex triangle lists pooled in one
//   Int32Array, no allocation per collapse;
// - an indexed binary heap over vertices with decrease/increase-key;
// - after a collapse u -> v only v is fully re-evaluated; a neighbour x
//   prices just x -> v and falls back on its cached runner-up move when its
//   best move pointed at u or v; a move made invalid is caught at pop;
// - a target's own quadric error is cached per vertex.
// meshoptimizer 1.1.1 (MIT, https://github.com/zeux/meshoptimizer) was the
// reference measured against and its simplifier.cpp was studied; no code
// is translated from it.

/** Merge render vertices that are equal in position and texture
 *  coordinate (and extra attributes), and whose normals differ by at most
 *  `normalAngleDeg`. Exporters often split vertices on float noise, which
 *  would lock a seam everywhere.
 *  @returns {{ remap: Uint32Array, count: number, indices: Uint32Array }} */
export function weldVertices(attrs, indices, normalAngleDeg = 2) {
  const n = attrs.position.length / 3;
  const exact = [attrs.position, attrs.uv, ...(attrs.exact ?? [])].filter(Boolean);
  const sizes = exact.map((a) => a.length / n);
  const K = sizes.reduce((s, x) => s + x, 0);
  const cosMax = Math.cos((normalAngleDeg * Math.PI) / 180);
  // the exact key of every vertex as doubles (-0 counts as 0), hashed
  const key = new Float64Array(n * K);
  for (let i = 0; i < n; i++) {
    let o = i * K;
    for (let a = 0; a < exact.length; a++) {
      const s = sizes[a], A = exact[a];
      for (let c = 0; c < s; c++) {key[o++] = A[i * s + c] + 0;}
    }
  }
  const bits = new Uint32Array(key.buffer);
  let size = 1; while (size < 2 * n) {size <<= 1;}
  const mask = size - 1;
  const head = new Int32Array(size).fill(-1); // first vertex of a key group
  const next = new Int32Array(n).fill(-1); // next group member with the same key
  const remap = new Uint32Array(n);
  let count = 0;
  const N = attrs.normal;
  for (let i = 0; i < n; i++) {
    let h = 0;
    for (let k = 0; k < 2 * K; k++) {h = Math.imul(h ^ bits[2 * K * i + k], 0x9e3779b1);}
    h = (h ^ (h >>> 16)) & mask;
    let j = head[h];
    // find the key group (linear probing over distinct keys)
    while (j >= 0) {
      let same = true;
      for (let k = 0; k < K; k++) {if (key[j * K + k] !== key[i * K + k]) { same = false; break; }}
      if (same) {break;}
      h = (h + 1) & mask; j = head[h];
    }
    let found = -1;
    if (j >= 0) {
      if (N) {
        for (let m = j; m >= 0; m = next[m]) {
          const d = N[3 * i] * N[3 * m] + N[3 * i + 1] * N[3 * m + 1] + N[3 * i + 2] * N[3 * m + 2];
          if (d >= cosMax) { found = m; break; }
        }
      } else {found = j;}
    }
    if (found >= 0) {remap[i] = remap[found]; continue;}
    remap[i] = count++;
    // append i as a group member (kept in first-seen order)
    if (j < 0) {head[h] = i;} else { let m = j; while (next[m] >= 0) {m = next[m];} next[m] = i; }
  }
  const out = new Uint32Array(indices.length);
  for (let k = 0; k < indices.length; k++) {out[k] = remap[indices[k]];}
  return { remap, count, indices: out };
}

/** Apply a weld remap to one attribute array (first vertex wins). */
export function remapAttribute(data, size, remap, count) {
  const out = new data.constructor(count * size);
  const seen = new Uint8Array(count);
  for (let i = 0; i < remap.length; i++) {
    const r = remap[i];
    if (seen[r]) {continue;}
    seen[r] = 1;
    for (let c = 0; c < size; c++) {out[r * size + c] = data[i * size + c];}
  }
  return out;
}

// ---- indexed binary min-heap over vertices, with decrease/increase-key ----
class IndexedHeap {
  constructor(n) { this.key = new Float64Array(n); this.h = new Int32Array(n); this.pos = new Int32Array(n).fill(-1); this.size = 0; }
  up(i) {
    const h = this.h, key = this.key, pos = this.pos, x = h[i], k = key[x];
    while (i > 0) {
      const p = (i - 1) >> 1, y = h[p];
      if (key[y] <= k) {break;}
      h[i] = y; pos[y] = i; i = p;
    }
    h[i] = x; pos[x] = i;
  }
  down(i) {
    const h = this.h, key = this.key, pos = this.pos, n = this.size, x = h[i], k = key[x];
    for (;;) {
      let m = 2 * i + 1;
      if (m >= n) {break;}
      if (m + 1 < n && key[h[m + 1]] < key[h[m]]) {m++;}
      const y = h[m];
      if (key[y] >= k) {break;}
      h[i] = y; pos[y] = i; i = m;
    }
    h[i] = x; pos[x] = i;
  }
  set(x, k) {
    const i = this.pos[x];
    if (i < 0) { this.key[x] = k; this.h[this.size] = x; this.pos[x] = this.size; this.up(this.size++); return; }
    const old = this.key[x]; this.key[x] = k;
    if (k < old) {this.up(i);} else {this.down(i);}
  }
  remove(x) {
    const i = this.pos[x];
    if (i < 0) {return;}
    this.pos[x] = -1;
    const last = this.h[--this.size];
    if (i === this.size) {return;}
    this.h[i] = last; this.pos[last] = i;
    this.up(i); this.down(this.pos[last]);
  }
  /** Remove and return the vertex with the smallest key. */
  pop() { const x = this.h[0]; this.remove(x); return x; }
}

const INTERIOR = 0, SPECIAL = 1, LOCKED = 2;

/**
 * Build the full collapse sequence once; any level is then extracted with
 * `levelIndices`.
 * @param {{ positions: Float32Array, indices: Uint32Array,
 *   attributes?: { data: Float32Array, size: number, weight: number }[] }} mesh
 * @param {{ maxTurnDeg?: number, edgeWeight?: number, normals?: Float32Array,
 *   onProgress?: (alive:number)=>void }} [opts] edgeWeight (default 1)
 *   scales the border and seam constraints; normals enable the facing check.
 */
export function buildProgressive(mesh, opts = {}) {
  const P = mesh.positions, I = mesh.indices;
  const W = P.length / 3, T = I.length / 3;
  const attrs = mesh.attributes ?? [];
  const D = 3 + attrs.reduce((s, a) => s + a.size, 0);
  const AQ = (D * (D + 1)) / 2, QS = AQ + D + 1;
  const cosTurn = Math.cos(((opts.maxTurnDeg ?? 45) * Math.PI) / 180);
  const SN = opts.normals ?? null; // shading normals per render vertex, for the facing check
  const edgeWeight = opts.edgeWeight ?? 1;

  // Normalize positions to the unit bounding-box diagonal for the metric.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < W; i++) {for (let c = 0; c < 3; c++) {
    const x = P[3 * i + c]; if (x < lo[c]) {lo[c] = x;} if (x > hi[c]) {hi[c] = x;}
  }}
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const X = new Float64Array(W * D); // per render vertex feature vector
  for (let i = 0; i < W; i++) {
    for (let c = 0; c < 3; c++) {X[i * D + c] = (P[3 * i + c] - lo[c]) / diag;}
    let o = 3;
    for (const a of attrs) {
      for (let c = 0; c < a.size; c++) {X[i * D + o + c] = a.data[i * a.size + c] * a.weight;}
      o += a.size;
    }
  }

  // Position vertices: render vertices with bit-identical positions.
  const wPos = new Int32Array(W);
  let V = 0;
  {
    // open-addressing hash over the exact coordinates (-0 equals 0)
    const F = new Float64Array(3 * W);
    for (let k = 0; k < 3 * W; k++) {F[k] = P[k] + 0;}
    const bits = new Uint32Array(F.buffer);
    let size = 1; while (size < 2 * W) {size <<= 1;}
    const mask = size - 1, table = new Int32Array(size).fill(-1);
    for (let i = 0; i < W; i++) {
      const o = 6 * i;
      let h = Math.imul(bits[o] ^ bits[o + 1], 73856093) ^ Math.imul(bits[o + 2] ^ bits[o + 3], 19349663) ^ Math.imul(bits[o + 4] ^ bits[o + 5], 83492791);
      h = (h ^ (h >>> 15)) & mask;
      for (;;) {
        const j = table[h];
        if (j < 0) { table[h] = i; wPos[i] = V++; break; }
        if (F[3 * j] === F[3 * i] && F[3 * j + 1] === F[3 * i + 1] && F[3 * j + 2] === F[3 * i + 2]) { wPos[i] = wPos[j]; break; }
        h = (h + 1) & mask;
      }
    }
  }
  const vRep = new Int32Array(V).fill(-1); // a render vertex at that position
  for (let i = 0; i < W; i++) {if (vRep[wPos[i]] < 0) {vRep[wPos[i]] = i;}}
  const PX = new Float64Array(V * 3); // normalized position per position vertex
  for (let v = 0; v < V; v++) {for (let c = 0; c < 3; c++) {PX[3 * v + c] = X[vRep[v] * D + c];}}

  const triW = new Int32Array(I); // corners as render vertices (mutable)
  const triDead = new Uint8Array(T);
  const triDeath = new Int32Array(T).fill(0x7fffffff);

  // Per position vertex triangle lists, pooled in one typed array. A list
  // that outgrows its slot moves to the end of the pool with double room.
  const tOff = new Int32Array(V), tCnt = new Int32Array(V), tCap = new Int32Array(V);
  for (let t = 0; t < T; t++) {
    const a = wPos[triW[3 * t]], b = wPos[triW[3 * t + 1]], c = wPos[triW[3 * t + 2]];
    if (a === b || b === c || a === c) { triDead[t] = 1; triDeath[t] = -1; continue; }
    tCnt[a]++; tCnt[b]++; tCnt[c]++;
  }
  let poolTop = 0;
  for (let v = 0; v < V; v++) { tOff[v] = poolTop; tCap[v] = tCnt[v]; poolTop += tCnt[v]; tCnt[v] = 0; }
  let pool = new Int32Array(Math.max(64, poolTop * 2));
  for (let t = 0; t < T; t++) {
    if (triDead[t]) {continue;}
    for (let c = 0; c < 3; c++) { const v = wPos[triW[3 * t + c]]; pool[tOff[v] + tCnt[v]++] = t; }
  }
  const reserve = (v, need) => {
    if (need <= tCap[v]) {return;}
    const cap = Math.max(8, 2 * need);
    if (poolTop + cap > pool.length) {
      const np = new Int32Array(Math.max(pool.length * 2, poolTop + cap));
      np.set(pool.subarray(0, poolTop)); pool = np;
    }
    pool.copyWithin(poolTop, tOff[v], tOff[v] + tCnt[v]);
    tOff[v] = poolTop; tCap[v] = cap; poolTop += cap;
  };

  // ---- quadrics ----
  const Q = new Float64Array(W * QS); // generalized quadric per render vertex
  const PQ = new Float64Array(V * 10); // 3D edge-constraint quadric per position
  const p0 = new Float64Array(D), e1 = new Float64Array(D), e2 = new Float64Array(D);
  for (let t = 0; t < T; t++) {
    if (triDead[t]) {continue;}
    const a = triW[3 * t] * D, b = triW[3 * t + 1] * D, c = triW[3 * t + 2] * D;
    let l1 = 0;
    for (let k = 0; k < D; k++) { p0[k] = X[a + k]; e1[k] = X[b + k] - X[a + k]; l1 += e1[k] * e1[k]; }
    l1 = Math.sqrt(l1); if (l1 < 1e-20) {continue;}
    let d12 = 0;
    for (let k = 0; k < D; k++) { e1[k] /= l1; e2[k] = X[c + k] - X[a + k]; d12 += e2[k] * e1[k]; }
    let l2 = 0;
    for (let k = 0; k < D; k++) { e2[k] -= d12 * e1[k]; l2 += e2[k] * e2[k]; }
    l2 = Math.sqrt(l2); if (l2 < 1e-20) {continue;}
    for (let k = 0; k < D; k++) {e2[k] /= l2;}
    // Area weight from the 3D part.
    const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2];
    const vx = X[c] - X[a], vy = X[c + 1] - X[a + 1], vz = X[c + 2] - X[a + 2];
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    let pe1 = 0, pe2 = 0, pp = 0;
    for (let k = 0; k < D; k++) { pe1 += p0[k] * e1[k]; pe2 += p0[k] * e2[k]; pp += p0[k] * p0[k]; }
    for (let corner = 0; corner < 3; corner++) {
      const q = triW[3 * t + corner] * QS;
      let m = 0;
      for (let i = 0; i < D; i++) {for (let j = i; j < D; j++) {
        Q[q + m++] += area * ((i === j ? 1 : 0) - e1[i] * e1[j] - e2[i] * e2[j]);
      }}
      for (let i = 0; i < D; i++) {Q[q + AQ + i] += area * (pe1 * e1[i] + pe2 * e2[i] - p0[i]);}
      Q[q + AQ + D] += area * (pp - pe1 * pe1 - pe2 * pe2);
    }
  }

  // ---- edge classification and vertex kinds (static) ----
  const kind = new Uint8Array(V);
  const special = new Int32Array(V), edges = new Int32Array(V), multiW = new Uint8Array(V);
  const wedgeOf = (t, v) => {
    const b = 3 * t;
    if (wPos[triW[b]] === v) {return triW[b];}
    if (wPos[triW[b + 1]] === v) {return triW[b + 1];}
    if (wPos[triW[b + 2]] === v) {return triW[b + 2];}
    return -1;
  };
  const addEdgePlane = (a, b, t) => {
    // plane through edge ab, perpendicular to triangle t
    const A = vRep[a] * D, B = vRep[b] * D;
    const ex = X[B] - X[A], ey = X[B + 1] - X[A + 1], ez = X[B + 2] - X[A + 2];
    const w0 = triW[3 * t] * D, w1 = triW[3 * t + 1] * D, w2 = triW[3 * t + 2] * D;
    const ux = X[w1] - X[w0], uy = X[w1 + 1] - X[w0 + 1], uz = X[w1 + 2] - X[w0 + 2];
    const vx = X[w2] - X[w0], vy = X[w2 + 1] - X[w0 + 1], vz = X[w2 + 2] - X[w0 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
    const nl = Math.hypot(nx, ny, nz); if (nl < 1e-30) {return;}
    nx /= nl; ny /= nl; nz /= nl;
    const d = -(nx * X[A] + ny * X[A + 1] + nz * X[A + 2]);
    const w = edgeWeight * (ex * ex + ey * ey + ez * ez);
    for (let s = 0; s < 2; s++) {
      const q = (s === 0 ? a : b) * 10;
      PQ[q] += w * nx * nx; PQ[q + 1] += w * nx * ny; PQ[q + 2] += w * nx * nz;
      PQ[q + 3] += w * ny * ny; PQ[q + 4] += w * ny * nz; PQ[q + 5] += w * nz * nz;
      PQ[q + 6] += w * nx * d; PQ[q + 7] += w * ny * d; PQ[q + 8] += w * nz * d; PQ[q + 9] += w * d * d;
    }
  };
  {
    // Edges from the per-vertex triangle lists: for each vertex a, its
    // neighbours b with the triangles shared with each (at most 3 kept).
    const mark = new Int32Array(V).fill(-1), slot = new Int32Array(V);
    let nb = new Int32Array(64), cnt = new Int32Array(64), tl = new Int32Array(192);
    for (let a = 0; a < V; a++) {
      const o = tOff[a], n = tCnt[a];
      if (nb.length < 2 * n) { nb = new Int32Array(4 * n); cnt = new Int32Array(4 * n); tl = new Int32Array(12 * n); }
      let nn = 0;
      for (let i = 0; i < n; i++) {
        const t = pool[o + i];
        for (let c = 0; c < 3; c++) {
          const x = wPos[triW[3 * t + c]];
          if (x === a) {continue;}
          if (mark[x] !== a) { mark[x] = a; slot[x] = nn; nb[nn] = x; cnt[nn] = 0; nn++; }
          const sl = slot[x];
          if (cnt[sl] < 3) {tl[3 * sl + cnt[sl]] = t;}
          cnt[sl]++;
        }
      }
      edges[a] += nn;
      for (let sl = 0; sl < nn; sl++) {
        const b = nb[sl];
        if (b < a) {continue;}
        const m = cnt[sl];
        if (m > 2) { kind[a] = LOCKED; kind[b] = LOCKED; continue; }
        const t0 = tl[3 * sl], t1 = tl[3 * sl + 1];
        const isSpecial = m === 1 || wedgeOf(t0, a) !== wedgeOf(t1, a) || wedgeOf(t0, b) !== wedgeOf(t1, b);
        if (isSpecial) { special[a]++; special[b]++; addEdgePlane(a, b, t0); if (m === 2) {addEdgePlane(a, b, t1);} }
      }
    }
    for (let v = 0; v < V; v++) {
      let first = -1;
      const o = tOff[v], n = tCnt[v];
      for (let i = 0; i < n; i++) { const w = wedgeOf(pool[o + i], v); if (first < 0) {first = w;} else if (w !== first) {multiW[v] = 1;} }
      if (kind[v] === LOCKED) {continue;}
      if (n === 0) { kind[v] = LOCKED; continue; }
      if (special[v] === 0) {kind[v] = !multiW[v] && edges[v] === n ? INTERIOR : LOCKED;}
      else if (special[v] === 2 && (edges[v] === n || edges[v] === n + 1)) {kind[v] = SPECIAL;}
      else {kind[v] = LOCKED;}
    }
  }

  // ---- candidate evaluation (typed scratch, no allocation per move) ----
  let stamp = new Int32Array(V); let stampId = 1;
  const best = new Int32Array(V).fill(-1);
  // runner-up move per vertex (target and cost, geometry not yet checked)
  const second = new Int32Array(V).fill(-1), secondCost = new Float64Array(V);
  const vDead = new Uint8Array(V);
  const heap = new IndexedHeap(V);
  const MAXW = 64;
  const mapFrom = new Int32Array(MAXW), mapTo = new Int32Array(MAXW); let mapN = 0;
  const uWedges = new Int32Array(MAXW); let uwN = 0;
  const tsBuf = new Int32Array(3); let tsN = 0;
  const nMark = new Int32Array(V), nSlot = new Int32Array(V); let nMarkId = 0;
  let sCnt = new Int32Array(256), sT = new Int32Array(512);
  let nbr = new Int32Array(256), cCost = new Float64Array(256), cV = new Int32Array(256);
  let touched = new Int32Array(256);
  /** The quadric at Q[q..] evaluated at render vertex w's feature point. */
  const evalQ = (q, w) => {
    const x = w * D;
    let s = 0, m = q;
    for (let i = 0; i < D; i++) {
      const xi = X[x + i];
      s += Q[m++] * xi * xi;
      for (let j = i + 1; j < D; j++) {s += 2 * Q[m++] * xi * X[x + j];}
    }
    for (let i = 0; i < D; i++) {s += 2 * Q[q + AQ + i] * X[x + i];}
    return s + Q[q + AQ + D];
  };
  // A target's own quadric at its own point is the same for every move onto
  // it: cached per render vertex (SELF) and per position (PSELF), refreshed
  // when a collapse adds to that quadric.
  const SELF = new Float64Array(W), PSELF = new Float64Array(V);
  const selfOf = (w) => evalQ(w * QS, w);
  const pselfOf = (v) => {
    const a = v * 10, x = PX[3 * v], y = PX[3 * v + 1], z = PX[3 * v + 2];
    return PQ[a] * x * x + 2 * PQ[a + 1] * x * y + 2 * PQ[a + 2] * x * z + PQ[a + 3] * y * y + 2 * PQ[a + 4] * y * z +
      PQ[a + 5] * z * z + 2 * (PQ[a + 6] * x + PQ[a + 7] * y + PQ[a + 8] * z) + PQ[a + 9];
  };
  for (let w = 0; w < W; w++) {SELF[w] = selfOf(w);}
  for (let v = 0; v < V; v++) {PSELF[v] = pselfOf(v);}
  const mapOf = (w) => { for (let i = 0; i < mapN; i++) {if (mapFrom[i] === w) {return mapTo[i];}} return -1; };

  const evalPQu = (u, v) => {
    const a = u * 10;
    const x = PX[3 * v], y = PX[3 * v + 1], z = PX[3 * v + 2];
    return PQ[a] * x * x + 2 * PQ[a + 1] * x * y + 2 * PQ[a + 2] * x * z + PQ[a + 3] * y * y + 2 * PQ[a + 4] * y * z +
      PQ[a + 5] * z * z + 2 * (PQ[a + 6] * x + PQ[a + 7] * y + PQ[a + 8] * z) + PQ[a + 9];
  };

  /** Drop dead triangles from x's list in place; returns the live count. */
  const live = (x) => {
    const o = tOff[x], n = tCnt[x];
    let j = 0;
    for (let i = 0; i < n; i++) { const t = pool[o + i]; if (!triDead[t]) {pool[o + j++] = t;} }
    tCnt[x] = j;
    return j;
  };
  const collectUWedges = (u) => {
    uwN = 0;
    const o = tOff[u], n = tCnt[u];
    for (let i = 0; i < n; i++) {
      const w = wedgeOf(pool[o + i], u);
      let seen = false;
      for (let k = 0; k < uwN; k++) {if (uWedges[k] === w) { seen = true; break; }}
      if (!seen && uwN < MAXW) {uWedges[uwN++] = w;}
    }
  };

  /** Fill the wedge map and tsBuf for u -> v (u's list live, its wedges
   *  in uWedges); false when not allowed. */
  const buildMap = (u, v) => {
    tsN = 0;
    const o = tOff[u], n = tCnt[u];
    for (let i = 0; i < n; i++) {
      const t = pool[o + i];
      if (wPos[triW[3 * t]] === v || wPos[triW[3 * t + 1]] === v || wPos[triW[3 * t + 2]] === v) {
        if (tsN === 2) {return false;}
        tsBuf[tsN++] = t;
      }
    }
    return mapShared(u, v);
  };
  /** The rest of buildMap, with the shared triangles already in tsBuf. */
  const mapShared = (u, v) => {
    if (tsN === 0) {return false;}
    mapN = 0;
    const isSpecialEdge = tsN === 1 ||
      wedgeOf(tsBuf[0], u) !== wedgeOf(tsBuf[1], u) || wedgeOf(tsBuf[0], v) !== wedgeOf(tsBuf[1], v);
    if (kind[u] === INTERIOR) {
      if (isSpecialEdge) {return false;}
    } else if (!isSpecialEdge) {return false;}
    for (let i = 0; i < tsN; i++) {
      const t = tsBuf[i];
      const wu = wedgeOf(t, u), wv = wedgeOf(t, v);
      const at = mapOf(wu);
      if (at >= 0) { if (at !== wv) {return false;} } else { mapFrom[mapN] = wu; mapTo[mapN] = wv; mapN++; }
    }
    return mapN === uwN; // every wedge u uses is mapped
  };

  const costOf = (u, v) => {
    // accumulated quadric error at the target, summed over target wedges
    let s = evalPQu(u, v) + PSELF[v];
    for (let i = 0; i < mapN; i++) {
      let seenBefore = false;
      for (let j = 0; j < i; j++) {if (mapTo[j] === mapTo[i]) {seenBefore = true;}}
      if (seenBefore) {continue;}
      const wv = mapTo[i];
      s += SELF[wv];
      for (let j = 0; j < mapN; j++) {if (mapTo[j] === wv) {s += evalQ(mapFrom[j] * QS, wv);}}
    }
    return Math.max(0, s);
  };

  const geometryOk = (u, v) => {
    // link condition: common neighbours == third vertices of tsBuf
    stampId++;
    const uo = tOff[u], un = tCnt[u];
    for (let i = 0; i < un; i++) {
      const t = pool[uo + i];
      stamp[wPos[triW[3 * t]]] = stampId; stamp[wPos[triW[3 * t + 1]]] = stampId; stamp[wPos[triW[3 * t + 2]]] = stampId;
    }
    let common = 0;
    stampId++;
    const mark = stampId;
    const vn = live(v), vo = tOff[v];
    for (let i = 0; i < vn; i++) {
      const t = pool[vo + i];
      for (let c = 0; c < 3; c++) {
        const x = wPos[triW[3 * t + c]];
        if (x !== u && x !== v && stamp[x] === mark - 1) { stamp[x] = mark; common++; }
      }
    }
    if (common !== tsN) {return false;}
    // flip / turn check
    const vx = PX[3 * v], vy = PX[3 * v + 1], vz = PX[3 * v + 2];
    const ux = PX[3 * u], uy = PX[3 * u + 1], uz = PX[3 * u + 2];
    for (let i = 0; i < un; i++) {
      const t = pool[uo + i];
      if (t === tsBuf[0] || (tsN > 1 && t === tsBuf[1])) {continue;}
      const q0 = wPos[triW[3 * t]], q1 = wPos[triW[3 * t + 1]], q2 = wPos[triW[3 * t + 2]];
      const a = q0 === u ? q1 : q1 === u ? q2 : q0;
      const b = q0 === u ? q2 : q1 === u ? q0 : q1;
      const ax = PX[3 * a], ay = PX[3 * a + 1], az = PX[3 * a + 2], bx = PX[3 * b], by = PX[3 * b + 1], bz = PX[3 * b + 2];
      // old normal (u,a,b), new normal (v,a,b)
      let e1x = ax - ux, e1y = ay - uy, e1z = az - uz, e2x = bx - ux, e2y = by - uy, e2z = bz - uz;
      const ox = e1y * e2z - e1z * e2y, oy = e1z * e2x - e1x * e2z, oz = e1x * e2y - e1y * e2x;
      e1x = ax - vx; e1y = ay - vy; e1z = az - vz; e2x = bx - vx; e2y = by - vy; e2z = bz - vz;
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const lo2 = Math.sqrt(ox * ox + oy * oy + oz * oz), ln = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (ln === 0 || ln < 1e-8 * lo2) {return false;}
      if (ox * nx + oy * ny + oz * nz < cosTurn * lo2 * ln) {return false;}
      if (SN !== null) {
        // the new face must not face away from its corners' shading normals
        let sx = 0, sy = 0, sz = 0;
        for (let c = 0; c < 3; c++) {
          let w = triW[3 * t + c];
          if (wPos[w] === u) {w = mapOf(w);}
          sx += SN[3 * w]; sy += SN[3 * w + 1]; sz += SN[3 * w + 2];
        }
        if (nx * sx + ny * sy + nz * sz <= 0) {return false;}
      }
    }
    return true;
  };

  const loadShared = (sl) => { if (sCnt[sl] > 2) { tsN = 0; return; } tsN = sCnt[sl]; tsBuf[0] = sT[2 * sl]; tsBuf[1] = sT[2 * sl + 1]; };
  const candidate = (u) => {
    best[u] = -1; second[u] = -1;
    heap.remove(u);
    if (vDead[u] || kind[u] === LOCKED) {return;}
    const un = live(u), uo = tOff[u];
    collectUWedges(u);
    // one pass over u's triangles: each neighbour with the triangles it shares
    nMarkId++;
    let nn = 0;
    if (nbr.length < 3 * un) { nbr = new Int32Array(6 * un); cCost = new Float64Array(6 * un); cV = new Int32Array(6 * un); sCnt = new Int32Array(6 * un); sT = new Int32Array(12 * un); }
    for (let i = 0; i < un; i++) {
      const t = pool[uo + i];
      for (let c = 0; c < 3; c++) {
        const x = wPos[triW[3 * t + c]];
        if (x === u) {continue;}
        let sl;
        if (nMark[x] !== nMarkId) { nMark[x] = nMarkId; nSlot[x] = sl = nn; nbr[nn] = x; sCnt[nn] = 0; nn++; } else {sl = nSlot[x];}
        if (sCnt[sl] < 2) {sT[2 * sl + sCnt[sl]] = t;}
        sCnt[sl]++;
      }
    }
    let cn = 0;
    for (let i = 0; i < nn; i++) {
      const v = nbr[i];
      loadShared(i);
      if (!mapShared(u, v)) {continue;}
      cCost[cn] = costOf(u, v); cV[cn] = i; cn++;
    }
    // try cheapest first (selection; lists are short)
    while (cn > 0) {
      let m = 0;
      for (let i = 1; i < cn; i++) {if (cCost[i] < cCost[m]) {m = i;}}
      const c = cCost[m], sl = cV[m], v = nbr[sl];
      cn--; cCost[m] = cCost[cn]; cV[m] = cV[cn];
      loadShared(sl); mapShared(u, v);
      if (geometryOk(u, v)) {
        best[u] = v;
        heap.set(u, c);
        if (cn > 0) {
          let r = 0;
          for (let i = 1; i < cn; i++) {if (cCost[i] < cCost[r]) {r = i;}}
          second[u] = nbr[cV[r]]; secondCost[u] = cCost[r];
        }
        return;
      }
    }
  };

  for (let u = 0; u < V; u++) {candidate(u);}

  // ---- collapse loop ----
  const wParent = new Int32Array(W).fill(-1);
  const wStep = new Int32Array(W).fill(0x7fffffff);
  let alive = 0; for (let t = 0; t < T; t++) {if (!triDead[t]) {alive++;}}
  let stepAlive = new Int32Array(Math.max(16, V + 1)), stepError = new Float64Array(Math.max(16, V + 1));
  stepAlive[0] = alive; stepError[0] = 0;
  let step = 0, maxErr = 0;
  while (heap.size > 0) {
    const key = heap.key[heap.h[0]];
    const u = heap.pop();
    if (vDead[u] || best[u] < 0) {continue;}
    const v = best[u];
    live(u);
    collectUWedges(u);
    if (vDead[v] || !buildMap(u, v) || !geometryOk(u, v)) { candidate(u); continue; }
    const cost = costOf(u, v);
    if (cost > key * 1.0001 + 1e-18) { candidate(u); continue; } // stale, re-queue
    step++;
    for (let i = 0; i < tsN; i++) { const t = tsBuf[i]; triDead[t] = 1; triDeath[t] = step; alive--; }
    // quadrics
    for (let i = 0; i < mapN; i++) {
      const a = mapFrom[i] * QS, b = mapTo[i] * QS;
      for (let k = 0; k < QS; k++) {Q[b + k] += Q[a + k];}
      wParent[mapFrom[i]] = mapTo[i]; wStep[mapFrom[i]] = step;
    }
    for (let k = 0; k < 10; k++) {PQ[v * 10 + k] += PQ[u * 10 + k];}
    PSELF[v] = pselfOf(v);
    for (let i = 0; i < mapN; i++) {SELF[mapTo[i]] = selfOf(mapTo[i]);}
    // remap corners and move u's surviving triangles to v's list
    const vn0 = live(v);
    const un = tCnt[u];
    reserve(v, vn0 + un);
    const uo = tOff[u];
    let vn = vn0;
    for (let i = 0; i < un; i++) {
      const t = pool[uo + i];
      if (triDead[t]) {continue;}
      for (let c = 0; c < 3; c++) {
        const w = triW[3 * t + c];
        if (wPos[w] === u) {triW[3 * t + c] = mapOf(w);}
      }
      pool[tOff[v] + vn++] = t;
    }
    tCnt[v] = vn;
    vDead[u] = 1; tCnt[u] = 0;
    maxErr = Math.max(maxErr, Math.sqrt(cost));
    if (step >= stepAlive.length) {
      const a2 = new Int32Array(stepAlive.length * 2); a2.set(stepAlive); stepAlive = a2;
      const e2b = new Float64Array(stepError.length * 2); e2b.set(stepError); stepError = e2b;
    }
    stepAlive[step] = alive; stepError[step] = maxErr;
    if (opts.onProgress && step % 2048 === 0) {opts.onProgress(alive);}
    // re-evaluate v and its neighbours
    stampId++;
    let nt = 0;
    if (touched.length < 3 * vn + 1) {touched = new Int32Array(6 * vn + 2);}
    touched[nt++] = v; stamp[v] = stampId;
    const vo = tOff[v];
    for (let i = 0; i < vn; i++) {
      const t = pool[vo + i];
      for (let c = 0; c < 3; c++) { const x = wPos[triW[3 * t + c]]; if (stamp[x] !== stampId) { stamp[x] = stampId; touched[nt++] = x; } }
    }
    // v's moves all changed. A neighbour's moves changed only towards v (its
    // other edges keep their cost), so it is fully re-evaluated only when its
    // best move pointed at u or v, or it had none; otherwise only x -> v is
    // priced. A best move made invalid by this collapse is caught at pop.
    candidate(v);
    for (let i = 1; i < nt; i++) {
      const x = touched[i];
      if (vDead[x] || kind[x] === LOCKED) {continue;}
      const bx = best[x];
      if (bx < 0) { candidate(x); continue; }
      live(x); collectUWedges(x);
      const ok = buildMap(x, v);
      const c = ok ? costOf(x, v) : Infinity;
      // the runner-up is kept current for moves onto v (u is now v)
      if (second[x] === u || second[x] === v) { second[x] = ok ? v : -1; secondCost[x] = c; }
      if (bx === u || bx === v) {
        // best move gone or repriced: the cheaper of x -> v and the runner-up
        const s2 = second[x] === v ? -1 : second[x], c2 = s2 < 0 ? Infinity : secondCost[x];
        if (ok && c <= c2) {
          if (geometryOk(x, v)) { best[x] = v; heap.set(x, c); second[x] = s2; secondCost[x] = c2; continue; }
        } else if (s2 >= 0 && !vDead[s2]) {
          if (buildMap(x, s2) && geometryOk(x, s2)) {
            const cs = costOf(x, s2);
            best[x] = s2; heap.set(x, cs);
            if (ok) { second[x] = v; secondCost[x] = c; } else {second[x] = -1;}
            continue;
          }
        }
        candidate(x);
        continue;
      }
      if (!ok) {continue;}
      if (c < heap.key[x]) {
        if (geometryOk(x, v)) { second[x] = bx; secondCost[x] = heap.key[x]; best[x] = v; heap.set(x, c); }
      } else if (second[x] < 0 || c < secondCost[x]) { second[x] = v; secondCost[x] = c; }
    }
  }
  stamp = null;

  // Triangles ordered so that any level's live triangles are a prefix.
  // (counting sort by death step, latest first, stable in t)
  const never = step + 1; // triangles alive at the floor sort first
  const bucket = new Int32Array(never + 2);
  let kept = 0;
  for (let t = 0; t < T; t++) {if (triDeath[t] >= 0) { bucket[never - Math.min(triDeath[t], never)]++; kept++; }}
  for (let i = 0, acc = 0; i < bucket.length; i++) { const c = bucket[i]; bucket[i] = acc; acc += c; }
  const order = new Uint32Array(kept);
  for (let t = 0; t < T; t++) {if (triDeath[t] >= 0) {order[bucket[never - Math.min(triDeath[t], never)]++] = t;}}
  return {
    vertexCount: W, triangleCount: alive === 0 ? 0 : stepAlive[0], diag,
    indices: I, order, triDeath,
    wParent, wStep,
    stepAlive: stepAlive.slice(0, step + 1), stepError: stepError.slice(0, step + 1),
    minTriangles: stepAlive[step],
  };
}


/** The number of collapse steps whose result has at most `targetTris`. */
export function stepsFor(prog, targetTris) {
  const a = prog.stepAlive;
  let lo = 0, hi = a.length - 1; // a is non-increasing
  if (a[hi] > targetTris) {return hi;}
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= targetTris) {hi = m;} else {lo = m + 1;} }
  return lo;
}

/** The index buffer of the level after `steps` collapses, into the
 *  original vertex buffer. Its triangles are a prefix of `prog.order`. */
export function levelIndices(prog, steps) {
  const { order, triDeath, indices, wParent, wStep } = prog;
  let n = 0;
  while (n < order.length && triDeath[order[n]] > steps) {n++;}
  const out = new Uint32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = order[i];
    for (let c = 0; c < 3; c++) {
      let w = indices[3 * t + c];
      while (wStep[w] <= steps) {w = wParent[w];}
      out[3 * i + c] = w;
    }
  }
  return out;
}

// ---- sampled surface distance, for the error readout ----
// Sampled symmetric surface distance between two triangle meshes sharing
// one coordinate frame. Returns mean and max (an estimate of Hausdorff) of
// both directions, in model units.

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function samplePoints(P, I, n, seed) {
  const T = I.length / 3, cum = new Float64Array(T);
  let total = 0;
  for (let t = 0; t < T; t++) {
    const a = I[3 * t] * 3, b = I[3 * t + 1] * 3, c = I[3 * t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    total += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    cum[t] = total;
  }
  const r = rng(seed), out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = r() * total;
    let lo = 0, hi = T - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) {lo = m + 1;} else {hi = m;} }
    let s = r(), q = r(); if (s + q > 1) { s = 1 - s; q = 1 - q; }
    const a = I[3 * lo] * 3, b = I[3 * lo + 1] * 3, c = I[3 * lo + 2] * 3;
    for (let k = 0; k < 3; k++) {out[3 * i + k] = P[a + k] + s * (P[b + k] - P[a + k]) + q * (P[c + k] - P[a + k]);}
  }
  return out;
}

// Ericson, closest point on triangle; returns squared distance.
function pointTri2(px, py, pz, P, a, b, c) {
  const ax = P[a], ay = P[a + 1], az = P[a + 2];
  const abx = P[b] - ax, aby = P[b + 1] - ay, abz = P[b + 2] - az;
  const acx = P[c] - ax, acy = P[c + 1] - ay, acz = P[c + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx, qy, qz;
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
  else {
    const bpx = px - P[b], bpy = py - P[b + 1], bpz = pz - P[b + 2];
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = px - P[c], cpy = py - P[c + 1], cpz = pz - P[c + 2];
    const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) { qx = P[b]; qy = P[b + 1]; qz = P[b + 2]; }
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + v * abx; qy = ay + v * aby; qz = az + v * abz; }
    else if (d6 >= 0 && d5 <= d6) { qx = P[c]; qy = P[c + 1]; qz = P[c + 2]; }
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = ax + w * acx; qy = ay + w * acy; qz = az + w * acz; }
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      qx = P[b] + w * (P[c] - P[b]); qy = P[b + 1] + w * (P[c + 1] - P[b + 1]); qz = P[b + 2] + w * (P[c + 2] - P[b + 2]);
    } else {
      const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
      qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w;
    }
  }
  return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
}

class TriGrid {
  constructor(P, I) {
    this.P = P; this.I = I;
    const T = I.length / 3;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const i of I) {for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[3 * i + k]); hi[k] = Math.max(hi[k], P[3 * i + k]); }}
    const ext = [0, 1, 2].map((k) => hi[k] - lo[k] || 1e-9);
    const vol = ext[0] * ext[1] * ext[2];
    const cell = Math.cbrt(vol / Math.max(1, T / 2)) || Math.max(...ext) / 16;
    this.cell = cell; this.lo = lo;
    this.n = ext.map((e) => Math.max(1, Math.ceil(e / cell)));
    this.cells = new Map();
    for (let t = 0; t < T; t++) {
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let c = 0; c < 3; c++) {for (let k = 0; k < 3; k++) { const x = P[3 * I[3 * t + c] + k]; mn[k] = Math.min(mn[k], x); mx[k] = Math.max(mx[k], x); }}
      const a = mn.map((x, k) => this.ci(x, k)), b = mx.map((x, k) => this.ci(x, k));
      for (let i = a[0]; i <= b[0]; i++) {for (let j = a[1]; j <= b[1]; j++) {for (let l = a[2]; l <= b[2]; l++) {
        const key = (i * this.n[1] + j) * this.n[2] + l;
        let list = this.cells.get(key); if (!list) {this.cells.set(key, (list = []));} list.push(t);
      }}}
    }
    this.mark = new Int32Array(T); this.stamp = 0;
  }
  ci(x, k) { return Math.min(this.n[k] - 1, Math.max(0, Math.floor((x - this.lo[k]) / this.cell))); }
  nearest2(px, py, pz) {
    const c = [this.ci(px, 0), this.ci(py, 1), this.ci(pz, 2)];
    let best = Infinity; this.stamp++;
    const maxR = Math.max(...this.n);
    for (let r = 0; r <= maxR; r++) {
      // cells on the shell of radius r
      for (let i = c[0] - r; i <= c[0] + r; i++) {for (let j = c[1] - r; j <= c[1] + r; j++) {for (let l = c[2] - r; l <= c[2] + r; l++) {
        if (Math.max(Math.abs(i - c[0]), Math.abs(j - c[1]), Math.abs(l - c[2])) !== r) {continue;}
        if (i < 0 || j < 0 || l < 0 || i >= this.n[0] || j >= this.n[1] || l >= this.n[2]) {continue;}
        const list = this.cells.get((i * this.n[1] + j) * this.n[2] + l);
        if (!list) {continue;}
        for (const t of list) {
          if (this.mark[t] === this.stamp) {continue;} this.mark[t] = this.stamp;
          const d = pointTri2(px, py, pz, this.P, this.I[3 * t] * 3, this.I[3 * t + 1] * 3, this.I[3 * t + 2] * 3);
          if (d < best) { best = d; this.bestT = t; }
        }
      }}}
      // any point outside the searched cube is at least r*cell away
      if (best < (r * this.cell) ** 2) {break;}
    }
    return Math.sqrt(best);
  }
}

/** @returns {{ mean: number, max: number }} symmetric, model units */
export function surfaceDistance(PA, IA, PB, IB, samples = 20000) {
  const ga = new TriGrid(PA, IA), gb = new TriGrid(PB, IB);
  const sa = samplePoints(PA, IA, samples, 1), sb = samplePoints(PB, IB, samples, 2);
  let sum = 0, max = 0;
  for (let i = 0; i < samples; i++) { const d = gb.nearest2(sa[3 * i], sa[3 * i + 1], sa[3 * i + 2]); sum += d; if (d > max) {max = d;} }
  for (let i = 0; i < samples; i++) { const d = ga.nearest2(sb[3 * i], sb[3 * i + 1], sb[3 * i + 2]); sum += d; if (d > max) {max = d;} }
  return { mean: sum / (2 * samples), max };
}

