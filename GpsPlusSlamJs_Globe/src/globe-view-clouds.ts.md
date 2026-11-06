# globe-view-clouds.ts - the heavy clouds for an app's globe view

- Purpose: the globe lab's heavy clouds (the cloud volume near the ground,
  the spherical volume from orbit down to it, and the high layer) with the
  lab's settings, made for a `GlobeView` and stepped by
  `globe-view-air.ts` in the lab's order, so an app gets the same clouds
  as the lab by passing `clouds: globeViewClouds(view)` to
  `mountGlobeViewAir`. Reached through the package's `./view` export.
- Public API:
  - `GLOBE_VIEW_CLOUDS`: the frozen knobs, the lab's defaults under its
    hash names with `cloudShellVolume 1`, `cloudHigh 1` and
    `cloudShellShadow 0.5`, plus `cloudShellKm` (the cloud shell's height,
    3 km), `cloudShadow` (the shell's soft ground shadow, 0.6) and
    `cloudShellFlat`.
  - `globeViewClouds(view, options?)`: a `CloudsFactory` for the air; it
    gets the air's ground sky and space pass and returns the clouds, or
    null where the ground sky cannot draw (its slab is the cloud volume).
    `GlobeViewCloudsOptions.shadow` (0..1, RangeError otherwise) sets both
    shadows' strength, the shell's own (`cloudShellShadow`) and the
    ground's soft one (`cloudShadow`): an app's link knob; without it the
    lab's 0.5 and 0.6. `GlobeViewCloudsOptions.extra` (a function, asked
    each frame) names what else stands on the ground (the Tour Viewer's
    city root): drawn into the depth with the relief, so the clouds' rays
    end at it; without it none (the lab passes its city the same way).
  - `createCloudsParts(view, drawers)`: the real parts (scene depth, cloud
    volume, spherical volume), or null without the ground sky.
  - `createGlobeViewClouds(view, parts, options?)` returns `GlobeViewClouds`:
    - `patch(tiles)`: the volume's shadow on every model `tiles` loads, and
      that relief's group remembered for the scene depth. Call before the
      haze's patch (the air does).
    - `step({ observerKm, shareClouds })`: the cloud shell's height, who
      draws the clouds at the camera's altitude (`globe-cloud-step.ts`),
      the shell's share from the page (`shareClouds(flat)`, the relief
      mount's), the ground's soft shadow, then both volumes' update.
    - `render({ weight })`: begins the scene depth's frame; the relief's
      depth while the ground sky shows (`weight > 0`), with the clouds
      off too, then, with them on, the slab and the shell.
    - `sceneDepth()`: the depth `render` draws, for the air's ground
      veil.
    - `setOn(on)`: the switch (off is the lab's `cloudVolume=0`: no slab,
      no shell; the flat layer only weakens near the ground). Off keeps
      the render targets allocated: the switch saves frame time, not
      memory.
    - `state()`: `{ on, flat, shellOn, shellShadow, surfaceShadow }` of
      the last step (the shell's own shadow strength this frame, and the
      surface's `uCloudShadow`).
    - `shell()`: `{ drawn, share, weight, slabWeight }` of the shell's
      `state()` (no GPU read-back: the pass's `alphaGrid` read-back
      stalled a software-drawn page): an undrawn shell told from an empty
      one.
    - `dispose()`: frees each part once (one that throws leaves the others
      to run); everything then does nothing.
- Invariants & assumptions:
  - Standard depth: the scene depth and the volumes read the depth buffer
    as standard, so a view with reversed depth must not mount them.
  - The ground's soft shadow is `cloudShadow x share x flatShadow x
mapFactor`, as the lab's: whole from orbit, gone below about 1,000 km
    where the volumes cast their own shadow on the relief (`patch`).
  - Nothing is drawn or updated after `dispose`; nothing is stepped before
    the air's first step.
- Examples:

  ```ts
  const air = mountGlobeViewAir(view, {
    coarsePointer: false,
    clouds: globeViewClouds(view),
  });
  air.step({ shareClouds: (flat) => reliefMount.shareClouds(true, flat) });
  air.setClouds(false); // the layer switch
  ```

- Tests: `globe-view-clouds.test.ts` over recording fakes of the parts:
  the knobs pinned to the lab's; each frame's height, plan, share and
  volume updates at 6,000, 500, 80, 10 and 0.1 km; the ground shadow by
  the share across 6,000 to 10 km; no shell without a frame target; the
  patch, then the draw order (depth, slab, shell) and no depth at weight
  0; an app's extra objects in the depth and the slab, asked each frame,
  none without the option; the switch off and on; dispose once; null without the ground sky.
  The drawing is checked in a browser by the Tour Viewer's
  `editor3d-globe.spec.js` (the switch) and the lab's own smokes.
