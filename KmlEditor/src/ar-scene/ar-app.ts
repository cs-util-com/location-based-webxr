import { IKmlDocument } from '../contracts/document-model';
import { IKmzContainer } from '../contracts/kmz-container';
import { IPersistenceService } from '../contracts/persistence';
import { IGeoBridge } from '../contracts/geo-bridge';
import { KmzContainer } from '../kmz-io/container';
import { createPersistenceService } from '../persistence';
import { RendererFactory } from '../renderers';
import { EditorStoreImpl } from '../store';
import { PersistenceCoordinator } from '../editor/persistence-coordinator';
import { ArAnchorCoordinator } from './ar-anchor-coordinator';
import { ArHud } from './ar-hud';
import { ArInteractionController } from './ar-interaction-controller';
import { ArReplayAdapter } from './ar-replay-adapter';
import { ArSceneManager } from './ar-scene-manager';
import './ar-hud.css';

import {
    createEnableGpsArController,
    type EnableGpsArController,
    type EnableGpsArState,
    getArWorldGroup,
    getCurrentArPose,
    registerFrameUpdate,
    setTrackingCallbacks,
    setTrackingLostCallback,
    setTrackingStore,
    type TrackingSubscribableStore,
} from 'gps-plus-slam-app-framework/ar';
import {
    createGpsPositionHandler,
    createSlamAppStore,
    endSession,
    setZeroPos,
    startSession,
    selectTrackingQuality,
    updateDeviceOrientation,
    type SubscribableStore,
} from 'gps-plus-slam-app-framework/state';
import { enableArWorldGroupAlignment } from 'gps-plus-slam-app-framework/visualization';
import { odometryTrackingRestarted } from 'gps-plus-slam-app-framework/core';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage';
import { createGeoBridge } from '../geo-bridge';
import { ArSceneDiagnostics, type ArTrackingQualityDiagnostic } from './ar-scene-diagnostics';

const DEFAULT_KML_URL = '/fixtures/google-earth/emilsborg.kml';
const DEFAULT_KML_FILE_NAME = DEFAULT_KML_URL.split('/').pop() ?? 'default.kml';

export interface ArAppOptions {
    container: HTMLElement;
    store?: EditorStoreImpl;
    persistenceService?: IPersistenceService;
}

/**
 * ArApp — top-level composition root for the KML AR editor (Component 8).
 *
 * Framework integration:
 *   1. createSlamAppStore initializes Redux SLAM/GPS fusion tracking slices.
 *   2. setZeroPos locks zeroReference in Redux to the stable document anchor.
 *   3. enableArWorldGroupAlignment dynamically aligns arWorldGroup.matrix
 *      to physical North-Up-East space every frame during active sessions.
 */
export class ArApp {
    private readonly store: EditorStoreImpl;
    private readonly persistence: IPersistenceService;
    private readonly rendererFactory = new RendererFactory();

    private readonly sceneManager: ArSceneManager;
    private readonly anchorCoordinator: ArAnchorCoordinator;
    private readonly interactionController: ArInteractionController;
    private readonly hud: ArHud;
    private readonly replayAdapter: ArReplayAdapter;
    private readonly persistenceCoordinator: PersistenceCoordinator;
    private readonly diagnostics = new ArSceneDiagnostics();
    private readonly enableGpsArController: EnableGpsArController;
    private diagnosticsFrameUnsubscribe: (() => void) | null = null;
    private sessionGeoBridge: IGeoBridge | null = null;

    private slamStore = createSlamAppStore({ storageBackend: new NullStorageBackend() });
    private gpsHandler = createGpsPositionHandler({
        store: this.slamStore,
        getArPose: getCurrentArPose,
    });

    private containerFile: IKmzContainer | null = null;
    private documentModel: IKmlDocument | null = null;
    private storeUnsubscribe: (() => void) | null = null;
    private arStateUnsubscribe: (() => void) | null = null;
    private loadRequestId = 0;

    private get geoBridge(): IGeoBridge {
        return this.store.geoBridge;
    }

