/**
 * Fused Path Calculation - Unit Tests
 *
 * TDD tests for transforming odometry positions into GPS coordinates
 * using the alignment matrix. This enables showing the cyan "fused" path
 * on the session summary map alongside the raw yellow GPS path.
 *
 * Why this test matters:
 * User feedback (Issue #4b, 2026-01-27) requested the fused GPS+SLAM trajectory
 * to be displayed on the summary map. The alignment matrix (from the solver)
 * transforms AR odometry positions (local coordinates) into ENU meters, which
 * can then be converted to GPS lat/lng for Leaflet visualization.
 *
 * @vitest-environment node
 */

// Activates the core library's licence before any module under test loads.
import '../test-setup';
import { describe, it, expect } from 'vitest';
import {
  computeFusedPath,
  fusedGpsFromOdom,
  type FusedPathInput,
} from './fused-path';
import type { Matrix4, Vector3 } from 'gps-plus-slam-js';

// ============================================================================
// Test Fixtures
// ============================================================================

/** Identity matrix - no transformation (column-major) */
const IDENTITY_MAT4: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Simple translation matrix: translate by (10, 0, 20) in ENU meters (column-major) */
const TRANSLATION_MAT4: Matrix4 = [
  // Column 0        Column 1        Column 2        Column 3 (translation)
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 20, 1,
];

/** Reference GPS point (origin for ENU conversion) */
const ZERO_REF = { lat: 50.0, lon: 8.0 } as const;

// ============================================================================
// Tests: computeFusedPath
// ============================================================================

