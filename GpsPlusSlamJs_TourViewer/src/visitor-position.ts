/**
 * Where the visitor is, for the station run (tour kit plan K4): the
 * camera's position in the session's GPS-world NUE - the raw AR pose
 * through the solved alignment, the frame the tour's content and the
 * wayfinding HUD live in, so a station is "found" exactly where the HUD's
 * arrow says "arrived" - and the measured accuracy, the median of the
 * latest device fixes' reported accuracy.
 *
 * `fixNue` is where the latest DEVICE fix alone puts the visitor (K4 review
 * R1): a code's votes pull the fused position onto that code's saved spot,
 * so only a raw fix can tell whether a scanned code is where the visitor's
 * GPS says - noisier than the fused position, and never fed by a vote.
 *
 * The accuracy reads DEVICE fixes only: the viewer's synthetic code votes
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
import { interpolatingMedian } from "gps-plus-slam-app-framework/utils/median";

import { odomNueFromWebXr, throughAlignment } from "./visit-anchoring.js";

/**
 * The accuracy is the median of this many latest device fixes: about 10 s
 * at the usual 1 Hz. The median, so one outlier fix neither widens every
 * station nor shrinks it; ten, so a walk into an urban canyon shows within
 * about five fixes. A window of 3 would follow single bad fixes; 30 would
 * keep a narrow radius for 15 s after the sky closed.
 */
export const ACCURACY_WINDOW_FIXES = 10;

export interface VisitorPosition {
  /** The camera in GPS-world NUE (m), or null without an alignment or an
   *  AR pose. */
  readonly nue: readonly [number, number, number] | null;
  /** Median reported accuracy (m) of the latest device fixes, or null
   *  when none carries one. */
  readonly accuracyM: number | null;
  /** Where the latest device fix alone puts the visitor (NUE m; the up
   *  part is the fix's altitude), or null without a zero or a device fix:
   *  never moved by a code's votes (K4 review R1). */
  readonly fixNue: readonly [number, number, number] | null;
}

/** A WebXR pose's position (`getCurrentArPose`'s shape). */
interface ArPoseLike {
  readonly position: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
}

export function visitorPosition(input: {
  readonly alignment: ArrayLike<number> | null;
  readonly arPose: ArPoseLike | null;
  readonly gpsPositions: readonly GpsPoint[];
  /** The session's GPS zero (for `fixNue`); absent or null: no `fixNue`. */
  readonly zero?: LatLong | null;
}): VisitorPosition {
  return {
    nue: cameraNue(input.alignment, input.arPose),
    accuracyM: deviceAccuracy(input.gpsPositions),
    fixNue: latestFixNue(input.gpsPositions, input.zero ?? null),
  };
}

function latestFixNue(
  points: readonly GpsPoint[],
  zero: LatLong | null,
): readonly [number, number, number] | null {
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
    return [nue[0], nue[1], nue[2]];
  }
  return null;
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

function deviceAccuracy(points: readonly GpsPoint[]): number | null {
  const recent: number[] = [];
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const p = points[i]!;
    if (gpsPointSourceOf(p) !== GPS_POINT_SOURCE_DEVICE) continue;
    const accuracy = p.latLongAccuracy;
    if (
      typeof accuracy !== "number" ||
      !Number.isFinite(accuracy) ||
      accuracy <= 0
    ) {
      continue;
    }
    recent.push(accuracy);
    if (recent.length === ACCURACY_WINDOW_FIXES) break;
  }
  return recent.length === 0 ? null : interpolatingMedian(recent);
}
