/**
 * The OSM basemap layer (moved from the RecorderApp's `map-osm-base.ts`,
 * 2026-10-01, with the summary map's shell).
 *
 * Why this test matters: every map view that draws the OSM basemap - the
 * Recorder's preview, map browser and summary, and the Tour Viewer's
 * summary - goes through this one call. The OSM tile usage policy requires
 * the attribution, and zooming past the tiles' ceiling gives blurry
 * up-scaled tiles; a regression here would reach all of them at once.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type L from 'leaflet';

const calls = vi.hoisted(() => ({
  tileLayers: [] as { url: unknown; options: Record<string, unknown> }[],
  addedTo: [] as unknown[],
}));

vi.mock('leaflet', () => ({
  default: {
    tileLayer: vi.fn((url: unknown, options: Record<string, unknown>) => {
      calls.tileLayers.push({ url, options });
      const layer = {
        addTo: vi.fn((map: unknown) => {
          calls.addedTo.push(map);
          return layer;
        }),
        remove: vi.fn(),
      };
      return layer;
    }),
  },
}));

import {
  OSM_TILE_ATTRIBUTION,
  OSM_TILE_MAX_ZOOM,
  OSM_TILE_URL,
} from '../utils/osm-tiles.js';
import { addOsmTileLayer } from './osm-tile-layer.js';

beforeEach(() => {
  calls.tileLayers.length = 0;
  calls.addedTo.length = 0;
});

describe('addOsmTileLayer', () => {
  it('adds one OSM layer with the policy URL, attribution and zoom ceiling', () => {
    const map = {} as L.Map;
    const layer = addOsmTileLayer(map);
    expect(calls.tileLayers).toEqual([
      {
        url: OSM_TILE_URL,
        options: {
          attribution: OSM_TILE_ATTRIBUTION,
          maxZoom: OSM_TILE_MAX_ZOOM,
        },
      },
    ]);
    // Already on the map, and handed back for the caller's cleanup.
    expect(calls.addedTo).toEqual([map]);
    expect(layer).toBeDefined();
  });
});
