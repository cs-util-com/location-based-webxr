/**
 * Geo Types — Unit Tests
 *
 * Why these tests matter:
 * GpsCoord and RefPointMarker were duplicated across fused-path.ts and summary-map.ts,
 * and { lat: number; lng: number } was inlined in ~7 additional sites. These tests
 * verify the canonical shared definitions exist, are structurally correct, and satisfy
 * the Leaflet-convention (lng, not lon) contract. See code-review Finding #3.
 *
 * @vitest-environment node
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import type { GpsCoord, RefPointMarker } from './geo-types';

// ============================================================================
// GpsCoord — structural contract
// ============================================================================

describe('GpsCoord', () => {
  it('has lat and lng number fields (Leaflet convention)', () => {
    const coord: GpsCoord = { lat: 49.123, lng: 8.456 };
    expect(coord.lat).toBe(49.123);
    expect(coord.lng).toBe(8.456);
  });

  it('is assignable from an object literal with only lat and lng', () => {
    // Ensures no extra required fields were accidentally added
    const coord: GpsCoord = { lat: 0, lng: 0 };
    expectTypeOf(coord).toMatchTypeOf<{ lat: number; lng: number }>();
    expect(coord).toEqual({ lat: 0, lng: 0 });
  });

  it('is assignable to inline { lat: number; lng: number } shape', () => {
    // Proves GpsCoord can replace every inline usage without type errors
    const coord: GpsCoord = { lat: 1, lng: 2 };
    const inline: { lat: number; lng: number } = coord;
    expect(inline.lat).toBe(1);
  });

  it('has readonly properties to prevent accidental mutation', () => {
    // GpsCoord should be structurally equivalent to Readonly<GpsCoord>;
    // this catches regressions if someone removes the readonly modifiers.
    expectTypeOf<GpsCoord>().toEqualTypeOf<Readonly<GpsCoord>>();
    // Runtime: verify the type is usable
    const coord: GpsCoord = { lat: 0, lng: 0 };
    expect(coord).toBeDefined();
  });
});

// ============================================================================
// RefPointMarker — structural contract
// ============================================================================

describe('RefPointMarker', () => {
  it('extends GpsCoord with a name field', () => {
    const marker: RefPointMarker = { lat: 50.0, lng: 7.0, name: 'Gate A' };
    expect(marker.lat).toBe(50.0);
    expect(marker.lng).toBe(7.0);
    expect(marker.name).toBe('Gate A');
  });

  it('is assignable to GpsCoord (sub-type relationship)', () => {
    const marker: RefPointMarker = { lat: 50.0, lng: 7.0, name: 'Gate A' };
    const coord: GpsCoord = marker;
    expectTypeOf(coord).toMatchTypeOf<GpsCoord>();
    expect(coord.lat).toBe(50.0);
  });

  it('is assignable to inline { lat: number; lng: number; name: string }', () => {
    const marker: RefPointMarker = { lat: 50.0, lng: 7.0, name: 'X' };
    const inline: { lat: number; lng: number; name: string } = marker;
    expect(inline.name).toBe('X');
  });

  /**
   * Why this test matters:
   * RefPointMarker inherits readonly lat/lng from GpsCoord; `name` should
   * also be readonly since markers are constructed once and never mutated.
   */
  it('RefPointMarker ≡ Readonly<RefPointMarker>', () => {
    expectTypeOf<RefPointMarker>().toEqualTypeOf<Readonly<RefPointMarker>>();
  });
});
