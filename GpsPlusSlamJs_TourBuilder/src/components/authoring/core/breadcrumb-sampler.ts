/**
 * Breadcrumb distance-gated sampling for component 10 (TASK.md §2.3).
 * Recording is continuous and always-on (plan AU3) — every live GPS fix is
 * checked here; only a fix far enough from the last *sampled* point is worth
 * recording, so a standing-still author or a jittering GPS doesn't spam the
 * trail with points a meter apart.
 *
 * Reuses the framework's own tested `approxDistanceMetres` rather than
 * writing new haversine/equirectangular math (plan AU2) — this is a
 * legitimate authoring-time exception to "no geo math outside proximity/scene
 * logic" (CLAUDE.md): nothing has been anchored yet, a raw GPS fix *is* the
 * data being captured.
 *
 * @see plans/2026-08-07-authoring-plan.md (decisions AU2-AU4)
 */

import { approxDistanceMetres } from "gps-plus-slam-app-framework/geo";

import type { TourCoord } from "../../../store/types.js";

/** GPS is typically 1-2 m off (TASK.md §2.5.2); 3 m filters that jitter while
 *  keeping the trail's shape at walking pace. Tunable. */
export const MIN_BREADCRUMB_DISTANCE_M = 3;

/** True when `next` is far enough from the last *sampled* point to record.
 *  `last === null` (no points sampled yet) always samples. */
export function shouldSampleBreadcrumbPoint(
  last: TourCoord | null,
  next: TourCoord,
  minDistanceM: number = MIN_BREADCRUMB_DISTANCE_M,
): boolean {
  if (last === null) return true;
  return (
    approxDistanceMetres(last.lat, last.lon, next.lat, next.lon) >= minDistanceM
  );
}
