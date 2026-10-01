# globe-zoom-limit.ts - how far the globe zooms out

- Purpose: round-5 plan 2026-10-01-0945 §3.1, DEC-GL5-1 (zoom out to
  about 50,000 km from the centre, where the intro starts). The vendored
  GlobeControls (3d-tiles-renderer 0.5.3) limit zooming out with a
  private `_getMaxPerspectiveDistance()`: 2 x the larger of R / tan(fov / 2) per axis, about 27,400 km at 50 degrees on 16:9 and 48,600 km on
  9:16 portrait; a wider field of view shrinks it. There is no public
  setting, so the limit is overridden on one instance.
- Public API: `limitGlobeZoomOut(controls, maxM)`: the instance's limit
  becomes `maxM` metres from the centre (the zoom and the flight both
  read it, and the zoom's tilt and north alignment scale against it).
  RangeError for a distance that is not positive and finite. The
  prototype is not touched.
- Invariants & assumptions: the method's name and its two callers in the
  library (`_updateZoom`, `_updateFlight`) are guarded by the test, which
  reads the vendored source; a library bump that renames or stops calling
  it fails there, not silently on the page. The lab keeps its own
  invariant that the limit is at least the intro's start distance.
- Example:

  ```ts
  limitGlobeZoomOut(controls, GLOBE_INTRO.maxKm * 1000);
  ```

- Tests: `globe-zoom-limit.test.ts` (the guard; the instance's limit;
  refusals).
