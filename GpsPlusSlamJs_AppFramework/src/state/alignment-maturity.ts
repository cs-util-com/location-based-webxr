/**
 * Alignment MATURITY and the pick that rests on it: through which alignment
 * an object seen or placed at one moment gets its global position - the
 * FIRST MATURE alignment at or after that moment (owner decisions D28
 * revised for the Recorder's QR mint, D33 for the Tour Viewer's authoring
 * settle and the GPS anchor's `'mature-alignment'` start-up).
 *
 * WHY. An alignment fitted to the END of a long walk sees an object placed
 * early displaced by all the SLAM drift walked after it (measured: 8.4-8.6 m
 * p50 at 500 m away with 1 % and 1 degree per 100 m). The alignment at the
 * moment itself is no better while the walk is short: its yaw is GPS noise
 * until the fixes span a baseline (41 degrees heading p50 below 5 m of GPS
 * extent). Stopping at the first alignment whose session GPS extent reaches
 * the floor keeps both: about 1.2 m, flat in the distance walked after.
 *
 * Pure: a pick is opened at the moment and folded one alignment change at a
 * time ({@link advanceMatureAlignmentPick}); the store keeps no alignment
 * history, so the caller folds while the alignment evolves.
 *
 * @see alignment-maturity.ts.md
 */

import type { LatLong } from '../core/index.js';

/**
 * Session GPS extent (m) at which an alignment counts as MATURE.
 *
 * Measured (`ar/qr/qr-anchor-mint.start-at-code.test.ts`, `start` and
 * `left`; and the Tour Viewer's `visit-settle.left-behind.test.ts`; 5 m GPS
 * accuracy, Gauss-Markov wander 0.25 x accuracy over 60 s plus white 0.15 x
 * accuracy; SLAM drift 0.5-2 % and 0.5-2 degrees per 100 m):
 * - 10-20 m is already met at a mid-walk sighting, so it is the sighting's
 *   own alignment, and for a code seen only at the start it is WORSE than
 *   the alignment at the walk's end (up to 8 degrees p50, 15-24 p90): the
 *   reversing value.
 * - 40 m (the owner's choice, D34, 2026-10-04) keeps a code left behind at
 *   1.1-1.7 m; its p90 heading is 5-6 degrees at 2 % translation drift.
 * - 80 m (the session's earlier recommendation, shipped from D28 revised
 *   until D34) gives the same positions and a p90 heading of 3-4 degrees
 *   there; notes left behind 1.0-1.2 m p50. It loses to 40 m when 80 m of
 *   extent comes long after the object (a code measured at the start of
 *   long first walks: 5.3 m against 1.6 m at 2 % / 2 degrees; a 100 m
 *   out-and-back authoring visit: 1.7 / 3.8 m against 1.1 / 1.7 m).
 * The owner chose 40 m on this simulation's evidence, trading 1-2 degrees of
 * p90 heading at high drift for maturity on short walks; the sweep on real
 * recordings is filed as the check on it. A lower GPS accuracy figure
 * shrinks the noise share of the extent, so the floor would mean a longer
 * real walk at 2-3 m accuracy.
 */
export const MATURE_GPS_EXTENT_M = 40;

/** The alignment as it stands at one moment. */
export interface AlignmentMoment {
  /** Column-major odometry-NUE -> GPS-world NUE; null before a solve. */
  readonly alignmentMatrix: ArrayLike<number> | null;
  readonly zero: LatLong | null;
  /**
   * The session's GPS extent (m) this alignment rests on
   * (`gps-extent-tracker.ts`); absent when the caller does not know it,
   * which is never mature.
   */
  readonly gpsExtentM?: number | undefined;
}

/** Through which alignment an object is fixed, as known so far. */
export interface MatureAlignmentPick<A extends AlignmentMoment> {
  readonly alignment: A;
  /** True once `alignment` is mature: the pick never moves again. */
  readonly mature: boolean;
}

/** An alignment an object can be placed through: a matrix and a zero. */
export function isUsableAlignment(a: AlignmentMoment): boolean {
  return a.alignmentMatrix !== null && a.zero !== null;
}

/**
 * The floor (m) to use: {@link MATURE_GPS_EXTENT_M} when absent.
 *
 * @throws RangeError when it is not a positive, finite number of metres.
 */
export function checkMatureGpsExtentM(floorM: number | undefined): number {
  const floor = floorM ?? MATURE_GPS_EXTENT_M;
  if (!Number.isFinite(floor) || floor <= 0) {
    throw new RangeError(
      `matureGpsExtentM must be a positive, finite number of metres; got ${String(floor)}`
    );
  }
  return floor;
}

/**
 * Usable, and its GPS extent reaches `floorM`. An unknown or non-finite
 * extent is never mature: the floor is the only evidence that the yaw is
 * observable.
 */
export function isMatureAlignment(
  a: AlignmentMoment,
  floorM: number = MATURE_GPS_EXTENT_M
): boolean {
  return (
    isUsableAlignment(a) &&
    a.gpsExtentM !== undefined &&
    Number.isFinite(a.gpsExtentM) &&
    a.gpsExtentM >= floorM
  );
}

/** The pick at the moment itself: that moment's alignment, mature or not. */
export function openMatureAlignmentPick<A extends AlignmentMoment>(
  now: A,
  floorM: number = MATURE_GPS_EXTENT_M
): MatureAlignmentPick<A> {
  return { alignment: now, mature: isMatureAlignment(now, floorM) };
}

/**
 * One alignment change after the moment: a mature pick stays where it is;
 * an open one moves to `now` when `now` is usable (and is mature from then
 * on if `now` is). An unusable `now` (no matrix or no zero: a GPS gap, a
 * reset store) leaves the pick on the last usable alignment.
 */
export function advanceMatureAlignmentPick<A extends AlignmentMoment>(
  pick: MatureAlignmentPick<A>,
  now: A,
  floorM: number = MATURE_GPS_EXTENT_M
): MatureAlignmentPick<A> {
  if (pick.mature || !isUsableAlignment(now)) return pick;
  return openMatureAlignmentPick(now, floorM);
}
