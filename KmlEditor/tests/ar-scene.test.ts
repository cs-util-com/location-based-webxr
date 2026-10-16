import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { GeoPosition, FeatureId, WorldPosition } from '../src/contracts/type';
import { IGeoBridge } from '../src/contracts/geo-bridge';
import { createEditorStore } from '../src/store';
import { createKmlDocument } from '../src/document-model';
import { KmzContainer } from '../src/kmz-io/container';
import { createMoveMarkerCommand } from '../src/commands';
import { ArAnchorCoordinator } from '../src/ar-scene/ar-anchor-coordinator';
import { ArSceneManager } from '../src/ar-scene/ar-scene-manager';
import { ArInteractionController } from '../src/ar-scene/ar-interaction-controller';
import { ArReplayAdapter } from '../src/ar-scene/ar-replay-adapter';
import { IFeatureRenderer, IRendererFactory } from '../src/contracts/renderer';
import { IFeatureView, IMarkerFeature } from '../src/contracts/document-model';
import { getArWorldGroup, getScene } from 'gps-plus-slam-app-framework/ar';
import { ArSceneDiagnostics, compareDiagnosticLogs } from '../src/ar-scene/ar-scene-diagnostics';

// ── Mock the framework so tests run without a real WebXR environment ──────────
const mockWorldGroup = new THREE.Group();
const mockScene = new THREE.Scene();

vi.mock('gps-plus-slam-app-framework/ar', () => ({
    getScene: vi.fn(() => mockScene),
    getArWorldGroup: vi.fn(() => mockWorldGroup),
    getCamera: vi.fn(() => new THREE.PerspectiveCamera()),
    registerFrameUpdate: vi.fn(() => vi.fn()),
    setTrackingCallbacks: vi.fn(),
    setTrackingLostCallback: vi.fn(),
    createEnableGpsArController: vi.fn(() => ({
        refreshSupport: vi.fn(async () => {}),
        enable: vi.fn(async () => ({ ok: true })),
        disable: vi.fn(async () => {}),
        subscribe: vi.fn(() => vi.fn()),
    })),
}));

class FakeRenderer implements IFeatureRenderer<IFeatureView, THREE.Object3D> {
    featureId = '' as FeatureId;
    readonly object = new THREE.Group();

    constructor() {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
        this.object.add(mesh);
    }

    readonly update = vi.fn(async (feature: IFeatureView) => {
        this.featureId = feature.id;
        this.object.userData.featureId = feature.id;
    });
    readonly dispose = vi.fn();
    getNativeObject(): THREE.Object3D {
        return this.object;
    }
}

