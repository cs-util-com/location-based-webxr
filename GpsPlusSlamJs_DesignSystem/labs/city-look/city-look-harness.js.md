# city-look-harness.js

## Purpose

The one page every city look variant runs on: a real OSM scene on flat ground, three
fixed cameras, today's look next to the variant's behind a draggable divider, a heat
overlay, and the numbers a variant is judged by. Throwaway: nothing outside this lab uses it.

## Public API

`startCityLook(variant)` returns a promise of the `window.__cityLook` object.

`variant`:

- `id`: `"v0"` means today (no divider, no second side); anything else is a variant.
- `label`: the page's title and the right side's name.
- `buildingsFor(features, ctx)`: optional, may be async. Returns the variant's buildings as
  a THREE object or an array of them. Absent: today's buildings, built afresh.
- `materialFor(kind, material, ctx)`: optional. `kind` is `"ground"`, `"roads"` or `"trees"`;
  `material` is a private clone to change or replace. Return a material, or nothing to keep it.
- `postprocess`: `"none"` (the default) or `"gtao"`, on the variant's side only.
- `aoParams`: optional overrides of the GTAO parameters (`AO_PARAMS` of
  `3d/ambient-occlusion.js`). The lab's default fades it out at 700-1400 m, not 300-700 m,
  so the bird's view still has it.

`ctx`: `THREE`, `fixture` (`name`, `label`, `centre`, `bbox`), `features`, `featureByKey`
(a `Map` on `featureKey`), `frame` (`toEnu`), `ground`, `city` (the `buildCity` result with
roads, built on the library's defaults), `sun` (a unit vector towards the sun),
`seededRandom`, `buildCity`, `buildingObjects`, `geometryFrom`.

`window.__cityLook`, serialisable except `three`:

- `ready`: true after the first full frame. `error`: null, or the failure's text.
- `scene`, `camera`: the fixture's name and the view's name, strings, so a test can read
  them. The three.js objects are in `three: { scene, camera, renderer }`.
- `split`: the divider's share, or null for the full view.
- `triangles`, `draws`: what the variant's side cost in the last frame, full-screen
  passes and GTAO's extra scene passes included, and the same in split and in full view.
  Today's numbers are the V0 page's.
- `frameMs`: a smoothed time between animation frames. It is capped by the display's
  refresh, and in split view it pays for both sides: read a variant's cost at `?split=off`.

Link parameters: `?scene=lucerne|heidelberg`, `?view=landing|bird|street`, `?split=0..1|off`,
`?heat=1`.

## Invariants and assumptions

- Both sides go through a composer of their own (multisampled half-float target, then
  `OutputPass`), so tone mapping cannot differ between them. Only the variant's side gets
  GTAO. Split view renders each side whole, clipped by the scissor.
- One scene: the sky, the lights and the heat overlay are shared, and each side is a group
  switched on for its own render. Same camera, same frame.
- The light is one sun plus a hemisphere, the globe's default grade, no shadows. Roads lie
  at 0 and the ground 15 cm below them.
- The heat overlay is res 12 cells of the fixture's bbox, in OsmDemo's real ramp colours, on
  stand-in scores (`standInFraction`), labelled so on the page. It is tone-mapped with the
  scene, so it reads a little calmer than OsmDemo's own.
- A scene change reloads the page; the other controls only rewrite the link.
- The fixture URLs are literal, because the deploy's crawl copies only those.
- A failure is shown on the page and stored in `error`, never swallowed.

## Example: a minimal variant page

A folder `labs/city-look/v9-example/` holding a copy of `v0-today/index.html`, with
its title and script changed, and this script:

```js
import { startCityLook } from "../city-look-harness.js";

startCityLook({
  id: "v9",
  label: "V9 example",
  postprocess: "gtao",
  buildingsFor(features, { THREE, city, buildingObjects }) {
    const meshes = buildingObjects(city.buildings);
    for (const mesh of meshes) mesh.material.color.set(0xffd0c0);
    return meshes;
  },
  materialFor(kind, material) {
    if (kind === "ground") material.color.set(0x8a8f86);
  },
});
```

## Tests

`city-look.smoke.spec.mjs` opens every folder with an `index.html` in both scenes, so a
new variant needs no test edit. Run it with
`pnpm run test:e2e labs/city-look/city-look.smoke.spec.mjs`. The pure logic is in
`city-look-model.test.mjs`. The look itself is checked by eye, on screenshots.
