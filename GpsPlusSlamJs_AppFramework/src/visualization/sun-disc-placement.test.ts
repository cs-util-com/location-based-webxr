import { describe, expect, it } from 'vitest';
import type { NueDirection } from '../geo/sun-position.js';
import {
  computeSunDiscWorldPosition,
  isSunDirectionAboveHorizon,
} from './sun-disc-placement.js';

const DECIMAL_PLACES = 12;

function expectPositionCloseTo(
  actual: Readonly<{ x: number; y: number; z: number }>,
  expected: Readonly<{ x: number; y: number; z: number }>
): void {
  expect(actual.x).toBeCloseTo(expected.x, DECIMAL_PLACES);
  expect(actual.y).toBeCloseTo(expected.y, DECIMAL_PLACES);
  expect(actual.z).toBeCloseTo(expected.z, DECIMAL_PLACES);
}

describe('computeSunDiscWorldPosition', () => {
  const origin = { x: 0, y: 0, z: 0 };
  const distance = 10;

  it.each([
    {
      name: 'North',
      directionNue: { x: 1, y: 0, z: 0 },
      expected: { x: 10, y: 0, z: 0 },
    },
    {
      name: 'South',
      directionNue: { x: -1, y: 0, z: 0 },
      expected: { x: -10, y: 0, z: 0 },
    },
    {
      name: 'East',
      directionNue: { x: 0, y: 0, z: 1 },
      expected: { x: 0, y: 0, z: 10 },
    },
    {
      name: 'West',
      directionNue: { x: 0, y: 0, z: -1 },
      expected: { x: 0, y: 0, z: -10 },
    },
    {
      name: 'Up',
      directionNue: { x: 0, y: 1, z: 0 },
      expected: { x: 0, y: 10, z: 0 },
    },
  ] satisfies ReadonlyArray<{
    name: string;
    directionNue: NueDirection;
    expected: { x: number; y: number; z: number };
  }>)(
    'places a $name sun on the expected GPS-world NUE axis',
    ({ directionNue, expected }) => {
      expectPositionCloseTo(
        computeSunDiscWorldPosition(origin, directionNue, distance),
        expected
      );
    }
  );

  it('includes a non-zero camera world position', () => {
    const cameraWorldPosition = { x: 4, y: -2, z: 7 };
    const directionNue: NueDirection = { x: 0, y: 1, z: 0 };

    expectPositionCloseTo(
      computeSunDiscWorldPosition(
        cameraWorldPosition,
        directionNue,
        distance
      ),
      { x: 4, y: 8, z: 7 }
    );
  });

  it.each([
    { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 },
    { x: 0, y: Math.SQRT1_2, z: -Math.SQRT1_2 },
    { x: 1 / Math.sqrt(3), y: 1 / Math.sqrt(3), z: 1 / Math.sqrt(3) },
  ] satisfies readonly NueDirection[])(
    'preserves the requested distance for normalized direction $x, $y, $z',
    (directionNue) => {
      const cameraWorldPosition = { x: -3, y: 5, z: 11 };
      const requestedDistance = 23.5;
      const position = computeSunDiscWorldPosition(
        cameraWorldPosition,
        directionNue,
        requestedDistance
      );

      expect(
        Math.hypot(
          position.x - cameraWorldPosition.x,
          position.y - cameraWorldPosition.y,
          position.z - cameraWorldPosition.z
        )
      ).toBeCloseTo(requestedDistance, DECIMAL_PLACES);
    }
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid distance %s',
    (invalidDistance) => {
      expect(() =>
        computeSunDiscWorldPosition(
          origin,
          { x: 1, y: 0, z: 0 },
          invalidDistance
        )
      ).toThrow();
    }
  );

  it.each([
    { name: 'zero-length', directionNue: { x: 0, y: 0, z: 0 } },
    {
      name: 'non-finite X',
      directionNue: { x: Number.NaN, y: 0, z: 0 },
    },
    {
      name: 'non-finite Y',
      directionNue: { x: 0, y: Number.POSITIVE_INFINITY, z: 0 },
    },
    {
      name: 'non-finite Z',
      directionNue: { x: 0, y: 0, z: Number.NEGATIVE_INFINITY },
    },
  ] satisfies ReadonlyArray<{ name: string; directionNue: NueDirection }>)(
    'rejects a $name direction',
    ({ directionNue }) => {
      expect(() =>
        computeSunDiscWorldPosition(origin, directionNue, distance)
      ).toThrow();
    }
  );
});

describe('isSunDirectionAboveHorizon', () => {
  it('returns true for positive NUE Y', () => {
    expect(isSunDirectionAboveHorizon({ x: 0, y: 0.001, z: 1 })).toBe(
      true
    );
  });

  it('returns false for negative NUE Y', () => {
    expect(isSunDirectionAboveHorizon({ x: 0, y: -0.001, z: 1 })).toBe(
      false
    );
  });

  it('treats the horizon itself as not above the horizon', () => {
    expect(isSunDirectionAboveHorizon({ x: 1, y: 0, z: 0 })).toBe(false);
  });
});
