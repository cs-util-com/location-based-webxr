/**
 * QR pose → synthetic GPS-vote bridge — unit tests.
 *
 * Why this test matters: these pin the geometry of the synthetic correspondences
 * the fusion consumes — the 4 corners must land at the right odom positions
 * (from the solved pose) AND the right absolute geo positions (corner offsets
 * from the center via heading + size), all stamped with the tiny synthetic
 * accuracy that makes the QR a high-weight vote. A sign error here would point
 * the alignment the wrong way on a real device.
 */

import { describe, it, expect } from 'vitest';
import type { Quaternion } from 'gps-plus-slam-js';
import { calcGpsCoords, calcRelativeCoordsInMeters } from 'gps-plus-slam-js';
import { buildObjectPoints, transformPoint, type Pose } from './qr-pose';
import {
  buildQrGpsVotes,
  localPlaneToEnu,
  offsetGeo,
  type QrGeoPose,
} from './qr-gps-vote';

const IDENTITY: Quaternion = [0, 0, 0, 1];
const qrGeo: QrGeoPose = { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 };

describe('localPlaneToEnu', () => {
  it('maps +x to North when heading is 0', () => {
    const enu = localPlaneToEnu(2, 3, 0);
    expect(enu.north).toBeCloseTo(2, 9);
    expect(enu.east).toBeCloseTo(0, 9);
    expect(enu.up).toBe(3);
  });

  it('maps +x to East when heading is 90°', () => {
    const enu = localPlaneToEnu(2, 3, 90);
    expect(enu.east).toBeCloseTo(2, 9);
    expect(enu.north).toBeCloseTo(0, 9);
    expect(enu.up).toBe(3);
  });
});

describe('offsetGeo', () => {
  // Why these tests matter: offsetGeo delegates to the library's
  // calcGpsCoords (quality-review A-3) so QR votes use the SAME geodesy as
  // every other lat/lon conversion in the stack — these pin the delegation,
  // the altitude composition, and the pole guard the library helper lacks.
  it('matches the library calcGpsCoords conversion and composes altitude', () => {
    const enu = { east: 12.5, north: -7.25, up: 5 };
    const geo = offsetGeo(qrGeo, enu);
    const expected = calcGpsCoords({ lat: qrGeo.lat, lon: qrGeo.lon }, [
      enu.north,
      enu.up,
      enu.east,
    ]);
    expect(geo.latitude).toBe(expected.lat);
    expect(geo.longitude).toBe(expected.lon);
    expect(geo.altitude).toBe(405);
  });

  it('round-trips through the library inverse (calcRelativeCoordsInMeters)', () => {
    const enu = { east: 3.2, north: 8.9, up: 0 };
    const geo = offsetGeo(qrGeo, enu);
    const back = calcRelativeCoordsInMeters(
      { lat: qrGeo.lat, lon: qrGeo.lon },
      { lat: geo.latitude, lon: geo.longitude }
    );
    // NUE: [0]=North, [2]=East. Small ellipsoid-vs-plane error at ~10 m scale.
    expect(back[0]).toBeCloseTo(enu.north, 3);
    expect(back[2]).toBeCloseTo(enu.east, 3);
  });

  it('yields a zero longitude offset at the pole instead of a division blow-up', () => {
    const poleGeo: QrGeoPose = { lat: 90, lon: 8.7, alt: 0, headingDeg: 0 };
    const geo = offsetGeo(poleGeo, { east: 5, north: 0, up: 0 });
    expect(Number.isFinite(geo.longitude)).toBe(true);
    expect(geo.longitude).toBeCloseTo(poleGeo.lon, 6);
  });
});

