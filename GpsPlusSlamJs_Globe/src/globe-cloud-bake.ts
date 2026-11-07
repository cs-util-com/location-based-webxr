/**
 * The near clouds' noise, baked: the tiles the march reads (a Perlin-Worley
 * shape, a Worley erosion, three generations of cumulus domes, a slow
 * regional field, blue noise) and the two numbers measured on them. Pure
 * and deterministic: no DOM, no three.js, so it runs in a worker
 * (`globe-cloud-bake-worker-core.ts`), where its second or so never costs a
 * frame.
 *
 * @see globe-cloud-bake.ts.md
 */

import { clamp01, lerp } from "./globe-ease.js";

const wrap = (i: number, n: number) => ((i % n) + n) % n;
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const remap = (v: number, a: number, b: number, c: number, d: number) =>
  c + ((v - a) / (b - a)) * (d - c);

/** A reproducible stream of numbers in 0..1. */
function mulberry(start: number): () => number {
  let seed = start;
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A number in 0..1 for an integer lattice point and a seed. */
function ihash(x: number, y: number, z: number, s: number): number {
  let h =
    Math.imul(x | 0, 374761393) ^
    Math.imul(y | 0, 668265263) ^
    Math.imul(z | 0, 1440662683) ^
    Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const GRADIENTS_3D = [
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1],
] as const;
const GX = new Float32Array(GRADIENTS_3D.map((g) => g[0]));
const GY = new Float32Array(GRADIENTS_3D.map((g) => g[1]));
const GZ = new Float32Array(GRADIENTS_3D.map((g) => g[2]));

const gradCache = new Map<number, Uint8Array>();
const featCache = new Map<number, Float32Array>();
const grad2Cache = new Map<number, Uint8Array>();

function gradTable(P: number, s: number): Uint8Array {
  const key = P * 100000 + s;
  const cached = gradCache.get(key);
  if (cached) return cached;
  const t = new Uint8Array(P * P * P);
  for (let k = 0; k < P; k++)
    for (let j = 0; j < P; j++)
      for (let i = 0; i < P; i++)
        t[i + P * (j + P * k)] = Math.floor(ihash(i, j, k, s) * 12);
  gradCache.set(key, t);
  return t;
}

function featTable(N: number, s: number): Float32Array {
  const key = N * 100000 + s;
  const cached = featCache.get(key);
  if (cached) return cached;
  const t = new Float32Array(N * N * N * 3);
  for (let k = 0; k < N; k++)
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const o = 3 * (i + N * (j + N * k));
        t[o] = ihash(i, j, k, s);
        t[o + 1] = ihash(i, j, k, s + 1);
        t[o + 2] = ihash(i, j, k, s + 2);
      }
  featCache.set(key, t);
  return t;
}

/** Periodic gradient noise: `P` cells per tile. */
function perlin3(x: number, y: number, z: number, P: number, s: number) {
  const G = gradTable(P, s);
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = fade(xf);
  const v = fade(yf);
  const w = fade(zf);
  const x0 = wrap(xi, P);
  const x1 = (x0 + 1) % P;
  const y0 = wrap(yi, P) * P;
  const y1 = ((wrap(yi, P) + 1) % P) * P;
  const z0 = wrap(zi, P) * P * P;
  const z1 = ((wrap(zi, P) + 1) % P) * P * P;
  const g = (idx: number, dx: number, dy: number, dz: number) => {
    const q = G[idx] ?? 0;
    return (GX[q] ?? 0) * dx + (GY[q] ?? 0) * dy + (GZ[q] ?? 0) * dz;
  };
  const a = lerp(
    g(x0 + y0 + z0, xf, yf, zf),
    g(x1 + y0 + z0, xf - 1, yf, zf),
    u,
  );
  const b = lerp(
    g(x0 + y1 + z0, xf, yf - 1, zf),
    g(x1 + y1 + z0, xf - 1, yf - 1, zf),
    u,
  );
  const c = lerp(
    g(x0 + y0 + z1, xf, yf, zf - 1),
    g(x1 + y0 + z1, xf - 1, yf, zf - 1),
    u,
  );
  const d = lerp(
    g(x0 + y1 + z1, xf, yf - 1, zf - 1),
    g(x1 + y1 + z1, xf - 1, yf - 1, zf - 1),
    u,
  );
  return lerp(lerp(a, b, v), lerp(c, d, v), w);
}

