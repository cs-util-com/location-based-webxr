/**
 * QR pose → synthetic GPS-vote bridge — Phase 5 of the QR-code detection &
 * tracking plan (§6).
 *
 * A detected QR is NOT a rigid re-anchor. Instead its solved pose is turned into
 * one (or, by default, four) very-high-weight synthetic GPS observation(s) and
 * injected into the existing weighted alignment + outlier-rejection fusion via
 * the normal `recordGpsEvent` path. "Mostly but not entirely overrides the other
 * votes" then falls out of the existing accuracy→weight curve for free, and a
 * single bad detection is still rejectable as an outlier rather than teleporting
 * the scene.
 *
 * Multi-correspondence (default): a single QR gives a full 6-DoF pose, but the
 * fusion is point-based. We know the QR's 4 corners in BOTH odom space (from the
 * solved pose + size) and geo space (corner offsets from the geo center via its
 * heading + size), so injecting the 4 corners as 4 observations lets ONE
 * detection immediately constrain rotation + translation. The corners are
 * coplanar, so the QR-normal (depth) DOF stays the least-constrained — exactly
 * what the occupancy self-check (`qr-occupancy-check.ts`, §7) guards.
 *
 * This module only BUILDS the payloads (pure, fully testable). Dispatching them
 * to the store is the caller's job (Phase 6 wiring).
 *
 * @see qr-pose.ts for the pose; gps-event-coordinator.ts for the normal path.
 */

import type {
  Quaternion,
  RawGpsPoint,
  RecordGpsEventPayload,
} from 'gps-plus-slam-js';
import type { Vector3 } from 'gps-plus-slam-js';
import { calcGpsCoords } from 'gps-plus-slam-js';
import {
  buildObjectPoints,
  rotateVectorByQuaternion,
  transformPoint,
  type Pose,
} from './qr-pose.js';

/**
 * Absolute geo pose of the printed QR, from the level file.
 *
 * At least ONE of `headingDeg` / `rotation` must be present (enforced by
 * `parseQrLevel` and by `buildQrGpsVotes`). When both are present,
 * `rotation` wins.
 */
export interface QrGeoPose {
  lat: number;
  lon: number;
  /** Altitude of the QR center, meters. */
  alt: number;
  /**
   * Compass bearing (degrees clockwise from true North) that the QR's local +X
   * axis points toward. The QR is assumed vertical (wall-mounted): local +Y =
   * world up, local +X = horizontal at this bearing — which puts the printed
   * face's NORMAL at `headingDeg + 90°`. Optional since the 6-DoF extension
   * (QR-pose plan 2026-08-25): a floor/ceiling code has no honest heading.
   */
  headingDeg?: number;
  /**
   * Full 6-DoF orientation of the printed code as a unit quaternion
   * `[x, y, z, w]` in the **NUE GPS-world frame** (x = North, y = Up,
   * z = East — the same y-up frame every other quaternion in this stack
   * uses; a mislabeled basis is a 120° bug). It rotates the QR's local axes
   * (+x right, +y up, +z out of the printed face — `buildObjectPoints`'s
   * convention) into NUE. A vertical wall poster at compass heading `h` is
   * the rotation of `−h` about the Up axis.
   */
  rotation?: Quaternion;
}

