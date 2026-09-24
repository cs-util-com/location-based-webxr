import SunCalc from 'suncalc';
import { describe, expect, it } from 'vitest';
import {
  calculateSunPosition,
  sunCalcAnglesToNue,
  type NueDirection,
} from './sun-position.js';

const DECIMAL_PLACES = 12;

function expectDirectionCloseTo(
  actual: NueDirection,
  expected: NueDirection
): void {
  expect(actual.x).toBeCloseTo(expected.x, DECIMAL_PLACES);
  expect(actual.y).toBeCloseTo(expected.y, DECIMAL_PLACES);
  expect(actual.z).toBeCloseTo(expected.z, DECIMAL_PLACES);
}

describe('sunCalcAnglesToNue', () => {
  it.each([
    { name: 'South', azimuthRad: 0, expected: { x: -1, y: 0, z: 0 } },
    {
      name: 'West',
      azimuthRad: Math.PI / 2,
      expected: { x: 0, y: 0, z: -1 },
    },
    {
      name: 'East',
      azimuthRad: -Math.PI / 2,
      expected: { x: 0, y: 0, z: 1 },
    },
    {
      name: 'North',
      azimuthRad: Math.PI,
      expected: { x: 1, y: 0, z: 0 },
    },
  ])('maps $name to the expected NUE axis', ({ azimuthRad, expected }) => {
    expectDirectionCloseTo(sunCalcAnglesToNue(azimuthRad, 0), expected);
  });

  it('maps the zenith to Up', () => {
    expectDirectionCloseTo(sunCalcAnglesToNue(1.234, Math.PI / 2), {
      x: 0,
      y: 1,
      z: 0,
    });
  });

  it('produces negative Y for a negative altitude', () => {
    const direction = sunCalcAnglesToNue(0.4, -Math.PI / 6);

    expect(direction.y).toBeLessThan(0);
    expect(direction.y).toBeCloseTo(-0.5, DECIMAL_PLACES);
  });

  it.each([
    { azimuthRad: 0, altitudeRad: 0 },
    { azimuthRad: 0.7, altitudeRad: 0.4 },
    { azimuthRad: -2.1, altitudeRad: -0.3 },
    { azimuthRad: Math.PI, altitudeRad: Math.PI / 2 },
  ])(
    'returns a unit vector for azimuth $azimuthRad and altitude $altitudeRad',
    ({ azimuthRad, altitudeRad }) => {
      const { x, y, z } = sunCalcAnglesToNue(azimuthRad, altitudeRad);

      expect(Math.hypot(x, y, z)).toBeCloseTo(1, DECIMAL_PLACES);
    }
  );

  it('returns equivalent directions for azimuths separated by a full turn', () => {
    const azimuthRad = 0.73;
    const altitudeRad = 0.28;
    const original = sunCalcAnglesToNue(azimuthRad, altitudeRad);
    const wrappedPositive = sunCalcAnglesToNue(
      azimuthRad + 2 * Math.PI,
      altitudeRad
    );
    const wrappedNegative = sunCalcAnglesToNue(
      azimuthRad - 2 * Math.PI,
      altitudeRad
    );

    expectDirectionCloseTo(wrappedPositive, original);
    expectDirectionCloseTo(wrappedNegative, original);
  });
});

describe('calculateSunPosition', () => {
  const latitudeDeg = 52.52;
  const longitudeDeg = 13.405;

  it('marks a fixed daytime position as above the horizon', () => {
    const result = calculateSunPosition(
      new Date('2026-06-21T12:00:00Z'),
      latitudeDeg,
      longitudeDeg
    );

    expect(result.altitudeRad).toBeGreaterThan(0);
    expect(result.isAboveHorizon).toBe(true);
  });

  it('marks a fixed nighttime position as below the horizon', () => {
    const result = calculateSunPosition(
      new Date('2026-06-21T00:00:00Z'),
      latitudeDeg,
      longitudeDeg
    );

    expect(result.altitudeRad).toBeLessThan(0);
    expect(result.isAboveHorizon).toBe(false);
  });

  it('preserves the azimuth and altitude returned by SunCalc', () => {
    const date = new Date('2026-06-21T12:00:00Z');
    const expected = SunCalc.getPosition(date, latitudeDeg, longitudeDeg);
    const actual = calculateSunPosition(date, latitudeDeg, longitudeDeg);

    expect(actual.azimuthRad).toBe(expected.azimuth);
    expect(actual.altitudeRad).toBe(expected.altitude);
  });

  it('rejects an invalid Date', () => {
    expect(() =>
      calculateSunPosition(new Date('invalid'), latitudeDeg, longitudeDeg)
    ).toThrow(TypeError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite latitude %s',
    (latitude) => {
      expect(() =>
        calculateSunPosition(new Date(), latitude, longitudeDeg)
      ).toThrow(TypeError);
    }
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite longitude %s',
    (longitude) => {
      expect(() =>
        calculateSunPosition(new Date(), latitudeDeg, longitude)
      ).toThrow(TypeError);
    }
  );

  it.each([-90.01, 90.01])(
    'rejects latitude outside its range: %s',
    (latitude) => {
      expect(() =>
        calculateSunPosition(new Date(), latitude, longitudeDeg)
      ).toThrow(RangeError);
    }
  );

  it.each([-90, 90])(
    'accepts latitude at its inclusive limit: %s',
    (latitude) => {
      expect(() => calculateSunPosition(new Date(), latitude, 0)).not.toThrow();
    }
  );

  it.each([-180.01, 180.01])(
    'rejects longitude outside its range: %s',
    (longitude) => {
      expect(() =>
        calculateSunPosition(new Date(), latitudeDeg, longitude)
      ).toThrow(RangeError);
    }
  );

  it.each([-180, 180])(
    'accepts longitude at its inclusive limit: %s',
    (longitude) => {
      expect(() =>
        calculateSunPosition(new Date(), 0, longitude)
      ).not.toThrow();
    }
  );
});
