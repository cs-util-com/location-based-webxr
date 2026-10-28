# globe-relief-planes.ts - the relief's part of the clip planes

- Purpose: the clearance and peak the camera's clip planes take from the
  drawn relief (F2 plan F2a, M4), moved out of the globe lab.
- Public API:
  - `RELIEF_PEAK_M` (8,850): the highest real peak.
  - `createReliefPlanes({ ellipsoid, group, camera, radiusM, sampleGround,
heightScale, active })` returns a callable `planes()` and
    `planes.state()`.
    - `planes()`: `{}` while `active()` is false (the ellipsoid's planes);
      otherwise the ground under the camera and on a ring of eight bearings
      as far out as the camera stands above that ground (at least 10 m),
      the nearest of them by `reliefClearanceM` as `clearanceM` (left out
      when no ground is loaded), and `peakM = RELIEF_PEAK_M * heightScale()`.
    - `state()`: `{ clearanceM, samples }` of the last active call (both
      null before), `samples` = `{ altitude, below, ringM, ring }`.
  - RangeError for a radius that is not positive and finite.
- Invariants: the ring's longitude step is widened by the latitude's cosine,
  floored at 0.01 near the poles. Nothing is sampled while inactive.
- Example: `createGlobeCameraControls(scene, camera, canvas, globe, { onTake, reliefPlanes: planes })`.
- Tests: `globe-relief-planes.test.ts` (inactive, the sample places and the
  ring distance, the 10 m floor, no ground, a bad radius).