export interface QrGpsVoteInput {
  /** Solved QR pose in raw-WebXR/odom space (`solveQrPose().qrPoseWorld`). */
  qrPoseWorld: Pose;
  /** Printed physical side length, meters. */
  sizeM: number;
  /** Absolute geo pose from the level file. */
  qrGeo: QrGeoPose;
  /**
   * Synthetic GPS accuracy in meters. Small → very high weight (the core
   * library computes `weight = 1/accuracy^gpsAccuracyExponent`). Pick & validate
   * against the fusion rather than hardcoding blindly (plan §6).
   */
  syntheticAccuracyM: number;
  /**
   * Device/odom rotation to stamp on each payload. Defaults to the QR's world
   * rotation; the fusion uses this only for the device-rotation derivation, not
   * for the positional correspondence.
   */
  odomRotation?: Quaternion;
  /** 4 corner observations (default) vs. a single center observation. */
  multiCorrespondence?: boolean;
  /**
   * WIDE-BASELINE north-stiffness knob (Note 2 of the follow-up plan). When > 0,
   * synthesize the correspondences on a regular polygon of THIS radius (meters)
   * in the QR plane instead of using the physical corners. Because the full
   * 6-DoF pose + geo + heading are known, these virtual points are consistent in
   * BOTH odom and geo space by construction; a wider baseline gives the single
   * pose far more lever-arm, so corner-pixel noise maps to a much smaller heading
   * error. The physical-corner mode is the `baselineM = 0`/undefined special case.
   *
   * ⚠️ This adds NO new information — every point derives from the one solved
   * pose — so it is a pure leverage/reweighting device. Increasing `count`
   * makes a BAD detection harder for the outlier-rejection step to reject (all
   * pairs are wrong together); it is only safe because the pre-injection gates (reprojection,
   * occupancy plausibility, N-consecutive-lock) ensure only good detections vote.
   * Treat it as a bounded tuning knob, not a free dial (plan §1 "dominates but
   * does not entirely erase").
   */
  baselineM?: number;
  /**
   * Number of synthetic correspondences in wide-baseline mode (≥ 3 for a
   * non-collinear, well-posed rotation constraint). Default 4. Ignored unless
   * `baselineM > 0`. This is the dominance (vote-count) half of the knob.
   */
  count?: number;
  /** Epoch ms stamped on every synthetic point. Defaults to `Date.now()`. */
  timestamp?: number;
  /** Id prefix for the synthetic points. Default `'qr'`. */
  idPrefix?: string;
}

/**
 * `count` points evenly spaced on a circle of radius `baselineM` in the QR
 * plane (z = 0), starting at local +x. The symmetric ring's centroid is the QR
 * center, so translation stays anchored there while the wide radius stiffens
 * the rotation fit. Non-collinear for `count ≥ 3`.
 */
function widePlanePoints(baselineM: number, count: number): readonly Vector3[] {
  const points: Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const theta = (2 * Math.PI * i) / count;
    points.push([baselineM * Math.cos(theta), baselineM * Math.sin(theta), 0]);
  }
  return points;
}

/** East/North/Up offset (meters) of a QR-plane point from the QR center. */
export interface Enu {
  east: number;
  north: number;
  up: number;
}

/**
 * Map a QR-local plane offset (meters; +x right, +y up on the printed face) to
 * an East/North/Up offset, given the QR's compass heading. Vertical-QR
 * convention: +y is world up; +x is horizontal at `headingDeg` (clockwise from
 * North), so east = x·sin(h), north = x·cos(h).
 */
export function localPlaneToEnu(
  localX: number,
  localY: number,
  headingDeg: number
): Enu {
  const h = (headingDeg * Math.PI) / 180;
  return {
    east: localX * Math.sin(h),
    north: localX * Math.cos(h),
    up: localY,
  };
}

/**
 * Map a QR-local point (meters, `buildObjectPoints` axes) to an
 * East/North/Up offset using whichever orientation the geo pose carries:
 * the full `rotation` quaternion (6-DoF, wins when both are present) or the
 * legacy vertical-poster `headingDeg`. A vertical-poster quaternion
 * reproduces the heading path exactly (property-tested). Throws when the
 * pose carries neither — that level should never have parsed.
 */
export function localPlaneOffset(local: Vector3, geo: QrGeoPose): Enu {
  if (geo.rotation !== undefined) {
    // Double-precision rotation (NOT the float32 `transformPoint`); with a
    // NUE quaternion the result is a NUE offset.
    const nue = rotateVectorByQuaternion(geo.rotation, local);
    return { north: nue[0], up: nue[1], east: nue[2] };
  }
  if (geo.headingDeg === undefined) {
    throw new RangeError(
      'qr-gps-vote: QrGeoPose carries neither headingDeg nor rotation'
    );
  }
  return localPlaneToEnu(local[0], local[1], geo.headingDeg);
}

