/**
 * Aiming Ray Capture Tests.
 *
 * Verifies pure ray construction from camera pose + projection + aimed pixel.
 */

import { describe, expect, it } from 'vitest';
import type {
  Matrix4,
  Quaternion,
  Vector3,
} from 'gps-plus-slam-app-framework/core';
import {
  createAimedRay,
  createTapRay,
  CROSSHAIR_SCREEN,
  normalizeAimingCoordinates,
  normalizePointerCoordinates,
} from './aiming-ray-capture';

const ORIGIN: Vector3 = [0, 0, 0] as Vector3;
const IDENTITY_QUAT: Quaternion = [0, 0, 0, 1] as Quaternion;

function centredProjectionMatrix(fx = 1.7, fy = 1.7): Matrix4 {
  return [
    fx,
    0,
    0,
    0,
    0,
    fy,
    0,
    0,
    0,
    0,
    -1.0002,
    -1,
    0,
    0,
    -0.020002,
    0,
  ] as unknown as Matrix4;
}

describe('createTapRay', () => {
  it('returns null for degenerate projection matrix', () => {
    const singularProjection = new Array(16).fill(0) as unknown as Matrix4;
    expect(
      createTapRay(ORIGIN, IDENTITY_QUAT, singularProjection, 0.5, 0.5)
    ).toBeNull();
  });

  it('returns null for out-of-bounds screen coordinates', () => {
    const proj = centredProjectionMatrix();
    expect(createTapRay(ORIGIN, IDENTITY_QUAT, proj, -0.01, 0.5)).toBeNull();
    expect(createTapRay(ORIGIN, IDENTITY_QUAT, proj, 1.01, 0.5)).toBeNull();
    expect(createTapRay(ORIGIN, IDENTITY_QUAT, proj, 0.5, -0.01)).toBeNull();
    expect(createTapRay(ORIGIN, IDENTITY_QUAT, proj, 0.5, 1.01)).toBeNull();
  });

  it('center tap yields camera-forward ray with identity rotation', () => {
    const proj = centredProjectionMatrix();
    const ray = createTapRay(ORIGIN, IDENTITY_QUAT, proj, 0.5, 0.5);

    expect(ray).not.toBeNull();
    expect(ray!.direction[0]).toBeCloseTo(0, 8);
    expect(ray!.direction[1]).toBeCloseTo(0, 8);
    expect(ray!.direction[2]).toBeCloseTo(-1, 8);
  });

  it('top-left tap points toward top-left frustum for identity rotation', () => {
    const proj = centredProjectionMatrix();
    const ray = createTapRay(ORIGIN, IDENTITY_QUAT, proj, 0, 0);

    expect(ray).not.toBeNull();
    expect(ray!.direction[0]).toBeLessThan(0);
    expect(ray!.direction[1]).toBeGreaterThan(0);
    expect(ray!.direction[2]).toBeLessThan(0);
  });

  it('always returns a normalized direction', () => {
    const proj = centredProjectionMatrix();
    const samples: Array<[number, number]> = [
      [0.5, 0.5],
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [0.37, 0.81],
    ];

    for (const [x, y] of samples) {
      const ray = createTapRay(ORIGIN, IDENTITY_QUAT, proj, x, y);
      expect(ray).not.toBeNull();
      const [dx, dy, dz] = ray!.direction;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      expect(len).toBeCloseTo(1, 8);
    }
  });

  it('is deterministic for identical inputs', () => {
    const proj = centredProjectionMatrix();
    const first = createTapRay(ORIGIN, IDENTITY_QUAT, proj, 0.31, 0.69);
    const second = createTapRay(ORIGIN, IDENTITY_QUAT, proj, 0.31, 0.69);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.origin).toEqual(second!.origin);
    expect(first!.direction[0]).toBeCloseTo(second!.direction[0], 12);
    expect(first!.direction[1]).toBeCloseTo(second!.direction[1], 12);
    expect(first!.direction[2]).toBeCloseTo(second!.direction[2], 12);
  });
});

