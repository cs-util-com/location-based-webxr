/**
 * Tests for the sun-shadow rig (AR sun shadow prototype plan
 * 2026-09-23-2343, M1).
 *
 * Why this file matters: a virtual shadow is only useful if it falls where
 * the real ones do. The rig's failure modes are geometric (a shadow pointing
 * toward the sun, a frame mix-up, a caster outside the shadow camera) or
 * about WHEN the map re-renders (too often costs the phone, too rarely makes
 * the shadow jump or leave the map). Every expected value here comes from an
 * independent formula, not from the rig's own output; the three.js
 * convention and the coverage sweep live in `sun-shadow-rig.property.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { sunDirectionNue } from '../ar/sun-check-geometry.js';
import {
  SUN_SHADOW,
  shadowNeedsUpdate,
  shadowOpacity,
  sunShadowActive,
  sunShadowPose,
  type ShadowUpdateState,
  type Vec3,
} from './sun-shadow-rig.js';

const DEG = Math.PI / 180;

/** Unit direction TOWARD the sun in NUE (x north, y up, z east): a local oracle. */
const sunNue = (azDeg: number, elDeg: number): Vec3 => [
  Math.cos(elDeg * DEG) * Math.cos(azDeg * DEG),
  Math.sin(elDeg * DEG),
  Math.cos(elDeg * DEG) * Math.sin(azDeg * DEG),
];

/** The same in the demo axes (x east, y up, -z north). */
const sunDemo = (azDeg: number, elDeg: number): Vec3 => {
  const [n, u, e] = sunNue(azDeg, elDeg);
  return [e, u, -n];
};

/**
 * The tip of a vertical pole of height 1 standing at the pose's centre,
 * cast along the light (target - position) onto the ground plane through
 * the centre. Independent of the rig: it only uses the light's line.
 */
function poleShadowTip(pose: ReturnType<typeof sunShadowPose>): Vec3 {
  const [px, py, pz] = pose.position;
  const [tx, ty, tz] = pose.target;
  const l = Math.hypot(tx - px, ty - py, tz - pz);
  const d: Vec3 = [(tx - px) / l, (ty - py) / l, (tz - pz) / l];
  const top: Vec3 = [tx, ty + 1, tz];
  const t = 1 / -d[1];
  return [top[0] + d[0] * t, top[1] + d[1] * t, top[2] + d[2] * t];
}

