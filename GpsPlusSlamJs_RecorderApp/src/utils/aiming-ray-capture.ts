/**
 * Aiming Ray Capture.
 * Builds a world-space measurement ray from a camera pose + projection + aimed screen pixel.
 */

import type {
  Matrix4,
  Quaternion,
  Vector3,
} from 'gps-plus-slam-app-framework/core';
import { createDepthUnprojector } from 'gps-plus-slam-app-framework/ar/depth-unprojection';

/** Canonical center-screen coordinate for crosshair shoots. */
export const CROSSHAIR_SCREEN = [0.5, 0.5] as const;

type OutOfBoundsPolicy = 'reject' | 'clamp';

export interface AimingCoordinateOptions {
  /**
   * How to handle coordinates outside [0, 1].
   * - reject: return null
   * - clamp: clamp each axis into [0, 1]
   */
  readonly outOfBoundsPolicy?: OutOfBoundsPolicy;
}

export interface AimingViewport {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface AimedRay {
  readonly ray: MeasurementRay;
  /** Final normalized coordinate used to create the ray (after policy). */
  readonly screenX: number;
  /** Final normalized coordinate used to create the ray (after policy). */
  readonly screenY: number;
}

/** A mathematical world-space ray representing a measurement shoot. */
export interface MeasurementRay {
  /** World-space camera origin at shoot-time. */
  readonly origin: Vector3;
  /** World-space direction, normalized to unit length. */
  readonly direction: Vector3;
}

/**
 * Builds a ray from the camera through the aimed normalized screen coordinate.
 *
 * Coordinates must be in [0, 1] with top-left origin and aligned to the camera
 * texture coordinate frame used by the projection matrix.
 */
export function createTapRay(
  cameraPos: Vector3,
  cameraRot: Quaternion,
  projectionMatrix: Matrix4 | readonly number[] | Float32Array,
  screenX: number,
  screenY: number
): MeasurementRay | null {
  if (!isValidScreenCoordinate(screenX, screenY)) return null;

  const matrix = normalizeProjectionMatrix(projectionMatrix);
  if (!matrix) return null;

  const unprojector = createDepthUnprojector(cameraPos, cameraRot, matrix);
  if (!unprojector) return null;

  const targetPt = unprojector.unproject({
    screenX,
    screenY,
    depthM: 1.0,
  });
  if (!targetPt) return null;

  const dx = targetPt[0] - cameraPos[0];
  const dy = targetPt[1] - cameraPos[1];
  const dz = targetPt[2] - cameraPos[2];

  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!Number.isFinite(length) || length <= 0) return null;

  return {
    origin: [cameraPos[0], cameraPos[1], cameraPos[2]] as Vector3,
    direction: [dx / length, dy / length, dz / length] as Vector3,
  };
}

/**
 * Normalizes aimed coordinates for callers before ray creation.
 * Use this in the view layer to enforce an explicit out-of-bounds policy.
 */
export function normalizeAimingCoordinates(
  screenX: number,
  screenY: number,
  options: AimingCoordinateOptions = {}
): { screenX: number; screenY: number } | null {
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return null;

  const policy = options.outOfBoundsPolicy ?? 'reject';
  if (policy === 'clamp') {
    return {
      screenX: clamp01(screenX),
      screenY: clamp01(screenY),
    };
  }

  if (screenX < 0 || screenX > 1 || screenY < 0 || screenY > 1) return null;
  return { screenX, screenY };
}

/**
 * Convert a client-space pointer into the camera viewport's normalized space.
 * Letterboxed margins are rejected instead of being mapped to an incorrect
 * camera ray. The viewport is supplied in the same client coordinate space as
 * PointerEvent.clientX/clientY.
 */
export function normalizePointerCoordinates(
  clientX: number,
  clientY: number,
  viewport: AimingViewport
): { screenX: number; screenY: number } | null {
  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY) ||
    !Number.isFinite(viewport.left) ||
    !Number.isFinite(viewport.top) ||
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return null;
  }

  const screenX = (clientX - viewport.left) / viewport.width;
  const screenY = (clientY - viewport.top) / viewport.height;
  return normalizeAimingCoordinates(screenX, screenY);
}

/**
 * Higher-level helper for view handlers:
 * applies coordinate policy, then builds the ray through createTapRay.
 */
export function createAimedRay(
  cameraPos: Vector3,
  cameraRot: Quaternion,
  projectionMatrix: Matrix4 | readonly number[] | Float32Array,
  screenX: number,
  screenY: number,
  options: AimingCoordinateOptions = {}
): AimedRay | null {
  const normalized = normalizeAimingCoordinates(screenX, screenY, options);
  if (!normalized) return null;

  const ray = createTapRay(
    cameraPos,
    cameraRot,
    projectionMatrix,
    normalized.screenX,
    normalized.screenY
  );
  if (!ray) return null;

  return {
    ray,
    screenX: normalized.screenX,
    screenY: normalized.screenY,
  };
}

function normalizeProjectionMatrix(
  projectionMatrix: Matrix4 | readonly number[] | Float32Array
): Matrix4 | null {
  if (projectionMatrix.length !== 16) return null;
  return [...projectionMatrix] as unknown as Matrix4;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function isValidScreenCoordinate(screenX: number, screenY: number): boolean {
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return false;
  return screenX >= 0 && screenX <= 1 && screenY >= 0 && screenY <= 1;
}
