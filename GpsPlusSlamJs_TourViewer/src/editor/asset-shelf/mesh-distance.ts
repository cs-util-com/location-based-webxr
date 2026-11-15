/**
 * The sampled symmetric surface distance between two triangle meshes in
 * one coordinate frame: points sampled uniformly by area on each, the
 * nearest point on the other found through a uniform grid of triangles.
 * The largest distance found is an estimate of the Hausdorff distance (a
 * lower bound of it that tightens with more samples); the samples are
 * seeded, so the same meshes always give the same answer.
 *
 * @see mesh-distance.ts.md
 */
/* eslint-disable complexity, max-depth -- numeric kernels */

/** A small seeded generator (mulberry32), uniform in [0, 1). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Positions = ArrayLike<number>;
type Indices = ArrayLike<number>;

/** `n` points uniformly by area on the mesh, xyz each. */
export function samplePoints(
  P: Positions,
  I: Indices,
  n: number,
  seed: number,
): Float64Array {
  const T = I.length / 3;
  const out = new Float64Array(n * 3);
  if (T === 0) return out.subarray(0, 0);
  const cum = new Float64Array(T);
  let total = 0;
  for (let t = 0; t < T; t++) {
    const a = I[3 * t]! * 3;
    const b = I[3 * t + 1]! * 3;
    const c = I[3 * t + 2]! * 3;
    const ux = P[b]! - P[a]!;
    const uy = P[b + 1]! - P[a + 1]!;
    const uz = P[b + 2]! - P[a + 2]!;
    const vx = P[c]! - P[a]!;
    const vy = P[c + 1]! - P[a + 1]!;
    const vz = P[c + 2]! - P[a + 2]!;
    total +=
      0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    cum[t] = total;
  }
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * total;
    let lo = 0;
    let hi = T - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (cum[m]! < x) lo = m + 1;
      else hi = m;
    }
    let s = r();
    let q = r();
    if (s + q > 1) {
      s = 1 - s;
      q = 1 - q;
    }
    const a = I[3 * lo]! * 3;
    const b = I[3 * lo + 1]! * 3;
    const c = I[3 * lo + 2]! * 3;
    for (let k = 0; k < 3; k++) {
      out[3 * i + k] =
        P[a + k]! + s * (P[b + k]! - P[a + k]!) + q * (P[c + k]! - P[a + k]!);
    }
  }
  return out;
}

/** The squared distance from p to triangle (a, b, c), which are offsets
 *  into `P` (closest point on a triangle, Ericson's regions). */
export function pointTri2(
  px: number,
  py: number,
  pz: number,
  P: Positions,
  a: number,
  b: number,
  c: number,
): number {
  const ax = P[a]!;
  const ay = P[a + 1]!;
  const az = P[a + 2]!;
  const bx = P[b]!;
  const by = P[b + 1]!;
  const bz = P[b + 2]!;
  const cx = P[c]!;
  const cy = P[c + 1]!;
  const cz = P[c + 2]!;
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let qx: number;
  let qy: number;
  let qz: number;
  if (d1 <= 0 && d2 <= 0) {
    qx = ax;
    qy = ay;
    qz = az;
  } else {
    const bpx = px - bx;
    const bpy = py - by;
    const bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = px - cx;
    const cpy = py - cy;
    const cpz = pz - cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2;
    const vb = d5 * d2 - d1 * d6;
    const va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) {
      qx = bx;
      qy = by;
      qz = bz;
    } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      qx = ax + v * abx;
      qy = ay + v * aby;
      qz = az + v * abz;
    } else if (d6 >= 0 && d5 <= d6) {
      qx = cx;
      qy = cy;
      qz = cz;
    } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6);
      qx = ax + w * acx;
      qy = ay + w * acy;
      qz = az + w * acz;
    } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      qx = bx + w * (cx - bx);
      qy = by + w * (cy - by);
      qz = bz + w * (cz - bz);
    } else {
      const den = 1 / (va + vb + vc);
      const v = vb * den;
      const w = vc * den;
      qx = ax + abx * v + acx * w;
      qy = ay + aby * v + acy * w;
      qz = az + abz * v + acz * w;
    }
  }
  return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
}

/** The smallest extent of the grid's box, as a share of its largest. */
const FLAT_SHARE = 0.01;
/** The most cells along one axis. */
const MAX_CELLS = 256;

/** A uniform grid over one mesh's triangles, for nearest-point queries. */
export class SurfaceGrid {
  private readonly cell: number;
  private readonly lo: [number, number, number];
  private readonly n: [number, number, number];
  private readonly cells = new Map<number, number[]>();
  private readonly mark: Int32Array;
  private stamp = 0;

