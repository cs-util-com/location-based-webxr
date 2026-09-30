import { describe, expect, test } from 'vitest';
import { ReplayEngine } from 'gps-plus-slam-app-framework/state/replay-engine';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage/null-storage-backend';
import { installOPFSMocks } from 'gps-plus-slam-app-framework/test-utils/browser-mocks';
import {
  createSession,
  initOpfsStorage,
  resetOpfsStorage,
  writeAction,
  writeSessionMetadata,
} from 'gps-plus-slam-app-framework/storage/opfs-storage';
import { exportSessionAsZip } from 'gps-plus-slam-app-framework/storage/zip-export';
import type { RecordedAction } from 'gps-plus-slam-app-framework/storage/zip-reader';
import { createRecorderStore } from '../state/recorder-store';
import {
  addMeasurementRay,
  confirmMeasurementSuccess,
  requestConfirmMeasurement,
  selectConfirmedMeasurementPoints,
} from '../state/measurement-points-slice';
import { loadRecording } from '../storage/recording-loader';
import type {
  MeasurementPointEntity,
  MeasurementRayRecord,
} from '../storage/measurement-point-loader';

const SCENARIO_ID = 'outdoor-measurement-fixture';
const SESSION_TIME = new Date('2026-09-10T12:00:00.000Z');

function makeRay(index: number): MeasurementRayRecord {
  const origin: [number, number, number] = [index * 2, 0, 0];
  const target: [number, number, number] = [5, 0, -10];
  const dx = target[0] - origin[0];
  const dy = target[1] - origin[1];
  const dz = target[2] - origin[2];
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

  return {
    id: `replay-ray-${index}`,
    timestamp: SESSION_TIME.getTime() + index * 100,
    arPose: {
      position: origin,
      rotation: [0, 0, 0, 1],
    },
    rayOrigin: origin,
    rayDirection: [dx / length, dy / length, dz / length],
    rayWeight: 1,
    depthPoint: target,
    depthWeight: 0.5,
  };
}

function makeEntity(): MeasurementPointEntity {
  return {
    schemaVersion: 1,
    id: 'measurement-replay-point',
    createdAt: SESSION_TIME.getTime() + 500,
    updatedAt: SESSION_TIME.getTime() + 500,
    scenarioId: SCENARIO_ID,
    observations: [makeRay(0), makeRay(1), makeRay(2)],
    arPosition: [5, 0, -10],
    gpsPositionSnapshot: [12, 4, -8],
    uncertainty: 0.025,
    rmsError: 0.01,
    inlierIds: ['replay-ray-0', 'replay-ray-1'],
    outlierIds: ['replay-ray-2'],
    confirmationMode: 'quality',
  };
}

async function buildMeasurementRecording(): Promise<Uint8Array> {
  const { cleanup } = installOPFSMocks();

  try {
    await initOpfsStorage();
    const { sessionName } = await createSession(SESSION_TIME, SCENARIO_ID);
    const entity = makeEntity();
    const actions: RecordedAction[] = [
      {
        type: 'recording/startSession',
        payload: {
          scenarioName: SCENARIO_ID,
          sessionName,
          startTime: SESSION_TIME.getTime(),
          deviceInfo: 'Replay desktop fixture',
        },
      },
      addMeasurementRay(entity.observations[0]),
      addMeasurementRay(entity.observations[1]),
      addMeasurementRay(entity.observations[2]),
      requestConfirmMeasurement(),
      confirmMeasurementSuccess(entity),
    ];

    for (const [index, action] of actions.entries()) {
      await writeAction(action, index + 1);
    }

    await writeSessionMetadata({
      version: 1,
      startedAt: SESSION_TIME.toISOString(),
      endedAt: new Date(SESSION_TIME.getTime() + 1000).toISOString(),
      contextTag: SCENARIO_ID,
      actionCount: actions.length,
      frameCount: 0,
      userAgent: 'Replay desktop fixture',
    });

    const exported = await exportSessionAsZip(sessionName);
    return new Uint8Array(await exported.blob.arrayBuffer());
  } finally {
    resetOpfsStorage();
    cleanup();
  }
}

async function replayMeasurementRecording(zipData: Uint8Array) {
  const recording = await loadRecording(zipData);
  const store = createRecorderStore({
    storageBackend: new NullStorageBackend(),
    enableCompassColdStartOverride: false,
    enableCompassRotationPrior: false,
    enableCompassWebXRConsistency: false,
  });
  const engine = new ReplayEngine();
  await engine.play(
    recording.actions.map((entry) => entry.action),
    store,
    1
  );

  return {
    state: store.getState(),
    replayState: engine.getState(),
    actionCount: recording.actions.length,
  };
}

describe('measurement point desktop replay integration', () => {
  test('replays the persisted measurement entity identically twice', async () => {
    const zipData = await buildMeasurementRecording();
    const first = await replayMeasurementRecording(zipData);
    const second = await replayMeasurementRecording(zipData);

    expect(first.replayState).toBe('completed');
    expect(second.replayState).toBe('completed');
    expect(first.actionCount).toBe(6);

    const firstPoints = selectConfirmedMeasurementPoints(first.state);
    const secondPoints = selectConfirmedMeasurementPoints(second.state);
    expect(firstPoints).toHaveLength(1);
    expect(secondPoints).toHaveLength(1);

    const firstPoint = firstPoints[0];
    const secondPoint = secondPoints[0];
    expect(firstPoint.arPosition).toEqual(secondPoint.arPosition);
    expect(firstPoint.arPosition[0]).toBeCloseTo(5, 6);
    expect(firstPoint.arPosition[1]).toBeCloseTo(0, 6);
    expect(firstPoint.arPosition[2]).toBeCloseTo(-10, 6);
    expect(firstPoint.uncertainty).toBe(secondPoint.uncertainty);
    expect(firstPoint.observations).toEqual(secondPoint.observations);
    expect(firstPoint.inlierIds).toEqual(secondPoint.inlierIds);
    expect(firstPoint.outlierIds).toEqual(secondPoint.outlierIds);
    expect(firstPoint.confirmationMode).toBe('quality');
    expect(firstPoint.confirmationMode).toBe(secondPoint.confirmationMode);
    expect(JSON.stringify(firstPoint)).toBe(JSON.stringify(secondPoint));
  });
});