/** The distance to the nearest feature point of a periodic `N`-cell tile. */
function worley3(x: number, y: number, z: number, N: number, s: number) {
  const F = featTable(N, s);
  const px = x * N;
  const py = y * N;
  const pz = z * N;
  const cx = Math.floor(px);
  const cy = Math.floor(py);
  const cz = Math.floor(pz);
  let md = 9;
  for (let dz = -1; dz <= 1; dz++) {
    const Z = cz + dz;
    const wz = wrap(Z, N);
    for (let dy = -1; dy <= 1; dy++) {
      const Y = cy + dy;
      const wy = wrap(Y, N);
      for (let dx = -1; dx <= 1; dx++) {
        const X = cx + dx;
        const o = 3 * (wrap(X, N) + N * (wy + N * wz));
        const fx = X + (F[o] ?? 0) - px;
        const fy = Y + (F[o + 1] ?? 0) - py;
        const fz = Z + (F[o + 2] ?? 0) - pz;
        const d = fx * fx + fy * fy + fz * fz;
        if (d < md) md = d;
      }
    }
  }
  return Math.sqrt(md);
}

function normalize01(arr: Float32Array): Float32Array {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of arr) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const k = 1 / Math.max(1e-6, hi - lo);
  for (let i = 0; i < arr.length; i++) arr[i] = ((arr[i] ?? 0) - lo) * k;
  return arr;
}

/** The Perlin-Worley base shape, 0..1. */
function bakeShape(N: number): Float32Array {
  const out = new Float32Array(N * N * N);
  for (let k = 0; k < N; k++)
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const x = i / N;
        const y = j / N;
        const z = k / N;
        let p = 0;
        let amp = 1;
        let tot = 0;
        for (let o = 0, f = 4; o < 3; o++, f *= 2) {
          p += perlin3(x * f, y * f, z * f, f, 11 + o) * amp;
          tot += amp;
          amp *= 0.5;
        }
        p = clamp01((p / tot) * 0.9 + 0.5);
        const w1 = clamp01(1 - worley3(x, y, z, 4, 101));
        const w2 = clamp01(1 - worley3(x, y, z, 8, 201));
        const pw = clamp01(remap(p, -(1 - w1), 1, 0, 1));
        const wf = w1 * 0.35 + w2 * 0.65;
        out[i + N * (j + N * k)] = clamp01(remap(pw, -(1 - wf) * 0.9, 1, 0, 1));
      }
  return normalize01(out);
}

/** The billowy Worley erosion, 0..1. */
function bakeDetail(N: number): Float32Array {
  const out = new Float32Array(N * N * N);
  for (let k = 0; k < N; k++)
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const x = i / N;
        const y = j / N;
        const z = k / N;
        out[i + N * (j + N * k)] =
          (1 - worley3(x, y, z, 4, 401)) * 0.625 +
          (1 - worley3(x, y, z, 8, 501)) * 0.25 +
          (1 - worley3(x, y, z, 16, 601)) * 0.125;
      }
  return normalize01(out);
}

const GRADIENTS_2D = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.7071, 0.7071],
  [-0.7071, 0.7071],
  [0.7071, -0.7071],
  [-0.7071, -0.7071],
] as const;
const NO_GRADIENT = [0, 0] as const;

function grad2Table(P: number, s: number): Uint8Array {
  const key = P * 100000 + s;
  const cached = grad2Cache.get(key);
  if (cached) return cached;
  const T = new Uint8Array(P * P);
  for (let j = 0; j < P; j++)
    for (let i = 0; i < P; i++) T[i + P * j] = (ihash(i, j, 7, s) * 8) | 0;
  grad2Cache.set(key, T);
  return T;
}

/** Periodic 2D gradient noise, `P` cells per tile. */
function perlin2(x: number, y: number, P: number, s: number): number {
  const T = grad2Table(P, s);
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const i0 = wrap(xi, P);
  const i1 = i0 + 1 === P ? 0 : i0 + 1;
  const j0 = wrap(yi, P) * P;
  const j1 = (wrap(yi, P) + 1 === P ? 0 : wrap(yi, P) + 1) * P;
  const at = (i: number) => GRADIENTS_2D[T[i] ?? 0] ?? NO_GRADIENT;
  const a = at(i0 + j0);
  const b = at(i1 + j0);
  const c = at(i0 + j1);
  const d = at(i1 + j1);
  const u = fade(xf);
  const v = fade(yf);
  const ab = lerp(a[0] * xf + a[1] * yf, b[0] * (xf - 1) + b[1] * yf, u);
  const cd = lerp(
    c[0] * xf + c[1] * (yf - 1),
    d[0] * (xf - 1) + d[1] * (yf - 1),
    u,
  );
  return lerp(ab, cd, v);
}

/** Octaves over a tile, each doubling from `P0` cells; about 0..1. */
function fbmP(u: number, v: number, P0: number, oct: number, s: number) {
  let a = 1;
  let t = 0;
  let sum = 0;
  for (let o = 0, P = P0; o < oct; o++, P *= 2) {
    sum += perlin2(u * P, v * P, P, s + o * 31) * a;
    t += a;
    a *= 0.5;
  }
  return clamp01((sum / t) * 1.1 + 0.5);
}

