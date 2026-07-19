/**
 * Tests for recording-options.ts
 *
 * Why these tests matter:
 * - Validates localStorage persistence works correctly
 * - Ensures validation clamps invalid values to safe ranges
 * - Confirms schema evolution (partial stored data) merges with defaults
 * - Guards against regression in option loading/saving
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE,
  DEFAULT_RECONSTRUCTION_DEPTH_INTERVAL_MS,
} from 'gps-plus-slam-app-framework/ar/depth-sampler';
import {
  loadRecordingOptions,
  saveRecordingOptions,
  resetRecordingOptions,
  validateDepthOptions,
  validateImageOptions,
  validateOccupancyOptions,
  validateFrameTileDisplayOptions,
  validateVisualizationOptions,
  validateCompassDebugOptions,
  validateLoopClosureDebugOptions,
  validateQrOptions,
  validateMotionFilterOptions,
  validateQualityFilterOptions,
  validateRecordingOptions,
  cloneRecordingOptions,
  DEFAULT_RECORDING_OPTIONS,
  STORAGE_KEY,
  DEPTH_CONSTRAINTS,
  IMAGE_CONSTRAINTS,
  MOTION_FILTER_CONSTRAINTS,
  QUALITY_FILTER_CONSTRAINTS,
  OCCUPANCY_CONSTRAINTS,
  FRAME_TILE_DISPLAY_CONSTRAINTS,
  QR_CONSTRAINTS,
  type RecordingOptions,
  type OccupancyOptions,
} from './recording-options';
import {
  DEFAULT_OCCUPANCY_CELL_SIZE_M,
  DEFAULT_OCCUPANCY_MIN_OBSERVATIONS,
} from 'gps-plus-slam-app-framework/ar/occupancy-grid';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
});

describe('recording-options', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe('origin-isolation invariant', () => {
    // Why this test matters: the multi-app subpath deployment serves the
    // recorder (/recorder/) and the anchor starter (/starter/) from one
    // origin (gps.csutil.com). Browser storage is keyed by origin, not path,
    // so the apps would silently share localStorage if their keys collided.
    // The starter uses `gps-plus-slam-anchor-starter:*`; the recorder MUST
    // keep its own `gps-plus-slam-recorder` prefix so the namespaces stay
    // disjoint. See docs: 2026-06-01-0424-multi-app-subpath-deployment-plan.md
    // (Step 6).
    it('namespaces its localStorage key under the app-specific prefix', () => {
      expect(STORAGE_KEY).toMatch(/^gps-plus-slam-recorder/);
    });
  });

  describe('validateDepthOptions', () => {
    it('returns defaults when given empty object', () => {
      const result = validateDepthOptions({});
      expect(result).toEqual(DEFAULT_RECORDING_OPTIONS.depth);
    });

    it('preserves valid values', () => {
      const result = validateDepthOptions({
        enabled: false,
        intervalMs: 2000,
        gridSize: 5,
        rgb: false,
      });
      expect(result).toEqual({
        enabled: false,
        intervalMs: 2000,
        gridSize: 5,
        rgb: false,
      });
    });

    /**
     * Why this test matters (occupancy-grid port plan Iter 8): the RGB
     * voxel-coloring option must default ON, and persisted options from
     * before the option existed (no `rgb` key) or corrupted values must
     * fall back to the default rather than silently disabling the feature.
     */
    it('defaults rgb to true and rejects non-boolean values', () => {
      expect(validateDepthOptions({}).rgb).toBe(true);
      expect(
        validateDepthOptions({ rgb: 'on' as unknown as boolean }).rgb
      ).toBe(true);
      expect(validateDepthOptions({ rgb: false }).rgb).toBe(false);
    });

    it('defaults to the framework reconstruction cadence (200 ms × gridSize 24)', () => {
      // Why this test matters: both reconstruction apps must share ONE depth
      // tuning source or they visibly drift apart (the demo-vs-recorder speed
      // gap, 2026-07-16). Values from the maintainer's 2026-07-16 on-device
      // framerate/mesh trade-off pass — the sweep-derived 500 ms × 64 hurt
      // the framerate (8192 points/s); 24² @ 2 s keeps rendering smooth.
      expect(DEFAULT_RECORDING_OPTIONS.depth.intervalMs).toBe(
        DEFAULT_RECONSTRUCTION_DEPTH_INTERVAL_MS
      );
      expect(DEFAULT_RECORDING_OPTIONS.depth.gridSize).toBe(
        DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE
      );
      expect(DEFAULT_RECORDING_OPTIONS.depth.gridSize).toBe(24);
      expect(DEFAULT_RECORDING_OPTIONS.depth.intervalMs).toBe(200);
    });

    it('clamps intervalMs below minimum to minimum', () => {
      const result = validateDepthOptions({ intervalMs: 30 });
      expect(result.intervalMs).toBe(DEPTH_CONSTRAINTS.intervalMs.min);
    });

    it('accepts dense-capture intervals down to 100 ms unclamped', () => {
      // Why this test matters (2026-07-16 superset-capture strategy): dense
      // validation recordings are captured at high rate + high gridSize and
      // DECIMATED in replay to simulate every slower configuration — a
      // recording can only ever be thinned, never densified. The old 500 ms
      // floor made such supersets impossible; 100 and 250 must now pass
      // through validation verbatim (the sampler emits at most once per XR
      // frame, so an over-ambitious interval degrades gracefully on-device).
      expect(validateDepthOptions({ intervalMs: 100 }).intervalMs).toBe(100);
      expect(validateDepthOptions({ intervalMs: 250 }).intervalMs).toBe(250);
    });

    it('clamps intervalMs above maximum to maximum', () => {
      const result = validateDepthOptions({ intervalMs: 10000 });
      expect(result.intervalMs).toBe(DEPTH_CONSTRAINTS.intervalMs.max);
    });

    it('clamps gridSize below minimum to minimum', () => {
      const result = validateDepthOptions({ gridSize: 1 });
      expect(result.gridSize).toBe(DEPTH_CONSTRAINTS.gridSize.min);
    });

    it('clamps gridSize above maximum to maximum', () => {
      const result = validateDepthOptions({ gridSize: 100 });
      expect(result.gridSize).toBe(DEPTH_CONSTRAINTS.gridSize.max);
    });

    /**
     * Why this test matters: `gridSize` is an N×N grid dimension, so it must be
     * an integer. `DepthSampler.updateConfig` rejects a fractional gridSize, but
     * `validateDepthOptions` previously only clamped the range — letting a value
     * like 2.5 survive as "valid" and then silently fall back to the sampler's
     * default at runtime (the two validation layers disagreed). The sanitizer
     * must round so its output always applies downstream.
     */
    it('rounds a fractional gridSize to an integer', () => {
      expect(
        Number.isInteger(validateDepthOptions({ gridSize: 2.5 }).gridSize)
      ).toBe(true);
      expect(validateDepthOptions({ gridSize: 4.4 }).gridSize).toBe(4);
    });

    it('handles non-boolean enabled by using default', () => {
      const result = validateDepthOptions({
        enabled: 'yes' as unknown as boolean,
      });
      expect(result.enabled).toBe(DEFAULT_RECORDING_OPTIONS.depth.enabled);
    });

    it('handles non-number intervalMs by using default', () => {
      const result = validateDepthOptions({
        intervalMs: 'fast' as unknown as number,
      });
      expect(result.intervalMs).toBe(
        DEFAULT_RECORDING_OPTIONS.depth.intervalMs
      );
    });
  });

  describe('validateImageOptions', () => {
    it('returns defaults when given empty object', () => {
      const result = validateImageOptions({});
      expect(result).toEqual(DEFAULT_RECORDING_OPTIONS.images);
    });

    it('preserves valid values', () => {
      const result = validateImageOptions({
        enabled: false,
        intervalMs: 5000,
        quality: 0.5,
        resolutionDivisor: 2,
      });
      expect(result).toEqual({
        enabled: false,
        intervalMs: 5000,
        quality: 0.5,
        resolutionDivisor: 2,
        // motionFilter / qualityFilter not supplied → default-filled (backward compat).
        motionFilter: DEFAULT_RECORDING_OPTIONS.images.motionFilter,
        qualityFilter: DEFAULT_RECORDING_OPTIONS.images.qualityFilter,
      });
    });

    it('default-fills motionFilter when missing (pre-feature persisted options)', () => {
      // A persisted options object from before this feature lacks motionFilter
      // entirely; it must load with the gate enabled rather than crash.
      const result = validateImageOptions({ quality: 0.5 });
      expect(result.motionFilter).toEqual(
        DEFAULT_RECORDING_OPTIONS.images.motionFilter
      );
      expect(result.motionFilter.enabled).toBe(true);
    });

    it('preserves a valid motionFilter group', () => {
      const result = validateImageOptions({
        motionFilter: {
          enabled: false,
          maxAngularVelocity: 1.2,
          maxLinearVelocity: 0.8,
          maxWaitMs: 3000,
        },
      });
      expect(result.motionFilter).toEqual({
        enabled: false,
        maxAngularVelocity: 1.2,
        maxLinearVelocity: 0.8,
        maxWaitMs: 3000,
      });
    });

    it('clamps out-of-range motionFilter thresholds and rejects NaN', () => {
      const result = validateImageOptions({
        motionFilter: {
          enabled: true,
          maxAngularVelocity: 999, // above max
          maxLinearVelocity: Number.NaN, // -> default
          maxWaitMs: 1, // below min
        },
      });
      expect(result.motionFilter.maxAngularVelocity).toBe(
        MOTION_FILTER_CONSTRAINTS.maxAngularVelocity.max
      );
      expect(result.motionFilter.maxLinearVelocity).toBe(
        DEFAULT_RECORDING_OPTIONS.images.motionFilter.maxLinearVelocity
      );
      expect(result.motionFilter.maxWaitMs).toBe(
        MOTION_FILTER_CONSTRAINTS.maxWaitMs.min
      );
    });

    it('default-fills qualityFilter when missing (pre-feature persisted options)', () => {
      // A persisted options object from before this feature lacks qualityFilter
      // entirely; it must load with the gate DISABLED (the safe default).
      const result = validateImageOptions({ quality: 0.5 });
      expect(result.qualityFilter).toEqual(
        DEFAULT_RECORDING_OPTIONS.images.qualityFilter
      );
      expect(result.qualityFilter.enabled).toBe(false);
    });

    it('preserves a valid qualityFilter group', () => {
      const result = validateImageOptions({
        qualityFilter: {
          enabled: true,
          blurRelativeThreshold: 0.6,
          minMeanLuminance: 12,
          maxWaitMs: 3000,
        },
      });
      expect(result.qualityFilter).toEqual({
        enabled: true,
        blurRelativeThreshold: 0.6,
        minMeanLuminance: 12,
        maxWaitMs: 3000,
        // Missing in the input (pre-toggle persisted shape) → the default.
        blurMetric: 'variance-of-laplacian',
      });
    });

    it('normalizes blurMetric: valid ids kept, missing/unknown → variance-of-laplacian', () => {
      // Why this test matters: the blur-metric toggle (2026-07-12 plan) rides
      // on persisted options — a pre-toggle persisted config (no blurMetric)
      // or a value written by a different app version must silently fall back
      // to variance-of-laplacian (the original behavior), never leak an
      // invalid id to the worker.
      const base = {
        enabled: true,
        blurRelativeThreshold: 0.5,
        minMeanLuminance: 10,
        maxWaitMs: 4000,
      };
      const kept = validateImageOptions({
        qualityFilter: { ...base, blurMetric: 'high-frequency-energy-ratio' },
      });
      expect(kept.qualityFilter.blurMetric).toBe('high-frequency-energy-ratio');

      const missing = validateImageOptions({ qualityFilter: { ...base } });
      expect(missing.qualityFilter.blurMetric).toBe('variance-of-laplacian');

      const bogus = validateImageOptions({
        qualityFilter: { ...base, blurMetric: 'bogus' as never },
      });
      expect(bogus.qualityFilter.blurMetric).toBe('variance-of-laplacian');
    });

    it('clamps out-of-range qualityFilter thresholds and rejects NaN', () => {
      const result = validateImageOptions({
        qualityFilter: {
          enabled: true,
          blurRelativeThreshold: 5, // above max
          minMeanLuminance: Number.NaN, // -> default
          maxWaitMs: 1, // below min
        },
      });
      expect(result.qualityFilter.blurRelativeThreshold).toBe(
        QUALITY_FILTER_CONSTRAINTS.blurRelativeThreshold.max
      );
      expect(result.qualityFilter.minMeanLuminance).toBe(
        DEFAULT_RECORDING_OPTIONS.images.qualityFilter.minMeanLuminance
      );
      expect(result.qualityFilter.maxWaitMs).toBe(
        QUALITY_FILTER_CONSTRAINTS.maxWaitMs.min
      );
    });

    it('clamps quality below minimum to minimum', () => {
      const result = validateImageOptions({ quality: 0.1 });
      expect(result.quality).toBe(IMAGE_CONSTRAINTS.quality.min);
    });

    it('clamps quality above maximum to maximum', () => {
      const result = validateImageOptions({ quality: 1.5 });
      expect(result.quality).toBe(IMAGE_CONSTRAINTS.quality.max);
    });

    it('clamps intervalMs below minimum to minimum', () => {
      const result = validateImageOptions({ intervalMs: 100 });
      expect(result.intervalMs).toBe(IMAGE_CONSTRAINTS.intervalMs.min);
    });

    it('clamps intervalMs above maximum to maximum', () => {
      const result = validateImageOptions({ intervalMs: 20000 });
      expect(result.intervalMs).toBe(IMAGE_CONSTRAINTS.intervalMs.max);
    });

    /**
     * Why this test matters:
     * resolutionDivisor controls capture resolution scaling.
     * Default must be 1 (full resolution) and validation must clamp out-of-range values.
     */
    it('defaults resolutionDivisor to 1 when not provided', () => {
      const result = validateImageOptions({});
      expect(result.resolutionDivisor).toBe(1);
    });

    it('preserves valid resolutionDivisor', () => {
      const result = validateImageOptions({ resolutionDivisor: 2 });
      expect(result.resolutionDivisor).toBe(2);
    });

    it('clamps resolutionDivisor below minimum', () => {
      const result = validateImageOptions({ resolutionDivisor: 0 });
      expect(result.resolutionDivisor).toBe(
        IMAGE_CONSTRAINTS.resolutionDivisor.min
      );
    });

    it('clamps resolutionDivisor above maximum', () => {
      const result = validateImageOptions({ resolutionDivisor: 20 });
      expect(result.resolutionDivisor).toBe(
        IMAGE_CONSTRAINTS.resolutionDivisor.max
      );
    });
  });

  describe('validateOccupancyOptions', () => {
    /**
     * Why these tests matter: `cellSizeM` is exposed as a recorder setting
     * (2026-06-13 occupancy-grid-settings-and-mesh-review.md, item 1) and
     * feeds straight into `new OccupancyGrid({ cellSizeM })`. The grid throws
     * a RangeError on a non-finite or ≤0 cell size, so validation MUST clamp
     * to the 1–20 cm window and reject NaN/garbage rather than passing it on.
     */
    it('returns defaults when given empty object', () => {
      const result = validateOccupancyOptions({});
      expect(result).toEqual(DEFAULT_RECORDING_OPTIONS.occupancy);
    });

    // occluderRadiusM (Step 2 of the 2026-07-03 long-session fps plan): the
    // camera-local occluder window. Default 25 m (a 15 cm voxel at 25 m is
    // ~0.3° — occlusion errors beyond that are imperceptible); 0 = unbounded
    // (today's behaviour, the safe fallback). Feeds
    // OccupancyGrid.getOccupiedCellsWithinFlat, which throws on invalid
    // radii — so corrupt values must clamp/fall back here.
    it('occluderRadiusM defaults to 25 and preserves valid values including 0 (unbounded)', () => {
      expect(validateOccupancyOptions({}).occluderRadiusM).toBe(25);
      expect(DEFAULT_RECORDING_OPTIONS.occupancy.occluderRadiusM).toBe(25);
      expect(
        validateOccupancyOptions({ occluderRadiusM: 50 }).occluderRadiusM
      ).toBe(50);
      expect(
        validateOccupancyOptions({ occluderRadiusM: 0 }).occluderRadiusM
      ).toBe(0);
    });

    it('occluderRadiusM clamps/rounds bad values and falls back to default for non-numbers', () => {
      expect(
        validateOccupancyOptions({ occluderRadiusM: -10 }).occluderRadiusM
      ).toBe(0);
      expect(
        validateOccupancyOptions({ occluderRadiusM: 12.4 }).occluderRadiusM
      ).toBe(12);
      expect(
        validateOccupancyOptions({ occluderRadiusM: 1e6 }).occluderRadiusM
      ).toBe(OCCUPANCY_CONSTRAINTS.occluderRadiusM.max);
      expect(
        validateOccupancyOptions({ occluderRadiusM: NaN }).occluderRadiusM
      ).toBe(25);
      expect(
        validateOccupancyOptions({
          occluderRadiusM: 'far' as unknown as number,
        }).occluderRadiusM
      ).toBe(25);
    });

    it('preserves a valid in-range cell size', () => {
      expect(validateOccupancyOptions({ cellSizeM: 0.05 }).cellSizeM).toBe(
        0.05
      );
    });

    it('clamps cellSizeM below minimum to minimum (sub-cm footgun guard)', () => {
      // 0.5 cm — the example value from the review; below the 1 cm floor.
      const result = validateOccupancyOptions({ cellSizeM: 0.005 });
      expect(result.cellSizeM).toBe(OCCUPANCY_CONSTRAINTS.cellSizeM.min);
    });

    it('clamps cellSizeM above maximum to maximum', () => {
      const result = validateOccupancyOptions({ cellSizeM: 1 });
      expect(result.cellSizeM).toBe(OCCUPANCY_CONSTRAINTS.cellSizeM.max);
    });

    it('falls back to default for non-number cellSizeM', () => {
      const result = validateOccupancyOptions({
        cellSizeM: 'big' as unknown as number,
      });
      expect(result.cellSizeM).toBe(
        DEFAULT_RECORDING_OPTIONS.occupancy.cellSizeM
      );
    });

    it('falls back to default for NaN/Infinity (would crash OccupancyGrid)', () => {
      // clamp(NaN, …) is NaN (NaN is typeof "number"); the explicit
      // Number.isFinite guard must catch it before it reaches the grid.
      expect(validateOccupancyOptions({ cellSizeM: NaN }).cellSizeM).toBe(
        DEFAULT_RECORDING_OPTIONS.occupancy.cellSizeM
      );
      expect(validateOccupancyOptions({ cellSizeM: Infinity }).cellSizeM).toBe(
        DEFAULT_RECORDING_OPTIONS.occupancy.cellSizeM
      );
    });

    /**
     * Why these matter: `minConfidence` is the voxel noise filter exposed as a
     * recorder setting (2026-06-22 behind-surface-noise plan). It is forwarded
     * to `getOccupiedCells(minObservations)`, which expects a positive integer,
     * so validation must round, clamp to 1–10, and reject garbage to the
     * default (default 2, not 1 — the filter is on out of the box; lowered
     * 3 → 2 in the 2026-07-16 evening on-device trade-off pass: the decay
     * carve guard neutralizes mc 2's floater cost, and the lower floor
     * meshes surfaces after ~half the dwell).
     */
    it('defaults minConfidence to 2 for an empty object', () => {
      expect(validateOccupancyOptions({}).minConfidence).toBe(2);
    });

    it('preserves a valid in-range minConfidence', () => {
      expect(validateOccupancyOptions({ minConfidence: 5 }).minConfidence).toBe(
        5
      );
    });

    it('rounds a fractional minConfidence to an integer', () => {
      expect(
        validateOccupancyOptions({ minConfidence: 4.6 }).minConfidence
      ).toBe(5);
    });

    it('clamps minConfidence below 1 up to 1 (1 = unfiltered floor)', () => {
      expect(validateOccupancyOptions({ minConfidence: 0 }).minConfidence).toBe(
        OCCUPANCY_CONSTRAINTS.minConfidence.min
      );
    });

    it('clamps minConfidence above the ceiling down to max', () => {
      expect(
        validateOccupancyOptions({ minConfidence: 50 }).minConfidence
      ).toBe(OCCUPANCY_CONSTRAINTS.minConfidence.max);
    });

    it('falls back to default for NaN/non-number minConfidence', () => {
      expect(
        validateOccupancyOptions({ minConfidence: NaN }).minConfidence
      ).toBe(DEFAULT_RECORDING_OPTIONS.occupancy.minConfidence);
      expect(
        validateOccupancyOptions({
          minConfidence: 'lots' as unknown as number,
        }).minConfidence
      ).toBe(DEFAULT_RECORDING_OPTIONS.occupancy.minConfidence);
    });

    /**
     * Why these matter (2026-06-13-0004-occupancy-mesh-options-plan.md +
     * 2026-06-29-1414-occupancy-mesh-followups.md +
     * 2026-07-01-0733-occluder-worker-and-chunked-remesh-plan.md): both occluders
     * round-trip as booleans — a corrupted stored value must not silently switch
     * either on. Since 2026-07-01 the **persistent** mesh occluder ships ON by
     * default (Web-Worker offload removed the render stall; surface-nets mesher —
     * see occluderMeshMode below); the **live** CPU-depth occluder stays OFF
     * (still device-gated, replay no-op).
     */
    it('defaults persistentOcclusion to true and liveOcclusion to false for an empty object', () => {
      const out = validateOccupancyOptions({});
      expect(out.persistentOcclusion).toBe(true);
      expect(out.liveOcclusion).toBe(false);
    });

    it('preserves boolean persistentOcclusion / liveOcclusion', () => {
      const out = validateOccupancyOptions({
        persistentOcclusion: true,
        liveOcclusion: true,
      });
      expect(out.persistentOcclusion).toBe(true);
      expect(out.liveOcclusion).toBe(true);
    });

    it('falls back to the default for non-boolean occlusion flags', () => {
      const out = validateOccupancyOptions({
        persistentOcclusion: 'yes' as unknown as boolean,
        liveOcclusion: 1 as unknown as boolean,
      });
      expect(out.persistentOcclusion).toBe(
        DEFAULT_RECORDING_OPTIONS.occupancy.persistentOcclusion
      );
      expect(out.liveOcclusion).toBe(
        DEFAULT_RECORDING_OPTIONS.occupancy.liveOcclusion
      );
    });

    /**
     * Backward-compat migration (2026-06-29): the occlusion options were a
     * single `occlusionMeshEnabled` boolean. A recording/options object persisted
     * before the split carries only that legacy field; it must map onto the new
     * `persistentOcclusion` (the old mesh occluder IS the persistent one) and
     * must never silently enable the new live occluder.
     */
    it('migrates a legacy occlusionMeshEnabled=true to persistentOcclusion (live stays off)', () => {
      const out = validateOccupancyOptions({
        occlusionMeshEnabled: true,
      } as unknown as Partial<OccupancyOptions>);
      expect(out.persistentOcclusion).toBe(true);
      expect(out.liveOcclusion).toBe(false);
    });

    it('migrates a legacy occlusionMeshEnabled=false to both occluders off', () => {
      const out = validateOccupancyOptions({
        occlusionMeshEnabled: false,
      } as unknown as Partial<OccupancyOptions>);
      expect(out.persistentOcclusion).toBe(false);
      expect(out.liveOcclusion).toBe(false);
    });

    it('lets a present persistentOcclusion override a conflicting legacy occlusionMeshEnabled', () => {
      const out = validateOccupancyOptions({
        occlusionMeshEnabled: true,
        persistentOcclusion: false,
      } as unknown as Partial<OccupancyOptions>);
      expect(out.persistentOcclusion).toBe(false);
    });

    /**
     * The JSDoc contract is "a present new field always wins over the legacy
     * one" — that must hold even when the present new field is INVALID. A blob
     * like `{ persistentOcclusion: 'bad', occlusionMeshEnabled: … }` (corrupt
     * saved options) must resolve to the DEFAULT, not silently fall through to
     * the legacy flag (which could flip the occluder on/off against the
     * contract). Pick a legacy value opposite the default so the assertion
     * discriminates regardless of what the default is.
     */
    it('ignores the legacy field when persistentOcclusion is present-but-invalid (new field wins → default)', () => {
      const legacy = !DEFAULT_RECORDING_OPTIONS.occupancy.persistentOcclusion;
      const out = validateOccupancyOptions({
        persistentOcclusion: 'bad' as unknown as boolean,
        occlusionMeshEnabled: legacy,
      } as unknown as Partial<OccupancyOptions>);
      expect(out.persistentOcclusion).toBe(
        DEFAULT_RECORDING_OPTIONS.occupancy.persistentOcclusion
      );
    });

    /**
     * Debug-visualization style (2026-07-02 debug-viz-styles plan): a 5-value
     * enum replacing the former `occluderDebugViz` boolean — picks which visible
     * debug skin(s) `OcclusionMesh` renders for the persistent occluder. Default
     * `'off'`; an unknown/corrupt stored value must coerce to `'off'` (a debug
     * render must never switch itself on), and a persisted legacy boolean must
     * migrate (`true → 'matcap'`, the skin the boolean used to enable) exactly
     * like the `occlusionMeshEnabled → persistentOcclusion` precedent — a
     * present new field always wins over the legacy one, even when invalid.
     */
    it("defaults occluderDebugStyle to 'off' for an empty object", () => {
      expect(validateOccupancyOptions({}).occluderDebugStyle).toBe('off');
    });

    it('preserves each known occluderDebugStyle', () => {
      for (const style of [
        'off',
        'matcap',
        'depth-shaded',
        'wireframe',
        'depth-shaded-wireframe',
      ] as const) {
        expect(
          validateOccupancyOptions({ occluderDebugStyle: style })
            .occluderDebugStyle
        ).toBe(style);
      }
    });

    it("coerces an unknown occluderDebugStyle to the default 'off'", () => {
      expect(
        validateOccupancyOptions({ occluderDebugStyle: 'neon' as never })
          .occluderDebugStyle
      ).toBe('off');
      expect(
        validateOccupancyOptions({ occluderDebugStyle: 42 as never })
          .occluderDebugStyle
      ).toBe('off');
    });

    it("migrates a legacy occluderDebugViz=true to 'matcap'", () => {
      const out = validateOccupancyOptions({
        occluderDebugViz: true,
      } as unknown as Partial<OccupancyOptions>);
      expect(out.occluderDebugStyle).toBe('matcap');
    });

    it("migrates a legacy occluderDebugViz=false to 'off'", () => {
      const out = validateOccupancyOptions({
        occluderDebugViz: false,
      } as unknown as Partial<OccupancyOptions>);
      expect(out.occluderDebugStyle).toBe('off');
    });

    it('lets a present occluderDebugStyle override a conflicting legacy occluderDebugViz', () => {
      const out = validateOccupancyOptions({
        occluderDebugViz: true,
        occluderDebugStyle: 'wireframe',
      } as unknown as Partial<OccupancyOptions>);
      expect(out.occluderDebugStyle).toBe('wireframe');
    });

    it("ignores the legacy field when occluderDebugStyle is present-but-invalid (new field wins → default 'off')", () => {
      const out = validateOccupancyOptions({
        occluderDebugStyle: 'bad' as never,
        occluderDebugViz: true,
      } as unknown as Partial<OccupancyOptions>);
      expect(out.occluderDebugStyle).toBe('off');
    });

    it('drops the legacy occluderDebugViz key from the validated output', () => {
      const out = validateOccupancyOptions({
        occluderDebugViz: true,
      } as unknown as Partial<OccupancyOptions>);
      expect('occluderDebugViz' in out).toBe(false);
    });

    /**
     * Why these matter: `occluderMeshMode` (2026-06-30 F2/F2b) picks the
     * persistent-occluder mesher. Since 2026-07-01 it defaults to `'smooth'`
     * (Naive Surface Nets) — the smoothest, lightest mesh, shipped as the default
     * occluder now that the persistent occluder is ON by default. It must still
     * preserve a known mode and reject any corrupt/legacy/unknown value back to
     * the default rather than crashing the mesher with a bad mode string.
     */
    it("defaults occluderMeshMode to 'smooth' for an empty object", () => {
      expect(validateOccupancyOptions({}).occluderMeshMode).toBe('smooth');
    });

    it('preserves each known occluderMeshMode', () => {
      for (const mode of ['greedy', 'corner-fit', 'smooth'] as const) {
        expect(
          validateOccupancyOptions({ occluderMeshMode: mode }).occluderMeshMode
        ).toBe(mode);
      }
    });

    it('falls back to the default for an unknown occluderMeshMode', () => {
      const out = validateOccupancyOptions({
        occluderMeshMode: 'per-face' as never, // not offered in the recorder
      });
      expect(out.occluderMeshMode).toBe(
        DEFAULT_RECORDING_OPTIONS.occupancy.occluderMeshMode
      );
      expect(
        validateOccupancyOptions({
          occluderMeshMode: 42 as never,
        }).occluderMeshMode
      ).toBe('smooth');
    });
  });

  describe('validateFrameTileDisplayOptions', () => {
    /**
     * Why these tests matter (D7-resolution, 2026-06-16 user feedback): the
     * frame-tile display divisor feeds the decode-time downscale of every tile
     * texture (live + replay). A corrupt stored value must clamp to 1–8 and an
     * integer so the resize target dimensions never go fractional/negative,
     * which would break `createImageBitmap`'s resize or blow up GPU memory.
     */
    it('returns defaults when given empty object', () => {
      const result = validateFrameTileDisplayOptions({});
      expect(result).toEqual(DEFAULT_RECORDING_OPTIONS.frameTileDisplay);
    });

    it('preserves a valid in-range divisor', () => {
      expect(validateFrameTileDisplayOptions({ divisor: 4 }).divisor).toBe(4);
    });

    it('rounds a fractional divisor to an integer', () => {
      expect(validateFrameTileDisplayOptions({ divisor: 2.6 }).divisor).toBe(3);
    });

    it('clamps divisor below minimum to minimum', () => {
      expect(validateFrameTileDisplayOptions({ divisor: 0 }).divisor).toBe(
        FRAME_TILE_DISPLAY_CONSTRAINTS.divisor.min
      );
    });

    it('clamps divisor above maximum to maximum', () => {
      expect(validateFrameTileDisplayOptions({ divisor: 99 }).divisor).toBe(
        FRAME_TILE_DISPLAY_CONSTRAINTS.divisor.max
      );
    });

    it('falls back to default for NaN/Infinity/non-number', () => {
      expect(validateFrameTileDisplayOptions({ divisor: NaN }).divisor).toBe(
        DEFAULT_RECORDING_OPTIONS.frameTileDisplay.divisor
      );
      expect(
        validateFrameTileDisplayOptions({ divisor: Infinity }).divisor
      ).toBe(DEFAULT_RECORDING_OPTIONS.frameTileDisplay.divisor);
      expect(
        validateFrameTileDisplayOptions({
          divisor: 'half' as unknown as number,
        }).divisor
      ).toBe(DEFAULT_RECORDING_OPTIONS.frameTileDisplay.divisor);
    });

    // maxTiles (Step 4 of the 2026-07-03 long-session fps plan): the LIVE
    // FIFO cap on rendered frame-tile planes. Default 100 — the 2026-07-02
    // corpus walks captured 112–145 frames, so the cap binds on a real walk.
    // 0 = unlimited (the explicit opt-out). Replay ignores the setting
    // entirely (full-path coverage auditing) — that scope is pinned at the
    // wiring sites, not here.
    it('maxTiles defaults to 100 and preserves valid values including 0 (unlimited)', () => {
      expect(validateFrameTileDisplayOptions({}).maxTiles).toBe(100);
      expect(DEFAULT_RECORDING_OPTIONS.frameTileDisplay.maxTiles).toBe(100);
      expect(validateFrameTileDisplayOptions({ maxTiles: 250 }).maxTiles).toBe(
        250
      );
      expect(validateFrameTileDisplayOptions({ maxTiles: 0 }).maxTiles).toBe(0);
    });

    it('maxTiles clamps/rounds bad values and falls back to default for non-numbers', () => {
      expect(validateFrameTileDisplayOptions({ maxTiles: -5 }).maxTiles).toBe(
        0
      );
      expect(validateFrameTileDisplayOptions({ maxTiles: 12.7 }).maxTiles).toBe(
        13
      );
      expect(validateFrameTileDisplayOptions({ maxTiles: 1e9 }).maxTiles).toBe(
        FRAME_TILE_DISPLAY_CONSTRAINTS.maxTiles.max
      );
      expect(validateFrameTileDisplayOptions({ maxTiles: NaN }).maxTiles).toBe(
        100
      );
      expect(
        validateFrameTileDisplayOptions({
          maxTiles: 'lots' as unknown as number,
        }).maxTiles
      ).toBe(100);
    });
  });

  describe('validateCompassDebugOptions', () => {
    // Why: each compass flag validates boolean-or-default. Stage 0
    // (coldStartOverride) is a default-ON feature; Stage C + the consistency
    // gate stay experimental (default OFF) so a corrupted or pre-feature
    // persisted value can never silently turn those experimental overrides ON.
    it('returns the per-field defaults when given empty object', () => {
      const result = validateCompassDebugOptions({});
      expect(result).toEqual(DEFAULT_RECORDING_OPTIONS.compassDebug);
      expect(result).toEqual({
        coldStartOverride: true,
        rotationPrior: false,
        webXRConsistency: false,
        experiment: false,
        ransacComparison: false,
      });
    });

    it('preserves valid boolean values', () => {
      expect(
        validateCompassDebugOptions({
          coldStartOverride: false,
          rotationPrior: true,
          webXRConsistency: true,
          experiment: true,
          ransacComparison: true,
        })
      ).toEqual({
        coldStartOverride: false,
        rotationPrior: true,
        webXRConsistency: true,
        experiment: true,
        ransacComparison: true,
      });
    });

    it('falls back to each field default for non-boolean values', () => {
      // Stage 0 falls back to its default-ON; the experimental flags fall back
      // OFF — a garbage persisted value never silently enables Stage C / gate /
      // the 2026-07-19 field-test experiments.
      expect(
        validateCompassDebugOptions({
          coldStartOverride: 'no' as unknown as boolean,
        }).coldStartOverride
      ).toBe(true);
      expect(
        validateCompassDebugOptions({ rotationPrior: 1 as unknown as boolean })
          .rotationPrior
      ).toBe(false);
      expect(
        validateCompassDebugOptions({
          experiment: 'yes' as unknown as boolean,
        }).experiment
      ).toBe(false);
      expect(
        validateCompassDebugOptions({
          ransacComparison: 1 as unknown as boolean,
        }).ransacComparison
      ).toBe(false);
    });

    it('validateRecordingOptions + cloneRecordingOptions carry compassDebug (deep-cloned)', () => {
      const opts = validateRecordingOptions({
        compassDebug: { coldStartOverride: true },
      });
      expect(opts.compassDebug).toEqual({
        coldStartOverride: true,
        rotationPrior: false,
        webXRConsistency: false,
        experiment: false,
        ransacComparison: false,
      });
      const clone = cloneRecordingOptions(opts);
      expect(clone.compassDebug).not.toBe(opts.compassDebug); // no aliasing
      expect(clone.compassDebug).toEqual(opts.compassDebug);
    });
  });

  describe('validateLoopClosureDebugOptions', () => {
    // Why these tests matter: the loop-closure detector wiring is an
    // experimental capture feature (2026-07-06 recorder wiring plan). It MUST
    // default OFF and a corrupted/pre-feature persisted value must never
    // silently enable it — with it ON, every AR relocalization jump dispatches
    // arLoopClosureDetected into the recording and deforms the live alignment.
    it('returns the OFF default when given empty object', () => {
      const result = validateLoopClosureDebugOptions({});
      expect(result).toEqual(DEFAULT_RECORDING_OPTIONS.loopClosureDebug);
      expect(result).toEqual({ detectorEnabled: false });
    });

    it('preserves a valid boolean value', () => {
      expect(
        validateLoopClosureDebugOptions({ detectorEnabled: true })
      ).toEqual({ detectorEnabled: true });
      expect(
        validateLoopClosureDebugOptions({ detectorEnabled: false })
      ).toEqual({ detectorEnabled: false });
    });

    it('falls back to OFF for non-boolean values', () => {
      expect(
        validateLoopClosureDebugOptions({
          detectorEnabled: 'yes' as unknown as boolean,
        })
      ).toEqual({ detectorEnabled: false });
      expect(
        validateLoopClosureDebugOptions({
          detectorEnabled: 1 as unknown as boolean,
        })
      ).toEqual({ detectorEnabled: false });
    });

    it('validateRecordingOptions + cloneRecordingOptions carry loopClosureDebug (deep-cloned)', () => {
      const opts = validateRecordingOptions({
        loopClosureDebug: { detectorEnabled: true },
      });
      expect(opts.loopClosureDebug).toEqual({ detectorEnabled: true });
      const clone = cloneRecordingOptions(opts);
      expect(clone.loopClosureDebug).not.toBe(opts.loopClosureDebug); // no aliasing
      expect(clone.loopClosureDebug).toEqual(opts.loopClosureDebug);
    });
  });

  describe('validateVisualizationOptions', () => {
    /**
     * Why these tests matter (Finding B / DB-1b of
     * 2026-06-14-0012-frame-tile-legacy-aspect-and-live-toggle-followup.md): the new
     * `visualization` group gates the four live debug overlays (frame tiles,
     * occupancy cubes, GPS+VIO alignment markers, compass cubes) plus the
     * heading-up minimap preference (2026-06-29). All MUST default ON so the
     * change is purely additive (no behaviour change), and each field is
     * validated boolean-or-default — a corrupted or pre-feature persisted value
     * must fall back to ON, never silently disable a feature.
     */
    it('returns all-true defaults when given empty object', () => {
      const result = validateVisualizationOptions({});
      expect(result).toEqual(DEFAULT_RECORDING_OPTIONS.visualization);
      expect(result).toEqual({
        frameTiles: true,
        occupancyCubes: true,
        gpsAlignmentMarkers: true,
        compassCubes: true,
        headingUpMap: true,
        // Exception to the all-ON rule: the stats overlay is a debug tool and
        // must not cost the default path (2026-07-03 long-session fps plan §0).
        statsOverlay: false,
      });
    });

    it('preserves valid boolean values', () => {
      const result = validateVisualizationOptions({
        frameTiles: false,
        occupancyCubes: false,
        gpsAlignmentMarkers: false,
        compassCubes: false,
        headingUpMap: false,
        // true is the non-default for statsOverlay — proves it is preserved,
        // not silently reset to its OFF default.
        statsOverlay: true,
      });
      expect(result).toEqual({
        frameTiles: false,
        occupancyCubes: false,
        gpsAlignmentMarkers: false,
        compassCubes: false,
        headingUpMap: false,
        statsOverlay: true,
      });
    });

    it('falls back to the ON default for non-boolean values per field', () => {
      expect(
        validateVisualizationOptions({
          frameTiles: 'on' as unknown as boolean,
        }).frameTiles
      ).toBe(true);
      expect(
        validateVisualizationOptions({
          occupancyCubes: 1 as unknown as boolean,
        }).occupancyCubes
      ).toBe(true);
      expect(
        validateVisualizationOptions({
          gpsAlignmentMarkers: null as unknown as boolean,
        }).gpsAlignmentMarkers
      ).toBe(true);
      // A pre-feature persisted value (heading-up flag absent) falls back to ON.
      expect(validateVisualizationOptions({}).headingUpMap).toBe(true);
      // A genuine false must survive (not be treated as "missing").
      expect(
        validateVisualizationOptions({ compassCubes: false }).compassCubes
      ).toBe(false);
      expect(
        validateVisualizationOptions({ headingUpMap: false }).headingUpMap
      ).toBe(false);
      // statsOverlay is the one OFF-default field in the group: a corrupt or
      // pre-feature persisted value must fall back to OFF (a debug overlay must
      // never turn itself on), while a genuine true must survive.
      expect(
        validateVisualizationOptions({
          statsOverlay: 'yes' as unknown as boolean,
        }).statsOverlay
      ).toBe(false);
      expect(validateVisualizationOptions({}).statsOverlay).toBe(false);
      expect(
        validateVisualizationOptions({ statsOverlay: true }).statsOverlay
      ).toBe(true);
    });
  });

  describe('validateQrOptions', () => {
    /**
     * Why these tests matter (recorder live-QR §0): the QR-capture group is
     * OPT-IN — `enabled` MUST default to false so an existing recording never
     * silently gains the per-frame detector cost. `intervalMs`/`captureSize`
     * back settings sliders and feed the camera-frame source, so a corrupt
     * stored value (NaN, out-of-range, wrong type) must clamp/fall back rather
     * than break capture.
     */
    it('returns defaults (QR OFF) when given empty object', () => {
      const result = validateQrOptions({});
      expect(result).toEqual(DEFAULT_RECORDING_OPTIONS.qr);
      expect(result.enabled).toBe(false);
    });

    it('preserves valid values', () => {
      const result = validateQrOptions({
        enabled: true,
        intervalMs: 250,
        captureSize: 512,
      });
      expect(result).toEqual({
        enabled: true,
        intervalMs: 250,
        captureSize: 512,
      });
    });

    it('falls back to OFF for a non-boolean enabled', () => {
      expect(
        validateQrOptions({ enabled: 'yes' as unknown as boolean }).enabled
      ).toBe(false);
      // A genuine true must survive.
      expect(validateQrOptions({ enabled: true }).enabled).toBe(true);
    });

    it('clamps intervalMs below/above the constraint range', () => {
      expect(validateQrOptions({ intervalMs: 10 }).intervalMs).toBe(
        QR_CONSTRAINTS.intervalMs.min
      );
      expect(validateQrOptions({ intervalMs: 5000 }).intervalMs).toBe(
        QR_CONSTRAINTS.intervalMs.max
      );
    });

    it('clamps captureSize below/above the constraint range', () => {
      expect(validateQrOptions({ captureSize: 16 }).captureSize).toBe(
        QR_CONSTRAINTS.captureSize.min
      );
      expect(validateQrOptions({ captureSize: 9999 }).captureSize).toBe(
        QR_CONSTRAINTS.captureSize.max
      );
    });

    it('falls back to defaults for NaN/non-number (would break capture)', () => {
      // clamp(NaN, …) is NaN (NaN is typeof "number"); the Number.isFinite
      // guard must catch it before it reaches startCameraFrameCapture.
      expect(validateQrOptions({ intervalMs: NaN }).intervalMs).toBe(
        DEFAULT_RECORDING_OPTIONS.qr.intervalMs
      );
      expect(
        validateQrOptions({ captureSize: 'big' as unknown as number })
          .captureSize
      ).toBe(DEFAULT_RECORDING_OPTIONS.qr.captureSize);
    });

    it('defaults to the demo cadence (125 ms) and 1024 px capture', () => {
      expect(DEFAULT_RECORDING_OPTIONS.qr.intervalMs).toBe(125);
      expect(DEFAULT_RECORDING_OPTIONS.qr.captureSize).toBe(1024);
    });
  });

  describe('validateRecordingOptions', () => {
    it('returns defaults when given empty object', () => {
      const result = validateRecordingOptions({});
      expect(result).toEqual(DEFAULT_RECORDING_OPTIONS);
    });

    it('merges partial qr options with defaults (schema evolution)', () => {
      // A pre-QR persisted blob (no `qr` key) must gain the OFF default group,
      // never `undefined` — otherwise main.ts reads `qr.enabled` off undefined.
      const result = validateRecordingOptions({ qr: { enabled: true } });
      expect(result.qr.enabled).toBe(true);
      expect(result.qr.intervalMs).toBe(
        DEFAULT_RECORDING_OPTIONS.qr.intervalMs
      );
      expect(result.qr.captureSize).toBe(
        DEFAULT_RECORDING_OPTIONS.qr.captureSize
      );
      expect(result.depth).toEqual(DEFAULT_RECORDING_OPTIONS.depth);
    });

    it('merges partial visualization options with defaults', () => {
      const result = validateRecordingOptions({
        visualization: { frameTiles: false },
      });
      expect(result.visualization.frameTiles).toBe(false);
      expect(result.visualization.statsOverlay).toBe(false);
      // Other overlays stay ON; other groups untouched.
      expect(result.visualization.occupancyCubes).toBe(true);
      expect(result.visualization.gpsAlignmentMarkers).toBe(true);
      expect(result.visualization.compassCubes).toBe(true);
      expect(result.depth).toEqual(DEFAULT_RECORDING_OPTIONS.depth);
    });

    it('merges partial occupancy options with defaults', () => {
      const result = validateRecordingOptions({
        occupancy: { cellSizeM: 0.02 },
      });
      expect(result.occupancy.cellSizeM).toBe(0.02);
      // Other groups untouched
      expect(result.depth).toEqual(DEFAULT_RECORDING_OPTIONS.depth);
    });

    it('includes default AR crash isolation flags', () => {
      // Why this test matters:
      // Pre-recording AR crash isolation must persist alongside the existing
      // recording-time options so device experiments do not require code edits.
      const result = validateRecordingOptions({}) as unknown as Record<
        string,
        unknown
      >;
      const flags = result.arCrashIsolation as
        | Record<string, unknown>
        | undefined;

      expect(flags).toEqual({
        enableDomOverlay: true,
        enableCameraAccess: true,
        enableDepthSensingFeature: true,
        enableCss3dRenderer: true,
        enableCameraTextureAcquisition: true,
        applyChromiumProjectionLayerWorkaround: true,
      });
    });

    it('merges partial depth options with defaults', () => {
      const result = validateRecordingOptions({
        depth: { enabled: false },
      });
      expect(result.depth.enabled).toBe(false);
      expect(result.depth.intervalMs).toBe(
        DEFAULT_RECORDING_OPTIONS.depth.intervalMs
      );
      expect(result.images).toEqual(DEFAULT_RECORDING_OPTIONS.images);
    });

    it('merges partial images options with defaults', () => {
      const result = validateRecordingOptions({
        images: { quality: 0.9 },
      });
      expect(result.images.quality).toBe(0.9);
      expect(result.images.enabled).toBe(
        DEFAULT_RECORDING_OPTIONS.images.enabled
      );
      expect(result.depth).toEqual(DEFAULT_RECORDING_OPTIONS.depth);
    });
  });

  describe('loadRecordingOptions', () => {
    it('returns defaults when localStorage is empty', () => {
      const result = loadRecordingOptions();
      expect(result).toEqual(DEFAULT_RECORDING_OPTIONS);
      expect(localStorageMock.getItem).toHaveBeenCalledWith(STORAGE_KEY);
    });

    it('loads and validates stored options', () => {
      const stored: RecordingOptions = {
        depth: { enabled: false, intervalMs: 2000, gridSize: 4, rgb: true },
        images: {
          enabled: true,
          intervalMs: 3000,
          quality: 0.8,
          resolutionDivisor: 2,
          motionFilter: { ...DEFAULT_RECORDING_OPTIONS.images.motionFilter },
          qualityFilter: { ...DEFAULT_RECORDING_OPTIONS.images.qualityFilter },
        },
        arCrashIsolation: { ...DEFAULT_RECORDING_OPTIONS.arCrashIsolation },
        occupancy: { ...DEFAULT_RECORDING_OPTIONS.occupancy },
        frameTileDisplay: { ...DEFAULT_RECORDING_OPTIONS.frameTileDisplay },
        visualization: { ...DEFAULT_RECORDING_OPTIONS.visualization },
        qr: { ...DEFAULT_RECORDING_OPTIONS.qr },
        compassDebug: { ...DEFAULT_RECORDING_OPTIONS.compassDebug },
        loopClosureDebug: { ...DEFAULT_RECORDING_OPTIONS.loopClosureDebug },
      };
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(stored));

      const result = loadRecordingOptions();
      expect(result).toEqual(stored);
    });

    it('merges partial stored options with defaults (schema evolution)', () => {
      // Simulate older version that only had depth.enabled stored
      const partialStored = { depth: { enabled: false } };
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify(partialStored)
      );

      const result = loadRecordingOptions();
      expect(result.depth.enabled).toBe(false);
      expect(result.depth.intervalMs).toBe(
        DEFAULT_RECORDING_OPTIONS.depth.intervalMs
      );
      expect(result.images).toEqual(DEFAULT_RECORDING_OPTIONS.images);
      // Pre-occupancy persisted blobs gain the default voxel size, not undefined.
      expect(result.occupancy).toEqual(DEFAULT_RECORDING_OPTIONS.occupancy);
      // Pre-visualization persisted blobs gain the all-ON overlay group, so
      // upgrading the app never silently turns an overlay off.
      expect(result.visualization).toEqual(
        DEFAULT_RECORDING_OPTIONS.visualization
      );
    });

    it('merges partial stored AR isolation options with defaults', () => {
      // Why this test matters:
      // The new diagnostic flags are added after the original recording
      // settings feature, so old persisted objects must gain safe defaults.
      localStorageMock.getItem.mockReturnValueOnce(
        JSON.stringify({
          arCrashIsolation: { enableCss3dRenderer: false },
        })
      );

      const result = loadRecordingOptions() as unknown as Record<
        string,
        unknown
      >;
      const flags = result.arCrashIsolation as
        | Record<string, unknown>
        | undefined;

      expect(flags).toEqual({
        enableDomOverlay: true,
        enableCameraAccess: true,
        enableDepthSensingFeature: true,
        enableCss3dRenderer: false,
        enableCameraTextureAcquisition: true,
        applyChromiumProjectionLayerWorkaround: true,
      });
    });

    it('returns defaults when stored JSON is invalid', () => {
      localStorageMock.getItem.mockReturnValueOnce('not valid json');

      const result = loadRecordingOptions();
      expect(result).toEqual(DEFAULT_RECORDING_OPTIONS);
    });

    it('clamps out-of-range stored values', () => {
      const stored = {
        depth: { intervalMs: 50 }, // below min
        images: { quality: 2.0 }, // above max
      };
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(stored));

      const result = loadRecordingOptions();
      expect(result.depth.intervalMs).toBe(DEPTH_CONSTRAINTS.intervalMs.min);
      expect(result.images.quality).toBe(IMAGE_CONSTRAINTS.quality.max);
    });
  });

  describe('saveRecordingOptions', () => {
    it('saves validated options to localStorage', () => {
      const options: RecordingOptions = {
        depth: { enabled: false, intervalMs: 1500, gridSize: 5, rgb: true },
        images: {
          enabled: true,
          intervalMs: 4000,
          quality: 0.6,
          resolutionDivisor: 1,
          motionFilter: { ...DEFAULT_RECORDING_OPTIONS.images.motionFilter },
          qualityFilter: { ...DEFAULT_RECORDING_OPTIONS.images.qualityFilter },
        },
        arCrashIsolation: { ...DEFAULT_RECORDING_OPTIONS.arCrashIsolation },
        occupancy: { ...DEFAULT_RECORDING_OPTIONS.occupancy },
        frameTileDisplay: { ...DEFAULT_RECORDING_OPTIONS.frameTileDisplay },
        visualization: { ...DEFAULT_RECORDING_OPTIONS.visualization },
        qr: { ...DEFAULT_RECORDING_OPTIONS.qr },
        compassDebug: { ...DEFAULT_RECORDING_OPTIONS.compassDebug },
        loopClosureDebug: { ...DEFAULT_RECORDING_OPTIONS.loopClosureDebug },
      };

      saveRecordingOptions(options);

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        STORAGE_KEY,
        JSON.stringify(options)
      );
    });

    it('clamps invalid values before saving', () => {
      const options: RecordingOptions = {
        depth: { enabled: true, intervalMs: 50, gridSize: 100, rgb: true }, // invalid
        images: {
          enabled: true,
          intervalMs: 100,
          quality: 0.1,
          resolutionDivisor: 0,
          motionFilter: { ...DEFAULT_RECORDING_OPTIONS.images.motionFilter },
          qualityFilter: { ...DEFAULT_RECORDING_OPTIONS.images.qualityFilter },
        }, // invalid
        arCrashIsolation: { ...DEFAULT_RECORDING_OPTIONS.arCrashIsolation },
        occupancy: { ...DEFAULT_RECORDING_OPTIONS.occupancy },
        frameTileDisplay: { ...DEFAULT_RECORDING_OPTIONS.frameTileDisplay },
        visualization: { ...DEFAULT_RECORDING_OPTIONS.visualization },
        qr: { ...DEFAULT_RECORDING_OPTIONS.qr },
        compassDebug: { ...DEFAULT_RECORDING_OPTIONS.compassDebug },
        loopClosureDebug: { ...DEFAULT_RECORDING_OPTIONS.loopClosureDebug },
      };

      saveRecordingOptions(options);

      const savedValue = localStorageMock.setItem.mock.calls[0][1];
      const savedOptions = JSON.parse(savedValue) as RecordingOptions;

      expect(savedOptions.depth.intervalMs).toBe(
        DEPTH_CONSTRAINTS.intervalMs.min
      );
      expect(savedOptions.depth.gridSize).toBe(DEPTH_CONSTRAINTS.gridSize.max);
      expect(savedOptions.images.intervalMs).toBe(
        IMAGE_CONSTRAINTS.intervalMs.min
      );
      expect(savedOptions.images.quality).toBe(IMAGE_CONSTRAINTS.quality.min);
    });

    it('persists AR crash isolation flags alongside recording options', () => {
      // Why this test matters:
      // Session-request and frame-loop flags must use the same persistence path
      // as the existing settings so field experiments remain reproducible.
      saveRecordingOptions({
        ...DEFAULT_RECORDING_OPTIONS,
        arCrashIsolation: {
          enableDomOverlay: true,
          enableCameraAccess: false,
          enableDepthSensingFeature: true,
          enableCss3dRenderer: false,
          enableCameraTextureAcquisition: true,
          applyChromiumProjectionLayerWorkaround: true,
        },
      });

      const savedValue = localStorageMock.setItem.mock.calls[0][1];
      const savedOptions = JSON.parse(savedValue) as Record<string, unknown>;

      expect(savedOptions.arCrashIsolation).toEqual({
        enableDomOverlay: true,
        enableCameraAccess: false,
        enableDepthSensingFeature: true,
        enableCss3dRenderer: false,
        enableCameraTextureAcquisition: true,
        applyChromiumProjectionLayerWorkaround: true,
      });
    });
  });

  describe('resetRecordingOptions', () => {
    it('removes options from localStorage', () => {
      resetRecordingOptions();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    });

    it('returns default options', () => {
      const result = resetRecordingOptions();
      expect(result).toEqual(DEFAULT_RECORDING_OPTIONS);
    });
  });

  describe('cloneRecordingOptions', () => {
    it('creates a deep copy', () => {
      const original = DEFAULT_RECORDING_OPTIONS;
      const clone = cloneRecordingOptions(original);

      // Values should be equal
      expect(clone).toEqual(original);

      // But not the same object references
      expect(clone).not.toBe(original);
      expect(clone.depth).not.toBe(original.depth);
      expect(clone.images).not.toBe(original.images);
    });

    it('allows mutation without affecting original', () => {
      const original = {
        depth: { enabled: true, intervalMs: 1000, gridSize: 3 },
        images: {
          enabled: true,
          intervalMs: 2000,
          quality: 0.7,
          resolutionDivisor: 1,
        },
        arCrashIsolation: {
          enableDomOverlay: true,
          enableCameraAccess: true,
          enableDepthSensingFeature: true,
          enableCss3dRenderer: true,
          enableCameraTextureAcquisition: true,
        },
      } as RecordingOptions;
      const clone = cloneRecordingOptions(original);

      clone.depth.enabled = false;
      clone.images.quality = 0.5;
      (
        clone as unknown as {
          arCrashIsolation: { enableCss3dRenderer: boolean };
        }
      ).arCrashIsolation.enableCss3dRenderer = false;

      expect(original.depth.enabled).toBe(true);
      expect(original.images.quality).toBe(0.7);
      expect(
        (
          original as unknown as {
            arCrashIsolation: { enableCss3dRenderer: boolean };
          }
        ).arCrashIsolation.enableCss3dRenderer
      ).toBe(true);
    });

    /**
     * Why this test matters: `images.motionFilter` is the FIRST nested object
     * inside a group, so the shallow `{ ...options.images }` clone used for the
     * flat groups would share its reference. The settings modal mutates it in
     * place, which on the DEFAULT → clone → clone (no-storage/reset) path would
     * otherwise poison DEFAULT_RECORDING_OPTIONS for the whole session. This
     * pins that the clone owns an independent motionFilter.
     */
    it('deep-clones the nested images.motionFilter (no shared reference)', () => {
      const original = cloneRecordingOptions(DEFAULT_RECORDING_OPTIONS);
      const clone = cloneRecordingOptions(original);

      expect(clone.images.motionFilter).not.toBe(original.images.motionFilter);

      clone.images.motionFilter.enabled = false;
      clone.images.motionFilter.maxAngularVelocity = 99;

      expect(original.images.motionFilter.enabled).toBe(true);
      expect(original.images.motionFilter.maxAngularVelocity).toBe(
        DEFAULT_RECORDING_OPTIONS.images.motionFilter.maxAngularVelocity
      );
      // And the module-level default itself is untouched.
      expect(DEFAULT_RECORDING_OPTIONS.images.motionFilter.enabled).toBe(true);
    });

    /**
     * Why this test matters: `images.qualityFilter` is the SECOND nested object
     * in the group (added with the image-quality gate). The clone branch must
     * deep-copy it too, or the settings modal's in-place mutation would poison
     * DEFAULT_RECORDING_OPTIONS on the DEFAULT → clone → clone path, exactly like
     * the motionFilter case above.
     */
    it('deep-clones the nested images.qualityFilter (no shared reference)', () => {
      const original = cloneRecordingOptions(DEFAULT_RECORDING_OPTIONS);
      const clone = cloneRecordingOptions(original);

      expect(clone.images.qualityFilter).not.toBe(
        original.images.qualityFilter
      );

      clone.images.qualityFilter.enabled = true;
      clone.images.qualityFilter.minMeanLuminance = 99;

      expect(original.images.qualityFilter.enabled).toBe(false);
      expect(original.images.qualityFilter.minMeanLuminance).toBe(
        DEFAULT_RECORDING_OPTIONS.images.qualityFilter.minMeanLuminance
      );
      // And the module-level default itself is untouched.
      expect(DEFAULT_RECORDING_OPTIONS.images.qualityFilter.enabled).toBe(
        false
      );
    });
  });

  describe('validateQualityFilterOptions', () => {
    it('returns defaults (gate DISABLED) for an empty object', () => {
      expect(validateQualityFilterOptions({})).toEqual(
        DEFAULT_RECORDING_OPTIONS.images.qualityFilter
      );
      expect(validateQualityFilterOptions({}).enabled).toBe(false);
    });

    it('honors an explicit enabled=true', () => {
      expect(validateQualityFilterOptions({ enabled: true }).enabled).toBe(
        true
      );
    });

    it('clamps thresholds to QUALITY_FILTER_CONSTRAINTS', () => {
      const tooHigh = validateQualityFilterOptions({
        blurRelativeThreshold: 9,
      });
      expect(tooHigh.blurRelativeThreshold).toBe(
        QUALITY_FILTER_CONSTRAINTS.blurRelativeThreshold.max
      );
      const tooLow = validateQualityFilterOptions({ minMeanLuminance: -5 });
      expect(tooLow.minMeanLuminance).toBe(
        QUALITY_FILTER_CONSTRAINTS.minMeanLuminance.min
      );
    });
  });

  describe('validateMotionFilterOptions', () => {
    it('returns defaults (gate enabled) for an empty object', () => {
      expect(validateMotionFilterOptions({})).toEqual(
        DEFAULT_RECORDING_OPTIONS.images.motionFilter
      );
    });

    it('honors an explicit enabled=false', () => {
      expect(validateMotionFilterOptions({ enabled: false }).enabled).toBe(
        false
      );
    });

    it('clamps thresholds to MOTION_FILTER_CONSTRAINTS', () => {
      const tooLow = validateMotionFilterOptions({ maxAngularVelocity: 0 });
      expect(tooLow.maxAngularVelocity).toBe(
        MOTION_FILTER_CONSTRAINTS.maxAngularVelocity.min
      );
      const tooHigh = validateMotionFilterOptions({ maxWaitMs: 999999 });
      expect(tooHigh.maxWaitMs).toBe(MOTION_FILTER_CONSTRAINTS.maxWaitMs.max);
    });
  });

  describe('DEFAULT_RECORDING_OPTIONS', () => {
    it('has depth enabled by default', () => {
      expect(DEFAULT_RECORDING_OPTIONS.depth.enabled).toBe(true);
    });

    it('has images enabled by default', () => {
      expect(DEFAULT_RECORDING_OPTIONS.images.enabled).toBe(true);
    });

    it('has QR detection DISABLED by default (opt-in)', () => {
      expect(DEFAULT_RECORDING_OPTIONS.qr.enabled).toBe(false);
    });

    it('has reasonable default intervals', () => {
      expect(DEFAULT_RECORDING_OPTIONS.depth.intervalMs).toBe(200);
      expect(DEFAULT_RECORDING_OPTIONS.images.intervalMs).toBe(2000);
    });

    /**
     * Why this matters: these pin the maintainer's 2026-07-16 EVENING
     * on-device framerate/mesh trade-off (screenshot-documented settings pass):
     * depth 2000 ms × 24×24, voxel 16 cm, minConfidence 2. The same-day
     * sweep-derived 500 ms × 64 delivered the fastest mesh on ground truth but
     * visibly hurt the on-device framerate — the sweep's flagged open
     * question. mc 2's floater cost under legacy carving is neutralized by the
     * decay carve guard (real pillar A/B: guarded mc 2 ≈ mc 3 isolation).
     * All four values come from framework constants so the PhysicsDemo shares
     * them.
     */
    it('uses the fast-reconstruction depth/occupancy defaults', () => {
      expect(DEFAULT_RECORDING_OPTIONS.depth.intervalMs).toBe(200);
      expect(DEFAULT_RECORDING_OPTIONS.depth.gridSize).toBe(24);
      expect(DEFAULT_RECORDING_OPTIONS.occupancy.minConfidence).toBe(2);
      expect(DEFAULT_RECORDING_OPTIONS.occupancy.cellSizeM).toBe(0.16);
    });

    it('has resolutionDivisor defaulting to 1 (full resolution)', () => {
      expect(DEFAULT_RECORDING_OPTIONS.images.resolutionDivisor).toBe(1);
    });

    it('inherits its occupancy voxel size + noise floor from the framework defaults', () => {
      // Single source of truth: both the recorder and the PhysicsDemo read these
      // framework constants, so this pins the inheritance (not just the number).
      expect(DEFAULT_RECORDING_OPTIONS.occupancy.cellSizeM).toBe(
        DEFAULT_OCCUPANCY_CELL_SIZE_M
      );
      expect(DEFAULT_RECORDING_OPTIONS.occupancy.minConfidence).toBe(
        DEFAULT_OCCUPANCY_MIN_OBSERVATIONS
      );
    });

    it('has frame-tile display divisor defaulting to 2 (half resolution)', () => {
      expect(DEFAULT_RECORDING_OPTIONS.frameTileDisplay.divisor).toBe(2);
    });

    it('has every visualization overlay enabled by default (purely additive)', () => {
      expect(DEFAULT_RECORDING_OPTIONS.visualization).toEqual({
        frameTiles: true,
        occupancyCubes: true,
        gpsAlignmentMarkers: true,
        compassCubes: true,
        headingUpMap: true,
        // Deliberate exception: the perf stats overlay is debug-only and OFF
        // by default (2026-07-03 long-session fps plan §0).
        statsOverlay: false,
      });
    });
  });

  describe('constraints', () => {
    it('DEPTH_CONSTRAINTS has valid ranges', () => {
      expect(DEPTH_CONSTRAINTS.intervalMs.min).toBeLessThan(
        DEPTH_CONSTRAINTS.intervalMs.max
      );
      expect(DEPTH_CONSTRAINTS.gridSize.min).toBeLessThan(
        DEPTH_CONSTRAINTS.gridSize.max
      );
    });

    it('IMAGE_CONSTRAINTS has valid ranges', () => {
      expect(IMAGE_CONSTRAINTS.intervalMs.min).toBeLessThan(
        IMAGE_CONSTRAINTS.intervalMs.max
      );
      expect(IMAGE_CONSTRAINTS.quality.min).toBeLessThan(
        IMAGE_CONSTRAINTS.quality.max
      );
    });

    /**
     * Why this test matters: the 2026-07-10 splat-orbit finding
     * (GpsPlusSlamJs_Docs/docs/2026-07-10-0802-splat-orbit-capture-rate-finding.md)
     * showed the old 1000 ms minimum caps a slow object orbit at ~1 frame/s —
     * too sparse for Gaussian-splat reconstruction (50–150+ frames/object).
     * min/step were lowered 1000/500 → 250/250 so the slider reaches 4 Hz.
     * Overlap safety: `captureInProgress` serialises captures and the
     * interval is measured from the ACTUAL capture time, so an interval
     * faster than the readback+encode path self-limits instead of queueing.
     */
    it('IMAGE_CONSTRAINTS allows sub-second capture for splat-style object scans', () => {
      expect(IMAGE_CONSTRAINTS.intervalMs.min).toBe(250);
      expect(IMAGE_CONSTRAINTS.intervalMs.step).toBe(250);
    });

    it('OCCUPANCY_CONSTRAINTS spans 1–20 cm and brackets the default', () => {
      expect(OCCUPANCY_CONSTRAINTS.cellSizeM.min).toBe(0.01);
      expect(OCCUPANCY_CONSTRAINTS.cellSizeM.max).toBe(0.2);
      expect(OCCUPANCY_CONSTRAINTS.cellSizeM.min).toBeLessThan(
        OCCUPANCY_CONSTRAINTS.cellSizeM.max
      );
      const { cellSizeM } = DEFAULT_RECORDING_OPTIONS.occupancy;
      expect(cellSizeM).toBeGreaterThanOrEqual(
        OCCUPANCY_CONSTRAINTS.cellSizeM.min
      );
      expect(cellSizeM).toBeLessThanOrEqual(
        OCCUPANCY_CONSTRAINTS.cellSizeM.max
      );
    });

    it('QR_CONSTRAINTS has valid ranges that bracket the defaults', () => {
      expect(QR_CONSTRAINTS.intervalMs.min).toBeLessThan(
        QR_CONSTRAINTS.intervalMs.max
      );
      expect(QR_CONSTRAINTS.captureSize.min).toBeLessThan(
        QR_CONSTRAINTS.captureSize.max
      );
      const { intervalMs, captureSize } = DEFAULT_RECORDING_OPTIONS.qr;
      expect(intervalMs).toBeGreaterThanOrEqual(QR_CONSTRAINTS.intervalMs.min);
      expect(intervalMs).toBeLessThanOrEqual(QR_CONSTRAINTS.intervalMs.max);
      expect(captureSize).toBeGreaterThanOrEqual(
        QR_CONSTRAINTS.captureSize.min
      );
      expect(captureSize).toBeLessThanOrEqual(QR_CONSTRAINTS.captureSize.max);
    });

    it('defaults are within constraint bounds', () => {
      const { depth, images } = DEFAULT_RECORDING_OPTIONS;

      expect(depth.intervalMs).toBeGreaterThanOrEqual(
        DEPTH_CONSTRAINTS.intervalMs.min
      );
      expect(depth.intervalMs).toBeLessThanOrEqual(
        DEPTH_CONSTRAINTS.intervalMs.max
      );
      expect(depth.gridSize).toBeGreaterThanOrEqual(
        DEPTH_CONSTRAINTS.gridSize.min
      );
      expect(depth.gridSize).toBeLessThanOrEqual(
        DEPTH_CONSTRAINTS.gridSize.max
      );

      expect(images.intervalMs).toBeGreaterThanOrEqual(
        IMAGE_CONSTRAINTS.intervalMs.min
      );
      expect(images.intervalMs).toBeLessThanOrEqual(
        IMAGE_CONSTRAINTS.intervalMs.max
      );
      expect(images.quality).toBeGreaterThanOrEqual(
        IMAGE_CONSTRAINTS.quality.min
      );
      expect(images.quality).toBeLessThanOrEqual(IMAGE_CONSTRAINTS.quality.max);
    });
  });

  describe('integration: round-trip persistence', () => {
    it('options survive save → load cycle with exact values', () => {
      const customOptions: RecordingOptions = {
        depth: { enabled: false, intervalMs: 2500, gridSize: 7, rgb: true },
        images: {
          enabled: true,
          intervalMs: 5000,
          quality: 0.85,
          resolutionDivisor: 2,
          motionFilter: { ...DEFAULT_RECORDING_OPTIONS.images.motionFilter },
          qualityFilter: { ...DEFAULT_RECORDING_OPTIONS.images.qualityFilter },
        },
        arCrashIsolation: { ...DEFAULT_RECORDING_OPTIONS.arCrashIsolation },
        occupancy: {
          cellSizeM: 0.1,
          minConfidence: 3,
          persistentOcclusion: true,
          liveOcclusion: true,
          occluderDebugStyle: 'depth-shaded-wireframe',
          occluderMeshMode: 'smooth',
          occluderRadiusM: 40,
        },
        frameTileDisplay: { divisor: 4, maxTiles: 250 },
        visualization: { ...DEFAULT_RECORDING_OPTIONS.visualization },
        qr: { ...DEFAULT_RECORDING_OPTIONS.qr },
        compassDebug: { ...DEFAULT_RECORDING_OPTIONS.compassDebug },
        loopClosureDebug: { ...DEFAULT_RECORDING_OPTIONS.loopClosureDebug },
      };

      saveRecordingOptions(customOptions);
      const loaded = loadRecordingOptions();

      expect(loaded).toEqual(customOptions);
    });

    it('multiple save/load cycles maintain consistency', () => {
      const options1: RecordingOptions = {
        depth: { enabled: true, intervalMs: 1000, gridSize: 3, rgb: true },
        images: {
          enabled: false,
          intervalMs: 2000,
          quality: 0.5,
          resolutionDivisor: 1,
          motionFilter: { ...DEFAULT_RECORDING_OPTIONS.images.motionFilter },
          qualityFilter: { ...DEFAULT_RECORDING_OPTIONS.images.qualityFilter },
        },
        arCrashIsolation: { ...DEFAULT_RECORDING_OPTIONS.arCrashIsolation },
        occupancy: { ...DEFAULT_RECORDING_OPTIONS.occupancy },
        frameTileDisplay: { ...DEFAULT_RECORDING_OPTIONS.frameTileDisplay },
        visualization: { ...DEFAULT_RECORDING_OPTIONS.visualization },
        qr: { ...DEFAULT_RECORDING_OPTIONS.qr },
        compassDebug: { ...DEFAULT_RECORDING_OPTIONS.compassDebug },
        loopClosureDebug: { ...DEFAULT_RECORDING_OPTIONS.loopClosureDebug },
      };

      saveRecordingOptions(options1);
      const loaded1 = loadRecordingOptions();
      expect(loaded1).toEqual(options1);

      // Modify and save again
      loaded1.depth.enabled = false;
      loaded1.images.quality = 0.9;
      saveRecordingOptions(loaded1);

      const loaded2 = loadRecordingOptions();
      expect(loaded2.depth.enabled).toBe(false);
      expect(loaded2.images.quality).toBe(0.9);
    });

    it('reset → load returns exact defaults', () => {
      // First save custom options
      saveRecordingOptions({
        depth: { enabled: false, intervalMs: 5000, gridSize: 10, rgb: true },
        images: {
          enabled: false,
          intervalMs: 10000,
          quality: 0.3,
          resolutionDivisor: 4,
          motionFilter: { ...DEFAULT_RECORDING_OPTIONS.images.motionFilter },
          qualityFilter: { ...DEFAULT_RECORDING_OPTIONS.images.qualityFilter },
        },
        arCrashIsolation: { ...DEFAULT_RECORDING_OPTIONS.arCrashIsolation },
        occupancy: { ...DEFAULT_RECORDING_OPTIONS.occupancy },
        frameTileDisplay: { ...DEFAULT_RECORDING_OPTIONS.frameTileDisplay },
        visualization: { ...DEFAULT_RECORDING_OPTIONS.visualization },
        qr: { ...DEFAULT_RECORDING_OPTIONS.qr },
        compassDebug: { ...DEFAULT_RECORDING_OPTIONS.compassDebug },
        loopClosureDebug: { ...DEFAULT_RECORDING_OPTIONS.loopClosureDebug },
      });

      // Reset
      resetRecordingOptions();

      // Load should return defaults
      const loaded = loadRecordingOptions();
      expect(loaded).toEqual(DEFAULT_RECORDING_OPTIONS);
    });

    it('corrupted JSON in storage falls back to defaults gracefully', () => {
      // Manually corrupt storage
      localStorageMock.setItem(STORAGE_KEY, '{ broken json }}}');

      const loaded = loadRecordingOptions();
      expect(loaded).toEqual(DEFAULT_RECORDING_OPTIONS);
    });

    it('partially valid storage merges with defaults', () => {
      // Store only depth settings (simulating old schema version)
      const partialData = { depth: { enabled: false } };
      localStorageMock.setItem(STORAGE_KEY, JSON.stringify(partialData));

      const loaded = loadRecordingOptions();

      // depth.enabled should be from storage
      expect(loaded.depth.enabled).toBe(false);
      // Other depth fields should be defaults
      expect(loaded.depth.intervalMs).toBe(
        DEFAULT_RECORDING_OPTIONS.depth.intervalMs
      );
      // images should be all defaults
      expect(loaded.images).toEqual(DEFAULT_RECORDING_OPTIONS.images);
    });
  });

  describe('custom storage key (framework-readiness)', () => {
    /**
     * Why these tests matter:
     * Framework-candidate modules must not hardcode app-specific storage keys.
     * These tests verify that persistence functions accept a custom key so
     * different apps using the framework can use independent storage namespaces.
     */
    const CUSTOM_KEY = 'my-custom-app-options';

    it('loadRecordingOptions reads from custom key', () => {
      const custom: RecordingOptions = {
        depth: { enabled: false, intervalMs: 2000, gridSize: 5, rgb: true },
        images: {
          enabled: false,
          intervalMs: 3000,
          quality: 0.5,
          resolutionDivisor: 2,
          motionFilter: { ...DEFAULT_RECORDING_OPTIONS.images.motionFilter },
          qualityFilter: { ...DEFAULT_RECORDING_OPTIONS.images.qualityFilter },
        },
        arCrashIsolation: { ...DEFAULT_RECORDING_OPTIONS.arCrashIsolation },
        occupancy: { ...DEFAULT_RECORDING_OPTIONS.occupancy },
        frameTileDisplay: { ...DEFAULT_RECORDING_OPTIONS.frameTileDisplay },
        visualization: { ...DEFAULT_RECORDING_OPTIONS.visualization },
        qr: { ...DEFAULT_RECORDING_OPTIONS.qr },
        compassDebug: { ...DEFAULT_RECORDING_OPTIONS.compassDebug },
        loopClosureDebug: { ...DEFAULT_RECORDING_OPTIONS.loopClosureDebug },
      };
      localStorageMock.setItem(CUSTOM_KEY, JSON.stringify(custom));

      const loaded = loadRecordingOptions(CUSTOM_KEY);
      expect(loaded.depth.enabled).toBe(false);
      expect(loaded.depth.intervalMs).toBe(2000);
      expect(loaded.images.quality).toBe(0.5);
    });

    it('saveRecordingOptions writes to custom key', () => {
      const opts: RecordingOptions = {
        ...DEFAULT_RECORDING_OPTIONS,
        depth: { ...DEFAULT_RECORDING_OPTIONS.depth, enabled: false },
      };
      saveRecordingOptions(opts, CUSTOM_KEY);

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        CUSTOM_KEY,
        expect.any(String)
      );
      // Default key should NOT have been touched
      expect(localStorageMock.getItem(STORAGE_KEY)).toBeNull();
    });

    it('resetRecordingOptions clears custom key', () => {
      localStorageMock.setItem(CUSTOM_KEY, '{"depth":{}}');
      resetRecordingOptions(CUSTOM_KEY);

      expect(localStorageMock.removeItem).toHaveBeenCalledWith(CUSTOM_KEY);
      expect(localStorageMock.getItem(CUSTOM_KEY)).toBeNull();
    });

    it('default key is used when no custom key provided', () => {
      saveRecordingOptions(DEFAULT_RECORDING_OPTIONS);
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        STORAGE_KEY,
        expect.any(String)
      );
    });
  });
});
