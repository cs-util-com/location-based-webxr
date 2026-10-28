# globe-view.ts

- Purpose: the globe's view core, moved out of the design system's globe lab
  (`labs/globe/globe-lab.js`) as a pure refactor for the full-globe editor
  ([plan 2026-10-27-1850](../../GpsPlusSlamJs_Docs/docs/2026-10-27-1850-editor-on-the-full-globe-plan.md)
  §3.1; the owner's rule, 2026-10-28: afterwards the globe must look and
  perform exactly as before). It owns the renderer, the scene, the camera,
  the surface (`globe-surface.ts`), the sky pass (`globe-sky.ts`: the sun's
  disc, the stars, navy space), the clock (`globe-clock.ts`) that steps the
  sun and the clouds' drift, the world frame (`globe-frame.ts`), the
  drawing buffer's fit, and the frame in the lab's order. What a page draws
  or drives around that frame comes in through seams.
- Public API:
  - `createGlobeView(options)`: `canvas`; `fovYDeg` (the camera's field of
    view at creation); `settings()` (read every frame: `fovY`, `worldFrame`,
    `sky`, `space`, `holeColor`, `cloudDrift`, `cloudDriftFarKm`,
    `cloudWindMps`, the lab's hash values of those names); `solarPosition`
    (the framework's ephemeris, `gps-plus-slam-app-framework/geo/solar-position`,
    injected for now: the Globe package does not depend on the framework
    yet); `stencil`, `reversedDepth` (the renderer's buffers); `mapLoader`,
    `band`, `fill` (the surface's); `seams`; for tests `createRenderer` and
    `monoNow`.
  - The view: `renderer`, `scene`, `camera`, `sky`, `globe`, `radius`;
    `ecefCamera()` and `placeCameraEcef(position, quaternion)` (the one way a
    pose is read and written, through the frame); `frameTarget()`,
    `setFrameTarget(target | null)`, `recentreFrame()`; `placeView(view)`;
    `earthCentreWorld()`; `fitDistance()` and `refit()`; `startClock(setting)`,
    `clock()`, `sceneMs()`, `resetCloudDrift()`, `sunNow()`; `frame()`;
    `state()` (`frameAt`, `frameRecentres`, `siderealAngleRad`,
    `cloudDriftRate`).
  - `viewPoseEcef(ellipsoid, view)`: the ECEF pose of a Debug export's view
    (`lat`, `lng`, `altitudeKm` over the ellipsoid, `headingDeg` from north
    toward east, `pitchDeg` above the local horizontal). RangeError for a
    value that is not finite.
- The frame, in order:
  1. `seams.frameStart(now)`; with `seams.paused()` true, `seams.frameEnd`
     and nothing else (the recorder's refresh calibration).
  2. The fit, only when the canvas size changed or `refit()` was asked: the
     buffer's size, the camera's aspect, and the orbit distance that fits
     the globe at `settings().fovY` (`orbitDistanceToFit`, margin 0.1).
  3. `sunNow()`: the sun at the clock's instant, the clouds' offset into
     `uCloudLonOffset`, the sidereal angle.
  4. `seams.driveCamera(now)`, then `seams.update(now)` (the lab: the
     intro, the pin, the controls; then the relief's band, the city, the
     OSM map, the clouds, the air's per-frame state).
  5. The clear (magenta with `holeColor` 1, else black); with `sky` the sky
     pass (the sun, the stars turned by `celestialToWorld`, navy space by
     the Earth's angular radius), then `seams.afterSky()` (the lab's ground
     sky).
  6. `seams.beforeScene()`, the scene, `seams.afterScene()` (the lab: the
     speed dust around the scene; the depth, the cloud volumes and the
     atmosphere after it).
  7. `seams.frameEnd(now)`.
- Invariants and assumptions:
  - The world frame is a matrix on `globe.group` (`matrixAutoUpdate` off):
    ECEF to the target's local frame, or the identity in ECEF. A frame
    move keeps the camera's ECEF pose; `seams.frameChanged(target)` follows
    each real change (none when the target is the same). With
    `settings().worldFrame` other than 1 the world stays ECEF.
  - `recentreFrame()` moves the frame under a camera flown far from it
    (`frameRecentreTarget`) and never while `seams.gestureBusy()` is true.
  - The clock must be started (`startClock`) before a frame or `sunNow`;
    otherwise an Error. The lab starts it where it did before the move, so
    its instant is unchanged.
  - The clouds' offset is summed per frame at the altitude's rate (never
    rate x time, which jumps at a change of height); `resetCloudDrift()`
    seeds the next frame at the far rate x the drift time.
  - The renderer: antialiased, Neutral tone mapping, `autoClear` off.
- Examples:

  ```ts
  const view = createGlobeView({
    canvas,
    fovYDeg: 50,
    settings: () => params,
    solarPosition,
    seams: { driveCamera: (now) => controls.update(), afterScene: () => {} },
  });
  view.startClock(params.clock);
  view.setFrameTarget({ lat: 46.948, lng: 7.4474 });
  view.renderer.setAnimationLoop(view.frame);
  ```

- Tests: `globe-view.test.ts` (Node, a fake renderer and canvas, the real
  surface with a stub map loader): the frame's order with the seams, the
  paused frame, the fit, the clear colour and the sky switch, the sun and
  the sidereal angle at the frame's instant (already set when `driveCamera`
  runs, with a fake sun that moves with the time), the drift,
  the frame move (a property over places and altitudes), the recentre and
  the gesture, `viewPoseEcef`. The browser check is the lab's smokes and the
  reference-view screenshots
  (`GpsPlusSlamJs_DesignSystem/labs/globe/globe-reference-shots.smoke.spec.mjs`).
