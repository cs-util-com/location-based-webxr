/**
 * Measurement Point Integration Test
 *
 * Phase 2 of the integration plan — verifies the full flow:
 * shoot N rays → confirm → persist → load → verify entity equality.
 * Also tests draft state transitions, replay guard, and hydration dedup.
 */

import { describe, expect, test } from 'vitest';
import {
  addMeasurementRay,
  confirmMeasurementSuccess,
  undoMeasurementRay,
  requestConfirmMeasurement,
  confirmMeasurementFailure,
  hydrateMeasurementPoints,
  selectProvisionalMeasurement,
  selectConfirmedMeasurementPoints,
  selectMeasurementDraft,
  measurementPointsReducer,
  type MeasurementPointsState,
} from '../state/measurement-points-slice';
import type {
  MeasurementRayRecord,
  MeasurementPointEntity,
} from '../storage/measurement-point-loader';
import type { CombinedRootState } from '../state/recorder-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a synthetic MeasurementRayRecord for testing.
 * Origin offsets laterally so rays have parallax for triangulation.
 */
function makeRay(
  index: number,
  overrides: Partial<MeasurementRayRecord> = {}
): MeasurementRayRecord {
  // Spread rays laterally along X axis, all aiming at z = -10
  const xOffset = index * 2; // 2m lateral separation per ray
  const target = [5, 0, -10] as const;
  const origin = [xOffset, 0, 0] as const;
  const dx = target[0] - origin[0];
  const dy = target[1] - origin[1];
  const dz = target[2] - origin[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

  return {
    id: `test-ray-${index}`,
    timestamp: 1000 + index * 100,
    arPose: {
      position: [origin[0], origin[1], origin[2]],
      rotation: [0, 0, 0, 1],
    },
    rayOrigin: [origin[0], origin[1], origin[2]],
    rayDirection: [dx / len, dy / len, dz / len],
    rayWeight: 1.0,
    depthPoint: [target[0], target[1], target[2]],
    depthWeight: 0.5,
    ...overrides,
  };
}

function makeEntity(id: string): MeasurementPointEntity {
  return {
    schemaVersion: 1,
    id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    scenarioId: 'test-scenario',
    observations: [makeRay(0), makeRay(1)],
    arPosition: [5, 0, -10],
    gpsPositionSnapshot: null,
    uncertainty: 0.01,
    rmsError: 0.001,
    inlierIds: ['test-ray-0', 'test-ray-1'],
    outlierIds: [],
  };
}

/**
 * Build a minimal CombinedRootState-shaped object for selector testing.
 * Only the measurementPoints field is populated.
 */
function asRootState(mpState: MeasurementPointsState): CombinedRootState {
  return { measurementPoints: mpState } as unknown as CombinedRootState;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Measurement Point Integration', () => {
  // ── Ray accumulation + provisional solution ──────────────────────────

  test('dispatching N rays produces a provisional triangulation result', () => {
    let state = measurementPointsReducer(undefined, { type: '@@INIT' });

    // Add 3 rays with lateral separation
    for (let i = 0; i < 3; i++) {
      state = measurementPointsReducer(state, addMeasurementRay(makeRay(i)));
    }

    expect(state.pendingRays).toHaveLength(3);

    // Selector should produce a solution
    const result = selectProvisionalMeasurement(asRootState(state));
    expect(result).not.toBeNull();
    expect(result!.point).toBeDefined();
    expect(result!.inlierIds.length).toBeGreaterThanOrEqual(2);
  });

  test('one ray with a valid depth prior produces a provisional point', () => {
    let state = measurementPointsReducer(undefined, { type: '@@INIT' });
    state = measurementPointsReducer(state, addMeasurementRay(makeRay(0)));

    const result = selectProvisionalMeasurement(asRootState(state));
    expect(result).not.toBeNull();
    expect(result!.point[0]).toBeCloseTo(5, 6);
    expect(result!.point[1]).toBeCloseTo(0, 6);
    expect(result!.point[2]).toBeCloseTo(-10, 6);
    expect(state.draft.provisionalPointAr).toBeDefined();
    expect(state.draft.canConfirm).toBe(false);
  });

  test('blocks quality readiness when pose and depth timestamps are skewed', () => {
    let state = measurementPointsReducer(undefined, { type: '@@INIT' });
    state = measurementPointsReducer(
      state,
      addMeasurementRay(
        makeRay(0, { depthTimestamp: 1000, timestamp: 1000 + 500 })
      )
    );

    expect(state.draft.canConfirm).toBe(false);
    expect(state.draft.prompt).not.toBe('ready_to_confirm');
  });

  // ── Draft state transitions ──────────────────────────────────────────

  test('draft transitions: idle → provisional → refining as rays accumulate', () => {
    let state = measurementPointsReducer(undefined, { type: '@@INIT' });

    // Start: idle
    expect(state.draft.status).toBe('idle');
    expect(state.draft.canConfirm).toBe(false);

    // First ray with depth → provisional
    state = measurementPointsReducer(state, addMeasurementRay(makeRay(0)));
    // May stay idle if solver can't solve with 1 ray
    // (depends on depth prior strength)
    expect(['idle', 'provisional']).toContain(state.draft.status);

    // Add more rays → should progress
    state = measurementPointsReducer(state, addMeasurementRay(makeRay(1)));
    state = measurementPointsReducer(state, addMeasurementRay(makeRay(2)));

    // With 3 well-spread rays, should be at least provisional
    expect(state.draft.status).not.toBe('idle');
  });

  // ── Confirm async flow (FIX 6) ──────────────────────────────────────

  test('confirm flow: requestConfirm → success moves to confirmed', () => {
    let state = measurementPointsReducer(undefined, { type: '@@INIT' });

    // Accumulate rays
    for (let i = 0; i < 3; i++) {
      state = measurementPointsReducer(state, addMeasurementRay(makeRay(i)));
    }

    // Request confirm
    state = measurementPointsReducer(state, requestConfirmMeasurement());
    // Draft should be confirm_pending (or unchanged if status doesn't allow)
    // Since we're in a non-ready state potentially, the lifecycle handler may no-op
    // but the action still dispatches

    // Confirm success
    const entity = makeEntity('mp-1');
    state = measurementPointsReducer(state, confirmMeasurementSuccess(entity));

    expect(state.confirmed).toHaveLength(1);
    expect(state.confirmed[0].id).toBe('mp-1');
    expect(state.pendingRays).toHaveLength(0);
  });

  test('confirm flow: requestConfirm → failure leaves pending rays intact', () => {
    let state = measurementPointsReducer(undefined, { type: '@@INIT' });

    // Accumulate rays
    for (let i = 0; i < 3; i++) {
      state = measurementPointsReducer(state, addMeasurementRay(makeRay(i)));
    }

    state = measurementPointsReducer(state, requestConfirmMeasurement());
    state = measurementPointsReducer(state, confirmMeasurementFailure());

    // Pending rays should still be there for retry
    expect(state.pendingRays.length).toBeGreaterThan(0);
    expect(state.confirmed).toHaveLength(0);
  });

  // ── Undo ────────────────────────────────────────────────────────────

  test('undo removes the last ray and updates draft', () => {
    let state = measurementPointsReducer(undefined, { type: '@@INIT' });

    state = measurementPointsReducer(state, addMeasurementRay(makeRay(0)));
    state = measurementPointsReducer(state, addMeasurementRay(makeRay(1)));
    expect(state.pendingRays).toHaveLength(2);

    state = measurementPointsReducer(state, undoMeasurementRay());
    expect(state.pendingRays).toHaveLength(1);
    expect(state.pendingRays[0].id).toBe('test-ray-0');
  });

  // ── GPS snapshot nullable (FIX 3) ───────────────────────────────────

  test('gpsPositionSnapshot is null when no alignment matrix exists', () => {
    const entity = makeEntity('mp-null-gps');
    expect(entity.gpsPositionSnapshot).toBeNull();

    // Confirm with null GPS → Redux state stores it as null
    let state = measurementPointsReducer(undefined, { type: '@@INIT' });
    state = measurementPointsReducer(state, confirmMeasurementSuccess(entity));

    expect(state.confirmed[0].gpsPositionSnapshot).toBeNull();
  });

  // ── Hydration dedup (FIX 5) ─────────────────────────────────────────

  test('hydrateMeasurementPoints deduplicates by id', () => {
    let state = measurementPointsReducer(undefined, { type: '@@INIT' });

    // Pre-load via confirm
    const entity = makeEntity('mp-dedup');
    state = measurementPointsReducer(state, confirmMeasurementSuccess(entity));
    expect(state.confirmed).toHaveLength(1);

    // Hydrate with the same entity + a new one
    const newEntity = makeEntity('mp-new');
    state = measurementPointsReducer(
      state,
      hydrateMeasurementPoints([entity, newEntity])
    );

    // Should have 2, not 3 (dedup removed the duplicate)
    expect(state.confirmed).toHaveLength(2);
    expect(state.confirmed.map((e) => e.id).sort()).toEqual([
      'mp-dedup',
      'mp-new',
    ]);
  });

  // ── Selector correctness (FIX 4) ───────────────────────────────────

  test('selectConfirmedMeasurementPoints returns confirmed list', () => {
    let state = measurementPointsReducer(undefined, { type: '@@INIT' });
    const entity = makeEntity('mp-sel');
    state = measurementPointsReducer(state, confirmMeasurementSuccess(entity));

    const confirmed = selectConfirmedMeasurementPoints(asRootState(state));
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].id).toBe('mp-sel');
  });

  test('selectMeasurementDraft returns current draft', () => {
    const state = measurementPointsReducer(undefined, { type: '@@INIT' });
    const draft = selectMeasurementDraft(asRootState(state));
    expect(draft.status).toBe('idle');
    expect(draft.canConfirm).toBe(false);
  });

  // ── InlierIds / OutlierIds reference valid ray IDs ──────────────────

  test('inlierIds and outlierIds reference valid ray IDs', () => {
    let state = measurementPointsReducer(undefined, { type: '@@INIT' });

    for (let i = 0; i < 4; i++) {
      state = measurementPointsReducer(state, addMeasurementRay(makeRay(i)));
    }

    const provisional = selectProvisionalMeasurement(asRootState(state));
    expect(provisional).not.toBeNull();

    const allRayIds = state.pendingRays.map((r) => r.id);
    const allRefIds = [...provisional!.inlierIds, ...provisional!.outlierIds];

    // Every referenced ID should be in the pending rays
    for (const refId of allRefIds) {
      expect(allRayIds).toContain(refId);
    }

    // Every ray should be classified as either inlier or outlier
    for (const rayId of allRayIds) {
      const isInlier = provisional!.inlierIds.includes(rayId);
      const isOutlier = provisional!.outlierIds.includes(rayId);
      expect(isInlier || isOutlier).toBe(true);
    }
  });

  test('replaying the persisted measurement lifecycle is deterministic', () => {
    const entity = {
      ...makeEntity('mp-replay'),
      confirmationMode: 'quality' as const,
    };
    const actions = [
      addMeasurementRay(makeRay(0)),
      addMeasurementRay(makeRay(1)),
      addMeasurementRay(makeRay(2)),
      requestConfirmMeasurement(),
      confirmMeasurementSuccess(entity),
    ];

    function replay(): MeasurementPointsState {
      return actions.reduce(
        (state, action) => measurementPointsReducer(state, action),
        measurementPointsReducer(undefined, { type: '@@INIT' })
      );
    }

    const first = replay();
    const second = replay();
    expect(first).toEqual(second);
    expect(first.confirmed).toEqual([entity]);
    expect(first.pendingRays).toHaveLength(0);
  });

  test('override confirmation mode is retained on the confirmed entity', () => {
    const entity = {
      ...makeEntity('mp-override'),
      confirmationMode: 'override' as const,
    };
    const state = measurementPointsReducer(
      undefined,
      confirmMeasurementSuccess(entity)
    );

    expect(state.confirmed[0].confirmationMode).toBe('override');
  });

  test('override confirmation transitions a refining draft to confirmed', () => {
    let state = measurementPointsReducer(undefined, { type: '@@INIT' });
    state = measurementPointsReducer(state, addMeasurementRay(makeRay(0)));
    expect(state.draft.status).toBe('provisional');

    state = measurementPointsReducer(
      state,
      requestConfirmMeasurement({ confirmationMode: 'override' })
    );
    expect(state.draft.status).toBe('confirm_pending');

    state = measurementPointsReducer(
      state,
      confirmMeasurementSuccess(makeEntity('mp-override-lifecycle'))
    );
    expect(state.draft.status).toBe('confirmed');
    expect(state.pendingRays).toHaveLength(0);
  });
});
