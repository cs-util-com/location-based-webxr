# globe-approach-camera.ts

- Purpose: the approach on the camera: one frame of the intro, the dive
  or the pin flight placed on the lab's camera (`createApproachDrive`).
  The field of view is the page's throughout (the intro flies by
  distance only), so nothing here touches it. Moved out of the globe
  lab's `driveCamera` as a pure refactor (editor-on-the-full-globe plan,
  the approach slice).
- Public API:
  - `createApproachDrive({ approach, placeCameraEcef, fitDistance })`
    returns `drive(now)`: `approach.pose(now)`; an orbit frame is placed
    with `applyOrbitPose` at its distance (the fitted one when null)
    through `placeCameraEcef` and reported with `approach.cameraPlaced`; a
    placed frame is placed as it is.
- Invariants & assumptions:
  - The caller updates the camera's matrix and the controls after
    `drive` (the lab's `driveCamera`: `followIntro`, the recentre).
  - The orbit pose is written in ECEF on an internal scratch camera, so
    the lab's camera only receives `placeCameraEcef`'s placement.
- Example:
  ```ts
  const drive = createApproachDrive({
    approach,
    placeCameraEcef,
    fitDistance: () => view.fitDistance(),
  });
  drive(now);
  camera.updateMatrixWorld();
  ```
- Tests: `globe-approach-camera.test.ts` (recording fakes: the drive's call
  order for an orbit, a held and a dive frame, and the placed pose).
