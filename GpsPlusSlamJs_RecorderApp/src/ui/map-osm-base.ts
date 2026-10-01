/**
 * The recorder's shared path and view style tokens for its Leaflet views
 * (the replay preview map, the map browser, the session summary map).
 *
 * The OSM basemap itself is no longer built here: `addOsmTileLayer` moved to
 * the framework (`gps-plus-slam-app-framework/visualization/osm-tile-layer`,
 * 2026-10-01) together with the summary map's shell (DEC-H3, Tour Viewer
 * authoring plan 2026-09-28-0953 §3.3), which draws the basemap itself. The
 * views import it from there. What stays here is the recorder's LOOK.
 */

import type { PointTuple } from 'leaflet';

// ============================================================================
// Shared path/view style tokens
// ============================================================================

/**
 * Stroke weight (in pixels) for GPS path polylines. Both views use the same
 * value so raw, fused, and snapshot polylines render at a consistent
 * thickness across screens.
 */
export const PATH_POLYLINE_WEIGHT = 3;

/**
 * Stroke opacity for GPS path polylines. Slightly transparent so overlapping
 * paths (raw + fused) remain distinguishable.
 */
export const PATH_POLYLINE_OPACITY = 0.8;

/**
 * Initial zoom level used when centering on the first GPS point before
 * `fitBounds` runs. Picked to roughly show a city block.
 */
export const INITIAL_ZOOM = 15;

/**
 * Padding (in pixels) passed to `map.fitBounds` so markers and accuracy
 * circles aren't clipped at the edges.
 */
export const FIT_BOUNDS_PADDING: PointTuple = [20, 20];
