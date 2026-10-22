# editor3d-scene.ts

## Purpose

The desktop editor's 3D view, read-only: the renderer, the scene, the
frame loop, the lost context and the disposal. Loaded by a dynamic import
from the editor page only when the view switch asks for it, so neither
the map page's own code nor the phone's pages hold any of it.

## Public API

- `openEditor3d(deps)` -> `Promise<Editor3dView>`, resolved once the first
  frame is drawn. `deps` (`Editor3dDeps`):
  - `container` - the view's box over the map (`#view3d`), `credits` -
    the credits' line in it;
  - `store` - the page's store (`tourDocument`, `editorView`);
  - `levels()` - the open tour's codes; `loadContent(entry)` - a content
    entry's bytes;
  - `events.contextLost()` - called when WebGL loses the context later.
  - Rejects with an error whose `reason` is `empty` (nothing with a
    position) or `webgl` (no WebGL); any other rejection (the geoid's
    chunk) the view switch reads as `chunk`.
- `Editor3dView`: `dispose()`; `stats()` (`Editor3dStats`: frames, the
  last frame's clip planes `near` and `far`, tilt, standing, the stations layer's counts, the map's stats, and each
  station's drawn height and the drawn ground under it); `setTilt(deg)`
  (the page's checks: the orbit's tilt, its distance and heading kept);
  `setDistance(m)` (the orbit's distance within its limits, its tilt and
  heading kept).
- Types `Editor3dDeps`, `Editor3dStats` (the store it takes is structural:
  `getState()` with `tourDocument` and `editorView`, and `subscribe`).

## Invariants & assumptions

- **What it draws:** the ground (`editor3d-terrain.ts`, framed at the
  tour's centre, `tourCentre`), the tour (`editor3d-stations.ts`) with the
  phone's pin labels, photo decoding (capped at `TOUR_MAX_IMAGE_PIXELS`)
  and model loader, the billboards and code squares
  (`editor3d-marks.ts`), the credits as links, under an orbit at the
  design's start (`editor3d-camera.ts`), with fog and a hemisphere and a
  sun light.
- **Reads, never writes:** the tour is what a save would write now
  (`manifestToWrite`), read again only when the document changes (never
  per frame); the selection is read each frame for near-K.
- **Each frame:** the controls, the morph from the tilt, the clip planes
  from the camera's own ECEF point and its clearance over the ground under
  it and under its target (the camera's point is a vector of its own: the
  ground samples reuse a scratch vector, and sharing it put the clip
  planes at the target, the near plane at its 0.2 m floor everywhere), the
  ground and the map, the layer, the render.
- **Sizes:** the box is hidden while the view loads (the map stays in
  view), so the window's size stands in until it shows; a ResizeObserver
  follows the box and keeps the billboards' screen size.
- **The geoid** (`gps-plus-slam-osm/elevation/egm96`, about 170 KB) is
  imported here, so only the 3D view pays for it.
- `dispose()` is idempotent and frees the loop, the listeners, the layer,
  the ground, the controls, the renderer, the canvas and the credits.

## Examples

```ts
const { openEditor3d } = await import("../editor3d/editor3d-scene.js");
const view = await openEditor3d({
  container: view3dBox,
  credits: creditsLine,
  store,
  levels: () => openedLevels,
  loadContent,
  events,
});
// later
view.dispose();
```

## Tests

No unit test (WebGL is needed; its parts are unit-tested in their own
files). `playwright-tests/editor3d.spec.js` opens it on the sample tour
with the relief's and the map's hosts answered (a flat ground at the
sample square's height): the loading state, the view with its credits,
every station placed and near and within 2 m of the drawn ground, the
near plane about 0.3 of the camera's height at the start, larger at the
orbit's far end and under 2 m beside a station, the map asked for
at the start view, the morph at 8 and 42 degrees, the map again with the
selection and the save status kept, and nothing asking for the globe's
imagery; and a 3D view whose code cannot load landing back on the map,
said. `editor3d-lazy.test.ts` checks no page loads it before an
`import()` runs.
