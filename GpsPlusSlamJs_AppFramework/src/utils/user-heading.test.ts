/**
 * Unit tests for the true-north user-heading kernel.
 *
 * Why this test matters:
 * Finding 2 of 2026-06-28-1822-map-rings-transparency-and-view-direction-user-feedback.md
 * replaces the live-overlay blue dot with a dot + a thin blue line pointing in
 * the user's absolute (true-geographic-north) view direction. This kernel turns
 * the latest AR camera rotation (a NUE quaternion, as stored in
 * `gpsEvents.odometryRotations`) plus the GPS+SLAM alignment matrix into a
 * compass bearing in degrees. These tests pin the frame algebra that the rest
 * of the feature depends on:
 *   - the camera-forward basis vector in the NUE-AR frame is [1, 0, 0]
 *     (an identity camera looks North), derived from
 *     `webxrToNUE([0,0,-1]) = [1,0,0]`;
 *   - the alignment matrix rotates the AR-NUE forward into world NUE, and the
 *     bearing falls out as atan2(East, North);
 *   - heading is undefined (null) before the first alignment solve, with no
 *     rotation yet, and when the camera points near-vertically.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { quat, vec3 } from 'gl-matrix';
import fc from 'fast-check';
import { computeUserHeadingDeg } from './user-heading';
import type { Matrix4, Quaternion } from 'gps-plus-slam-js';

// Identity alignment: AR-NUE axes already equal world NUE (North/Up/East).
const IDENTITY_MAT4: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// A 90° alignment that maps AR-North -> world-East, AR-Up -> Up,
// AR-East -> world-(-North). Column-major; column 0 is the image of the
// North(+X) axis. Used to prove the alignment rotation is applied.
const ALIGN_NORTH_TO_EAST: Matrix4 = [
  0,
  0,
  1,
  0, // col0: image of North(+X) = East (0,0,1)
  0,
  1,
  0,
  0, // col1: image of Up(+Y) = Up
  -1,
  0,
  0,
  0, // col2: image of East(+Z) = -North (-1,0,0)
  0,
  0,
  0,
  1,
];

/** Build a NUE camera-rotation quaternion whose forward ([1,0,0]) points at `dir`. */
function quatForwardTo(dir: vec3): Quaternion {
  const out = quat.create();
  quat.rotationTo(out, [1, 0, 0], vec3.normalize(vec3.create(), dir));
  return [out[0], out[1], out[2], out[3]];
}

const NORTH: vec3 = [1, 0, 0];
const EAST: vec3 = [0, 0, 1];
const SOUTH: vec3 = [-1, 0, 0];
const WEST: vec3 = [0, 0, -1];
const UP: vec3 = [0, 1, 0];