  constructor(
    private readonly P: Positions,
    private readonly I: Indices,
  ) {
    const T = I.length / 3;
    const lo: [number, number, number] = [Infinity, Infinity, Infinity];
    const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < I.length; i++) {
      for (let k = 0; k < 3; k++) {
        const x = P[3 * I[i]! + k]!;
        if (x < lo[k]!) lo[k] = x;
        if (x > hi[k]!) hi[k] = x;
      }
    }
    if (T === 0) lo.fill(0);
    // A flat mesh has no volume: each extent counts as at least
    // FLAT_SHARE of the largest, or its cells would shrink towards zero
    // and a triangle would span millions of them. The cell count per axis
    // stays at most MAX_CELLS.
    const raw = [0, 1, 2].map((k) => hi[k]! - lo[k]!);
    const largest = Math.max(...raw) || 1;
    const ext = raw.map((e) => Math.max(e, largest * FLAT_SHARE));
    const vol = ext[0]! * ext[1]! * ext[2]!;
    this.cell = Math.max(
      Math.cbrt(vol / Math.max(1, T / 2)),
      largest / MAX_CELLS,
    );
    this.lo = lo;
    this.n = [0, 1, 2].map((k) =>
      Math.max(1, Math.ceil(ext[k]! / this.cell)),
    ) as [number, number, number];
    const mn = [0, 0, 0];
    const mx = [0, 0, 0];
    for (let t = 0; t < T; t++) {
      mn.fill(Infinity);
      mx.fill(-Infinity);
      for (let c = 0; c < 3; c++) {
        for (let k = 0; k < 3; k++) {
          const x = P[3 * I[3 * t + c]! + k]!;
          mn[k] = Math.min(mn[k]!, x);
          mx[k] = Math.max(mx[k]!, x);
        }
      }
      const a = mn.map((x, k) => this.ci(x, k));
      const b = mx.map((x, k) => this.ci(x, k));
      for (let i = a[0]!; i <= b[0]!; i++) {
        for (let j = a[1]!; j <= b[1]!; j++) {
          for (let l = a[2]!; l <= b[2]!; l++) {
            const key = (i * this.n[1] + j) * this.n[2] + l;
            let list = this.cells.get(key);
            if (list === undefined) this.cells.set(key, (list = []));
            list.push(t);
          }
        }
      }
    }
    this.mark = new Int32Array(T);
  }

  private ci(x: number, k: number): number {
    return Math.min(
      this.n[k]! - 1,
      Math.max(0, Math.floor((x - this.lo[k]!) / this.cell)),
    );
  }

  /** The distance from p to the nearest triangle (Infinity for none). */
  nearest(px: number, py: number, pz: number): number {
    const c = [this.ci(px, 0), this.ci(py, 1), this.ci(pz, 2)] as const;
    const [n0, n1, n2] = this.n;
    let best = Infinity;
    this.stamp++;
    const maxR = Math.max(n0, n1, n2);
    for (let r = 0; r <= maxR; r++) {
      // the cells on the shell of radius r
      for (let i = c[0] - r; i <= c[0] + r; i++) {
        for (let j = c[1] - r; j <= c[1] + r; j++) {
          for (let l = c[2] - r; l <= c[2] + r; l++) {
            const ring = Math.max(
              Math.abs(i - c[0]),
              Math.abs(j - c[1]),
              Math.abs(l - c[2]),
            );
            if (ring !== r) continue;
            if (i < 0 || j < 0 || l < 0 || i >= n0 || j >= n1 || l >= n2) {
              continue;
            }
            const list = this.cells.get((i * n1 + j) * n2 + l);
            if (list === undefined) continue;
            for (const t of list) {
              if (this.mark[t] === this.stamp) continue;
              this.mark[t] = this.stamp;
              const d = pointTri2(
                px,
                py,
                pz,
                this.P,
                this.I[3 * t]! * 3,
                this.I[3 * t + 1]! * 3,
                this.I[3 * t + 2]! * 3,
              );
              if (d < best) best = d;
            }
          }
        }
      }
      // any point outside the searched cube is at least r cells away
      if (best < (r * this.cell) ** 2) break;
    }
    return Math.sqrt(best);
  }
}

export interface SurfaceDistance {
  /** Mean of both directions' sampled distances. */
  readonly mean: number;
  /** The largest sampled distance, either direction. */
  readonly max: number;
}

/** The symmetric sampled distance between mesh A and mesh B, in model
 *  units. `gridA`, when given, is `new SurfaceGrid(PA, IA)` reused by a
 *  caller that compares many levels against the same full model. */
export function surfaceDistance(
  PA: Positions,
  IA: Indices,
  PB: Positions,
  IB: Indices,
  samples = 20000,
  gridA: SurfaceGrid | null = null,
): SurfaceDistance {
  if (IA.length === 0 || IB.length === 0) {
    return IA.length === IB.length
      ? { mean: 0, max: 0 }
      : { mean: Infinity, max: Infinity };
  }
  const ga = gridA ?? new SurfaceGrid(PA, IA);
  const gb = new SurfaceGrid(PB, IB);
  const sa = samplePoints(PA, IA, samples, 1);
  const sb = samplePoints(PB, IB, samples, 2);
  let sum = 0;
  let max = 0;
  for (let i = 0; i < samples; i++) {
    const d = gb.nearest(sa[3 * i]!, sa[3 * i + 1]!, sa[3 * i + 2]!);
    sum += d;
    if (d > max) max = d;
  }
  for (let i = 0; i < samples; i++) {
    const d = ga.nearest(sb[3 * i]!, sb[3 * i + 1]!, sb[3 * i + 2]!);
    sum += d;
    if (d > max) max = d;
  }
  return { mean: sum / (2 * samples), max };
}
