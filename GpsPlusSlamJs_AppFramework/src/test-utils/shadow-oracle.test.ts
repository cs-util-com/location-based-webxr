/**
 * Tests for the analytic shadow oracle (W4 AR shadows plan 2026-09-26-0549,
 * M1).
 *
 * Why this file matters: the M2 pixel page asserts "dark inside the shadow,
 * clear outside it", and that assertion is only as good as the oracle that
 * says where the shadow IS. These tests pin the oracle to answers derived by
 * hand (the plan's ellipse and convex-hull footprints, the face-sum projection
 * area), so a wrong oracle cannot quietly agree with a wrong renderer.
 */
import { describe, expect, it } from 'vitest';

import {
  boxShadowOnPlane,
  classifyProbe,
  convexPolygonSignedDistance,
  inShadow,
  insideEllipse,
  lightSpaceSignedDistance,
  maxInsideMarginTexels,
  polygonArea,
  projectAlongSun,
  shadowTexelM,
  sphereShadowOnPlane,
  type BoxCaster,
  type SphereCaster,
} from './shadow-oracle.js';
import type { Vec3 } from '../visualization/sun-shadow-rig.js';

const DEG = Math.PI / 180;
/** Sun toward azimuth `az` in the x-z plane (0 = +x), elevation `el`. */
const sun = (elDeg: number, azDeg = 0): Vec3 => [
  Math.cos(elDeg * DEG) * Math.cos(azDeg * DEG),
  Math.sin(elDeg * DEG),
  Math.cos(elDeg * DEG) * Math.sin(azDeg * DEG),
];
const OVERHEAD: Vec3 = [0, 1, 0];

/** PhysicsDemo's thrown ball (physics-session.ts: radius 0.08 m). */
const BALL_RADIUS_M = 0.08;

describe('inShadow: the ray view', () => {
  // The simplest known answer: sun overhead, the shadow is the sphere's
  // circle straight below it.
  it('puts the overhead sun shadow of a sphere straight below it', () => {
    const ball: SphereCaster = {
      kind: 'sphere',
      centre: [1, 2, 3],
      radius: 0.5,
    };
    expect(inShadow(OVERHEAD, [1, 0, 3], [ball])).toBe(true);
    expect(inShadow(OVERHEAD, [1.49, 0, 3], [ball])).toBe(true);
    expect(inShadow(OVERHEAD, [1.51, 0, 3], [ball])).toBe(false);
    expect(inShadow(OVERHEAD, [1, 0, 2.51], [ball])).toBe(true);
    expect(inShadow(OVERHEAD, [1, 0, 2.49], [ball])).toBe(false);
  });

  // A caster BEHIND the receiver (between it and the ground, away from the
  // sun) must not shadow it: the ray only counts at t > 0.
  it('ignores a caster that lies away from the sun', () => {
    const ball: SphereCaster = {
      kind: 'sphere',
      centre: [0, -1, 0],
      radius: 0.5,
    };
    expect(inShadow(OVERHEAD, [0, 0, 0], [ball])).toBe(false);
  });

  // A ball's lit cap is lit and its underside is dark: the self-shadow rule
  // the M2 assertion A6 ("a caster hides its own shadow") leans on.
  it('lights the sphere cap facing the sun and shadows its underside', () => {
    const ball: SphereCaster = {
      kind: 'sphere',
      centre: [0, 1, 0],
      radius: 0.5,
    };
    expect(inShadow(OVERHEAD, [0, 1.5, 0], [ball])).toBe(false);
    expect(inShadow(OVERHEAD, [0, 0.5, 0], [ball])).toBe(true);
  });

  it('hits an axis-aligned box and misses beside it', () => {
    const box: BoxCaster = {
      kind: 'box',
      centre: [0, 2, 0],
      halfExtents: [0.5, 0.5, 0.5],
    };
    expect(inShadow(OVERHEAD, [0.49, 0, -0.49], [box])).toBe(true);
    expect(inShadow(OVERHEAD, [0.51, 0, 0], [box])).toBe(false);
  });

  // The rotation is applied: a box rotated 45 degrees about y reaches
  // 0.5·√2 along x, which the unrotated box does not.
  it('rotates the box by its quaternion', () => {
    const s = Math.sin((45 * DEG) / 2);
    const c = Math.cos((45 * DEG) / 2);
    const rotated: BoxCaster = {
      kind: 'box',
      centre: [0, 2, 0],
      halfExtents: [0.5, 0.5, 0.5],
      rotation: [0, s, 0, c],
    };
    expect(inShadow(OVERHEAD, [0.7, 0, 0], [rotated])).toBe(true);
    expect(inShadow(OVERHEAD, [0.72, 0, 0], [rotated])).toBe(false);
    expect(inShadow(OVERHEAD, [0.45, 0, 0.45], [rotated])).toBe(false);
  });

  it('refuses a malformed direction or caster', () => {
    const ball: SphereCaster = {
      kind: 'sphere',
      centre: [0, 1, 0],
      radius: 0.5,
    };
    expect(() => inShadow([0, 2, 0], [0, 0, 0], [ball])).toThrow(RangeError);
    expect(() => inShadow([0, Number.NaN, 0], [0, 0, 0], [ball])).toThrow(
      RangeError
    );
    expect(() =>
      inShadow(OVERHEAD, [0, 0, 0], [{ ...ball, radius: 0 }])
    ).toThrow(RangeError);
    expect(() =>
      inShadow(
        OVERHEAD,
        [0, 0, 0],
        [{ kind: 'box', centre: [0, 1, 0], halfExtents: [1, -1, 1] }]
      )
    ).toThrow(RangeError);
    expect(() =>
      inShadow(
        OVERHEAD,
        [0, 0, 0],
        [
          {
            kind: 'box',
            centre: [0, 1, 0],
            halfExtents: [1, 1, 1],
            rotation: [0, 0, 0, 2],
          },
        ]
      )
    ).toThrow(RangeError);
  });
});

