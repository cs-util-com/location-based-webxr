/**
 * Decides whether a live GPS fix is believable enough to become a breadcrumb
 * point (component 10, TASK.md §2.3).
 *
 * `shouldSampleBreadcrumbPoint` only asks "far enough from the last recorded
 * point?". On a device that is not really walking (desktop, indoors) the fix
 * jumps A -> B -> A -> B, every jump passes that check, and the trail piles up
 * on the same two spots. This gate rejects fixes that are inaccurate or that
 * imply an impossible move from the last recorded point, and recovers when the
 * trail legitimately jumps (tunnel, GPS dropout, a bad first point):
 *
 * - `reanchor` — the session calls it when a waypoint is dropped at the live
 *   GPS position, so the author standing at a new spot is believed again.
 * - self-healing — `REANCHOR_FIX_COUNT` rejected fixes in a row that agree with
 *   each other are a new place the author really is, not noise.
 *
 * Pure: no store, no browser. Distance reuses the framework's tested
 * `approxDistanceMetres`, same authoring-time exception as the sampler.
 *
 * @see breadcrumb-sampler.ts (the minimum-spacing rule this builds on)
 */

import { approxDistanceMetres } from "gps-plus-slam-app-framework/geo";

import type { TourCoord } from "../../../store/types.js";
import { shouldSampleBreadcrumbPoint } from "./breadcrumb-sampler.js";

/** A fix reporting worse accuracy than this is not evidence of position.
 *  Desktop / Wi-Fi fixes typically claim tens to hundreds of metres. Tunable. */
export const MAX_FIX_ACCURACY_M = 20;

/** Faster than this between two recorded points is a teleport, not a walk
 *  (5 m/s is ~18 km/h: a brisk run). Tunable. */
export const MAX_WALK_SPEED_MPS = 5;

/** Without timestamps there is no speed; fall back to a plain distance cap. */
export const MAX_JUMP_WITHOUT_TIMESTAMP_M = 20;

/** Rejected fixes in a row that must agree before they become the new anchor. */
export const REANCHOR_FIX_COUNT = 3;

/** "Agree" = every pair of them within this many metres. */
export const REANCHOR_RADIUS_M = 5;

/** What a position source knows about a fix beyond its coordinate. */
export interface FixInfo {
  /** Horizontal accuracy in metres (`GeolocationCoordinates.accuracy`). */
  readonly accuracy?: number | undefined;
  /** Milliseconds, `GeolocationPosition.timestamp`. */
  readonly timestamp?: number | undefined;
}

export interface BreadcrumbGate {
  /** True when `coord` should be recorded; the gate then treats it as the
   *  new last-recorded point. */
  consider(coord: TourCoord, fix?: FixInfo): boolean;
  /** Trust `coord` as the new last-recorded point without recording it. */
  reanchor(coord: TourCoord, fix?: FixInfo): void;
}

interface Anchor {
  readonly coord: TourCoord;
  readonly timestamp: number | undefined;
}

function isBelievableMove(
  anchor: Anchor,
  coord: TourCoord,
  timestamp: number | undefined,
): boolean {
  const distanceM = approxDistanceMetres(
    anchor.coord.lat,
    anchor.coord.lon,
    coord.lat,
    coord.lon,
  );
  if (anchor.timestamp !== undefined && timestamp !== undefined) {
    const elapsedS = (timestamp - anchor.timestamp) / 1000;
    if (elapsedS > 0) return distanceM / elapsedS <= MAX_WALK_SPEED_MPS;
  }
  return distanceM <= MAX_JUMP_WITHOUT_TIMESTAMP_M;
}

function allWithin(points: readonly TourCoord[], radiusM: number): boolean {
  return points.every((a, i) =>
    points
      .slice(i + 1)
      .every(
        (b) => approxDistanceMetres(a.lat, a.lon, b.lat, b.lon) <= radiusM,
      ),
  );
}

export function createBreadcrumbGate(): BreadcrumbGate {
  let anchor: Anchor | null = null;
  let rejected: TourCoord[] = [];

  function accept(coord: TourCoord, timestamp: number | undefined): true {
    anchor = { coord, timestamp };
    rejected = [];
    return true;
  }

  return {
    consider(coord, fix = {}) {
      if (fix.accuracy !== undefined && fix.accuracy > MAX_FIX_ACCURACY_M) {
        return false; // no evidence either way: leave the streak alone
      }
      if (anchor === null) return accept(coord, fix.timestamp);

      if (!shouldSampleBreadcrumbPoint(anchor.coord, coord)) {
        rejected = []; // back at the anchor: it was right after all
        return false;
      }
      if (isBelievableMove(anchor, coord, fix.timestamp)) {
        return accept(coord, fix.timestamp);
      }

      rejected = [...rejected, coord].slice(-REANCHOR_FIX_COUNT);
      if (
        rejected.length === REANCHOR_FIX_COUNT &&
        allWithin(rejected, REANCHOR_RADIUS_M)
      ) {
        return accept(coord, fix.timestamp);
      }
      return false;
    },

    reanchor(coord, fix = {}) {
      anchor = { coord, timestamp: fix.timestamp };
      rejected = [];
    },
  };
}
