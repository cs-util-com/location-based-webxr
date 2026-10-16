import * as THREE from 'three';
import { ZipReader, BlobReader, TextWriter } from '@zip.js/zip.js';
import { GeoPosition, WorldPosition } from '../contracts/type';
import { IGeoBridge } from '../contracts/geo-bridge';
import { DesktopScene } from './desktop-scene';

export interface IReplaySample {
    readonly timestamp: number;
    readonly position: GeoPosition;
    readonly odomPosition?: WorldPosition;
    readonly odomRotation?: readonly [number, number, number, number];
}

export type ReplayState = 'idle' | 'playing' | 'paused' | 'completed';

export type SampleChangeListener = (sample: IReplaySample, index: number) => void;
export type StateChangeListener = (state: ReplayState) => void;

/**
 * ReplayHarness: Deterministic phone-free replay engine for Task-1 walk recordings.
 *
 * Feed a Task 1 recording (.zip or JSON samples) so the "user position" moves
 * through the desktop 3D scene without needing a phone or WebXR session.
 */
export class ReplayHarness {
    private samples: IReplaySample[] = [];
    private currentIndex = -1;
    private state: ReplayState = 'idle';
    private timerId: ReturnType<typeof setInterval> | null = null;
    private speedFactor = 1;

    private scene: DesktopScene | null = null;
    private geoBridge: IGeoBridge | null = null;
    private userMarkerMesh: THREE.Group | null = null;

    private sampleListeners = new Set<SampleChangeListener>();
    private stateListeners = new Set<StateChangeListener>();

    public loadSamples(samples: IReplaySample[]): void {
        this.stop();
        this.samples = [...samples].sort((a, b) => a.timestamp - b.timestamp);
        this.currentIndex = this.samples.length > 0 ? 0 : -1;
        this.setState('idle');
        this.updateMarker();
        if (this.currentIndex >= 0) {
            this.notifySample();
        }
    }

    /**
     * Parses a Task-1 recording ZIP file (e.g., 2026-06-24_13-58-24utc.zip)
     * containing actions/*.json entries.
     */
    public async loadZip(zipBuffer: ArrayBuffer): Promise<number> {
        this.stop();
        const blob = new Blob([zipBuffer]);
        const zipReader = new ZipReader(new BlobReader(blob));
        const entries = await zipReader.getEntries();

        const actionEntries = entries.filter(
            (e) => !e.directory && e.filename.startsWith('actions/') && e.filename.endsWith('.json')
        );

        const extracted: IReplaySample[] = [];

        for (const entry of actionEntries) {
            try {
                const text = await entry.getData(new TextWriter());
                const data = JSON.parse(text);
                const sample = parseActionToSample(data);
                if (sample) {
                    extracted.push(sample);
                }
            } catch {
                // Ignore malformed individual action entries
            }
        }

        await zipReader.close();

        this.loadSamples(extracted);
        return this.samples.length;
    }

    public attach(scene: DesktopScene, bridge: IGeoBridge): void {
        this.detach();
        this.scene = scene;
        this.geoBridge = bridge;
        this.createUserMarker();
        this.updateMarker();
    }

    public detach(): void {
        if (this.userMarkerMesh && this.scene) {
            this.scene.overlayRoot.remove(this.userMarkerMesh);
            this.disposeMarkerMesh(this.userMarkerMesh);
            this.userMarkerMesh = null;
        }
        this.scene = null;
        this.geoBridge = null;
    }

    public getSamples(): readonly IReplaySample[] {
        return this.samples;
    }

    public getCurrentIndex(): number {
        return this.currentIndex;
    }

    public getCurrentSample(): IReplaySample | null {
        if (this.currentIndex >= 0 && this.currentIndex < this.samples.length) {
            return this.samples[this.currentIndex];
        }
        return null;
    }

    public getState(): ReplayState {
        return this.state;
    }

    public onSampleChange(listener: SampleChangeListener): () => void {
        this.sampleListeners.add(listener);
        return () => this.sampleListeners.delete(listener);
    }

    public onStateChange(listener: StateChangeListener): () => void {
        this.stateListeners.add(listener);
        return () => this.stateListeners.delete(listener);
    }

    public play(speedFactor = 1): void {
        if (this.samples.length === 0) return;
        this.speedFactor = Math.max(0.1, Math.min(speedFactor, 100));

        if (this.currentIndex < 0 || this.currentIndex >= this.samples.length - 1) {
            this.currentIndex = 0;
        }

        this.setState('playing');
        this.scheduleNextStep();
    }

    public pause(): void {
        if (this.state === 'playing') {
            this.stopTimer();
            this.setState('paused');
        }
    }

    public stop(): void {
        this.stopTimer();
        this.setState('idle');
    }

    public step(deltaMs = 100): IReplaySample | null {
        if (this.samples.length === 0) return null;

        if (this.currentIndex < this.samples.length - 1) {
            this.currentIndex++;
        } else {
            this.stopTimer();
            this.setState('completed');
            return this.getCurrentSample();
        }

        this.updateMarker();
        this.notifySample();
        return this.getCurrentSample();
    }

    public seek(index: number): IReplaySample | null {
        if (this.samples.length === 0) return null;
        this.currentIndex = Math.max(0, Math.min(index, this.samples.length - 1));
        this.updateMarker();
        this.notifySample();
        return this.getCurrentSample();
    }

