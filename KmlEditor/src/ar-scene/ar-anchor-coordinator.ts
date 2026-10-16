import { AltitudeMode, GeoPosition, WorldPosition } from '../contracts/type';
import { IGeoBridge } from '../contracts/geo-bridge';
import { IEditorStore } from '../contracts/store';

const MAX_GPS_ACCURACY_METERS = 15;

/**
 * ArAnchorCoordinator — fuses GPS + heading into the IGeoBridge anchor.
 *
 * CRITICAL ARCHITECTURE RULE:
 * `arWorldGroup.matrix` is driven by `enableArWorldGroupAlignment` from the framework,
 * which ALREADY applies device orientation / compass alignment to arWorldGroup.
 * Therefore, IGeoBridge anchor heading is kept at 0 to avoid applying compass rotation TWICE.
 */
export class ArAnchorCoordinator {
    public onAnchorChange?: (anchor: { position: GeoPosition; heading: number }) => void;

    private isLocked = false;
    private hasSessionAnchor = false;
    private bufferedGps: { position: GeoPosition; heading: number; accuracy: number } | null = null;
    private groundY = 0; // Local WebXR floor level Y

    private sessionRunCount = 0;

    public constructor(
        private geoBridge: IGeoBridge,
        private readonly store: IEditorStore
    ) {}

    /**
     * Called by the framework GPS callback (onGpsPosition from EnableGpsArController).
     */
    public updateGps(latitude: number, longitude: number, altitude: number, heading = 0, accuracy = 5): void {
        this.store.setDeviceState({
            gpsPosition: { latitude, longitude, altitude },
            heading,
            accuracy,
        });

        if (accuracy > MAX_GPS_ACCURACY_METERS) {
            console.warn(`[AR Diagnostic] Ignored low-accuracy GPS fix (${accuracy.toFixed(1)}m > ${MAX_GPS_ACCURACY_METERS}m threshold)`);
            return;
        }

        const newPosition: GeoPosition = { lon: longitude, lat: latitude, alt: altitude };

        if (this.isLocked) {
            this.bufferedGps = { position: newPosition, heading, accuracy };
            return;
        }

        if (!this.hasSessionAnchor) {
            console.log(`[AR Diagnostic] Session #${this.sessionRunCount} — Setting initial anchor to (${latitude.toFixed(6)}, ${longitude.toFixed(6)})`);
            const anchor = { position: newPosition, heading: 0 };
            this.geoBridge.setAnchor(anchor);
            this.hasSessionAnchor = true;
            this.onAnchorChange?.(anchor);
        }
    }

    /**
     * Called by the framework orientation callback (onOrientation from EnableGpsArController).
     */
    public updateHeading(alpha: number): void {
        if (alpha === null || Number.isNaN(alpha)) return;
        this.store.setDeviceState({ heading: alpha });
    }

    public setAnchorLock(locked: boolean): void {
        this.isLocked = locked;
        if (!locked) {
            // The session anchor remains fixed after its first valid GPS fix.
            // Applying buffered fixes would make the rendered world jump with GPS jitter.
            this.bufferedGps = null;
        }
    }

    public isAnchorLocked(): boolean {
        return this.isLocked;
    }

    public setGroundY(y: number): void {
        this.groundY = y;
    }

    public getGroundY(): number {
        return this.groundY;
    }

    /**
     * Resolves the 3D local Y-coordinate for features based on KML altitudeMode.
     */
    public applyAltitudePolicy(position: GeoPosition, mode: AltitudeMode = 'clampToGround'): WorldPosition {
        const worldPos = this.geoBridge.geoToWorld(position, mode);

        switch (mode) {
            case 'clampToGround':
                return { x: worldPos.x, y: this.groundY, z: worldPos.z };
            case 'relativeToGround':
                return { x: worldPos.x, y: this.groundY + position.alt, z: worldPos.z };
            case 'absolute': {
                const anchor = this.geoBridge.getAnchor();
                const anchorAlt = anchor ? anchor.position.alt : 0;
                return { x: worldPos.x, y: position.alt - anchorAlt, z: worldPos.z };
            }
            default:
                return worldPos;
        }
    }

    public resetAnchor(position: GeoPosition, heading = 0): void {
        const anchor = { position, heading: 0 };
        this.geoBridge.setAnchor(anchor);
        this.hasSessionAnchor = true;
        this.onAnchorChange?.(anchor);
        this.bufferedGps = null;
    }

    /** Replace the short-lived projection used by the next AR session. */
    public setGeoBridge(geoBridge: IGeoBridge): void {
        this.geoBridge = geoBridge;
        this.hasSessionAnchor = false;
        this.bufferedGps = null;
    }

    public hasAnchorForSession(): boolean {
        return this.hasSessionAnchor;
    }

    /**
     * Resets session state before starting a new AR session and logs diagnostic info.
     */
    public resetSessionState(): void {
        this.sessionRunCount++;
        this.bufferedGps = null;
        this.hasSessionAnchor = false;

        const currentAnchor = this.geoBridge.getAnchor();
        console.log(`[AR Diagnostic] --- Starting AR Session #${this.sessionRunCount} ---`);
        if (currentAnchor) {
            console.log(`[AR Diagnostic] Reference Anchor: lat=${currentAnchor.position.lat.toFixed(6)}, lon=${currentAnchor.position.lon.toFixed(6)}`);
        } else {
            console.log(`[AR Diagnostic] No reference anchor set yet.`);
        }
    }

    public getDiagnosticInfo(): string {
        const anchor = this.geoBridge.getAnchor();
        if (!anchor) return 'Anchor: Unset';
        const heading = this.store.getState().device.heading ?? 0;
        return `Run #${this.sessionRunCount} | Anchor: ${anchor.position.lat.toFixed(4)}, ${anchor.position.lon.toFixed(4)} | Compass: ${heading.toFixed(0)}°`;
    }

    public getDiagnosticSnapshot(): { session: number; heading: number; anchor: GeoPosition | null } {
        const anchor = this.geoBridge.getAnchor();
        return {
            session: this.sessionRunCount,
            heading: this.store.getState().device.heading ?? 0,
            anchor: anchor ? { ...anchor.position } : null,
        };
    }

    public dispose(): void {
        this.bufferedGps = null;
    }
}
