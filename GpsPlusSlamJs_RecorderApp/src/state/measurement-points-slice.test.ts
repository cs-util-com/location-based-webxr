/**
 * Tests for measurement-points-slice.ts
 *
 * Covers:
 * - addMeasurementRay: appends to pending
 * - confirmMeasurementPoint: moves to confirmed, clears pending
 * - deleteMeasurementPoint: removes from confirmed
 * - undoMeasurementRay: pops last pending ray
 * - resetMeasurementPoints: clears all state
 * - selectProvisionalMeasurement: runs solver on pending rays
 */

import { describe, it, expect } from 'vitest';
import {
  measurementPointsReducer,
  addMeasurementRay,
  confirmMeasurementPoint,
  deleteMeasurementPoint,
  undoMeasurementRay,
  resetMeasurementPoints,
  selectProvisionalMeasurement,
  selectPendingRays,
  selectConfirmedMeasurementPoints,
  DEFAULT_QUALITY_THRESHOLDS,
  type MeasurementPointsState,
} from './measurement-points-slice';
import type {
  MeasurementRayRecord,
  MeasurementPointEntity,
} from '../storage/measurement-point-loader';
import type { CombinedRootState } from './recorder-store';
import type { Vector3 } from 'gps-plus-slam-app-framework/core';

/** Wrap MeasurementPointsState as a CombinedRootState for selector calls (FIX 4). */
function asRootState(mpState: MeasurementPointsState): CombinedRootState {
  return { measurementPoints: mpState } as unknown as CombinedRootState;
}

