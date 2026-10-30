# globe-view-entry.ts

- Purpose: the package's `./view` export - the globe's whole view for an
  app (the full-globe editor plan `2026-10-27-1850`, GV1b). Re-exports
  only.
- Public API (each block's own sidecar holds its rules):
  - The view core: `createGlobeView` and the types `GlobeView`,
    `GlobeViewPose`, `GlobeViewSettings` (`globe-view.ts`).
  - The camera: `createGlobeCameraControls`, `GlobeCameraControls`
    (`globe-camera-controls.ts`; eye mode with `eyeItems`).
  - The defaults a page sets the view up with: `GLOBE_CLOUD_DRIFT_LAW`
    (`globe-cloud-drift.ts`), `GLOBE_CLOUD_DRIFT_DEG_PER_S`
    (`globe-surface-material.ts`).
  - The air: `mountGlobeViewAir`, `GlobeViewAir` (`globe-view-air.ts`):
    the lab's ground sky, haze and space pass made for the view, so the
    sky is blue in daylight below the hand-over edge. Without it the view
    core draws only the sun's disc, the stars and navy space, black at
    noon. An app calls its `afterSky` and `afterScene` from the view's
    seams of those names and its `step` once a frame after the camera.
  - The imagery's credits: `creditsFor(globe.activeSources())`
    (`globe-credits.ts`).
  - Only what an app's production code uses: a name only a test needs
    lives under `./test-utils/*` (`viewPoseEcef` and `WGS84_ELLIPSOID` in
    `./test-utils/view-pose`), because knip reads this entry as public and
    cannot see an export nobody consumes.
- Invariants & assumptions:
  - Separate from `./editor` on purpose: this entry pulls in the surface
    with its whole-Earth imagery (`/globe-assets/...`) and the sky pass.
    An app imports it only behind a dynamic `import()` (the Tour Viewer's
    editor-only guards check that no visitor page reaches it).
  - The view needs the framework's `solarPosition`, injected by the app.
- Examples:
  ```ts
  const { createGlobeView } = await import("gps-plus-slam-globe/view");
  ```
- Tests: none of its own (re-exports); the blocks' own tests, and the Tour
  Viewer's `editor-only-packages.test.ts` and `editor3d-lazy.test.ts` for
  how an app may reach it.
