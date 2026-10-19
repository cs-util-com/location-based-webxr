/**
 * Why these tests matter: in `tour.json` version 3 a pin or photo is
 * stored relative to its station (tour editor plan 2026-10-17-1816, W3),
 * while the creator placed it - and the viewer places it - in the world.
 * The conversion both ways must agree with the station's frame (its
 * position, altitude and turn against north), and a geo pose converted to
 * local and back must land where it was, or every saved tour would move
 * its content a little on each open.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { calcGpsCoords, calcRelativeCoordsInMeters } from '../core/index.js';
import type { QrGeoPose } from './qr/qr-gps-vote';
import { rotateVectorByQuaternion } from './qr/qr-pose';
import {
  geoPoseRotation,
  itemGeoPose,
  localPoseOf,
  tourCaptureGeos,
  tourObjects,
} from './tour-station-pose';

const STATION: QrGeoPose = {
  lat: 47.5,
  lon: 8.7,
  alt: 400,
  rotation: [0, 0, 0, 1],
};

/** A geo pose `north`/`east` metres from `from`, at `alt`. */
function at(
  from: QrGeoPose,
  north: number,
  east: number,
  alt: number,
  rotation: [number, number, number, number] = [0, 0, 0, 1]
): QrGeoPose {
  const g = calcGpsCoords(from, [north, 0, east]);
  return { lat: g.lat, lon: g.lon, alt, rotation };
}

