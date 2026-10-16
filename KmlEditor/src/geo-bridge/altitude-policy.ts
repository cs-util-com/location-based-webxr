import { AltitudeMode, GeoPosition, WorldPosition } from '../contracts/type';

export function geoAltitudeToWorldY(position: GeoPosition, anchorAltitude: number, altitudeMode: AltitudeMode): number {
    switch (altitudeMode) {
        case 'clampToGround':
            return 0;
        case 'relativeToGround':
            return position.alt;
        case 'absolute':
            return position.alt - anchorAltitude;
        default:
            return position.alt;
    }
}

export function worldYToGeoAltitude(position: WorldPosition, anchorAltitude: number, altitudeMode: AltitudeMode): number {
    switch (altitudeMode) {
        case 'clampToGround':
            return 0;
        case 'relativeToGround':
            return position.y;
        case 'absolute':
            return position.y + anchorAltitude;
        default:
            return position.y;
    }
}