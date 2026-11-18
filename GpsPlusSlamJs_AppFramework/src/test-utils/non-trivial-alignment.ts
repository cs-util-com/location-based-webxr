/**
 * `makeNonTrivialAlignment` — build a deliberately ugly, non-symmetric
 * alignment matrix for coordinate-frame tests.
 *
 * Why this exists: the identity matrix is the worst possible fixture for a
 * transform test, because `identity⁻¹ · x === identity · x === x` makes a
 * whole family of *wrong* implementations (identity, double-application,
 * inverse, transpose-of-symmetric) indistinguishable from the correct one.
 * The `GpsAnchor` alignment-frame bug
 * (gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-gps-anchor-alignment-frame-bug.md)
 * went undetected for exactly this reason. Default every transform test to a
 * non-axis rotation + non-zero translation; identity becomes a free
 * corollary that needs only an explicit degenerate-case test.
 *
 * The produced matrix is a **rigid** transform (rotation + translation,
 * unit scale) to mirror the real alignment matrix, whose alignment solver
 * yields scale ≈ 1. Unit scale keeps Euclidean distances preserved,
 * so threshold-gate semantics (which compare metre distances) survive the
 * change of frame — the matrix can be inverted and round-tripped exactly.
 *
 * Returned as a 16-element **column-major** array, matching both gl-matrix
 * `mat4` (how the production alignment matrix is computed) and
 * `THREE.Matrix4.fromArray` (how `applyAlignmentMatrix` consumes it).
 */
import * as THREE from 'three';

import { mulberry32 } from '../utils/mulberry32.js';

/**
 * Build a non-trivial rigid alignment matrix.
 *
 * @param seed - Optional seed for deterministic variation across tests.
 *   The same seed always yields the same matrix; different seeds yield
 *   different (but always non-trivial) matrices.
 * @returns 16-element column-major matrix array (rotation + translation,
 *   unit scale).
 */
export function makeNonTrivialAlignment(seed = 1): readonly number[] {
  const rnd = mulberry32((seed >>> 0) ^ 0x9e3779b9);
  // Tilted, non-axis-aligned rotation axis. Fall back to a fixed non-axis
  // direction in the (astronomically unlikely) event of a zero vector.
  const axis = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
  if (axis.lengthSq() < 1e-6) axis.set(1, 2, 3);
  axis.normalize();
  // Substantial rotation (20°..80°) so the transform is visibly non-identity.
  const angle = ((20 + rnd() * 60) * Math.PI) / 180;
  const quat = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  // Non-zero translation in metres, spanning roughly ±20 m on each axis.
  const translation = new THREE.Vector3(
    rnd() * 40 - 20,
    rnd() * 40 - 20,
    rnd() * 40 - 20
  );
  const matrix = new THREE.Matrix4().compose(
    translation,
    quat,
    new THREE.Vector3(1, 1, 1)
  );
  return matrix.toArray();
}
