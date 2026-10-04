# globe-zoom-limit.ts - how far the globe zooms out

- Purpose: round-5 plan 2026-10-01-0945 §3.1, DEC-GL5-1 (zoom out to
  about 50,000 km from the centre, where the intro starts), corrected by
  review 2026-10-01-2124 Major 1: the limit is never below the library's
  own or twice the fit. The vendored GlobeControls (3d-tiles-renderer
  0.5.3) limit zooming out with a private `_getMaxPerspectiveDistance()`:
  2 x the larger of R / tan(fov / 2) per axis, about 27,400 km at 50
  degrees on 16:9 and 59,200 km on a 390x844 portrait; a wider field of
  view shrinks it. There is no public setting, so the limit is overridden
  on one instance.
- Public API:
  - `GLOBE_ZOOM_OUT.fitFactor` 2: the limit is at least twice the fitted
    distance.
  - `libraryZoomOutM({ radiusM, fovYDeg, aspect })`: the library's own
    limit, replicated so it is taken at the lab's `fovY` rather than the
    camera's (which the fly-in varies); a test holds it equal to the
    library's method.
  - `globeZoomOutLimitM({ maxM, radiusM, fovYDeg, aspect, fitM,
fitFactor? })`: max(maxM, the library's limit, fitFactor x fitM). For
    the lab at fovY 50: 16:9 keeps 50,000 km (library 27,400, 2x fit
    32,964); 390x844 gives 67,004 km (library 59,201, fit 33,502); at fovY
    20 on 390x844, 174,423 km (fit 87,212, library 156,561).
  - `limitGlobeZoomOut(controls, limitM)`: the instance's limit becomes
    `limitM()` metres from the centre, asked on every call (the zoom and
    the flight both read it, and the zoom's tilt and north alignment scale
    against it), so a resize or a new field of view re-applies it. A value
    that is not positive and finite falls back to the library's own; a
    getter that is not a function is a TypeError. The prototype is not
    touched.
- Invariants & assumptions: the method's name and its two callers in the
  library (`_updateZoom`, `_updateFlight`) are guarded by the test, which
  reads the vendored source; a library bump that renames or stops calling
  it fails there, not silently on the page. The lab starts the fly-in at
  the same limit, so it is always reachable by zooming out.
  - A side effect: the library scales its far-out centring and north
    alignment by where the camera sits between its transition distance
    and this limit, so a larger limit weakens both at a given distance
    (at 20,000 km on 16:9 at fovY 50, about 2.7x weaker than with the
    library's 27,400 km).
- Example:

  ```ts
  limitGlobeZoomOut(controls, () =>
    globeZoomOutLimitM({ maxM: 50e6, radiusM, fovYDeg: 50, aspect, fitM }),
  );
  ```

- Tests: `globe-zoom-limit.test.ts` (the guard; the replicated library
  limit against the library's own; the limit's terms on portrait and
  landscape and at fovY 20; the getter asked on every call; the fallback
  and refusals).
