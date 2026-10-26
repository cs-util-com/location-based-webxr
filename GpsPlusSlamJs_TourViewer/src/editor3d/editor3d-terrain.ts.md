# editor3d-terrain.ts

## Purpose

The 3D editor's ground: the globe's relief carrier on Mapterhorn's
heights, plain (no whole-Earth imagery), with the OpenStreetMap map on it
near the camera under the editor's own gate, and the credits both need.

## Public API

- `EDITOR_MESH_LEVEL` - 17 (about 6.5 m between vertices near the camera).
- `EDITOR_OSM_LIMITS` - the map's gate: `minZoom` 14, the height and
  speed limits open (only an unknown height keeps the map off).
- `EDITOR_OSM_FADE_M` - 2400 (the map faded out, and how far it is asked
  for).
- The map's keep of released regions (not exported): 32 on a phone, 64
  on a desktop (`reliefDeviceClass`), passed to `createGlobeOsmOverlay`.
- `DESKTOP_MIN_WIDTH_PX` - 768; `reliefDeviceClass(widthPx)` -> `"desktop"`
  wider than 768 px (tablets included), `"phone"` otherwise and for a
  width that is not finite and > 0.
- `createEditorTerrain({ renderer, centre, device })` -> `EditorTerrain`:
  - `terrain` - the globe's `GlobeTerrain`;
  - `worldFromEcef` - ECEF to the world (x east, y up, z south at
    `centre`, the ellipsoid's point of the centre at the origin), also
    decomposed into the tiles' group;
  - `osm` - the attached, enabled map overlay;
  - `credits` - the heights' sources, then the map's (the globe's credit
    shape: `short`, full text, `href`);
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
  23-83 requests a view, never near the 150 a minute ceiling. A fade
  below about 1300 m loses the farthest view.
- **The far map reaches 2400 m at z14** (one zoom coarser than the near
  map's z15; it faded out at 1600 m before). Measured 2026-10-26 with the
  same script and fakes as the height limit below (150 m hills, a GPU,
  the sample tour), before and after, over a sweep of camera distances
  (100, 300, 600, 900 and 1100 m at tilts 0, 30, 60 and 80 degrees, two
  passes, each view held 6 s), a minute of steady orbiting at several
  distances, and twenty pans:
  - **Coverage:** at 1100 m the map covers 0.78-1.00 of the drawn ground
    on a desktop (0.58-0.87 before), at 900 m 0.82-1.00 (0.65-0.99), and
    up to 300 m it is full either way.
  - **Requests:** 236 against 212 for the whole desktop run (+11 %), the
    worst minute 103 against 84; 400 m hills: 272, worst minute 107. A
    tablet (820 x 1180) orbiting for a minute asks for 30-41 tiles at 600
    and 900 m, about the same as before. Never at the 150 a minute
    ceiling on a desktop or a tablet.
  - **A phone (390 x 844) reaches the ceiling while orbiting, before and
    after:** a minute of steady orbiting at 600-900 m and tilts 70-75
    asks for 146-166 tiles, and the ceiling holds requests for 19-49 s
    of that minute, with 1600 m and with 2400 m alike. Most are tiles
    asked again after the phone's keep of 32 released them (274 of 394
    before, 284 of 417 after). The far map adds about 6-15 % on a phone;
    the ceiling there comes from the keep, not the reach. The speed limits are open: an orbiting
    camera jumps across the place, and the map would blank in a turn.
- **The height limit is open too** (a measurement, 2026-10-25). It was
  off above 1250 m over the ground (on again below 1125 m); the orbit's
  1100 m limit reaches that over a valley, and the whole map then went
  off. The measurement: this page driven by a script (the sample tour,
  two passes over eight views at 40 and 1100 m and tilts 0, 30, 60 and
  80 degrees, each held 6 s, then ten pans away and ten back), desktop
  Chromium with a GPU via ANGLE on a loaded machine, 1440 x 900 at pixel
  ratio 1, the map from a fake tile server answering in 300 ms, a
  synthetic relief with sine hills of 150 or 400 m over a 1.5 km wave
  answering in 150 ms. Over 400 m hills the top view at 1100 m drew no
  map at all in both passes; over 150 m hills it never switched. The
  orbit keeps the camera within 1100 m of its centre and the fade's
  1600 m reach (then) bounds what is asked for, so the line protected no
  request: 188 tiles over 150 m hills and 206 over 400 m hills with the
  line and without it, and without it the top view over 400 m hills kept
  at least 55 % of the drawn ground under the map. A camera higher over
  the ground has fewer tiles within the reach, not more. The hill height
  between 150 and 400 m where the switch-off starts was not swept; the
  verdict does not depend on it, since opening the line cost no request
  at either.
- **The map's keep is smaller on a phone** (32 regions, about 16 MiB;
  64, about 32 MiB, on a desktop). A kept region (its texture and the
  library's lock on its source bitmap, about 512 KiB) is memory outside
  the relief's budget, and a phone's relief budget is a quarter of a
  desktop's. The same script at 390 px wide over 150 m hills, keeps of
  0, 16, 32, 64 and 128: re-fetches 192, 133, 61, 8, 8; worst minute
  158, 151, 132, 104, 104 (the ceiling 150); ceiling full 11.5, 4.1, 0,
  0, 0 s. 32 removes what a creator sees (the ceiling never full, so no
  tile waits on it) at seven times the re-fetches of 64, 18 requests a
  minute under the ceiling. A wider or longer phone session that brings
  32 to the ceiling, or a phone measurement showing 32 MiB is harmless,
  would make 64 the phone's choice too. At 1440 px the relief never
  unloaded in the run, so the desktop's keep was not exercised.
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
them; the map kept on at any height over the ground (off only for an
unknown one); the map's keep by device class (32 on a phone, 64 on a
desktop); the device class at 768, 769 and NaN; the credits (Mapterhorn, its
elevation data, OpenStreetMap); the map attached at once, enabled, under
the gate and fade; the group's matrix equal to `worldFromEcefAt`; a frame
with no ground loaded asking for no map. Real drawing:
`playwright-tests/editor3d.spec.js` (the map asked for at the start
view).
