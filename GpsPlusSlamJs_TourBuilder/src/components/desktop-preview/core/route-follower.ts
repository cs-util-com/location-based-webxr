/**
 * Autopilot for the desktop preview: walks the tour's breadcrumb polyline at a
 * constant pace so a tour can be demonstrated without touching the keyboard.
 *
 * Same frame and same pose type as `walk-simulator` (GPS-world NUE metres,
 * heading clockwise from north), so the viewport can swap between manual and
 * automatic locomotion without either side knowing about the other.
 *
 * Two properties matter for real breadcrumbs: leftover distance carries across
 * a vertex (otherwise the pace stutters at every corner of a dense recording),
 * and zero-length segments — which a recording made while standing still is
 * full of — are skipped rather than divided by.
 */

import type { WalkPose } from "./walk-simulator.js";

/** A point on the ground plane, in the same NUE metres as `WalkPose`. */
interface RoutePoint {
  readonly x: number;
  readonly z: number;
}

export interface RouteFollowerOptions {
  readonly path: readonly RoutePoint[];
  readonly speedMps?: number;
}

export interface RouteFollower {
  /** Advance `dt` seconds along the route and return the new pose. */
  advance(dt: number): WalkPose;
  pose(): WalkPose;
  /** True once the walker has reached the last point of the route. */
  isFinished(): boolean;
}

const ORIGIN: WalkPose = { x: 0, z: 0, headingRad: 0 };

export function createRouteFollower(
  options: RouteFollowerOptions,
): RouteFollower {
  const path = options.path;
  const speed = options.speedMps ?? 1.4;

  /** Index of the segment being walked, and how far along it we are. */
  let segment = 0;
  let offset = 0;
  let current: WalkPose =
    path.length === 0
      ? ORIGIN
      : { x: path[0]!.x, z: path[0]!.z, headingRad: 0 };

  const finished = (): boolean => segment >= path.length - 1;

  function step(distance: number): WalkPose {
    let remaining = distance;
    while (remaining > 0 && !finished()) {
      const from = path[segment]!;
      const to = path[segment + 1]!;
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const length = Math.hypot(dx, dz);
      if (length === 0) {
        segment += 1;
        continue;
      }
      const left = length - offset;
      if (remaining < left) {
        offset += remaining;
        remaining = 0;
      } else {
        remaining -= left;
        offset = length;
      }
      const t = offset / length;
      current = {
        x: from.x + dx * t,
        z: from.z + dz * t,
        headingRad: Math.atan2(dz, dx),
      };
      if (offset >= length) {
        segment += 1;
        offset = 0;
      }
    }
    return current;
  }

  return {
    advance(dt) {
      return step(speed * dt);
    },
    pose() {
      return current;
    },
    isFinished: finished,
  };
}
