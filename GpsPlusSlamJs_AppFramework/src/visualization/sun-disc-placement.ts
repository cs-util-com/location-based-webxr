import type { NueDirection } from '../geo/sun-position.js';

/** A position in the framework's North-Up-East coordinate system. */
export interface NuePosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function validateDirection(directionNue: NueDirection): void {
  const { x, y, z } = directionNue;

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new TypeError('directionNue components must be finite numbers');
  }
  if (x === 0 && y === 0 && z === 0) {
    throw new RangeError('directionNue must not be a zero-length vector');
  }
}

/**
 * Place a finite sun icon along a normalized GPS-world NUE direction.
 *
 * The direction is deliberately not normalized here. The Sun Position Core
 * owns the normalized-direction contract, and duplicating normalization in the
 * visualization layer could hide an upstream coordinate or data error.
 */
export function computeSunDiscWorldPosition(
  cameraWorldPosition: NuePosition,
  directionNue: NueDirection,
  distance: number
): NuePosition {
  if (!Number.isFinite(distance)) {
    throw new TypeError('distance must be a finite number');
  }
  if (distance <= 0) {
    throw new RangeError('distance must be greater than zero');
  }

  validateDirection(directionNue);

  return {
    x: cameraWorldPosition.x + directionNue.x * distance,
    y: cameraWorldPosition.y + directionNue.y * distance,
    z: cameraWorldPosition.z + directionNue.z * distance,
  };
}

/** Return whether a NUE sun direction lies strictly above the horizon. */
export function isSunDirectionAboveHorizon(
  directionNue: NueDirection
): boolean {
  return directionNue.y > 0;
}
