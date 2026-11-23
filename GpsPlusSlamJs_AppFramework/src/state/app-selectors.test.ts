/**
 * Tests for app-level memoized selectors.
 *
 * Why these tests matter:
 * These selectors wrap library getter functions with createSelector for
 * standard RTK memoization. They establish a consistent select* naming
 * convention and provide the foundation for subscribeToSelector-based
 * change detection in store subscribers.
 *
 * Key invariants tested:
 * - Null/missing state returns correct fallback (null or empty array)
 * - Same state input → same output reference (memoization)
 * - Different state input with same relevant data → same output reference
 *
 * @see docs/2026-04-07-architecture-observations-consolidated.md §1
 */

import { describe, it, expect } from 'vitest';
import type { CombinedRootState } from './combined-root-state';
import type { GpsModel } from 'gps-plus-slam-js';
import {
  selectAlignmentMatrix,
  selectGpsPositions,
  selectOdometryPositions,
  selectOdometryRotations,
  selectZeroReference,
  selectFrameTilesInWebXR,
} from './app-selectors';
import {
  webxrToNUE,
  webxrQuaternionToNUE,
  normalizeQuaternion,
} from 'gps-plus-slam-js';
import type { ArImageCapture } from 'gps-plus-slam-js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal CombinedRootState with optional gpsData override. */
function makeState(
  gpsData: CombinedRootState['gpsData'] = null
): CombinedRootState {
  return {
    gpsData,
    gpsElements: {} as CombinedRootState['gpsElements'],
    arElements: {} as CombinedRootState['arElements'],
    recording: {} as CombinedRootState['recording'],
    tracking: {} as CombinedRootState['tracking'],
    trackingQuality: {} as CombinedRootState['trackingQuality'],
    arSpaceCorrection: { observations: [] },
  };
}

