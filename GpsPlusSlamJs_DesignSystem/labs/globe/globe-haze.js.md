# globe-haze.js

## Purpose

The haze over the relief below the hand-over edge (globe F2 plan
`2026-10-03-1922-globe-f2-frame-and-atmosphere-hand-over-plan.md`, F2b):
the framework's sky-matched aerial perspective (`AtmosphereHaze`) on the
relief's tiles, its strength following the ground sky's weight
(`globe-ground-sky.js`).

## Public API

- `createGlobeHaze(scene, { visibilityKm })` sets `scene.fog` once (a
  `THREE.Fog` out of reach) and returns:
  - `patch(tiles)`: patches every mesh `tiles` loads from now on (call it
    after every other `load-model` listener that changes the material: the
    relief's own lit material and the stencil writer).
  - `sync(atmosphere)`: copies the ground sky's sun, scale and sky view in
    (`AtmosphereHaze.sync`); call after each of its reads.
  - `setWeight(weight, scale)`: the haze's density scale, `weight x scale`
    (0 above the edge); a no-op when unchanged.
  - `state()`: `{ synced, density, patched }`.
  - `dispose()`.

## Invariants & assumptions

- **One fog for the whole page.** `scene.fog` decides `USE_FOG` for every
  material in the scene; adding or removing it at the edge would recompile
  them all (frame-hitch review 2026-10-03-2017). Its near and far planes
  sit at 1e12 m, so three's stock fog (on the materials the haze does not
  patch) never starts, and the haze's own boundary fade is 0: the haze is
  the physical extinction alone.
- **0 above the edge**: the density scale is the weight times the scale,
  so the look above the edge is exactly as before.
- **The relief's tiles only.** The globe's own tiles draw below the band
  only as the stencil fill, where the relief left a pixel.
- **The haze's own rule:** it is applied last, after the relief's hooks
  and the stencil writer; its patch chains the hooks before it and extends
  the program key.
- Until the first `sync` the framework haze stays in three's stock-fog
  mode, which the out-of-reach planes make invisible.

## Examples

```js
const haze = createGlobeHaze(scene, { visibilityKm: 60 });
haze.patch(terrain.tiles); // after the stencil writer's listener
// each frame
if (stage === "read") haze.sync(groundSky.atmosphere);
haze.setWeight(weight, params.hazeScale);
```

## Tests

`globe-ground-sky.smoke.spec.mjs`: the renderer's program count is
constant across the edge (the fog never flips), and the frame's continuity
through the cross-fade with the haze on.
