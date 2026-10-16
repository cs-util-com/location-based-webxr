import { AnchorNotSetError, InvalidGeoPositionError, InvalidWorldPositionError } from './errors';
import { formatCoordinate } from './format';
import {
    inverseRotateHorizontal,
    normalizeLonDelta,
    normalizeLongitude,
    rotateHorizontal,
    validateGeoPosition,
    validateWorldPosition,
} from './math';
import { AltitudeMode, GeoPosition, WorldPosition } from '../contracts/type';
import { GeoAnchor, IGeoBridge } from '../contracts/geo-bridge';
import { geoAltitudeToWorldY, worldYToGeoAltitude } from './altitude-policy';
import {
    calcGpsCoords,
    calcRelativeCoordsInMeters,
    validateLicenseKey,
} from 'gps-plus-slam-app-framework/core';
import { COMMUNITY_LICENSE_KEY } from 'gps-plus-slam-app-framework/licensing';

let frameworkCoreActivated = false;

export class GeoBridgeImpl implements IGeoBridge {
    private anchor: GeoAnchor | null = null;

    public setAnchor(anchor: GeoAnchor): void {
        try {
            validateGeoPosition(anchor.position);
        } catch (error) {
            throw new InvalidGeoPositionError(error instanceof Error ? error.message : 'Invalid geo position');
        }

        if (!Number.isFinite(anchor.heading)) {
            throw new InvalidGeoPositionError('Anchor heading must be finite');
        }

        this.anchor = anchor;
    }

    public getAnchor(): GeoAnchor | null {
        return this.anchor;
    }

    public geoToWorld(position: GeoPosition, altitudeMode: AltitudeMode = 'clampToGround'): WorldPosition {
        const anchor = this.requireAnchor();
        activateFrameworkCore();

        try {
            validateGeoPosition(position);
        } catch (error) {
            throw new InvalidGeoPositionError(error instanceof Error ? error.message : 'Invalid geo position');
        }

        const normalizedLongitude = anchor.position.lon + normalizeLonDelta(position.lon - anchor.position.lon);
        const relativeNue = calcRelativeCoordsInMeters(
            { lat: anchor.position.lat, lon: anchor.position.lon },
            { lat: position.lat, lon: normalizedLongitude },
            position.alt,
            anchor.position.alt
        );
        const east = relativeNue[2];
        const north = relativeNue[0];
        const rotated = rotateHorizontal(east, north, (anchor.heading * Math.PI) / 180);

        return {
            x: rotated.x,
            y: geoAltitudeToWorldY(position, anchor.position.alt, altitudeMode),
            z: rotated.z,
        };
    }

    public worldToGeo(position: WorldPosition, altitudeMode: AltitudeMode = 'clampToGround'): GeoPosition {
        const anchor = this.requireAnchor();
        activateFrameworkCore();

        try {
            validateWorldPosition(position);
        } catch (error) {
            throw new InvalidWorldPositionError(error instanceof Error ? error.message : 'Invalid world position');
        }

        const unrotated = inverseRotateHorizontal(position.x, position.z, (anchor.heading * Math.PI) / 180);
        const geo = calcGpsCoords(
            { lat: anchor.position.lat, lon: anchor.position.lon },
            [unrotated.north, 0, unrotated.east]
        );

        return {
            lon: normalizeLongitude(geo.lon),
            lat: geo.lat,
            alt: worldYToGeoAltitude(position, anchor.position.alt, altitudeMode),
        };
    }

    public formatCoordinate(value: number, originalString?: string): string {
        return formatCoordinate(value, originalString);
    }

    private requireAnchor(): GeoAnchor {
        if (!this.anchor) {
            throw new AnchorNotSetError();
        }

        return this.anchor;
    }
}

function activateFrameworkCore(): void {
    if (frameworkCoreActivated) return;
    validateLicenseKey(COMMUNITY_LICENSE_KEY);
    frameworkCoreActivated = true;
}