interface DomeCell {
  readonly px: number;
  readonly py: number;
  readonly r: number;
  readonly s: number;
}

/** One generation's cells at three sizes: each alive by chance. */
function domeCells(seed: number): DomeCell[] {
  const layers = [
    { N: 9, rmin: 0.5, rmax: 0.9, smin: 0.75, smax: 1, prob: 0.36 },
    { N: 22, rmin: 0.3, rmax: 0.62, smin: 0.55, smax: 0.95, prob: 0.36 },
    { N: 48, rmin: 0.12, rmax: 0.36, smin: 0.35, smax: 0.7, prob: 0.05 },
  ];
  const cells: DomeCell[] = [];
  layers.forEach((l, k) => {
    for (let j = 0; j < l.N; j++)
      for (let i = 0; i < l.N; i++) {
        const h = (m: number) => ihash(i, j, m, seed + 1000 * k);
        cells.push({
          px: (i + 0.15 + 0.7 * h(0)) / l.N,
          py: (j + 0.15 + 0.7 * h(1)) / l.N,
          r: lerp(l.rmin, l.rmax, h(3)) / l.N,
          s: h(2) < l.prob ? lerp(l.smin, l.smax, h(4)) : 0,
        });
      }
  });
  return cells;
}

/** `keep` times what one dome leaves of each texel it reaches. */
function stampDome(keep: Float32Array, S: number, c: DomeCell) {
  const cx = c.px * S - 0.5;
  const cy = c.py * S - 0.5;
  const rr = c.r * S;
  for (let y = Math.floor(cy - rr); y <= Math.ceil(cy + rr); y++)
    for (let x = Math.floor(cx - rr); x <= Math.ceil(cx + rr); x++) {
      const dx = (x - cx) / rr;
      const dy = (y - cy) / rr;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 1) continue;
      const at = wrap(x, S) + S * wrap(y, S);
      keep[at] = (keep[at] ?? 0) * (1 - c.s * (1 - d2));
    }
}

/**
 * The dome tile: R, G, B three generations of cumulus domes (their union
 * 1 - prod(1 - dome)), A a cloud-scale phase offset.
 */
function bakeDomes(S: number): Uint8Array {
  const data = new Uint8Array(S * S * 4);
  const keep = new Float32Array(S * S);
  [4000, 14000, 24000].forEach((seed, g) => {
    keep.fill(1);
    for (const c of domeCells(seed)) if (c.s > 0) stampDome(keep, S, c);
    for (let i = 0; i < S * S; i++)
      data[i * 4 + g] = Math.round(clamp01(1 - (keep[i] ?? 0)) * 255);
  });
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++)
      data[(x + S * y) * 4 + 3] = Math.round(
        fbmP((x + 0.5) / S, (y + 0.5) / S, 8, 2, 9100) * 255,
      );
  return data;
}

/**
 * The region's slow fields: R unused by the march (the cloud map gives the
 * coverage), G vertical development, B and A the cloud base, the tile's
 * displacement and the life cycle's phase.
 */
function bakeRegion(S: number): Uint8Array {
  const data = new Uint8Array(S * S * 4);
  const sm = (a: number, b: number, x: number) => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const v = (y + 0.5) / S;
      const o = (x + S * y) * 4;
      const c = fbmP(u, v, 16, 3, 300);
      const cl = fbmP(u, v, 64, 2, 400);
      const dv = fbmP(u, v, 24, 3, 500);
      data[o] = Math.round(sm(0.3, 0.6, c) * sm(0.36, 0.6, cl) * 255);
      data[o + 1] = Math.round(sm(0.25, 0.75, dv) * 255);
      data[o + 2] = Math.round(fbmP(u, v, 16, 2, 700) * 255);
      data[o + 3] = Math.round(fbmP(u, v, 16, 2, 900) * 255);
    }
  return data;
}

/** Blue noise ranks by void filling on a torus (Gaussian energy kernel). */
function bakeBlue(S: number): Uint8Array {
  const n = S * S;
  const E = new Float32Array(n);
  const rank = new Int32Array(n).fill(-1);
  const rnd = mulberry(5);
  const kernel = blueKernel();
  for (let i = 0; i < n; i++) E[i] = rnd() * 1e-4;
  for (let r = 0; r < n; r++) {
    const bi = lowestUnranked(E, rank);
    rank[bi] = r;
    const bx = bi % S;
    const by = (bi / S) | 0;
    for (const [dx, dy, w] of kernel) {
      const at = wrap(bx + dx, S) + S * wrap(by + dy, S);
      E[at] = (E[at] ?? 0) + w;
    }
  }
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) data[i] = Math.floor(((rank[i] ?? 0) / n) * 256);
  return data;
}