describe('sunShadowPose', () => {
  // The independent formula: a pole of height h casts a shadow of length
  // h / tan(e), pointing AWAY from the sun (azimuth + 180°).
  it('casts a pole shadow away from the sun with length 1/tan(e), in NUE', () => {
    for (const az of [0, 45, 135, 180, 250, 359]) {
      for (const el of [5, 10, 20, 40, 70]) {
        const pose = sunShadowPose({
          sunDir: sunNue(az, el),
          centre: [3, 1.2, -4],
        });
        const tip = poleShadowTip(pose);
        const dx = tip[0] - 3;
        const dz = tip[2] + 4;
        expect(tip[1]).toBeCloseTo(1.2, 9);
        expect(Math.hypot(dx, dz)).toBeCloseTo(1 / Math.tan(el * DEG), 6);
        const shadowAz = (Math.atan2(dz, dx) / DEG + 360) % 360;
        const away = (az + 180) % 360;
        const diff = Math.abs(((shadowAz - away + 540) % 360) - 180);
        expect(diff).toBeLessThan(1e-6);
      }
    }
  });

  // Known answers in both frames (review finding 12): sun due south, the
  // shadow points north: +x in NUE, -z in the demo axes.
  it("points a south sun's shadow north in both frames", () => {
    const nue = poleShadowTip(
      sunShadowPose({ sunDir: sunNue(180, 30), centre: [0, 0, 0] })
    );
    expect(nue[0]).toBeGreaterThan(1.7);
    expect(Math.abs(nue[2])).toBeLessThan(1e-9);
    const demo = poleShadowTip(
      sunShadowPose({ sunDir: sunDemo(180, 30), centre: [0, 0, 0] })
    );
    expect(demo[2]).toBeLessThan(-1.7);
    expect(Math.abs(demo[0])).toBeLessThan(1e-9);
  });

  // The M3 seam (M1 review, finding 14): the framework's own NUE sun helper
  // fed straight in. A German noon sun stands south, so the shadow points
  // north (+x); if the helper and the rig ever disagreed on "toward the
  // sun", this flips.
  it('takes the framework NUE sun helper as is', () => {
    const tip = poleShadowTip(
      sunShadowPose({
        sunDir: sunDirectionNue(180 * DEG, 40 * DEG),
        centre: [0, 0, 0],
      })
    );
    expect(tip[0]).toBeCloseTo(1 / Math.tan(40 * DEG), 9);
    expect(Math.abs(tip[2])).toBeLessThan(1e-9);
  });

  it('places the light along the sun, the target at the centre, the camera from the light', () => {
    const pose = sunShadowPose({ sunDir: sunNue(200, 25), centre: [1, 2, 3] });
    const R = SUN_SHADOW.halfWidthM;
    const D = R + SUN_SHADOW.marginM;
    const s = sunNue(200, 25);
    expect(pose.target).toEqual([1, 2, 3]);
    for (let i = 0; i < 3; i++) {
      expect(pose.position[i]).toBeCloseTo([1, 2, 3][i]! + s[i]! * D, 9);
    }
    // The whole object: a top/bottom swap mirrors the projection.
    expect(pose.bounds).toEqual({
      left: -R,
      right: R,
      top: R,
      bottom: -R,
      near: 0,
      far: D + R,
    });
  });

  it.each([
    [
      'a zero direction',
      { sunDir: [0, 0, 0] as Vec3, centre: [0, 0, 0] as Vec3 },
    ],
    [
      'a non-unit direction',
      { sunDir: [0, 2, 0] as Vec3, centre: [0, 0, 0] as Vec3 },
    ],
    [
      'a sun on the horizon',
      { sunDir: [1, 0, 0] as Vec3, centre: [0, 0, 0] as Vec3 },
    ],
    [
      'a non-finite centre',
      { sunDir: [0, 1, 0] as Vec3, centre: [Number.NaN, 0, 0] as Vec3 },
    ],
    [
      'a zero half width',
      { sunDir: [0, 1, 0] as Vec3, centre: [0, 0, 0] as Vec3, halfWidthM: 0 },
    ],
    [
      'a NaN half width',
      {
        sunDir: [0, 1, 0] as Vec3,
        centre: [0, 0, 0] as Vec3,
        halfWidthM: Number.NaN,
      },
    ],
    [
      'a distance not beyond R',
      {
        sunDir: [0, 1, 0] as Vec3,
        centre: [0, 0, 0] as Vec3,
        halfWidthM: 25,
        distanceM: 25,
      },
    ],
  ])('rejects %s', (_name, input) => {
    expect(() => sunShadowPose(input)).toThrow(RangeError);
  });
});

