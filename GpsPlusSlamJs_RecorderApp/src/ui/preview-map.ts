/**
 * Preview Map Component
 *
 * Lightweight Leaflet-based 2D map for the replay setup screen.
 * Shows the raw GPS path as a yellow polyline when a recording session
 * is selected, so the user can see where the recording took place
 * before starting replay.
 *
 * User Feedback Issue #1 (2026-03-23):
 * "On the initial selection screen [...] when I select it I can see
 * on the 2D map the full raw GPS path of the recording."
 */

import L from 'leaflet';
import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import { VIS_COLORS } from 'gps-plus-slam-app-framework/visualization/vis-colors';
import type { GpsPathCoord } from 'gps-plus-slam-app-framework/storage/zip-reader';
import { addAccuracyCircles } from 'gps-plus-slam-app-framework/visualization/accuracy-circles';
import {
  addOsmTileLayer,
  PATH_POLYLINE_WEIGHT,
  PATH_POLYLINE_OPACITY,
  INITIAL_ZOOM,
  FIT_BOUNDS_PADDING,
} from './map-osm-base';

const log = createLogger('PreviewMap');

// ============================================================================
// Types
// ============================================================================

/** Preview map instance with cleanup method. */
export interface PreviewMapInstance {
  /** Remove the Leaflet map and release resources. */
  destroy: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const RAW_GPS_COLOR = VIS_COLORS.RAW_GPS.css;

const RESIZE_DELAY_MS = 200;

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a preview map showing a raw GPS path.
 *
 * @param container - DOM element to render the map into
 * @param gpsPath - Array of GPS coordinates to display as a yellow polyline
 * @returns Map instance with destroy(), or null if creation failed
 */
export function createPreviewMap(
  container: HTMLElement | null,
  gpsPath: GpsPathCoord[]
): PreviewMapInstance | null {
  if (!container) {
    log.warn('Cannot create preview map: container is null');
    return null;
  }

  if (gpsPath.length === 0) {
    log.warn('Cannot create preview map: no GPS path data');
    return null;
  }

  try {
    const firstPoint = gpsPath[0]!;
    const map = L.map(container).setView(
      [firstPoint.lat, firstPoint.lng],
      INITIAL_ZOOM
    );

    addOsmTileLayer(map);

    const latLngs = gpsPath.map((p) => [p.lat, p.lng] as L.LatLngTuple);

    // Per-event accuracy circles, drawn BEFORE the polyline so the line stays
    // visually on top. The framework helper is shared with its map-overlay-draw
    // module (the recorder re-export shim over it was deleted 2026-09-04).
    addAccuracyCircles(map, gpsPath, RAW_GPS_COLOR);

    L.polyline(latLngs, {
      color: RAW_GPS_COLOR,
      weight: PATH_POLYLINE_WEIGHT,
      opacity: PATH_POLYLINE_OPACITY,
    }).addTo(map);

    const bounds = L.latLngBounds([]);
    for (const ll of latLngs) {
      bounds.extend(ll);
    }
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: FIT_BOUNDS_PADDING });
    }

    const resizeTimeoutId = setTimeout(
      () => map.invalidateSize(),
      RESIZE_DELAY_MS
    );

    log.info('Preview map created', { points: gpsPath.length });

    let destroyed = false;

    return {
      destroy(): void {
        if (destroyed) {
          return;
        }
        destroyed = true;
        clearTimeout(resizeTimeoutId);
        map.remove();
        log.info('Preview map destroyed');
      },
    };
  } catch (err) {
    log.error('Failed to create preview map', err);
    return null;
  }
}
