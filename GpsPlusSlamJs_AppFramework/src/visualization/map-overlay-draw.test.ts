/**
 * Tests for the shared map-overlay-drawing module.
 *
 * Why this test matters: `drawMapData` is the SINGLE drawing routine that both
 * the live/replay 3D overlay and the 2D session-summary map will render
 * through (Phase 3 of the map-system review / unified-trajectory-map plan). It
 * must reproduce the exact layer set the summary map drew by hand — raw
 * polyline + per-event accuracy circles, fused polyline, and the
 * alignment-snapshot polyline — and accumulate a bounds box over every drawn
 * coordinate. Reference-point markers are deliberately NOT drawn here (they are
 * a recorder concept, drawn by `ui/draw-ref-point-markers.ts`). These tests pin
 * that contract so the two renderers cannot silently diverge again (see the
 * user-feedback doc, Findings 1 & 4).
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MapData } from './map-data';

// ---------------------------------------------------------------------------
// Leaflet mock — records every layer-creating call so we can assert the exact
// draw order, styles and coordinates without a real DOM map.
// ---------------------------------------------------------------------------

interface PolylineCall {
  latLngs: unknown;
  options: Record<string, unknown>;
}
interface CircleCall {
  latLng: unknown;
  options: Record<string, unknown>;
}
interface MarkerCall {
  latLng: unknown;
  options: Record<string, unknown>;
  popup?: unknown;
}
interface DivIconCall {
  options: Record<string, unknown>;
}

let polylineCalls: PolylineCall[] = [];
let circleCalls: CircleCall[] = [];
let markerCalls: MarkerCall[] = [];
let divIconCalls: DivIconCall[] = [];
let boundsExtends: unknown[] = [];

vi.mock('leaflet', () => {
  const makeLayer = () => ({
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
  });
  return {
    default: {
      polyline: vi.fn((latLngs: unknown, options: Record<string, unknown>) => {
        polylineCalls.push({ latLngs, options });
        return makeLayer();
      }),
      circle: vi.fn((latLng: unknown, options: Record<string, unknown>) => {
        circleCalls.push({ latLng, options });
        return makeLayer();
      }),
      marker: vi.fn((latLng: unknown, options: Record<string, unknown>) => {
        const layer = {
          ...makeLayer(),
          bindPopup: vi.fn(function (this: unknown, popup: unknown) {
            markerCalls[markerCalls.length - 1]!.popup = popup;
            return this;
          }),
        };
        markerCalls.push({ latLng, options });
        return layer;
      }),
      divIcon: vi.fn((options: Record<string, unknown>) => {
        divIconCalls.push({ options });
        return { _divIcon: true, options };
      }),
      latLngBounds: vi.fn(() => ({
        extend: vi.fn((ll: unknown) => {
          boundsExtends.push(ll);
        }),
        isValid: () => boundsExtends.length > 0,
      })),
    },
  };
});

import {
  drawMapData,
  RAW_GPS_COLOR,
  FUSED_PATH_COLOR,
  ALIGNMENT_SNAPSHOT_COLOR,
  USER_POSITION_COLOR,
} from './map-overlay-draw';

const mapStub = {} as L.Map;

function emptyMapData(overrides: Partial<MapData> = {}): MapData {
  return {
    userPosition: null,
    rawGpsPath: [],
    fusedPath: [],
    alignmentSnapshots: [],
    ...overrides,
  };
}

beforeEach(() => {
  polylineCalls = [];
  circleCalls = [];
  markerCalls = [];
  divIconCalls = [];
  boundsExtends = [];
});

describe('drawMapData', () => {
  it('draws raw accuracy circles BEFORE the raw polyline', () => {
    drawMapData(
      mapStub,
      emptyMapData({
        rawGpsPath: [
          { lat: 1, lng: 2, accuracy: 5 },
          { lat: 3, lng: 4, accuracy: 8 },
        ],
      })
    );

    // Two circles created, then the raw polyline.
    expect(circleCalls).toHaveLength(2);
    expect(polylineCalls).toHaveLength(1);
    expect(circleCalls[0]!.options.color).toBe(RAW_GPS_COLOR);
    expect(polylineCalls[0]!.options.color).toBe(RAW_GPS_COLOR);
    expect(polylineCalls[0]!.latLngs).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('draws the fused polyline in the fused color', () => {
    drawMapData(
      mapStub,
      emptyMapData({
        fusedPath: [
          { lat: 10, lng: 20 },
          { lat: 11, lng: 21 },
        ],
      })
    );

    expect(polylineCalls).toHaveLength(1);
    expect(polylineCalls[0]!.options.color).toBe(FUSED_PATH_COLOR);
    expect(polylineCalls[0]!.latLngs).toEqual([
      [10, 20],
      [11, 21],
    ]);
  });

  it('draws a labelled marker per reference point', () => {
    // Reference-point markers are NO LONGER drawn by the shared module — they
    // are a recorder concept owned by `ui/draw-ref-point-markers.ts`. Even when
    // a caller (incorrectly) leaves ref data out of MapData, drawMapData must
    // not create any marker for it. Pin that the shared module is
    // ref-point-agnostic.
    drawMapData(
      mapStub,
      emptyMapData({
        fusedPath: [
          { lat: 5, lng: 6 },
          { lat: 7, lng: 8 },
        ],
      })
    );

    // Only the fused polyline is drawn; no markers, no div icons.
    expect(markerCalls).toHaveLength(0);
    expect(divIconCalls).toHaveLength(0);
  });

  it('draws the alignment-snapshot polyline in the snapshot color', () => {
    drawMapData(
      mapStub,
      emptyMapData({
        alignmentSnapshots: [
          { lat: 1, lng: 1 },
          { lat: 2, lng: 2 },
        ],
      })
    );

    expect(polylineCalls).toHaveLength(1);
    expect(polylineCalls[0]!.options.color).toBe(ALIGNMENT_SNAPSHOT_COLOR);
  });

  it('accumulates bounds over every drawn coordinate', () => {
    const result = drawMapData(
      mapStub,
      emptyMapData({
        rawGpsPath: [{ lat: 1, lng: 2 }],
        fusedPath: [{ lat: 3, lng: 4 }],
        alignmentSnapshots: [{ lat: 7, lng: 8 }],
      })
    );

    expect(boundsExtends).toEqual([
      [1, 2],
      [3, 4],
      [7, 8],
    ]);
    expect(result.bounds.isValid()).toBe(true);
  });

  it('returns every created layer for later cleanup', () => {
    const result = drawMapData(
      mapStub,
      emptyMapData({
        rawGpsPath: [{ lat: 1, lng: 2, accuracy: 5 }],
        fusedPath: [{ lat: 3, lng: 4 }],
        alignmentSnapshots: [{ lat: 7, lng: 8 }],
      })
    );

    // 1 circle + raw line + fused line + snapshot line = 4
    expect(result.layers).toHaveLength(4);
  });

  it('does not draw a user marker by default', () => {
    drawMapData(mapStub, emptyMapData({ userPosition: { lat: 1, lng: 2 } }));
    expect(markerCalls).toHaveLength(0);
  });

  it('draws a user marker when showUserPosition is set and a position exists', () => {
    drawMapData(mapStub, emptyMapData({ userPosition: { lat: 9, lng: 10 } }), {
      showUserPosition: true,
    });

    expect(markerCalls).toHaveLength(1);
    expect(markerCalls[0]!.latLng).toEqual([9, 10]);
    expect(String(divIconCalls[0]!.options.html)).toContain(
      USER_POSITION_COLOR
    );
  });

  // Finding 2 (2026-06-28): the live/replay overlay draws a thin blue
  // view-direction line from the user dot, rotated to the absolute (true-north)
  // heading. The line lives inside the user-position divIcon so it stays a fixed
  // pixel length at any zoom. When the heading is undefined we draw the dot alone.
  describe('user heading line (Finding 2)', () => {
    it('draws a heading line rotated to userHeadingDeg inside the user divIcon', () => {
      drawMapData(
        mapStub,
        emptyMapData({ userPosition: { lat: 9, lng: 10 }, userHeadingDeg: 90 }),
        { showUserPosition: true }
      );

      expect(markerCalls).toHaveLength(1);
      const html = String(divIconCalls[0]!.options.html);
      expect(html).toContain('map-overlay-user-heading');
      expect(html).toContain('rotate(90');
    });

    it('draws the dot only (no heading line) when userHeadingDeg is null', () => {
      drawMapData(
        mapStub,
        emptyMapData({
          userPosition: { lat: 9, lng: 10 },
          userHeadingDeg: null,
        }),
        { showUserPosition: true }
      );

      expect(markerCalls).toHaveLength(1);
      const html = String(divIconCalls[0]!.options.html);
      expect(html).not.toContain('map-overlay-user-heading');
      // The dot itself is still present.
      expect(html).toContain(USER_POSITION_COLOR);
    });

    it('draws the dot only when userHeadingDeg is absent (legacy MapData literal)', () => {
      drawMapData(
        mapStub,
        emptyMapData({ userPosition: { lat: 9, lng: 10 } }),
        { showUserPosition: true }
      );
      const html = String(divIconCalls[0]!.options.html);
      expect(html).not.toContain('map-overlay-user-heading');
    });
  });

  it('skips empty slices without creating layers', () => {
    const result = drawMapData(mapStub, emptyMapData());
    expect(polylineCalls).toHaveLength(0);
    expect(circleCalls).toHaveLength(0);
    expect(markerCalls).toHaveLength(0);
    expect(result.layers).toHaveLength(0);
    expect(result.bounds.isValid()).toBe(false);
  });
});
