/**
 * QR size from depth — unit tests.
 *
 * Why this test matters: this is the measuring stage of the Note 3 size
 * lifecycle. The estimator must recover a known printed size from depth-
 * unprojected corners (metric scale, no solvePnP), score a clean read high and
 * a noisy/non-square read low, and the accumulator must only promote a size to
 * `estimated` once enough low-spread samples agree.
 */

import { describe, it, expect } from 'vitest';
import { mat4, vec4 } from 'gl-matrix';
import type { Matrix4, Quaternion, Vector3 } from 'gps-plus-slam-js';
import type { DepthPoint } from '../../types/ar-types';
import { createDepthUnprojector } from '../depth-unprojection';
import {
  estimateQrSizeFromDepth,
  estimateQrSizeFromDepthDense,
  fitPlaneRobust,
  createQrSizeAccumulator,
  type ScreenPoint,
} from './qr-size-from-depth';

const ORIGIN: Vector3 = [0, 0, 0];
const IDENTITY: Quaternion = [0, 0, 0, 1];
const P = Array.from(
  mat4.perspective(mat4.create(), Math.PI / 3, 16 / 9, 0.1, 1000)
) as unknown as Matrix4;

/** Project a world point (camera at origin, identity rot) to a DepthPoint. */
function project(world: Vector3): DepthPoint {
  const clip = vec4.transformMat4(
    vec4.create(),
    [world[0], world[1], world[2], 1],
    P
  );
  const ndcX = clip[0] / clip[3];
  const ndcY = clip[1] / clip[3];
  return {
    screenX: (ndcX + 1) / 2,
    screenY: (1 - ndcY) / 2,
    depthM: -world[2],
  };
}

/** TL, TR, BR, BL of a fronto-parallel square of side `s` centered at `center`. */
function frontoSquare(
  s: number,
  center: Vector3
): [Vector3, Vector3, Vector3, Vector3] {
  const h = s / 2;
  const [cx, cy, cz] = center;
  return [
    [cx - h, cy + h, cz],
    [cx + h, cy + h, cz],
    [cx + h, cy - h, cz],
    [cx - h, cy - h, cz],
  ];
}

const unprojector = () => {
  const u = createDepthUnprojector(ORIGIN, IDENTITY, P);
  if (!u) throw new Error('unprojector');
  return u;
};

describe('estimateQrSizeFromDepth', () => {
  it('recovers a known fronto-parallel size with quality ≈ 1', () => {
    const s = 0.2;
    const [tl, tr, br, bl] = frontoSquare(s, [0, 0, -2]);
    const obs = estimateQrSizeFromDepth(
      [project(tl), project(tr), project(br), project(bl)],
      [],
      unprojector()
    );
    expect(obs).not.toBeNull();
    expect(obs!.sizeM).toBeCloseTo(s, 4);
    expect(obs!.quality).toBeGreaterThan(0.99);
  });

  it('scores a non-square (one corner pushed in depth) low', () => {
    const s = 0.2;
    const [tl, tr, br, bl] = frontoSquare(s, [0, 0, -2]);
    const badTl = project(tl);
    const obs = estimateQrSizeFromDepth(
      [
        { ...badTl, depthM: badTl.depthM + 0.15 },
        project(tr),
        project(br),
        project(bl),
      ],
      [],
      unprojector()
    );
    expect(obs).not.toBeNull();
    expect(obs!.quality).toBeLessThan(0.8); // rejected by the default gate
  });

  it('returns null when a corner cannot be unprojected (bad depth)', () => {
    const [tl, tr, br, bl] = frontoSquare(0.2, [0, 0, -2]);
    const obs = estimateQrSizeFromDepth(
      [{ ...project(tl), depthM: 0 }, project(tr), project(br), project(bl)],
      [],
      unprojector()
    );
    expect(obs).toBeNull();
  });
});

