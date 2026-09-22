/**
 * Tests for the shared OSM base-map module.
 *
 * Why this test matters: Both `preview-map.ts` and `summary-map.ts` rely on
 * these constants/helpers to render a consistent basemap. A regression in
 * the tile URL, attribution, max zoom, or the polyline style tokens would
 * silently affect both views — these tests pin down the contract documented
 * in `map-osm-base.ts.md`.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface TileLayerCall {
  url: unknown;
  options: Record<string, unknown>;
}

let tileLayerCalls: TileLayerCall[] = [];

vi.mock('leaflet', () => {
  return {
    default: {
      tileLayer: vi.fn((url: unknown, options: Record<string, unknown>) => {
        tileLayerCalls.push({ url, options });
        return { addTo: vi.fn().mockReturnThis(), remove: vi.fn() };
      }),
    },
  };
});

import {
  OSM_TILE_ATTRIBUTION,
  OSM_TILE_MAX_ZOOM,
  OSM_TILE_URL,
} from 'gps-plus-slam-app-framework/utils/osm-tiles';

import {
  addOsmTileLayer,
  PATH_POLYLINE_WEIGHT,
  PATH_POLYLINE_OPACITY,
  INITIAL_ZOOM,
  FIT_BOUNDS_PADDING,
} from './map-osm-base';

beforeEach(() => {
  tileLayerCalls = [];
});

describe('addOsmTileLayer', () => {
  it('creates an OSM tile layer with the documented URL, attribution, and maxZoom', () => {
    // Why: OSM tile policy requires the canonical URL pattern and attribution;
    // exceeding maxZoom 19 yields blurry up-scaled tiles.
    addOsmTileLayer({} as L.Map);

    expect(tileLayerCalls).toHaveLength(1);
    const call = tileLayerCalls[0]!;
    expect(call.url).toBe(OSM_TILE_URL);
    expect(call.options.attribution).toBe(OSM_TILE_ATTRIBUTION);
    expect(call.options.maxZoom).toBe(OSM_TILE_MAX_ZOOM);
  });

  it("draws OSM tiles, not some other provider's", () => {
    // Why: guards against an accidental swap to a different tile provider that
    // might have different attribution or terms. The three values moved to the
    // framework on 2026-09-22, so what this now pins is that the RECORDER still
    // reaches for the OSM ones — which is the part that belongs in this file.
    // Their own spelling, and the fact that only one copy of it exists, is held
    // by `tests/repo-config/osm-tile-url-copies.test.js`.
    expect(OSM_TILE_URL).toContain('openstreetmap.org');
    expect(OSM_TILE_ATTRIBUTION).toContain('openstreetmap.org');
    expect(OSM_TILE_MAX_ZOOM).toBe(19);
  });
});

describe('shared path/view style tokens', () => {
  it('keeps polyline weight and opacity at the documented values', () => {
    // Why: both views render multiple polylines; if either constant drifts
    // the visual treatment of raw vs fused paths will diverge between
    // screens. These assertions are the canonical reference.
    expect(PATH_POLYLINE_WEIGHT).toBe(3);
    expect(PATH_POLYLINE_OPACITY).toBe(0.8);
  });

  it('keeps initial zoom and fitBounds padding aligned across views', () => {
    // Why: a different INITIAL_ZOOM would briefly show a different framing
    // before fitBounds runs; a different padding would clip ref-point markers
    // or accuracy circles at the edges of the smaller (preview) map.
    expect(INITIAL_ZOOM).toBe(15);
    expect(FIT_BOUNDS_PADDING).toEqual([20, 20]);
  });
});
