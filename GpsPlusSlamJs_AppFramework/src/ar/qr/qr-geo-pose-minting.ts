/**
 * Anchor MINTING for a printed QR: compose the code's GPS-world pose (as
 * observed under the CURRENT session alignment) into the `QrGeoPose` a level
 * file carries — the authoring half of the QR-pose loop (plan
 * `2026-08-25-1227-qr-pose-tour-relocalization-plan.md`, M1).
 *
 * Honesty contract (plan §2): the result inherits this session's alignment
 * error — it buys later visitors CONSISTENCY with the author's session, not
 * absolute truth. Callers should record measurement quality alongside (GPS
 * accuracy, alignment sample count) in the level's opaque `content`.
 *
 * Frame contract (the bug class this signature exists to prevent): inputs
 * are **GPS-world NUE** (x = North, y = Up, z = East) — i.e. sampled from an
 * object under an `arWorldGroup` whose matrix carries the alignment (see
 * `enableArWorldGroupAlignment`), e.g. `getWorldPosition()` of a QR-glued
 * `qr-debug-view` object. Feeding a raw-WebXR pose here yields a
 * plausible-looking result rotated about the zero reference.
 */

import type { LatLong, Quaternion } from 'gps-plus-slam-js';

import { worldNueToGps } from '../../visualization/frame-conversions.js';
import type { QrGeoPose } from './qr-gps-vote.js';
import { rotateVectorByQuaternion } from './qr-pose.js';

export interface MintQrGeoPoseInput {
  /** QR centre in GPS-world NUE metres (x=North, y=Up, z=East). */
  readonly worldNuePosition: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  /** QR orientation as a unit quaternion in the NUE GPS-world frame, over
   *  the local axes `buildObjectPoints` pins (+x right, +y up, +z out of
   *  the printed face). */
  readonly worldNueRotation: Quaternion;
  /** The session's GPS zero reference. */
  readonly zero: LatLong;
  /** Absolute altitude (m) of the zero reference — `worldNuePosition.y` is
   *  Up RELATIVE to it, and `QrGeoPose.alt` is absolute. */
  readonly zeroAltitude: number;
}

/** A code is "near-vertical" (wall-poster convention, compat `headingDeg`
 *  emitted) when its local +y stays within this many degrees of world Up. */
const VERTICAL_TOLERANCE_DEG = 10;

export function mintQrGeoPose(input: MintQrGeoPoseInput): QrGeoPose {
  const { worldNuePosition, worldNueRotation, zero, zeroAltitude } = input;
  if (
    ![worldNuePosition.x, worldNuePosition.y, worldNuePosition.z].every(
      Number.isFinite
    ) ||
    !Number.isFinite(zeroAltitude)
  ) {
    throw new RangeError(
      'mintQrGeoPose: position and zeroAltitude must be finite'
    );
  }
  const rotation = normalizeUnitQuaternion(worldNueRotation);

  const gps = worldNueToGps(worldNuePosition, zero);
  const headingDeg = deriveVerticalHeading(rotation);
  return {
    lat: gps.lat,
    lon: gps.lon,
    alt: zeroAltitude + worldNuePosition.y,
    rotation,
    ...(headingDeg !== undefined ? { headingDeg } : {}),
  };
}

function normalizeUnitQuaternion(q: Quaternion): Quaternion {
  const [x, y, z, w] = q;
  if (![x, y, z, w].every(Number.isFinite)) {
    throw new RangeError('mintQrGeoPose: rotation must be finite');
  }
  const norm = Math.hypot(x, y, z, w);
  if (Math.abs(norm - 1) > 1e-3) {
    throw new RangeError(
      `mintQrGeoPose: rotation must be a unit quaternion (|q| = ${norm})`
    );
  }
  return [x / norm, y / norm, z / norm, w / norm];
}

/**
 * The compat `headingDeg` — emitted only when the code is near-vertical
 * (local +y within {@link VERTICAL_TOLERANCE_DEG} of Up): the bearing of the
 * rotated local +x, clockwise from North. A tilted/flat code gets no
 * heading; a rotation-unaware reader then fails LOUD in `parseQrLevel`
 * instead of silently placing it as a wall poster.
 */
function deriveVerticalHeading(rotation: Quaternion): number | undefined {
  const localUp = rotateVectorByQuaternion(rotation, [0, 1, 0]);
  const cosTolerance = Math.cos((VERTICAL_TOLERANCE_DEG * Math.PI) / 180);
  if (localUp[1] < cosTolerance) return undefined;
  const localX = rotateVectorByQuaternion(rotation, [1, 0, 0]);
  // NUE: [0] = North, [2] = East; bearing clockwise from North.
  const bearing = (Math.atan2(localX[2], localX[0]) * 180) / Math.PI;
  return ((bearing % 360) + 360) % 360;
}