    public constructor(options: ArAppOptions) {
        this.store = options.store ?? new EditorStoreImpl();
        this.persistence = options.persistenceService ?? createPersistenceService();

        options.container.replaceChildren();

        // Register tracking store with framework
        setTrackingStore(this.slamStore as unknown as TrackingSubscribableStore);
        // Enable the framework tracking pipeline and rebase odometry after an
        // XR reference-space reset, matching the framework examples.
        setTrackingCallbacks((payload) => {
            this.slamStore.dispatch(odometryTrackingRestarted(payload));
        });

        this.enableGpsArController = createEnableGpsArController();
        void this.enableGpsArController.refreshSupport();

        // ── App-owned modules ────────────────────────────────────────────────
        const initialSessionBridge = createGeoBridge();
        this.anchorCoordinator = new ArAnchorCoordinator(initialSessionBridge, this.store);
        this.anchorCoordinator.onAnchorChange = (anchor) => {
            this.slamStore.dispatch(
                setZeroPos({
                    lat: anchor.position.lat,
                    lon: anchor.position.lon,
                    altitude: anchor.position.alt,
                })
            );
            void this.reconcileIfActive();
        };
        this.sceneManager = new ArSceneManager(this.rendererFactory);

        this.hud = new ArHud(
            options.container,
            this.store,
            this.persistence,
            () => this.documentModel,
            (file) => void this.openFile(file),
            () => void this.startArSession(),
            () => void this.stopArSession(),
            () => this.diagnostics.download()
        );
        this.hud.mount();
        window.__arSceneDiagnostics = this.diagnostics;

        const sentinelCanvas = document.createElement('canvas');
        this.interactionController = new ArInteractionController(
            sentinelCanvas,
            this.sceneManager,
            initialSessionBridge,
            this.store,
            this.anchorCoordinator,
            () => this.documentModel
        );

        this.replayAdapter = new ArReplayAdapter(this.anchorCoordinator, this.store);
        this.persistenceCoordinator = new PersistenceCoordinator(this.persistence);

        setTrackingLostCallback(() => {
            this.hud.updateTrackingState('lost');
            this.store.setDeviceState({ isArActive: false });
        });

        this.arStateUnsubscribe = this.enableGpsArController.subscribe(
            (state: EnableGpsArState) => {
                this.hud.updateTrackingState(state.status);
                this.store.setDeviceState({ isArActive: state.status === 'running' });
                if (state.status === 'error') {
                    this.hud.updateFileStatus(`AR Error: ${state.error ?? 'unknown'}`);
                }
            }
        );

        this.storeUnsubscribe = this.store.subscribe(() => void this.onStoreChange());
        void this.loadDefaultDemo();
    }

    public async openFile(file: File | ArrayBuffer): Promise<void> {
        const requestId = ++this.loadRequestId;
        try {
            const kmz = new KmzContainer();
            await kmz.open(file);
            await this.store.loadContainer(kmz);
            if (requestId !== this.loadRequestId) {
                kmz.dispose();
                return;
            }
            this.containerFile = kmz;
            this.documentModel = this.store.document;

            const featureCount = this.documentModel?.getFeatures().length ?? 0;
            const fileName = file instanceof File ? file.name : 'Document';
            this.hud.updateLoadedFile(fileName, featureCount);
            this.hud.updateFileStatus(`Loaded ${fileName} (${featureCount} features)`);

            await this.reconcileIfActive();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.hud.updateFileStatus(`Error: ${msg}`);
        }
    }

