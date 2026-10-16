import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
    getArWorldGroup,
    getCamera,
    getScene,
    registerFrameUpdate,
} from 'gps-plus-slam-app-framework/ar';
import { createGpsAnchor, type GpsAnchor } from 'gps-plus-slam-app-framework/visualization';
import { IFeatureView } from '../contracts/document-model';
import { IGeoBridge } from '../contracts/geo-bridge';
import { IAssetProvider } from '../contracts/kmz-container';
import { IRendererFactory } from '../contracts/renderer';
import { FeatureId, GeoPosition } from '../contracts/type';
import { FeatureSceneRegistry } from '../editor/feature-scene-registry';

const LARGE_FEATURE_THRESHOLD = 500;
const DEFAULT_VISIBILITY_RADIUS_METERS = 50;

/**
 * KmlSceneHelper — owns only the KML-specific scene objects:
 * - FeatureSceneRegistry (KML features → THREE.Object3D)
 * - featureGroup (child of arWorldGroup / GPS-world scene)
 * - GPS accuracy ring helper mesh
 * - Desktop OrbitControls (non-AR mode only)
 *
 * Does NOT own: Scene, Renderer, Camera, AnimationLoop.
 * Those are created by initAR() and retrieved via getScene() / getCamera().
 */
export class ArSceneManager {
    /** The group that holds all KML feature objects. Added to arWorldGroup after initAR(). */
    public readonly featureGroup: THREE.Group;
    private readonly overlayGroup: THREE.Group;
    private readonly accuracyRing: THREE.Mesh;
    private readonly registry: FeatureSceneRegistry;
    private readonly featureAnchors = new Map<FeatureId, GpsAnchor>();

    /** OrbitControls for desktop/replay mode. Only active when no XR session is presenting. */
    public controls: OrbitControls | null = null;

    private unregisterFrameUpdate: (() => void) | null = null;
    private largeFileWarningShown = false;
    private trackingQualityGateActive = false;
    private trackingQualityReady = false;

    private currentUserGps: GeoPosition | null = null;
    private visibilityRadiusMeters: number = DEFAULT_VISIBILITY_RADIUS_METERS;
    private features: readonly IFeatureView[] = [];

