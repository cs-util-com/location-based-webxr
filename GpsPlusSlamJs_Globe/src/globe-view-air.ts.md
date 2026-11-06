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
  - `mountGlobeViewAir(view, { coarsePointer, drawers?, clouds? })`
    returns `GlobeViewAir`. `clouds` is a `CloudsFactory`
    (`globeViewClouds(view)`, `globe-view-clouds.ts`): made with the
    drawers, then stepped, drawn and patched in the lab's order;
    absent, no heavy clouds. `view` is a `GlobeView` (structurally: its renderer,
    scene, camera, globe, `ecefCamera()`, `frameTarget()`); `drawers` is
    a test seam (default: the real three, made for the view's renderer
    and scene; the haze sets `scene.fog` once).
    - `afterSky()`: call from the view's `afterSky` seam. The ground sky
      over the space sky, before the Earth (nothing above the edge).
    - `step({ shareClouds? })`: once a frame after the camera is placed
      (the editor calls it from its `update` seam). The hand-over at the
      camera's height (`framed` while the view has a frame target), then
      the clouds' step (they read the observer's height and ask
      `shareClouds(flat)` for the cloud shell's share; without clouds it
      is asked at a flat share of 1, and the air sets the shell's height
      to the clouds' `cloudShellKm` (3 km) itself, since the shell is made
      at height 0, under the terrain, and only the heavy clouds set it), then the globe's sun at the eased
      exposure and the shell's thickness.
    - `afterScene()`: call from the view's `afterScene` seam. The space
      pass over the Earth and the sky, after the clouds' drawing.
    - `haze(tiles)`: the clouds' shadow patch first, then hazes every model `tiles` loads from now on; call it
      for each relief the app draws, before it loads and after the
      relief's own load hooks.
    - `setClouds(on)`: the heavy clouds' switch (nothing without them).
    - `cloudShell()`: the clouds' `shell()`, or null without the clouds.
    - `state()`: `{ weight, observerKm, groundSky, clouds }` (`clouds`:
      the clouds' `state()`, or null) (the ground sky's
      `state()`: `supported`, `lastStage`, `rebuilds`, its exposure).
    - `dispose()`: frees the clouds and the three drawers (one that throws leaves the
      others to run); idempotent; every part then does nothing.
- Invariants & assumptions:
  - The lab's settings (`globe-lab.js`'s defaults): the hand-over's edge,
    width and step from `GLOBE_SKY_HAND_OVER`, the space pass's thickness
    and strength from `GLOBE_ATMOSPHERE`, its samples by the pointer
    (`defaultAtmosphereSteps`), the haze's scale 1, the shell's ramp on,
    the space view's exposure the globe sun's intensity at the mount.
  - The ground's veil follows the depth. With the clouds, `atmoGround` 1
    and `sceneDepth` their `sceneDepth()`, so the veil's rays end at the
    drawn relief as in the lab, with one depth pass per frame, drawn even
    while the cloud volumes are switched off. Without clouds there is no
    depth, the rays would end at the ellipsoid, under the relief, and the
    veil over high ground would be far too thick; so `atmoGround` 0 and
    the space pass fades out entirely below the edge.
  - **Why the veil stays:** the haze's strength follows the observer's
    height, so at 40 km it is nearly nothing and cannot replace the veil.
    With the veil fading out, a descent turned blue to olive and lost
    almost half its brightness between 80 and 40 km (mean colour of the
    picture's lower part 44,62,84 hue 213 at 71 km; 33,36,27 hue 86 at
    43 km), then went blue again near 15 km as the haze returned. With the
    veil kept: 47,66,91 and 50,71,97, hue 213-216 from 217 km down to
    7 km (measured 2026-11-06, editor, noon, tilt 55).
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
  nothing after; nothing before the first step; the clouds stepped,
  drawn and patched in the lab's order, their switch and state; the
  flat share of 1 without clouds). The drawing itself is
  checked in a browser by the Tour Viewer's `editor3d-globe.spec.js` (the
  sky's colour at noon and at midnight) and the lab's own smokes.

- The sea: each step hands `groundSky.atmosphere`'s tables to `view.sea`
  (null while the ground sky has none, which keeps the flat glint).