describe('buildQrGpsVotes', () => {
  const qrPoseWorld: Pose = { position: [10, 1.5, -4], rotation: IDENTITY };
  const sizeM = 0.2;
  const syntheticAccuracyM = 0.05;

  it('produces 4 corner correspondences by default', () => {
    const votes = buildQrGpsVotes({
      qrPoseWorld,
      sizeM,
      qrGeo,
      syntheticAccuracyM,
      timestamp: 1000,
    });
    expect(votes).toHaveLength(4);

    // Odom positions equal the object points transformed by the world pose.
    const expectedOdom = buildObjectPoints(sizeM).map((o) =>
      transformPoint(o, qrPoseWorld)
    );
    votes.forEach((v, i) => {
      for (let k = 0; k < 3; k++) {
        expect(v.odomPosition[k]).toBeCloseTo(expectedOdom[i][k], 6);
      }
      expect(v.rawGpsPoint.latLongAccuracy).toBe(syntheticAccuracyM);
      expect(v.rawGpsPoint.timestamp).toBe(1000);
      expect(v.rawGpsPoint.id).toBe(`qr-1000-${i}`);
    });
  });

  it('places the top corners higher and the bottom corners lower in altitude', () => {
    const votes = buildQrGpsVotes({
      qrPoseWorld,
      sizeM,
      qrGeo,
      syntheticAccuracyM,
    });
    // Object-point order is TL, TR, BR, BL → +h, +h, −h, −h in local Y.
    const h = sizeM / 2;
    expect(votes[0].rawGpsPoint.altitude).toBeCloseTo(qrGeo.alt + h, 9);
    expect(votes[1].rawGpsPoint.altitude).toBeCloseTo(qrGeo.alt + h, 9);
    expect(votes[2].rawGpsPoint.altitude).toBeCloseTo(qrGeo.alt - h, 9);
    expect(votes[3].rawGpsPoint.altitude).toBeCloseTo(qrGeo.alt - h, 9);
  });

  it('produces a single center correspondence when multiCorrespondence is false', () => {
    const votes = buildQrGpsVotes({
      qrPoseWorld,
      sizeM,
      qrGeo,
      syntheticAccuracyM,
      multiCorrespondence: false,
    });
    expect(votes).toHaveLength(1);
    expect(votes[0].odomPosition).toEqual(qrPoseWorld.position);
    expect(votes[0].rawGpsPoint.latitude).toBeCloseTo(qrGeo.lat, 9);
    expect(votes[0].rawGpsPoint.longitude).toBeCloseTo(qrGeo.lon, 9);
    expect(votes[0].rawGpsPoint.altitude).toBeCloseTo(qrGeo.alt, 9);
  });

  it('defaults odomRotation to the QR world rotation but honors an override', () => {
    const override: Quaternion = [0, 0.7071, 0, 0.7071];
    const def = buildQrGpsVotes({
      qrPoseWorld,
      sizeM,
      qrGeo,
      syntheticAccuracyM,
    });
    const ovr = buildQrGpsVotes({
      qrPoseWorld,
      sizeM,
      qrGeo,
      syntheticAccuracyM,
      odomRotation: override,
    });
    expect(def[0].odomRotation).toEqual(qrPoseWorld.rotation);
    expect(ovr[0].odomRotation).toEqual(override);
  });

  it('rejects a non-positive synthetic accuracy or size', () => {
    expect(() =>
      buildQrGpsVotes({ qrPoseWorld, sizeM, qrGeo, syntheticAccuracyM: 0 })
    ).toThrow(RangeError);
    expect(() =>
      buildQrGpsVotes({ qrPoseWorld, sizeM: -1, qrGeo, syntheticAccuracyM })
    ).toThrow(RangeError);
  });

  describe('wide-baseline mode (Note 2)', () => {
    it('produces `count` points on a polygon of radius baselineM in the QR plane', () => {
      const baselineM = 3;
      const votes = buildQrGpsVotes({
        qrPoseWorld,
        sizeM,
        qrGeo,
        syntheticAccuracyM,
        baselineM,
        count: 6,
      });
      expect(votes).toHaveLength(6);
      // Each odom point sits baselineM from the QR center (identity rotation).
      for (const v of votes) {
        const dx = v.odomPosition[0] - qrPoseWorld.position[0];
        const dy = v.odomPosition[1] - qrPoseWorld.position[1];
        const dz = v.odomPosition[2] - qrPoseWorld.position[2];
        expect(Math.hypot(dx, dy, dz)).toBeCloseTo(baselineM, 6);
      }
    });

    it('keeps the ring centroid at the QR center (translation stays anchored)', () => {
      const votes = buildQrGpsVotes({
        qrPoseWorld,
        sizeM,
        qrGeo,
        syntheticAccuracyM,
        baselineM: 2.5,
        count: 8,
      });
      const centroid = [0, 0, 0];
      for (const v of votes)
        for (let k = 0; k < 3; k++)
          centroid[k] += v.odomPosition[k] / votes.length;
      for (let k = 0; k < 3; k++)
        expect(centroid[k]).toBeCloseTo(qrPoseWorld.position[k], 6);
    });

    it('falls back to the physical corners when baselineM is 0 / absent', () => {
      const wide = buildQrGpsVotes({
        qrPoseWorld,
        sizeM,
        qrGeo,
        syntheticAccuracyM,
        baselineM: 0,
      });
      expect(wide).toHaveLength(4); // physical-corner mode (multiCorrespondence default)
    });

    it('rejects a collinear (count < 3) wide-baseline request', () => {
      expect(() =>
        buildQrGpsVotes({
          qrPoseWorld,
          sizeM,
          qrGeo,
          syntheticAccuracyM,
          baselineM: 2,
          count: 2,
        })
      ).toThrow(RangeError);
    });
  });
});