/** Bilinear lattice of `n×n` interior points across a quad (TL,TR,BR,BL). */
function quadLattice(
  quad: [Vector3, Vector3, Vector3, Vector3],
  n: number
): Vector3[] {
  const [tl, tr, br, bl] = quad;
  const lerp = (a: Vector3, b: Vector3, t: number): Vector3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  const pts: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const v = n === 1 ? 0.5 : i / (n - 1);
    const top = lerp(tl, tr, v); // reuse v as the horizontal fraction
    const bottom = lerp(bl, br, v);
    for (let j = 0; j < n; j++) {
      const u = n === 1 ? 0.5 : j / (n - 1);
      pts.push(lerp(top, bottom, u));
    }
  }
  return pts;
}

const screenOf = (world: Vector3): ScreenPoint => {
  const p = project(world);
  return { screenX: p.screenX, screenY: p.screenY };
};

describe('fitPlaneRobust', () => {
  it('fits a fronto-parallel plane (normal ≈ ±z, residual ≈ 0)', () => {
    const pts = quadLattice(frontoSquare(0.2, [0, 0, -2]), 5);
    const fit = fitPlaneRobust(pts);
    expect(fit).not.toBeNull();
    expect(Math.abs(fit!.normal[2])).toBeCloseTo(1, 6);
    expect(fit!.rms).toBeLessThan(1e-6);
  });

  it('rejects a single gross depth outlier (MAD inlier rejection)', () => {
    const pts = quadLattice(frontoSquare(0.2, [0, 0, -2]), 5);
    pts[12] = [pts[12]![0], pts[12]![1], pts[12]![2] + 0.5]; // a spike off the plane
    const fit = fitPlaneRobust(pts);
    expect(fit).not.toBeNull();
    // The plane stays at z ≈ -2 (the outlier is rejected, not averaged in).
    expect(fit!.point[2]).toBeCloseTo(-2, 3);
    expect(Math.abs(fit!.normal[2])).toBeCloseTo(1, 3);
  });

  it('returns null for collinear points (no unique plane)', () => {
    const collinear: Vector3[] = [
      [0, 0, -2],
      [0.1, 0, -2],
      [0.2, 0, -2],
      [0.3, 0, -2],
    ];
    expect(fitPlaneRobust(collinear)).toBeNull();
  });

  // Why this test matters: the measurer's 7x7 lattice loses reads where depth
  // is missing, so the fit sees any count of points. The triple sampler once
  // multiplied past 2^53, which zeroed the low bits: at 16 or 32 reads every
  // trial drew one index (no plane at all), and at 48 every trial drew the
  // same three points (no robustness). Every count must fit, and a fifth of
  // gross outliers must not move the plane.
  it('fits every point count, rejecting a fifth of gross outliers', () => {
    const tilt = (35 * Math.PI) / 180;
    const normal: Vector3 = [Math.sin(tilt), 0, Math.cos(tilt)];
    for (let n = 4; n <= 64; n++) {
      const pts: Vector3[] = [];
      for (let i = 0; i < n; i++) {
        // Low-discrepancy in-plane spots: never collinear, whatever n.
        const u = ((i * 0.6180339887) % 1) - 0.5;
        const v = ((i * 0.4142135624) % 1) - 0.5;
        // In-plane axes: (cos, 0, -sin) and y; off-plane by 0.3 m for outliers.
        const off = n >= 10 && i % 5 === 4 ? 0.3 : 0;
        pts.push([
          0.3 * u * Math.cos(tilt) + off * normal[0],
          0.3 * v,
          -2 - 0.3 * u * Math.sin(tilt) + off * normal[2],
        ]);
      }
      const fit = fitPlaneRobust(pts);
      expect(fit, `n = ${n}`).not.toBeNull();
      const dot = Math.abs(
        fit!.normal[0] * normal[0] +
          fit!.normal[1] * normal[1] +
          fit!.normal[2] * normal[2]
      );
      expect(dot, `n = ${n}`).toBeGreaterThan(0.9999);
      expect(fit!.rms, `n = ${n}`).toBeLessThan(1e-6);
    }
  });

  it('returns null for fewer than 3 points', () => {
    expect(
      fitPlaneRobust([
        [0, 0, -2],
        [0.1, 0, -2],
      ])
    ).toBeNull();
  });
});