/** Create a minimal GpsModel for testing. */
function makeGpsData(
  overrides: Partial<GpsModel> = {}
): CombinedRootState['gpsData'] {
  return {
    zero: { lat: 50, lon: 8 },
    gpsEvents: {
      alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      gpsPositions: [],
      odometryPositions: [],
      odometryRotations: [],
      alignmentRotation: [0, 0, 0, 1],
      alignmentTranslation: [0, 0, 0],
      alignmentRotationInDegree: [0, 0, 0],
      gpsPositionsVec4: [],
      odometryPosOffset: [0, 0, 0],
      odometryRotOffset: [0, 0, 0, 1],
      latestLoopClosureFixPointPos: null,
      latestLoopClosureFixPointRot: null,
      gpsAccuracyMedian: null,
      gpsAccuracyMean: null,
      currentGpsPosGeoHash: null,
    },
    odometryPath: { positions: [], rotations: [] },
    ...overrides,
  } as CombinedRootState['gpsData'];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('app-level selectors', () => {
  // --- Null state handling ---

  describe('null gpsData', () => {
    const state = makeState(null);

    it('selectAlignmentMatrix returns null', () => {
      expect(selectAlignmentMatrix(state)).toBeNull();
    });

    it('selectGpsPositions returns empty array', () => {
      expect(selectGpsPositions(state)).toEqual([]);
    });

    it('selectOdometryPositions returns empty array', () => {
      expect(selectOdometryPositions(state)).toEqual([]);
    });

    it('selectOdometryRotations returns empty array', () => {
      expect(selectOdometryRotations(state)).toEqual([]);
    });

    it('selectZeroReference returns null', () => {
      expect(selectZeroReference(state)).toBeNull();
    });
  });

  // --- Non-null state ---

  describe('populated gpsData', () => {
    it('selectAlignmentMatrix returns the matrix', () => {
      const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 5, 5, 1] as const;
      const gpsData = makeGpsData();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- test-only override of opaque state
      (gpsData as any).gpsEvents.alignmentMatrix = matrix;
      const state = makeState(gpsData);
      expect(selectAlignmentMatrix(state)).toBe(matrix);
    });

    it('selectGpsPositions returns GPS positions array', () => {
      const gpsData = makeGpsData();
      const gps = [
        {
          id: '1',
          latitude: 50,
          longitude: 8,
          coordinates: [0, 0, 0] as [number, number, number],
          weight: 1,
          timestamp: 1,
          zeroRef: { lat: 50, lon: 8 },
        },
      ];
      (gpsData as any).gpsEvents.gpsPositions = gps; // eslint-disable-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- test-only override of opaque state
      const state = makeState(gpsData);
      expect(selectGpsPositions(state)).toBe(gps);
    });

    it('selectZeroReference returns the zero ref', () => {
      const zero = { lat: 50.123, lon: 8.456 };
      const gpsData = makeGpsData({ zero });
      const state = makeState(gpsData);
      expect(selectZeroReference(state)).toBe(zero);
    });
  });

  // --- Memoization ---

  describe('memoization', () => {
    it('selectAlignmentMatrix returns same reference for same gpsData', () => {
      // Why: subscribeToSelector relies on reference equality to skip unchanged values
      const gpsData = makeGpsData();
      const state = makeState(gpsData);
      const result1 = selectAlignmentMatrix(state);
      const result2 = selectAlignmentMatrix(state);
      expect(result1).toBe(result2);
    });

    it('selectGpsPositions returns same reference for same gpsData', () => {
      const gpsData = makeGpsData();
      const state = makeState(gpsData);
      const result1 = selectGpsPositions(state);
      const result2 = selectGpsPositions(state);
      expect(result1).toBe(result2);
    });

    it('selectors return stable empty arrays for null gpsData across calls', () => {
      // Why: prevents subscribeToSelector from firing on every dispatch
      // when gpsData is null (e.g., before recording starts)
      const state1 = makeState(null);
      const state2 = makeState(null); // different state object, same gpsData=null

      // Same state → same result
      expect(selectGpsPositions(state1)).toBe(selectGpsPositions(state1));

      // For different state objects but same null gpsData, createSelector
      // will re-evaluate since the input (gpsData) ref changes from the first
      // state to the second state... but null === null, so it should cache.
      // Actually: state1.gpsData === null and state2.gpsData === null
      // null === null → input unchanged → cached result returned
      expect(selectGpsPositions(state1)).toBe(selectGpsPositions(state2));
    });
  });

  // --- selectFrameTilesInWebXR ---

  describe('selectFrameTilesInWebXR', () => {
    // Why: Step 3 of the 2026-05-27 slice-collapse plan replaces the
    // `framesInScene` slice with a memoized selector over
    // `state.gpsData.odometryPath.points`. The library reducer NUE-converts
    // the WebXR pose on the way in (see gpsDataSlice.ts add2dImage), so this
    // selector must convert back to WebXR for the visualizer that lives in
    // the live WebXR scene.

    /** Build a state with `odometryPath.points` set to NUE-converted entries. */
    function makeStateWithPoints(points: ArImageCapture[]): CombinedRootState {
      const gpsData = makeGpsData();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- test-only override of opaque state
      (gpsData as any).odometryPath = { points };
      return makeState(gpsData);
    }

    it('returns a stable empty array when gpsData is null', () => {
      const state = makeState(null);
      const a = selectFrameTilesInWebXR(state);
      const b = selectFrameTilesInWebXR(state);
      expect(a).toEqual([]);
      expect(a).toBe(b);
    });

    it('returns a stable empty array when odometryPath.points is empty', () => {
      const state = makeStateWithPoints([]);
      const a = selectFrameTilesInWebXR(state);
      const b = selectFrameTilesInWebXR(state);
      expect(a).toEqual([]);
      expect(a).toBe(b);
    });

    it('converts each NUE-stored entry back to WebXR coordinates', () => {
      // Round-trip: nueToWebXR(webxrToNUE([1,2,-3])) === [1,2,-3]
      const webxrPosition: [number, number, number] = [1, 2, -3];
      const webxrRotation = normalizeQuaternion([0.1, 0.2, 0.3, 0.9]);
      const nueEntry: ArImageCapture = {
        imageFile: 'frames/frame-000001.jpg',
        position: webxrToNUE(webxrPosition),
        rotation: normalizeQuaternion(webxrQuaternionToNUE(webxrRotation)),
        screenRotation: 90,
        capturedAt: 1_700_000_000_000,
        width: 1080,
        height: 1920,
      };

      const state = makeStateWithPoints([nueEntry]);
      const tiles = selectFrameTilesInWebXR(state);

      expect(tiles).toHaveLength(1);
      const tile = tiles[0];
      expect(tile).toBeDefined();
      if (!tile) return;
      expect(tile.imageFile).toBe('frames/frame-000001.jpg');
      expect(tile.position[0]).toBeCloseTo(webxrPosition[0]);
      expect(tile.position[1]).toBeCloseTo(webxrPosition[1]);
      expect(tile.position[2]).toBeCloseTo(webxrPosition[2]);
      expect(tile.rotation[0]).toBeCloseTo(webxrRotation[0]);
      expect(tile.rotation[1]).toBeCloseTo(webxrRotation[1]);
      expect(tile.rotation[2]).toBeCloseTo(webxrRotation[2]);
      expect(tile.rotation[3]).toBeCloseTo(webxrRotation[3]);
      expect(tile.screenRotation).toBe(90);
      expect(tile.capturedAt).toBe(1_700_000_000_000);
      // Pose-invariant pixel dimensions pass through unchanged (D1 frame-tile
      // aspect-ratio fix): the visualizer needs them to size tiles correctly.
      expect(tile.width).toBe(1080);
      expect(tile.height).toBe(1920);
    });

    it('projects exactly the known ArImageCapture fields (field-drop audit F4)', () => {
      // Why: selectFrameTilesInWebXR is the single gateway from persisted frame
      // records to the AR-space frame-tile visualizer. A compile-time guard in
      // app-selectors.ts forces a conscious decision when ArImageCapture gains a
      // field; this runtime check is its executable companion — it pins the
      // projected key set so a mis-mapped (vs. merely missing) field is caught.
      const nueEntry: ArImageCapture = {
        imageFile: 'frames/frame-000001.jpg',
        position: webxrToNUE([1, 2, -3]),
        rotation: normalizeQuaternion(webxrQuaternionToNUE([0, 0, 0, 1])),
        screenRotation: 0,
        capturedAt: 1_700_000_000_000,
        width: 1080,
        height: 1920,
      };
      const tile = selectFrameTilesInWebXR(makeStateWithPoints([nueEntry]))[0];
      expect(tile).toBeDefined();
      if (!tile) return;
      expect(Object.keys(tile).sort()).toEqual(
        [
          'capturedAt',
          'imageFile',
          'position',
          'rotation',
          'screenRotation',
          'width',
          'height',
        ].sort()
      );
    });

    it('preserves arrival order', () => {
      const points: ArImageCapture[] = [1, 2, 3].map((i) => ({
        imageFile: `frames/frame-${String(i).padStart(6, '0')}.jpg`,
        position: webxrToNUE([i, 0, 0]),
        rotation: normalizeQuaternion(webxrQuaternionToNUE([0, 0, 0, 1])),
        screenRotation: 0,
        capturedAt: 1_700_000_000_000 + i,
      }));
      const state = makeStateWithPoints(points);
      const tiles = selectFrameTilesInWebXR(state);
      expect(tiles.map((t) => t.imageFile)).toEqual([
        'frames/frame-000001.jpg',
        'frames/frame-000002.jpg',
        'frames/frame-000003.jpg',
      ]);
    });

    it('returns the same reference when called twice with the same state', () => {
      // Why: wireFrameTileSubscribers relies on reference equality to skip
      // unchanged selector outputs.
      const state = makeStateWithPoints([
        {
          imageFile: 'frames/frame-000001.jpg',
          position: webxrToNUE([1, 0, 0]),
          rotation: normalizeQuaternion(webxrQuaternionToNUE([0, 0, 0, 1])),
          screenRotation: 0,
        },
      ]);
      const a = selectFrameTilesInWebXR(state);
      const b = selectFrameTilesInWebXR(state);
      expect(a).toBe(b);
    });

    it('returns a new reference when odometryPath.points changes', () => {
      const state1 = makeStateWithPoints([
        {
          imageFile: 'a.jpg',
          position: webxrToNUE([1, 0, 0]),
          rotation: normalizeQuaternion(webxrQuaternionToNUE([0, 0, 0, 1])),
          screenRotation: 0,
        },
      ]);
      const result1 = selectFrameTilesInWebXR(state1);

      const state2 = makeStateWithPoints([
        ...(state1.gpsData?.odometryPath.points ?? []),
        {
          imageFile: 'b.jpg',
          position: webxrToNUE([2, 0, 0]),
          rotation: normalizeQuaternion(webxrQuaternionToNUE([0, 0, 0, 1])),
          screenRotation: 0,
        },
      ]);
      const result2 = selectFrameTilesInWebXR(state2);

      expect(result1).not.toBe(result2);
      expect(result2).toHaveLength(2);
    });

    it('returns the same reference when gpsData changes but points are unchanged', () => {
      // Why: the library reducer uses Immer, so unrelated updates (GPS
      // observations, VIO offsets) produce a NEW gpsData reference while
      // odometryPath.points keeps its reference via structural sharing.
      // Keying the selector on points (not the whole gpsData) preserves
      // referential stability across those dispatches — otherwise
      // wireFrameTileSubscribers would re-run on every GPS/VIO dispatch.
      const points: ArImageCapture[] = [
        {
          imageFile: 'a.jpg',
          position: webxrToNUE([1, 0, 0]),
          rotation: normalizeQuaternion(webxrQuaternionToNUE([0, 0, 0, 1])),
          screenRotation: 0,
        },
      ];
      const state1 = makeStateWithPoints(points);
      const result1 = selectFrameTilesInWebXR(state1);

      // Simulate a GPS/VIO update: brand-new gpsData object reference, but the
      // SAME points array reference (structural sharing).
      const gpsData2 = makeGpsData();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- test-only override of opaque state
      (gpsData2 as any).odometryPath = { points };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access -- mutate an unrelated branch
      (gpsData2 as any).gpsEvents.gpsPositions = [{ id: 'new' }];
      const state2 = makeState(gpsData2);

      expect(state2.gpsData).not.toBe(state1.gpsData);
      const result2 = selectFrameTilesInWebXR(state2);
      expect(result2).toBe(result1);
    });
  });
});
