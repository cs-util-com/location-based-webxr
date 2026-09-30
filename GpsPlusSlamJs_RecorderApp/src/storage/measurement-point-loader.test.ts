/**
 * Tests for measurement-point-loader.ts
 *
 * Covers:
 * - isMeasurementPointEntity type guard (valid, malformed, missing fields, wrong version)
 * - Round-trip serialization: entity → JSON → parse → validate
 */

import { describe, it, expect } from 'vitest';
import {
  isMeasurementPointEntity,
  type MeasurementPointEntity,
  type MeasurementRayRecord,
} from './measurement-point-loader';
import type { Vector3 } from 'gps-plus-slam-app-framework/core';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRayRecord(
  overrides?: Partial<MeasurementRayRecord>
): MeasurementRayRecord {
  return {
    id: 'ray-1',
    timestamp: 1000,
    arPose: {
      position: [1, 2, 3] as Vector3,
      rotation: [0, 0, 0, 1] as readonly [number, number, number, number],
    },
    rayOrigin: [1, 2, 3] as Vector3,
    rayDirection: [0, 0, -1] as Vector3,
    rayWeight: 1.0,
    ...overrides,
  };
}

function makeEntity(
  overrides?: Partial<MeasurementPointEntity>
): MeasurementPointEntity {
  return {
    schemaVersion: 1,
    id: 'mp-1',
    createdAt: 1000,
    updatedAt: 1000,
    scenarioId: 'test-scenario',
    observations: [makeRayRecord()],
    arPosition: [5, 6, 7] as Vector3,
    gpsPositionSnapshot: [48.0, 11.0, 500] as Vector3,
    uncertainty: 0.1,
    rmsError: 0.05,
    inlierIds: ['ray-1'],
    outlierIds: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isMeasurementPointEntity
// ---------------------------------------------------------------------------

describe('isMeasurementPointEntity', () => {
  it('accepts a valid entity', () => {
    expect(isMeasurementPointEntity(makeEntity())).toBe(true);
  });

  it('accepts entity with depth prior on ray', () => {
    const entity = makeEntity({
      observations: [
        makeRayRecord({
          depthPoint: [2, 3, 4] as Vector3,
          depthWeight: 0.5,
        }),
      ],
    });
    expect(isMeasurementPointEntity(entity)).toBe(true);
  });

  it('rejects null', () => {
    expect(isMeasurementPointEntity(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isMeasurementPointEntity(undefined)).toBe(false);
  });

  it('rejects non-object', () => {
    expect(isMeasurementPointEntity('not an object')).toBe(false);
  });

  it('rejects wrong schemaVersion', () => {
    const entity = { ...makeEntity(), schemaVersion: 2 };
    expect(isMeasurementPointEntity(entity)).toBe(false);
  });

  it('rejects missing schemaVersion', () => {
    const { schemaVersion: _, ...rest } = makeEntity();
    expect(isMeasurementPointEntity(rest)).toBe(false);
  });

  it('rejects missing id', () => {
    const { id: _, ...rest } = makeEntity();
    expect(isMeasurementPointEntity(rest)).toBe(false);
  });

  it('rejects missing arPosition', () => {
    const { arPosition: _, ...rest } = makeEntity();
    expect(isMeasurementPointEntity(rest)).toBe(false);
  });

  it('rejects invalid arPosition (not a 3-tuple)', () => {
    const entity = { ...makeEntity(), arPosition: [1, 2] };
    expect(isMeasurementPointEntity(entity)).toBe(false);
  });

  it('rejects missing gpsPositionSnapshot', () => {
    const { gpsPositionSnapshot: _, ...rest } = makeEntity();
    expect(isMeasurementPointEntity(rest)).toBe(false);
  });

  it('rejects missing inlierIds', () => {
    const { inlierIds: _, ...rest } = makeEntity();
    expect(isMeasurementPointEntity(rest)).toBe(false);
  });

  it('rejects missing outlierIds', () => {
    const { outlierIds: _, ...rest } = makeEntity();
    expect(isMeasurementPointEntity(rest)).toBe(false);
  });

  it('rejects missing observations', () => {
    const { observations: _, ...rest } = makeEntity();
    expect(isMeasurementPointEntity(rest)).toBe(false);
  });

  it('rejects observation without arPose', () => {
    const { arPose: _arPose, ...badRay } = makeRayRecord();
    const entity = makeEntity({
      observations: [badRay as unknown as MeasurementRayRecord],
    });
    expect(isMeasurementPointEntity(entity)).toBe(false);
  });

  it('rejects observation without rayOrigin', () => {
    const { rayOrigin: _rayOrigin, ...badRay } = makeRayRecord();
    const entity = makeEntity({
      observations: [badRay as unknown as MeasurementRayRecord],
    });
    expect(isMeasurementPointEntity(entity)).toBe(false);
  });

  it('rejects observation without rayDirection', () => {
    const { rayDirection: _rayDirection, ...badRay } = makeRayRecord();
    const entity = makeEntity({
      observations: [badRay as unknown as MeasurementRayRecord],
    });
    expect(isMeasurementPointEntity(entity)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Round-trip serialization
// ---------------------------------------------------------------------------

describe('JSON round-trip', () => {
  it('entity survives JSON.stringify → JSON.parse', () => {
    const original = makeEntity();
    const json = JSON.stringify(original);
    const parsed: unknown = JSON.parse(json);
    expect(isMeasurementPointEntity(parsed)).toBe(true);
    const recovered = parsed as MeasurementPointEntity;
    expect(recovered.id).toBe(original.id);
    expect(recovered.arPosition).toEqual(original.arPosition);
    expect(recovered.gpsPositionSnapshot).toEqual(original.gpsPositionSnapshot);
    expect(recovered.observations).toHaveLength(1);
    expect(recovered.inlierIds).toEqual(['ray-1']);
    expect(recovered.outlierIds).toEqual([]);
  });

  it('entity with depth priors survives round-trip', () => {
    const original = makeEntity({
      observations: [
        makeRayRecord({
          depthPoint: [2, 3, 4] as Vector3,
          depthWeight: 0.5,
        }),
      ],
    });
    const json = JSON.stringify(original);
    const parsed: unknown = JSON.parse(json);
    expect(isMeasurementPointEntity(parsed)).toBe(true);
    const recovered = parsed as MeasurementPointEntity;
    expect(recovered.observations[0]!.depthPoint).toEqual([2, 3, 4]);
    expect(recovered.observations[0]!.depthWeight).toBe(0.5);
  });

  it('entity with multiple observations survives round-trip', () => {
    const original = makeEntity({
      observations: [
        makeRayRecord({ id: 'ray-1' }),
        makeRayRecord({ id: 'ray-2', timestamp: 2000 }),
        makeRayRecord({ id: 'ray-3', timestamp: 3000 }),
      ],
      inlierIds: ['ray-1', 'ray-2'],
      outlierIds: ['ray-3'],
    });
    const json = JSON.stringify(original);
    const parsed: unknown = JSON.parse(json);
    expect(isMeasurementPointEntity(parsed)).toBe(true);
    const recovered = parsed as MeasurementPointEntity;
    expect(recovered.observations).toHaveLength(3);
    expect(recovered.inlierIds).toEqual(['ray-1', 'ray-2']);
    expect(recovered.outlierIds).toEqual(['ray-3']);
  });
});
