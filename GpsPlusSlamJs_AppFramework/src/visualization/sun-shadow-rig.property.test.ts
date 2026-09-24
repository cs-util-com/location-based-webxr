/**
 * Property tests for the sun-shadow rig, against three.js itself.
 *
 * Why this file matters: the rig's bounds only mean something in three's
 * shadow-camera convention (the camera at the light, looking at the target
 * with world up, near/far along its view axis). So the frustum claims are
 * checked by building a real `DirectionalLight` from the pose and projecting
 * points through its `shadow.matrix` (M1 review, finding 8). The coverage
 * sweep is what CHOSE `SUN_SHADOW.innerFraction` (review finding 2): a
 * caster near the user must keep its whole shadow inside the map for every
 * drift that does not trigger an update.
 */
import fc from 'fast-check';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { SUN_SHADOW, sunShadowPose, type Vec3 } from './sun-shadow-rig.js';

const DEG = Math.PI / 180;

const sunNue = (azDeg: number, elDeg: number): Vec3 => [
  Math.cos(elDeg * DEG) * Math.cos(azDeg * DEG),
  Math.sin(elDeg * DEG),
  Math.cos(elDeg * DEG) * Math.sin(azDeg * DEG),
];

/** A real three.js light built from the pose, with its shadow matrix. */
function shadowOf(
  pose: ReturnType<typeof sunShadowPose>
): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight();
  light.position.set(...pose.position);
  light.target.position.set(...pose.target);
  const cam = light.shadow.camera;
  Object.assign(cam, pose.bounds);
  cam.updateProjectionMatrix();
  light.updateMatrixWorld();
  light.target.updateMatrixWorld();
  light.shadow.updateMatrices(light);
  return light;
}

/** Whether a world point lands inside the shadow map (texture space [0,1]^3). */
function inMap(light: THREE.DirectionalLight, p: Vec3, eps = 1e-6): boolean {
  const v = new THREE.Vector3(...p).applyMatrix4(light.shadow.matrix);
  return [v.x, v.y, v.z].every((c) => c >= -eps && c <= 1 + eps);
}