const INITIAL_DRAFT = {
  status: 'idle' as const,
  prompt: 'none' as const,
  canConfirm: false,
  lastQualityScore: 0,
  thresholdProfileId: DEFAULT_QUALITY_THRESHOLDS.thresholdProfileId,
  thresholdVersion: DEFAULT_QUALITY_THRESHOLDS.thresholdVersion,
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRay(
  id: string,
  origin: Vector3 = [0, 0, 0],
  overrides: Partial<MeasurementRayRecord> = {}
): MeasurementRayRecord {
  return {
    id,
    timestamp: Date.now(),
    arPose: {
      position: origin,
      rotation: [0, 0, 0, 1] as readonly [number, number, number, number],
    },
    rayOrigin: origin,
    rayDirection: [0, 0, -1] as Vector3,
    rayWeight: 1.0,
    ...overrides,
  };
}

function makeEntity(id: string): MeasurementPointEntity {
  return {
    schemaVersion: 1,
    id,
    createdAt: 1000,
    updatedAt: 1000,
    scenarioId: 'test',
    observations: [makeRay('ray-1')],
    arPosition: [1, 2, 3] as Vector3,
    gpsPositionSnapshot: [48, 11, 500] as Vector3,
    uncertainty: 0.1,
    rmsError: 0.05,
    inlierIds: ['ray-1'],
    outlierIds: [],
  };
}

const initialState: MeasurementPointsState = {
  pendingRays: [],
  confirmed: [],
  draft: INITIAL_DRAFT,
};

// ---------------------------------------------------------------------------
// Reducer tests
// ---------------------------------------------------------------------------

describe('measurementPointsReducer', () => {
  it('returns initial state', () => {
    const state = measurementPointsReducer(undefined, { type: 'unknown' });
    expect(state.pendingRays).toEqual([]);
    expect(state.confirmed).toEqual([]);
  });

  describe('addMeasurementRay', () => {
    it('appends ray to pending list', () => {
      const ray = makeRay('ray-1');
      const state = measurementPointsReducer(
        initialState,
        addMeasurementRay(ray)
      );
      expect(state.pendingRays).toHaveLength(1);
      expect(state.pendingRays[0]!.id).toBe('ray-1');
    });

    it('appends multiple rays in order', () => {
      let state = measurementPointsReducer(
        initialState,
        addMeasurementRay(makeRay('ray-1'))
      );
      state = measurementPointsReducer(
        state,
        addMeasurementRay(makeRay('ray-2'))
      );
      state = measurementPointsReducer(
        state,
        addMeasurementRay(makeRay('ray-3'))
      );
      expect(state.pendingRays).toHaveLength(3);
      expect(state.pendingRays.map((r) => r.id)).toEqual([
        'ray-1',
        'ray-2',
        'ray-3',
      ]);
    });
  });

  describe('confirmMeasurementPoint', () => {
    it('adds entity to confirmed and clears pending', () => {
      const withRays: MeasurementPointsState = {
        pendingRays: [makeRay('ray-1'), makeRay('ray-2')],
        confirmed: [],
        draft: INITIAL_DRAFT,
      };
      const entity = makeEntity('mp-1');
      const state = measurementPointsReducer(
        withRays,
        confirmMeasurementPoint(entity)
      );
      expect(state.confirmed).toHaveLength(1);
      expect(state.confirmed[0]!.id).toBe('mp-1');
      expect(state.pendingRays).toHaveLength(0);
    });
  });

  describe('deleteMeasurementPoint', () => {
    it('removes entity by id', () => {
      const withConfirmed: MeasurementPointsState = {
        pendingRays: [],
        confirmed: [makeEntity('mp-1'), makeEntity('mp-2')],
        draft: INITIAL_DRAFT,
      };
      const state = measurementPointsReducer(
        withConfirmed,
        deleteMeasurementPoint({ id: 'mp-1' })
      );
      expect(state.confirmed).toHaveLength(1);
      expect(state.confirmed[0]!.id).toBe('mp-2');
    });

    it('no-ops for non-existent id', () => {
      const withConfirmed: MeasurementPointsState = {
        pendingRays: [],
        confirmed: [makeEntity('mp-1')],
        draft: INITIAL_DRAFT,
      };
      const state = measurementPointsReducer(
        withConfirmed,
        deleteMeasurementPoint({ id: 'mp-999' })
      );
      expect(state.confirmed).toHaveLength(1);
    });
  });

  describe('undoMeasurementRay', () => {
    it('pops the last ray', () => {
      const withRays: MeasurementPointsState = {
        pendingRays: [makeRay('ray-1'), makeRay('ray-2')],
        confirmed: [],
        draft: INITIAL_DRAFT,
      };
      const state = measurementPointsReducer(withRays, undoMeasurementRay());
      expect(state.pendingRays).toHaveLength(1);
      expect(state.pendingRays[0]!.id).toBe('ray-1');
    });

    it('no-ops on empty pending list', () => {
      const state = measurementPointsReducer(
        initialState,
        undoMeasurementRay()
      );
      expect(state.pendingRays).toHaveLength(0);
    });
  });

  describe('resetMeasurementPoints', () => {
    it('clears all state', () => {
      const withData: MeasurementPointsState = {
        pendingRays: [makeRay('ray-1')],
        confirmed: [makeEntity('mp-1')],
        draft: INITIAL_DRAFT,
      };
      const state = measurementPointsReducer(
        withData,
        resetMeasurementPoints()
      );
      expect(state.pendingRays).toEqual([]);
      expect(state.confirmed).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// Selector tests
// ---------------------------------------------------------------------------

describe('selectPendingRays', () => {
  it('returns stable empty sentinel for empty state', () => {
    const root = asRootState(initialState);
    const result1 = selectPendingRays(root);
    const result2 = selectPendingRays(root);
    expect(result1).toBe(result2); // Same reference
    expect(result1).toHaveLength(0);
  });

  it('returns rays when present', () => {
    const state: MeasurementPointsState = {
      pendingRays: [makeRay('ray-1')],
      confirmed: [],
      draft: INITIAL_DRAFT,
    };
    const result = selectPendingRays(asRootState(state));
    expect(result).toHaveLength(1);
  });
});

describe('selectConfirmedMeasurementPoints', () => {
  it('returns stable empty sentinel for empty state', () => {
    const root = asRootState(initialState);
    const result1 = selectConfirmedMeasurementPoints(root);
    const result2 = selectConfirmedMeasurementPoints(root);
    expect(result1).toBe(result2);
    expect(result1).toHaveLength(0);
  });
});

describe('selectProvisionalMeasurement', () => {
  it('returns null for empty pending rays', () => {
    const result = selectProvisionalMeasurement(asRootState(initialState));
    expect(result).toBeNull();
  });

  it('returns a result for two well-angled rays', () => {
    // Two rays from different origins aiming at the same point
    const state: MeasurementPointsState = {
      pendingRays: [
        makeRay('ray-1', [0, 0, 0]),
        {
          ...makeRay('ray-2', [10, 0, 0]),
          // Aim toward (5, 0, -5) from (10, 0, 0) → direction (-5, 0, -5) normalized
          rayDirection: [-0.7071, 0, -0.7071] as Vector3,
        },
      ],
      confirmed: [],
      draft: INITIAL_DRAFT,
    };
    const result = selectProvisionalMeasurement(asRootState(state));
    // With two rays, the solver should find a point.
    // The exact result depends on the solver, but it should not be null.
    expect(result).not.toBeNull();
    expect(result!.point).toBeDefined();
    expect(result!.uncertainty).toBeDefined();
    expect(typeof result!.hasSufficientBaseline).toBe('boolean');
  });

  it('returns null for single ray without depth', () => {
    const state: MeasurementPointsState = {
      pendingRays: [makeRay('ray-1')],
      confirmed: [],
      draft: INITIAL_DRAFT,
    };
    const result = selectProvisionalMeasurement(asRootState(state));
    // Single ray without depth → solver returns null
    expect(result).toBeNull();
  });

  it('returns a result for single ray with depth', () => {
    const state: MeasurementPointsState = {
      pendingRays: [
        {
          ...makeRay('ray-1'),
          depthPoint: [0, 0, -2] as Vector3,
          depthWeight: 0.5,
        },
      ],
      confirmed: [],
      draft: INITIAL_DRAFT,
    };
    const result = selectProvisionalMeasurement(asRootState(state));
    expect(result).not.toBeNull();
    expect(result!.hasSufficientBaseline).toBe(false);
  });
});
