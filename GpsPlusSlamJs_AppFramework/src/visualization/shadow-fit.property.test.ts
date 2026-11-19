/**
 * Property tests for the shadow fit, checked through three.js's own shadow
 * camera wherever a claim is about what the GPU samples.
 *
 * Why this file matters: the near map follows the orbit target and is
 * re-rendered on every re-centre and zoom step. If its centre is not on the
 * texel grid in three's real light space, every re-centre makes the shadow
 * edges swim; if its far plane is wrong, the depth fade starts somewhere
 * other than f R past the centre and a seam shows; if the camera stands in
 * front of a caster whose shadow reaches the square, that shadow has a hole.
 * Each of those is invisible to a unit test of the formula alone.
 */
import fc from 'fast-check';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  NEAR_HALF_WIDTH_STEPS,
  FADE_START_DEPTH,
  nearFadeFar,
  nearShadowHalfWidth,
  shadowCasterDistance,
  shadowStrengthAt,
  snapShadowCentre,
  type CityBox,
} from './shadow-fit.js';
import { sunShadowPose, type Vec3 } from './sun-shadow-rig.js';

const DEG = Math.PI / 180;

const sunDir = (azDeg: number, elDeg: number): Vec3 => [
  Math.cos(elDeg * DEG) * Math.cos(azDeg * DEG),
  Math.sin(elDeg * DEG),
  Math.cos(elDeg * DEG) * Math.sin(azDeg * DEG),
];

const sunArb = fc
  .record({
    az: fc.double({ min: 0, max: 360, noNaN: true }),
    el: fc.double({ min: 0.5, max: 89, noNaN: true }),
  })
  .map(({ az, el }) => sunDir(az, el));

const pointArb = fc.tuple(
  fc.double({ min: -3000, max: 3000, noNaN: true }),
  fc.double({ min: -50, max: 50, noNaN: true }),
  fc.double({ min: -3000, max: 3000, noNaN: true })
);

/** A real three.js light posed on `centre`, with its shadow matrix. */
function lightAt(
  centre: Vec3,
  dir: Vec3,
  halfWidthM: number,
  distanceM: number,
  farM?: number
): THREE.DirectionalLight {
  const pose = sunShadowPose({
    sunDir: dir,
    centre,
    halfWidthM,
    distanceM,
    ...(farM === undefined ? {} : { farM }),
  });
  const light = new THREE.DirectionalLight();
  light.position.set(...pose.position);
  light.target.position.set(...pose.target);
  Object.assign(light.shadow.camera, pose.bounds);
  light.shadow.camera.updateProjectionMatrix();
  light.updateMatrixWorld();
  light.target.updateMatrixWorld();
  light.shadow.updateMatrices(light);
  return light;
}

/** A world point in the map's texture space (x, y in [0, 1] inside it). */
function project(light: THREE.DirectionalLight, p: Vec3): THREE.Vector3 {
  return new THREE.Vector3(...p).applyMatrix4(light.shadow.matrix);
}

describe('nearShadowHalfWidth', () => {
  it('is monotone in distance, within its clamp, and only takes the listed steps', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 5000, noNaN: true }),
        fc.double({ min: 1, max: 5000, noNaN: true }),
        fc.constantFrom(0.75, 1, 1.5),
        (a, b, k) => {
          const [near, far] = a <= b ? [a, b] : [b, a];
          const rNear = nearShadowHalfWidth(near, { k });
          const rFar = nearShadowHalfWidth(far, { k });
          expect(rNear).toBeLessThanOrEqual(rFar);
          expect(NEAR_HALF_WIDTH_STEPS).toContain(rNear);
          expect(rNear).toBeGreaterThanOrEqual(120);
          expect(rFar).toBeLessThanOrEqual(600);
        }
      )
    );
  });

  it('covers k x distance whenever the clamp allows it', () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 600, noNaN: true }), (d) => {
        expect(nearShadowHalfWidth(d, { k: 1 })).toBeGreaterThanOrEqual(d);
      })
    );
  });
});