function yaw(deg: number): [number, number, number, number] {
  const half = (-deg * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

/** Horizontal metres between two geo poses, and their height difference. */
function apart(a: QrGeoPose, b: QrGeoPose): number {
  const d = calcRelativeCoordsInMeters(a, b, b.alt, 0);
  return Math.hypot(d[0], d[1] - a.alt, d[2]);
}

/** The angle between two unit quaternions (radians). */
function angleBetween(a: readonly number[], b: readonly number[]): number {
  const dot = Math.abs(
    a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!
  );
  return 2 * Math.acos(Math.min(1, dot));
}

describe('localPoseOf / itemGeoPose', () => {
  it("the station's own spot is the identity in its frame", () => {
    const pose = localPoseOf(STATION, STATION);
    for (const v of pose.position) expect(Math.abs(v)).toBeLessThan(1e-9);
    expect(angleBetween(pose.rotation, [0, 0, 0, 1])).toBeLessThan(1e-9);
  });

  it('heights are relative to the station: 1.6 m above it is local Up 1.6', () => {
    const pose = localPoseOf(at(STATION, 0, 0, 401.6), STATION);
    // Exactly the altitudes' difference: the core's relative coordinates
    // are float32 and rounded an absolute altitude by up to 30 micrometres.
    expect(pose.position[1]).toBe(401.6 - 400);
  });

  it('an item standing at its station, turned like north, reads back with its own numbers', () => {
    // What a one-item station relies on (the Tour Viewer's test tours): no
    // conversion noise at all when the item is the station's spot.
    const item = at(STATION, 0, 0, 401.637);
    const station: QrGeoPose = {
      lat: item.lat,
      lon: item.lon,
      alt: item.alt,
      rotation: [0, 0, 0, 1],
    };
    expect(itemGeoPose(localPoseOf(item, station), station)).toMatchObject(
      item
    );
  });

  it('a station turned to heading 90 sees an item 10 m east straight ahead, on its own +x', () => {
    const turned: QrGeoPose = { ...STATION, rotation: yaw(90) };
    const pose = localPoseOf(at(STATION, 0, 10, 400), turned);
    expect(pose.position[0]).toBeCloseTo(10, 6);
    expect(pose.position[2]).toBeCloseTo(0, 6);
    // A heading-only station reads the same as its rotation.
    const byHeading = localPoseOf(at(STATION, 0, 10, 400), {
      lat: STATION.lat,
      lon: STATION.lon,
      alt: STATION.alt,
      headingDeg: 90,
    });
    expect(byHeading.position[0]).toBeCloseTo(10, 6);
  });

  it("an item's turn is relative to its station's: both at heading 90 is no turn at all", () => {
    const turned: QrGeoPose = { ...STATION, rotation: yaw(90) };
    const pose = localPoseOf(at(STATION, 5, 5, 400, yaw(90)), turned);
    expect(angleBetween(pose.rotation, [0, 0, 0, 1])).toBeLessThan(1e-9);
  });

  it('a local pose places the item in the world: 10 m along a heading-90 station is 10 m east', () => {
    const turned: QrGeoPose = { ...STATION, rotation: yaw(90) };
    const geo = itemGeoPose(
      { position: [10, 2, 0], rotation: [0, 0, 0, 1] },
      turned
    );
    const d = calcRelativeCoordsInMeters(STATION, geo, geo.alt, 0);
    expect(d[0]).toBeCloseTo(0, 6);
    expect(d[2]).toBeCloseTo(10, 6);
    expect(geo.alt).toBeCloseTo(402, 9);
    expect(angleBetween(geo.rotation!, yaw(90))).toBeLessThan(1e-9);
  });

  it('geoPoseRotation reads a rotation, else a heading, else none', () => {
    expect(geoPoseRotation({ ...STATION, rotation: [0, 1, 0, 0] })).toEqual([
      0, 1, 0, 0,
    ]);
    const h = geoPoseRotation({ lat: 1, lon: 2, alt: 3, headingDeg: 90 });
    // -90 degrees about Up takes North to East.
    const east = rotateVectorByQuaternion(h, [1, 0, 0]);
    expect(east[2]).toBeCloseTo(1, 12);
    expect(geoPoseRotation({ lat: 1, lon: 2, alt: 3 } as QrGeoPose)).toEqual([
      0, 0, 0, 1,
    ]);
  });
});

describe('the round trip (properties)', () => {
  // Why: every save converts world to local once, and every open converts
  // local to world. Both directions must be inverse to well below what a
  // visitor could see, or content would creep with each save.
  const station = fc.record({
    lat: fc.double({ min: -60, max: 60, noNaN: true }),
    lon: fc.double({ min: -179, max: 179, noNaN: true }),
    alt: fc.double({ min: -100, max: 3000, noNaN: true }),
    yawDeg: fc.double({ min: 0, max: 360, noNaN: true }),
  });
  const offset = fc.record({
    north: fc.double({ min: -1000, max: 1000, noNaN: true }),
    east: fc.double({ min: -1000, max: 1000, noNaN: true }),
    up: fc.double({ min: -50, max: 200, noNaN: true }),
    yawDeg: fc.double({ min: 0, max: 360, noNaN: true }),
  });

  it('geo -> local -> geo lands within a millimetre and a micro-radian', () => {
    fc.assert(
      fc.property(station, offset, (s, o) => {
        const S: QrGeoPose = {
          lat: s.lat,
          lon: s.lon,
          alt: s.alt,
          rotation: yaw(s.yawDeg),
        };
        const G = at(S, o.north, o.east, s.alt + o.up, yaw(o.yawDeg));
        const back = itemGeoPose(localPoseOf(G, S), S);
        expect(apart(G, back)).toBeLessThan(1e-3);
        expect(angleBetween(G.rotation!, back.rotation!)).toBeLessThan(1e-6);
      }),
      { numRuns: 300 }
    );
  });

  it('local -> geo -> local lands within a millimetre', () => {
    fc.assert(
      fc.property(station, offset, (s, o) => {
        const S: QrGeoPose = {
          lat: s.lat,
          lon: s.lon,
          alt: s.alt,
          rotation: yaw(s.yawDeg),
        };
        const local = {
          position: [o.north, o.up, o.east] as [number, number, number],
          rotation: yaw(o.yawDeg),
        };
        const again = localPoseOf(itemGeoPose(local, S), S);
        for (let i = 0; i < 3; i += 1) {
          expect(
            Math.abs(again.position[i]! - local.position[i]!)
          ).toBeLessThan(1e-3);
        }
      }),
      { numRuns: 300 }
    );
  });

  it("a station's move keeps the distances between its items (rigid)", () => {
    fc.assert(
      fc.property(station, station, offset, offset, (s, moved, a, b) => {
        const before: QrGeoPose = {
          lat: s.lat,
          lon: s.lon,
          alt: s.alt,
          rotation: yaw(s.yawDeg),
        };
        const after: QrGeoPose = {
          lat: moved.lat,
          lon: moved.lon,
          alt: moved.alt,
          rotation: yaw(moved.yawDeg),
        };
        const pa = {
          position: [a.north / 20, a.up / 10, a.east / 20] as [
            number,
            number,
            number,
          ],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
        };
        const pb = {
          position: [b.north / 20, b.up / 10, b.east / 20] as [
            number,
            number,
            number,
          ],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
        };
        const d0 = apart(itemGeoPose(pa, before), itemGeoPose(pb, before));
        const d1 = apart(itemGeoPose(pa, after), itemGeoPose(pb, after));
        expect(Math.abs(d1 - d0)).toBeLessThan(0.01);
      }),
      { numRuns: 200 }
    );
  });
});

describe('the world view', () => {
  const pin = {
    id: 'p1',
    kind: 'pin' as const,
    label: 'Well',
    createdAtIso: '2026-10-18T06:00:00.000Z',
    pose: {
      position: [3, 0, 4] as [number, number, number],
      rotation: [0, 0, 0, 1] as [number, number, number, number],
    },
  };
  const photo = {
    id: 'f1',
    kind: 'photo' as const,
    image: 'content/f1.jpg',
    imageWidth: 4,
    imageHeight: 3,
    createdAtIso: '2026-10-18T06:00:00.000Z',
    pose: {
      position: [0, 1.5, 0] as [number, number, number],
      rotation: yaw(45),
    },
  };
  const stations = [
    {
      id: 'a',
      geo: STATION,
      activateRadiusM: 30,
      foundRadiusM: 25,
      hint: 'arrow' as const,
      steps: [],
      items: [pin],
    },
    {
      id: 'b',
      geo: at(STATION, 100, 0, 410, yaw(30)),
      activateRadiusM: 30,
      foundRadiusM: 25,
      hint: 'arrow' as const,
      steps: [],
      items: [photo],
    },
  ];

  it('tourObjects: every item in the world, naming its station, in station order', () => {
    const objects = tourObjects({ stations });
    expect(objects.map((o) => [o.id, o.station])).toEqual([
      ['p1', 'a'],
      ['f1', 'b'],
    ]);
    expect(objects[0]).toMatchObject({ kind: 'pin', label: 'Well' });
    expect(objects[0]).not.toHaveProperty('pose');
    expect(apart(objects[0]!.geo, at(STATION, 3, 4, 400))).toBeLessThan(1e-6);
    expect(objects[1]!.geo).toEqual(itemGeoPose(photo.pose, stations[1]!.geo));
  });

  it('tourCaptureGeos: the recorded photos in the world, in capture order; none without spots', () => {
    expect(tourCaptureGeos({ stations })).toEqual([]);
    const captures = tourCaptureGeos({
      stations,
      captureSpots: {
        fixes: 3,
        gpsAccuracyMedianM: null,
        captures: [
          { image: 'images/2.jpg', station: 'b', pose: photo.pose },
          { image: 'images/1.jpg', station: 'a', pose: pin.pose },
        ],
      },
    });
    expect(captures.map((c) => [c.image, c.station])).toEqual([
      ['images/2.jpg', 'b'],
      ['images/1.jpg', 'a'],
    ]);
    expect(captures[0]!.geo).toEqual(itemGeoPose(photo.pose, stations[1]!.geo));
  });
});
