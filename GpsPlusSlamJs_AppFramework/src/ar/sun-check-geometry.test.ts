/**
 * The AR sun check's geometry (plan 2026-09-24-0100, M1, §8.1): known
 * answers and edges. The properties are in `sun-check-geometry.property.test.ts`.
 *
 * WHY THESE TESTS MATTER. The check exists to MEASURE a heading error, so a
 * sign or a factor wrong here produces a confident, wrong number that looks
 * exactly like a real one. The draft plan already carried one such error (a
 * tangent basis that mirrored every heading tick, cold review finding 2).
 * The first version of the owner's known-answer test was itself circular (it
 * aimed the camera at the vector it then projected; M1 review finding 1), so
 * every expectation here comes from an independent path: three.js's own
 * projection and camera rotations, `solarPosition`'s angles, closed-form
 * formulas.
 */
import { nueToWebXR } from 'gps-plus-slam-js';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { solarPosition } from '../geo/solar-position.js';
import { viewAzimuthDeg } from '../visualization/heading-up-rotation.js';
import {
  alignmentYawDeg,
  azElOfNue,
  markerVertexDirection,
  principalRayCamera,
  rotateByMat4,
  sightingErrorDeg,
  sunDirectionNue,
  type Vec3,
} from './sun-check-geometry.js';

const DEG = Math.PI / 180;
/** The largest per-component difference of two vectors. */
const maxDiff = (a: Vec3, b: readonly number[]) =>
  Math.max(...a.map((x, i) => Math.abs(x - b[i]!)));
/** Azimuth difference wrapped to (−180, 180]. */
const azDelta = (a: number, b: number) => ((a - b + 540) % 360) - 180;

const perspective = (fovDeg: number, aspect: number) =>
  new THREE.PerspectiveCamera(fovDeg, aspect, 0.1, 100).projectionMatrix
    .elements as unknown as number[];

describe('directions', () => {
  // The frame convention every other function rests on: NUE, azimuth
  // clockwise from north.
  it('points north, east, south, west and up', () => {
    expect(maxDiff(sunDirectionNue(0, 0), [1, 0, 0])).toBeLessThan(1e-12);
    expect(maxDiff(sunDirectionNue(90 * DEG, 0), [0, 0, 1])).toBeLessThan(
      1e-12
    );
    expect(maxDiff(sunDirectionNue(180 * DEG, 0), [-1, 0, 0])).toBeLessThan(
      1e-12
    );
    expect(maxDiff(sunDirectionNue(270 * DEG, 0), [0, 0, -1])).toBeLessThan(
      1e-12
    );
    expect(
      maxDiff(sunDirectionNue(123 * DEG, 90 * DEG), [0, 1, 0])
    ).toBeLessThan(1e-12);
  });

  // A vertical direction has no azimuth: it reads 0 by convention, and a
  // sighting against it is refused rather than given a confident heading.
  it('reads a vertical direction as azimuth 0 and refuses a heading for it', () => {
    expect(azElOfNue([0, 1, 0])).toEqual({ azimuthDeg: 0, elevationDeg: 90 });
    expect(() => sightingErrorDeg([0, 1, 0], [1, 0, 0])).toThrow(RangeError);
    expect(() => sightingErrorDeg([1, 0, 0], [0, -1, 0])).toThrow(RangeError);
  });

  it('rejects non-finite and non-unit input', () => {
    expect(() => sunDirectionNue(Number.NaN, 0)).toThrow(RangeError);
    expect(() => azElOfNue([1, 1, 0])).toThrow(RangeError);
    expect(() => azElOfNue([Number.NaN, 0, 0])).toThrow(RangeError);
  });
});

describe('the camera ray', () => {
  it('is straight ahead for a symmetric projection', () => {
    expect(
      maxDiff(principalRayCamera(perspective(60, 0.5)), [0, 0, -1])
    ).toBeLessThan(1e-12);
  });

  // An off-centre principal point (P[8], P[9] ≠ 0) tilts the image-centre
  // ray away from the optical axis. The expected rays come from three's own
  // inverse projection, an independent path, so a sign slip in reading the
  // projection cannot agree with itself.
  it('agrees with three.js unprojection, including an off-centre principal point', () => {
    const p = perspective(60, 0.5);
    p[8] = 0.02;
    p[9] = -0.03;
    const inverse = new THREE.Matrix4().fromArray(p).invert();
    for (const ndc of [
      [0, 0],
      [0.5, -0.25],
      [-0.9, 0.9],
    ] as const) {
      const far = new THREE.Vector3(ndc[0], ndc[1], 0.5)
        .applyMatrix4(inverse)
        .normalize();
      expect(
        maxDiff(principalRayCamera(p, ndc), [far.x, far.y, far.z])
      ).toBeLessThan(1e-9);
    }
  });

  // An orthographic or mirrored matrix would give a confident, wrong ray.
  it('rejects malformed, non-perspective and mirrored projections', () => {
    expect(() => principalRayCamera([1, 2, 3])).toThrow(RangeError);
    expect(() => principalRayCamera(new Array(16).fill(Number.NaN))).toThrow(
      RangeError
    );
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
      .projectionMatrix.elements as unknown as number[];
    expect(() => principalRayCamera(ortho)).toThrow(RangeError);
    const mirrored = perspective(60, 0.5);
    mirrored[0] = -mirrored[0]!;
    expect(() => principalRayCamera(mirrored)).toThrow(RangeError);
    expect(() =>
      principalRayCamera(perspective(60, 0.5), [Number.NaN, 0])
    ).toThrow(RangeError);
  });
});