    public constructor(private readonly rendererFactory: IRendererFactory<THREE.Object3D>) {
        this.featureGroup = new THREE.Group();
        this.featureGroup.name = 'kml-feature-group';

        this.overlayGroup = new THREE.Group();
        this.overlayGroup.name = 'kml-overlay-group';

        this.featureGroup.add(this.overlayGroup);

        // GPS accuracy ring helper
        const ringGeo = new THREE.RingGeometry(0.98, 1.0, 64).rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0x00e5ff,
            transparent: true,
            opacity: 0.35,
            side: THREE.DoubleSide,
        });
        this.accuracyRing = new THREE.Mesh(ringGeo, ringMat);
        this.accuracyRing.position.y = 0.01;
        this.accuracyRing.visible = false;
        this.overlayGroup.add(this.accuracyRing);

        this.registry = new FeatureSceneRegistry(this.featureGroup, rendererFactory);
    }

    /**
     * Attach featureGroup to the framework's arWorldGroup (or scene fallback) and start the per-frame tick.
     * Call this after initAR() succeeds.
     *
     * @param rendererDomElement - Canvas element for OrbitControls (desktop/replay mode).
     */
    public attachToFrameworkScene(rendererDomElement?: HTMLElement): void {
        const arWorldGroup = getArWorldGroup();
        const scene = getScene();
        const targetParent = arWorldGroup ?? scene;

        if (targetParent && this.featureGroup.parent !== targetParent) {
            // Basis transformation: GeoBridge (+X=East, -Z=North) -> GPS-world NUE (+X=North, +Z=East)
            this.featureGroup.rotation.y = -Math.PI / 2;
            targetParent.add(this.featureGroup);
        }

        // Register a per-frame tick for OrbitControls update (desktop mode) & dynamic proximity culling.
        this.unregisterFrameUpdate = registerFrameUpdate((_dt: number, _elapsed: number) => {
            if (this.controls) {
                this.controls.update();
            }
            this.updateProximityVisibility();
        });

        // Create OrbitControls for desktop/replay preview.
        if (rendererDomElement) {
            const cam = getCamera();
            if (cam) {
                this.controls = new OrbitControls(cam, rendererDomElement);
                this.controls.enableDamping = true;
                this.controls.target.set(0, 0, 0);
                this.controls.update();
            }
        }
    }

    /** Hide GPS features until the framework reports a converged AR/GPS fit. */
    public setTrackingQualityGate(active: boolean): void {
        this.trackingQualityGateActive = active;
        this.updateFeatureVisibility();
    }

    public setTrackingQualityState(state: 'warming-up' | 'ar-lost' | 'degraded' | 'ok' | null): void {
        // KML features live in GPS-world scene space, so they can still be
        // inspected while AR tracking is lost. The HUD marks this as provisional.
        this.trackingQualityReady = state !== null;
        this.updateFeatureVisibility();
    }

    /**
     * Detach featureGroup from the GPS-world scene and clean up the frame tick.
     * Call this after endARSession() completes.
     */
    public detachFromFrameworkScene(): void {
        this.featureGroup.rotation.set(0, 0, 0);
        this.featureGroup.removeFromParent();

        if (this.unregisterFrameUpdate) {
            this.unregisterFrameUpdate();
            this.unregisterFrameUpdate = null;
        }

        if (this.controls) {
            this.controls.dispose();
            this.controls = null;
        }
    }

    public updateAccuracyRing(accuracyRadiusMeters: number): void {
        if (accuracyRadiusMeters <= 0 || !Number.isFinite(accuracyRadiusMeters)) {
            this.accuracyRing.visible = false;
            return;
        }
        this.accuracyRing.scale.set(accuracyRadiusMeters, accuracyRadiusMeters, 1);
        this.accuracyRing.visible = true;
    }

    /** Set the proximity visibility radius in meters. */
    public setVisibilityRadius(radiusMeters: number): void {
        if (radiusMeters > 0 && Number.isFinite(radiusMeters)) {
            this.visibilityRadiusMeters = radiusMeters;
            this.updateProximityVisibility();
        }
    }

    public getVisibilityRadius(): number {
        return this.visibilityRadiusMeters;
    }

    /** Feed the latest phone GPS fix to update dynamic marker visibility based on real user location. */
    public updateUserGpsPosition(position: GeoPosition): void {
        this.currentUserGps = position;
        this.updateProximityVisibility();
    }

    /**
     * Reconcile IKmlDocument features to THREE.Object3D.
     * Runs async so the framework AnimationLoop is never blocked.
     * Shows a one-time warning when feature count exceeds LARGE_FEATURE_THRESHOLD.
     *
     * @returns true if the large-file warning was newly triggered (so ArHud can display it).
     */
    public async reconcileFeatures(
        features: readonly IFeatureView[],
        assets: IAssetProvider,
        bridge: IGeoBridge
    ): Promise<{ largeFileWarning: boolean; renderedFeatureCount: number }> {
        const largeFileWarning =
            features.length > LARGE_FEATURE_THRESHOLD && !this.largeFileWarningShown;
        if (largeFileWarning) {
            this.largeFileWarningShown = true;
        }

        this.features = features;

        // In WebXR local-floor space, Y = 0 is the ground plane beneath user's feet.
        // Clamp negative Y altitudes so topological MSL elevation differences (e.g. -38m)
        // do not bury features underground beneath local WebXR floor level Y = 0.
        this.featureGroup.position.set(0, 0, 0);

        const arBridge: IGeoBridge = {
            ...bridge,
            geoToWorld: (pos, mode) => {
                const world = bridge.geoToWorld(pos, mode);
                if (world.y < 0) {
                    return { x: world.x, y: 0, z: world.z };
                }
                return world;
            },
        };

        // Keep all document features in the registry so they can be revealed dynamically
        // when the user approaches, without requiring expensive re-parsing.
        await this.registry.reconcile(features, assets, arBridge);
        this.updateProximityVisibility();

        const renderedFeatureCount = this.getVisibleFeatureCount();
        return { largeFileWarning, renderedFeatureCount };
    }

    public getObjectForFeature(featureId: FeatureId): THREE.Object3D | null {
        return this.registry.getObject(featureId);
    }

    public findFeatureIdFromObject(object: THREE.Object3D): FeatureId | null {
        return this.registry.findFeatureId(object);
    }

    public getPickableObjects(): THREE.Object3D[] {
        if (!this.featureGroup.visible) return [];
        return this.featureGroup.children.filter(
            (c: THREE.Object3D) => c !== this.overlayGroup && c.visible
        );
    }

    public getVisibleFeatureCount(): number {
        return this.featureGroup.children.filter(
            (c: THREE.Object3D) => c !== this.overlayGroup && c.visible
        ).length;
    }

    /** Convert a GPS-world scene point into the local frame used by renderers. */
    public worldToFeatureLocal(worldPosition: THREE.Vector3): THREE.Vector3 {
        this.featureGroup.updateMatrixWorld(true);
        return this.featureGroup.worldToLocal(worldPosition.clone());
    }

    public dispose(): void {
        this.detachFromFrameworkScene();
        for (const anchor of this.featureAnchors.values()) {
            anchor.dispose();
        }
        this.featureAnchors.clear();
        this.registry.dispose();
        this.accuracyRing.geometry.dispose();
        (this.accuracyRing.material as THREE.Material).dispose();
        this.featureGroup.clear();
    }

    /**
     * Dynamically update visibility of features based on proximity to current user position.
     * Uses horizontal distance (ignoring vertical Y) and hysteresis to prevent boundary flicker.
     */
    public updateProximityVisibility(): void {
        if (this.trackingQualityGateActive && !this.trackingQualityReady) {
            this.featureGroup.visible = false;
            return;
        }
        this.featureGroup.visible = true;

        const cam = getCamera();
        const camWorldPos = cam ? new THREE.Vector3() : null;
        if (cam && camWorldPos) {
            cam.getWorldPosition(camWorldPos);
        }

        const childWorldPos = new THREE.Vector3();
        const enterRadius = this.visibilityRadiusMeters;
        const exitRadius = this.visibilityRadiusMeters * 1.15;

        for (const child of this.featureGroup.children) {
            if (child === this.overlayGroup) continue;

            const featureId = child.userData.featureId as FeatureId | undefined;
            const feature = featureId ? this.features.find((f) => f.id === featureId) : null;

            let dist: number | null = null;
            if (feature && this.currentUserGps) {
                dist = featureDistanceMetres(feature, this.currentUserGps);
            } else if (camWorldPos) {
                child.getWorldPosition(childWorldPos);
                // Horizontal distance only (ignoring vertical Y)
                dist = Math.hypot(childWorldPos.x - camWorldPos.x, childWorldPos.z - camWorldPos.z);
            }

            if (dist === null) {
                continue;
            }

            const isCurrentlyVisible = child.visible;
            if (isCurrentlyVisible) {
                child.visible = dist <= exitRadius;
            } else {
                child.visible = dist <= enterRadius;
            }
        }
    }

    /** Backward compatibility alias for updateProximityVisibility. */
    public cullDistantFeatures(): void {
        this.updateProximityVisibility();
    }

    private updateFeatureVisibility(): void {
        this.featureGroup.visible = !this.trackingQualityGateActive || this.trackingQualityReady;
    }
}

