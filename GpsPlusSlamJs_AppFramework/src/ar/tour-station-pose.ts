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
import type { TourAsset } from './tour-assets.js';
import type { TourBlock } from './tour-blocks.js';
import type { TourLocalPose } from './tour-items.js';
import type { TourManifest, TourObject } from './tour-manifest.js';
import {
  isTourFolder,
  isTourBlockChild,
  type TourFolder,
  type TourStationChild,
  type TourStationHolder,
} from './tour-story.js';

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
 *  and a picture's image asset (`assets`, which the reader resolved). */
function placed(
  block: TourBlock,
  station: { readonly id: string; readonly geo: QrGeoPose },
  assets: ReadonlyMap<string, TourAsset>
): TourObject {
  const { pose, ...fields } = block;
  const imageAsset =
    block.kind === 'picture' ? assets.get(block.image) : undefined;
  return {
    ...fields,
    geo: itemGeoPose(pose, station.geo),
    station: station.id,
    ...(imageAsset === undefined ? {} : { imageAsset }),
  } as TourObject;
}

/** What a plain folder applies to the poses of its children. */
export type TourFolderFrame = Pick<TourFolder, 'pose' | 'scale'>;

/**
 * Where a pose given in a plain folder's frame stands in the folder's
 * holder: `p = p_f + R_f (s p_c)`, `q = R_f q_c`. A folder with no pose and
 * no scale (or scale 1) is the identity: the pose comes back as it is,
 * bit for bit.
 */
export function composeTourFolderPose(
  folder: TourFolderFrame,
  pose: TourLocalPose
): TourLocalPose {
  const scale = folder.scale ?? 1;
  if (folder.pose === undefined && scale === 1) return pose;
  const frame: TourLocalPose = folder.pose ?? {
    position: [0, 0, 0],
    rotation: IDENTITY,
  };
  const [x, y, z] = pose.position;
  const [n, u, e] = rotateVectorByQuaternion(frame.rotation, [
    x * scale,
    y * scale,
    z * scale,
  ]);
  const [fn, fu, fe] = frame.position;
  return {
    // `+ 0` canonicalizes -0, as `localPoseOf` does.
    position: [fn + n + 0, fu + u + 0, fe + e + 0],
    rotation: unit(multiply(frame.rotation, pose.rotation)),
  };
}

/** The inverse of {@link composeTourFolderPose}: a pose in the folder's
 *  holder, given in the folder's own frame. */
export function decomposeTourFolderPose(
  folder: TourFolderFrame,
  pose: TourLocalPose
): TourLocalPose {
  const scale = folder.scale ?? 1;
  if (folder.pose === undefined && scale === 1) return pose;
  const frame: TourLocalPose = folder.pose ?? {
    position: [0, 0, 0],
    rotation: IDENTITY,
  };
  const inverse = conjugate(frame.rotation);
  const [n, u, e] = rotateVectorByQuaternion(inverse, [
    pose.position[0] - frame.position[0],
    pose.position[1] - frame.position[1],
    pose.position[2] - frame.position[2],
  ]);
  return {
    position: [n / scale + 0, u / scale + 0, e / scale + 0],
    rotation: unit(multiply(inverse, pose.rotation)),
  };
}

/** A free block as the world shows it: its pose in its station's frame
 *  (its folders' poses composed in), and the product of its folders'
 *  scales (1 outside any folder). */
export interface TourFlatBlock {
  readonly block: TourBlock;
  readonly scale: number;
}

/**
 * The free blocks of a children list with every plain folder flattened
 * away, at any depth: each block's pose composed through its folders
 * ({@link composeTourFolderPose}), innermost first, and their scales
 * multiplied. Stories are not free blocks and are left out. In document
 * order. What the scale means for a block's size is the renderer's: none
 * applies it yet, so a scaled folder moves its blocks apart without
 * resizing them.
 */
export function tourFlatFreeBlocks(
  children: readonly TourStationChild[]
): TourFlatBlock[] {
  return children.flatMap((child): TourFlatBlock[] => {
    if (isTourBlockChild(child)) return [{ block: child, scale: 1 }];
    if (!isTourFolder(child)) return [];
    const folderScale = child.scale ?? 1;
    return tourFlatFreeBlocks(child.children).map(({ block, scale }) => ({
      block: { ...block, pose: composeTourFolderPose(child, block.pose) },
      scale: folderScale * scale,
    }));
  });
}

/** A station's FREE blocks, which stand in the world while it is shown: the
 *  block children of the station and of its plain folders, each with its
 *  pose in the station's frame ({@link tourFlatFreeBlocks}). */
export function tourFreeBlocks(station: TourStationHolder): TourBlock[] {
  return tourFlatFreeBlocks(station.children).map(({ block }) => block);
}

/** The tour's free blocks in the world, each naming its station, in
 *  station order (a reader settled each one's world view). */
export function tourObjects(
  manifest: Pick<TourManifest, 'stations' | 'assets'>
): TourObject[] {
  const assets = new Map(manifest.assets.map((a) => [a.id, a]));
  return manifest.stations.flatMap((station) =>
    tourFreeBlocks(station).map((block) => placed(block, station, assets))
  );
}

/** The free block an object is, at `pose` in its station: the object
 *  without its geo pose, its station and a picture's inline asset (the
 *  tour lists the asset). */
export function tourObjectBlock(
  object: TourObject,
  pose: TourLocalPose
): TourBlock {
  const { geo: _geo, station: _station, ...rest } = object;
  const { imageAsset: _asset, ...fields } = rest as typeof rest & {
    imageAsset?: TourAsset;
  };
  return { ...fields, pose };
}
