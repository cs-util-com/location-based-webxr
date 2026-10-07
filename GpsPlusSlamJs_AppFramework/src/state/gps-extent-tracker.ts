/**
 * The GPS EXTENT of a session so far: the largest horizontal distance
 * between two of its device fixes, kept up to date as the store's GPS list
 * grows.
 *
 * WHY IT EXISTS. An alignment's yaw is unobservable until the GPS fixes it
 * rests on span a baseline, and its fix COUNT says nothing about that: a
 * phone standing still for a minute has sixty fixes and a yaw that is GPS
 * noise. The extent is the number that does say it. The QR mint reads it
 * twice: as the maturity floor of the alignment a code is composed through
 * (`qr-mint-alignment-tracker.ts`) and as the uncertain-heading marker of a
 * minted level (`qr-mint-level.ts`). Measured on the start-at-code sweep
 * (`ar/qr/qr-anchor-mint.start-at-code.test.ts`, `extent`): heading 41
 * degrees p50 below 5 m of extent, 7.3 at 5-10 m, 3.5 at 10-15 m.
 *
 * Noise is included on purpose (the measurement bins by it): at 5 m GPS
 * accuracy a phone standing still already spans 3-5 m.
 */

import { GPS_POINT_SOURCE_DEVICE, gpsPointSourceOf } from 'gps-plus-slam-js';

/** The fields of a store `GpsPoint` the extent reads. */
export interface GpsExtentPoint {
  readonly id: string;
  readonly timestamp: number;
  /** NUE metres from the session zero (x north, y up, z east). */
  readonly coordinates: readonly [number, number, number];
  readonly source?: string;
}

export interface GpsExtentTracker {
  /**
   * The extent (m) of `points`, folding only the fixes added since the last
   * call. A list that is shorter than the last one, or starts with another
   * fix, is a new list (a store swap or a tracking restart) and is folded
   * from scratch.
   */
  update(points: readonly GpsExtentPoint[]): number;
}

/** The horizontal (north, east) of a fix that counts, or `null`: device
 *  fixes only (a synthetic QR vote is a re-projection of an older code's
 *  anchor, not a place anybody walked, and an unrecognised stamp is never
 *  rounded to device), with finite coordinates. A fix without coordinates
 *  (external data: an older stored shape, a partial record) is skipped. */
function horizontalOf(p: GpsExtentPoint): [number, number] | null {
  if (gpsPointSourceOf(p) !== GPS_POINT_SOURCE_DEVICE) return null;
  const coordinates = p.coordinates as
    GpsExtentPoint['coordinates'] | undefined;
  if (!Array.isArray(coordinates)) return null;
  const n = coordinates[0];
  const e = coordinates[2];
  return Number.isFinite(n) && Number.isFinite(e) ? [n, e] : null;
}

export function createGpsExtentTracker(): GpsExtentTracker {
  /** Horizontal (north, east) of every device fix folded so far. */
  let seen: [number, number][] = [];
  let folded = 0;
  let first: { id: string; timestamp: number } | null = null;
  let extent = 0;

  /** Is `points` the list folded so far, grown or not? */
  function sameList(points: readonly GpsExtentPoint[]): boolean {
    if (points.length < folded) return false;
    if (first === null) return true;
    const head = points[0];
    return head?.id === first.id && head.timestamp === first.timestamp;
  }

  function fold(p: GpsExtentPoint): void {
    const ne = horizontalOf(p);
    if (ne === null) return;
    for (const [sn, se] of seen) {
      const d = Math.hypot(ne[0] - sn, ne[1] - se);
      if (d > extent) extent = d;
    }
    seen.push(ne);
  }

  return {
    update(points) {
      if (!sameList(points)) {
        seen = [];
        folded = 0;
        first = null;
        extent = 0;
      }
      const head = points[0];
      if (first === null && head !== undefined) {
        first = { id: head.id, timestamp: head.timestamp };
      }
      for (let i = folded; i < points.length; i += 1) {
        const p = points[i];
        if (p !== undefined) fold(p);
      }
      folded = points.length;
      return extent;
    },
  };
}
