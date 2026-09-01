import { describe, expect, it } from 'vitest';
import { calcRelativeCoordsInMeters, type Quaternion } from 'gps-plus-slam-js';

import { localPlaneOffset } from './qr-gps-vote';
import { mintQrGeoPose, type MintQrGeoPoseInput } from './qr-geo-pose-minting';

/**
 * Why these tests matter: minting is the authoring half of the QR-pose loop —
 * the composed `QrGeoPose` is what every visitor's relocalization votes are
 * anchored to, forever, for that printed code. The silent failure modes the
 * reviews named must be pinned here: a frame mix-up (raw WebXR fed where
 * GPS-world NUE is required), a wrong heading convention (local +x points
 * TOWARD `headingDeg`), and — caught by the M1 milestone review — an
 * altitude double-count (GPS-world Up IS absolute altitude in this stack;
 * adding a zero altitude on top shipped a several-hundred-metre vertical
 * error at synthetic-accuracy weight). The altitude test is therefore a
 * ROUND-TRIP through the consumer conversion, not a restatement of the
 * implementation.
 */

const ZERO = { lat: 47.5, lon: 8.7 };

/** Vertical-poster quaternion for a compass heading: −heading about Up. */
function verticalQuaternion(headingDeg: number): Quaternion {
  const half = (-headingDeg * Math.PI) / 180 / 2;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

describe('mintQrGeoPose', () => {
  it('round-trips position AND altitude through the consumer conversion', () => {
    const worldNuePosition = { x: 100, y: 405, z: 50 };
    const minted = mintQrGeoPose({
      worldNuePosition,
      worldNueRotation: [0, 0, 0, 1],
      zero: ZERO,
    });

    // The stack's GPS→NUE direction (what gpsDataSlice does to every raw
    // point: zero-altitude hardcoded 0) must reproduce the input position —
    // Up included. The first implementation failed exactly this.
    const backNue = calcRelativeCoordsInMeters(
      ZERO,
      { lat: minted.lat, lon: minted.lon },
      minted.alt,
      0
    );
    expect(backNue[0]).toBeCloseTo(worldNuePosition.x, 6);
    expect(backNue[1]).toBeCloseTo(worldNuePosition.y, 6);
    expect(backNue[2]).toBeCloseTo(worldNuePosition.z, 6);
  });

  it('always carries the rotation, normalized', () => {
    const drifted: Quaternion = [0, 0, 0, 1.0000004];
    const minted = mintQrGeoPose({
      worldNuePosition: { x: 0, y: 0, z: 0 },
      worldNueRotation: drifted,
      zero: ZERO,
    });

    expect(minted.rotation).toBeDefined();
    const [x, y, z, w] = minted.rotation!;
    expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 12);
  });

  it('derives headingDeg for a near-vertical code (the compat field)', () => {
    const minted = mintQrGeoPose({
      worldNuePosition: { x: 0, y: 0, z: 0 },
      worldNueRotation: verticalQuaternion(73),
      zero: ZERO,
    });

    expect(minted.headingDeg).toBeDefined();
    expect(minted.headingDeg!).toBeCloseTo(73, 6);
  });

  it('omits headingDeg for a face-up code (no honest heading exists)', () => {
    // −90° about North: local +z (face normal) → Up.
    const half = (-90 * Math.PI) / 180 / 2;
    const faceUp: Quaternion = [Math.sin(half), 0, 0, Math.cos(half)];

    const minted = mintQrGeoPose({
      worldNuePosition: { x: 0, y: 0, z: 0 },
      worldNueRotation: faceUp,
      zero: ZERO,
    });

    expect(minted.headingDeg).toBeUndefined();
    expect(minted.rotation).toBeDefined();
  });

  it('omits headingDeg for a poster tilted past the 3° vertical tolerance', () => {
    // Heading 40° composed with an 8° forward tilt (about the local x
    // axis): a COMPOSITE rotation exercising the quaternion cross-terms the
    // single-axis cases cannot (milestone review #3).
    const h = verticalQuaternion(40);
    const t = (8 * Math.PI) / 180 / 2;
    const tilt: Quaternion = [Math.sin(t), 0, 0, Math.cos(t)];
    const composed = multiply(h, tilt);

    const minted = mintQrGeoPose({
      worldNuePosition: { x: 0, y: 0, z: 0 },
      worldNueRotation: composed,
      zero: ZERO,
    });

    expect(minted.headingDeg).toBeUndefined();
    // The exact rotation still orients the vote geometry: a point up the
    // QR's local +y leans out of plumb by sin(8°) horizontally.
    const offset = localPlaneOffset([0, 1, 0], minted);
    expect(offset.up).toBeCloseTo(Math.cos((8 * Math.PI) / 180), 9);
    expect(Math.hypot(offset.north, offset.east)).toBeCloseTo(
      Math.sin((8 * Math.PI) / 180),
      9
    );
  });

  it('round-trips through the vote geometry: minted rotation ≡ its heading', () => {
    const minted = mintQrGeoPose({
      worldNuePosition: { x: 10, y: 2, z: -4 },
      worldNueRotation: verticalQuaternion(210),
      zero: ZERO,
    });

    const byRotation = localPlaneOffset([1.5, 0.5, 0], minted);
    const byHeading = localPlaneOffset([1.5, 0.5, 0], {
      lat: minted.lat,
      lon: minted.lon,
      alt: minted.alt,
      headingDeg: minted.headingDeg!,
    });
    expect(byRotation.north).toBeCloseTo(byHeading.north, 9);
    expect(byRotation.east).toBeCloseTo(byHeading.east, 9);
    expect(byRotation.up).toBeCloseTo(byHeading.up, 9);
  });

  it.each([
    [{ x: Number.NaN, y: 0, z: 0 }, [0, 0, 0, 1], 'NaN position'],
    [{ x: 0, y: 0, z: 0 }, [0, 0, 0, 0.5], 'non-unit rotation'],
    [{ x: 0, y: 0, z: 0 }, [0, 0, Number.NaN, 1], 'NaN rotation'],
  ] as [MintQrGeoPoseInput['worldNuePosition'], unknown, string][])(
    'rejects %j / %j (%s)',
    (worldNuePosition, worldNueRotation) => {
      expect(() =>
        mintQrGeoPose({
          worldNuePosition,
          worldNueRotation: worldNueRotation as Quaternion,
          zero: ZERO,
        })
      ).toThrow();
    }
  );
});

/** Hamilton product a·b (apply b first, then a) — test-local on purpose. */
function multiply(a: Quaternion, b: Quaternion): Quaternion {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
