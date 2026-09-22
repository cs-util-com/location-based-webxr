/**
 * Shared OSM base-map setup and path style tokens for Leaflet map views.
 *
 * Both `preview-map.ts` (replay setup screen) and `summary-map.ts` (session
 * summary panel) render an OpenStreetMap basemap with the same tile URL,
 * attribution, and zoom limit, and draw GPS paths with the same line weight
 * and opacity. Centralising those values here keeps the two views visually
 * consistent and avoids accidental drift on future tweaks.
 *
 * Scope intentionally narrow: only the truly identical pieces live here.
 * View-specific concerns (fullscreen toggle, multi-path layering, ref-point
 * markers, resize delays) stay in their respective files.
 */

import L from 'leaflet';
import {
  OSM_TILE_ATTRIBUTION,
  OSM_TILE_MAX_ZOOM,
  OSM_TILE_URL,
} from 'gps-plus-slam-app-framework/utils/osm-tiles';

// ============================================================================
// OpenStreetMap basemap
// ============================================================================

/**
 * Add the standard OSM tile layer to `map` and return it so the caller can
 * track it for cleanup. The caller decides ordering relative to other layers.
 *
 * THE THREE BASEMAP VALUES MOVED TO THE FRAMEWORK (2026-09-22). They were
 * declared here, again inline in `OsmDemo/src/map-view.ts`, and a third time
 * as an option default in the framework's `LeafletMapOverlay` — and the copy
 * here still used `https://{s}.tile.openstreetmap.org/…`, the subdomain
 * sharding HTTP/2 made pointless and the OSM tile usage policy discourages.
 * Three copies, two behaviours, nothing able to see it: every map renders
 * either way. `tests/repo-config/osm-tile-url-copies.test.js` now holds it to
 * one.
 */
export function addOsmTileLayer(map: L.Map): L.TileLayer {
  return L.tileLayer(OSM_TILE_URL, {
    attribution: OSM_TILE_ATTRIBUTION,
    maxZoom: OSM_TILE_MAX_ZOOM,
  }).addTo(map);
}

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
export const FIT_BOUNDS_PADDING: L.PointTuple = [20, 20];