describe('shadowNeedsUpdate', () => {
  const R = SUN_SHADOW.halfWidthM;
  const base: ShadowUpdateState = {
    sunDir: sunNue(200, 20),
    centre: [0, 0, 0],
    halfWidthM: R,
    casterGeneration: 'g1:3',
    casterOffsetM: 0,
  };

  // Review finding 4: the first frame always renders.
  it('renders the first map, and not again for the same state', () => {
    expect(shadowNeedsUpdate(undefined, base)).toBe(true);
    expect(shadowNeedsUpdate(base, { ...base })).toBe(false);
  });

  // Review finding 5: 0.05° by default, tested at and just past the step,
  // and at each swept value.
  it('re-renders when the sun moved more than the threshold', () => {
    const tiny = { ...base, sunDir: sunNue(200, 20 + 0.049) };
    const past = { ...base, sunDir: sunNue(200, 20 + 0.051) };
    expect(shadowNeedsUpdate(base, tiny)).toBe(false);
    expect(shadowNeedsUpdate(base, past)).toBe(true);
    for (const deg of [0.1, 0.25]) {
      const slow = { ...base, sunDir: sunNue(200, 20 + 0.9 * deg) };
      const fast = { ...base, sunDir: sunNue(200, 20 + 1.1 * deg) };
      expect(shadowNeedsUpdate(base, slow, { sunDeg: deg })).toBe(false);
      expect(shadowNeedsUpdate(base, fast, { sunDeg: deg })).toBe(true);
    }
  });

  // M1 review, finding 7: the state kept is the LAST RENDER's. Sub-threshold
  // steps add up; a caller that kept the last FRAME would never update.
  it('adds up sub-threshold sun steps against the last render', () => {
    let rendered = base;
    let renders = 0;
    for (let k = 1; k <= 50; k++) {
      const now = { ...base, sunDir: sunNue(200, 20 + 0.01 * k) };
      if (shadowNeedsUpdate(rendered, now)) {
        rendered = now;
        renders += 1;
      }
    }
    // 0.5° in 0.01° steps against a 0.05° threshold: about every sixth step.
    expect(renders).toBeGreaterThanOrEqual(7);
    expect(renders).toBeLessThanOrEqual(10);
  });

  // M1 review, finding 2: horizontal EUCLIDEAN distance (the shadow
  // camera's square is turned to the sun's azimuth, so a Chebyshev test in
  // the caller's axes let the diagonal drift to R/2 · √2).
  it('re-renders when the user left the inner circle, diagonally too', () => {
    const inner = SUN_SHADOW.innerFraction * R;
    const d = inner / Math.SQRT2;
    expect(
      shadowNeedsUpdate(base, { ...base, centre: [0.99 * d, 5, 0.99 * d] })
    ).toBe(false);
    expect(
      shadowNeedsUpdate(base, { ...base, centre: [1.01 * d, 0, 1.01 * d] })
    ).toBe(true);
    expect(
      shadowNeedsUpdate(base, { ...base, centre: [0, 0, -(inner + 0.01)] })
    ).toBe(true);
  });

  // The receiver height is NOT a trigger (a receiver only samples the map).
  it('ignores the receiver height', () => {
    expect(shadowNeedsUpdate(base, { ...base, centre: [0, 3, 0] })).toBe(false);
  });

  // M1 review, finding 6: an easing content root moves the casters every
  // frame; exact matching would re-render every frame for seconds.
  it('follows the caster set exactly and the caster offset by a threshold', () => {
    expect(shadowNeedsUpdate(base, { ...base, casterGeneration: 'g2:3' })).toBe(
      true
    );
    expect(shadowNeedsUpdate(base, { ...base, casterOffsetM: 0.009 })).toBe(
      false
    );
    expect(shadowNeedsUpdate(base, { ...base, casterOffsetM: -0.011 })).toBe(
      true
    );
    expect(
      shadowNeedsUpdate(
        base,
        { ...base, casterOffsetM: 0.03 },
        { casterMoveM: 0.05 }
      )
    ).toBe(false);
  });

  // M1 review, finding 5: R lives in the rendered state; a changed R is a
  // different map.
  it('re-renders when the square size changed', () => {
    expect(shadowNeedsUpdate(base, { ...base, halfWidthM: 10 })).toBe(true);
  });

  // M1 review, finding 10: a NaN would make every comparison false and stop
  // the updates silently.
  it('refuses non-finite states and bad thresholds', () => {
    expect(() =>
      shadowNeedsUpdate(base, { ...base, centre: [Number.NaN, 0, 0] })
    ).toThrow(RangeError);
    expect(() =>
      shadowNeedsUpdate(base, { ...base, casterOffsetM: Number.NaN })
    ).toThrow(RangeError);
    expect(() => shadowNeedsUpdate(base, base, { sunDeg: Number.NaN })).toThrow(
      RangeError
    );
    expect(() =>
      shadowNeedsUpdate(base, base, { innerFraction: -0.1 })
    ).toThrow(RangeError);
    expect(() => shadowNeedsUpdate({ ...base, halfWidthM: 0 }, base)).toThrow(
      RangeError
    );
  });
});

describe('shadowOpacity', () => {
  // Display-space opacity for a linear transmittance (exploration §6.3), at
  // the plan's swept values 0.2 / 0.3 / 0.5.
  it('maps transmittance to display opacity, monotone', () => {
    expect(shadowOpacity(1)).toBe(0);
    expect(shadowOpacity(0)).toBe(1);
    expect(shadowOpacity(0.2)).toBeCloseTo(0.5188, 4);
    expect(shadowOpacity(0.3)).toBeCloseTo(0.4215, 4);
    expect(shadowOpacity(0.5)).toBeCloseTo(0.2703, 4);
    let last = 2;
    for (let t = 0; t <= 1; t += 0.05) {
      const a = shadowOpacity(t);
      expect(a).toBeLessThanOrEqual(last);
      last = a;
    }
    expect(() => shadowOpacity(-0.1)).toThrow(RangeError);
    expect(() => shadowOpacity(1.1)).toThrow(RangeError);
    expect(() => shadowOpacity(Number.NaN)).toThrow(RangeError);
  });
});

describe('sunShadowActive', () => {
  // Review finding 10: below the elevation floor the shadow stays off.
  it('is on from the elevation floor up, at each swept floor', () => {
    expect(sunShadowActive(SUN_SHADOW.minSunElevationDeg)).toBe(true);
    expect(sunShadowActive(SUN_SHADOW.minSunElevationDeg - 0.01)).toBe(false);
    for (const floor of [2, 5, 10]) {
      expect(sunShadowActive(floor, floor)).toBe(true);
      expect(sunShadowActive(floor - 0.01, floor)).toBe(false);
    }
    expect(sunShadowActive(Number.NaN)).toBe(false);
    expect(() => sunShadowActive(20, Number.NaN)).toThrow(RangeError);
  });
});
