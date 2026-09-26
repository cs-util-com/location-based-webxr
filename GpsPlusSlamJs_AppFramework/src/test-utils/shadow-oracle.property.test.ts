/**
 * Property tests for the analytic shadow oracle (W4 AR shadows plan
 * 2026-09-26-0549, M1).
 *
 * Why this file matters: the unit tests pin a handful of hand-computed
 * answers; these hold the oracle's THREE views of one shadow (the ray test,
 * the plane footprints, the light-space distance) to each other over random
 * suns, casters and probes. If any view drifts, a probe the M2 page trusts as
 * "inside" could sit in the light, and the pixel test would blame the
 * renderer for the oracle's mistake.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  boxCorners,
  boxShadowOnPlane,
  classifyProbe,
  convexPolygonSignedDistance,
  inShadow,
  insideEllipse,
  lightSpaceSignedDistance,
  polygonArea,
  projectAlongSun,
  shadowTexelM,
  sphereShadowOnPlane,
  type BoxCaster,
  type Caster,
  type SphereCaster,
} from './shadow-oracle.js';
import type { Vec3 } from '../visualization/sun-shadow-rig.js';

const DEG = Math.PI / 180;

/** Suns from the rig's 10-degree floor to overhead, any azimuth. */
const sunArb = fc
  .record({
    el: fc.double({ min: 10, max: 90, noNaN: true }),
    az: fc.double({ min: 0, max: 360, noNaN: true }),
  })
  .map(({ el, az }): Vec3 => [
    Math.cos(el * DEG) * Math.cos(az * DEG),
    Math.sin(el * DEG),
    Math.cos(el * DEG) * Math.sin(az * DEG),
  ]);

/** A caster floating 0.3-3 m above the plane y = 0, 3-60 cm in size. */
const sphereArb = fc
  .record({
    x: fc.double({ min: -2, max: 2, noNaN: true }),
    z: fc.double({ min: -2, max: 2, noNaN: true }),
    gap: fc.double({ min: 0.3, max: 3, noNaN: true }),
    r: fc.double({ min: 0.03, max: 0.3, noNaN: true }),
  })
  .map(({ x, z, gap, r }): SphereCaster => ({
    kind: 'sphere',
    centre: [x, gap + r, z],
    radius: r,
  }));

const quatArb = fc
  .tuple(
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true })
  )
  .filter((q) => Math.hypot(...q) > 0.1)
  .map((q) => {
    const n = Math.hypot(...q);
    return [q[0] / n, q[1] / n, q[2] / n, q[3] / n] as const;
  });

const boxArb = fc
  .record({
    x: fc.double({ min: -2, max: 2, noNaN: true }),
    z: fc.double({ min: -2, max: 2, noNaN: true }),
    gap: fc.double({ min: 0.3, max: 3, noNaN: true }),
    h: fc.tuple(
      fc.double({ min: 0.03, max: 0.3, noNaN: true }),
      fc.double({ min: 0.03, max: 0.3, noNaN: true }),
      fc.double({ min: 0.03, max: 0.3, noNaN: true })
    ),
    rotation: quatArb,
  })
  .map(({ x, z, gap, h, rotation }): BoxCaster => {
    // The bounding sphere keeps every corner above the plane at any rotation.
    const reach = Math.hypot(...h);
    return {
      kind: 'box',
      centre: [x, gap + reach, z],
      halfExtents: h,
      rotation,
    };
  });

