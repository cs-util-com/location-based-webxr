import { describe, expect, it } from 'vitest';
import { createGeoBridge, AnchorNotSetError, InvalidGeoPositionError, InvalidWorldPositionError } from '../src/geo-bridge';
import type { GeoAnchor } from '../src/contracts/geo-bridge';

function expectClose(actual: number, expected: number, tolerance = 1e-9): void {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

function makeAnchor(overrides: Partial<GeoAnchor> = {}): GeoAnchor {
    return {
        position: {
            lon: overrides.position?.lon ?? 10,
            lat: overrides.position?.lat ?? 50,
            alt: overrides.position?.alt ?? 100,
        },
        heading: overrides.heading ?? 0,
    };
}

describe('geo-bridge', () => {
    it('rejects conversions before an anchor is set', () => {
        const bridge = createGeoBridge();

        expect(() => bridge.geoToWorld({ lon: 10, lat: 50, alt: 100 })).toThrow(AnchorNotSetError);
        expect(() => bridge.worldToGeo({ x: 0, y: 0, z: 0 })).toThrow(AnchorNotSetError);
    });

    it('validates anchor coordinates', () => {
        const bridge = createGeoBridge();

        expect(() => bridge.setAnchor(makeAnchor({ position: { lon: 10, lat: 95, alt: 100 } }))).toThrow(InvalidGeoPositionError);
        expect(() => bridge.setAnchor(makeAnchor({ position: { lon: 190, lat: 50, alt: 100 } }))).toThrow(InvalidGeoPositionError);
    });

    it('maps the anchor to the world origin and applies altitude modes', () => {
        const bridge = createGeoBridge();
        const anchor = makeAnchor({ position: { lon: 10, lat: 50, alt: 100 } });
        bridge.setAnchor(anchor);

        expect(bridge.geoToWorld(anchor.position, 'clampToGround')).toEqual({ x: 0, y: 0, z: 0 });
        expect(bridge.geoToWorld({ lon: 10, lat: 50, alt: 130 }, 'clampToGround').y).toBe(0);
        expect(bridge.geoToWorld({ lon: 10, lat: 50, alt: 130 }, 'relativeToGround').y).toBe(130);
        expect(bridge.geoToWorld({ lon: 10, lat: 50, alt: 130 }, 'absolute').y).toBe(30);
    });

    it('keeps north and east directions consistent with heading 0 and 90 degrees', () => {
        const bridge = createGeoBridge();
        bridge.setAnchor(makeAnchor({ position: { lon: 10, lat: 50, alt: 100 }, heading: 0 }));

        const north = bridge.geoToWorld({ lon: 10, lat: 50.001, alt: 100 });
        const east = bridge.geoToWorld({ lon: 10.001, lat: 50, alt: 100 });

        expect(north.x).toBeCloseTo(0, 9);
        expect(north.z).toBeLessThan(0);
        expect(east.x).toBeGreaterThan(0);
        expect(east.z).toBeCloseTo(0, 9);


        bridge.setAnchor(makeAnchor({ position: { lon: 10, lat: 50, alt: 100 }, heading: 90 }));
        const rotatedNorth = bridge.geoToWorld({ lon: 10, lat: 50.001, alt: 100 });
        expect(rotatedNorth.x).toBeLessThan(0);
        expect(rotatedNorth.z).toBeCloseTo(0, 6);
    });

    it('round-trips geo and world positions within tolerance', () => {
        const bridge = createGeoBridge();
        bridge.setAnchor(makeAnchor({ position: { lon: 10, lat: 50, alt: 100 }, heading: 37 }));

        const source = { lon: 10.0025, lat: 50.0012, alt: 146.75 };
        const world = bridge.geoToWorld(source, 'absolute');
        const restored = bridge.worldToGeo(world, 'absolute');

        expectClose(restored.lon, source.lon, 1e-9);
        expectClose(restored.lat, source.lat, 1e-9);
        expectClose(restored.alt, source.alt, 1e-9);
    });

    it('handles antimeridian wrapping in both directions', () => {
        const bridge = createGeoBridge();
        bridge.setAnchor(makeAnchor({ position: { lon: 179.9, lat: 0, alt: 0 } }));

        const world = bridge.geoToWorld({ lon: -179.8, lat: 0, alt: 0 });
        expect(world.x).toBeGreaterThan(0);

        const restored = bridge.worldToGeo(world, 'clampToGround');
        expectClose(restored.lon, -179.8, 1e-8);
        expectClose(restored.lat, 0, 1e-9);
        expect(restored.alt).toBe(0);
    });

    it('formats coordinates stably without scientific notation', () => {
        const bridge = createGeoBridge();

        expect(bridge.formatCoordinate(6.1, '6.100000000')).toBe('6.100000000');
        expect(bridge.formatCoordinate(12.3400000001)).toBe('12.34');
        expect(bridge.formatCoordinate(-0)).toBe('0');
        expect(bridge.formatCoordinate(123456789.25)).toBe('123456789.25');
        expect(bridge.formatCoordinate(0.000000123)).not.toContain('e');
    });

    it('rejects invalid world coordinates', () => {
        const bridge = createGeoBridge();
        bridge.setAnchor(makeAnchor());

        expect(() => bridge.worldToGeo({ x: Number.NaN, y: 0, z: 0 })).toThrow(InvalidWorldPositionError);
        expect(() => bridge.worldToGeo({ x: 0, y: Number.POSITIVE_INFINITY, z: 0 })).toThrow(InvalidWorldPositionError);
    });

    it('changes output when the anchor changes', () => {
        const bridge = createGeoBridge();
        bridge.setAnchor(makeAnchor({ position: { lon: 10, lat: 50, alt: 100 } }));
        const first = bridge.geoToWorld({ lon: 10.001, lat: 50, alt: 100 });

        bridge.setAnchor(makeAnchor({ position: { lon: 10, lat: 51, alt: 100 } }));
        const second = bridge.geoToWorld({ lon: 10.001, lat: 50, alt: 100 });

        expect(first.x).not.toBe(second.x);
        expect(first.z).not.toBe(second.z);
    });
});