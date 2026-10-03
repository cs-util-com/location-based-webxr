# globe-perf-path.ts - the frame-hitch recorder's flight paths

- Purpose: globe zoom frame-hitch plan 2026-10-03-2017 §4.2. The
  recorder's runs compare only if every run flies the same altitudes, so
  a run's altitude is a function of its time (the time-driven zoom, for a
  real GPU) or of its frame index (the frame-stepped zoom, for
  SwiftShader) alone.
- Public API:
  - `PERF_PLACES`: the plan's four places:
    - `ocean` 0 N 160 W;
    - `alps` 46.5 N 9.0 E;
    - `pole` 82 N 40 W;
    - `city` 40.7 N 74.0 W (New York, the lab's fallback).
  - `PERF_PATH`: `fromM` 20,000 km, `toM` 30 km, `settleMs` 2 s.
  - `PERF_CHECKPOINTS_KM`: 5,000, 2,000, 1,600, 1,200, 300 and 30, where
    the frame-stepped path holds until the tiles settle.
    `PERF_E_CHECK_KM` (1,000) is the held altitude for its one E change.
  - `perfZoomAltitudeM(tMs, { decadesPerS })` -> `{ altitudeM, phase, done }`:
    - a hold at the top (`settleMs`);
    - down at `decadesPerS` in the logarithm of the altitude;
    - a hold at the bottom (half-open, so its end is the climb's start);
    - back up at the same speed;
    - `done` once the climb is over.
      RangeError for a non-finite time or a speed not above 0.
  - `perfZoomDurationMs({ decadesPerS })`: the two legs and the two holds.
    At 0.5 decades a second it is 15.3 s.
  - `perfStepPath({ stepsPerDecade })` -> `PerfStep[]`:
    - one fixed step of `1 / stepsPerDecade` in the logarithm a frame,
      from the top to the bottom and back;
    - on the way down each checkpoint is landed on exactly (the step is cut
      short) and marked `checkpoint`;
    - `leg` is `down` or `up`.
      RangeError for a step count that is not a positive integer.
- `perfWheelDeltaY(altitudeM, targetM)`: the controls-driven mode's wheel
  `deltaY` that takes the camera to the target in one frame under
  3d-tiles-renderer 0.5.3's far-zoom law (the distance scales by
  1 + 0.25 x 0.0025 x deltaY at `zoomSpeed` 1); negative zooms in. Capped
  at half the distance in and double it out. Near the ground the controls
  zoom toward the point under the pointer by the same share, so the step
  is approximate there and the next frame corrects it. RangeError for a
  value that is not finite and > 0.
- Invariants & assumptions:
  - No step exceeds `1 / stepsPerDecade` in the logarithm.
  - The path starts and ends at the top and reaches the bottom once.
  - The paths say nothing about the camera's pose: the lab applies the
    pitch law and the target.
- Tests: `globe-perf-path.test.ts`:
  - the places;
  - the zoom's holds, legs, length and end, with a property for the
    constant log speed at 0.25, 0.5 and 1 decades a second;
  - the stepped path's checkpoints, step bound, ends and determinism;
  - the wheel delta: its sign, one frame landing on the target under the
    far-zoom law (a property), its caps;
  - the refusals.