describe('the ray view and the plane footprints agree', () => {
  // The plan's ellipse, against the ray: every plane point clearly inside
  // the ellipse (scaled 0.99) is shadowed, every point clearly outside
  // (scaled 1.01) is lit.
  it('sphere: inside the ellipse iff the ray hits', () => {
    fc.assert(
      fc.property(
        sunArb,
        sphereArb,
        fc.double({ min: -3, max: 3, noNaN: true }),
        fc.double({ min: -3, max: 3, noNaN: true }),
        (s, ball, u, v) => {
          const e = sphereShadowOnPlane(s, ball, 0);
          // Sample around the ellipse so both classes are exercised.
          const p: [number, number] = [
            e.centre[0] + u * e.semiMajorM,
            e.centre[2] + v * e.semiMajorM,
          ];
          const hit = inShadow(s, [p[0], 0, p[1]], [ball]);
          // Inside the ellipse: shadowed; outside: lit; in the thin band
          // around its edge either is right (no claim there).
          const expected = insideEllipse(e, p, 0.99)
            ? true
            : !insideEllipse(e, p, 1.01)
              ? false
              : hit;
          expect(hit).toBe(expected);
        }
      ),
      { numRuns: 500 }
    );
  });

  // The plan's convex hull, against the ray, with a 1 mm guard band.
  it('box: inside the projected hull iff the ray hits', () => {
    fc.assert(
      fc.property(
        sunArb,
        boxArb,
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        (s, box, u, v) => {
          const hull = boxShadowOnPlane(s, box, 0);
          const cx = hull.reduce((a, p) => a + p[0], 0) / hull.length;
          const cz = hull.reduce((a, p) => a + p[1], 0) / hull.length;
          const span = Math.max(
            ...hull.map((p) => Math.hypot(p[0] - cx, p[1] - cz))
          );
          const p: [number, number] = [
            cx + 1.3 * u * span,
            cz + 1.3 * v * span,
          ];
          const d = convexPolygonSignedDistance(p, hull);
          const hit = inShadow(s, [p[0], 0, p[1]], [box]);
          // Inside the hull: shadowed; outside: lit; no claim at the edge.
          const expected = d < -1e-3 ? true : d > 1e-3 ? false : hit;
          expect(hit).toBe(expected);
        }
      ),
      { numRuns: 500 }
    );
  });

  // The face-sum projection formula for any rotation: shadow area =
  // (1/2)·Σ_faces |n·s|·A / s_y. An independent check on the hull.
  it('box: hull area obeys the face-sum projection formula', () => {
    fc.assert(
      fc.property(sunArb, boxArb, (s, box) => {
        const hull = boxShadowOnPlane(s, box, 0);
        const [x, y, z, w] = box.rotation ?? [0, 0, 0, 1];
        const axes: Vec3[] = [
          [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
          [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
          [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)],
        ];
        const [hx, hy, hz] = box.halfExtents;
        const faceArea = [4 * hy * hz, 4 * hx * hz, 4 * hx * hy];
        let silhouette = 0;
        axes.forEach((n, i) => {
          silhouette +=
            Math.abs(n[0] * s[0] + n[1] * s[1] + n[2] * s[2]) * faceArea[i]!;
        });
        expect(polygonArea(hull)).toBeCloseTo(silhouette / s[1], 9);
      }),
      { numRuns: 1000 }
    );
  });
});

describe('the light-space distance', () => {
  // Sign agreement: negative distance iff the ray hits (away from the edge).
  it('is negative exactly where the ray view says shadow', () => {
    const casterArb = fc.oneof(sphereArb, boxArb) as fc.Arbitrary<Caster>;
    fc.assert(
      fc.property(
        sunArb,
        fc.array(casterArb, { minLength: 1, maxLength: 4 }),
        fc.double({ min: -3, max: 3, noNaN: true }),
        fc.double({ min: -3, max: 3, noNaN: true }),
        fc.double({ min: -0.5, max: 4, noNaN: true }),
        (s, casters, x, z, y) => {
          const q: Vec3 = [x, y, z];
          const d = lightSpaceSignedDistance(s, q, casters);
          const hit = inShadow(s, q, casters);
          // Negative distance: shadowed; positive: lit; no claim at 0.
          const expected = d < -1e-9 ? true : d > 1e-9 ? false : hit;
          expect(hit).toBe(expected);
        }
      ),
      { numRuns: 800 }
    );
  });

  // The ground-to-light-space conversion: on a flat receiver, a ground
  // distance dP to the footprint edge is between dP·sin(e) and dP in light
  // space. A texel margin must therefore be converted, never reused on the
  // ground as-is. The bound needs the WHOLE caster toward the sun from the
  // probe: a probe on the sun side of a caster has nothing ahead of it
  // (light-space distance Infinity) however near the footprint it lies.
  it('lies between sin(e) and 1 times the ground distance to the footprint', () => {
    fc.assert(
      fc.property(
        sunArb,
        boxArb,
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        (s, box, u, v) => {
          const hull = boxShadowOnPlane(s, box, 0);
          const cx = hull.reduce((a, p) => a + p[0], 0) / hull.length;
          const cz = hull.reduce((a, p) => a + p[1], 0) / hull.length;
          const p: [number, number] = [cx + 2 * u, cz + 2 * v];
          const q: Vec3 = [p[0], 0, p[1]];
          const wholeAhead = boxCorners(box).every(
            (c) =>
              (c[0] - q[0]) * s[0] +
                (c[1] - q[1]) * s[1] +
                (c[2] - q[2]) * s[2] >
              0
          );
          fc.pre(wholeAhead);
          const dP = Math.abs(convexPolygonSignedDistance(p, hull));
          const dL = Math.abs(lightSpaceSignedDistance(s, q, [box]));
          // Relative tolerance: the bounds are attained exactly along the axes.
          expect(dL).toBeLessThanOrEqual(dP * (1 + 1e-9) + 1e-12);
          expect(dL).toBeGreaterThanOrEqual(s[1] * dP * (1 - 1e-9) - 1e-12);
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe('classifyProbe is sound for every swept margin', () => {
  // The contract the M2 probes rest on: a probe classified 'inside' (or
  // 'outside') at m texels stays in shadow (or light) for EVERY ray within m
  // texels of it in light space: PCF, normal bias and rasterisation all move
  // the lookup by less than that. Swept over the plan's R, N and 2-8 texels.
  it('keeps every ray within the margin in the classified state', () => {
    const configArb = fc.record({
      R: fc.constantFrom(5, 10, 25),
      N: fc.constantFrom(512, 1024, 2048),
      m: fc.constantFrom(2, 3, 4, 6, 8),
    });
    fc.assert(
      fc.property(
        sunArb,
        fc.array(fc.oneof(sphereArb, boxArb) as fc.Arbitrary<Caster>, {
          minLength: 1,
          maxLength: 3,
        }),
        configArb,
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        (s, casters, { R, N, m }, x, z, angle, frac) => {
          const texelM = shadowTexelM(R, N);
          // Probes around the first caster's footprint, so the thin band near
          // its edge (where a wrong margin would show) is actually sampled.
          const first = casters[0]!;
          const size =
            first.kind === 'sphere'
              ? first.radius
              : Math.hypot(...first.halfExtents);
          const foot = projectAlongSun(first.centre, s, 0);
          const reach = (2 * size) / s[1];
          const q: Vec3 = [foot[0] + x * reach, 0, foot[2] + z * reach];
          const cls = classifyProbe(s, q, casters, { texelM, marginTexels: m });
          if (cls === 'edge') return;
          // A random ray within the margin, displaced perpendicular to s.
          const helper: Vec3 = Math.abs(s[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
          const u0: Vec3 = [
            helper[1] * s[2] - helper[2] * s[1],
            helper[2] * s[0] - helper[0] * s[2],
            helper[0] * s[1] - helper[1] * s[0],
          ];
          const un = Math.hypot(...u0);
          const u: Vec3 = [u0[0] / un, u0[1] / un, u0[2] / un];
          const w: Vec3 = [
            s[1] * u[2] - s[2] * u[1],
            s[2] * u[0] - s[0] * u[2],
            s[0] * u[1] - s[1] * u[0],
          ];
          const rho = frac * m * texelM;
          const c = Math.cos(angle) * rho;
          const d = Math.sin(angle) * rho;
          const moved: Vec3 = [
            q[0] + c * u[0] + d * w[0],
            q[1] + c * u[1] + d * w[1],
            q[2] + c * u[2] + d * w[2],
          ];
          expect(inShadow(s, moved, casters)).toBe(cls === 'inside');
        }
      ),
      { numRuns: 1000 }
    );
  });
});
