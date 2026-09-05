/**
 * Shared helper for drawing per-event GPS accuracy circles on a Leaflet map.
 *
 * Lives in the app-framework (D4 of the unified-map plan,
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-unified-trajectory-map-phase3-plan.md)
 * so BOTH the framework's shared map-overlay-draw module AND the recorder
 * app's preview/summary maps can reuse it. The recorder imports it directly
 * (its `ui/accuracy-circles.ts` re-export shim was deleted on 2026-09-03).
 *
 * Future style changes only need to happen in one place.
 */

import L from 'leaflet';

// ============================================================================
// Style constants
// ============================================================================

/**
 * Style for per-event GPS accuracy circles. Radius comes from the GPS event's
 * horizontal accuracy in meters; larger circles mean lower-quality fixes.
 *
 * Circles are drawn **stroke-only** (no fill): Leaflet composites overlapping
 * semi-transparent SVG fills, so N stacked filled circles reach
 * `1 − (1 − fillOpacity)^N` opacity and paint the basemap solid on dense
 * recordings (~90 % at ~18 overlaps with the old 0.12 fill). A fill-free
 * outline never accumulates an opaque interior, so the basemap shows through at
 * ANY overlap density while each accuracy radius stays readable.
 */
/**
 * @deprecated Stroke-only since 2026-06-28 (Finding 1) — accuracy circles no
 * longer render a fill, so this opacity is unused. Retained as an exported
 * constant only to preserve the published API surface; do not pass it to
 * `L.circle`. See `2026-06-28-1822-map-rings-transparency-and-view-direction-user-feedback.md`.
 */
export const ACCURACY_CIRCLE_FILL_OPACITY = 0.12;
export const ACCURACY_CIRCLE_STROKE_OPACITY = 0.5;
export const ACCURACY_CIRCLE_WEIGHT = 1;

// ============================================================================
// Types
// ============================================================================

/**
 * Minimal shape required to render an accuracy circle. Intentionally narrower
 * than `RawGpsSample` so any caller with `lat`/`lng` and an optional
 * `accuracy` (meters) can use this helper without coupling to a specific
 * GPS-sample type.
 */
export interface AccuracyCircleSample {
  readonly lat: number;
  readonly lng: number;
  readonly accuracy?: number;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Draw one stroke-only (un-filled) circle per sample whose `accuracy` is a
 * finite positive number. Samples without a usable accuracy value are skipped so
 * pre-accuracy recordings still render their polyline.
 *
 * Circles are added to `map` immediately. The caller is responsible for
 * draw-order: invoke this BEFORE adding the polyline so the line stays
 * visually on top of the circles.
 *
 * @param map - The Leaflet map to add circles to.
 * @param samples - GPS samples to consider; non-positive / non-finite
 *   `accuracy` values are silently skipped.
 * @param color - CSS color string used for the stroke (no fill is drawn).
 * @returns The created `L.Circle` instances, in the order they were added.
 *   Callers that track layers for cleanup can append these to their list.
 */
export function addAccuracyCircles(
  map: L.Map,
  samples: readonly AccuracyCircleSample[],
  color: string
): L.Circle[] {
  const circles: L.Circle[] = [];
  for (const sample of samples) {
    if (
      typeof sample.accuracy !== 'number' ||
      !Number.isFinite(sample.accuracy) ||
      sample.accuracy <= 0
    ) {
      continue;
    }
    const circle = L.circle([sample.lat, sample.lng], {
      radius: sample.accuracy,
      color,
      weight: ACCURACY_CIRCLE_WEIGHT,
      opacity: ACCURACY_CIRCLE_STROKE_OPACITY,
      // Stroke-only: no fill, so overlapping circles never composite into an
      // opaque interior that hides the basemap (Finding 1).
      fill: false,
    }).addTo(map);
    circles.push(circle);
  }
  return circles;
}
