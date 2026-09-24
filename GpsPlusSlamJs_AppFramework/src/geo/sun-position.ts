import SunCalc from 'suncalc';

/** A normalized direction in the framework's North-Up-East coordinate system. */
export interface NueDirection {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The astronomical sun angles and their direction in NUE coordinates. */
export interface SunPositionResult {
  readonly azimuthRad: number;
  readonly altitudeRad: number;
  readonly directionNue: NueDirection;
  readonly isAboveHorizon: boolean;
}

/**
 * Convert SunCalc 1.x angles to a normalized NUE direction.
 *
 * SunCalc measures azimuth from South: zero is South, positive angles turn
 * toward West, and negative angles turn toward East. The framework uses
 * +X = North, +Y = Up, and +Z = East. The minus signs on X and Z account for
 * those different conventions.
 */
export function sunCalcAnglesToNue(
  azimuthRad: number,
  altitudeRad: number
): NueDirection {
  const cosAltitude = Math.cos(altitudeRad);
  const x = -cosAltitude * Math.cos(azimuthRad);
  const y = Math.sin(altitudeRad);
  const z = -cosAltitude * Math.sin(azimuthRad);

  // The trigonometric result is already a unit vector mathematically. Divide
  // by its measured length to remove small floating-point rounding errors.
  const length = Math.hypot(x, y, z);

  return {
    x: x / length,
    y: y / length,
    z: z / length,
  };
}

/**
 * Calculate the sun's position for one absolute instant and GPS coordinate.
 */
export function calculateSunPosition(
  date: Date,
  latitudeDeg: number,
  longitudeDeg: number
): SunPositionResult {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError('date must be a valid Date');
  }
  if (!Number.isFinite(latitudeDeg)) {
    throw new TypeError('latitudeDeg must be a finite number');
  }
  if (!Number.isFinite(longitudeDeg)) {
    throw new TypeError('longitudeDeg must be a finite number');
  }
  if (latitudeDeg < -90 || latitudeDeg > 90) {
    throw new RangeError('latitudeDeg must be between -90 and 90');
  }
  if (longitudeDeg < -180 || longitudeDeg > 180) {
    throw new RangeError('longitudeDeg must be between -180 and 180');
  }

  const { azimuth, altitude } = SunCalc.getPosition(
    date,
    latitudeDeg,
    longitudeDeg
  );

  return {
    azimuthRad: azimuth,
    altitudeRad: altitude,
    directionNue: sunCalcAnglesToNue(azimuth, altitude),
    // Preserve negative altitude and keep returning its direction below the
    // horizon; rendering policy belongs to a later iteration.
    isAboveHorizon: altitude > 0,
  };
}