describe('computeFusedPath', () => {
  describe('basic functionality', () => {
    it('should return empty array when odometryPositions is empty', () => {
      const input: FusedPathInput = {
        odometryPositions: [],
        alignmentMatrix: IDENTITY_MAT4,
        zeroRef: ZERO_REF,
      };

      const result = computeFusedPath(input);

      expect(result).toEqual([]);
    });

    it('should return empty array when alignmentMatrix is null', () => {
      const input: FusedPathInput = {
        odometryPositions: [[0, 0, 0]],
        alignmentMatrix: null,
        zeroRef: ZERO_REF,
      };

      const result = computeFusedPath(input);

      expect(result).toEqual([]);
    });

    it('should return empty array when zeroRef is null', () => {
      const input: FusedPathInput = {
        odometryPositions: [[0, 0, 0]],
        alignmentMatrix: IDENTITY_MAT4,
        zeroRef: null,
      };

      const result = computeFusedPath(input);

      expect(result).toEqual([]);
    });
  });

  describe('identity transformation', () => {
    it('should return zeroRef coordinates when odometry is at origin with identity matrix', () => {
      const input: FusedPathInput = {
        odometryPositions: [[0, 0, 0]],
        alignmentMatrix: IDENTITY_MAT4,
        zeroRef: ZERO_REF,
      };

      const result = computeFusedPath(input);

      expect(result).toHaveLength(1);
      expect(result[0].lat).toBeCloseTo(50.0, 5);
      expect(result[0].lng).toBeCloseTo(8.0, 5);
    });

    it('should correctly transform multiple odometry points with identity matrix', () => {
      // Internal convention: X=North, Y=Up, Z=East
      const input: FusedPathInput = {
        odometryPositions: [
          [0, 0, 0],
          [10, 0, 0], // 10 meters north
          [0, 0, 10], // 10 meters east
        ],
        alignmentMatrix: IDENTITY_MAT4,
        zeroRef: ZERO_REF,
      };

      const result = computeFusedPath(input);

      expect(result).toHaveLength(3);
      // First point at origin
      expect(result[0].lat).toBeCloseTo(50.0, 5);
      expect(result[0].lng).toBeCloseTo(8.0, 5);
      // Second point shifted north (latitude increases)
      expect(result[1].lat).toBeGreaterThan(50.0);
      expect(result[1].lng).toBeCloseTo(8.0, 5);
      // Third point shifted east (longitude increases)
      expect(result[2].lat).toBeCloseTo(50.0, 5);
      expect(result[2].lng).toBeGreaterThan(8.0);
    });
  });

  describe('translation transformation', () => {
    it('should apply translation from alignment matrix', () => {
      // Internal convention: X=North, Y=Up, Z=East
      // TRANSLATION_MAT4 translates by (10, 0, 20): 10m north, 0m up, 20m east
      const input: FusedPathInput = {
        odometryPositions: [[0, 0, 0]],
        alignmentMatrix: TRANSLATION_MAT4,
        zeroRef: ZERO_REF,
      };

      const result = computeFusedPath(input);

      expect(result).toHaveLength(1);
      // Translation: 10m north → lat increases
      expect(result[0].lat).toBeGreaterThan(50.0);
      // Translation: 20m east → lng increases
      expect(result[0].lng).toBeGreaterThan(8.0);
    });
  });

  describe('output format', () => {
    it('should return objects with lat and lng properties (not lon)', () => {
      // Leaflet uses "lng", not "lon"
      const input: FusedPathInput = {
        odometryPositions: [[0, 0, 0]],
        alignmentMatrix: IDENTITY_MAT4,
        zeroRef: ZERO_REF,
      };

      const result = computeFusedPath(input);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('lat');
      expect(result[0]).toHaveProperty('lng');
      expect(result[0]).not.toHaveProperty('lon');
    });
  });

  describe('type safety', () => {
    it('should handle Vector3 format (3-element arrays)', () => {
      const input: FusedPathInput = {
        odometryPositions: [
          [1.5, 2.5, 3.5],
          [-1.0, 0.0, 1.0],
        ],
        alignmentMatrix: IDENTITY_MAT4,
        zeroRef: ZERO_REF,
      };

      const result = computeFusedPath(input);

      expect(result).toHaveLength(2);
      // Should not throw and return valid coordinates
      for (const coord of result) {
        expect(typeof coord.lat).toBe('number');
        expect(typeof coord.lng).toBe('number');
        expect(Number.isFinite(coord.lat)).toBe(true);
        expect(Number.isFinite(coord.lng)).toBe(true);
      }
    });
  });

  // ===========================================================================
  // Regression tests for matrix layout and optimization correctness
  // ===========================================================================

  describe('column-major matrix layout (regression)', () => {
    /**
     * Why this test matters:
     * gl-matrix uses column-major order. A common bug is treating Matrix4 as
     * row-major and transposing it, which breaks rotations and scales.
     * This test uses a 90-degree rotation around Y-axis to verify the layout.
     *
     * Column-major 90° Y rotation: x→z, z→-x
     * Row-major interpretation would incorrectly give: x→-z, z→x
     */
    it('should interpret rotation matrix in column-major order (no transpose)', () => {
      // 90-degree rotation around Y-axis (column-major layout)
      // This rotates: x-axis → z-axis, z-axis → -x-axis
      // cos(90°) = 0, sin(90°) = 1
      const ROTATE_Y_90: Matrix4 = [
        // col0   col1   col2   col3
        0,
        0,
        -1,
        0, // X basis → -Z
        0,
        1,
        0,
        0, // Y basis → Y (unchanged)
        1,
        0,
        0,
        0, // Z basis → X
        0,
        0,
        0,
        1, // translation = 0
      ];

      // Input: point 10m north (x=10, y=0, z=0) in internal convention
      // After 90° Y rotation: [10,0,0] → [0,0,-10] (X-basis maps to -Z)
      // Internal: [0, 0, -10] => north=0, east=-10 → 10m west
      const input: FusedPathInput = {
        odometryPositions: [[10, 0, 0]],
        alignmentMatrix: ROTATE_Y_90,
        zeroRef: ZERO_REF,
      };

      const result = computeFusedPath(input);

      expect(result).toHaveLength(1);
      // After rotation: north=0 → lat unchanged, east=-10 → lng decreases (west)
      expect(result[0].lat).toBeCloseTo(50.0, 4);
      expect(result[0].lng).toBeLessThan(8.0);
    });

    /**
     * Why this test matters:
     * Verifies that a non-uniform scale matrix is applied correctly.
     * Scale matrices are diagonal, so row/column-major doesn't matter for them,
     * but combined with other tests ensures matrix operations work as expected.
     */
    it('should correctly apply scale transformation', () => {
      // Scale: 2x in X, 1x in Y, 0.5x in Z
      const SCALE_MAT4: Matrix4 = [
        2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1,
      ];

      // Input: point at (10, 0, 20) → after scale: (20, 0, 10)
      // Internal convention: X=North, Z=East
      // After scale: north=20, east=10 → lat and lng both increase
      const input: FusedPathInput = {
        odometryPositions: [[10, 0, 20]],
        alignmentMatrix: SCALE_MAT4,
        zeroRef: ZERO_REF,
      };

      const result = computeFusedPath(input);

      expect(result).toHaveLength(1);
      // Both north (x=20) and east (z=10) components should contribute
      expect(result[0].lat).toBeGreaterThan(50.0); // north shift (x=20)
      expect(result[0].lng).toBeGreaterThan(8.0); // east shift (z=10)
    });

    /**
     * Why this test matters:
     * Tests combined rotation + translation to ensure the full affine
     * transformation chain works correctly with column-major layout.
     */
    it('should correctly apply combined rotation and translation', () => {
      // 180-degree rotation around Y + translation (10, 0, 5)
      // cos(180°) = -1, sin(180°) = 0
      // Rotation: x → -x, z → -z
      const ROTATE_TRANSLATE: Matrix4 = [
        // col0    col1   col2   col3 (translation)
        -1,
        0,
        0,
        0, // X basis
        0,
        1,
        0,
        0, // Y basis
        0,
        0,
        -1,
        0, // Z basis
        10,
        0,
        5,
        1, // translation
      ];

      // Input: (5, 0, 0) → rotate: (-5, 0, 0) → translate: (5, 0, 5)
      // Internal convention: X=North, Z=East
      // Final: (5, 0, 5) → north=5 shift, east=5 shift
      const input: FusedPathInput = {
        odometryPositions: [[5, 0, 0]],
        alignmentMatrix: ROTATE_TRANSLATE,
        zeroRef: ZERO_REF,
      };

      const result = computeFusedPath(input);

      expect(result).toHaveLength(1);
      // Final: (5, 0, 5) → north=5, east=5 → both lat and lng shift from origin
      expect(result[0].lat).toBeGreaterThan(50.0); // 5m north (X=5)
      expect(result[0].lng).toBeGreaterThan(8.0); // 5m east (Z=5)
    });
  });

  describe('optimization correctness (regression)', () => {
    /**
     * Why this test matters:
     * The optimization pre-allocates vec3 objects and reuses them in the loop.
     * This test verifies that reusing vectors doesn't cause data corruption
     * between iterations (e.g., one point's values leaking into another).
     */
    it('should produce consistent results for many points (no vec3 reuse bugs)', () => {
      // Generate a trajectory of 100 points forming a square path
      // Internal convention: X=North, Z=East
      const positions: Vector3[] = [];
      for (let i = 0; i < 25; i++) {
        positions.push([i, 0, 0]);
      } // North leg (X increases)
      for (let i = 0; i < 25; i++) {
        positions.push([25, 0, i]);
      } // East leg (Z increases)
      for (let i = 0; i < 25; i++) {
        positions.push([25 - i, 0, 25]);
      } // South leg (X decreases)
      for (let i = 0; i < 25; i++) {
        positions.push([0, 0, 25 - i]);
      } // West leg (Z decreases)

      const input: FusedPathInput = {
        odometryPositions: positions,
        alignmentMatrix: IDENTITY_MAT4,
        zeroRef: ZERO_REF,
      };

      const result = computeFusedPath(input);

      expect(result).toHaveLength(100);

      // Verify first point is at origin
      expect(result[0].lat).toBeCloseTo(50.0, 5);
      expect(result[0].lng).toBeCloseTo(8.0, 5);

      // Verify corner points of the square
      // Point 24: (24, 0, 0) - max north on first leg → lat increases, lng unchanged
      expect(result[24].lat).toBeGreaterThan(result[0].lat);
      expect(result[24].lng).toBeCloseTo(8.0, 4);

      // Point 49: (25, 0, 24) - max north-east corner → both lat and lng increase
      expect(result[49].lat).toBeGreaterThan(result[0].lat);
      expect(result[49].lng).toBeGreaterThan(result[0].lng);

      // Point 74: (1, 0, 25) - south side, max east → lat near origin, lng > 8.0
      expect(result[74].lat).toBeCloseTo(50.0, 3);
      expect(result[74].lng).toBeGreaterThan(result[0].lng);

      // Point 99: (0, 0, 1) - almost back to origin, slightly east
      expect(result[99].lat).toBeCloseTo(50.0, 4);
      expect(result[99].lng).toBeGreaterThan(result[0].lng);
    });

    /**
     * Why this test matters:
     * Ensures that processing the same input twice yields identical results,
     * verifying no stateful side effects from the optimization.
     */
    it('should produce identical results on repeated calls (no side effects)', () => {
      const input: FusedPathInput = {
        odometryPositions: [
          [0, 0, 0],
          [5, 0, 10],
          [10, 0, 0],
        ],
        alignmentMatrix: TRANSLATION_MAT4,
        zeroRef: ZERO_REF,
      };

      const result1 = computeFusedPath(input);
      const result2 = computeFusedPath(input);

      expect(result1).toHaveLength(3);
      expect(result2).toHaveLength(3);

      for (let i = 0; i < 3; i++) {
        expect(result1[i].lat).toBeCloseTo(result2[i].lat, 10);
        expect(result1[i].lng).toBeCloseTo(result2[i].lng, 10);
      }
    });
  });
});