describe('shadowStrengthAt', () => {
  it('is 0 at and below the floor, 1 at and above full, and monotone between', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.constantFrom(0.5, 2, 5),
        fc.constantFrom(5, 8, 12),
        (a, b, floorDeg, extra) => {
          const fullDeg = floorDeg + extra;
          const ramp = { floorDeg, fullDeg };
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(shadowStrengthAt(lo, ramp)).toBeLessThanOrEqual(
            shadowStrengthAt(hi, ramp)
          );
          // At or below the floor it is 0, at or above full strength 1.
          expect(lo > floorDeg || shadowStrengthAt(lo, ramp) === 0).toBe(true);
          expect(hi < fullDeg || shadowStrengthAt(hi, ramp) === 1).toBe(true);
        }
      )
    );
  });
});

describe('snapShadowCentre through three.js', () => {
  // The snapped centre is the light's target, which always projects to the
  // middle of the map, so projecting IT proves nothing. One fixed world point
  // (the origin) projected under two snapped poses must move by whole texels.
  //
  // Mutation record (2026-11-19): with the snap disabled (`return centre`),
  // this property fails on its first generated case.
  it('moves a fixed world point by whole texels between two snapped centres', () => {
    fc.assert(
      fc.property(
        sunArb,
        pointArb,
        pointArb,
        fc.constantFrom(120, 170, 240, 340, 480, 600),
        fc.constantFrom(1024, 2048, 4096),
        (dir, a, b, R, size) => {
          const ca = snapShadowCentre(a, dir, R, size);
          const cb = snapShadowCentre(b, dir, R, size);
          const pa = project(lightAt(ca, dir, R, R + 30), [0, 0, 0]);
          const pb = project(lightAt(cb, dir, R, R + 30), [0, 0, 0]);
          for (const delta of [(pa.x - pb.x) * size, (pa.y - pb.y) * size]) {
            expect(Math.abs(delta - Math.round(delta))).toBeLessThan(1e-3);
          }
        }
      )
    );
  });

  it('moves the centre by at most half a texel per axis, and twice is once', () => {
    fc.assert(
      fc.property(
        sunArb,
        pointArb,
        fc.constantFrom(120, 600),
        fc.constantFrom(1024, 2048),
        (dir, c, R, size) => {
          const once = snapShadowCentre(c, dir, R, size);
          const twice = snapShadowCentre(once, dir, R, size);
          const texel = (2 * R) / size;
          const moved = Math.hypot(
            once[0] - c[0],
            once[1] - c[1],
            once[2] - c[2]
          );
          expect(moved).toBeLessThanOrEqual(texel * Math.SQRT1_2 + 1e-9);
          for (let i = 0; i < 3; i += 1) {
            expect(twice[i]).toBeCloseTo(once[i]!, 9);
          }
          // Depth along the sun is unchanged.
          const depth = (v: Vec3) =>
            v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2];
          expect(depth(once)).toBeCloseTo(depth(c), 9);
        }
      )
    );
  });
});

describe('nearFadeFar through three.js', () => {
  it('puts the fade start at f R past the centre and its end inside the frustum', () => {
    fc.assert(
      fc.property(
        sunArb,
        pointArb,
        fc.double({ min: 120, max: 600, noNaN: true }),
        fc.double({ min: 200, max: 7000, noNaN: true }),
        fc.constantFrom(0.8, 0.9),
        (dir, centre, R, rawD, f) => {
          const D = Math.max(rawD, R + 1);
          const far = nearFadeFar(D, R, f);
          const light = lightAt(centre, dir, R, D, far);
          const at = (pastM: number): Vec3 => [
            centre[0] - dir[0] * pastM,
            centre[1] - dir[1] * pastM,
            centre[2] - dir[2] * pastM,
          ];
          expect(project(light, at(f * R)).z).toBeCloseTo(FADE_START_DEPTH, 6);
          const endPast = (0.995 / FADE_START_DEPTH) * (D + f * R) - D;
          const end = project(light, at(endPast)).z;
          expect(end).toBeCloseTo(0.995, 6);
          expect(end).toBeLessThan(1);
        }
      )
    );
  });
});

