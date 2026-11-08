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

/** Merge render vertices that are equal in position and texture
 *  coordinate (and extra attributes), and whose normals differ by at most
 *  `normalAngleDeg`. Exporters often split vertices on float noise, which
 *  would lock a seam everywhere.
 *  @returns {{ remap: Uint32Array, count: number, indices: Uint32Array }} */
export function weldVertices(attrs, indices, normalAngleDeg = 2) {
  const n = attrs.position.length / 3;
  const exact = [attrs.position, attrs.uv, ...(attrs.exact ?? [])].filter(Boolean);
  const sizes = exact.map((a) => a.length / n);
  const cosMax = Math.cos((normalAngleDeg * Math.PI) / 180);
  const groups = new Map();
  const remap = new Uint32Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    let key = "";
    for (let a = 0; a < exact.length; a++) {
      const s = sizes[a];
      for (let c = 0; c < s; c++) {key += exact[a][i * s + c] + ",";}
    }
    let list = groups.get(key);
    if (list === undefined) {groups.set(key, (list = []));}
    let found = -1;
    if (attrs.normal) {
      const N = attrs.normal;
      for (const j of list) {
        const d = N[3 * i] * N[3 * j] + N[3 * i + 1] * N[3 * j + 1] + N[3 * i + 2] * N[3 * j + 2];
        if (d >= cosMax) { found = j; break; }
      }
    } else if (list.length > 0) {found = list[0];}
    if (found >= 0) {remap[i] = remap[found];}
    else { list.push(i); remap[i] = count++; }
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

// ---- small binary min-heap of (cost, vertex, version) -------------------
class Heap {
  constructor() { this.c = []; this.v = []; this.s = []; }
  get size() { return this.c.length; }
  push(cost, vert, stamp) {
    const c = this.c, v = this.v, s = this.s;
    let i = c.length;
    c.push(cost); v.push(vert); s.push(stamp);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (c[p] <= cost) {break;}
      c[i] = c[p]; v[i] = v[p]; s[i] = s[p];
      i = p;
    }
    c[i] = cost; v[i] = vert; s[i] = stamp;
  }
  pop(out) {
    const c = this.c, v = this.v, s = this.s;
    out[0] = c[0]; out[1] = v[0]; out[2] = s[0];
    const lc = c.pop(), lv = v.pop(), ls = s.pop();
    const n = c.length;
    if (n === 0) {return;}
    let i = 0;
    for (;;) {
      let m = 2 * i + 1;
      if (m >= n) {break;}
      if (m + 1 < n && c[m + 1] < c[m]) {m++;}
      if (c[m] >= lc) {break;}
      c[i] = c[m]; v[i] = v[m]; s[i] = s[m];
      i = m;
    }
    c[i] = lc; v[i] = lv; s[i] = ls;
  }
}

const INTERIOR = 0, SPECIAL = 1, LOCKED = 2;

/**
 * Build the full collapse sequence once; any level is then extracted with
 * `levelIndices`.
 * @param {{ positions: Float32Array, indices: Uint32Array,
 *   attributes?: { data: Float32Array, size: number, weight: number }[] }} mesh
 * @param {{ maxTurnDeg?: number, edgeWeight?: number, onProgress?: (alive:number)=>void }} [opts]
 */