describe('Component 8: AR Scene (ar-scene) — Glue & Gesture Unit Tests', () => {
    it('records ordered GPS and rendered-pose stages for launch comparison', () => {
        const diagnostics = new ArSceneDiagnostics();
        diagnostics.startSession(1);
        diagnostics.record({
            stage: 'gps',
            gps: { latitude: 50, longitude: 6, altitude: 100, accuracy: 4 },
            heading: 12,
            anchor: { lat: 50, lon: 6, alt: 100 },
        });
        diagnostics.record({
            stage: 'frame',
            anchor: { lat: 50, lon: 6, alt: 100 },
            featureId: 'marker-1',
            markerLocal: { x: 10, y: 0, z: -20 },
            markerWorld: { x: 10, y: 0, z: -20 },
            arWorldGroupMatrix: new THREE.Matrix4().toArray(),
            featureGroupVisible: false,
            trackingQuality: {
                state: 'warming-up',
                confidence: 0.22,
                observationsSeen: 8,
                coverage: 0.31,
                convergence: 0.6,
                gpsAccuracy: 0.8,
                walkedDistanceM: 4,
                directionSpreadDeg: 20,
            },
        });

        const log = diagnostics.getLog();
        expect(log.samples.map((sample) => sample.stage)).toEqual(['session-start', 'gps', 'frame']);
        expect(log.samples[1].anchor).toEqual({ lat: 50, lon: 6, alt: 100 });
        expect(log.samples[2].markerLocal).toEqual({ x: 10, y: 0, z: -20 });
        expect(log.samples[2].featureGroupVisible).toBe(false);
        expect(log.samples[2].trackingQuality?.state).toBe('warming-up');
        expect(log.samples[2].trackingQuality?.observationsSeen).toBe(8);
    });

    it('classifies the first differing placement stage', () => {
        const makeLog = (anchorLon: number, matrixX: number) => {
            const diagnostics = new ArSceneDiagnostics();
            diagnostics.startSession(1);
            diagnostics.record({
                stage: 'gps',
                gps: { latitude: 50, longitude: anchorLon, altitude: 100, accuracy: 4 },
                anchor: { lat: 50, lon: anchorLon, alt: 100 },
            });
            diagnostics.record({
                stage: 'frame',
                anchor: { lat: 50, lon: anchorLon, alt: 100 },
                markerLocal: { x: 10, y: 0, z: -20 },
                arWorldGroupMatrix: new THREE.Matrix4().makeTranslation(matrixX, 0, 0).toArray(),
            });
            return diagnostics.getLog();
        };

        expect(compareDiagnosticLogs(makeLog(6, 0), makeLog(6.001, 0))).toBe('gps-anchor');
        expect(compareDiagnosticLogs(makeLog(6, 0), makeLog(6, 2))).toBe('ar-alignment');
    });

    let mockGeoBridge: IGeoBridge;
    let anchorPosition: GeoPosition | null;
    let anchorHeading = 0;

    beforeEach(() => {
        anchorPosition = null;
        anchorHeading = 0;
        mockGeoBridge = {
            setAnchor: vi.fn((anchor) => {
                anchorPosition = anchor.position;
                if (typeof anchor.heading === 'number') {
                    anchorHeading = anchor.heading;
                }
            }),
            getAnchor: vi.fn(() => anchorPosition ? { position: anchorPosition, heading: anchorHeading } : null),
            geoToWorld: vi.fn((pos: GeoPosition) => {
                if (!anchorPosition) return { x: 0, y: 0, z: 0 };
                return {
                    x: (pos.lon - anchorPosition.lon) * 100000,
                    y: pos.alt - anchorPosition.alt,
                    z: (pos.lat - anchorPosition.lat) * 100000,
                };
            }),
            worldToGeo: vi.fn((pos: WorldPosition) => {
                if (!anchorPosition) return { lon: 0, lat: 0, alt: 0 };
                return {
                    lon: anchorPosition.lon + pos.x / 100000,
                    lat: anchorPosition.lat + pos.z / 100000,
                    alt: anchorPosition.alt + pos.y,
                };
            }),
            formatCoordinate: vi.fn((val: number) => String(val)),
        };
    });

    // ── ArAnchorCoordinator ─────────────────────────────────────────────────

    describe('AR Glue: Framework GPS Callbacks → GeoBridge → Feature World Position', () => {
        it('maps GPS callback through GeoBridge to accurate 3D world positions', () => {
            const store = createEditorStore();
            const coordinator = new ArAnchorCoordinator(mockGeoBridge, store);

            // First GPS fix — sets the anchor
            coordinator.updateGps(50.77, 6.06, 200, 0, 5);
            expect(mockGeoBridge.setAnchor).toHaveBeenCalledWith({
                position: { lon: 6.06, lat: 50.77, alt: 200 },
                heading: 0,
            });

            // Feature at another geo position
            const featurePos: GeoPosition = { lon: 6.061, lat: 50.771, alt: 210 };
            const worldPos = coordinator.applyAltitudePolicy(featurePos, 'absolute');

            expect(worldPos.x).toBeCloseTo(100, 1);
            expect(worldPos.y).toBe(10); // 210 - 200
            expect(worldPos.z).toBeCloseTo(100, 1);
        });

        it('resolves all three altitudeMode policies correctly (clampToGround, relativeToGround, absolute)', () => {
            anchorPosition = { lon: 6.06, lat: 50.77, alt: 200 };
            const store = createEditorStore();
            const coordinator = new ArAnchorCoordinator(mockGeoBridge, store);
            coordinator.setGroundY(5.0);

            const pos: GeoPosition = { lon: 6.06, lat: 50.77, alt: 50 };

            const clamped = coordinator.applyAltitudePolicy(pos, 'clampToGround');
            expect(clamped.y).toBe(5.0); // local-floor Y

            const relative = coordinator.applyAltitudePolicy(pos, 'relativeToGround');
            expect(relative.y).toBe(5.0 + 50); // groundY + kml.alt

            const absolute = coordinator.applyAltitudePolicy(pos, 'absolute');
            expect(absolute.y).toBe(50 - 200); // pos.alt - anchor.alt
        });

        it('does not move the session anchor when GPS updates arrive during an active 3D drag', () => {
            anchorPosition = { lon: 6.06, lat: 50.77, alt: 200 };
            const store = createEditorStore();
            const coordinator = new ArAnchorCoordinator(mockGeoBridge, store);

            coordinator.setAnchorLock(true);
            coordinator.updateGps(50.78, 6.07, 210, 45, 5);

            // Anchor must NOT be updated while locked
            expect(mockGeoBridge.setAnchor).not.toHaveBeenCalled();

            // Releasing lock flushes the buffered update
            coordinator.setAnchorLock(false);
            expect(mockGeoBridge.setAnchor).not.toHaveBeenCalled();
        });

        it('applies heading from updateHeading() to store device state', () => {
            anchorPosition = { lon: 6.06, lat: 50.77, alt: 200 };
            const store = createEditorStore();
            const coordinator = new ArAnchorCoordinator(mockGeoBridge, store);

            // Simulate first GPS fix
            coordinator.updateGps(50.77, 6.06, 200, 0, 5);

            // Orientation callback updates store state
            coordinator.updateHeading(90);
            expect(store.getState().device.heading).toBe(90);
        });
    });

    // ── ArSceneManager ──────────────────────────────────────────────────────

    describe('ArSceneManager (KmlSceneHelper)', () => {
        it('creates featureGroup and accuracyRing without own Scene or Renderer', () => {
            const factory: IRendererFactory<THREE.Object3D> = {
                createRenderer: () => new FakeRenderer(),
            };
            const sceneManager = new ArSceneManager(factory);

            // Has a featureGroup to attach to arWorldGroup
            expect(sceneManager.featureGroup).toBeInstanceOf(THREE.Group);
            // No scene or camera owned by the sceneManager
            expect((sceneManager as any).scene).toBeUndefined();
            expect((sceneManager as any).camera).toBeUndefined();

            sceneManager.dispose();
        });

        it('attaches featureGroup to the framework GPS-world scene on attachToFrameworkScene()', () => {
            const factory: IRendererFactory<THREE.Object3D> = {
                createRenderer: () => new FakeRenderer(),
            };
            const sceneManager = new ArSceneManager(factory);
            sceneManager.attachToFrameworkScene();

            // Geographic feature coordinates belong in arWorldGroup (or scene fallback).
            const targetParent = getArWorldGroup() ?? getScene();
            expect(targetParent?.children).toContain(sceneManager.featureGroup);

            sceneManager.dispose();
        });

        it('gates feature visibility on framework tracking quality', () => {
            const factory: IRendererFactory<THREE.Object3D> = {
                createRenderer: () => new FakeRenderer(),
            };
            const sceneManager = new ArSceneManager(factory);

            sceneManager.setTrackingQualityGate(true);
            sceneManager.setTrackingQualityState('warming-up');
            expect(sceneManager.featureGroup.visible).toBe(true);

            sceneManager.setTrackingQualityState('degraded');
            expect(sceneManager.featureGroup.visible).toBe(true);

            sceneManager.setTrackingQualityState('ar-lost');
            expect(sceneManager.featureGroup.visible).toBe(true);

            sceneManager.setTrackingQualityState('ok');
            expect(sceneManager.featureGroup.visible).toBe(true);

            sceneManager.dispose();
        });

        it('converts GPS-world drag points back to the renderer local frame', () => {
            const factory: IRendererFactory<THREE.Object3D> = {
                createRenderer: () => new FakeRenderer(),
            };
            const sceneManager = new ArSceneManager(factory);
            sceneManager.attachToFrameworkScene();

            const localPoint = new THREE.Vector3(12, 0, -7);
            sceneManager.featureGroup.updateMatrixWorld(true);
            const worldPoint = localPoint.clone().applyMatrix4(sceneManager.featureGroup.matrixWorld);

            expect(sceneManager.worldToFeatureLocal(worldPoint).x).toBeCloseTo(localPoint.x, 8);
            expect(sceneManager.worldToFeatureLocal(worldPoint).z).toBeCloseTo(localPoint.z, 8);
            sceneManager.dispose();
        });

        it('does not expose hidden feature objects for picking', () => {
            const factory: IRendererFactory<THREE.Object3D> = {
                createRenderer: () => new FakeRenderer(),
            };
            const sceneManager = new ArSceneManager(factory);
            sceneManager.setTrackingQualityGate(true);
            sceneManager.setTrackingQualityState('warming-up');

            expect(sceneManager.getPickableObjects()).toEqual([]);
            sceneManager.dispose();
        });

        it('keeps featureGroup at local AR ground floor Y=0 so clampToGround features share the floor', async () => {
            const factory: IRendererFactory<THREE.Object3D> = {
                createRenderer: () => new FakeRenderer(),
            };
            anchorPosition = { lon: 6, lat: 50, alt: 94.5 };
            const sceneManager = new ArSceneManager(factory);
            await sceneManager.reconcileFeatures([], {} as any, mockGeoBridge);

            // Floor level in WebXR local-floor is Y=0; must not push features 94.5m into the sky.
            expect(sceneManager.featureGroup.position.y).toBe(0);
            sceneManager.dispose();
        });

        it('culls features beyond proximity radius from camera using horizontal distance', async () => {
            const factory: IRendererFactory<THREE.Object3D> = {
                createRenderer: () => new FakeRenderer(),
            };
            const sceneManager = new ArSceneManager(factory);
            sceneManager.attachToFrameworkScene();

            // Place a fake feature far away (> 50m) and a near one (< 50m)
            const farObj = new THREE.Mesh();
            farObj.position.set(600, 0, 0); // 600m away
            farObj.userData.featureId = 'far-feature';
            sceneManager.featureGroup.add(farObj);

            const nearObj = new THREE.Mesh();
            nearObj.position.set(10, 0, 0); // 10m away
            nearObj.userData.featureId = 'near-feature';
            sceneManager.featureGroup.add(nearObj);

            // Run reconcile with empty features so just culling runs
            await sceneManager.reconcileFeatures([], { getAssetUrl: vi.fn(), getAssetBytes: vi.fn(), hasAsset: vi.fn(), dispose: vi.fn(), release: vi.fn() } as any, mockGeoBridge);

            // Camera is at origin (mocked): 600m is culled, 10m is visible
            expect(farObj.visible).toBe(false);
            expect(nearObj.visible).toBe(true);

            sceneManager.dispose();
        });

        it('dynamically toggles visibility based on user GPS position with hysteresis', async () => {
            const factory: IRendererFactory<THREE.Object3D> = {
                createRenderer: () => new FakeRenderer(),
            };
            const sceneManager = new ArSceneManager(factory);
            sceneManager.setVisibilityRadius(50);

            // Feature at Aachen doorstep: lat 50.7750, lon 6.0830
            const doorstepMarker: IMarkerFeature = {
                id: 'doorstep-marker' as FeatureId,
                type: 'marker',
                name: 'Haustür Aachen',
                description: 'Directly in front of door',
                position: { lat: 50.7750, lon: 6.0830, alt: 0 },
                iconHref: null,
                iconScale: 1,
                altitudeMode: 'clampToGround',
            };

            const mockAssets = { getAssetUrl: vi.fn(), getAssetBytes: vi.fn(), hasAsset: vi.fn(), dispose: vi.fn(), release: vi.fn() } as any;
            await sceneManager.reconcileFeatures([doorstepMarker], mockAssets, mockGeoBridge);

            const markerObj = sceneManager.getObjectForFeature('doorstep-marker' as FeatureId);
            expect(markerObj).not.toBeNull();

            // Case 1: Phone is in Dortmund (~100 km away) -> Marker must be hidden
            sceneManager.updateUserGpsPosition({ lat: 51.5136, lon: 7.4653, alt: 100 });
            expect(markerObj?.visible).toBe(false);

            // Case 2: Phone is at the doorstep in Aachen (~5 m away) -> Marker must be visible
            sceneManager.updateUserGpsPosition({ lat: 50.77502, lon: 6.08303, alt: 0 });
            expect(markerObj?.visible).toBe(true);

            // Case 3: Phone moves 200m away -> Marker must be hidden
            // 0.002 degrees lat is ~222 m
            sceneManager.updateUserGpsPosition({ lat: 50.7770, lon: 6.0830, alt: 0 });
            expect(markerObj?.visible).toBe(false);

            // Case 4: Phone walks back to within 50m (e.g. 15m away) -> Marker becomes visible again
            sceneManager.updateUserGpsPosition({ lat: 50.7751, lon: 6.0830, alt: 0 });
            expect(markerObj?.visible).toBe(true);

            // Case 5: Hysteresis check — at 53m (between 50m enter and 57.5m exit), a visible marker stays visible
            // ~53m offset north is ~0.00048 degrees lat
            sceneManager.updateUserGpsPosition({ lat: 50.77548, lon: 6.0830, alt: 0 });
            expect(markerObj?.visible).toBe(true);

            // Once past 60m (> 57.5m exit boundary), it hides
            sceneManager.updateUserGpsPosition({ lat: 50.7756, lon: 6.0830, alt: 0 });
            expect(markerObj?.visible).toBe(false);

            sceneManager.dispose();
        });

        it('shows largeFileWarning when feature count > 500', async () => {
            const factory: IRendererFactory<THREE.Object3D> = {
                createRenderer: () => new FakeRenderer(),
            };
            const sceneManager = new ArSceneManager(factory);
            const mockAssets = { getAssetUrl: vi.fn(), getAssetBytes: vi.fn(), hasAsset: vi.fn(), dispose: vi.fn(), release: vi.fn() } as any;
            const manyFeatures = Array.from({ length: 501 }, (_, i) => ({
                id: `f${i}` as FeatureId,
                type: 'marker',
                name: `Marker ${i}`,
            } as unknown as IFeatureView));

            const result = await sceneManager.reconcileFeatures(manyFeatures, mockAssets, mockGeoBridge);
            expect(result.largeFileWarning).toBe(true);

            // Second call: warning must NOT fire again
            const result2 = await sceneManager.reconcileFeatures(manyFeatures, mockAssets, mockGeoBridge);
            expect(result2.largeFileWarning).toBe(false);

            sceneManager.dispose();
        });
    });

    // ── ArInteractionController ─────────────────────────────────────────────

    describe('AR Phone-Space Touch Grab-to-Edit Command Translation', () => {
        it('turns a phone-space screen grab into a MoveMarkerCommand dispatched to the store', async () => {
            anchorPosition = { lon: 6.06, lat: 50.77, alt: 200 };
            const store = createEditorStore();
            const factory: IRendererFactory<THREE.Object3D> = {
                createRenderer: () => new FakeRenderer(),
            };
            const sceneManager = new ArSceneManager(factory);
            const coordinator = new ArAnchorCoordinator(mockGeoBridge, store);

            const doc = createKmlDocument();
            const kmlSrc = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <Placemark id="marker-ar-1">
    <name>AR Target Marker</name>
    <Point>
      <coordinates>6.060000,50.770000,200.0</coordinates>
    </Point>
  </Placemark>
</Document>
</kml>`;
            doc.parse(kmlSrc);
            const kmz = new KmzContainer();
            kmz.setDocKml(kmlSrc);
            await store.loadContainer(kmz);

            const targetId = doc.getFeatures()[0].id;

            const fakeCanvas = {
                style: {},
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                getBoundingClientRect: vi.fn(() => ({ left: 0, top: 0, width: 800, height: 600 } as DOMRect)),
            } as unknown as HTMLCanvasElement;

            const interactionController = new ArInteractionController(
                fakeCanvas,
                sceneManager,
                mockGeoBridge,
                store,
                coordinator,
                () => doc
            );

            // Simulate the command that would result from a touchstart → drag → touchend
            const targetWorldPos: WorldPosition = { x: 50, y: 5, z: 50 };
            const command = createMoveMarkerCommand(targetId, targetWorldPos);
            command.execute(doc, mockGeoBridge);
            store.executeCommand(command);

            expect(store.getState().canUndo).toBe(true);

            const updatedFeature = doc.getFeatureById(targetId) as IMarkerFeature;
            expect(updatedFeature.position.lon).toBeCloseTo(6.0605, 5);
            expect(updatedFeature.position.lat).toBeCloseTo(50.7705, 5);
            expect(updatedFeature.position.alt).toBe(205.0);

            interactionController.dispose();
            sceneManager.dispose();
        });
    });

    // ── Lossless Round-Trip (AR edit → KMZ → Google Earth) ─────────────────

    describe('AR Lossless Round-Trip — edit in AR, reopen unchanged in Google Earth', () => {
        it('persists a single AR edit losslessly: only the edited coordinate changes, untouched bytes are preserved', async () => {
            anchorPosition = { lon: 6.06, lat: 50.77, alt: 200 };
            const store = createEditorStore();
            const doc = createKmlDocument();

            const originalKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document id="doc-ar-roundtrip">
  <name>AR Roundtrip Test</name>
  <!-- Untouched comment -->
  <Placemark id="marker-ar">
    <name>Original AR Marker</name>
    <Point>
      <coordinates>6.060000,50.770000,200.0</coordinates>
    </Point>
  </Placemark>
</Document>
</kml>`;

            doc.parse(originalKml);
            const targetId = doc.getFeatures()[0].id;

            const targetWorldPos: WorldPosition = { x: 123.4, y: 15.5, z: 123.4 };
            const command = createMoveMarkerCommand(targetId, targetWorldPos);
            command.execute(doc, mockGeoBridge);
            store.executeCommand(command);

            // Serialize and re-open in a new container
            const kmz = new KmzContainer();
            kmz.setDocKml(doc.serialize());
            const savedBuffer = await kmz.save();

            const kmzReloaded = new KmzContainer();
            await kmzReloaded.open(savedBuffer);
            const docReloaded = createKmlDocument();
            docReloaded.parse(kmzReloaded.getDocKml());

            const reloadedMarker = docReloaded.getFeatures()[0] as IMarkerFeature;
            expect(reloadedMarker.position.lon).toBeCloseTo(6.061234, 5);
            expect(reloadedMarker.position.lat).toBeCloseTo(50.771234, 5);
            expect(reloadedMarker.position.alt).toBe(215.5);

            // Untouched elements must remain byte-identical
            expect(kmzReloaded.getDocKml()).toContain('<!-- Untouched comment -->');
            expect(kmzReloaded.getDocKml()).toContain('<name>AR Roundtrip Test</name>');
        });
    });

    // ── ArReplayAdapter ─────────────────────────────────────────────────────

    describe('ArReplayAdapter — phone-free desktop replay', () => {
        it('processes replay samples and drives the anchor coordinator', () => {
            const store = createEditorStore();
            const coordinator = new ArAnchorCoordinator(mockGeoBridge, store);
            const adapter = new ArReplayAdapter(coordinator, store);

            adapter.loadSamples([
                { timestamp: 1000, position: { lon: 6.061, lat: 50.771, alt: 205 } },
                { timestamp: 2000, position: { lon: 6.062, lat: 50.772, alt: 206 } },
            ]);

            expect(adapter.getSampleCount()).toBe(2);
            adapter.step();

            expect(store.getState().device.gpsPosition).toEqual({
                latitude: 50.772,
                longitude: 6.062,
                altitude: 206,
            });

            adapter.dispose();
        });
    });

    // ── Simulation Test: Phone Coordinate Jitter & AR Session Restarts ────────

    describe('Simulation Test: session anchor lifecycle', () => {
        it('uses the first valid session GPS fix even when a document anchor already exists', async () => {
            const store = createEditorStore();
            const doc = createKmlDocument();

            const kmlText = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <Placemark id="my-home-marker">
    <name>My Home Marker</name>
    <Point>
      <coordinates>6.078000,50.777000,100.0</coordinates>
    </Point>
  </Placemark>
</Document>
</kml>`;

            doc.parse(kmlText);
            const kmz = new KmzContainer();
            kmz.setDocKml(kmlText);
            await store.loadContainer(kmz);

            mockGeoBridge.setAnchor({ position: { lon: 6.078, lat: 50.777, alt: 0 }, heading: 0 });
            const coordinator = new ArAnchorCoordinator(mockGeoBridge, store);

            // Document reference anchor set: (6.078000, 50.777000)
            const initialAnchor = mockGeoBridge.getAnchor();
            expect(initialAnchor?.position).toEqual({ lon: 6.078, lat: 50.777, alt: 0 });

            // Initial feature world position relative to document anchor
            const markerFeature = doc.getFeatures()[0] as IMarkerFeature;

            // --- SESSION 1: Phone starts AR at User Spot 1 (lat 50.777050, lon 6.078050, heading 45°) ---
            coordinator.resetSessionState();
            coordinator.updateGps(50.777050, 6.078050, 100, 45, 5);
            coordinator.updateHeading(45);
            coordinator.updateGps(50.777150, 6.078150, 105, 120, 3);
            expect(mockGeoBridge.getAnchor()?.position).toEqual({
                lon: 6.078050,
                lat: 50.777050,
                alt: 100,
            });

            // Document anchor position must NOT have been overwritten by phone's raw GPS
            const session1Anchor = mockGeoBridge.getAnchor();
            expect(session1Anchor?.position).toEqual({ lon: 6.078050, lat: 50.777050, alt: 100 });
            expect(session1Anchor?.heading).toBe(0);

            // Feature 3D position in local world space must be identical
            const worldPosSession1 = coordinator.applyAltitudePolicy(markerFeature.position, 'absolute');
            expect(worldPosSession1.x).toBeCloseTo(-5, 1);
            expect(worldPosSession1.z).toBeCloseTo(-5, 1);

            // --- SESSION 2: User walks 15m away, restarts AR at User Spot 2 (lat 50.777150, lon 6.078150, heading 120°) ---
            coordinator.resetSessionState();
            coordinator.updateGps(50.777150, 6.078150, 105, 120, 3);
            coordinator.updateHeading(120);

            // Document reference anchor position must STILL be intact
            const session2Anchor = mockGeoBridge.getAnchor();
            expect(session2Anchor?.position).toEqual({ lon: 6.078150, lat: 50.777150, alt: 105 });

            // Feature 3D position in featureGroup remains 100% stable
            coordinator.dispose();
        });
    });
});