/** Apply an ENU meter offset to a geo pose (equirectangular; exact enough for sub-meter QR corners). */
export function offsetGeo(
  center: QrGeoPose,
  enu: Enu
): { latitude: number; longitude: number; altitude: number } {
  // Delegates to the library's `calcGpsCoords` (quality-review A-3 — this
  // used to re-implement the conversion with 111320 m/deg on BOTH axes; the
  // library uses the polar/equatorial split, a ≈0.17 % latitude difference,
  // <2 mm at QR scale). NUE convention: [0]=North, [1]=Up, [2]=East; the Up
  // component is ignored by calcGpsCoords and composed onto the altitude here.
  // Guard the degenerate pole case where cos(lat) → 0 would blow up the
  // longitude division inside the library helper.
  const nearPole = Math.abs(Math.cos((center.lat * Math.PI) / 180)) < 1e-14;
  const { lat, lon } = calcGpsCoords({ lat: center.lat, lon: center.lon }, [
    enu.north,
    enu.up,
    nearPole ? 0 : enu.east,
  ]);
  return {
    latitude: lat,
    longitude: lon,
    altitude: center.alt + enu.up,
  };
}

/**
 * Build the synthetic `recordGpsEvent` payload(s) for one QR detection. Returns
 * 4 corner correspondences by default, or 1 center correspondence when
 * `multiCorrespondence` is false. Each payload pairs the corner's odom position
 * (from the solved pose) with its absolute geo position (from the level file),
 * stamped with the tiny synthetic accuracy.
 *
 * @throws RangeError on a non-positive `sizeM` or `syntheticAccuracyM`.
 */
export function buildQrGpsVotes(
  input: QrGpsVoteInput
): RecordGpsEventPayload[] {
  const {
    qrPoseWorld,
    sizeM,
    qrGeo,
    syntheticAccuracyM,
    odomRotation = qrPoseWorld.rotation,
    multiCorrespondence = true,
    baselineM,
    count = 4,
    timestamp = Date.now(),
    idPrefix = 'qr',
  } = input;

  if (!(syntheticAccuracyM > 0) || !Number.isFinite(syntheticAccuracyM)) {
    throw new RangeError(
      `qr-gps-vote: syntheticAccuracyM must be positive, got ${syntheticAccuracyM}`
    );
  }

  const useWideBaseline =
    baselineM !== undefined && Number.isFinite(baselineM) && baselineM > 0;
  if (useWideBaseline && count < 3) {
    throw new RangeError(
      `qr-gps-vote: wide-baseline count must be >= 3 (collinear otherwise), got ${count}`
    );
  }

  // Wide-baseline mode: a regular polygon of radius `baselineM` in the QR plane
  // (Note 2). Otherwise the physical corners: `buildObjectPoints` validates
  // sizeM (>0, finite) and gives TL,TR,BR,BL; or a single center point.
  const localPoints: readonly Vector3[] = useWideBaseline
    ? widePlanePoints(baselineM, count)
    : multiCorrespondence
      ? buildObjectPoints(sizeM)
      : [[0, 0, 0]];

  return localPoints.map((local, i) => {
    const odomPosition = transformPoint(local, qrPoseWorld);
    const geo = offsetGeo(qrGeo, localPlaneOffset(local, qrGeo));
    const rawGpsPoint: RawGpsPoint = {
      id: `${idPrefix}-${timestamp}-${i}`,
      latitude: geo.latitude,
      longitude: geo.longitude,
      altitude: geo.altitude,
      latLongAccuracy: syntheticAccuracyM,
      timestamp,
    };
    return { odomPosition, odomRotation, rawGpsPoint };
  });
}