describe('computeUserHeadingDeg', () => {
  it('returns 0° (North) for an identity camera under identity alignment', () => {
    const heading = computeUserHeadingDeg({
      odometryRotation: [0, 0, 0, 1],
      alignmentMatrix: IDENTITY_MAT4,
    });
    expect(heading).not.toBeNull();
    expect(heading!).toBeCloseTo(0, 3);
  });

  it('maps cardinal camera-forward directions to compass bearings', () => {
    const cases: Array<{ dir: vec3; deg: number }> = [
      { dir: NORTH, deg: 0 },
      { dir: EAST, deg: 90 },
      { dir: SOUTH, deg: 180 },
      { dir: WEST, deg: 270 },
    ];
    for (const { dir, deg } of cases) {
      const heading = computeUserHeadingDeg({
        odometryRotation: quatForwardTo(dir),
        alignmentMatrix: IDENTITY_MAT4,
      });
      expect(heading).not.toBeNull();
      // Compare on the circle so 270 and -90 count as equal.
      const diff = (((heading! - deg) % 360) + 360) % 360;
      const circ = Math.min(diff, 360 - diff);
      expect(circ).toBeCloseTo(0, 2);
    }
  });

  it('applies the alignment rotation (identity camera + North→East alignment = 90°)', () => {
    const heading = computeUserHeadingDeg({
      odometryRotation: [0, 0, 0, 1],
      alignmentMatrix: ALIGN_NORTH_TO_EAST,
    });
    expect(heading).not.toBeNull();
    expect(heading!).toBeCloseTo(90, 2);
  });

  it('composes camera and alignment rotations (East camera + North→East alignment = 180°)', () => {
    const heading = computeUserHeadingDeg({
      odometryRotation: quatForwardTo(EAST),
      alignmentMatrix: ALIGN_NORTH_TO_EAST,
    });
    expect(heading).not.toBeNull();
    expect(heading!).toBeCloseTo(180, 2);
  });

  it('only READS its inputs — frozen quaternion/matrix work and stay unchanged (zero-copy contract)', () => {
    // Why this test matters: since 2026-07-04 the kernel passes the caller's
    // quaternion/matrix straight into gl-matrix (no per-call copy — this runs
    // at 30–60 Hz). That is only sound while gl-matrix never writes to them.
    // Frozen inputs make an accidental write throw under strict mode (ESM),
    // and the value comparison guards against silent mutation regardless.
    const rotation = Object.freeze([0, 0, 0, 1] as const);
    const matrix = Object.freeze([...ALIGN_NORTH_TO_EAST] as const);
    const matrixSnapshot = [...matrix];
    const heading = computeUserHeadingDeg({
      odometryRotation: rotation,
      alignmentMatrix: matrix,
    });
    expect(heading).not.toBeNull();
    expect(heading!).toBeCloseTo(90, 2);
    expect([...matrix]).toEqual(matrixSnapshot);
    expect([...rotation]).toEqual([0, 0, 0, 1]);
  });

  it('returns null before the first alignment solve (matrix null)', () => {
    expect(
      computeUserHeadingDeg({
        odometryRotation: [0, 0, 0, 1],
        alignmentMatrix: null,
      })
    ).toBeNull();
  });

  it('returns null when there is no rotation yet', () => {
    expect(
      computeUserHeadingDeg({
        odometryRotation: null,
        alignmentMatrix: IDENTITY_MAT4,
      })
    ).toBeNull();
  });

  it('returns null when the camera points near-vertically (heading undefined)', () => {
    expect(
      computeUserHeadingDeg({
        odometryRotation: quatForwardTo(UP),
        alignmentMatrix: IDENTITY_MAT4,
      })
    ).toBeNull();
  });

  // Why this test matters (PR #132 review): pins the actual VERTICAL_GUARD
  // geometry. `horiz/len < 0.08` where `horiz/len = sin(angleFromVertical)`, so
  // the guard rejects only a TINY cone — within asin(0.08) ≈ 4.6° of straight
  // up/down — NOT the "~85° of vertical" the prose used to claim. A direction
  // just inside that cone is undefined; just outside it yields a bearing.
  it('rejects only within ~4.6° of vertical (asin(0.08)), accepts steeper headings', () => {
    const deg2rad = Math.PI / 180;
    // dir = [sin φ, cos φ, 0]: φ is the angle from the +Up axis; horiz/len = sin φ.
    const dirFromVertical = (phiDeg: number): vec3 => [
      Math.sin(phiDeg * deg2rad),
      Math.cos(phiDeg * deg2rad),
      0,
    ];
    // 4° from vertical → sin 4° = 0.0698 < 0.08 → heading undefined (null).
    expect(
      computeUserHeadingDeg({
        odometryRotation: quatForwardTo(dirFromVertical(4)),
        alignmentMatrix: IDENTITY_MAT4,
      })
    ).toBeNull();
    // 6° from vertical → sin 6° = 0.1045 > 0.08 → a bearing is defined.
    expect(
      computeUserHeadingDeg({
        odometryRotation: quatForwardTo(dirFromVertical(6)),
        alignmentMatrix: IDENTITY_MAT4,
      })
    ).not.toBeNull();
  });

  // Why this test matters: the function's contract is `number | null`, and the
  // map overlay only treats `null` as "heading unavailable". A single non-finite
  // sensor sample (NaN/Infinity in the odometry quaternion or alignment matrix)
  // must NOT propagate a NaN bearing into `headingUpQuat`, which would poison the
  // CSS3D quaternion. Such samples must degrade to `null`. (PR #131 review.)
  describe('non-finite inputs degrade to null (never NaN)', () => {
    const NON_FINITE = [NaN, Infinity, -Infinity];

    for (const bad of NON_FINITE) {
      it(`returns null when the odometry quaternion contains ${bad}`, () => {
        const heading = computeUserHeadingDeg({
          odometryRotation: [bad, 0, 0, 1],
          alignmentMatrix: IDENTITY_MAT4,
        });
        expect(heading).toBeNull();
      });

      it(`returns null when the alignment matrix contains ${bad}`, () => {
        const badMatrix: number[] = [...IDENTITY_MAT4];
        badMatrix[0] = bad;
        const heading = computeUserHeadingDeg({
          odometryRotation: [0, 0, 0, 1],
          alignmentMatrix: badMatrix as unknown as Matrix4,
        });
        expect(heading).toBeNull();
      });

      it(`returns null when a non-finite value lands in the matrix translation column (${bad})`, () => {
        const badMatrix: number[] = [...IDENTITY_MAT4];
        badMatrix[12] = bad;
        const heading = computeUserHeadingDeg({
          odometryRotation: [0, 0, 0, 1],
          alignmentMatrix: badMatrix as unknown as Matrix4,
        });
        expect(heading).toBeNull();
      });
    }
  });
});

describe('computeUserHeadingDeg — properties', () => {
  it('always returns null or a bearing in [0, 360)', () => {
    expect(() =>
      fc.assert(
        fc.property(
          fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
          fc.double({ min: -Math.PI / 2.2, max: Math.PI / 2.2, noNaN: true }),
          (yaw, pitch) => {
            // Build an arbitrary look direction (avoid exactly vertical).
            const dir: vec3 = [
              Math.cos(pitch) * Math.cos(yaw),
              Math.sin(pitch),
              Math.cos(pitch) * Math.sin(yaw),
            ];
            const heading = computeUserHeadingDeg({
              odometryRotation: quatForwardTo(dir),
              alignmentMatrix: IDENTITY_MAT4,
            });
            if (heading === null) return true;
            return heading >= 0 && heading < 360;
          }
        )
      )
    ).not.toThrow();
  });

  it('is yaw-equivariant: rotating the camera yaw by Δ rotates the heading by a constant Δ (mod 360)', () => {
    const headingAt = (theta: number): number => {
      const q = quat.create();
      quat.setAxisAngle(q, [0, 1, 0], theta);
      const h = computeUserHeadingDeg({
        odometryRotation: [q[0], q[1], q[2], q[3]],
        alignmentMatrix: IDENTITY_MAT4,
      });
      return h!;
    };
    expect(() =>
      fc.assert(
        fc.property(
          fc.double({ min: -3, max: 3, noNaN: true }),
          fc.double({ min: 0.1, max: 1.0, noNaN: true }),
          (yaw, delta) => {
            const h0 = headingAt(yaw);
            const h1 = headingAt(yaw + delta);
            // Circular difference in degrees.
            const circ = ((h1 - h0 + 540) % 360) - 180;
            const expectedDeg = (delta * 180) / Math.PI;
            // Magnitude matches Δ regardless of the rotation's sign convention.
            return Math.abs(Math.abs(circ) - expectedDeg) < 0.5;
          }
        )
      )
    ).not.toThrow();
  });
});
