/**
 * The phone's own GPS fixes in a stored GPS history, and their quality: the
 * ONE device-only filter (`deviceSamples`) and the ONE accuracy median
 * (`medianAccuracyM`) the Tour Viewer reads them by. A scanned code's votes
 * share the history (sixteen per voted lock, each claiming the votes' fixed
 * accuracy), so a count or a median over every stored point would read a
 * code seen indoors as a well-aligned GPS session. What counts as a device
 * fix is the library's source stamp (`gpsPointSourceOf`): a point without
 * one is the phone's.
 *
 * Read through here: the visitor's GPS line and escape, the creator's
 * placement gate and the quality a newly measured code is stamped with
 * (`deviceGpsQuality`), the creator's visit log (`visit-log.ts`), the
 * walked distance and the moved-code estimators (`deviceSamples`). One
 * filter and one median, so a code's mint stamp and its visit's log entry
 * read the same accuracy for the same visit. Pure.
 *
 * @see device-gps-quality.ts.md
 */

import {
  GPS_POINT_SOURCE_DEVICE,
  gpsPointSourceOf,
} from "gps-plus-slam-app-framework/core";
import { interpolatingMedian } from "gps-plus-slam-app-framework/utils/median";

/** A readable fix: finite coordinates in range, with its reported
 *  horizontal accuracy (m) when that is a positive number. */
export interface DeviceGpsPoint {
  readonly lat: number;
  readonly lng: number;
  readonly accuracy?: number;
}

/** A stored GPS point, as far as this module reads it: external data, so
 *  every field is checked. */
export interface StoredGpsFix {
  readonly latitude?: unknown;
  readonly longitude?: unknown;
  readonly latLongAccuracy?: unknown;
  /** The fix's own time (epoch ms). */
  readonly timestamp?: unknown;
  readonly source?: string;
}

export interface DeviceSampleInput {
  /** `selectGpsPositions` - paired index for index with the odometry. */
  readonly gpsPositions: readonly StoredGpsFix[];
  /** `selectOdometryPositions` (odometry NUE); unpaired lists give none. */
  readonly odometryPositions: readonly (readonly number[])[];
}

export interface DeviceSample {
  readonly fix: DeviceGpsPoint;
  readonly odom: readonly number[] | null;
  readonly timestampMs?: number;
}

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** A readable point (finite, in range), with its accuracy when that is a
 *  positive number; null otherwise. The store's fixes and the draft's
 *  points go through this one check. */
export function readGpsPoint(
  lat: unknown,
  lng: unknown,
  accuracy: unknown,
): DeviceGpsPoint | null {
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return isFiniteNumber(accuracy) && accuracy > 0
    ? { lat, lng, accuracy }
    : { lat, lng };
}

function finitePosition(p: readonly number[]): boolean {
  return p.length >= 3 && [p[0], p[1], p[2]].every(isFiniteNumber);
}

/**
 * The device fixes with readable coordinates, and their odometry partners
 * (index for index), synthetic code votes left out: a vote's odometry is
 * the code's corner, not where the phone stood. A fix's own time comes
 * along (`timestampMs`, when finite) for the moved-code estimators.
 */
export function deviceSamples(input: DeviceSampleInput): DeviceSample[] {
  const paired = input.gpsPositions.length === input.odometryPositions.length;
  return input.gpsPositions.flatMap((p, i) => {
    if (gpsPointSourceOf(p) !== GPS_POINT_SOURCE_DEVICE) return [];
    const fix = readGpsPoint(p.latitude, p.longitude, p.latLongAccuracy);
    if (fix === null) return [];
    const odom = paired ? (input.odometryPositions[i] ?? null) : null;
    const sample = {
      fix,
      odom: odom !== null && finitePosition(odom) ? odom : null,
    };
    return [
      isFiniteNumber(p.timestamp)
        ? { ...sample, timestampMs: p.timestamp }
        : sample,
    ];
  });
}

/**
 * The median reported accuracy of `fixes` (m), over those that report one;
 * null when none does. The interpolating median (the mean of the two
 * middle values for an even count): the standard statistic, not biased by
 * the count's parity, and the one the visit combiner's accuracies have
 * always been read with.
 */
export function medianAccuracyM(
  fixes: readonly DeviceGpsPoint[],
): number | null {
  const accuracies = fixes.flatMap((f) =>
    f.accuracy === undefined ? [] : [f.accuracy],
  );
  return accuracies.length === 0 ? null : interpolatingMedian(accuracies);
}

/** A history's device fixes: their count, and the median of the ones that
 *  state a usable accuracy (null when none does). */
export interface DeviceGpsQuality {
  readonly fixes: number;
  readonly accuracyM: number | null;
}

export function deviceGpsQuality(
  positions: readonly StoredGpsFix[],
): DeviceGpsQuality {
  const fixes = deviceSamples({
    gpsPositions: positions,
    odometryPositions: [],
  }).map((s) => s.fix);
  return { fixes: fixes.length, accuracyM: medianAccuracyM(fixes) };
}