describe("sphereShadowOnPlane: the plan's ellipse", () => {
  // The plan's formula, by hand: sun 30 degrees up toward +x, ball at height
  // 1 m over y = 0: centre C - (1 / 0.5)·s = (-√3, 0, 0), semi-axes r across
  // and r / sin 30° = 2r along.
  it('matches the hand-computed ellipse at 30 degrees', () => {
    const s = sun(30);
    const ball: SphereCaster = {
      kind: 'sphere',
      centre: [0, 1, 0],
      radius: 0.2,
    };
    const e = sphereShadowOnPlane(s, ball, 0);
    expect(e.centre[0]).toBeCloseTo(-Math.sqrt(3), 12);
    expect(e.centre[1]).toBeCloseTo(0, 12);
    expect(e.centre[2]).toBeCloseTo(0, 12);
    expect(e.semiMinorM).toBe(0.2);
    expect(e.semiMajorM).toBeCloseTo(0.4, 12);
    expect(e.majorAxis[0]).toBeCloseTo(1, 12);
  });

  // The ellipse and the ray view must agree just inside and just outside
  // each semi-axis: this is what ties the known answer to the ray oracle.
  it('agrees with the ray view at the ends of both semi-axes', () => {
    const s = sun(30);
    const ball: SphereCaster = {
      kind: 'sphere',
      centre: [0, 1, 0],
      radius: 0.2,
    };
    const e = sphereShadowOnPlane(s, ball, 0);
    const [cx, , cz] = e.centre;
    for (const [dx, dz, expected] of [
      [0.39, 0, true],
      [-0.39, 0, true],
      [0.41, 0, false],
      [-0.41, 0, false],
      [0, 0.19, true],
      [0, -0.19, true],
      [0, 0.21, false],
      [0, -0.21, false],
    ] as const) {
      const q: Vec3 = [cx + dx, 0, cz + dz];
      expect(inShadow(s, q, [ball])).toBe(expected);
      expect(insideEllipse(e, [q[0], q[2]])).toBe(expected);
    }
  });

  // PhysicsDemo's default light: the framework's SUN_LIGHT at (0, 10, 5),
  // aimed at the origin, 63.4 degrees up. A resting ball (centre at r above
  // the floor) throws a shadow only 1.118 r long along the azimuth.
  it('gives the resting-ball footprint under the framework SUN_LIGHT', () => {
    const len = Math.hypot(10, 5);
    const s: Vec3 = [0, 10 / len, 5 / len];
    const ball: SphereCaster = {
      kind: 'sphere',
      centre: [0, BALL_RADIUS_M, 0],
      radius: BALL_RADIUS_M,
    };
    const e = sphereShadowOnPlane(s, ball, 0);
    expect(e.semiMajorM / e.semiMinorM).toBeCloseTo(len / 10, 12);
    // The centre moves away from the light by h / tan(e) = 0.08 · 0.5.
    expect(e.centre[2]).toBeCloseTo(-BALL_RADIUS_M * 0.5, 12);
  });

  it('refuses a sun at the horizon or a sphere through the plane', () => {
    const ball: SphereCaster = {
      kind: 'sphere',
      centre: [0, 1, 0],
      radius: 0.2,
    };
    expect(() => sphereShadowOnPlane([1, 0, 0], ball, 0)).toThrow(RangeError);
    expect(() => sphereShadowOnPlane(OVERHEAD, ball, 0.9)).toThrow(RangeError);
  });
});

