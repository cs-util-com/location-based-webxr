# globe-view-air.ts - the air for an app's globe view

- Purpose: the lab's three air drawers (the space pass over the Earth,
  `globe-atmosphere.ts`; the framework's ground sky, `globe-ground-sky.ts`;
  the haze over the relief, `globe-haze.ts`) made for a `GlobeView` and
  wired through `globe-air.ts`, so an app gets the blue sky below the
  hand-over edge with one call (the full-globe editor plan
  `2026-10-27-1850`). The view core (`globe-view.ts`) draws only the sun's
  disc, the stars and navy space: without the air the sky is black at
  noon. Reached through the package's `./view` export.
- Public API:
  - `mountGlobeViewAir(view, { coarsePointer, drawers? })` returns
    `GlobeViewAir`. `view` is a `GlobeView` (structurally: its renderer,
    scene, camera, globe, `ecefCamera()`, `frameTarget()`); `drawers` is
    a test seam (default: the real three, made for the view's renderer
    and scene; the haze sets `scene.fog` once).
    - `afterSky()`: call from the view's `afterSky` seam. The ground sky
      over the space sky, before the Earth (nothing above the edge).
    - `step()`: once a frame after the camera is placed (the editor calls
      it from its `update` seam). The hand-over at the camera's height
      (`framed` while the view has a frame target), then at once the
      globe's sun at the eased exposure and the shell's thickness (there
      are no cloud volumes to update between).
    - `afterScene()`: call from the view's `afterScene` seam. The space
      pass over the Earth and the sky.
    - `haze(tiles)`: hazes every model `tiles` loads from now on; call it
      for each relief the app draws, before it loads and after the
      relief's own load hooks.
    - `state()`: `{ weight, observerKm, groundSky }` (the ground sky's
      `state()`: `supported`, `lastStage`, `rebuilds`, its exposure).
    - `dispose()`: frees the three drawers (one that throws leaves the
      others to run); idempotent; every part then does nothing.
- Invariants & assumptions:
  - The lab's settings (`globe-lab.js`'s defaults): the hand-over's edge,
    width and step from `GLOBE_SKY_HAND_OVER`, the space pass's thickness
    and strength from `GLOBE_ATMOSPHERE`, its samples by the pointer
    (`defaultAtmosphereSteps`), the haze's scale 1, the shell's ramp on,
    the space view's exposure the globe sun's intensity at the mount.
  - One deliberate difference: `atmoGround` 0. The lab ends the space
    pass's ground veil at the drawn relief through its scene-depth pass;
    without one its rays end at the ellipsoid, under the relief, and the
    veil over high ground would be far too thick. So below the edge the
    space pass fades out entirely (sky and ground shares both
    `1 - weight`) and the haze carries the ground; the lab's comparison
    note says the ground then darkens over the 80 to 40 km cross-fade.
  - Nothing is drawn before the first `step` (there is no hand-over yet;
    `globe-air.ts` refuses `finish` before it) and nothing after
    `dispose`.
  - The globe's sun intensity is written every `step` (the eased
    exposure): an app must not set it itself while the air is mounted.
- Examples:

  ```ts
  let air: GlobeViewAir | null = null;
  const view = createGlobeView({
    // ...
    seams: {
      update: () => air?.step(),
      afterSky: () => air?.afterSky(),
      afterScene: () => air?.afterScene(),
    },
  });
  air = mountGlobeViewAir(view, { coarsePointer: false });
  air.haze(relief.tiles);
  ```

- Tests: `globe-view-air.test.ts` over recording fakes (the ground sky
  drawn with the view's camera; the hand-over's edges, the framed flag and
  the eased sun; the space pass's shares at full and no weight, no scene
  depth; the look by pointer; the haze's tiles and sync; dispose once and
  nothing after; nothing before the first step). The drawing itself is
  checked in a browser by the Tour Viewer's `editor3d-globe.spec.js` (the
  sky's colour at noon and at midnight) and the lab's own smokes.
