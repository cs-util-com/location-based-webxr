import * as THREE from 'three';

export interface ArDiagnosticSample {
    time: string;
    elapsedMs: number;
    stage: 'session-start' | 'gps' | 'orientation' | 'frame';
    gps?: { latitude: number; longitude: number; altitude: number; accuracy: number };
    heading?: number;
    anchor?: { lat: number; lon: number; alt: number } | null;
    featureId?: string;
    markerLocal?: { x: number; y: number; z: number };
    markerWorld?: { x: number; y: number; z: number };
    arWorldGroupMatrix?: number[];
    featureGroupVisible?: boolean;
    trackingQuality?: ArTrackingQualityDiagnostic | null;
}

export interface ArTrackingQualityDiagnostic {
    state: 'warming-up' | 'ar-lost' | 'degraded' | 'ok';
    confidence: number;
    observationsSeen: number;
    coverage: number;
    convergence: number;
    gpsAccuracy: number;
    walkedDistanceM: number;
    directionSpreadDeg: number;
}

export interface ArDiagnosticLog {
    version: 1;
    session: number;
    startedAt: string;
    samples: ArDiagnosticSample[];
}

const MAX_SAMPLES = 1200;

export class ArSceneDiagnostics {
    private log: ArDiagnosticLog = this.createLog(0);
    private startedAtMs = 0;
    private lastFrameMs = -Infinity;

    public startSession(session: number): void {
        this.startedAtMs = performance.now();
        this.lastFrameMs = -Infinity;
        this.log = this.createLog(session);
        this.record({ stage: 'session-start' });
    }

    public record(sample: Omit<ArDiagnosticSample, 'time' | 'elapsedMs'>): void {
        const now = performance.now();
        this.log.samples.push({
            ...sample,
            time: new Date().toISOString(),
            elapsedMs: Math.round(now - this.startedAtMs),
        });
        if (this.log.samples.length > MAX_SAMPLES) {
            this.log.samples.splice(0, this.log.samples.length - MAX_SAMPLES);
        }
    }

    public recordFrame(
        worldGroup: THREE.Object3D,
        featureId: string | undefined,
        featureObject: THREE.Object3D | null,
        anchor: { lat: number; lon: number; alt: number } | null,
        featureGroupVisible: boolean,
        trackingQuality: ArTrackingQualityDiagnostic | null
    ): void {
        const now = performance.now();
        if (now - this.lastFrameMs < 250) return;
        this.lastFrameMs = now;

        const markerWorld = featureObject ? new THREE.Vector3() : null;
        if (markerWorld && featureObject) featureObject.getWorldPosition(markerWorld);
        this.record({
            stage: 'frame',
            anchor,
            featureId,
            markerLocal: featureObject ? vectorToObject(featureObject.position) : undefined,
            markerWorld: markerWorld ? vectorToObject(markerWorld) : undefined,
            arWorldGroupMatrix: worldGroup.matrix.toArray(),
            featureGroupVisible,
            trackingQuality,
        });
    }

    public getLog(): ArDiagnosticLog {
        return structuredClone(this.log);
    }

    public download(): void {
        const blob = new Blob([JSON.stringify(this.getLog(), null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ar-scene-diagnostics-run-${this.log.session}.json`;
        link.click();
        URL.revokeObjectURL(url);
    }

    private createLog(session: number): ArDiagnosticLog {
        return { version: 1, session, startedAt: new Date().toISOString(), samples: [] };
    }
}

function vectorToObject(vector: THREE.Vector3): { x: number; y: number; z: number } {
    return { x: vector.x, y: vector.y, z: vector.z };
}

declare global {
    interface Window {
        __arSceneDiagnostics?: ArSceneDiagnostics;
    }
}

export type ArDiagnosticDivergence = 'gps-anchor' | 'marker-local' | 'ar-alignment' | 'no-divergence';

export function compareDiagnosticLogs(first: ArDiagnosticLog, second: ArDiagnosticLog): ArDiagnosticDivergence {
    const firstGps = first.samples.find((sample) => sample.stage === 'gps');
    const secondGps = second.samples.find((sample) => sample.stage === 'gps');
    if (!sameGps(firstGps?.gps, secondGps?.gps) || !sameAnchor(firstGps?.anchor, secondGps?.anchor)) {
        return 'gps-anchor';
    }

    const firstFrame = first.samples.find((sample) => sample.stage === 'frame' && sample.markerLocal);
    const secondFrame = second.samples.find((sample) => sample.stage === 'frame' && sample.markerLocal);
    if (!sameVector(firstFrame?.markerLocal, secondFrame?.markerLocal)) return 'marker-local';
    if (!sameMatrix(firstFrame?.arWorldGroupMatrix, secondFrame?.arWorldGroupMatrix)) return 'ar-alignment';
    return 'no-divergence';
}

function closeEnough(first: number | undefined, second: number | undefined, tolerance: number): boolean {
    return first !== undefined && second !== undefined && Math.abs(first - second) <= tolerance;
}

function sameGps(first: ArDiagnosticSample['gps'], second: ArDiagnosticSample['gps']): boolean {
    return Boolean(first && second) && closeEnough(first?.latitude, second?.latitude, 0.00001)
        && closeEnough(first?.longitude, second?.longitude, 0.00001)
        && closeEnough(first?.altitude, second?.altitude, 1)
        && closeEnough(first?.accuracy, second?.accuracy, 1);
}

function sameAnchor(first: ArDiagnosticSample['anchor'], second: ArDiagnosticSample['anchor']): boolean {
    if (!first || !second) return first === second;
    return closeEnough(first.lat, second.lat, 0.00001)
        && closeEnough(first.lon, second.lon, 0.00001)
        && closeEnough(first.alt, second.alt, 1);
}

function sameVector(first: ArDiagnosticSample['markerLocal'], second: ArDiagnosticSample['markerLocal']): boolean {
    return Boolean(first && second) && closeEnough(first?.x, second?.x, 0.05)
        && closeEnough(first?.y, second?.y, 0.05)
        && closeEnough(first?.z, second?.z, 0.05);
}

function sameMatrix(first: number[] | undefined, second: number[] | undefined): boolean {
    return Boolean(first && second && first.length === second.length)
        && first?.every((value, index) => closeEnough(value, second?.[index], 0.05)) === true;
}