describe('crosshair convention', () => {
  it('exposes center screen as [0.5, 0.5]', () => {
    expect(CROSSHAIR_SCREEN).toEqual([0.5, 0.5]);
  });

  it('crosshair through createTapRay matches explicit center tap', () => {
    const proj = centredProjectionMatrix();
    const explicit = createTapRay(ORIGIN, IDENTITY_QUAT, proj, 0.5, 0.5);
    const crosshair = createTapRay(
      ORIGIN,
      IDENTITY_QUAT,
      proj,
      CROSSHAIR_SCREEN[0],
      CROSSHAIR_SCREEN[1]
    );

    expect(explicit).not.toBeNull();
    expect(crosshair).not.toBeNull();
    expect(crosshair!.direction[0]).toBeCloseTo(explicit!.direction[0], 10);
    expect(crosshair!.direction[1]).toBeCloseTo(explicit!.direction[1], 10);
    expect(crosshair!.direction[2]).toBeCloseTo(explicit!.direction[2], 10);
  });
});

describe('normalizeAimingCoordinates', () => {
  it('reject policy returns null for out-of-bounds coordinates', () => {
    expect(normalizeAimingCoordinates(-0.2, 0.4)).toBeNull();
    expect(normalizeAimingCoordinates(1.1, 0.4)).toBeNull();
    expect(normalizeAimingCoordinates(0.4, -0.2)).toBeNull();
    expect(normalizeAimingCoordinates(0.4, 1.1)).toBeNull();
  });

  it('clamp policy clamps both axes into [0,1]', () => {
    expect(
      normalizeAimingCoordinates(-0.2, 1.4, { outOfBoundsPolicy: 'clamp' })
    ).toEqual({ screenX: 0, screenY: 1 });
    expect(
      normalizeAimingCoordinates(0.25, 0.75, { outOfBoundsPolicy: 'clamp' })
    ).toEqual({ screenX: 0.25, screenY: 0.75 });
  });
});

describe('normalizePointerCoordinates', () => {
  const viewport = { left: 100, top: 50, width: 400, height: 200 };

  it('maps client coordinates within the camera viewport', () => {
    expect(normalizePointerCoordinates(300, 150, viewport)).toEqual({
      screenX: 0.5,
      screenY: 0.5,
    });
  });

  it('rejects letterboxed margins outside the camera viewport', () => {
    expect(normalizePointerCoordinates(90, 150, viewport)).toBeNull();
    expect(normalizePointerCoordinates(300, 260, viewport)).toBeNull();
  });
});

describe('createAimedRay', () => {
  it('returns null for out-of-bounds tap when policy is reject', () => {
    const proj = centredProjectionMatrix();
    const aimed = createAimedRay(ORIGIN, IDENTITY_QUAT, proj, -0.3, 0.5, {
      outOfBoundsPolicy: 'reject',
    });
    expect(aimed).toBeNull();
  });

  it('clamps coordinates and returns the ray when policy is clamp', () => {
    const proj = centredProjectionMatrix();
    const aimed = createAimedRay(ORIGIN, IDENTITY_QUAT, proj, -0.3, 1.4, {
      outOfBoundsPolicy: 'clamp',
    });

    expect(aimed).not.toBeNull();
    expect(aimed!.screenX).toBe(0);
    expect(aimed!.screenY).toBe(1);
  });

  it('returns center-forward ray via CROSSHAIR_SCREEN', () => {
    const proj = centredProjectionMatrix();
    const aimed = createAimedRay(
      ORIGIN,
      IDENTITY_QUAT,
      proj,
      CROSSHAIR_SCREEN[0],
      CROSSHAIR_SCREEN[1]
    );

    expect(aimed).not.toBeNull();
    expect(aimed!.ray.direction[0]).toBeCloseTo(0, 8);
    expect(aimed!.ray.direction[1]).toBeCloseTo(0, 8);
    expect(aimed!.ray.direction[2]).toBeCloseTo(-1, 8);
  });
});