describe('estimateQrSizeFromDepthDense', () => {
  it('recovers a fronto-parallel size from interior reads only', () => {
    const s = 0.18;
    const quad = frontoSquare(s, [0.1, -0.05, -2.5]);
    const [tl, tr, br, bl] = quad;
    const samples = quadLattice(quad, 5).map(project); // interior reads, NOT corners
    const obs = estimateQrSizeFromDepthDense(
      [screenOf(tl), screenOf(tr), screenOf(br), screenOf(bl)],
      samples,
      unprojector()
    );
    expect(obs).not.toBeNull();
    expect(obs!.sizeM).toBeCloseTo(s, 3);
    expect(obs!.quality).toBeGreaterThan(0.99);
  });

  it('recovers the size of a TILTED square (the corner-only path loses tilt)', () => {
    // A square tilted ~25° about the vertical axis: x and z both vary.
    const s = 0.2;
    const ang = (25 * Math.PI) / 180;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const h = s / 2;
    const center: Vector3 = [0, 0, -2.2];
    const corner = (sx: number, sy: number): Vector3 => [
      center[0] + sx * h * cos,
      center[1] + sy * h,
      center[2] + sx * h * sin,
    ];
    const quad: [Vector3, Vector3, Vector3, Vector3] = [
      corner(-1, 1),
      corner(1, 1),
      corner(1, -1),
      corner(-1, -1),
    ];
    const samples = quadLattice(quad, 6).map(project);
    const obs = estimateQrSizeFromDepthDense(
      [
        screenOf(quad[0]),
        screenOf(quad[1]),
        screenOf(quad[2]),
        screenOf(quad[3]),
      ],
      samples,
      unprojector()
    );
    expect(obs).not.toBeNull();
    expect(obs!.sizeM).toBeCloseTo(s, 2);
    expect(obs!.quality).toBeGreaterThan(0.9);
  });

  it('recovers the size even when interior reads carry a few depth outliers', () => {
    const s = 0.2;
    const quad = frontoSquare(s, [0, 0, -2]);
    const samples = quadLattice(quad, 6).map(project);
    // Corrupt 3 of 36 reads with large depth spikes (edge bleed / background).
    for (const i of [5, 17, 30]) {
      samples[i] = { ...samples[i]!, depthM: samples[i]!.depthM + 0.4 };
    }
    const obs = estimateQrSizeFromDepthDense(
      [
        screenOf(quad[0]),
        screenOf(quad[1]),
        screenOf(quad[2]),
        screenOf(quad[3]),
      ],
      samples,
      unprojector()
    );
    expect(obs).not.toBeNull();
    expect(obs!.sizeM).toBeCloseTo(s, 2);
  });

  it('returns null when too few interior reads are usable', () => {
    const quad = frontoSquare(0.2, [0, 0, -2]);
    const obs = estimateQrSizeFromDepthDense(
      [
        screenOf(quad[0]),
        screenOf(quad[1]),
        screenOf(quad[2]),
        screenOf(quad[3]),
      ],
      [project(quad[0]), project(quad[1])], // only 2 reads
      unprojector()
    );
    expect(obs).toBeNull();
  });
});

