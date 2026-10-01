/**
 * The OpenStreetMap raster basemap as a Leaflet layer.
 *
 * Moved from the RecorderApp's `ui/map-osm-base.ts` (2026-10-01) when the
 * summary map's shell moved into the framework (`summary-map-shell.ts`,
 * DEC-H3): the shell draws the basemap, so the one helper that builds the
 * layer has to live where the shell can reach it. The three tile-policy
 * values were already here (`utils/osm-tiles.ts`); this is only the call
 * that applies them.
 *
 * @see osm-tile-layer.ts.md
 */

import L from 'leaflet';

import {
  OSM_TILE_ATTRIBUTION,
  OSM_TILE_MAX_ZOOM,
  OSM_TILE_URL,
} from '../utils/osm-tiles.js';

/**
 * Add the standard OSM tile layer to `map` and return it, so the caller
 * can track it for cleanup. Already on the map when this returns.
 */
export function addOsmTileLayer(map: L.Map): L.TileLayer {
  return L.tileLayer(OSM_TILE_URL, {
    attribution: OSM_TILE_ATTRIBUTION,
    maxZoom: OSM_TILE_MAX_ZOOM,
  }).addTo(map);
}
