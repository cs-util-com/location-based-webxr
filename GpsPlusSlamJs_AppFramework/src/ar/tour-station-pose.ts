/**
 * A station's frame in `tour.json` version 3 (tour editor plan
 * 2026-10-17-1816, W3): converts an item's LOCAL pose (relative to its
 * station) to its world geo pose and back, and gives the WORLD VIEW of a
 * tour - every pin, photo and recorded photo with its geo pose and the
 * station holding it - which a viewer places and a creator's drafts hold.
 *
 * THE FRAME. A station's geo pose is the origin of a local tangent frame:
 * North, Up and East metres from its latitude and longitude (Up is the
 * absolute altitude, the stack's NUE convention: `calcRelativeCoordsInMeters`
 * with a zero altitude term), turned by the station's rotation against
 * north. An item at local pose `(p, q)` stands at `R_s p` from the station
 * with the rotation `R_s q`. Both directions use the same geodesy the level
 * files and the creator's minting use (`calcRelativeCoordsInMeters`,
 * `mintQrGeoPose`), so a geo pose converted to local and back lands within
 * micrometres of itself (the property test bounds it), and a local pose
 * never changes unless an editor sets a new one (D17: a station moves
 * rigidly, its items' local poses stay bit-identical).
 *
 * Double precision throughout: `qr-pose.ts`'s `composePose` goes through
 * gl-matrix's float32 arrays, which would cost centimetres at an absolute
 * altitude of 500 m.
 *
 * @see tour-station-pose.ts.md
 */

import type { Quaternion } from 'gps-plus-slam-js';

import { calcRelativeCoordsInMeters } from '../core/index.js';
import type { QrGeoPose } from './qr/qr-gps-vote.js';
import {
  mintQrGeoPose,
  renormalizeUnitQuaternion,
} from './qr/qr-geo-pose-minting.js';
import { rotateVectorByQuaternion } from './qr/qr-pose.js';
import type { TourItem, TourLocalPose } from './tour-items.js';
import type { TourManifest, TourObject, TourCapture } from './tour-manifest.js';

const IDENTITY: Quaternion = [0, 0, 0, 1];

/** The product `a * b` of two quaternions `[x, y, z, w]`. */
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

/** The inverse of a unit quaternion. */
function conjugate(q: Quaternion): Quaternion {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** A unit quaternion back to unit length after arithmetic (never fails
 *  for a product of unit quaternions). */
function unit(q: Quaternion): Quaternion {
  return renormalizeUnitQuaternion(q) ?? IDENTITY;
}

/**
 * A geo pose's rotation against north: its quaternion, else the rotation
 * of -heading about Up (the QR geo-pose convention, `qr-gps-vote.ts`),
 * else none. The Tour Viewer's placement reads a geo pose the same way.
 */
export function geoPoseRotation(geo: QrGeoPose): Quaternion {
  if (geo.rotation !== undefined) return geo.rotation;
  if (geo.headingDeg === undefined) return IDENTITY;
  const half = (-geo.headingDeg * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

/**
 * Where a geo pose stands in a station's frame: the local pose an item
 * placed at `geo` gets in the station at `station`.
 */
export function localPoseOf(geo: QrGeoPose, station: QrGeoPose): TourLocalPose {
  const nue = calcRelativeCoordsInMeters(
    { lat: station.lat, lon: station.lon },
    { lat: geo.lat, lon: geo.lon },
    geo.alt,
    0
  );
  const inverse = conjugate(geoPoseRotation(station));
  // Up as the difference of the two altitudes, in double precision: the
  // core's relative coordinates are float32, which rounds an absolute
  // altitude by up to 30 micrometres - noise on every save of an item.
  const [n, u, e] = rotateVectorByQuaternion(inverse, [
    nue[0],
    geo.alt - station.alt,
    nue[2],
  ]);
  return {
    // `+ 0` canonicalizes -0, which JSON cannot carry (round trips exact).
    position: [n + 0, u + 0, e + 0],
    rotation: unit(multiply(inverse, geoPoseRotation(geo))),
  };
}

/** The geo pose of an item at local pose `pose` in the station at
 *  `station`, minted as the creator's placements are. */
export function itemGeoPose(
  pose: TourLocalPose,
  station: QrGeoPose
): QrGeoPose {
  const rotation = geoPoseRotation(station);
  const [n, u, e] = rotateVectorByQuaternion(rotation, pose.position);
  return mintQrGeoPose({
    worldNuePosition: { x: n, y: u + station.alt, z: e },
    worldNueRotation: unit(multiply(rotation, pose.rotation)),
    zero: { lat: station.lat, lon: station.lon },
  });
}

/** An item in the world: its fields, its geo pose and its station. */
function placed(item: TourItem, station: { id: string; geo: QrGeoPose }) {
  const { pose, ...fields } = item;
  return {
    ...fields,
    geo: itemGeoPose(pose, station.geo),
    station: station.id,
  } as TourObject;
}

/** The tour's pins and photos in the world, each naming its station, in
 *  station order. */
export function tourObjects(
  manifest: Pick<TourManifest, 'stations'>
): TourObject[] {
  return manifest.stations.flatMap((station) =>
    station.items.map((item) => placed(item, station))
  );
}

/** A recorded photo's spot in the world. */
export interface TourCaptureGeo {
  readonly image: string;
  readonly station: string;
  /** Always carries a rotation (photos face as captured). */
  readonly geo: QrGeoPose;
}

/** The baked recorded photos in the world, in capture order; empty
 *  without baked spots. */
export function tourCaptureGeos(
  manifest: Pick<TourManifest, 'stations' | 'captureSpots'>
): TourCaptureGeo[] {
  const stations = new Map(manifest.stations.map((s) => [s.id, s.geo]));
  return (manifest.captureSpots?.captures ?? []).flatMap(
    (capture: TourCapture) => {
      // The parser guarantees the station; a hand-built manifest that
      // breaks it loses the capture, never the tour.
      const station = stations.get(capture.station);
      return station === undefined
        ? []
        : [
            {
              image: capture.image,
              station: capture.station,
              geo: itemGeoPose(capture.pose, station),
            },
          ];
    }
  );
}