describe('the alignment yaw', () => {
  // NUE atan2(east, north) of the image of north. three's makeRotationY(θ)
  // turns north (x) toward −z, i.e. WEST in NUE, so its yaw is −θ.
  it('reads a pure yaw as the bearing of the image of north', () => {
    for (const theta of [10, 90, -45, 170]) {
      const m = new THREE.Matrix4().makeRotationY(theta * DEG).elements;
      expect(alignmentYawDeg(m)).toBeCloseTo(((-theta % 360) + 360) % 360, 9);
    }
  });

  // A matrix that maps north to vertical has no yaw; "north" would be a lie.
  it('refuses a degenerate matrix', () => {
    expect(() => alignmentYawDeg(new Array(16).fill(0))).toThrow(RangeError);
    expect(() =>
      alignmentYawDeg(new THREE.Matrix4().makeRotationZ(90 * DEG).elements)
    ).toThrow(RangeError);
    expect(() => alignmentYawDeg([1, 2, 3])).toThrow(RangeError);
  });

  // Plan §2.3's trap: viewAzimuthDeg (the minimap's atan2(x, −z) frame) is
  // NOT an NUE bearing. A camera in the NUE scene facing north reads 0 as a
  // bearing of its forward vector and 90 through viewAzimuthDeg.
  it('is not the minimap’s viewAzimuthDeg convention', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.lookAt(new THREE.Vector3(1, 0, 0)); // NUE north
    camera.updateMatrixWorld();
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const bearing = azElOfNue([forward.x, forward.y, forward.z]).azimuthDeg;
    expect(bearing).toBeCloseTo(0, 9);
    expect(viewAzimuthDeg(camera.matrixWorld.elements)).toBeCloseTo(90, 9);
  });
});

describe('rotation helpers', () => {
  it('rotateByMat4 rejects malformed input', () => {
    expect(() => rotateByMat4([1, 2, 3], [1, 0, 0])).toThrow(RangeError);
    const m = new THREE.Matrix4().elements;
    expect(() => rotateByMat4(m, [Number.NaN, 0, 0])).toThrow(RangeError);
  });

  // The exact tilt coupling, signed: a gravity tilt τ IN the sun's vertical
  // plane is pure elevation error; one ACROSS it moves the heading by
  // atan(tan e · sin τ) (≈ τ·tan e to first order; plan §3.4, review
  // finding 6). The first version compared |values| at 3 digits, blind to
  // the sign and to e = 5° (M1 review finding 4).
  it('couples a tilt into heading only across the sun’s vertical plane', () => {
    const tau = 0.5;
    const az = 250;
    const across = new THREE.Vector3(
      -Math.sin(az * DEG),
      0,
      Math.cos(az * DEG)
    );
    const along = new THREE.Vector3(Math.cos(az * DEG), 0, Math.sin(az * DEG));
    for (const el of [5, 20, 35]) {
      const sun = sunDirectionNue(az * DEG, el * DEG);
      const tiltIn = new THREE.Matrix4().makeRotationAxis(
        across,
        tau * DEG
      ).elements;
      const inPlane = sightingErrorDeg(rotateByMat4(tiltIn, sun), sun);
      expect(inPlane.elevationDeg).toBeCloseTo(tau, 9);
      expect(inPlane.headingDeg).toBeCloseTo(0, 9);
      const tiltAcross = new THREE.Matrix4().makeRotationAxis(
        along,
        tau * DEG
      ).elements;
      const leak = sightingErrorDeg(rotateByMat4(tiltAcross, sun), sun);
      const exact = Math.atan(Math.tan(el * DEG) * Math.sin(tau * DEG)) / DEG;
      expect(leak.headingDeg).toBeCloseTo(exact, 9);
    }
  });
});

