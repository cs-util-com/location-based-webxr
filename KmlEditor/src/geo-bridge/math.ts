import { GeoPosition, WorldPosition } from '../contracts/type';

const DEG_TO_RAD = Math.PI / 180;

export function normalizeLonDelta(deltaLon: number): number {
    return ((((deltaLon + 180) % 360) + 360) % 360) - 180;
}

export function normalizeLongitude(longitude: number): number {
    return normalizeLonDelta(longitude);
}

export function metersPerDegreeLatitude(latitudeRadians: number): number {
    return 111132.954 - 559.822 * Math.cos(2 * latitudeRadians) + 1.175 * Math.cos(4 * latitudeRadians);
}

export function metersPerDegreeLongitude(latitudeRadians: number): number {
    return 111412.84 * Math.cos(latitudeRadians) - 93.5 * Math.cos(3 * latitudeRadians);
}

export function validateGeoPosition(position: GeoPosition): void {
    const { lon, lat, alt } = position;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(alt)) {
        throw new RangeError('Geo position must contain finite numbers');
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        throw new RangeError('Geo position is out of range');
    }
}

export function validateWorldPosition(position: WorldPosition): void {
    const { x, y, z } = position;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new RangeError('World position must contain finite numbers');
    }
}

export function geoToLocalOffset(anchor: GeoPosition, position: GeoPosition): { east: number; north: number } {
    const latitudeRadians = anchor.lat * DEG_TO_RAD;
    const deltaLat = position.lat - anchor.lat;
    const deltaLon = normalizeLonDelta(position.lon - anchor.lon);
    const east = deltaLon * metersPerDegreeLongitude(latitudeRadians);
    const north = deltaLat * metersPerDegreeLatitude(latitudeRadians);
    return { east, north };
}

export function localOffsetToGeo(anchor: GeoPosition, east: number, north: number): GeoPosition {
    const latitudeRadians = anchor.lat * DEG_TO_RAD;
    const lon = normalizeLongitude(anchor.lon + east / metersPerDegreeLongitude(latitudeRadians));
    const lat = anchor.lat + north / metersPerDegreeLatitude(latitudeRadians);
    return { lon, lat, alt: anchor.alt };
}

export function rotateHorizontal(east: number, north: number, angleRadians: number): { x: number; z: number } {
    const cosine = Math.cos(angleRadians);
    const sine = Math.sin(angleRadians);
    const rawZ = -(east * sine + north * cosine);
    return {
        x: east * cosine - north * sine,
        z: rawZ === 0 ? 0 : rawZ,
    };
}

export function inverseRotateHorizontal(x: number, z: number, angleRadians: number): { east: number; north: number } {
    const cosine = Math.cos(angleRadians);
    const sine = Math.sin(angleRadians);
    return {
        east: x * cosine - z * sine,
        north: -x * sine - z * cosine,
    };
}