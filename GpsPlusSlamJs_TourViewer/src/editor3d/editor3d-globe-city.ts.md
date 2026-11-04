# editor3d-globe-city.ts

## Purpose

The globe editor's OSM buildings (with their trees and roads): the Globe
package's city (`createGlobeCity`) mounted at the tour's centre and driven
each frame by its step (`createGlobeCityStep`), plus the editor's own
parts: a show/hide toggle, a see-through around the selection, the clouds'
depth objects and the page's stats.

## Public API

- `EDITOR_CITY` - `topM` 30 000 (the city loads and fades in below it,
  the globe lab's value), `law` `{ near: 1 }` (the editor's relief is at
  true heights everywhere), `seeThroughM` 30 (added to the selection's
  radius).
- `mountEditorCity({ city, place, zoom, step? })` -> `EditorCity`:
  - `city` - the Globe package's city (`root`, `load`, `setFade`,
    `state`, `dispose`);
  - `place` - the tour's centre (degrees); `zoom` - the relief's height
    zoom (12 for Mapterhorn), so the city reads the relief's own heights;
  - `step` - the city's step (default `createGlobeCityStep(city)`).
- `EditorCity`:
  - `step({ altitudeM, selection })` - each frame: the load (once below
    `topM`), the fade by altitude, the see-through (`selection`: world
    `at`, world `up`, `radiusM`; null turns it off). A non-finite altitude
    skips the frame.
  - `warmUp()` - a fresh load at the place, at the approach's start.
  - `setShown(on)` - hidden: no load, fade 0, see-through off, no
    `extra()`; shown again it carries on.
  - `extra()` - `[root]` while shown and drawn (the clouds' depth).
  - `stats(reliefGroundM)` -> `EditorCityStats`: `shown`, `worker` (the
    phase, or "unavailable" once held off), `message`, `gate`, `tiles`,
    `buildings` (the city's volumes), `features`, `missingTiles`,
    `objects`, `geometryBytes` (every attribute and index under the root),
    `fade`, `drawn`, `visible`, `groundM` (the city's ground at the place),
    `reliefGroundM`, `parityM` (their difference, null when either is
    unknown), `load` (`outcome`, `ended`, `progress`, `overpass`) and
    `seeThrough` (`on`, `radiusM`, `materials` patched).
  - `dispose()` - see-through off, then the city disposed.
- `patchSeeThrough(shader, uniforms)` -> boolean: adds the see-through to
  a standard material's shaders (the world position, with the instance's
  matrix when instanced; a screen door discarding 3 of 4 pixels inside the
  cylinder about `uSeeUp` through `uSeeCentre` of radius `uSeeRadius`).
  False, with the shader unchanged, when an anchor chunk is missing.

## Invariants & assumptions

- A frame never stops on the city: a throw from its load or step holds
  it off (`broken`, fade 0) and the stats say why.
- Each material is patched once per mount; its `onBeforeCompile` is
  wrapped once ever (`userData.editorSeeThroughWrapped`) and reads the
  current mount's uniforms from `userData.editorSeeThrough`, because the
  library shares its tree materials across cities (a second view's mount
  must neither declare the see-through twice nor drive the first view's
  uniforms).
- Roads (`userData.cityLayer === "roads"`) lie flat and are not patched.
- The city is drawn only where the relief is at true heights, which the
  editor's relief is everywhere (`law: { near: 1 }`).

## Examples

```ts
const city = mountEditorCity({
  city: createGlobeCity({ parent: globe.group, ellipsoid, heightsUrl, ... }),
  place: { lat, lng },
  zoom: 12,
});
city.warmUp();
// each frame
city.step({ altitudeM, selection: { at, up, radiusM } });
```

## Tests

`editor3d-globe-city.test.ts`: no load from orbit and a load at the
relief's zoom below the top; the warm-up's fresh load; the toggle; a
throwing city held off; a frame without an altitude skipped; the counts,
geometry bytes and parity; the see-through on buildings and trees, not
roads; a shared material patched once across views; dispose; a property
that the fade is in 0..1 and 0 at or above the top; `patchSeeThrough` on
three.js's standard shader and on a shader without its anchors. The
wiring and the e2e: `editor3d-globe.test.ts`,
`../../playwright-tests/editor3d-globe-buildings.spec.js`.
