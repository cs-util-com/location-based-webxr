/**
 * Tests for the shared accuracy-circles helper (app-framework home).
 *
 * Why this test matters: this helper backs the recorder's replay-setup
 * preview map, the session summary map, AND the framework's shared
 * map-overlay-draw module. A regression in the validation rules (e.g. drawing
 * circles for `NaN` / negative accuracy) or the applied style options would
 * silently affect every map. These tests pin down the contract documented in
 * `accuracy-circles.ts.md`.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface CircleCall {
  latLng: unknown;
  options: Record<string, unknown>;
}

let circleCalls: CircleCall[] = [];
let mapStub: object;

vi.mock('leaflet', () => {
  return {
    default: {
      circle: vi.fn((latLng: unknown, options: Record<string, unknown>) => {
        circleCalls.push({ latLng, options });
        return { addTo: vi.fn().mockReturnThis(), remove: vi.fn() };
      }),
    },
  };
});

import {
  addAccuracyCircles,
  ACCURACY_CIRCLE_STROKE_OPACITY,
  ACCURACY_CIRCLE_WEIGHT,
} from './accuracy-circles';

beforeEach(() => {
  circleCalls = [];
  mapStub = {};
});

describe('addAccuracyCircles', () => {
  it('skips samples with missing, non-finite, zero, or negative accuracy', () => {
    const samples = [
      { lat: 50.0, lng: 8.0 }, // missing
      { lat: 50.1, lng: 8.1, accuracy: 0 },
      { lat: 50.2, lng: 8.2, accuracy: -3 },
      { lat: 50.3, lng: 8.3, accuracy: Number.NaN },
      { lat: 50.4, lng: 8.4, accuracy: Number.POSITIVE_INFINITY },
      { lat: 50.5, lng: 8.5, accuracy: 7 },
    ];

    const created = addAccuracyCircles(mapStub as L.Map, samples, '#ffffff');

    expect(circleCalls).toHaveLength(1);
    expect(created).toHaveLength(1);
    expect(circleCalls[0]!.latLng).toEqual([50.5, 8.5]);
    expect(circleCalls[0]!.options.radius).toBe(7);
  });

  // Stroke-only contract (Finding 1, 2026-06-28-map-rings-transparency...).
  // Leaflet composites overlapping semi-transparent SVG fills, so N stacked
  // filled circles reach ~1 - 0.88^N opacity and paint the basemap solid on
  // dense recordings. A fill-free outline never accumulates an opaque interior,
  // so overlaps stay transparent at ANY density. This test fails if anyone
  // re-introduces a filled interior.
  it('draws stroke-only outlines (no fill) so overlaps never obscure the basemap', () => {
    addAccuracyCircles(
      mapStub as L.Map,
      [{ lat: 1, lng: 2, accuracy: 5 }],
      '#abcdef'
    );

    expect(circleCalls).toHaveLength(1);
    const opts = circleCalls[0]!.options;
    // Stroke stays legible and caller-colored.
    expect(opts.color).toBe('#abcdef');
    expect(opts.weight).toBe(ACCURACY_CIRCLE_WEIGHT);
    expect(opts.opacity).toBe(ACCURACY_CIRCLE_STROKE_OPACITY);
    expect(opts.weight as number).toBeGreaterThanOrEqual(1);
    expect(opts.opacity as number).toBeGreaterThan(0);
    // No filled interior — the whole point of the change.
    expect(opts.fill).toBe(false);
  });

  it('preserves input order in the returned circles', () => {
    const created = addAccuracyCircles(
      mapStub as L.Map,
      [
        { lat: 1, lng: 1, accuracy: 1 },
        { lat: 2, lng: 2, accuracy: 2 },
        { lat: 3, lng: 3, accuracy: 3 },
      ],
      '#000000'
    );

    expect(created).toHaveLength(3);
    expect(circleCalls.map((c) => c.options.radius)).toEqual([1, 2, 3]);
  });
});
