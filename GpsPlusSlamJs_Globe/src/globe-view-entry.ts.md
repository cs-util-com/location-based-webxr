# globe-view-entry.ts

- Purpose: the package's `./view` export - the globe's whole view for an
  app (the full-globe editor plan `2026-10-27-1850`, GV1b). Re-exports
  only.
- Public API (each block's own sidecar holds its rules):
  - The view core: `createGlobeView`, `viewPoseEcef` and the types
    `GlobeView`, `GlobeViewOptions`, `GlobeViewPose`, `GlobeViewSeams`,
    `GlobeViewSettings` (`globe-view.ts`).
  - The camera: `createGlobeCameraControls`, `GlobeCameraControls`
    (`globe-camera-controls.ts`; eye mode with `eyeItems`).
  - The defaults a page sets the view up with: `GLOBE_CLOUD_DRIFT_LAW`
    (`globe-cloud-drift.ts`), `GLOBE_CLOUD_DRIFT_DEG_PER_S`
    (`globe-surface-material.ts`), and the clock's setting type
    `GlobeClockSetting` (`globe-clock.ts`).
  - The imagery's credits: `creditsFor(globe.activeSources())`
    (`globe-credits.ts`).
  - `WGS84_ELLIPSOID`, the tile renderer's ellipsoid the view uses (an
    app without the tile renderer as its own dependency reads it here).
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
