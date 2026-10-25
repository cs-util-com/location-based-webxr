/**
 * The GPS quality of a stored GPS history, from the phone's own fixes only:
 * how many device fixes it holds and their median reported accuracy. A
 * scanned code's votes share the history (sixteen per voted lock, each
 * claiming the votes' fixed accuracy), so a count or a median over every
 * stored point would read a code seen indoors as a well-aligned GPS
 * session. What counts as a device fix is the library's source stamp
 * (`gpsPointSourceOf`): a point without one is the phone's.
 *
 * The one definition the Tour Viewer reads its GPS quality by: the visitor's
 * line and escape, and the creator's placement gate and mint quality.
 * Pure.
 *
 * @see device-gps-quality.ts.md
 */

import {
  GPS_POINT_SOURCE_DEVICE,
  gpsPointSourceOf,
  type GpsPoint,
} from "gps-plus-slam-app-framework/core";

/** A history's device fixes: their count, and the median of the ones that
 *  state a usable accuracy (null when none does). */
export interface DeviceGpsQuality {
  readonly fixes: number;
  readonly accuracyM: number | null;
}

export function deviceGpsQuality(
  positions: readonly GpsPoint[],
): DeviceGpsQuality {
  let fixes = 0;
  const accuracies: number[] = [];
  for (const p of positions) {
    if (gpsPointSourceOf(p) !== GPS_POINT_SOURCE_DEVICE) continue;
    fixes += 1;
    const accuracy: unknown = p.latLongAccuracy;
    // External data: a missing, non-finite or non-positive accuracy states
    // nothing about the fix's error.
    if (
      typeof accuracy === "number" &&
      Number.isFinite(accuracy) &&
      accuracy > 0
    ) {
      accuracies.push(accuracy);
    }
  }
  accuracies.sort((a, b) => a - b);
  return {
    fixes,
    // The upper middle element: what the visitor's line has always shown.
    accuracyM:
      accuracies.length === 0 ? null : accuracies[accuracies.length >> 1]!,
  };
}