/** Great-circle distance used for geo-proximity filtering. */
function distanceMetres(a: GeoPosition, b: GeoPosition): number {
    const radians = Math.PI / 180;
    const dLat = (b.lat - a.lat) * radians;
    const dLon = (b.lon - a.lon) * radians;
    const sinLat = Math.sin(dLat / 2);
    const sinLon = Math.sin(dLon / 2);
    const h = sinLat * sinLat + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * sinLon * sinLon;
    return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function featureDistanceMetres(feature: IFeatureView, point: GeoPosition): number {
    switch (feature.type) {
        case 'marker':
            return distanceMetres(point, feature.position);
        case 'model':
            return distanceMetres(point, feature.location);
        case 'line': {
            if (feature.coordinates.length === 0) return Number.POSITIVE_INFINITY;
            let minDist = Number.POSITIVE_INFINITY;
            for (const coord of feature.coordinates) {
                const d = distanceMetres(point, coord);
                if (d < minDist) minDist = d;
            }
            return minDist;
        }
        case 'ground-overlay': {
            const { north, south, east, west } = feature.latLonBox;
            const corners: GeoPosition[] = [
                { lat: north, lon: east, alt: feature.altitude },
                { lat: north, lon: west, alt: feature.altitude },
                { lat: south, lon: east, alt: feature.altitude },
                { lat: south, lon: west, alt: feature.altitude },
                { lat: (north + south) / 2, lon: (east + west) / 2, alt: feature.altitude },
            ];
            let minDist = Number.POSITIVE_INFINITY;
            for (const c of corners) {
                const d = distanceMetres(point, c);
                if (d < minDist) minDist = d;
            }
            return minDist;
        }
    }
}