describe('createQrSizeAccumulator', () => {
  const good = { sizeM: 0.2, quality: 1 };

  it('walks the lifecycle unknown → measuring → estimated', () => {
    const acc = createQrSizeAccumulator({ minSamples: 4, maxSpreadM: 0.01 });
    expect(acc.current().status).toBe('unknown');
    expect(acc.add(good).status).toBe('measuring');
    acc.add(good);
    acc.add(good);
    const est = acc.add({ sizeM: 0.205, quality: 1 }); // 4 samples
    expect(est.status).toBe('estimated');
    expect(est.estimateM).toBeCloseTo(0.2, 2);
    expect(est.sampleCount).toBe(4);
    // spreadM is now a robust confidence half-width (1.4826·MAD/√N), not max−min.
    expect(est.spreadM).toBeLessThanOrEqual(0.01);
  });

  it('stays measuring while the spread is too wide', () => {
    const acc = createQrSizeAccumulator({ minSamples: 2, maxSpreadM: 0.01 });
    acc.add({ sizeM: 0.2, quality: 1 });
    // Two far-apart reads → robust half-width (~26 mm) ≫ 10 mm gate.
    const est = acc.add({ sizeM: 0.25, quality: 1 });
    expect(est.status).toBe('measuring');
  });

  it('ignores low-quality and null observations', () => {
    const acc = createQrSizeAccumulator({ qualityThreshold: 0.8 });
    expect(acc.add({ sizeM: 0.2, quality: 0.5 }).sampleCount).toBe(0);
    expect(acc.add(null).sampleCount).toBe(0);
    expect(acc.add(good).sampleCount).toBe(1);
  });

  it('reset() drops back to unknown', () => {
    const acc = createQrSizeAccumulator();
    acc.add(good);
    acc.reset();
    expect(acc.current().status).toBe('unknown');
  });
});

describe('createQrSizeAccumulator — lifelong robust refinement (WS-B)', () => {
  // Deterministic LCG-based noise so the convergence behaviour is reproducible.
  function noisyStream(truth: number, sigma: number, n: number): number[] {
    let rng = 0x9e3779b1;
    const next = (): number => {
      rng = (rng * 1103515245 + 12345) & 0x7fffffff;
      return rng / 0x7fffffff; // [0,1)
    };
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      // Box-Muller-ish: average two uniforms → roughly centered noise.
      const noise = (next() + next() - 1) * sigma;
      out.push(truth + noise);
    }
    return out;
  }

  it('keeps the full history beyond the old 64-sample window (unbounded default)', () => {
    const acc = createQrSizeAccumulator({ minSamples: 8 });
    for (const s of noisyStream(0.2, 0.005, 200))
      acc.add({ sizeM: s, quality: 1 });
    expect(acc.current().sampleCount).toBe(200); // not capped at 64
  });

  it('tightens the confidence half-width as evidence accumulates', () => {
    const acc = createQrSizeAccumulator({ minSamples: 8 });
    const stream = noisyStream(0.2, 0.006, 200);
    for (let i = 0; i < 10; i++)
      acc.add({ sizeM: stream[i] as number, quality: 1 });
    const early = acc.current().spreadM;
    for (let i = 10; i < 200; i++)
      acc.add({ sizeM: stream[i] as number, quality: 1 });
    const late = acc.current().spreadM;
    expect(late).toBeLessThan(early); // ~1/√N tightening
    expect(acc.current().estimateM).toBeCloseTo(0.2, 2);
  });

  it('a late burst of outliers cannot pull the estimate beyond a bound', () => {
    const acc = createQrSizeAccumulator({ minSamples: 8 });
    for (const s of noisyStream(0.2, 0.004, 80))
      acc.add({ sizeM: s, quality: 1 });
    const before = acc.current().estimateM!;
    // 12 gross outliers (still a minority of 92) at 3× the true size.
    for (let i = 0; i < 12; i++) acc.add({ sizeM: 0.6, quality: 1 });
    const after = acc.current().estimateM!;
    expect(Math.abs(after - before)).toBeLessThan(0.01);
    expect(after).toBeCloseTo(0.2, 2);
  });

  it('retains "estimated" while refinement continues (it is not terminal)', () => {
    const acc = createQrSizeAccumulator({ minSamples: 4, maxSpreadM: 0.01 });
    for (let i = 0; i < 6; i++) acc.add({ sizeM: 0.2, quality: 1 });
    expect(acc.current().status).toBe('estimated');
    // A single wider late read must NOT demote it back to 'measuring'.
    const after = acc.add({ sizeM: 0.22, quality: 1 });
    expect(after.status).toBe('estimated');
    expect(after.estimateM).toBeCloseTo(0.2, 2); // median barely moves
  });
});