// ============================================================================
// Tests: fusedGpsFromOdom (single-point helper)
// ============================================================================

describe('fusedGpsFromOdom', () => {
  // Why: This is the single-point extraction of the alignment→GPS pipeline
  // used by computeFusedPath, store-subscribers, and ref-point-handlers.
  // Having a dedicated helper eliminates 4× duplication of mat4/vec3 boilerplate.

  it('should transform a single odom position through identity matrix', () => {
    const odomPos: Vector3 = [100, 0, 0]; // 100m North
    const result = fusedGpsFromOdom(IDENTITY_MAT4, odomPos, ZERO_REF);

    // 100m North of (50.0, 8.0) ≈ lat + 100/111320 ≈ 50.000898
    expect(result.lat).toBeGreaterThan(50.0);
    expect(result.lon).toBeCloseTo(8.0, 4);
  });

  it('should apply translation from alignment matrix', () => {
    const odomPos: Vector3 = [0, 0, 0]; // origin
    const result = fusedGpsFromOdom(TRANSLATION_MAT4, odomPos, ZERO_REF);

    // Translation is (10, 0, 20) → 10m North, 20m East
    const originResult = fusedGpsFromOdom(IDENTITY_MAT4, [0, 0, 0], ZERO_REF);
    expect(result.lat).toBeGreaterThan(originResult.lat); // moved North
    expect(result.lon).toBeGreaterThan(originResult.lon); // moved East
  });

  it('should produce same result as computeFusedPath for a single point', () => {
    const odomPos: Vector3 = [5, 3, 7];
    const singleResult = fusedGpsFromOdom(TRANSLATION_MAT4, odomPos, ZERO_REF);
    const batchResult = computeFusedPath({
      odometryPositions: [odomPos],
      alignmentMatrix: TRANSLATION_MAT4,
      zeroRef: ZERO_REF,
    });

    expect(batchResult).toHaveLength(1);
    expect(singleResult.lat).toBeCloseTo(batchResult[0].lat, 10);
    // computeFusedPath returns .lng, fusedGpsFromOdom returns .lon
    expect(singleResult.lon).toBeCloseTo(batchResult[0].lng, 10);
  });
});
