# globe-approach-camera.ts

- Purpose: the approach on the camera: one frame of the intro, the dive
  or the pin flight placed on the lab's camera (`createApproachDrive`),
  and the field of view easing back to `fovY` when the fly-in is
  interrupted while a variant has it wider or narrower
  (`createFovReturn`; round-5 plan 2026-10-01-0945 §3.1: no snap, no
  interim value left behind). Moved out of the globe lab's `driveCamera`
  as a pure refactor (editor-on-the-full-globe plan, the approach slice).
- Public API:
  - `FOV_RETURN_MS` (500): the ease's duration.
  - `fovAt(ease, elapsedMs)`: `from` to `to` by `smoothstep`; `to` from
    `ms` on (at once for `ms` 0).
  - `createFovReturn(camera, targetFov, ms?)`:
    - `step(now)`: nothing at `targetFov()` (any ease dropped); else
      starts an ease from the camera's fov (kept as the last one),
      follows a changed `targetFov()`, sets the camera's fov and
      projection, and drops the ease once it arrived;
    - `clear()`: drops the running ease (an orbit frame set the fov);
    - `at(fraction)`: the last ease `{ from, to, ms, at, lastFrameAt,
fov }`, `fov` its value `fraction` x `ms` in; null before any;
      `RangeError` for a fraction that is not finite (the lab's
      `fovReturnAt` test hook).
  - `createApproachDrive({ approach, camera, fovReturn, placeCameraEcef,
fitDistance })` returns `drive(now)`: `approach.pose(now)`; an orbit
    frame is placed with `applyOrbitPose` at its distance (the fitted one
    when null) through `placeCameraEcef`, reported with
    `approach.cameraPlaced`, sets its fov (only when it differs) and
    clears the ease; a placed frame is placed as it is and steps the ease.
- Invariants & assumptions:
  - The caller updates the camera's matrix and the controls after
    `drive` (the lab's `driveCamera`: `followIntro`, the recentre).
  - The orbit pose is written in ECEF on an internal scratch camera, so
    the lab's camera only receives `placeCameraEcef`'s placement.
- Example:
  ```ts
  const fovReturn = createFovReturn(camera, () => params.fovY);
  const drive = createApproachDrive({
    approach,
    camera,
    fovReturn,
    placeCameraEcef,
    fitDistance: () => view.fitDistance(),
  });
  drive(now);
  camera.updateMatrixWorld();
  ```
- Tests: `globe-approach-camera.test.ts` (recording fakes: the ease's
  values and its end, a live `fovY`, the hook's record and its refusal;
  the drive's call order for an orbit, a held and a dive frame, and the
  placed pose).
