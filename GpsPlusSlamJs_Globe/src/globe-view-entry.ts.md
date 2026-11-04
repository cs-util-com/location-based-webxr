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
  - The whole-Earth imagery: `createGlobeImagery` (`globe-surface.ts`),
    for a relief carrying the globe's own ground under the camera (the
    editor's, as the lab's): an overlay of its own, with the view's
    `globe.template` as the relief's template, so the ground keeps its
    look where the relief takes over from the surface.
  - The relief under the surface: `mountGlobeRelief`
    (`globe-relief-mount.ts`), the band between the globe's surface and
    the relief (its share, the release, the stencil fill, who is drawn
    and updated, the cloud shell's share), as the lab mounts it. The view
    needs `band: true`, and `stencil: true` for the fill.
  - The heavy clouds: `globeViewClouds(view)` (`globe-view-clouds.ts`),
    passed to `mountGlobeViewAir` as its `clouds`: the lab's slab, shell
    and high layer with the lab's settings, switched by the air's
    `setClouds`. The view must draw with standard depth. Their settings
    (`GLOBE_VIEW_CLOUDS`, e.g. the shell's height `cloudShellKm`) are
    exported too.
  - The approach: `createGlobeApproach` (`globe-approach.ts`), `createGlobeLandingFlight`
    (`globe-landing-flight.ts`),
    `createApproachDrive` and `createFovReturn` (`globe-approach-camera.ts`)
    and `pinEnd` (`pin-flight.ts`): the lab's own pin flight, a meteor from
    far out down to a place, and its frame loop's drive, for a page that
    lands on a place (the Tour Viewer's editor). A page sets the camera only
    through `placeCameraEcef`, never the view's whole pose each frame.
  - The start of an approach: `globeViewFitM` (`globe-view.ts`, the fit
    before the first frame), `globeZoomOutLimitM` (`globe-zoom-limit.ts`,
    the farthest the controls let the camera be) and `GLOBE_INTRO`
    (`globe-intro.ts`, its `maxKm`): the lab's zoom-out distance, where
    the Tour Viewer's editor starts its meteor.
  - The speed dust: `createSpeedDustPass` and `SPEED_DUST_LOOK`
    (`globe-speed-dust-pass.ts`), the streaks the lab draws at speed, in
    the lab's look.
  - The imagery's credits: `creditsFor(globe.activeSources())`
    (`globe-credits.ts`), and `GIBS_ACKNOWLEDGEMENT`
    (`globe-sources.ts`), the sentence GIBS asks to be shown in full
    wherever its imagery is.
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