describe('the shadow camera, in three.js', () => {
  // Every point within R of the centre, the six extreme points included,
  // and the column toward the sun up to the light, land inside the map.
  it('contains the sphere of radius R and the sunward column', () => {
    const R = SUN_SHADOW.halfWidthM;
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 359.9, noNaN: true }),
        fc.double({ min: 5, max: 89, noNaN: true }),
        fc.array(
          fc.tuple(
            fc.double({ min: -1, max: 1, noNaN: true }),
            fc.double({ min: -1, max: 1, noNaN: true }),
            fc.double({ min: -1, max: 1, noNaN: true })
          ),
          { minLength: 1, maxLength: 40 }
        ),
        (az, el, raw) => {
          const s = sunNue(az, el);
          const centre: Vec3 = [5, 1, -7];
          const pose = sunShadowPose({ sunDir: s, centre });
          const light = shadowOf(pose);
          const points: Vec3[] = raw.map(([x, y, z]) => {
            const l = Math.hypot(x, y, z) || 1;
            const k = Math.min(1, l) / l;
            return [
              centre[0] + x * k * R,
              centre[1] + y * k * R,
              centre[2] + z * k * R,
            ];
          });
          // The six extreme points: ±R along the light axis and both
          // lateral axes (the tight ones a random sample never reaches).
          const up = new THREE.Vector3(0, 1, 0);
          const z = new THREE.Vector3(...s);
          const x = new THREE.Vector3().crossVectors(up, z).normalize();
          const y = new THREE.Vector3().crossVectors(z, x);
          for (const axis of [z, x, y]) {
            for (const sign of [1, -1]) {
              points.push([
                centre[0] + sign * axis.x * R * (1 - 1e-9),
                centre[1] + sign * axis.y * R * (1 - 1e-9),
                centre[2] + sign * axis.z * R * (1 - 1e-9),
              ]);
            }
          }
          const D = R + SUN_SHADOW.marginM;
          for (const a of [0.5 * D, 0.9 * D]) {
            points.push([
              centre[0] + s[0] * a,
              centre[1] + s[1] * a,
              centre[2] + s[2] * a,
            ]);
          }
          for (const p of points) expect(inMap(light, p)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  // And it is not larger than claimed: a point just past R laterally falls
  // outside (a swapped or doubled bound would keep it in).
  it('ends at the claimed square', () => {
    const s = sunNue(200, 30);
    const pose = sunShadowPose({ sunDir: s, centre: [0, 0, 0] });
    const light = shadowOf(pose);
    const z = new THREE.Vector3(...s);
    const x = new THREE.Vector3()
      .crossVectors(new THREE.Vector3(0, 1, 0), z)
      .normalize();
    const R = SUN_SHADOW.halfWidthM;
    expect(inMap(light, [x.x * R * 0.99, x.y * R * 0.99, x.z * R * 0.99])).toBe(
      true
    );
    expect(inMap(light, [x.x * R * 1.01, x.y * R * 1.01, x.z * R * 1.01])).toBe(
      false
    );
  });
});

describe('coverage: a caster near the user keeps its shadow in the map', () => {
  /**
   * The worst case of the update rule: the map was rendered for `centre`,
   * the user drifted `inner · R` (just under the trigger) in some direction,
   * and a caster of height h stands within `rho` of the user. Its base and
   * its shadow tip must both be in the map.
   */
  function holds(
    elDeg: number,
    R: number,
    innerFraction: number,
    h: number,
    rho: number
  ): boolean {
    for (let a = 0; a < 360; a += 15) {
      const s = sunNue(a, elDeg);
      const light = shadowOf(
        sunShadowPose({ sunDir: s, centre: [0, 0, 0], halfWidthM: R })
      );
      const tipLen = h / Math.tan(elDeg * DEG);
      const away: Vec3 = [-s[0], 0, -s[2]];
      const al = Math.hypot(away[0], away[2]);
      for (let b = 0; b < 360; b += 15) {
        const drift = innerFraction * R * 0.999;
        const ux = drift * Math.cos(b * DEG);
        const uz = drift * Math.sin(b * DEG);
        for (let c = 0; c < 360; c += 45) {
          const bx = ux + rho * Math.cos(c * DEG);
          const bz = uz + rho * Math.sin(c * DEG);
          const tip: Vec3 = [
            bx + (away[0] / al) * tipLen,
            0,
            bz + (away[2] / al) * tipLen,
          ];
          if (
            !inMap(light, [bx, 0, bz]) ||
            !inMap(light, [bx, h, bz]) ||
            !inMap(light, tip)
          ) {
            return false;
          }
        }
      }
    }
    return true;
  }

  // The prototype's caster: the 1.5 m test pole, a few metres from the user
  // (plan §7 finding 1). The DEFAULTS must hold at every sun from the
  // elevation floor up.
  it('holds for the test pole at the defaults, from the elevation floor up', () => {
    for (const el of [SUN_SHADOW.minSunElevationDeg, 20, 40, 70]) {
      for (const rho of [0, 3, 6]) {
        expect(
          holds(el, SUN_SHADOW.halfWidthM, SUN_SHADOW.innerFraction, 1.5, rho)
        ).toBe(true);
      }
    }
  });

  // The sweep that chose the default (the owner's sweep rule): R {10, 25,
  // 75} × inner {0.25, 0.5} × sun {10, 20, 40}. Logged as a table; the
  // assertions pin the two facts the default rests on.
  it('sweeps R, the inner fraction and the sun', () => {
    const rows: string[] = [];
    for (const R of [10, 25, 75]) {
      for (const inner of [0.25, 0.5]) {
        const cells = [10, 20, 40].map((el) =>
          holds(el, R, inner, 1.5, 6) ? 'ok' : 'CUT'
        );
        rows.push(`R ${R} inner ${inner}: ${cells.join(' ')} (sun 10/20/40°)`);
      }
    }
    console.log(
      `shadow coverage, 1.5 m pole within 6 m:\n  ${rows.join('\n  ')}`
    );
    // The default R 25 needs the inner quarter at a 10° sun; half cuts.
    expect(holds(10, 25, 0.25, 1.5, 6)).toBe(true);
    expect(holds(10, 25, 0.5, 1.5, 6)).toBe(false);
    // A 10 m square cannot hold a 10° shadow of the pole 6 m away.
    expect(holds(10, 10, 0.5, 1.5, 6)).toBe(false);
  });
});
