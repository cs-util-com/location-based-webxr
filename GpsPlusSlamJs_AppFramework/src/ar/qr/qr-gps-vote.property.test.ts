/**
 * QR pose → synthetic GPS-vote bridge — property tests.
 *
 * Why this test matters: for the alignment fusion to recover the right rotation,
 * the geo corners must form the SAME rigid square as the odom corners, for any
 * QR size, heading, and geo location. We verify both squares independently and
 * confirm their centroid is the QR center.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { Quaternion } from 'gps-plus-slam-js';
import { calcRelativeCoordsInMeters } from 'gps-plus-slam-js';
import { type Pose } from './qr-pose';
import {
  buildQrGpsVotes,
  localPlaneOffset,
  type QrGeoPose,
} from './qr-gps-vote';

const IDENTITY: Quaternion = [0, 0, 0, 1];

const arbSize = fc.double({ min: 0.05, max: 2, noNaN: true });
const arbHeading = fc.double({ min: 0, max: 360, noNaN: true });
const arbGeo = fc.record({
  lat: fc.double({ min: -60, max: 60, noNaN: true }),
  lon: fc.double({ min: -179, max: 179, noNaN: true }),
  alt: fc.double({ min: -100, max: 3000, noNaN: true }),
});
const arbPos = fc.tuple(
  fc.double({ min: -50, max: 50, noNaN: true }),
  fc.double({ min: -50, max: 50, noNaN: true }),
  fc.double({ min: -50, max: 50, noNaN: true })
);

/**
 * Back-convert a geo corner to an ENU offset from the QR center via the
 * library's inverse (`calcRelativeCoordsInMeters`, NUE [0]=North [2]=East) —
 * a genuine round-trip through the same geodesy `offsetGeo` delegates to
 * since quality-review A-3.
 */
function geoToEnu(
  center: QrGeoPose,
  corner: { latitude: number; longitude: number; altitude: number }
) {
  const nue = calcRelativeCoordsInMeters(
    { lat: center.lat, lon: center.lon },
    { lat: corner.latitude, lon: corner.longitude }
  );
  return {
    east: nue[2],
    north: nue[0],
    up: corner.altitude - center.alt,
  };
}

function sideLengths(points: { x: number; y: number; z: number }[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    out.push(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
  }
  return out;
}

describe('buildQrGpsVotes — geo corners form a centered square of side sizeM', () => {
  it('matches the odom square geometry for any size/heading/location', () => {
    fc.assert(
      fc.property(
        arbSize,
        arbHeading,
        arbGeo,
        arbPos,
        (sizeM, headingDeg, geo, pos) => {
          const qrGeo: QrGeoPose = { ...geo, headingDeg };
          const qrPoseWorld: Pose = { position: pos, rotation: IDENTITY };
          const votes = buildQrGpsVotes({
            qrPoseWorld,
            sizeM,
            qrGeo,
            syntheticAccuracyM: 0.05,
          });
          expect(votes).toHaveLength(4);

          // Geo corners → ENU; must be a square of side sizeM centered on origin.
          const enu = votes.map((v) =>
            geoToEnu(qrGeo, {
              latitude: v.rawGpsPoint.latitude,
              longitude: v.rawGpsPoint.longitude,
              altitude: v.rawGpsPoint.altitude ?? 0,
            })
          );
          const enuPts = enu.map((e) => ({ x: e.east, y: e.up, z: e.north }));
          for (const side of sideLengths(enuPts)) {
            expect(side).toBeCloseTo(sizeM, 4);
          }
          const cx = enuPts.reduce((s, p) => s + p.x, 0) / 4;
          const cy = enuPts.reduce((s, p) => s + p.y, 0) / 4;
          const cz = enuPts.reduce((s, p) => s + p.z, 0) / 4;
          expect(Math.hypot(cx, cy, cz)).toBeLessThan(1e-6);

          // Odom corners (identity rotation) are a square of side sizeM too.
          const odom = votes.map((v) => ({
            x: v.odomPosition[0],
            y: v.odomPosition[1],
            z: v.odomPosition[2],
          }));
          for (const side of sideLengths(odom)) {
            expect(side).toBeCloseTo(sizeM, 5);
          }
        }
      )
    );
  });
});

describe('buildQrGpsVotes — wide-baseline geo ring is congruent to the odom ring', () => {
  // The whole point of Note 2: the synthetic geo ring and odom ring must be the
  // SAME rigid polygon, so the alignment fit recovers the right rotation — and each
  // point sits at `baselineM` from the center (the lever arm that stiffens north).
  it('matches the odom ring geometry for any size/heading/location/baseline/count', () => {
    fc.assert(
      fc.property(
        arbSize,
        arbHeading,
        arbGeo,
        arbPos,
        fc.double({ min: 0.5, max: 5, noNaN: true }),
        fc.integer({ min: 3, max: 10 }),
        (sizeM, headingDeg, geo, pos, baselineM, count) => {
          const qrGeo: QrGeoPose = { ...geo, headingDeg };
          const qrPoseWorld: Pose = { position: pos, rotation: IDENTITY };
          const votes = buildQrGpsVotes({
            qrPoseWorld,
            sizeM,
            qrGeo,
            syntheticAccuracyM: 0.05,
            baselineM,
            count,
          });
          expect(votes).toHaveLength(count);

          const enuPts = votes
            .map((v) =>
              geoToEnu(qrGeo, {
                latitude: v.rawGpsPoint.latitude,
                longitude: v.rawGpsPoint.longitude,
                altitude: v.rawGpsPoint.altitude ?? 0,
              })
            )
            .map((e) => ({ x: e.east, y: e.up, z: e.north }));
          const odom = votes.map((v) => ({
            x: v.odomPosition[0] - pos[0],
            y: v.odomPosition[1] - pos[1],
            z: v.odomPosition[2] - pos[2],
          }));

          // Congruent rings: matching consecutive side lengths + circumradius.
          const enuSides = sideLengths(enuPts);
          const odomSides = sideLengths(odom);
          for (let i = 0; i < count; i++) {
            expect(enuSides[i]).toBeCloseTo(odomSides[i], 4);
          }
          for (const p of enuPts) {
            expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(baselineM, 4);
          }
          for (const p of odom) {
            expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(baselineM, 4);
          }
        }
      )
    );
  });
});

// Why this property matters (QR-pose plan 2026-08-25): the rotation path is
// the NEW geometry and the headingDeg path is the contract every existing
// level file was written against — for ANY heading and any local point the
// two must agree, or a migrated file quietly moves its votes. The quaternion
// under test is a rotation of −heading about the Up axis (local +x points
// toward the heading; the face normal sits at heading + 90°).
describe('localPlaneOffset — heading/rotation equivalence', () => {
  it('a vertical-poster quaternion reproduces localPlaneToEnu for any heading', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.double({ min: -10, max: 10, noNaN: true }),
        (headingDeg, localX, localY) => {
          const half = (-headingDeg * Math.PI) / 180 / 2;
          const rotation = [0, Math.sin(half), 0, Math.cos(half)] as const;
          const geo = { lat: 47, lon: 8, alt: 400 };

          const byHeading = localPlaneOffset([localX, localY, 0], {
            ...geo,
            headingDeg,
          });
          const byRotation = localPlaneOffset([localX, localY, 0], {
            ...geo,
            rotation,
          });

          expect(byRotation.north).toBeCloseTo(byHeading.north, 9);
          expect(byRotation.east).toBeCloseTo(byHeading.east, 9);
          expect(byRotation.up).toBeCloseTo(byHeading.up, 9);
        }
      )
    );
  });
});
