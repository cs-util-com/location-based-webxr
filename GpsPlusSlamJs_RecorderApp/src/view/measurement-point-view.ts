/**
 * Measurement Point View — dual-dot visualization.
 *
 * Renders each confirmed measurement point as two connected dots:
 *   - AR dot: the solved position in AR-local frame
 *   - GPS dot: recomputed every frame from arPosition × currentAlignmentMatrix
 *
 * The gap between them is a live alignment-error probe. The GPS dot
 * position is NEVER read from the stored gpsPositionSnapshot — it is
 * always recomputed live so the gap reacts as the alignment matrix updates.
 *
 * FIX 3: GPS dot is hidden when gpsPositionSnapshot === null AND no live
 *         alignment matrix is available (no ghost dot at world origin).
 *
 * All functions have cyclomatic complexity ≤ 10.
 */

import type { Vector3, Matrix4 } from 'gps-plus-slam-app-framework/core';
import type { MeasurementPointEntity } from '../storage/measurement-point-loader';
import { arLocalToGpsWorld } from '../utils/measurement-coordinate-conversion';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AR_DOT_COLOR = 0x00ff88; // Green — AR-local
const GPS_DOT_COLOR = 0xff8800; // Orange — GPS-world
const LINE_COLOR = 0xffffff;
const DOT_RADIUS = 0.05;
const LINE_WIDTH = 2;
const PROVISIONAL_DOT_COLOR = 0x39ff14; // Bright green — provisional
const RAY_LINE_COLOR = 0xff2020; // Bright red — observation ray
const RAY_LINE_LENGTH = 10; // How far to draw the ray into the scene (meters)

// ---------------------------------------------------------------------------
// THREE.js helpers (lazy-imported to keep the module testable without Three)
// ---------------------------------------------------------------------------

// These functions use the global THREE namespace (available via the recorder's
// Three.js import). Type annotations are structural to avoid a hard import
// dependency in this file — the caller passes Three objects through.

interface ThreeVector3 {
  set(x: number, y: number, z: number): void;
}

interface ThreeMesh {
  position: ThreeVector3;
  visible: boolean;
  renderOrder?: number;
  material:
    | {
        opacity?: number;
        transparent?: boolean;
        color?: { set(c: number): void };
      }
    | {
        opacity?: number;
        transparent?: boolean;
        color?: { set(c: number): void };
      }[];
}

/**
 * Build a measurement point visualization descriptor.
 * The actual Three.js objects are created by the caller (main.ts or a
 * wiring module) using this descriptor's parameters, keeping this module
 * free of hard Three.js constructor imports.
 */
interface MeasurementPointVisualDescriptor {
  arDotColor: number;
  gpsDotColor: number;
  lineColor: number;
  dotRadius: number;
  lineWidth: number;
}

/** Returns the visual parameters for a confirmed measurement point.
 * @public
 */
export function getConfirmedVisualParams(): MeasurementPointVisualDescriptor {
  return {
    arDotColor: AR_DOT_COLOR, // Green for confirmed points
    gpsDotColor: GPS_DOT_COLOR,
    lineColor: LINE_COLOR,
    dotRadius: DOT_RADIUS,
    lineWidth: LINE_WIDTH,
  };
}

/** Returns the visual parameters for a provisional (pre-confirm) point.
 * @public
 */
export function getProvisionalVisualParams(): MeasurementPointVisualDescriptor {
  return {
    arDotColor: PROVISIONAL_DOT_COLOR,
    gpsDotColor: PROVISIONAL_DOT_COLOR,
    lineColor: LINE_COLOR,
    dotRadius: DOT_RADIUS * 0.8,
    lineWidth: LINE_WIDTH,
  };
}

// ---------------------------------------------------------------------------
// Update helpers (operate on structural Three.js interfaces)
// ---------------------------------------------------------------------------

/**
 * Update the AR-local dot position in a measurement point group.
 * The group is expected to have userData.arDot referencing the mesh.
 * @public
 */
export function updateArDotPosition(
  arDot: ThreeMesh,
  arPosition: Vector3
): void {
  arDot.position.set(arPosition[0], arPosition[1], arPosition[2]);
}

/**
 * Recompute and update the GPS-world dot position from
 * arPosition × alignmentMatrix. This is what makes the gap react live.
 *
 * FIX 3: When no alignment matrix is available, the GPS dot is hidden
 * instead of rendering at [0,0,0]. Only the AR-local dot shows.
 * @public
 */
