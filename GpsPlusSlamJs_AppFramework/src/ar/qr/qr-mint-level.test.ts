import { describe, it, expect } from 'vitest';
import { Quaternion as ThreeQuaternion } from 'three';
import {
  MIN_ALIGNMENT_SAMPLES,
  mintQrLevel,
  qrWorldPoseFromOdom,
} from './qr-mint-level.js';
import { parseQrLevel } from './qr-level.js';
import { calcRelativeCoordsInMeters } from '../../core/index.js';
import type { Pose } from './qr-pose.js';
import type { Matrix4 as AlignmentMatrix } from '../../core/index.js';

const IDENTITY_ALIGNMENT: AlignmentMatrix = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];

/** Column-major matrix for a rotation about NUE up (+y) by `deg`. */
function yawAlignment(deg: number): AlignmentMatrix {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  // three.js/gl column-major: columns are the images of x, y, z.
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

const AT_ORIGIN: Pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
const ZERO = { lat: 48, lon: 11 };
const ALIGNMENT_OK = { hasMatrix: true, sampleCount: 5, gpsAccuracyM: 4 };

describe('qrWorldPoseFromOdom — the basis factor is LEADING', () => {
  /**
   * Why these tests matter, and why they are DIRECTIONAL.
   *
   * This composition is the one the capture-geo-join milestone got wrong: a
   * trailing `WEBXR_TO_NUE` yawed every plane by 90 degrees, and the test
   * suite missed it because it asserted components of a mostly-identity
   * rotation instead of asserting where something POINTS. The input here is a
   * RAW WebXR pose, so the basis factor is leading; the join's trailing
   * factor is correct only for state whose quaternions are already
   * basis-conjugated. These tests pin the direction, by hand-computed
   * bearings, so the wrong composition cannot pass.
   *
   * The arithmetic: WEBXR_TO_NUE maps WebXR +X to NUE +Z, and NUE is
   * North-Up-East. So a QR with identity rotation has its local +x pointing
   * EAST, i.e. a bearing of 90 degrees. Under the WRONG (trailing) form the
   * basis applies twice and local +x lands on -North: bearing 180.
   */
  it('puts an identity-rotated code facing east (bearing 90)', () => {
    const world = qrWorldPoseFromOdom(AT_ORIGIN, IDENTITY_ALIGNMENT);
    const localX = new ThreeQuaternion(...world.rotation);
    const dir = { x: 1, y: 0, z: 0 };
    const rotated = rotate(dir, localX);
    // NUE: x = North, z = East.
    expect(bearingOf(rotated)).toBeCloseTo(90, 4);
  });

  it('turns with the alignment: a +90 deg yaw sends it north', () => {
    const world = qrWorldPoseFromOdom(AT_ORIGIN, yawAlignment(90));
    const rotated = rotate(
      { x: 1, y: 0, z: 0 },
      new ThreeQuaternion(...world.rotation)
    );
    expect(bearingOf(rotated)).toBeCloseTo(0, 4);
  });

  it('discriminates against the capture-join composition on a TILTED code', () => {
    // Why this test matters, and why a tilted code specifically (M-A review
    // finding 3): at identity rotation - and for any yaw-only rotation - the
    // join's trailing-basis form yields the SAME bearing as the correct one,
    // so the two identity cases above do not actually tell the two apart.
    // They diverge once the code is not upright about the vertical axis.
    // Hand-computed with the repo's own basis: correct = 90, join = 153.4.
    const pitched: Pose = {
      position: [0, 0, 0],
      // 90 deg about WebXR +X.
      rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    };
    const world = qrWorldPoseFromOdom(pitched, IDENTITY_ALIGNMENT);
    const rotated = rotate(
      { x: 1, y: 0, z: 0 },
      new ThreeQuaternion(...world.rotation)
    );
    expect(bearingOf(rotated)).toBeCloseTo(90, 3);
    expect(bearingOf(rotated)).not.toBeCloseTo(153.4, 1);
  });

  it('carries the odometry position through the alignment', () => {
    const pose: Pose = { position: [2, 3, 5], rotation: [0, 0, 0, 1] };
    const world = qrWorldPoseFromOdom(pose, IDENTITY_ALIGNMENT);
    // WEBXR_TO_NUE: NUE_x = -WebXR_z, NUE_y = WebXR_y, NUE_z = WebXR_x.
    expect(world.position.x).toBeCloseTo(-5, 6);
    expect(world.position.y).toBeCloseTo(3, 6);
    expect(world.position.z).toBeCloseTo(2, 6);
  });
});

describe('qrWorldPoseFromOdom — the alignment translation', () => {
  it('applies the alignment translation, not just its rotation', () => {
    // Why this test matters (M-A review finding 4): every alignment matrix in
    // this suite used to have a ZERO translation column, so a mint that
    // dropped or transposed that column passed the whole file. A real session
    // alignment translates by the distance between the odometry origin and
    // the GPS zero - tens of metres.
    const shifted: AlignmentMatrix = [
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1,
    ];
    const world = qrWorldPoseFromOdom(AT_ORIGIN, shifted);
    // 10 along GPS-world NUE x = 10 m NORTH of the zero.
    expect(world.position.x).toBeCloseTo(10, 6);
    expect(world.position.y).toBeCloseTo(0, 6);
    expect(world.position.z).toBeCloseTo(0, 6);
  });
});

describe('mintQrLevel', () => {
  const base = {
    odomPose: AT_ORIGIN,
    alignmentMatrix: IDENTITY_ALIGNMENT,
    zero: ZERO,
    alignment: ALIGNMENT_OK,
    sizeM: 0.16,
    nowIso: '2026-08-28T07:00:00.000Z',
  };

  it('mints a level that parses back', () => {
    const result = mintQrLevel(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.level.qr.physicalSizeM).toBe(0.16);
    expect(result.level.qr.geo?.headingDeg).toBeCloseTo(90, 3);
    expect(() => parseQrLevel(JSON.parse(result.json))).not.toThrow();
  });

  it('mints coordinates that decode back to where the code actually is', () => {
    // Why this test matters (M-A review finding 4): the suite asserted the
    // intermediate world pose and that the level "parses back", but nothing
    // checked the composition THROUGH the geo conversion. A sign flip or an
    // axis swap inside mintQrGeoPose would pass both.
    const shifted: AlignmentMatrix = [
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 25, 1,
    ];
    const result = mintQrLevel({ ...base, alignmentMatrix: shifted });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const geo = result.level.qr.geo;
    expect(geo).toBeDefined();
    if (geo === undefined) return;

    const back = calcRelativeCoordsInMeters(
      ZERO,
      { lat: geo.lat, lon: geo.lon },
      geo.alt,
      0
    );
    // NUE: [north, up, east] - 10 m north and 25 m east of the zero.
    expect(back[0]).toBeCloseTo(10, 2);
    expect(back[2]).toBeCloseTo(25, 2);
  });

  it('records the mint timestamp it was given', () => {
    const result = mintQrLevel(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.level.qr.mintQuality?.mintedAtIso).toBe(base.nowIso);
  });

  it('refuses in plain words without an alignment, a zero, or enough fixes', () => {
    // Why this test matters: a non-null alignment matrix is VACUOUS - the
    // store ships an identity from the first GPS fix, and minting on it
    // stamps a heading wrong by the session's arbitrary WebXR yaw.
    for (const override of [
      { alignmentMatrix: null },
      { zero: null },
      {
        alignment: { hasMatrix: true, sampleCount: MIN_ALIGNMENT_SAMPLES - 1 },
      },
    ]) {
      const result = mintQrLevel({ ...base, ...override });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/GPS/);
    }
  });

  it('records the session-mint quality fields it is given', () => {
    // Why this test matters: these fields exist so a later reader can judge
    // how much to trust the anchor. They are dropped silently if the schema
    // does not know them, so a mint that claims to record them is asserted
    // to actually round-trip them.
    const result = mintQrLevel({
      ...base,
      quality: {
        sightingCount: 6,
        detectionCount: 180,
        rotationSpreadDeg: 3.5,
        translationSpreadM: 0.42,
        physicalSizeSpreadM: 0.003,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reparsed = parseQrLevel(JSON.parse(result.json));
    expect(reparsed.qr.mintQuality?.sightingCount).toBe(6);
    expect(reparsed.qr.mintQuality?.detectionCount).toBe(180);
    expect(reparsed.qr.mintQuality?.rotationSpreadDeg).toBe(3.5);
    expect(reparsed.qr.mintQuality?.translationSpreadM).toBe(0.42);
    expect(reparsed.qr.mintQuality?.physicalSizeSpreadM).toBe(0.003);
    expect(reparsed.qr.mintQuality?.alignmentSampleCount).toBe(5);
    expect(reparsed.qr.mintQuality?.gpsAccuracyM).toBe(4);
  });

  it('omits a nonsensical GPS accuracy rather than failing the mint', () => {
    const result = mintQrLevel({
      ...base,
      alignment: { hasMatrix: true, sampleCount: 5, gpsAccuracyM: 0 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.level.qr.mintQuality?.gpsAccuracyM).toBeUndefined();
  });

  it('reports a bad pose as an error instead of throwing', () => {
    const result = mintQrLevel({
      ...base,
      odomPose: { position: [Number.NaN, 0, 0], rotation: [0, 0, 0, 1] },
    });
    expect(result.ok).toBe(false);
  });
});

/** Rotate a vector by a quaternion (test-local, to keep the assertion honest
 *  about direction rather than about components). */
function rotate(
  v: { x: number; y: number; z: number },
  q: ThreeQuaternion
): { x: number; y: number; z: number } {
  const { x, y, z } = v;
  const { x: qx, y: qy, z: qz, w: qw } = q;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return {
    x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
    y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
    z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
  };
}

/** NUE (x = North, z = East) → compass bearing in [0, 360). */
function bearingOf(v: { x: number; y: number; z: number }): number {
  const deg = (Math.atan2(v.z, v.x) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}
