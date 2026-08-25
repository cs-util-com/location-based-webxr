import { describe, expect, it } from 'vitest';
import { calcGpsCoords, type Quaternion } from 'gps-plus-slam-js';

import { localPlaneOffset } from './qr-gps-vote';
import { mintQrGeoPose, type MintQrGeoPoseInput } from './qr-geo-pose-minting';

/**
 * Why these tests matter: minting is the authoring half of the QR-pose loop —
 * the composed `QrGeoPose` is what every visitor's relocalization votes are
 * anchored to, forever, for that printed code. The two silent failure modes
 * the plan reviews named must be pinned here: a frame mix-up (raw WebXR fed
 * where GPS-world NUE is required — a plausible-looking pose rotated about
 * the zero) and a wrong heading convention (local +x points TOWARD
 * `headingDeg`; the printed face's normal sits at heading + 90°).
 */

const ZERO = { lat: 47.5, lon: 8.7 };
const ZERO_ALT = 400;

/** Vertical-poster quaternion for a compass heading: −heading about Up. */
function verticalQuaternion(headingDeg: number): Quaternion {
  const half = (-headingDeg * Math.PI) / 180 / 2;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

describe('mintQrGeoPose', () => {
  it('mints position via the NUE→GPS conversion and absolute altitude', () => {
    const minted = mintQrGeoPose({
      worldNuePosition: { x: 100, y: 5, z: 50 },
      worldNueRotation: [0, 0, 0, 1],
      zero: ZERO,
      zeroAltitude: ZERO_ALT,
    });

    const expected = calcGpsCoords(ZERO, [100, 5, 50]);
    expect(minted.lat).toBeCloseTo(expected.lat, 12);
    expect(minted.lon).toBeCloseTo(expected.lon, 12);
    expect(minted.alt).toBeCloseTo(ZERO_ALT + 5, 9);
  });

  it('always carries the rotation, normalized', () => {
    const drifted: Quaternion = [0, 0, 0, 1.0000004];
    const minted = mintQrGeoPose({
      worldNuePosition: { x: 0, y: 0, z: 0 },
      worldNueRotation: drifted,
      zero: ZERO,
      zeroAltitude: ZERO_ALT,
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
      zeroAltitude: ZERO_ALT,
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
      zeroAltitude: ZERO_ALT,
    });

    expect(minted.headingDeg).toBeUndefined();
    expect(minted.rotation).toBeDefined();
  });

  it('round-trips through the vote geometry: minted rotation ≡ its heading', () => {
    const minted = mintQrGeoPose({
      worldNuePosition: { x: 10, y: 2, z: -4 },
      worldNueRotation: verticalQuaternion(210),
      zero: ZERO,
      zeroAltitude: ZERO_ALT,
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
          zeroAltitude: ZERO_ALT,
        })
      ).toThrow();
    }
  );
});
