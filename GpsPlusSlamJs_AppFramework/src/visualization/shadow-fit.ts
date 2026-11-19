/**
 * How a cached sun-shadow map is FITTED to a view, pure: the near map's half
 * width from the camera distance, its centre snapped to the light-space
 * texel grid, the shadow strength over the sun's elevation, the shadow
 * camera's distance from the loaded city, and the near map's far plane that
 * starts the depth fade at a fixed fraction of its half width. No three.js;
 * every vector is in the caller's frame with y up (as `sun-shadow-rig.ts`).
 *
 * @see shadow-fit.ts.md
 */

import type { Vec3 } from './sun-shadow-rig.js';

const DEG = Math.PI / 180;

/** The near map's half-width steps, metres: a factor of about sqrt(2) apart. */
export const NEAR_HALF_WIDTH_STEPS: readonly number[] = Object.freeze([
  120, 170, 240, 340, 480, 600,
]);

/** The fit's defaults. */
export const SHADOW_FIT = {
  /** Near half width = k x camera distance, before the clamp. */
  k: 1,
  /** The ramp's floor: no shadow at or below this sun elevation. */
  floorDeg: 2,
  /** Full strength at and above this sun elevation. */
  fullDeg: 8,
  /** The shadow camera stands this far beyond the last caster, metres. */
  marginM: 30,
  /** The near map's depth fade starts this fraction of R past its centre. */
  fadeFraction: 0.9,
} as const;

/** The normalised depth at which the near map's depth fade starts. */
export const FADE_START_DEPTH = 0.98;

function assertPositive(value: number, what: string): void {
  if (!(Number.isFinite(value) && value > 0)) {
    throw new RangeError(`${what} must be finite and positive, got ${value}`);
  }
}

/**
 * The near map's half width R for a camera `distanceM` from its orbit
 * target: `k x distance`, rounded UP to the next listed step and clamped to
 * the first and last step, so a wheel zoom re-renders the map once per
 * step, not per frame.
 *
 * @throws RangeError for a non-finite or non-positive distance or k, or an
 *   empty, unsorted or non-positive step list.
 */
export function nearShadowHalfWidth(
  distanceM: number,
  options: {
    readonly k?: number;
    readonly steps?: readonly number[];
  } = {}
): number {
  const k = options.k ?? SHADOW_FIT.k;
  const steps = options.steps ?? NEAR_HALF_WIDTH_STEPS;
  assertPositive(distanceM, 'the camera distance');
  assertPositive(k, 'k');
  assertSteps(steps);
  const wanted = k * distanceM;
  return steps.find((step) => step >= wanted) ?? steps[steps.length - 1]!;
}

function assertSteps(steps: readonly number[]): void {
  const sorted = steps.every(
    (step, i) =>
      step > 0 && Number.isFinite(step) && (i === 0 || step > steps[i - 1]!)
  );
  if (steps.length === 0 || !sorted) {
    throw new RangeError(
      'the half-width steps must be positive and increasing'
    );
  }
}

/**
 * The lateral axes of three's shadow camera for a light looking along
 * `-sunDir` with world up: `x = up x sunDir`, `y = sunDir x x` (three's
 * `Matrix4.lookAt`). A sun at the zenith has no such x; the snap then uses
 * the world x axis.
 */
function lightAxes(sunDir: Vec3): [Vec3, Vec3] {
  const [sx, sy, sz] = sunDir;
  // up x s with up = (0, 1, 0).
  const length = Math.hypot(sz, sx);
  const x: Vec3 = length < 1e-9 ? [1, 0, 0] : [sz / length, 0, -sx / length];
  const y: Vec3 = [
    sy * x[2] - sz * x[1],
    sz * x[0] - sx * x[2],
    sx * x[1] - sy * x[0],
  ];
  return [x, y];
}

const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * `centre` moved onto the shadow map's texel grid in light space: along each
 * of the shadow camera's lateral axes its coordinate becomes a whole number
 * of texels (`2R / mapSize`). Depth along the sun is unchanged. A re-centred
 * map then samples the world at the same texel positions as before, so
 * shadow edges do not swim. Idempotent; moves by at most half a texel per
 * axis.
 *
 * @throws RangeError for a non-finite centre or direction, R <= 0 or a map
 *   size that is not a positive integer.
 */
export function snapShadowCentre(
  centre: Vec3,
  sunDir: Vec3,
  halfWidthM: number,
  mapSize: number
): Vec3 {
  if (![...centre, ...sunDir].every(Number.isFinite)) {
    throw new RangeError('the centre and the sun direction must be finite');
  }
  assertPositive(halfWidthM, 'the half width');
  if (!(Number.isInteger(mapSize) && mapSize > 0)) {
    throw new RangeError(
      `the map size must be a positive integer, got ${mapSize}`
    );
  }
  const texel = (2 * halfWidthM) / mapSize;
  const out: [number, number, number] = [centre[0], centre[1], centre[2]];
  for (const axis of lightAxes(sunDir)) {
    const u = dot(centre, axis);
    const shift = Math.round(u / texel) * texel - u;
    out[0] += axis[0] * shift;
    out[1] += axis[1] * shift;
    out[2] += axis[2] * shift;
  }
  return out;
}

/**
 * The shadow's strength over the sun's elevation: 0 at and below the
 * floor, 1 at and above full strength, linear between.
 *
 * @throws RangeError for non-finite values or `fullDeg <= floorDeg`.
 */