describe('boxShadowOnPlane: the convex hull of 8 projected corners', () => {
  // By hand: a unit cube (half 0.5) centred 2 m up, sun 45 degrees up toward
  // +x. Corners at y 1.5 and 2.5 shift by -y along x, so the hull is the
  // rectangle x in [-3, -1], z in [-0.5, 0.5], area 2.
  it('matches the hand-computed rectangle of an axis-aligned cube', () => {
    const box: BoxCaster = {
      kind: 'box',
      centre: [0, 2, 0],
      halfExtents: [0.5, 0.5, 0.5],
    };
    const hull = boxShadowOnPlane(sun(45), box, 0);
    expect(hull).toHaveLength(4);
    const xs = hull.map((p) => p[0]);
    const zs = hull.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(-3, 12);
    expect(Math.max(...xs)).toBeCloseTo(-1, 12);
    expect(Math.min(...zs)).toBeCloseTo(-0.5, 12);
    expect(Math.max(...zs)).toBeCloseTo(0.5, 12);
    expect(polygonArea(hull)).toBeCloseTo(2, 12);
  });

  // The face-sum projection formula: a convex body's shadow area on the plane
  // is (1/2)·Σ|n·s|·A over its faces, divided by s_y. A cube rotated 45
  // degrees about y under a 45-degree sun: (s_y + 0.5 + 0.5) / s_y = 1 + √2,
  // and the outline is a hexagon.
  it('matches the face-sum area for a rotated cube, as a hexagon', () => {
    const half = (45 * DEG) / 2;
    const box: BoxCaster = {
      kind: 'box',
      centre: [0, 2, 0],
      halfExtents: [0.5, 0.5, 0.5],
      rotation: [0, Math.sin(half), 0, Math.cos(half)],
    };
    const hull = boxShadowOnPlane(sun(45), box, 0);
    expect(hull).toHaveLength(6);
    expect(polygonArea(hull)).toBeCloseTo(1 + Math.SQRT2, 12);
  });

  it('refuses a box through the plane', () => {
    const box: BoxCaster = {
      kind: 'box',
      centre: [0, 0.2, 0],
      halfExtents: [0.5, 0.5, 0.5],
    };
    expect(() => boxShadowOnPlane(sun(45), box, 0)).toThrow(RangeError);
  });
});

describe('lightSpaceSignedDistance: the texel-margin measure', () => {
  // Overhead sun, light space IS the ground plane: the distance is the plain
  // distance to the circle's edge.
  it('is the distance to the silhouette edge, negative inside', () => {
    const ball: SphereCaster = {
      kind: 'sphere',
      centre: [0, 2, 0],
      radius: 0.5,
    };
    expect(lightSpaceSignedDistance(OVERHEAD, [0, 0, 0], [ball])).toBeCloseTo(
      -0.5,
      12
    );
    expect(lightSpaceSignedDistance(OVERHEAD, [0.8, 0, 0], [ball])).toBeCloseTo(
      0.3,
      12
    );
  });

  // A tilted sun: a ground step of d along the azimuth is only d·sin(e) in
  // light space, which is why ground margins must be converted, not reused.
  it('compresses ground distance along the azimuth by sin(elevation)', () => {
    const s = sun(30);
    const ball: SphereCaster = {
      kind: 'sphere',
      centre: [0, 1, 0],
      radius: 0.2,
    };
    const e = sphereShadowOnPlane(s, ball, 0);
    const q: Vec3 = [e.centre[0] + 0.4 + 0.1, 0, 0]; // 0.1 m past the tip
    expect(lightSpaceSignedDistance(s, q, [ball])).toBeCloseTo(0.1 * 0.5, 12);
  });

  it('is Infinity with no caster ahead', () => {
    const ball: SphereCaster = {
      kind: 'sphere',
      centre: [0, -2, 0],
      radius: 0.5,
    };
    expect(lightSpaceSignedDistance(OVERHEAD, [0, 0, 0], [ball])).toBe(
      Infinity
    );
    expect(lightSpaceSignedDistance(OVERHEAD, [0, 0, 0], [])).toBe(Infinity);
  });

  // The box's clipped silhouette: a probe beside a box it is level with sees
  // only the part of the box above its own depth plane.
  it('clips a box that straddles the probe depth', () => {
    const box: BoxCaster = {
      kind: 'box',
      centre: [0, 0, 0],
      halfExtents: [0.5, 0.5, 0.5],
    };
    // Overhead sun, probe inside the box's footprint at its mid-height: the
    // upper half lies ahead, same square silhouette.
    expect(lightSpaceSignedDistance(OVERHEAD, [0.2, 0, 0], [box])).toBeCloseTo(
      -0.3,
      12
    );
    // Probe above the box: nothing ahead.
    expect(lightSpaceSignedDistance(OVERHEAD, [0, 0.6, 0], [box])).toBe(
      Infinity
    );
  });

  it('measures a convex polygon exactly', () => {
    const square = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ] as const;
    expect(convexPolygonSignedDistance([0.5, 0.5], square)).toBeCloseTo(
      -0.5,
      12
    );
    expect(convexPolygonSignedDistance([2, 0.5], square)).toBeCloseTo(1, 12);
    expect(convexPolygonSignedDistance([2, 2], square)).toBeCloseTo(
      Math.SQRT2,
      12
    );
  });
});

