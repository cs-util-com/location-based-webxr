# editor3d-scene.ts

## Purpose

The desktop editor's 3D view: the renderer, the scene, the
frame loop, the lost context and the disposal. Loaded by a dynamic import
from the editor page only when the view switch asks for it, so neither
the map page's own code nor the phone's pages hold any of it. It edits by
hand through `editor3d-editing.ts` (the gizmo, the pointer, touch and
keys), and writes only through the page's `edits`.

## Public API

- `openEditor3d(deps)` -> `Promise<Editor3dView>`, resolved once the first
  frame is drawn. `deps` (`Editor3dDeps`):
  - `container` - the view's box over the map (`#view3d`), `credits` -
    the credits' line in it;
  - `store` - the page's store (`tourDocument`, `editorView`) and its
    `dispatch` (a gesture's start and end only);
  - `edits` (`Editor3dEdits`) - the page's `commit(edit)` (one undo
    step), `select(id)`, `remove(selection)`, `duplicate(selection)`,
    `say(text)` and `keysFree(event)`;
  - `levels()` - the open tour's codes; `loadContent(entry)` - a content
    entry's bytes;
  - `events.contextLost()` / `events.failed()` - once the view shows, its
    WebGL context lost, or an error in a frame that stopped its drawing.
  - Rejects with an error whose `reason` is `empty` (nothing with a
    position), `webgl` (no WebGL), `chunk` (the geoid's module did not
    arrive) or `context-lost` (lost before the first frame); an error in
    a frame before the first one rejects with that error (the switch
    says `error`).
- `Editor3dView`: `dispose()`; `stats()` (`Editor3dStats`: frames, the
  last frame's clip planes `near` and `far`, tilt, standing, the stations layer's counts, the map's stats with its `coverage` (the drawn tiles near the camera by their map, for the page's checks), and each
  station's drawn height and the drawn ground under it); `setTilt(deg)`
  (the page's checks: the orbit's tilt, its distance and heading kept);
  `setDistance(m)` (the orbit's distance within its limits, its tilt and
  heading kept).
- The shell's commands on `Editor3dView` (`editor3d-flight.ts` flies
  each):
  - `flyTo(selection)` - a station framed, an item or a code brought to a
    working distance; false for a selection the tour has no place for;
  - `frame(selection | null)` - the selection, or the whole tour (every
    station's circle and every code), fitted into the view;
  - `setTop(on)` - straight down, the left button panning like a map and
    the right one tilting; off goes back to the tilt from before, and a
    tilt by hand of more than 3 degrees leaves it;
  - `zoom(1 | -1)` - one step of 1.6 in or out; `northUp()`;
  - `readout()` - `Editor3dReadout`: `tiltDeg`, `headingDeg` (the bearing
    the camera looks toward), `top`, `drawCalls`, `frameMs` (the mean of
    the last 60 frames);
  - `setLayers(hidden)` - the station names and the codes off or on (the
    other layers have nothing drawn yet);
  - `pointOf(selection)` - where it stands in the world (the page's
    checks);
  - `centre()` - the place the view looks at, on the ground (the tree's
    "+"); `turn(selection, deg)` - one turn edit through the page (the
    bar's Align to station, the inspector's typed heading), both the
    editing's (`editor3d-editing.ts`);
  - `groundAt(place)` - the ground's ellipsoidal height at a place, null
    where none has loaded (the inspector's Put on the ground, Add pin);
  - `origin()` - the place the view's metres are measured from, fixed
    when it opened (the inspector's east and north).
- Editing on `Editor3dView`: `cancelGesture()` (a gesture under way ends
  unwritten: the page calls it before an undo or a redo);
  `screenOf(selection)`, `handleScreen(part)` and `gizmoSizes()` - CSS px
  on the canvas, for the page's checks.
- `stats()` also carries the orbit's `target`, `distanceM`, the
  `camera`'s position, whether a flight is `flying`, and `top`.
- Types `Editor3dDeps`, `Editor3dEdits`, `Editor3dStats` (the store it
  takes is structural: `getState()` with `tourDocument` and `editorView`,
  `subscribe` and `dispatch`).

## Invariants & assumptions

- **What it draws:** the ground (`editor3d-terrain.ts`, framed at the
  tour's centre, `tourCentre` of `../editor/tour-origin.ts`), the tour (`editor3d-stations.ts`) with the
  phone's pin labels, photo decoding (capped at `TOUR_MAX_IMAGE_PIXELS`)
  and model loader, the billboards and code squares
  (`editor3d-marks.ts`), the credits as links, under an orbit at the
  design's start (`editor3d-camera.ts`), with fog and a hemisphere and a
  sun light.
- **Reads the tour, writes through the page:** the tour is what a save
  would write now (`manifestToWrite`), read again only when the document
  changes (never per frame); the selection is read each frame for near-K.
  The store hears a gesture's start and end, nothing per frame; a finished
  gesture is one `edits.commit`.
- **Flights:** while one runs it places the orbit each frame in place of
  the controls (their momentum dropped first, or the orbit would drift on
  from where the flight ends: one `update()` with damping off spends the
  rest of the coast at once and zeroes it, through the controls' public
  API only); the controls' `start` (any drag, wheel or
  touch by the creator) ends it where it is.
- **Each frame:** the flight or the controls, the morph from the tilt, the clip planes
  from the camera's own ECEF point and its clearance over the ground under
  it and under its target (the camera's point is a vector of its own: the
  ground samples reuse a scratch vector, and sharing it put the clip
  planes at the target, the near plane at its 0.2 m floor everywhere), the
  ground and the map, the editing (its retries, the gizmo, a gesture's
  preview), the layer, the render.
- **Sizes:** the box is hidden while the view loads (the map stays in
  view), so the window's size stands in until it shows; a ResizeObserver
  follows the box and keeps the billboards' screen size.
- **The geoid** (`gps-plus-slam-osm/elevation/egm96`, about 170 KB) is
  imported here, so only the 3D view pays for it.
- **Nothing outlives a failure:** everything made after the renderer is
  pushed on an undo list as it is made; `dispose()` runs it last first
  (idempotent; a step that fails leaves the rest to run), and so
  does a failure before the first frame, so a failed open leaves no
  canvas, renderer, listener or credits behind.
- **The WebGL context is given back:** `renderer.dispose()` does not free
  the context, so the renderer's undo step also calls
  `forceContextLoss()`; the code face's texture is made per view
  (`createCodeFace`) and disposed with it, so nothing keeps an old
  renderer alive. Browsers keep about 16 contexts per page; before this,
  every switch to 3D kept one.
- **The frame loop never freezes silently:** an error in a frame stops
  the loop; before the first frame the open rejects with
  it, after it `events.failed()` is called.
- The station lock is read from the store's `editorView` (`isStationLocked`) on every frame's layout, so an unlock in the inspector shows the knob and the disc at once.

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
said; a later open that shows the view taking the earlier failure's
line away; a first frame that fails landing on the map, said, with no
canvas and no credits left; and twenty switches to 3D and back without
the browser's "too many active WebGL contexts" warning and with no canvas
left. `playwright-tests/editor3d-shell.spec.js` drives the shell's
commands: a card's flight ending at its station, the camera not
drifting after a flight that followed a drag, Frame, Top view, the
zoom steps, north up and the layer chips.
`playwright-tests/editor3d-edit.spec.js` edits in it: a mouse drag saved,
undone and redone; every key; a second finger cancelling a touch drag;
the gizmo's sizes on the screen at four window sizes in a wide face. `editor3d-lazy.test.ts` checks no page loads it before an
`import()` runs.

The lock in the scene: `editor3d-edit.spec.js`.