const toBytes = (values: Float32Array) =>
  Uint8Array.from(values, (v) => Math.round(v * 255));

/** The void-and-cluster filter's weights around a texel (dx, dy, weight). */
function blueKernel(): (readonly [number, number, number])[] {
  const R = 6;
  const sig2 = 2 * 1.9 * 1.9;
  const kernel: (readonly [number, number, number])[] = [];
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++)
      kernel.push([dx, dy, Math.exp(-(dx * dx + dy * dy) / sig2)]);
  return kernel;
}

/** The index of the lowest energy among the texels without a rank. */
function lowestUnranked(E: Float32Array, rank: Int32Array): number {
  let at = -1;
  let lowest = Infinity;
  for (let i = 0; i < E.length; i++) {
    const e = E[i] ?? Infinity;
    if ((rank[i] ?? 0) < 0 && e < lowest) {
      lowest = e;
      at = i;
    }
  }
  return at;
}

/** The shader's three-generation mix at a phase, without the gain. */
function lifeMix(
  r: number,
  g: number,
  b: number,
  a: number,
  phase: number,
): number {
  const grown = (dome: number, k: number) => {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (phase + 1.5 * a + k / 3));
    return clamp01((dome - 1 + w) / Math.max(w, 0.35));
  };
  return 1 - (1 - grown(r, 0)) * (1 - grown(g, 1)) * (1 - grown(b, 2));
}

/** The dome level the mix's cloud area is matched to one generation at. */
const LIFE_MATCH = 0.5;

/**
 * The gain that gives the three generations together the cloud area of one
 * alone, over a cycle, so the life cycle keeps the amount of cloud. A dome
 * tile of `S` x `S` RGBA texels; clamped to 0.3..2.
 *
 * @throws RangeError when the tile is not `S` x `S` x 4 bytes.
 */
export function cloudLifeGain(domes: Uint8Array, S: number): number {
  if (domes.length !== S * S * 4) {
    throw new RangeError(`a ${S} tile needs ${S * S * 4} bytes`);
  }
  const mix: number[] = [];
  let single = 0;
  let count = 0;
  for (let i = 0; i < S * S; i += 7) {
    const o = i * 4;
    const r = (domes[o] ?? 0) / 255;
    const g = (domes[o + 1] ?? 0) / 255;
    const b = (domes[o + 2] ?? 0) / 255;
    const a = (domes[o + 3] ?? 0) / 255;
    count++;
    if (r > LIFE_MATCH) single++;
    for (let p = 0; p < 6; p++) mix.push(lifeMix(r, g, b, a, p / 6));
  }
  mix.sort((x, y) => x - y);
  const at = Math.floor((1 - single / count) * mix.length);
  const q = mix[Math.min(mix.length - 1, at)] ?? 0;
  return Math.min(2, Math.max(0.3, LIFE_MATCH / Math.max(q, 1e-3)));
}

/** The erosion's mean as the texture stores it; 0 for no data. */
export function cloudDetailMean(detail: Uint8Array): number {
  if (detail.length === 0) return 0;
  let sum = 0;
  for (const v of detail) sum += v / 255;
  return sum / detail.length;
}

/** Every tile and the numbers measured on them. */
export interface CloudBakes {
  /** 64^3 bytes: the base shape. */
  readonly shape: Uint8Array;
  /** 32^3 bytes: the erosion. */
  readonly detail: Uint8Array;
  /** 512^2 RGBA: the domes. */
  readonly domes: Uint8Array;
  /** 512^2 RGBA: the region's slow fields. */
  readonly region: Uint8Array;
  /** 64^2 bytes: the march's start offsets. */
  readonly blue: Uint8Array;
  readonly lifeGain: number;
  readonly detailMean: number;
}

/** The tiles' sizes (texels per side). */
export const CLOUD_BAKE_SIZES = Object.freeze({
  shape: 64,
  detail: 32,
  domes: 512,
  region: 512,
  blue: 64,
});

/** Everything the march needs baked; about a second on a laptop. */
export function bakeCloudTextures(): CloudBakes {
  const detail = toBytes(bakeDetail(CLOUD_BAKE_SIZES.detail));
  const domes = bakeDomes(CLOUD_BAKE_SIZES.domes);
  return {
    shape: toBytes(bakeShape(CLOUD_BAKE_SIZES.shape)),
    detail,
    domes,
    region: bakeRegion(CLOUD_BAKE_SIZES.region),
    blue: bakeBlue(CLOUD_BAKE_SIZES.blue),
    lifeGain: cloudLifeGain(domes, CLOUD_BAKE_SIZES.domes),
    detailMean: cloudDetailMean(detail),
  };
}
