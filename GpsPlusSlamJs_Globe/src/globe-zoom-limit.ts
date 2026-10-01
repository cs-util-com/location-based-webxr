/**
 * The globe controls' zoom-out limit (round-5 plan 2026-10-01-0945 §3.1,
 * DEC-GL5-1; review 2026-10-01-2124 Major 1): 3d-tiles-renderer 0.5.3's
 * GlobeControls stop zooming out at a private
 * `_getMaxPerspectiveDistance()` (2 x the larger of R / tan(fov / 2) per
 * axis, about 27,400 km at 50 degrees on 16:9 and 59,200 km on a 390x844
 * portrait), with no public setting. This overrides it on ONE instance;
 * `globe-zoom-limit.test.ts` guards the method's name and its two callers,
 * so a library bump fails there loudly.
 *
 * @see globe-zoom-limit.ts.md
 */
import type { GlobeControls } from "3d-tiles-renderer";

export const GLOBE_ZOOM_OUT = {
  /** The limit is at least this many times the fitted distance. */
  fitFactor: 2,
} as const;

const DEG = Math.PI / 180;

function positive(name: string, value: number): void {
  if (!(value > 0 && Number.isFinite(value))) {
    throw new RangeError(`${name} must be positive and finite, got ${value}`);
  }
}

/**
 * The library's own limit for a camera of `fovYDeg` and `aspect` (its
 * `_getMaxPerspectiveDistance`, replicated so it can be taken at the lab's
 * field of view rather than the camera's, which the fly-in varies): the
 * Earth at half the size of the larger field of view.
 */
export function libraryZoomOutM(input: {
  radiusM: number;
  fovYDeg: number;
  aspect: number;
}): number {
  const { radiusM, fovYDeg, aspect } = input;
  positive("the radius", radiusM);
  positive("the aspect", aspect);
  if (!(fovYDeg > 0 && fovYDeg < 180)) {
    throw new RangeError(
      `the field of view must be in (0, 180), got ${fovYDeg}`,
    );
  }
  const tanHalfV = Math.tan((fovYDeg / 2) * DEG);
  const tanHalfH = tanHalfV * aspect;
  return 2 * Math.max(radiusM / tanHalfV, radiusM / tanHalfH);
}

/**
 * How far the controls zoom out, and where the fly-in starts: the largest
 * of the decided distance `maxM`, the library's own limit and
 * `fitFactor` x the fitted distance `fitM` (metres from the centre). So a
 * portrait screen, or a narrow field of view, never zooms out less than
 * the library allows or less than twice the fit.
 */
export function globeZoomOutLimitM(input: {
  maxM: number;
  radiusM: number;
  fovYDeg: number;
  aspect: number;
  fitM: number;
  fitFactor?: number;
}): number {
  const { maxM, fitM, fitFactor = GLOBE_ZOOM_OUT.fitFactor } = input;
  positive("the decided distance", maxM);
  positive("the fitted distance", fitM);
  positive("the fit factor", fitFactor);
  return Math.max(maxM, libraryZoomOutM(input), fitFactor * fitM);
}

type WithLimit = { _getMaxPerspectiveDistance: () => number };

/**
 * Makes `controls` zoom out to `limitM()` metres from the Earth's centre
 * (the same quantity the library compares), asked on every call so it
 * follows a resize or a new field of view. Also what its zoom's tilt and
 * north alignment scale against. A value that is not positive and finite
 * falls back to the library's own limit; a getter that is not a function
 * is a TypeError.
 */
export function limitGlobeZoomOut(
  controls: GlobeControls,
  limitM: () => number,
): void {
  if (typeof limitM !== "function") {
    throw new TypeError("the zoom-out limit must be a function");
  }
  const own = (Object.getPrototypeOf(controls) as WithLimit)
    ._getMaxPerspectiveDistance;
  (controls as unknown as WithLimit)._getMaxPerspectiveDistance = () => {
    const m = limitM();
    return m > 0 && Number.isFinite(m) ? m : own.call(controls);
  };
}