export function updateGpsDotPosition(
  gpsDot: ThreeMesh,
  arPosition: Vector3,
  alignmentMatrix: Matrix4 | null | undefined
): void {
  const gpsPos = arLocalToGpsWorld(arPosition, alignmentMatrix);
  if (gpsPos) {
    gpsDot.position.set(gpsPos[0], gpsPos[1], gpsPos[2]);
    gpsDot.visible = true;
  } else {
    // No alignment matrix — hide GPS dot to prevent ghost at origin
    gpsDot.visible = false;
  }
}

/**
 * Update the line connecting the AR and GPS dots.
 * Reads positions from the two dot meshes.
 * @public
 */
export function updateConnectionLinePositions(
  lineGeometry: {
    setFromPoints(points: { x: number; y: number; z: number }[]): void;
    visible?: boolean;
  },
  arPosition: Vector3,
  gpsPosition: Vector3 | null
): void {
  if (!gpsPosition) {
    lineGeometry.visible = false;
    return;
  }
  lineGeometry.visible = true;
  lineGeometry.setFromPoints([
    { x: arPosition[0], y: arPosition[1], z: arPosition[2] },
    { x: gpsPosition[0], y: gpsPosition[1], z: gpsPosition[2] },
  ]);
}

/**
 * Full update of a measurement point's visualization.
 * Called every frame for each confirmed point.
 * @public
 */
export function updateMeasurementPointVisual(
  arDot: ThreeMesh,
  gpsDot: ThreeMesh,
  lineGeometry: {
    setFromPoints(points: { x: number; y: number; z: number }[]): void;
    visible?: boolean;
  },
  entity: MeasurementPointEntity,
  alignmentMatrix: Matrix4 | null | undefined
): void {
  updateArDotPosition(arDot, entity.arPosition);
  updateGpsDotPosition(gpsDot, entity.arPosition, alignmentMatrix);
  const gpsPos = arLocalToGpsWorld(entity.arPosition, alignmentMatrix);
  updateConnectionLinePositions(lineGeometry, entity.arPosition, gpsPos);
}

// ---------------------------------------------------------------------------
// Provisional sphere helpers (Phase 3)
// ---------------------------------------------------------------------------

/**
 * Update a provisional (pre-confirm) sphere's position and appearance.
 * Opacity and size scale inversely with uncertainty — a tighter estimate
 * produces a more solid, larger sphere.
 * @public
 */
export function updateProvisionalSphere(
  mesh: ThreeMesh,
  provisionalPoint: { x: number; y: number; z: number } | undefined,
  uncertainty: number | undefined,
  maxUncertaintyHard: number
): void {
  if (!provisionalPoint) {
    mesh.visible = false;
    return;
  }

  mesh.visible = true;
  mesh.renderOrder = 1000;
  mesh.position.set(provisionalPoint.x, provisionalPoint.y, provisionalPoint.z);

  // Scale opacity by confidence (inverse uncertainty)
  const unc = uncertainty ?? maxUncertaintyHard;
  const confidence = 1 - Math.min(1, unc / maxUncertaintyHard);
  const material = Array.isArray(mesh.material)
    ? mesh.material[0]
    : mesh.material;
  if (material?.transparent !== undefined) {
    material.transparent = true;
  }
  if (material?.opacity !== undefined) {
    material.opacity = 0.3 + 0.7 * confidence;
  }
}

// ---------------------------------------------------------------------------
// Pending-ray line visualization (Task 3)
// ---------------------------------------------------------------------------

/**
 * Visual parameters for observation ray lines.
 * @public
 */
export function getRayVisualParams(): {
  color: number;
  lineLength: number;
  lineWidth: number;
} {
  return {
    color: RAY_LINE_COLOR,
    lineLength: RAY_LINE_LENGTH,
    lineWidth: 3,
  };
}

/**
 * Build the two 3D endpoints for a ray line to be drawn in the AR scene.
 * Returns an array of two `{x, y, z}` objects: [origin, endPoint].
 * @public
 */
export function buildRayLinePoints(
  rayOrigin: Vector3,
  rayDirection: Vector3,
  length?: number
): [{ x: number; y: number; z: number }, { x: number; y: number; z: number }] {
  const l = length ?? RAY_LINE_LENGTH;
  return [
    { x: rayOrigin[0], y: rayOrigin[1], z: rayOrigin[2] },
    {
      x: rayOrigin[0] + rayDirection[0] * l,
      y: rayOrigin[1] + rayDirection[1] * l,
      z: rayOrigin[2] + rayDirection[2] * l,
    },
  ];
}
