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
      off only in the hand-over (`weight < 1`, where the fading veil still
      reads it), then, with them on, the slab and the shell.
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

## The near clouds

The near clouds are whole from 65 km down and gone at 80 km (`cloudNearCeilingKm`, `cloudNearFadeKm`): at 60 km half a share over the dark ground drew their thin parts as flat grey sheets, and the old clouds' share adds no white under them. The ceiling stays at the sky's hand-over edge, so the near air and the space pass overlap only below it.

`nearAir()` is the share the air hands to the composite: `nearShare` while the clouds are on, else 0.

The old clouds stay the old path: without the near clouds, or after a failed bake (`nearLive()` false), `cloudNear` is 0, so the shell keeps its cover and the air fades its veil with the sky. A closed view stops the worker, and a bake arriving after that is dropped.

With `near: { createWorker, autoQuality?, warn?, nowMs? }` in the options, `createGlobeCloudMarch` joins the parts and `GLOBE_VIEW_CLOUDS.cloudNear` is honoured. The bakes are asked of a worker when the clouds are made; until they arrive, or if they fail (reported once), the old clouds draw, without the shell's lifted cover. A worker that never answers leaves that state for the view's life: the old clouds, with the near clouds' veil over the ground. The tier starts at `view.quality` and `autoQuality: false` holds it. `state().near` gives the share, pixel scale and tier, null without them. The life clock is `view.driftTimeS()`. The governor is fed only on frames where they draw.