describe('the marker', () => {
  // Review finding 2, the mirrored ticks: a tick at +N heading degrees sits
  // at azimuth a + N on the sun's almucantar, and +v is UP.
  it('places heading ticks at azimuth a + N and elevation ticks above', () => {
    for (const [az, el] of [
      [0, 5],
      [90, 35],
      [180, 70],
      [270, 20],
    ] as const) {
      for (const n of [-5, -2, -1, 1, 2, 5]) {
        const tick = azElOfNue(markerVertexDirection(az, el, n, 0, 0));
        expect(Math.abs(azDelta(tick.azimuthDeg, az + n))).toBeLessThan(1e-6);
        expect(tick.elevationDeg).toBeCloseTo(el, 6);
      }
      const up = azElOfNue(markerVertexDirection(az, el, 0, 0, 1));
      expect(up.elevationDeg).toBeCloseTo(el + 1, 6);
      // +u leans toward increasing azimuth.
      const right = azElOfNue(markerVertexDirection(az, el, 0, 0.5, 0));
      expect(azDelta(right.azimuthDeg, az)).toBeGreaterThan(0);
    }
  });

  // Offsets are true angles on the axes (a diagonal gnomonic offset is
  // slightly shorter; the marker's rings use a polar form).
  it('keeps axis offsets as true angular distances', () => {
    const sun = sunDirectionNue(123 * DEG, 30 * DEG);
    for (const r of [0.265, 1, 2, 5]) {
      expect(
        sightingErrorDeg(markerVertexDirection(123, 30, 0, r, 0), sun)
          .separationDeg
      ).toBeCloseTo(r, 9);
      expect(
        sightingErrorDeg(markerVertexDirection(123, 30, 0, 0, r), sun)
          .separationDeg
      ).toBeCloseTo(r, 9);
    }
  });

  // At the zenith the basis must still point the right way: +u toward the
  // azimuth a + 90° (the first version only checked unit length, and a
  // sign-flipped fallback survived it; M1 review finding 7).
  it('keeps the basis direction at the zenith', () => {
    const v = markerVertexDirection(40, 90, 0, 1, 0);
    expect(azElOfNue(v).azimuthDeg).toBeCloseTo(130, 6);
  });

  it('rejects out-of-range elevations and offsets', () => {
    expect(() => markerVertexDirection(0, 100, 0, 0, 0)).toThrow(RangeError);
    expect(() => markerVertexDirection(0, 10, 0, 89, 0)).toThrow(RangeError);
    expect(() => markerVertexDirection(0, 10, 0, 0, -89)).toThrow(RangeError);
    expect(() => markerVertexDirection(Number.NaN, 10, 0, 0, 0)).toThrow(
      RangeError
    );
  });

  // The owner's known-answer test. The camera is aimed from solarPosition's
  // ANGLES with three's own rotation (yaw −az about +y, then pitch +el, in
  // the WebXR frame where −z is north), independent of this module; the
  // marker centre is then projected through the library's nueToWebXR. The
  // 265.24° instant carries it: a due-west sun has no north component and
  // could not see a north/south mirror.
  it('puts the marker centre at the image centre for a camera aimed at the sun, and left when yawed +2°', () => {
    const ms = Date.UTC(2026, 8, 23, 17, 0, 53);
    const p = solarPosition(ms, 50.94, 6.96, { refraction: true });
    const az = p.azimuthRad / DEG;
    const el = p.elevationRad / DEG;
    const centre = new THREE.Vector3(
      ...nueToWebXR([...markerVertexDirection(az, el, 0, 0, 0)])
    ).multiplyScalar(10);
    const camera = new THREE.PerspectiveCamera(60, 0.5, 0.1, 100);
    const aim = (yawDeg: number) => {
      camera.rotation.set(el * DEG, -yawDeg * DEG, 0, 'YXZ');
      camera.updateMatrixWorld();
      return centre.clone().project(camera);
    };
    const straight = aim(az);
    expect(Math.abs(straight.x)).toBeLessThan(1e-9);
    expect(Math.abs(straight.y)).toBeLessThan(1e-9);
    // Yawed 2° clockwise, the sun appears LEFT by P0·tan(2°)·cos(e) to
    // first order (the exact value differs by < 1 %).
    const yawed = aim(az + 2);
    const firstOrder =
      camera.projectionMatrix.elements[0] *
      Math.tan(2 * DEG) *
      Math.cos(el * DEG);
    expect(yawed.x).toBeLessThan(0);
    expect(Math.abs(yawed.x / -firstOrder - 1)).toBeLessThan(0.01);
  });
});
