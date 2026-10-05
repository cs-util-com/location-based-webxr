# globe-ground-sky.js

## Purpose

The ground sky in the globe lab (globe F2 plan
`2026-10-03-1922-globe-f2-frame-and-atmosphere-hand-over-plan.md`, F2b,
M1): the framework's physical sky (`SkyAtmosphere`) seen from the camera's
height, taking over the sky's pixels below the hand-over edge, faded in by
the cross-fade's weight, with the exposure eased from the space view's to
the ground sky's.

## Public API

- `createGlobeGroundSky(renderer)` returns (the sky in the framework's units,
  a sun intensity of 1, so its scene scale is its exposure):
  - `supported`: false where the framework sky cannot run (no float
    targets); the lab then keeps the space sky all the way down.
  - `atmosphere`: the `SkyAtmosphere` (null where unsupported).
  - `update({ altitudeKm, sunWorld, framed, edgeKm, widthKm, stepPct,
spaceExposure })`
    → `{ weight, exposure }`, once a frame before drawing. `altitudeKm` is
    the observer's height over the ellipsoid's image
    (`observerAltitudeKm` in `globe-atmosphere-frame.js`), `sunWorld` the
    sun's unit direction in the world, `framed` whether the world is the
    target's local frame (F2a). `weight` is the ground sky's share of the
    sky, `exposure` the sun's eased scale in the scene, which IS the
    globe's sun intensity (`spaceExposure`, the lab's sun intensity, above
    the edge).
  - `render(camera)`: draws the ground sky into its own target and
    composites it over the frame with the weight; nothing at weight 0.
    After the space sky, before the Earth.
  - `state()`: `{ supported, weight, exposure, automaticExposure,
observerKm, rebuildPending, lastStage, rebuilds }`, `rebuilds` counting each stage done.
  - `dispose()`.

## Invariants & assumptions

- **Its own scene** (DEC-GL5-16): the sky's environment map is baked into
  that scene only and never reaches the globe's tiles.
- **Staged rebuilds**: `rebuild: 'staged'`, one stage a frame
  (`stepRebuild`); the observer in log steps of `stepPct` and the sun in
  0.25 degree steps (`globe-sky-hand-over.ts`), so a descent costs about
  one rebuild per step and no frame carries a whole one.
- **It works a width above the edge** (`altitudeKm < edgeKm + widthKm`), so
  its tables are built before its weight leaves 0.
- **The composite** does the tone mapping and the output colour space
  (three applies neither when drawing into a target): the result is the
  sky drawn straight to the canvas, faded. The space sky's stars and sun
  disc fade under it while its own disc fades in, so the two discs are
  never both at full.
- **One eased exposure** (DEC-GL5-16): `easedExposure(spaceExposure,
automatic, weight)`, in ONE unit, the sun's scale in the scene: the
  ground sky (sun intensity 1) gets it through its exposure compensation,
  and it is the globe's sun intensity. The framework's automatic exposure
  is calibrated as pi at its reference light for a sun intensity of 1, so
  the ends are comparable: 5 in space, about 4.2 at 60 km over the Alps at
  noon. The first build multiplied the globe's 5 by the automatic 4.2 as
  well, counting the scale twice (2 EV brighter, 2026-10-05). The space
  view's value above the edge, so the space view
  is unchanged there.
- **Only in the local frame**: before a target the world is ECEF, "up"
  means nothing to a flat sky, and the weight is 0.

## Examples

```js
const groundSky = createGlobeGroundSky(renderer);
// each frame
const { weight, exposure } = groundSky.update({
  altitudeKm,
  sunWorld,
  framed: worldFrame.target !== null,
  edgeKm: 80,
  widthKm: 20,
  stepPct: 5,
  spaceExposure: 5,
});
globe.sun.intensity = exposure;
sky.render(renderer, camera);
groundSky.render(camera);
renderer.render(scene, camera);
```

## Tests

The arithmetic is unit-tested in `GpsPlusSlamJs_Globe/src/globe-sky-hand-over.test.ts`
and the staged rebuild in the framework's `sky-atmosphere.test.ts`. This
file's drawing is exercised by `globe-ground-sky.smoke.spec.mjs` in the
lab (the hand-over's continuity, the exposure's steps, the rebuild count).
