/**
 * The globe controls' zoom-out limit (round-5 plan 2026-10-01-0945 §3.1,
 * DEC-GL5-1): 3d-tiles-renderer 0.5.3's GlobeControls stop zooming out at
 * a private `_getMaxPerspectiveDistance()` (2 x the larger of R / tan(fov
 * / 2) per axis, about 27,400 km at 50 degrees on 16:9), with no public
 * setting. This overrides it on ONE instance; `globe-zoom-limit.test.ts`
 * guards the method's name and its two callers, so a library bump fails
 * there loudly.
 *
 * @see globe-zoom-limit.ts.md
 */
import type { GlobeControls } from "3d-tiles-renderer";

/**
 * Makes `controls` zoom out to at most `maxM` metres from the Earth's
 * centre (the same quantity the library compares), instead of its own
 * field-of-view-dependent limit. Also what its zoom's tilt and north
 * alignment scale against. RangeError for a distance that is not positive
 * and finite.
 */
export function limitGlobeZoomOut(controls: GlobeControls, maxM: number): void {
  if (!(maxM > 0 && Number.isFinite(maxM))) {
    throw new RangeError(`the zoom-out limit must be positive, got ${maxM}`);
  }
  (
    controls as unknown as { _getMaxPerspectiveDistance: () => number }
  )._getMaxPerspectiveDistance = () => maxM;
}
