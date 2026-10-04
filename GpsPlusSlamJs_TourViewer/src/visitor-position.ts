/**
 * Where the visitor is, for the station run (tour kit plan K4): the
 * camera's position in the session's GPS-world NUE - the raw AR pose
 * through the solved alignment, the frame the tour's content and the
 * wayfinding HUD live in, so a station is "found" exactly where the HUD's
 * arrow says "arrived" - and the measured accuracy, the median of the
 * latest device fixes' reported accuracy.
 *
 * The accuracy reads DEVICE fixes only: the viewer's synthetic code votes
 * carry a fixed accuracy of their own and would report a phone in an urban
 * canyon as precise (authoring plan §3.6, §7j #3: accuracies from device
 * fixes only).
 */

import {
  GPS_POINT_SOURCE_DEVICE,
  gpsPointSourceOf,
  type GpsPoint,
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
}): VisitorPosition {
  return {
    nue: cameraNue(input.alignment, input.arPose),
    accuracyM: deviceAccuracy(input.gpsPositions),
  };
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