describe('shadowCasterDistance', () => {
  // The restated domain: a caster whose shadow can reach the map's square.
  // It stands on the ray from a receiver inside the square toward the sun,
  // at a height up to the tallest; a caster outside the city box does not
  // exist. Such a caster must be in front of the shadow camera, with no
  // margin to hide a formula that is a few metres short.
  it('puts every caster whose shadow reaches the square in front of the camera', () => {
    const city: CityBox = {
      centre: [0, 0, 0],
      halfExtentM: 2400,
      maxHeightM: 157,
    };
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: 0, max: 87, noNaN: true }),
        fc.constantFrom(0.5, 2, 5),
        fc.double({ min: -2300, max: 2300, noNaN: true }),
        fc.double({ min: -2300, max: 2300, noNaN: true }),
        fc.constantFrom(120, 240, 600),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (az, elAbove, floorDeg, cx, cz, R, gx, gz, hFrac) => {
          const el = floorDeg + elAbove * ((89 - floorDeg) / 87);
          const dir = sunDir(az, el);
          const centre: Vec3 = [cx, 0, cz];
          const D = shadowCasterDistance({
            centre,
            sunDir: dir,
            halfWidthM: R,
            city,
            floorDeg,
            marginM: 0,
          });
          const g: Vec3 = [cx + gx * R, 0, cz + gz * R];
          const h = hFrac * city.maxHeightM;
          const t = h / Math.sin(el * DEG);
          const p: Vec3 = [g[0] + dir[0] * t, h, g[2] + dir[2] * t];
          const inCity =
            Math.abs(p[0]) <= city.halfExtentM &&
            Math.abs(p[2]) <= city.halfExtentM;
          fc.pre(inCity);
          const depthFromCamera =
            D - ((p[0] - cx) * dir[0] + p[1] * dir[1] + (p[2] - cz) * dir[2]);
          expect(depthFromCamera).toBeGreaterThanOrEqual(0);
        }
      )
    );
  });

  // The same claim where the CAP binds: a city far larger than any shadow,
  // the sun at the floor itself, the tallest caster over a corner of the
  // square. The generic property above almost never reaches this corner.
  it('keeps the tallest caster at the floor in front of the camera when the cap binds', () => {
    const city: CityBox = {
      centre: [0, 0, 0],
      halfExtentM: 1e6,
      maxHeightM: 157,
    };
    fc.assert(
      fc.property(
        // The diagonals put the sun straight behind a corner of the square.
        fc.oneof(
          fc.constantFrom(45, 135, 225, 315),
          fc.double({ min: 0, max: 360, noNaN: true })
        ),
        fc.constantFrom(0.5, 2, 5, 10, 20),
        fc.constantFrom(120, 240, 600),
        fc.constantFrom(-1, 1),
        fc.constantFrom(-1, 1),
        (az, floorDeg, R, gx, gz) => {
          const dir = sunDir(az, floorDeg);
          const D = shadowCasterDistance({
            centre: [0, 0, 0],
            sunDir: dir,
            halfWidthM: R,
            city,
            floorDeg,
            marginM: 0,
          });
          const h = city.maxHeightM;
          const t = h / Math.sin(floorDeg * DEG);
          const p: Vec3 = [gx * R + dir[0] * t, h, gz * R + dir[2] * t];
          const depth = p[0] * dir[0] + p[1] * dir[1] + p[2] * dir[2];
          expect(D - depth).toBeGreaterThanOrEqual(-1e-9);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('is never closer than R plus the margin, and the cap binds at a high floor', () => {
    const city: CityBox = {
      centre: [0, 0, 0],
      halfExtentM: 2400,
      maxHeightM: 50,
    };
    const dir = sunDir(30, 20);
    expect(
      shadowCasterDistance({
        centre: [2400, 0, 2400],
        sunDir: dir,
        halfWidthM: 240,
        city,
      })
    ).toBeGreaterThanOrEqual(270);
    const capped = shadowCasterDistance({
      centre: [-2000, 0, -2000],
      sunDir: dir,
      halfWidthM: 240,
      city,
      floorDeg: 5,
    });
    expect(capped).toBeCloseTo(
      240 * Math.SQRT2 + 50 / Math.sin(5 * DEG) + 30,
      6
    );
  });
});
