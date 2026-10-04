/**
 * The AR sun check's geometry, as properties (plan 2026-09-24-0100, M1,
 * §8.1). Known answers and edges are in `sun-check-geometry.test.ts`.
 *
 * WHY THESE PROPERTIES MATTER. The check's one job is to report a heading
 * error correctly for ANY alignment, sun and camera pose, so each property
 * drives the full chain the controller will use: a camera's principal ray,
 * rotated by the WebXR view, converted with the library's `webxrToNUE`, then
 * by the app's alignment. The first version only rotated the sun vector,
 * which pinned no composition order (M1 review finding 3).
 */
import { nueToWebXR, webxrToNUE } from 'gps-plus-slam-js';
import fc from 'fast-check';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { solarPosition } from '../geo/solar-position.js';
import {
  azElOfNue,
  principalRayCamera,
  rotateByMat4,
  sightingErrorDeg,
  sunDirectionNue,
  type Vec3,
} from './sun-check-geometry.js';

const DEG = Math.PI / 180;

/** An NUE rotation by `yawDeg` CLOCKWISE (increasing azimuth), column-major. */
const yawClockwise = (yawDeg: number) =>
  new THREE.Matrix4().makeRotationY(-yawDeg * DEG);

const PROJECTION = new THREE.PerspectiveCamera(60, 0.5, 0.1, 100)
  .projectionMatrix.elements as unknown as number[];

/**
 * The observed ray, through the whole chain: a WebXR camera that looks at the
 * sun in the TRUE world (with some roll), seen through an alignment that is
 * the true one rotated `deltaDeg` clockwise.
 */
function observedRay(
  sun: Vec3,
  trueYawDeg: number,
  deltaDeg: number,
  rollDeg: number,
  referenceYawDeg = 0
): Vec3 {
  // The WebXR reference space may itself be yawed (a different session
  // origin); the true alignment compensates, so the world is unchanged.
  const reference = new THREE.Matrix4().makeRotationY(referenceYawDeg * DEG);
  const referenceNue = yawClockwise(referenceYawDeg); // the same yaw, seen in NUE
  const trueAlignment = yawClockwise(trueYawDeg).multiply(referenceNue);
  // The sun in the camera's WebXR world: undo the true alignment, then NUE → WebXR.
  const inverse = trueAlignment.clone().invert().elements;
  const sunXr = new THREE.Vector3(
    ...nueToWebXR([...rotateByMat4(inverse, sun)])
  );
  const camera = new THREE.PerspectiveCamera();
  camera.lookAt(sunXr);
  camera.rotateZ(rollDeg * DEG);
  camera.updateMatrixWorld();
  const view = reference.clone().invert().multiply(camera.matrixWorld).elements;
  const rayXr = rotateByMat4(
    reference.elements,
    rotateByMat4(view, principalRayCamera(PROJECTION))
  );
  const rayNue = webxrToNUE([...rayXr]);
  const app = yawClockwise(deltaDeg).multiply(trueAlignment).elements;
  return rotateByMat4(app, rayNue);
}

describe('an injected heading error is measured exactly', () => {
  // The heart of the check: for a random true alignment, sun, camera roll
  // and yaw error δ, the reticle aimed at the real sun reports h = δ, v = 0.
  it('reports h = δ and v = 0 through the full chain', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 359.9, noNaN: true }),
        fc.double({ min: -1, max: 80, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: -30, max: 30, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (az, el, trueYaw, delta, roll) => {
          const sun = sunDirectionNue(az * DEG, el * DEG);
          const err = sightingErrorDeg(
            observedRay(sun, trueYaw, delta, roll),
            sun
          );
          expect(err.headingDeg).toBeCloseTo(delta, 8);
          expect(err.elevationDeg).toBeCloseTo(0, 8);
        }
      )
    );
  });

  // Rotating the WebXR reference space and compensating in the alignment
  // leaves the world, and so the measurement, unchanged.
  it('is invariant to the WebXR reference space’s yaw', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 359.9, noNaN: true }),
        fc.double({ min: 0, max: 60, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: -10, max: 10, noNaN: true }),
        (az, el, referenceYaw, delta) => {
          const sun = sunDirectionNue(az * DEG, el * DEG);
          const h = (ref: number) =>
            sightingErrorDeg(observedRay(sun, 40, delta, 0, ref), sun)
              .headingDeg;
          expect(h(referenceYaw)).toBeCloseTo(h(0), 8);
        }
      )
    );
  });

  // The sun is at infinity: a translation in the alignment moves no
  // direction, so the check is blind to position error.
  it('ignores translation', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.double({ min: 0, max: 359, noNaN: true }),
        (tx, tz, az) => {
          const m = yawClockwise(3).elements;
          m[12] = tx;
          m[14] = tz;
          const sun = sunDirectionNue(az * DEG, 20 * DEG);
          expect(
            sightingErrorDeg(rotateByMat4(m, sun), sun).headingDeg
          ).toBeCloseTo(3, 9);
        }
      )
    );
  });

  // Correcting the alignment by the measured h (sign as specified) removes it.
  it('round-trips: undoing the measured heading makes it zero', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 359.9, noNaN: true }),
        fc.double({ min: 0, max: 60, noNaN: true }),
        fc.double({ min: -20, max: 20, noNaN: true }),
        (az, el, delta) => {
          const sun = sunDirectionNue(az * DEG, el * DEG);
          const observed = observedRay(sun, 0, delta, 0);
          const h = sightingErrorDeg(observed, sun).headingDeg;
          const corrected = rotateByMat4(yawClockwise(-h).elements, observed);
          expect(sightingErrorDeg(corrected, sun).headingDeg).toBeCloseTo(0, 8);
        }
      )
    );
  });
});

describe('directions', () => {
  it('inverts to the same azimuth and elevation', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 359.999, noNaN: true }),
        fc.double({ min: -89, max: 89, noNaN: true }),
        (az, el) => {
          const back = azElOfNue(sunDirectionNue(az * DEG, el * DEG));
          expect(
            Math.abs(((back.azimuthDeg - az + 540) % 360) - 180)
          ).toBeLessThan(1e-9);
          expect(back.elevationDeg).toBeCloseTo(el, 9);
        }
      )
    );
  });
});

// Plan §3.1 (location choice): the sun is computed at the GPS zero reference,
// not at the camera. Within 1 km of it the computed sun direction moves by
// at most 0.03° ON THE SKY (angular separation; raw azimuth is
// ill-conditioned near the zenith), at any latitude from −60° to 70° and any
// time. Measured ~0.011° per km at Cologne's golden hour.
describe('the location choice', () => {
  it('moves the sun ≤ 0.03° on the sky within 1 km of the zero reference', () => {
    const KM_PER_DEG_LAT = 111.32;
    fc.assert(
      fc.property(
        fc.double({ min: -60, max: 70, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) }),
        fc.constantFrom('north', 'east'),
        (lat, lng, ms, way) => {
          const at = (la: number, ln: number) => {
            const p = solarPosition(ms, la, ln, { refraction: true });
            return sunDirectionNue(p.azimuthRad, p.elevationRad);
          };
          const moved =
            way === 'north'
              ? at(lat + 1 / KM_PER_DEG_LAT, lng)
              : at(lat, lng + 1 / (KM_PER_DEG_LAT * Math.cos(lat * DEG)));
          const here = at(lat, lng);
          const dot =
            moved[0] * here[0] + moved[1] * here[1] + moved[2] * here[2];
          const separationDeg = Math.acos(Math.min(1, dot)) / DEG;
          expect(separationDeg).toBeLessThan(0.03);
        }
      ),
      { numRuns: 300 }
    );
  });
});