// Why these tests matter (QR-pose plan 2026-08-25, QD-5 + delta review #4):
// the vote geometry becomes rotation-aware, and the equivalence between the
// legacy headingDeg path and a vertical-poster quaternion is the contract
// that keeps every existing level file meaning what it always meant. The
// convention is subtle and MUST be encoded here, not intuited: local +x
// points toward `headingDeg`, so the printed face's normal points at
// headingDeg + 90° — and in the y-up NUE frame the vertical-poster
// quaternion is a rotation of −heading about the Up axis.
describe('buildQrGpsVotes — 6-DoF rotation', () => {
  const GEO_BASE = { lat: 47.5, lon: 8.7, alt: 400 };
  const POSE: Pose = {
    position: [1, 2, 3],
    rotation: [0, 0, 0, 1],
  };

  /** Vertical-poster quaternion for a compass heading (see docblock above). */
  function verticalQuaternion(headingDeg: number): Quaternion {
    const half = (-headingDeg * Math.PI) / 180 / 2;
    return [0, Math.sin(half), 0, Math.cos(half)];
  }

  it('a vertical-poster rotation reproduces the headingDeg votes exactly', () => {
    const byHeading = buildQrGpsVotes({
      qrPoseWorld: POSE,
      sizeM: 0.2,
      qrGeo: { ...GEO_BASE, headingDeg: 73 },
      syntheticAccuracyM: 0.05,
      timestamp: 1000,
    });
    const byRotation = buildQrGpsVotes({
      qrPoseWorld: POSE,
      sizeM: 0.2,
      qrGeo: { ...GEO_BASE, rotation: verticalQuaternion(73) },
      syntheticAccuracyM: 0.05,
      timestamp: 1000,
    });

    expect(byRotation).toHaveLength(byHeading.length);
    byRotation.forEach((vote, i) => {
      expect(vote.rawGpsPoint.latitude).toBeCloseTo(
        byHeading[i]!.rawGpsPoint.latitude,
        12
      );
      expect(vote.rawGpsPoint.longitude).toBeCloseTo(
        byHeading[i]!.rawGpsPoint.longitude,
        12
      );
      expect(vote.rawGpsPoint.altitude).toBeCloseTo(
        byHeading[i]!.rawGpsPoint.altitude!,
        9
      );
    });
  });

  it('a face-up table code maps the printed plane onto the ground plane', () => {
    // Rotation of −90° about the North axis: local +y → −East, +z → Up.
    const half = (-90 * Math.PI) / 180 / 2;
    const faceUp: Quaternion = [Math.sin(half), 0, 0, Math.cos(half)];
    const s = 5; // wide baseline makes the offsets visible at lat/lon scale

    const votes = buildQrGpsVotes({
      qrPoseWorld: POSE,
      sizeM: 0.2,
      qrGeo: { ...GEO_BASE, rotation: faceUp },
      syntheticAccuracyM: 0.05,
      baselineM: s,
      count: 4,
      timestamp: 1000,
    });

    // Ring points start at local +x (→ North) then local +y (→ −East).
    const expectedNorth = offsetGeo(
      { ...GEO_BASE, headingDeg: 0 },
      { north: s, east: 0, up: 0 }
    );
    const expectedWest = offsetGeo(
      { ...GEO_BASE, headingDeg: 0 },
      { north: 0, east: -s, up: 0 }
    );
    expect(votes[0]!.rawGpsPoint.latitude).toBeCloseTo(
      expectedNorth.latitude,
      12
    );
    expect(votes[0]!.rawGpsPoint.longitude).toBeCloseTo(
      expectedNorth.longitude,
      12
    );
    expect(votes[1]!.rawGpsPoint.longitude).toBeCloseTo(
      expectedWest.longitude,
      12
    );
    // The printed plane lies IN the ground plane: no altitude spread.
    for (const vote of votes) {
      expect(vote.rawGpsPoint.altitude).toBeCloseTo(GEO_BASE.alt, 9);
    }
  });

  it('rejects a geo pose carrying neither headingDeg nor rotation', () => {
    expect(() =>
      buildQrGpsVotes({
        qrPoseWorld: POSE,
        sizeM: 0.2,
        qrGeo: { ...GEO_BASE },
        syntheticAccuracyM: 0.05,
      })
    ).toThrow();
  });
});
