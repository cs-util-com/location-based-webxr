# editor3d-globe.ts

## Purpose

The desktop editor's 3D view on the whole globe (full-globe editor plan
2026-10-27-1850, GV1b), opened instead of the OrbitControls view
(`editor3d-scene.ts`) when the page's link carries `globe=1`
(`../editor/globe-switch.ts`, read in `../editor/edit-main.ts`). Without the
switch nothing here loads.

It mounts the globe package's view core (`createGlobeView` from
`gps-plus-slam-globe/view`: sky, sun, surface, a world frame that follows
the camera) with the editor's own relief and map (`editor3d-terrain.ts`,
placed in ECEF) under the camera, the tour drawn in the globe's
Earth-centred group (`globe-layer.ts`), and the globe's camera controls in
eye mode. It opens at street level, `GLOBE_EDITOR_LOOK.backM` south of the
tour's centre at eye height, looking at it.

## Public API

- `openGlobeEditor(deps, knobs): Promise<Editor3dView>`
  - `deps`: the same `Editor3dDeps` the OrbitControls view takes.
  - `knobs`: `hidePx` and `crowdPx` from the link switch (the visibility
    rule's thresholds).
  - Resolves on the render loop's first tick with the same `Editor3dView`
    shape, so the shell, the view switch and the page's test hooks work
    unchanged.
  - Rejects with a `viewFailure` (`editor3d-view-parts.ts`): `empty` for a
    tour with nothing positioned, `chunk` when the geoid does not load,
    `context-lost` before the first frame, or the first frame's own error.
    Everything made so far is undone first.

## How the tour hangs on the globe

The stations layer (`editor3d-stations.ts`) keeps its tour frame (x east,
y up, z south at the tour's centre). One group, `tour-frame`, under the
Earth-centred group carries the inverse of `worldFromEcefAt(centre)` as its
matrix, so the layer's coordinates land on the globe and a recentre of the
world frame moves nothing relative to the ground.

## Per frame (`updateLayers`, the view's `update` seam)

- The ground's carrier by altitude (`reliefCarries`, hysteresis band): the
  relief under the ceiling (with the globe's clouds step only), the globe's
  surface above it. The two are never both shown.
- The camera in the tour's frame, and the morph from pins to standing marks
  from the tilt (`morphStanding`).
- The visibility rule (`globeHidden`): each station and code by its own
  size on screen, then crowded stations; the selected station never hides.
  The result goes to `layer.setHidden`, which also keeps hidden objects
  from being picked.
- The near plane's keep-clear spheres: the shown stations' found radii.
- The staged uploads (`upload-queue.ts`): a station of the tour not yet
  admitted is queued and held back from drawing (added to what
  `setHidden` gets, never to the rule's own result, whose hysteresis reads
  it back). After `layer.update` (where a station's billboard is made) the
  queue runs at most `UPLOADS.perFrame` (4) stations: each object of
  `layer.stationObjects(id)` is shown for the call, `renderer.compile`d and
  its material maps `renderer.initTexture`d, then the station is admitted
  and drawn from the next frame. A station gone from the tour is
  forgotten.
  - Shared textures: the code squares share one face (`createCodeFace`);
    the billboards are one canvas each (their number and name differ), so
    they are staged rather than shared.
  - Not staged: what a near station renders later, asynchronously (its
    photos, models and reading stands, which upload when they arrive), a
    billboard made again on a selection change, and a station whose
    drawing an edit makes anew (its new root uploads in place: holding it
    back would make it blink under the user's hand). `compile` is the
    synchronous one: `compileAsync` would need a frame budget of its own.
  - The scheduler's sweep (40 jobs of 3 ms each): N = 1 costs 3 ms a frame
    over 40 frames, N = 4 12 ms over 10, N = 16 48 ms over 3; 4 keeps one
    frame under the 16.7 ms of 60 Hz at that cost. The 3 ms is declared,
    not measured on the phone.

## The verbs

- The clock: daylight by default, `view.startClock` held (`scale` null with
  a `startMs`) at `daylightStartMs(Date.now(), centre.lng)`; `setRealTime(true)`
  restarts it at the real time now, `false` back in daylight. `stats().globe.clock`
  carries `realTime`, `sceneMs` and the sun's height over the tour
  (`sunElevationDeg`).
- `flyTo` and `frame` place an aimed view (`aimView`) at once; there is no
  flight yet.
- `setTop`, `northUp`, `setTilt` re-place the current pose with one field
  changed.
- `zoom` and `setDistance` move the camera along its line of sight.
- `centre()` is the place UNDER the camera (on the drawn ground where it
  is loaded), not a look-at target: eye mode has none.
- Editing is the OrbitControls view's (`createSceneEditing`): `turn`,
  `cancelGesture`, `handleScreen`, `gizmoSizes`, `modelParts` and
  `modelScreenOf` are the editing's. Its camera leases the globe's
  controls off for a handle drag (`GlobeCameraControls.lease`), and the
  view's `gestureBusy` is true while the controls or an edit's gesture
  run, so the world frame recentres only between gestures. The ECEF
  matrices it reads are refreshed each frame (`followFrame`).
- The routing table's extras: an arrow with nothing selected steps the
  camera (`steppedView`, the height over the loaded ground); a double
  click on the ground moves the camera `ZOOM_SHARE` of the way toward the
  ground under the pointer, along its ray (what is under the pointer stays
  there).
- Two fingers lock the camera (the shared input's rule) and move nothing:
  the globe's own two-finger gestures are not wired.

## Invariants & assumptions

- The page's box is hidden until the open resolves; the view's fit needs a
  laid-out canvas (a zero-size canvas would make its aspect NaN and throw).
  So the loop skips drawing while the canvas has no size and resolves the
  open on that first tick.
- A frame that throws after the open stops the loop and tells the page
  (`events.failed`); a lost context after the open tells it too.
- `dispose` frees in reverse order and forces the WebGL context loss.
- Credits are filled once at open (the globe's active sources and the
  relief's); they do not follow a later change of sources yet.
- The heavy clouds (the shell and its volume) are never mounted.
- The globe's assets are served at `/globe-assets/` by the dev server only
  (`../dev-server/globe-assets-route.ts`); the built site lacks them.

## Stats

`stats()` carries the OrbitControls view's fields plus `globe`: the carrier,
the camera's altitude, the frame target, the hidden stations and codes, the
frame recentres, the surface's state and `uploads` (`pending`, `ran`,
`worstFrameMs`, `admitted`).

## Tests

- `globe-editor-look.test.ts` (the pure rules), `editor3d-stations.test.ts`
  ("hides single stations and codes, and nothing hidden is picked"),
  `editor3d-terrain.test.ts` (the ECEF placement).
- `../editor3d-lazy.test.ts`: the globe view is reached only by import()
  from the editor's page, and only its chunks hold the globe's imagery.
- `playwright-tests/editor3d-globe.spec.js`: opens `/edit.html?globe=1` and
  finds the globe and a station through the page's test hooks.