export function buildProgressive(mesh, opts = {}) {
  const P = mesh.positions, I = mesh.indices;
  const W = P.length / 3, T = I.length / 3;
  const attrs = mesh.attributes ?? [];
  const D = 3 + attrs.reduce((s, a) => s + a.size, 0);
  const AQ = (D * (D + 1)) / 2, QS = AQ + D + 1;
  const cosTurn = Math.cos(((opts.maxTurnDeg ?? 45) * Math.PI) / 180);
  const SN = opts.normals ?? null; // shading normals per render vertex, for the facing check
  const edgeWeight = opts.edgeWeight ?? 4;

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
  const posMap = new Map();
  let V = 0;
  for (let i = 0; i < W; i++) {
    const k = P[3 * i] + "," + P[3 * i + 1] + "," + P[3 * i + 2];
    let id = posMap.get(k);
    if (id === undefined) {posMap.set(k, (id = V++));}
    wPos[i] = id;
  }
  const vRep = new Int32Array(V).fill(-1); // a render vertex at that position
  for (let i = 0; i < W; i++) {if (vRep[wPos[i]] < 0) {vRep[wPos[i]] = i;}}
  const px = (v, c) => X[vRep[v] * D + c];

  const triW = new Int32Array(I); // corners as render vertices (mutable)
  const triDead = new Uint8Array(T);
  const triDeath = new Int32Array(T).fill(0x7fffffff);
  const vTris = Array.from({ length: V }, () => []);
  for (let t = 0; t < T; t++) {
    const a = wPos[triW[3 * t]], b = wPos[triW[3 * t + 1]], c = wPos[triW[3 * t + 2]];
    if (a === b || b === c || a === c) { triDead[t] = 1; triDeath[t] = -1; continue; }
    vTris[a].push(t); vTris[b].push(t); vTris[c].push(t);
  }

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
    for (let c = 0; c < 3; c++) {if (wPos[triW[3 * t + c]] === v) {return triW[3 * t + c];}}
    return -1;
  };
  const addEdgePlane = (a, b, t) => {
    // plane through edge ab, perpendicular to triangle t
    const A = vRep[a] * D, B = vRep[b] * D;
    const ex = X[B] - X[A], ey = X[B + 1] - X[A + 1], ez = X[B + 2] - X[A + 2];
    const [w0, w1, w2] = [triW[3 * t] * D, triW[3 * t + 1] * D, triW[3 * t + 2] * D];
    const ux = X[w1] - X[w0], uy = X[w1 + 1] - X[w0 + 1], uz = X[w1 + 2] - X[w0 + 2];
    const vx = X[w2] - X[w0], vy = X[w2 + 1] - X[w0 + 1], vz = X[w2 + 2] - X[w0 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
    const nl = Math.hypot(nx, ny, nz); if (nl < 1e-30) {return;}
    nx /= nl; ny /= nl; nz /= nl;
    const d = -(nx * X[A] + ny * X[A + 1] + nz * X[A + 2]);
    const w = edgeWeight * (ex * ex + ey * ey + ez * ez);
    for (const v of [a, b]) {
      const q = v * 10;
      PQ[q] += w * nx * nx; PQ[q + 1] += w * nx * ny; PQ[q + 2] += w * nx * nz;
      PQ[q + 3] += w * ny * ny; PQ[q + 4] += w * ny * nz; PQ[q + 5] += w * nz * nz;
      PQ[q + 6] += w * nx * d; PQ[q + 7] += w * ny * d; PQ[q + 8] += w * nz * d; PQ[q + 9] += w * d * d;
    }
  };
  {
    const edgeMap = new Map();
    for (let t = 0; t < T; t++) {
      if (triDead[t]) {continue;}
      for (let e = 0; e < 3; e++) {
        const a = wPos[triW[3 * t + e]], b = wPos[triW[3 * t + ((e + 1) % 3)]];
        const k = a < b ? a * V + b : b * V + a;
        let l = edgeMap.get(k); if (l === undefined) {edgeMap.set(k, (l = []));}
        l.push(t);
      }
    }
    for (const [k, ts] of edgeMap) {
      const a = Math.floor(k / V), b = k % V;
      edges[a]++; edges[b]++;
      if (ts.length > 2) { kind[a] = LOCKED; kind[b] = LOCKED; continue; }
      const isSpecial = ts.length === 1 ||
        wedgeOf(ts[0], a) !== wedgeOf(ts[1], a) || wedgeOf(ts[0], b) !== wedgeOf(ts[1], b);
      if (isSpecial) { special[a]++; special[b]++; for (const t of ts) {addEdgePlane(a, b, t);} }
    }
    for (let v = 0; v < V; v++) {
      let first = -1;
      for (const t of vTris[v]) { const w = wedgeOf(t, v); if (first < 0) {first = w;} else if (w !== first) {multiW[v] = 1;} }
      if (kind[v] === LOCKED) {continue;}
      const nt = vTris[v].length;
      if (nt === 0) { kind[v] = LOCKED; continue; }
      if (special[v] === 0) {kind[v] = !multiW[v] && edges[v] === nt ? INTERIOR : LOCKED;}
      else if (special[v] === 2 && (edges[v] === nt || edges[v] === nt + 1)) {kind[v] = SPECIAL;}
      else {kind[v] = LOCKED;}
    }
  }

  // ---- candidate evaluation ----
  const stamp = new Int32Array(V); let stampId = 1;
  const version = new Int32Array(V);
  const best = new Int32Array(V).fill(-1);
  const vDead = new Uint8Array(V);
  const heap = new Heap();
  const mapFrom = [], mapTo = []; // scratch wedge map for one candidate
  const tsBuf = [];
  const tq = new Float64Array(QS);

  const evalTQ = (w) => {
    const x = w * D;
    let s = 0, m = 0;
    for (let i = 0; i < D; i++) {
      const xi = X[x + i];
      s += tq[m++] * xi * xi;
      for (let j = i + 1; j < D; j++) {s += 2 * tq[m++] * xi * X[x + j];}
    }
    for (let i = 0; i < D; i++) {s += 2 * tq[AQ + i] * X[x + i];}
    return s + tq[AQ + D];
  };
  const evalPQ = (u, v) => {
    const a = u * 10, b = v * 10;
    const x = px(v, 0), y = px(v, 1), z = px(v, 2);
    const q = (k) => PQ[a + k] + PQ[b + k];
    return q(0) * x * x + 2 * q(1) * x * y + 2 * q(2) * x * z + q(3) * y * y + 2 * q(4) * y * z +
      q(5) * z * z + 2 * (q(6) * x + q(7) * y + q(8) * z) + q(9);
  };

  /** vTris[x] with dead triangles dropped, in place. */
  const live = (x) => {
    const l = vTris[x];
    let j = 0;
    for (let i = 0; i < l.length; i++) {if (!triDead[l[i]]) {l[j++] = l[i];}}
    l.length = j;
    return l;
  };
  const uWedges = [];
  const collectUWedges = (u, ut) => {
    uWedges.length = 0;
    for (let i = 0; i < ut.length; i++) {
      const w = wedgeOf(ut[i], u);
      if (uWedges.indexOf(w) < 0) {uWedges.push(w);}
    }
  };

  /** Fill mapFrom/mapTo and tsBuf for u -> v (u's live list `ut`, its
   *  wedges in uWedges); false when not allowed. */
  const buildMap = (u, v, ut) => {
    tsBuf.length = 0;
    for (let i = 0; i < ut.length; i++) {
      const t = ut[i];
      if (wPos[triW[3 * t]] === v || wPos[triW[3 * t + 1]] === v || wPos[triW[3 * t + 2]] === v) {tsBuf.push(t);}
    }
    const n = tsBuf.length;
    if (n === 0 || n > 2) {return false;}
    mapFrom.length = 0; mapTo.length = 0;
    const isSpecialEdge = n === 1 ||
      wedgeOf(tsBuf[0], u) !== wedgeOf(tsBuf[1], u) || wedgeOf(tsBuf[0], v) !== wedgeOf(tsBuf[1], v);
    if (kind[u] === INTERIOR) {
      if (isSpecialEdge) {return false;}
    } else if (!isSpecialEdge) {return false;}
    for (let i = 0; i < n; i++) {
      const t = tsBuf[i];
      const wu = wedgeOf(t, u), wv = wedgeOf(t, v);
      const at = mapFrom.indexOf(wu);
      if (at >= 0) { if (mapTo[at] !== wv) {return false;} } else { mapFrom.push(wu); mapTo.push(wv); }
    }
    return mapFrom.length === uWedges.length; // every wedge u uses is mapped
  };

  const costOf = (u, v) => {
    // accumulated quadric error at the target, summed over target wedges
    let s = evalPQ(u, v);
    for (let i = 0; i < mapTo.length; i++) {
      let seenBefore = false;
      for (let j = 0; j < i; j++) {if (mapTo[j] === mapTo[i]) {seenBefore = true;}}
      if (seenBefore) {continue;}
      const wv = mapTo[i];
      for (let k = 0; k < QS; k++) {tq[k] = Q[wv * QS + k];}
      for (let j = 0; j < mapFrom.length; j++) {if (mapTo[j] === wv) {
        const q = mapFrom[j] * QS; for (let k = 0; k < QS; k++) {tq[k] += Q[q + k];}
      }}
      s += evalTQ(wv);
    }
    return Math.max(0, s);
  };

  const geometryOk = (u, v, ut) => {
    // link condition: common neighbours == third vertices of tsBuf
    stampId++;
    for (let i = 0; i < ut.length; i++) {
      const t = ut[i];
      stamp[wPos[triW[3 * t]]] = stampId; stamp[wPos[triW[3 * t + 1]]] = stampId; stamp[wPos[triW[3 * t + 2]]] = stampId;
    }
    let common = 0;
    stampId++;
    const mark = stampId;
    const vt = live(v);
    for (let i = 0; i < vt.length; i++) {
      const t = vt[i];
      for (let c = 0; c < 3; c++) {
        const x = wPos[triW[3 * t + c]];
        if (x !== u && x !== v && stamp[x] === mark - 1) { stamp[x] = mark; common++; }
      }
    }
    if (common !== tsBuf.length) {return false;}
    // flip / turn check
    const vx = px(v, 0), vy = px(v, 1), vz = px(v, 2);
    const ux = px(u, 0), uy = px(u, 1), uz = px(u, 2);
    for (let i = 0; i < ut.length; i++) {
      const t = ut[i];
      if (t === tsBuf[0] || t === tsBuf[1]) {continue;}
      const q0 = wPos[triW[3 * t]], q1 = wPos[triW[3 * t + 1]], q2 = wPos[triW[3 * t + 2]];
      const a = q0 === u ? q1 : q1 === u ? q2 : q0;
      const b = q0 === u ? q2 : q1 === u ? q0 : q1;
      const ax = px(a, 0), ay = px(a, 1), az = px(a, 2), bx = px(b, 0), by = px(b, 1), bz = px(b, 2);
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
          if (wPos[w] === u) {w = mapTo[mapFrom.indexOf(w)];}
          sx += SN[3 * w]; sy += SN[3 * w + 1]; sz += SN[3 * w + 2];
        }
        if (nx * sx + ny * sy + nz * sz <= 0) {return false;}
      }
    }
    return true;
  };

  const nbr = [], cCost = [], cV = [];
  const candidate = (u) => {
    best[u] = -1;
    if (vDead[u] || kind[u] === LOCKED) {return;}
    const ut = live(u);
    collectUWedges(u, ut);
    stampId++;
    nbr.length = 0;
    for (let i = 0; i < ut.length; i++) {
      const t = ut[i];
      for (let c = 0; c < 3; c++) {
        const x = wPos[triW[3 * t + c]];
        if (x !== u && stamp[x] !== stampId) { stamp[x] = stampId; nbr.push(x); }
      }
    }
    cCost.length = 0; cV.length = 0;
    for (let i = 0; i < nbr.length; i++) {
      const v = nbr[i];
      if (!buildMap(u, v, ut)) {continue;}
      cCost.push(costOf(u, v)); cV.push(v);
    }
    // try cheapest first (selection; lists are short)
    while (cCost.length > 0) {
      let m = 0;
      for (let i = 1; i < cCost.length; i++) {if (cCost[i] < cCost[m]) {m = i;}}
      const c = cCost[m], v = cV[m];
      cCost[m] = cCost[cCost.length - 1]; cV[m] = cV[cV.length - 1]; cCost.pop(); cV.pop();
      buildMap(u, v, ut);
      if (geometryOk(u, v, ut)) {
        best[u] = v; version[u]++;
        heap.push(c, u, version[u]);
        return;
      }
    }
  };

  for (let v = 0; v < V; v++) {live(v);}
  for (let u = 0; u < V; u++) {candidate(u);}

  // ---- collapse loop ----
  const wParent = new Int32Array(W).fill(-1);
  const wStep = new Int32Array(W).fill(0x7fffffff);
  let alive = 0; for (let t = 0; t < T; t++) {if (!triDead[t]) {alive++;}}
  const stepAlive = [alive], stepError = [0];
  const top = [0, 0, 0];
  const touched = [];
  let step = 0, maxErr = 0;
  while (heap.size > 0) {
    heap.pop(top);
    const u = top[1];
    if (top[2] !== version[u] || vDead[u] || best[u] < 0) {continue;}
    const v = best[u];
    const ut = live(u);
    collectUWedges(u, ut);
    if (vDead[v] || !buildMap(u, v, ut) || !geometryOk(u, v, ut)) { candidate(u); continue; }
    const cost = costOf(u, v);
    if (cost > top[0] * 1.0001 + 1e-18) { candidate(u); continue; } // stale, re-queue
    step++;
    for (const t of tsBuf) { triDead[t] = 1; triDeath[t] = step; alive--; }
    // quadrics
    for (let i = 0; i < mapFrom.length; i++) {
      const a = mapFrom[i] * QS, b = mapTo[i] * QS;
      for (let k = 0; k < QS; k++) {Q[b + k] += Q[a + k];}
      wParent[mapFrom[i]] = mapTo[i]; wStep[mapFrom[i]] = step;
    }
    for (let k = 0; k < 10; k++) {PQ[v * 10 + k] += PQ[u * 10 + k];}
    // remap corners
    const vt = live(v);
    for (let i = 0; i < ut.length; i++) {
      const t = ut[i];
      if (triDead[t]) {continue;}
      for (let c = 0; c < 3; c++) {
        const w = triW[3 * t + c];
        if (wPos[w] === u) {triW[3 * t + c] = mapTo[mapFrom.indexOf(w)];}
      }
      vt.push(t);
    }
    vDead[u] = 1; vTris[u] = [];
    maxErr = Math.max(maxErr, Math.sqrt(cost));
    stepAlive.push(alive); stepError.push(maxErr);
    if (opts.onProgress && step % 2048 === 0) {opts.onProgress(alive);}
    // re-evaluate v and its neighbours
    stampId++;
    touched.length = 0;
    touched.push(v); stamp[v] = stampId;
    for (let i = 0; i < vt.length; i++) {
      const t = vt[i];
      for (let c = 0; c < 3; c++) { const x = wPos[triW[3 * t + c]]; if (stamp[x] !== stampId) { stamp[x] = stampId; touched.push(x); } }
    }
    for (let i = 0; i < touched.length; i++) {candidate(touched[i]);}
  }

  // Triangles ordered so that any level's live triangles are a prefix.
  const order = Array.from({ length: T }, (_, t) => t).filter((t) => triDeath[t] >= 0);
  order.sort((a, b) => triDeath[b] - triDeath[a]);
  return {
    vertexCount: W, triangleCount: alive === 0 ? 0 : stepAlive[0], diag,
    indices: I, order: Uint32Array.from(order), triDeath,
    wParent, wStep,
    stepAlive: Int32Array.from(stepAlive), stepError: Float64Array.from(stepError),
    minTriangles: stepAlive[stepAlive.length - 1],
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

