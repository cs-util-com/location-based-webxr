/**
 * Tests for the recorder's shared map style tokens.
 *
 * Why this test matters: the preview map, the map browser and the summary
 * map rely on these constants for a consistent look; a drift would
 * silently affect all of them. The basemap layer itself moved to the
 * framework (`visualization/osm-tile-layer.ts`, 2026-10-01) and its test
 * moved with it.
 */

import { describe, it, expect } from 'vitest';

import {
  PATH_POLYLINE_WEIGHT,
  PATH_POLYLINE_OPACITY,
  INITIAL_ZOOM,
  FIT_BOUNDS_PADDING,
} from './map-osm-base';

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