describe('shadowTexelM and maxInsideMarginTexels: which configs can be judged', () => {
  it('is 2R / N', () => {
    expect(shadowTexelM(25, 1024)).toBeCloseTo(50 / 1024, 15);
    expect(shadowTexelM(5, 2048)).toBeCloseTo(10 / 2048, 15);
    expect(() => shadowTexelM(0, 1024)).toThrow(RangeError);
    expect(() => shadowTexelM(5, 1000.5)).toThrow(RangeError);
  });

  // The plan's review finding, executable: at R 25 m and N 1024 PhysicsDemo's
  // ball is ~3 texels wide (radius 1.64 texels), so NO inside probe exists
  // even at the smallest 2-texel margin; at R 5 m it is judgeable up to 8.
  it('rules the small-ball configurations in or out', () => {
    const at = (R: number, N: number) =>
      maxInsideMarginTexels(BALL_RADIUS_M, R, N);
    expect(2 * at(25, 1024)).toBeCloseTo(3.28, 2);
    expect(at(25, 1024)).toBeLessThan(2);
    expect(at(25, 2048)).toBeGreaterThan(2);
    expect(at(25, 2048)).toBeLessThan(4);
    expect(at(10, 1024)).toBeGreaterThan(4);
    expect(at(5, 1024)).toBeGreaterThan(8);
  });
});

describe('classifyProbe: the declared margin', () => {
  const texelM = shadowTexelM(5, 1024); // ~0.98 cm
  const ball: SphereCaster = {
    kind: 'sphere',
    centre: [0, 1, 0],
    radius: BALL_RADIUS_M,
  };

  // Swept over the plan's 2-8 texel range: the centre stays 'inside' while
  // the margin is below the ball's radius in texels (8.2 here), a probe on
  // the edge is never judged, and a far probe is always 'outside'.
  it.each([2, 3, 4, 6, 8])('holds its classes at a %i-texel margin', (m) => {
    const margin = { texelM, marginTexels: m };
    expect(classifyProbe(OVERHEAD, [0, 0, 0], [ball], margin)).toBe('inside');
    expect(classifyProbe(OVERHEAD, [BALL_RADIUS_M, 0, 0], [ball], margin)).toBe(
      'edge'
    );
    expect(classifyProbe(OVERHEAD, [0.3, 0, 0], [ball], margin)).toBe(
      'outside'
    );
    // The margin is honoured on both sides of the edge: three quarters of it
    // is not enough, just over all of it is.
    const at = (x: number) =>
      classifyProbe(OVERHEAD, [x, 0, 0], [ball], margin);
    expect(at(BALL_RADIUS_M + 0.75 * m * texelM)).toBe('edge');
    expect(at(BALL_RADIUS_M + 1.01 * m * texelM)).toBe('outside');
    expect(at(BALL_RADIUS_M - 0.75 * m * texelM)).toBe('edge');
    // Deep inside only exists while the margin is smaller than the ball.
    const deep = BALL_RADIUS_M - 1.01 * m * texelM;
    expect(deep > 0 ? at(deep) : 'inside').toBe('inside');
  });

  it('judges nothing inside once the margin exceeds the radius', () => {
    const margin = { texelM, marginTexels: 9 };
    expect(classifyProbe(OVERHEAD, [0, 0, 0], [ball], margin)).toBe('edge');
  });

  it('refuses a bad margin', () => {
    expect(() =>
      classifyProbe(OVERHEAD, [0, 0, 0], [ball], { texelM, marginTexels: -1 })
    ).toThrow(RangeError);
    expect(() =>
      classifyProbe(OVERHEAD, [0, 0, 0], [ball], { texelM: 0, marginTexels: 2 })
    ).toThrow(RangeError);
  });
});

describe('projectAlongSun', () => {
  it('slides a point along the sun onto the plane', () => {
    const p = projectAlongSun([0, 1, 0], sun(45), 0);
    expect(p[0]).toBeCloseTo(-1, 12);
    expect(p[1]).toBeCloseTo(0, 12);
  });
});
