/**
 * Where the visitor is, for the station run (tour kit plan K4): the
 * camera's position in the session's GPS-world NUE - the raw AR pose
 * through the solved alignment, the frame the tour's content and the
 * wayfinding HUD live in, so a station is "found" exactly where the HUD's
 * arrow says "arrived" - and the store's GPS readings its precision is
 * judged from, by the framework's one rule for every app
 * (`gps-plus-slam-app-framework/state/position-precision`).
 *
 * `fixNue` is where the latest DEVICE fix alone puts the visitor (K4 review
 * R1): a code's votes pull the fused position onto that code's saved spot,
 * so only a raw fix can tell whether a scanned code is where the visitor's
 * GPS says - noisier than the fused position, and never fed by a vote.
 *
 * That rule reads DEVICE fixes only: the viewer's synthetic code votes
 * carry a fixed accuracy of their own and would report a phone in an urban
 * canyon as precise (authoring plan §3.6, §7j #3: accuracies from device
 * fixes only).
 */

import {
  calcRelativeCoordsInMeters,
  GPS_POINT_SOURCE_DEVICE,
  gpsPointSourceOf,
  type GpsPoint,
  type LatLong,
} from "gps-plus-slam-app-framework/core";
import type { PrecisionGpsPoint } from "gps-plus-slam-app-framework/state/position-precision";
import { Quaternion, Vector3 } from "three";

import { odomNueFromWebXr, throughAlignment } from "./visit-anchoring.js";

export interface VisitorPosition {
  /** The camera in GPS-world NUE (m), or null without an alignment or an
   *  AR pose. */
  readonly nue: readonly [number, number, number] | null;
  /** The store's GPS readings, oldest first, as given: what the
   *  position's precision is judged from (`position-precision`, which
   *  reads only the device fixes among them). */
  readonly gpsPoints: readonly PrecisionGpsPoint[];
  /** Where the latest device fix alone puts the visitor (NUE m; the up
   *  part is the fix's altitude), or null without a zero or a device fix:
   *  never moved by a code's votes (K4 review R1). */
  readonly fixNue: readonly [number, number, number] | null;
  /** The session has a solved alignment: `nue` is null then only while
   *  the AR pose is (a tracking drop), never for want of an alignment
   *  (M5a review M3: the station guide's fix stands in only without one). */
  readonly aligned: boolean;
  /** The latest device fix's own time (its Geolocation timestamp, epoch
   *  ms): how old the fix is. Null when `fixNue` is, or when that fix's
   *  time is missing or not finite (external data: no time, never NaN). */
  readonly fixAtMs: number | null;
  /** The latest device fix's own reported accuracy (m), or null when
   *  `fixNue` is or that fix states none: where the fix alone is the
   *  position, one outlier fix must not hide behind the device fixes'
   *  median (r881 re-review M-A). */
  readonly fixAccuracyM: number | null;
  /** The camera's forward (its -Z) in GPS-world NUE, a unit vector: the
   *  AR pose's orientation through the alignment, the frame the stations'
   *  bearings are taken in (the radar's heading, W4 build plan M3). Null
   *  without an alignment, a pose, or a pose orientation that is a finite
   *  rotation; absent where a caller builds a position by hand (tests). */
  readonly forwardNue?: readonly [number, number, number] | null;
}

/** A WebXR pose (`getCurrentArPose`'s shape); its orientation is
 *  optional here (the fakes and older callers pass a position alone). */
interface ArPoseLike {
  readonly position: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly orientation?: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly w: number;
  };
}

export function visitorPosition(input: {
  readonly alignment: ArrayLike<number> | null;
  readonly arPose: ArPoseLike | null;
  readonly gpsPositions: readonly GpsPoint[];
  /** The session's GPS zero (for `fixNue`); absent or null: no `fixNue`. */
  readonly zero?: LatLong | null;
}): VisitorPosition {
  const fix = latestFix(input.gpsPositions, input.zero ?? null);
  return {
    nue: cameraNue(input.alignment, input.arPose),
    gpsPoints: input.gpsPositions,
    fixNue: fix?.nue ?? null,
    aligned: usableAlignment(input.alignment),
    fixAtMs: fix?.atMs ?? null,
    fixAccuracyM: fix?.accuracyM ?? null,
    forwardNue: cameraForwardNue(input.alignment, input.arPose),
  };
}

function latestFix(
  points: readonly GpsPoint[],
  zero: LatLong | null,
): {
  nue: readonly [number, number, number];
  atMs: number | null;
  accuracyM: number | null;
} | null {
  if (zero === null) return null;
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const p = points[i]!;
    if (gpsPointSourceOf(p) !== GPS_POINT_SOURCE_DEVICE) continue;
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) {
      continue;
    }
    const alt = Number.isFinite(p.altitude) ? p.altitude! : 0;
    const nue = calcRelativeCoordsInMeters(
      zero,
      { lat: p.latitude, lon: p.longitude },
      alt,
      0,
    );
    return {
      nue: [nue[0], nue[1], nue[2]],
      atMs: Number.isFinite(p.timestamp) ? p.timestamp : null,
      accuracyM: usableAccuracy(p.latLongAccuracy),
    };
  }
  return null;
}

/** A 4x4 matrix of finite numbers: what `throughAlignment` can apply. */
function usableAlignment(alignment: ArrayLike<number> | null): boolean {
  if (alignment === null || alignment.length !== 16) return false;
  for (let i = 0; i < 16; i += 1) {
    if (!Number.isFinite(alignment[i])) return false;
  }
  return true;
}

function cameraNue(
  alignment: ArrayLike<number> | null,
  arPose: ArPoseLike | null,
): readonly [number, number, number] | null {
  if (alignment === null || arPose === null) return null;
  const { x, y, z } = arPose.position;
  if (![x, y, z].every(Number.isFinite)) return null;
  const world = throughAlignment(
    odomNueFromWebXr({ position: [x, y, z], rotation: [0, 0, 0, 1] }),
    alignment,
  );
  if (world === null) return null;
  const [n, u, e] = world.position;
  return [n, u, e];
}

/** The camera's forward (-Z) through the alignment, in GPS-world NUE. */
function cameraForwardNue(
  alignment: ArrayLike<number> | null,
  arPose: ArPoseLike | null,
): readonly [number, number, number] | null {
  const q = arPose?.orientation;
  if (alignment === null || q === undefined) return null;
  const { x, y, z, w } = q;
  if (![x, y, z, w].every(Number.isFinite) || Math.hypot(x, y, z, w) < 1e-9) {
    return null;
  }
  const world = throughAlignment(
    odomNueFromWebXr({ position: [0, 0, 0], rotation: [x, y, z, w] }),
    alignment,
  );
  if (world === null) return null;
  const f = new Vector3(0, 0, -1).applyQuaternion(
    new Quaternion(...world.rotation),
  );
  return [f.x, f.y, f.z];
}

/** A reported accuracy a fix can be judged by: finite and positive. */
function usableAccuracy(accuracy: unknown): number | null {
  return typeof accuracy === "number" &&
    Number.isFinite(accuracy) &&
    accuracy > 0
    ? accuracy
    : null;
}
