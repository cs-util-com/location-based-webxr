# editor3d-terrain.ts

## Purpose

The 3D editor's ground: the globe's relief carrier on Mapterhorn's
heights, plain (no whole-Earth imagery), with the OpenStreetMap map on it
near the camera under the editor's own gate, and the credits both need.

## Public API

- `EDITOR_MESH_LEVEL` - 17 (about 6.5 m between vertices near the camera).
- `EDITOR_OSM_LIMITS` - the map's gate: `minZoom` 15, off above 1250 m
  over the ground, on again below 1125 m, the speed limits open.
- `EDITOR_OSM_FADE_M` - 1600 (the map faded out, and how far it is asked
  for).
- `DESKTOP_MIN_WIDTH_PX` - 768; `reliefDeviceClass(widthPx)` -> `"desktop"`
  wider than 768 px (tablets included), `"phone"` otherwise and for a
  width that is not finite and > 0.
- `EditorCredit` - the globe's credit shape (`short`, full text, `href`).
- `createEditorTerrain({ renderer, centre, device })` -> `EditorTerrain`:
  - `terrain` - the globe's `GlobeTerrain`;
  - `worldFromEcef` - ECEF to the world (x east, y up, z south at
    `centre`, the ellipsoid's point of the centre at the origin), also
    decomposed into the tiles' group;
  - `osm` - the attached, enabled map overlay;
  - `credits` - the heights' sources, then the map's;
  - `groundAt(latRad, lonRad)` - the drawn ground (m over the ellipsoid),
    null where none is loaded;
  - `update(camera, renderer, nowMs)` - per frame: the map's gate from the
    camera's height over the drawn ground (NaN when none is loaded), then
    the tiles;
  - `dispose()` - the tiles and their plugins, the map's included.

## Invariants & assumptions

- **No whole-Earth imagery reaches this app:** the relief's imagery is
  `plainImagery()`, and `editor3d-lazy.test.ts` checks the build holds no
  imagery factory and no `globe-assets` folder.
- **The gate was measured** on the sample tour's square (start view, top
  view, farthest zoom): with the flight's limits (off above 200 m, a 300 m
  fade) none of those views drew any map; with these, every one did, at
  23-83 requests a view, never near the 150 a minute ceiling. A mesh
  coarser than level 17 would need `minZoom` 14; a fade below about
  1300 m loses the farthest view. The speed limits are open: an orbiting
  camera jumps across the place, and the map would blank in a turn.
- **The map is attached before any tile loads:** attached to a relief
  already loaded it asked the library for levels it could not give yet.
- **The template is a plain standard material** (a light ground colour,
  roughness 1). The globe's lit copy declares the detail's geodetic
  normal itself under such a template (`globe-terrain.ts`), which is what
  lets a plain template compile.

## Examples

```ts
const ground = createEditorTerrain({
  renderer,
  centre: { lat: 48.137, lng: 11.575 },
  device: reliefDeviceClass(window.innerWidth),
});
scene.add(ground.terrain.tiles.group);
renderer.setAnimationLoop((now) => {
  ground.update(camera, renderer, now);
  renderer.render(scene, camera);
});
```

## Tests

`editor3d-terrain.test.ts`: the gate's values and the overlay accepting
them; the device class at 768, 769 and NaN; the credits (Mapterhorn, its
elevation data, OpenStreetMap); the map attached at once, enabled, under
the gate and fade; the group's matrix equal to `worldFromEcefAt`; a frame
with no ground loaded asking for no map. Real drawing:
`playwright-tests/editor3d.spec.js` (the map asked for at the start
view).
