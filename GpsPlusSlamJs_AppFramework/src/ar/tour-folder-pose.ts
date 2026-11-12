/**
 * A plain folder's FRAME in `tour.json` version 5: a block inside a plain
 * folder has its local pose given in the folder's own `pose` (absent: the
 * holder's frame), and this module turns such a pose into the holder's
 * frame and back, through any number of nested folders. It also holds the
 * double-precision quaternion arithmetic the station frame
 * (`tour-station-pose.ts`) shares: `qr-pose.ts`'s `composePose` goes
 * through gl-matrix's float32 arrays, which would cost centimetres at an
 * absolute altitude of 500 m.
 *
 * A folder's `scale` is not applied here: the format takes only 1 until a
 * renderer scales a whole group (`tour-story.ts`), so a folder is a rigid
 * frame. Applying a scale to positions alone would move a group's blocks
 * apart while their sizes stay, which is no resize at all.
 *
 * Kept apart from `tour-station-pose.ts` because the children reader
 * (`tour-story.ts`) bounds a composed offset with it, and the station
 * frame reads the children: one module holding both would import itself
 * in a circle.
 *
 * @see tour-folder-pose.ts.md
 */

import type { Quaternion } from 'gps-plus-slam-js';

import { renormalizeUnitQuaternion } from './qr/qr-geo-pose-minting.js';
import { rotateVectorByQuaternion } from './qr/qr-pose.js';
import type { TourLocalPose } from './tour-items.js';

export const IDENTITY_QUATERNION: Quaternion = [0, 0, 0, 1];

/** The product `a * b` of two quaternions `[x, y, z, w]`. */
export function quaternionProduct(a: Quaternion, b: Quaternion): Quaternion {
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
export function quaternionInverse(q: Quaternion): Quaternion {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** A unit quaternion back to unit length after arithmetic (never fails
 *  for a product of unit quaternions). */
export function unitQuaternion(q: Quaternion): Quaternion {
  return renormalizeUnitQuaternion(q) ?? IDENTITY_QUATERNION;
}

/** What a plain folder applies to the poses of its children: its pose. */
export interface TourFolderFrame {
  readonly pose?: TourLocalPose;
}

/**
 * Where a pose given in a plain folder's frame stands in the folder's
 * holder: `p = p_f + R_f p_c`, `q = R_f q_c`. A folder with no pose is the
 * identity: the pose comes back as it is, bit for bit.
 */
export function composeTourFolderPose(
  folder: TourFolderFrame,
  pose: TourLocalPose
): TourLocalPose {
  const frame = folder.pose;
  if (frame === undefined) return pose;
  const [n, u, e] = rotateVectorByQuaternion(frame.rotation, pose.position);
  const [fn, fu, fe] = frame.position;
  return {
    // `+ 0` canonicalizes -0, which JSON cannot carry (round trips exact).
    position: [fn + n + 0, fu + u + 0, fe + e + 0],
    rotation: unitQuaternion(quaternionProduct(frame.rotation, pose.rotation)),
  };
}

/** The inverse of {@link composeTourFolderPose}: a pose in the folder's
 *  holder, given in the folder's own frame. */
export function decomposeTourFolderPose(
  folder: TourFolderFrame,
  pose: TourLocalPose
): TourLocalPose {
  const frame = folder.pose;
  if (frame === undefined) return pose;
  const inverse = quaternionInverse(frame.rotation);
  const [n, u, e] = rotateVectorByQuaternion(inverse, [
    pose.position[0] - frame.position[0],
    pose.position[1] - frame.position[1],
    pose.position[2] - frame.position[2],
  ]);
  return {
    position: [n + 0, u + 0, e + 0],
    rotation: unitQuaternion(quaternionProduct(inverse, pose.rotation)),
  };
}

/** The inverse of {@link composeTourFolderPath}: a pose in the frame that
 *  holds the outermost of `folders` (outermost first), given in the
 *  innermost's frame - decomposed outermost first. No folders: the pose
 *  itself. */
export function decomposeTourFolderPath(
  folders: readonly TourFolderFrame[],
  pose: TourLocalPose
): TourLocalPose {
  return folders.reduce(
    (outer, folder) => decomposeTourFolderPose(folder, outer),
    pose
  );
}

/** A pose given in the innermost of `folders` (outermost first) in the
 *  frame that holds the outermost: composed innermost first. No folders:
 *  the pose itself. */
export function composeTourFolderPath(
  folders: readonly TourFolderFrame[],
  pose: TourLocalPose
): TourLocalPose {
  return folders.reduceRight(
    (inner, folder) => composeTourFolderPose(folder, inner),
    pose
  );
}
