/**
 * A station's frame in `tour.json` version 5: converts a block's LOCAL
 * pose (relative to its station) to its world geo pose and back, and gives
 * the WORLD VIEW of a tour - every FREE block (a pin, a picture's plane, a
 * placed model) with its geo pose and the station holding it - which a
 * viewer places and a creator's drafts hold.
 *
 * THE FRAME. A station's geo pose is the origin of a local tangent frame:
 * North, Up and East metres from its latitude and longitude (Up is the
 * absolute altitude, the stack's NUE convention: `calcRelativeCoordsInMeters`
 * with a zero altitude term), turned by the station's rotation against
 * north. A block at local pose `(p, q)` stands at `R_s p` from the station
 * with the rotation `R_s q`. Both directions use the same geodesy the level
 * files and the creator's minting use (`calcRelativeCoordsInMeters`,
 * `mintQrGeoPose`), so a geo pose converted to local and back lands within
 * micrometres of itself (the property test bounds it), and a local pose
 * never changes unless an editor sets a new one (a station moves rigidly,
 * its blocks' local poses stay bit-identical).
 *
 * Double precision throughout (`tour-folder-pose.ts`'s quaternion
 * arithmetic): `qr-pose.ts`'s `composePose` goes through gl-matrix's
 * float32 arrays, which would cost centimetres at an absolute altitude of
 * 500 m.
 *
 * @see tour-station-pose.ts.md
 */

import type { Quaternion } from 'gps-plus-slam-js';

import { calcRelativeCoordsInMeters } from '../core/index.js';
import type { QrGeoPose } from './qr/qr-gps-vote.js';
import { mintQrGeoPose } from './qr/qr-geo-pose-minting.js';
import { rotateVectorByQuaternion } from './qr/qr-pose.js';
import type { TourAsset } from './tour-assets.js';
import type { TourBlock } from './tour-blocks.js';
import {
  composeTourFolderPose,
  IDENTITY_QUATERNION as IDENTITY,
  quaternionInverse as conjugate,
  quaternionProduct as multiply,
  unitQuaternion as unit,
} from './tour-folder-pose.js';
import type { TourLocalPose } from './tour-items.js';
import type { TourManifest, TourObject } from './tour-manifest.js';
import {
  isTourBlockChild,
  isTourFolder,
  type TourStationChild,
  type TourStationHolder,
} from './tour-story.js';

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
 * Where a geo pose stands in a station's frame: the local pose a block
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
  // altitude by up to 30 micrometres - noise on every save of a block.
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

/** The geo pose of a block at local pose `pose` in the station at
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

/** A free block in the world: its fields, its geo pose and its station,
 *  the plain folders holding it (none: absent), and a picture's image
 *  asset (`assets`, which the reader resolved). */
function placed(
  entry: TourFreeEntry,
  station: { readonly id: string; readonly geo: QrGeoPose },
  assets: ReadonlyMap<string, TourAsset>
): TourObject {
  const { block, folder } = entry;
  const { pose, ...fields } = block;
  const imageAsset =
    block.kind === 'picture' ? assets.get(block.image) : undefined;
  return {
    ...fields,
    geo: itemGeoPose(pose, station.geo),
    station: station.id,
    ...(folder.length === 0 ? {} : { folder }),
    ...(imageAsset === undefined ? {} : { imageAsset }),
  } as TourObject;
}

/** A free block of a station, its pose in the station's frame, and the
 *  ids of the plain folders holding it, outermost first (none: it stands
 *  at the station's top). */
export interface TourFreeEntry {
  readonly block: TourBlock;
  readonly folder: readonly string[];
}

/** The free blocks of a children list with every plain folder flattened
 *  away, at any depth, each block's pose composed through its folders
 *  (`composeTourFolderPose`, innermost first) and the folders named.
 *  Stories are not free blocks and are left out. In document order. */
function freeEntries(
  children: readonly TourStationChild[],
  path: readonly string[]
): TourFreeEntry[] {
  return children.flatMap((child): TourFreeEntry[] => {
    if (isTourBlockChild(child)) return [{ block: child, folder: path }];
    if (!isTourFolder(child)) return [];
    return freeEntries(child.children, [...path, child.id]).map((entry) => ({
      block: {
        ...entry.block,
        pose: composeTourFolderPose(child, entry.block.pose),
      },
      folder: entry.folder,
    }));
  });
}

/** A station's free blocks as {@link tourFreeBlocks} gives them, each with
 *  the plain folders holding it ({@link TourFreeEntry}). */
export function tourFreeEntries(station: TourStationHolder): TourFreeEntry[] {
  return freeEntries(station.children, []);
}

/** A station's FREE blocks, which stand in the world while it is shown: the
 *  block children of the station and of its plain folders at any depth,
 *  each with its pose in the station's frame (its folders' poses composed
 *  in; a folder is a rigid frame, since its scale is always 1). The ONE
 *  place plain folders are flattened. */
export function tourFreeBlocks(station: TourStationHolder): TourBlock[] {
  return freeEntries(station.children, []).map((entry) => entry.block);
}

/** The tour's free blocks in the world, each naming its station and the
 *  plain folders holding it (`folder`), in station order (a reader
 *  settled each one's world view). */
export function tourObjects(
  manifest: Pick<TourManifest, 'stations' | 'assets'>
): TourObject[] {
  const assets = new Map(manifest.assets.map((a) => [a.id, a]));
  return manifest.stations.flatMap((station) =>
    tourFreeEntries(station).map((entry) => placed(entry, station, assets))
  );
}

/** The free block an object is, at `pose` in its holder (its station, or
 *  the folder holding it): the object without its geo pose, its station,
 *  its folders and a picture's inline asset (the tour lists the asset). */
export function tourObjectBlock(
  object: TourObject,
  pose: TourLocalPose
): TourBlock {
  const { geo: _geo, station: _station, folder: _folder, ...rest } = object;
  const { imageAsset: _asset, ...fields } = rest as typeof rest & {
    imageAsset?: TourAsset;
  };
  return { ...fields, pose };
}