    public dispose(): void {
        this.stopTimer();
        this.detach();
        this.samples = [];
        this.sampleListeners.clear();
        this.stateListeners.clear();
    }

    private scheduleNextStep(): void {
        this.stopTimer();
        if (this.state !== 'playing') return;

        if (this.currentIndex >= this.samples.length - 1) {
            this.setState('completed');
            return;
        }

        const current = this.samples[this.currentIndex];
        const next = this.samples[this.currentIndex + 1];
        let delay = 100;

        if (current && next && next.timestamp > current.timestamp) {
            delay = Math.min((next.timestamp - current.timestamp) / this.speedFactor, 1000);
        }

        this.timerId = setTimeout(() => {
            this.step();
            if (this.state === 'playing') {
                this.scheduleNextStep();
            }
        }, delay);
    }

    private stopTimer(): void {
        if (this.timerId !== null) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
    }

    private setState(state: ReplayState): void {
        if (this.state !== state) {
            this.state = state;
            for (const listener of this.stateListeners) {
                listener(state);
            }
        }
    }

    private notifySample(): void {
        const sample = this.getCurrentSample();
        if (sample) {
            for (const listener of this.sampleListeners) {
                listener(sample, this.currentIndex);
            }
        }
    }

    private createUserMarker(): void {
        if (!this.scene) return;

        const group = new THREE.Group();
        group.name = 'ReplayUserMarker';

        // Outer cyan pulsing sphere
        const sphereGeo = new THREE.SphereGeometry(1.2, 16, 16);
        const sphereMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.7 });
        const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);

        // Core inner white dot
        const innerGeo = new THREE.SphereGeometry(0.5, 12, 12);
        const innerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const innerMesh = new THREE.Mesh(innerGeo, innerMat);

        // Forward heading cone
        const coneGeo = new THREE.ConeGeometry(0.8, 2.5, 12);
        coneGeo.rotateX(Math.PI / 2);
        const coneMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.9 });
        const coneMesh = new THREE.Mesh(coneGeo, coneMat);
        coneMesh.position.set(0, 0, -1.8);

        group.add(sphereMesh, innerMesh, coneMesh);
        this.scene.overlayRoot.add(group);
        this.userMarkerMesh = group;
    }

    private updateMarker(): void {
        if (!this.userMarkerMesh) return;
        const sample = this.getCurrentSample();
        if (!sample) return;

        if (this.geoBridge) {
            // Convert GPS position for horizontal world coordinates (X, Z) relative to document anchor.
            // For vertical height (Y), use ground plane / camera eye-height to prevent floating 270m in the air.
            const world = this.geoBridge.geoToWorld(sample.position, 'clampToGround');
            const heightY = sample.odomPosition ? Math.max(0, sample.odomPosition.y) : 1.6;
            this.userMarkerMesh.position.set(world.x, heightY, world.z);
        } else if (sample.odomPosition) {
            this.userMarkerMesh.position.set(sample.odomPosition.x, sample.odomPosition.y, sample.odomPosition.z);
        }

        if (sample.odomRotation && sample.odomRotation.length === 4) {
            const [x, y, z, w] = sample.odomRotation;
            this.userMarkerMesh.quaternion.set(x, y, z, w);
        }
    }

    private disposeMarkerMesh(group: THREE.Group): void {
        group.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.geometry.dispose();
                if (Array.isArray(child.material)) {
                    child.material.forEach((m) => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
    }
}

/** Parses raw JSON Redux action payload into an IReplaySample if valid. */
function parseActionToSample(action: any): IReplaySample | null {
    if (!action || typeof action !== 'object') return null;

    const payload = action.payload ?? action;
    const rawGps = payload.rawGpsPoint ?? payload.gpsPoint;

    let lon = 0;
    let lat = 0;
    let alt = 0;
    let timestamp = 0;

    if (rawGps && typeof rawGps === 'object') {
        lon = Number(rawGps.lon ?? rawGps.longitude ?? 0);
        lat = Number(rawGps.lat ?? rawGps.latitude ?? 0);
        alt = Number(rawGps.alt ?? rawGps.altitude ?? 0);
        timestamp = Number(rawGps.timestamp ?? payload.timestamp ?? 0);
    } else if (payload.position) {
        lon = Number(payload.position.lon ?? 0);
        lat = Number(payload.position.lat ?? 0);
        alt = Number(payload.position.alt ?? 0);
        timestamp = Number(payload.timestamp ?? 0);
    } else {
        return null;
    }

    let odomPosition: WorldPosition | undefined;
    if (Array.isArray(payload.odomPosition) && payload.odomPosition.length >= 3) {
        odomPosition = {
            x: Number(payload.odomPosition[0]),
            y: Number(payload.odomPosition[1]),
            z: Number(payload.odomPosition[2]),
        };
    }

    let odomRotation: readonly [number, number, number, number] | undefined;
    if (Array.isArray(payload.odomRotation) && payload.odomRotation.length >= 4) {
        odomRotation = [
            Number(payload.odomRotation[0]),
            Number(payload.odomRotation[1]),
            Number(payload.odomRotation[2]),
            Number(payload.odomRotation[3]),
        ];
    }

    return {
        timestamp: timestamp || Date.now(),
        position: { lon, lat, alt },
        odomPosition,
        odomRotation,
    };
}