export function shadowStrengthAt(
  elevationDeg: number,
  ramp: { readonly floorDeg?: number; readonly fullDeg?: number } = {}
): number {
  const floor = ramp.floorDeg ?? SHADOW_FIT.floorDeg;
  const full = ramp.fullDeg ?? SHADOW_FIT.fullDeg;
  if (![elevationDeg, floor, full].every(Number.isFinite) || full <= floor) {
    throw new RangeError(
      `the ramp needs finite values and full above floor, got ${elevationDeg}, ${floor}, ${full}`
    );
  }
  if (elevationDeg <= floor) return 0;
  if (elevationDeg >= full) return 1;
  return (elevationDeg - floor) / (full - floor);
}

/** The loaded city: its ground centre, half width and tallest caster. */
export interface CityBox {
  /** The centre of the city's square, on the ground (y is the ground). */
  readonly centre: Vec3;
  /** Half the square's edge, metres. */
  readonly halfExtentM: number;
  /** The tallest caster above the ground, metres. */
  readonly maxHeightM: number;
}

function boxDistance(centre: Vec3, sunDir: Vec3, box: CityBox): number {
  let best = Number.NEGATIVE_INFINITY;
  const e = box.halfExtentM;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (const h of [0, box.maxHeightM]) {
        const corner: Vec3 = [
          box.centre[0] + sx * e - centre[0],
          box.centre[1] + h - centre[1],
          box.centre[2] + sz * e - centre[2],
        ];
        best = Math.max(best, dot(corner, sunDir));
      }
    }
  }
  return best;
}

/**
 * How far toward the sun the shadow camera stands from a map's centre:
 * beyond the farthest loaded caster (the city box's corners at the ground
 * and at the tallest height), capped by the farthest a caster can stand and
 * still throw a shadow into the map's square at the floor elevation
 * (`R sqrt 2 + maxHeight / sin(floor)`: D is measured along the sun, and a
 * caster top stands `h / sin(elevation)` up the ray from its shadow tip),
 * plus a margin; never closer than
 * `R + margin` (the pose needs D > R).
 *
 * @throws RangeError for non-finite input, R <= 0, a negative height or
 *   margin, or a floor outside (0, 90).
 */
export function shadowCasterDistance(input: {
  readonly centre: Vec3;
  readonly sunDir: Vec3;
  readonly halfWidthM: number;
  readonly city: CityBox;
  readonly floorDeg?: number;
  readonly marginM?: number;
}): number {
  const floor = input.floorDeg ?? SHADOW_FIT.floorDeg;
  const margin = input.marginM ?? SHADOW_FIT.marginM;
  assertCasterInput(input, floor, margin);
  const R = input.halfWidthM;
  const box = boxDistance(input.centre, input.sunDir, input.city);
  const cap = R * Math.SQRT2 + input.city.maxHeightM / Math.sin(floor * DEG);
  return Math.max(R, Math.min(box, cap)) + margin;
}

function assertCasterInput(
  input: Parameters<typeof shadowCasterDistance>[0],
  floor: number,
  margin: number
): void {
  const { centre, sunDir, city } = input;
  const finite = [...centre, ...sunDir, ...city.centre].every(Number.isFinite);
  if (!finite)
    throw new RangeError('the centres and the sun direction must be finite');
  assertPositive(input.halfWidthM, 'the half width');
  assertPositive(city.halfExtentM, 'the city half extent');
  if (!(city.maxHeightM >= 0 && Number.isFinite(city.maxHeightM))) {
    throw new RangeError(
      `the tallest height must be finite and >= 0, got ${city.maxHeightM}`
    );
  }
  if (!(margin >= 0 && Number.isFinite(margin))) {
    throw new RangeError(`the margin must be finite and >= 0, got ${margin}`);
  }
  if (!(floor > 0 && floor < 90)) {
    throw new RangeError(`the floor must be in (0, 90) degrees, got ${floor}`);
  }
}

/**
 * The near map's far plane that starts its depth fade (at normalised depth
 * `FADE_START_DEPTH`) exactly `f R` past the centre, for any R and D:
 * `(D + f R) / 0.98`.
 *
 * @throws RangeError for a non-finite or non-positive D or R, or f outside
 *   (0, 1].
 */
export function nearFadeFar(
  distanceM: number,
  halfWidthM: number,
  fadeFraction: number = SHADOW_FIT.fadeFraction
): number {
  assertPositive(distanceM, 'the distance');
  assertPositive(halfWidthM, 'the half width');
  if (!(fadeFraction > 0 && fadeFraction <= 1)) {
    throw new RangeError(
      `the fade fraction must be in (0, 1], got ${fadeFraction}`
    );
  }
  return (distanceM + fadeFraction * halfWidthM) / FADE_START_DEPTH;
}

/**
 * The far plane of a map that must reach every ground point of the city's
 * square from a camera D toward the sun: `D + R sqrt 2` (a corner).
 *
 * @throws RangeError for a non-finite or non-positive D or R.
 */
export function wholeSquareFar(distanceM: number, halfWidthM: number): number {
  assertPositive(distanceM, 'the distance');
  assertPositive(halfWidthM, 'the half width');
  return distanceM + halfWidthM * Math.SQRT2;
}