    public async startArSession(): Promise<void> {
        this.resetSlamStore();
        this.startSessionProjection();
        this.anchorCoordinator.resetSessionState();
        this.sceneManager.setTrackingQualityGate(true);
        this.sceneManager.setTrackingQualityState(null);
        const sessionSnapshot = this.anchorCoordinator.getDiagnosticSnapshot();
        this.diagnostics.startSession(sessionSnapshot.session);
        const container = this.hud['container'] as HTMLElement;

        const timeoutPromise = new Promise<{ ok: false; error: string }>((resolve) => {
            setTimeout(() => {
                resolve({
                    ok: false,
                    error: 'Location/WebXR permission timed out. Ensure you access via http://localhost:5173 (via Chrome Port Forwarding) or HTTPS.',
                });
            }, 8000);
        });

        try {
            // Start before enabling sensors so GPS callbacks are recorded by the framework.
            this.slamStore.dispatch(
                startSession({
                    scenarioName: 'kml-ar',
                    sessionName: 'live',
                    startTime: Date.now(),
                })
            );
            const result = await Promise.race([
                this.enableGpsArController.enable({
                    container,

                    // Feed GPS fixes into framework tracking store + anchor coordinator
                    onGpsPosition: (pos) => {
                        this.gpsHandler(pos);

                        const currentHeading = this.store.getState().device.heading ?? 0;
                        this.anchorCoordinator.updateGps(
                            pos.lat,
                            pos.lon,
                            pos.altitude ?? 0,
                            currentHeading,
                            pos.accuracy
                        );
                        this.sceneManager.updateUserGpsPosition({
                            lat: pos.lat,
                            lon: pos.lon,
                            alt: pos.altitude ?? 0,
                        });
                        const snapshot = this.anchorCoordinator.getDiagnosticSnapshot();
                        this.diagnostics.record({
                            stage: 'gps',
                            gps: {
                                latitude: pos.lat,
                                longitude: pos.lon,
                                altitude: pos.altitude ?? 0,
                                accuracy: pos.accuracy,
                            },
                            heading: snapshot.heading,
                            anchor: snapshot.anchor,
                        });
                        this.sceneManager.updateAccuracyRing(pos.accuracy);
                        this.updateTrackingQualityGate();
                    },

                    // Feed device orientation into framework tracking store + anchor coordinator
                    onOrientation: (orient) => {
                        updateDeviceOrientation(orient);
                        if (orient.alpha !== null) {
                            this.anchorCoordinator.updateHeading(orient.alpha);
                            const snapshot = this.anchorCoordinator.getDiagnosticSnapshot();
                            this.diagnostics.record({
                                stage: 'orientation',
                                heading: snapshot.heading,
                                anchor: snapshot.anchor,
                            });
                            this.updateTrackingQualityGate();
                        }
                    },
                }),
                timeoutPromise,
            ]);

            if (!result.ok) {
                console.warn('[ArApp] AR session failed to start:', result.error);
                this.hud.updateFileStatus(`AR Error: ${result.error ?? 'failed to start'}`);
                await this.enableGpsArController.disable();
                this.slamStore.dispatch(endSession());
                this.sceneManager.setTrackingQualityGate(false);
                this.hud.updateTrackingState('ready');
                return;
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[ArApp] Exception during startArSession:', err);
            this.hud.updateFileStatus(`AR Exception: ${msg}`);
            await this.enableGpsArController.disable();
            this.slamStore.dispatch(endSession());
            this.sceneManager.setTrackingQualityGate(false);
            this.hud.updateTrackingState('ready');
            return;
        }

        // Bind framework alignment lerp onto arWorldGroup
        const arWorldGroup = getArWorldGroup();
        if (arWorldGroup) {
            enableArWorldGroupAlignment({
                store: this.slamStore as unknown as SubscribableStore,
                arWorldGroup,
            });
            this.diagnosticsFrameUnsubscribe?.();
            this.diagnosticsFrameUnsubscribe = registerFrameUpdate(() => {
                this.updateTrackingQualityGate();
                const feature = this.documentModel?.getFeatures()[0];
                const featureObject = feature ? this.sceneManager.getObjectForFeature(feature.id) : null;
                const anchor = this.anchorCoordinator.getDiagnosticSnapshot().anchor;
                this.diagnostics.recordFrame(
                    arWorldGroup,
                    feature?.id,
                    featureObject,
                    anchor,
                    this.sceneManager.featureGroup.visible,
                    this.getTrackingQualityDiagnostic()
                );
            });
        }

        // Attach KML feature group to framework scene
        this.sceneManager.attachToFrameworkScene();
        await this.reconcileIfActive();
    }

    public async stopArSession(): Promise<void> {
        this.diagnosticsFrameUnsubscribe?.();
        this.diagnosticsFrameUnsubscribe = null;
        try {
            this.slamStore.dispatch(endSession());
        } catch (_err) {
            // ignore
        }
        await this.enableGpsArController.disable();
        this.sceneManager.detachFromFrameworkScene();
        this.sessionGeoBridge = null;
        this.resetSlamStore();
        this.sceneManager.setTrackingQualityGate(false);
        this.sceneManager.setTrackingQualityState(null);
        this.hud.updateTrackingState('ready');
        this.hud.updateDiagnosticInfo('');
    }

    public getReplayAdapter(): ArReplayAdapter {
        return this.replayAdapter;
    }

    public dispose(): void {
        this.diagnosticsFrameUnsubscribe?.();
        void this.enableGpsArController.disable();
        if (this.arStateUnsubscribe) this.arStateUnsubscribe();
        if (this.storeUnsubscribe) this.storeUnsubscribe();
        this.sceneManager.dispose();
        this.interactionController.dispose();
        this.hud.dispose();
        this.replayAdapter.dispose();
        this.anchorCoordinator.dispose();
    }

    // ── Private ──────────────────────────────────────────────────────────────

    private resetSlamStore(): void {
        this.slamStore = createSlamAppStore({ storageBackend: new NullStorageBackend() });
        setTrackingStore(this.slamStore as unknown as TrackingSubscribableStore);
        this.gpsHandler = createGpsPositionHandler({
            store: this.slamStore,
            getArPose: getCurrentArPose,
        });

    }

    private updateTrackingQualityGate(): void {
        const report = selectTrackingQuality(this.slamStore.getState());
        this.sceneManager.setTrackingQualityState(report?.state ?? null);
        const anchorInfo = this.anchorCoordinator.getDiagnosticInfo();
        if (!report) {
            this.hud.updateDiagnosticInfo(`${anchorInfo} | Markers hidden: waiting for tracking quality`);
            return;
        }
        const markerStatus = report.state === 'ok'
            ? 'Markers visible'
            : `Markers provisional: tracking ${report.state}`;
        const visibleCount = this.sceneManager.getVisibleFeatureCount();
        const totalCount = this.documentModel?.getFeatures().length ?? 0;
        const radius = this.sceneManager.getVisibilityRadius();
        const proximityInfo = totalCount > 0 ? ` | ${visibleCount}/${totalCount} in range (${radius}m)` : '';
        this.hud.updateDiagnosticInfo(
            `${anchorInfo} | ${markerStatus} (${Math.round(report.confidence * 100)}%)${proximityInfo}`
        );
    }

    private getTrackingQualityDiagnostic(): ArTrackingQualityDiagnostic | null {
        const report = selectTrackingQuality(this.slamStore.getState());
        if (!report) return null;
        return {
            state: report.state,
            confidence: report.confidence,
            observationsSeen: report.diagnostics.observationsSeen,
            coverage: report.subScores.coverage,
            convergence: report.subScores.convergence,
            gpsAccuracy: report.subScores.gpsAccuracy,
            walkedDistanceM: report.diagnostics.walkedDistanceM,
            directionSpreadDeg: report.diagnostics.directionSpreadDeg,
        };
    }

    private startSessionProjection(): void {
        const bridge = createGeoBridge();
        this.sessionGeoBridge = bridge;
        this.anchorCoordinator.setGeoBridge(bridge);
        this.interactionController.setGeoBridge(bridge);
    }

    private async loadDefaultDemo(): Promise<void> {
        const requestId = this.loadRequestId;
        try {
            const response = await fetch(DEFAULT_KML_URL);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const kmlText = await response.text();

            if (requestId !== this.loadRequestId) return;

            const kmz = new KmzContainer();
            kmz.setDocKml(kmlText);
            await this.store.loadContainer(kmz);
            if (requestId !== this.loadRequestId) {
                kmz.dispose();
                return;
            }
            this.containerFile = kmz;
            this.documentModel = this.store.document;

            const featureCount = this.documentModel?.getFeatures().length ?? 0;
            this.hud.updateLoadedFile(DEFAULT_KML_FILE_NAME, featureCount);
            this.hud.updateFileStatus(`Loaded ${DEFAULT_KML_FILE_NAME} (${featureCount} features)`);
            this.persistenceCoordinator.observe(this.documentModel, this.containerFile);
        } catch (_err) {
            // Silently skip if fixture isn't served
        }
    }

    private async reconcileIfActive(): Promise<void> {
        const documentModel = this.documentModel;
        const containerFile = this.containerFile;
        if (!documentModel || !containerFile) return;
        if (!this.sceneManager.featureGroup.parent) return;
        const sessionBridge = this.sessionGeoBridge;
        if (!sessionBridge || !this.anchorCoordinator.hasAnchorForSession()) return;

        const result = await this.sceneManager.reconcileFeatures(
            documentModel.getFeatures(),
            containerFile.getAssetProvider(),
            sessionBridge
        );

        if (documentModel !== this.documentModel || containerFile !== this.containerFile) {
            await this.reconcileIfActive();
            return;
        }

        if (documentModel.getFeatures().length > 0 && result.renderedFeatureCount === 0) {
            this.hud.updateFileStatus(`No features in AR proximity (within ${this.sceneManager.getVisibilityRadius()} m)`);
        }

        if (result.largeFileWarning) {
            const count = documentModel.getFeatures().length;
            this.hud.updateFileStatus(
                `⚠️ Large file (${count} features)`
            );
        }
    }

    private async onStoreChange(): Promise<void> {
        if (this.documentModel && this.containerFile) {
            this.persistenceCoordinator.observe(this.documentModel, this.containerFile);
        }
        await this.reconcileIfActive();
    }
}

export function mountArApp(container: HTMLElement, options?: Omit<ArAppOptions, 'container'>): ArApp {
    return new ArApp({ container, ...options });
}
