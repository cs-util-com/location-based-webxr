# editor3d-globe.ts

## Purpose

The desktop editor's 3D view on the whole globe (full-globe editor plan
2026-10-27-1850, GV1b): the default 3D view. Only the temporary way back,
`globe=0` in the page's link (`../editor/globe-switch.ts`, read in
`../editor/edit-main.ts`), opens the OrbitControls view
(`editor3d-scene.ts`) instead, and then nothing here loads.

It mounts the globe package's view core (`createGlobeView` from
`gps-plus-slam-globe/view`: sky, sun, surface, a world frame that follows
the camera) with the editor's own relief and map (`editor3d-terrain.ts`,
placed in ECEF) under the camera, the tour drawn in the globe's
Earth-centred group (`globe-layer.ts`), and the globe's camera controls in
eye mode. It opens at street level, `GLOBE_EDITOR_LOOK.backM` south of the
tour's centre at eye height, looking at it.

A tour with nothing positioned yet (a new one, or notes alone) opens too:
over the creator's part of the world (`empty-tour-view.ts`: the latitude of
the time zone's region, by its name, and the longitude of its standard
offset), the whole Earth in view from
the approach's start height (`meteorStartAltitudeM`: the link's
`startKm`, else the globe lab's intro distance at the page's aspect), with
no approach to fly (its
`ended("landed")` is called at once, so the shell does not hold the tree
folded). The first station is placed by right-clicking the ground. The
tour frame stays at that default centre; the stations are drawn by their
true ECEF place, so one placed anywhere shows where it is.

## Public API

- `openGlobeEditor(deps, knobs): Promise<Editor3dView>`
  - `deps`: the same `Editor3dDeps` the OrbitControls view takes.
  - `knobs`: `hidePx` and `crowdPx` from the link switch (the visibility
    rule's thresholds), `clouds` (the near clouds by default, `old` the way
    back; their tiles bake in `globe-cloud-bake-worker.ts`), `quality` (the
    tier's name, which sets the canvas's pixel ratio and the clouds' start;
    a named tier holds it, with none the device's default may step down),
    and `grade`, the raw `?grade=` name judged here by
    `resolveGlobeGrade` (the globe's `globe-grade.ts`; an unknown name warns
    and keeps the default). `quality`, the raw `?quality=`, goes through `resolveGlobeQuality` with
    the pointer: a coarse pointer gets the medium tier and a fine one high,
    unless the link names one; low is never a default.
    `view3d().globe.grade` reads the tone curve and
    exposure back.
  - Resolves on the render loop's first tick with the same `Editor3dView`
    shape, so the shell, the view switch and the page's test hooks work
    unchanged.
  - Rejects with a `viewFailure` (`editor3d-view-parts.ts`): `chunk`
    when the geoid does not load,
    `context-lost` before the first frame, or the first frame's own error.
    Everything made so far is undone first.

## How the tour hangs on the globe

The stations layer (`editor3d-stations.ts`) keeps its tour frame (x east,
y up, z south at the tour's centre). One group, `tour-frame`, under the
Earth-centred group carries the inverse of `worldFromEcefAt(centre)` as its
matrix (`globe-layer.ts`'s `mountTour`), so the layer's coordinates land on
the globe and a recentre of the world frame moves nothing relative to the
ground.

## Per frame (`updateLayers`, the view's `update` seam)

- The ground handed between the globe's surface and the relief by the
  globe's relief mount (`mountGlobeRelief`, the one the globe lab uses):
  its band step sets the carrier share
  (`globe.surfaceUniforms.uCarrierShare`) by the camera's altitude, the
  relief gated until its tiles are loaded, and with `fill: true` (a view
  made with `band: true, stencil: true, fill: true`: a fill mount needs
  a view made with the fill, or the surface keeps its discard by the
  carrier share and the ground has holes where the relief has no tile)
  the globe's surface draws every pixel the relief has not. The relief is drawn with the globe's own
  imagery (`createGlobeImagery()`, an overlay of its own) and template
  (`globe.template`), as the lab's is. The carrier the page reports
  (`stats().globe.carrier`) and picks on is the one holding at least half
  the ground (share >= 0.5). `centre()` keeps its own 25 km line
  (`reliefCeilingM`).
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

- `setPaused(on)`: while true the loop returns at once and the frame clock
  pauses (the gap is no slow frame); the editor sets it while the
  character maker covers the page, so the cut and the save get the
  machine.
- The clock: daylight by default, `view.startClock` held (`scale` null with
  a `startMs`) at `daylightStartMs(Date.now(), centre.lng)`; `setRealTime(true)`
  restarts it at the real time now, `false` back in daylight. `stats().globe.clock`
  carries `realTime`, `sceneMs` and the sun's height over the tour
  (`sunElevationDeg`).
- The air: `mountGlobeViewAir` from `gps-plus-slam-globe/view`, mounted
  once the relief exists, in the view's `afterSky` and `afterScene` seams
  and stepped in `updateLayers` after the camera and the frame are
  placed; the relief's tiles are hazed before they load. Without it the
  view core's sky is black at noon. It writes the globe's sun intensity
  (the eased exposure) every frame, so nothing here sets it.
  `stats().globe.air` carries its `weight`, `observerKm` and the ground
  sky's state, and `clouds` (`{ on, flat, shellOn, shellShadow,
surfaceShadow }`, or null where the ground sky cannot draw).
- The heavy clouds: the lab's slab, shell and high layer with the lab's
  settings (`globeViewClouds(view, { shadow })`, passed to the air), on by
  default; the link's `cloudShadow` (0.3) sets their shadows' strength
  and `cloudWind` (40 m/s) the cloud map's wind floor.
  The air steps them with the relief mount's cloud-shell share
  (`shareClouds(true, flat)`), draws them after the Earth and patches
  their shadow onto the relief; `setClouds(on)` is the View menu's
  switch. The cloud shell sits at 3 km, the lab's height. The clouds'
  `extra` depth carries the buildings' root, so a cloud behind a
  building is hidden as one behind the relief is.
- **The OSM buildings** (`editor3d-globe-city.ts` over the Globe
  package's `createGlobeCity`, its worker `globe-city-worker.ts` made as
  a module worker from `new URL("./globe-city-worker.ts", import.meta.url)`):
  under the Earth-centred group at the tour's centre (mounted only once
  the tour has a real centre: a new tour opens over a stand-in place, and
  the store's first edit that gives it one mounts them, hidden if
  `setBuildings(false)` came first), on the relief's own
  height source (`ground.heights`: Mapterhorn at zoom 14 where it has the
  whole window there, else at zoom 12, `deepHeightsZoom`), so the city's
  ground and the drawn relief agree by construction
  (`stats().city.parityM`). The approach's start warms them up (a fresh
  load during the fall, `warmCity`); each frame (`stepCity`, after the
  uploads) loads them once below 30 km and fades them in by altitude, and
  the selection's place, its up and its radius turn the buildings and
  trees around it see-through. `setBuildings(on)` shows or hides them (no
  chip yet). None is made with the link's `buildings=0`, in a browser
  without workers, or when making it throws (`openCity`): the view opens
  without buildings, never not at all. Picking never meets them: the
  stations are picked by the layer and the ground on the sampled relief
  (`groundPointOfRay`, `controls.pickFrom` the relief's tiles), and
  nothing raycasts the city.
- **The interface over the clouds' shadow** (`globe-interface-pass.ts`):
  the shell's ground shadow is a full-screen quad composited after the
  scene, its rays ending at the relief's depth (the scene depth holds the
  relief only), so by reading the code it darkens every billboard, ring
  and pole in front of the shaded ground as if it were that ground
  (headless draws no visible cloud shadow; the phone check confirms the
  cause). Each frame the interface
  under the tour's frame and the editing's scene objects (the gizmo) is
  lifted onto its own layer before the scene (`beforeScene`) and drawn
  after the air (`afterScene`), with the daylight lit on that layer; the
  renderer does not clear between the passes (`autoClear` is false in
  the view), so the relief still hides what is behind it. The ground and
  the tour's models stay in the scene and take the shadow. Only while
  the camera is below the cloud deck (`interfaceOverAir`, the clouds'
  shell height): the cloud and haze composites write no depth, so from
  above the deck (the approach, a zoom-out) the interface stays in the
  scene's pass, under the clouds that hide it.
- Standard depth, not reversed: the clouds' and the air's scene-depth
  readers assume it, and reversed depth measured no better on the
  24-bit buffer.
- `flyTo` and `frame` place an aimed view (`aimView`) at once; there is no
  flight yet.
- `setTop`, `northUp`, `setTilt` re-place the current pose with one field
  changed.
- `zoom` moves the camera along its line of sight `ZOOM_SHARE` of the
  distance to the sampled ground under the screen's centre (to the
  camera's horizon), `backM` at least; where none answers (the sky,
  heights not loaded) the distance to the tour's centre at its drawn
  height (the tour frame's point `centreHeightM` up), as
  `stats().distanceM` is - not to the frame's origin on the ellipsoid,
  which lies the tour's height under it. `setDistance` is measured to
  that tour centre.
- A zoom step (a zoom button's, a double click's) ends the camera at
  least `eyeM` over the higher of the loaded grounds under its start and
  under its end (`keepOverGround`), so a slope rising ahead counts: only
  the step's vertical part changes, by lifting the end point along the
  end's up, so its horizontal part is kept whole and a zoom from eye
  height looking a few degrees down still walks forward (scaling the
  whole step would freeze it there). With no ground loaded at either end
  the tour's own drawn height (`centreHeightM`) stands in, so a double
  click (which then aims at the ellipsoid) does not take the camera under
  a tour on a hill; only within `STAND_IN_REACH_M` (5 km) of the tour's
  extent (`tourReach`), since far away the tour's height says nothing
  about the ground, and there no ground means no lift. The reach follows
  the tour as edited (set again from `tourNow` and the placed codes on
  each tour change), so a station added far from the opening tour counts. Tested with a fake
  ground rising north, swept over grades from -30 % to 40 % (on level or
  rising ground the camera ends exactly `eyeM` over the end's ground),
  with ground under the start only, 50 km from a tour with none, and
  over a station added 50 km away after the open.
- `centre()` is the place UNDER the camera, not a look-at target (eye mode
  has none), and `groundAt(place)` the ground there, in the tour file's
  ellipsoidal heights: the drawn ground plus the geoid's N (the
  editing's). With no ground loaded under the camera, `centre()` is the
  camera's height less `eyeM` (plus N) at or under the relief's ceiling,
  and null above it: the tree's "+" then says to come closer instead of
  adding a station kilometres in the air.
- Editing is the OrbitControls view's (`createSceneEditing`): `turn`,
  `cancelGesture`, `handleScreen`, `underAt`, `gizmoSizes`, `modelParts`,
  `showSoundIcons`, `modelScreenOf` and `characterCheck` are the editing's. Its camera leases the globe's
  controls off for a handle drag (`GlobeCameraControls.lease`), and the
  view's `gestureBusy` is true while the controls or an edit's gesture
  run, so the world frame recentres only between gestures. The ECEF
  matrices it reads are refreshed each frame and at every frame move (the
  view's `frameChanged` seam, which also releases the controls), so they
  are right from the first view on (`followFrame`).
- The globe's controls are made with `doubleTapZoom: false`: a double
  click is the routing table's `camera-zoom`, done here (`zoomTowards`),
  and the library's own animated double-tap zoom would add a second one.
- The routing table's extras: an arrow with nothing selected steps the
  camera (`steppedView`, the height over the loaded ground); a double
  click (or a finger's double tap) on nothing moves the camera
  `ZOOM_SHARE` of the way toward the sampled ground under the pointer,
  along its ray (what is under the pointer stays there), reaching to the
  camera's horizon (`groundPointOfRay`), and toward the ellipsoid where
  no ground answers (`ellipsoidPointOfRay`: heights not loaded); a ray
  into the sky does nothing.
- Two fingers are the globe's controls' (their pinch, twist and tilt, as
  in the globe lab; the routing table's `fingers` row): the editing
  camera says `takesTwoFingers`, so the input leaves the controls free
  for them; a handle drag a second finger interrupts is cancelled
  unwritten, and the camera then stays still until every finger is up. Before, the input locked the camera for two fingers and read
  them for the OrbitControls view's gestures, which the globe view
  ignored: two fingers held the camera still.
- What the controls zoom toward, drag on and keep their height over is the
  SAMPLED ground (their `groundRay` is `groundPointOfRay` of the relief),
  the ellipsoid where none is found. They used to pick the relief's drawn
  mesh, which put a pinch's zoom point 15 km off and 5.8 km under the
  ground: a spread from eye height flew the camera about 6 km through the
  ground, a close climbed about 4 km. The page's checks carry the camera's
  pose and the sampled ground under it (`globe.pose`,
  `globe.groundUnderCameraM`) to measure a pinch by.

## The approach on opening

With `deps.approach` (the page sets it for a tour opened afresh into the
3D view, never for a restored draft or a switch from the map) the view
flies in from high above on the globe's own meteor
(`globe-approach-meteor.ts`, run by `globe-approach-run.ts`): each frame
the flight places the camera (`placeCameraEcef`) with
`controls.followIntro()` instead of the controls' own step. The view's
frame is set once, at the tour, and after that only the view's own
recentring moves it (`stats().globe.frameChanges` counts every move, for
the page's check): the old approach set it from the camera's pose every
frame; the frame is no longer moved per frame. The meteor's knobs come from the link
(`globe-switch.ts`); its pacing reads what loads at the tour
(`tourArrivalProgress`: the relief's ground there known, the relief
settled, then the admitted share of the stations), and the relief's finest ground revises its landing. The run's
accent line (a progress bar named "Loading tour") hangs in the view's box
over the page's permanent `#load-line`; its load ends
(`deps.approach.ended` is called, with `"landed"` or `"taken"`) a beat
after the landing, at once after a takeover, and the line stays full;
what still loads does not keep the load going (it reads no load counts).
The view disposes the run once the arrival is over.

- While it flies the stations are held back (added to what `setHidden`
  gets); on arrival they pop in one after another (`layer.setGrowth`)
  with a ring each on the ground (`globe-approach-marks.ts`), then the
  recorded walk (`deps.walk()`, the captures' heights lowered by the
  geoid) draws itself. No walk, no walk line. The walk is read each frame and
  rebuilt only when the page's array changes (`deps.walk` keeps its
  array while the walk is unchanged); a walk that comes after the
  arrival's walk began, or after the approach ended, draws itself from
  when it came (`walkDrawShare`), not whole in one frame. With no
  approach at all it is drawn whole. It follows the walk layer chip
  (`showWalk`), not the page's debug switch.
- The flight's clock starts at its first drawn frame (the run's first
  `drive` in the frame's camera step), not at mount: the box's fit and the first tiles
  can take a while, and a flight timed from mount would skip its start.
- Takeover: a pointerdown or a wheel on the canvas (capture phase), the
  controls' `onTake`, the arrows, the zoom steps and the toolbar's camera
  verbs stop the flight where it is.
- A flight to a station (a pick in the list) while flying retargets the
  flight (`retarget`) instead of jumping.
- **The start**: where the globe lab's intro zooms out to
  (`meteorStartAltitudeM`, the whole Earth in view), at the aspect the
  first frame will have: the box's once laid out, else the window's (the
  box is hidden while the flight is planned, so the view's own fit is not
  known yet). The link's `startKm` overrides it.
- **The controls zoom out as far as the lab's** (`controls.limit`:
  `globeZoomOutLimitM` at `GLOBE_INTRO.maxKm` and twice the fit at the
  aspect now), and never nearer than the approach's start, so a takeover
  at the start is not pulled in.
- **The speed streaks** (`createSpeedDustPass` from
  `gps-plus-slam-globe/view`, in `SPEED_DUST_LOOK`, the globe lab's
  look; off with the link's `dust=0`): stepped in the view's
  `beforeScene` seam with the camera's ECEF pose and drawn there at
  1 - `over` (the Earth covers them), then at `over` in `afterScene`
  before the air, the lab's order. They follow the whole motion while the
  flight places the camera, only the distance otherwise (turning the
  globe does not streak sideways). Every placement that is not flown
  (the flight's own start, `placeView` for a fit, a pose, an arrow step,
  the street view; the zoom steps and `setDistance`) restarts their
  speed, so a teleport never flashes them.
- `stats().flying`, `stats().globe.approach` (the run's stats, or the
  last run's once it ended) and `stats().globe.marks` are the page's
  checks; `stats().globe.dust` (the streaks' state), `centreM` (the
  camera's distance from the Earth's centre), `fitM` (the view's fit),
  `startCentreM` and `frameTimesMs` (the last 60 frame intervals,
  `frame-clock.ts`, as the readout's frame numbers) are
  the start's and the streaks' checks.

## Invariants & assumptions

- The page's box is hidden until the open resolves; the view's fit needs a
  laid-out canvas (a zero-size canvas would make its aspect NaN and throw).
  So the loop skips drawing while the canvas has no size and resolves the
  open on that first tick. The view's height (`viewportPx`) and the
  first frame's aspect are the canvas's, not the box's: the bottom panel
  shortens the canvas (it pushes the view up; maximised, none is left and
  the loop skips drawing). A ResizeObserver follows the box and the
  canvas. The readout's draw calls and triangles come through
  `drawnCounts`; `mapTiles`, `retryMap` and `lastMapRetry` hand the
  overlay's tiles and retry to the bottom panel.
- A frame that throws after the open stops the loop and tells the page
  (`events.failed`); a lost context after the open tells it too.
- `dispose` frees in reverse order: the loop stops first, and the
  context-lost listener is taken off before the WebGL context loss is
  forced (the forced loss is not a lost context to tell the page about).
- Credits are mounted once at open (`editor3d-credits.ts`: one button,
  its overlay listing the globe's active sources and the relief's in
  full, with GIBS's acknowledgement under them); they do not follow a
  later change of sources yet.
- The globe's assets are served at `/globe-assets/` by the dev server
  (`../dev-server/globe-assets-route.ts`) and, on the built site, from
  the one copy the site build puts at its root (`scripts/build-site.mjs`).
- The status bar's `readout().drawCalls` is the whole frame's
  (`frame-draw-calls.ts`: the renderer's automatic reset off, reset in
  the `update` seam, read at the end of `afterScene`), every pass summed:
  the sky, the scene, the air's composites and the interface pass. With
  the automatic reset it read only the last pass's. `stats().globe.drawCalls`
  holds the same frame's total (`frame`) and the main scene's own render
  (`scene`, the difference of the counter's `now()` across it), so a
  check can hold the total to at least the scene's.

## Stats

`stats()` carries the OrbitControls view's fields plus `globe`: the carrier,
the camera's altitude, the frame target, the hidden stations and codes, the
frame recentres, the surface's state and `uploads` (`pending`, `ran`,
`worstFrameMs`, `admitted`). `mapLoad` is the street map's typed loading
state (`OsmMapLoad`: tiles waiting, failed, given up, the request ceiling's
wait in s), produced here for the shell to show. `relief` is what the
hand-over to the relief waits for: its share and target, whether its view
has settled (`settled`, the band's condition), the library's `loadProgress`
and its tile counters (`queued`, `downloading`, `parsing`, `loaded`,
`failed`), and its tile cache's bytes against the device budget
(`cacheBytes`, `cacheMaxBytes`). A test that waits for the carrier reads it to tell a slow load
from a stalled one. `clouds` is what the clouds' shadow and motion checks
read: the drift rate (deg/s) and the map's longitude offset (rad), the
link's `shadow` and `windMps`, the canvas probes (`probes`: pixels of a
billboard, a ring and a model), the
shell's frames drawn, share and weights (`shell`) and
how many objects the interface pass lifted (`interfaceLifted`).
`city` (top level, beside `globe`) is the buildings' (`EditorCityStats`:
the worker's phase, tiles, buildings, objects, geometry bytes, fade, the
height parity against the relief at the tour's centre, the load and the
see-through), null without buildings.

## Tests

- `editor3d-globe.test.ts` (jsdom, the wiring): the view core, the
  controls, the relief, the stations layer and the input are fakes; the
  fake view places its camera through the globe's own `viewPoseEcef`, and
  the editing is the real one. It covers `gestureBusy` during a gesture, a
  frame move releasing the controls and refreshing the editing's matrices
  (the place under the camera right after the first view and after a
  recentre), `centre` and `groundAt` with N added, the zoom and the
  distance measured to the tour's centre where no ground answers at tour
  heights 0, 515 and 2,500 m, the zoom (button and double click) walking
  forward from eye height 3 to 10 degrees down, the approach's clock
  starting at its first frame, no load counts (the map's coverage, the
  relief's) read during the approach, a walk that comes after the approach drawn
  from its arrival and re-read when it changes, the double click's zoom from 300 m, 8 km
  and 40 km (the ground beyond 5 km; loaded, and not), a button's step
  50 km from the tour (to the ground ahead), no step under eye height
  (from 1.8 to 40 m up, steep and shallow), `centre` with no ground
  loaded either side of the relief's ceiling, and the order of
  `dispose` (the air freed before the view).
- `globe-editor-look.test.ts` (the pure rules), `editor3d-stations.test.ts`
  ("hides single stations and codes, and nothing hidden is picked"),
  `editor3d-terrain.test.ts` (the ECEF placement).
- `../app-bundle.test.ts`: the globe view is reached only by import()
  from the editor's page, and only its chunks hold the globe's imagery.
- `playwright-tests/editor3d-globe-start.spec.js`: the approach's first
  frames at least the fit from the Earth's centre, at the lab's intro
  distance, on a phone held either way and a desktop; the streaks shown
  mid-flight in the lab's look, off for `dust=0` (the speed still
  measured), and their frame times against the same flight without them.
- `playwright-tests/editor3d-globe.spec.js`: opens `/edit.html` (the globe
  is the default; `globe=1` is an old link that still works) and
  finds the globe and a station through the page's test hooks; the sky
  (blue at noon, dark at midnight); a handle drag holding the camera and
  the frame still (the frame even with the camera taken 60 km away); a
  pinch on a touch screen at three separations (60 to 120, 60 to 300 and
  300 to 60 px) stepping toward or away from the ground under the fingers
  by a bounded share of the distance to it, never under the ground.

## `lookFrom`

- `lookFrom(selection)` places the globe camera at a picture's viewpoint looking along its line of sight (`lookFromView`), through the same take-over, release, `placeView`, dust reset and `followIntro` steps as a fly-to; false when the selection has no viewpoint.
- There the camera sees through the viewpoint's lens (`createLensHold`, `editor3d-lens.ts`), worked again at the aspect each frame; the sky copies the camera's field of view, so it follows. `GLOBE_EDITOR_LOOK.fovYDeg` is back on the controls' gesture (`onTake`), every aim (`aimAt`: fly-to, Frame), pose change (`placePose`: tilt, Top view, north up), zoom, double-click zoom, keyboard step and distance, and on a selection other than the picture. `lookFrom` takes over the arrival first, so its field-of-view ease never runs against the lens; a release with no lens held writes nothing, so the arrival's ease is untouched. The layer's sizing, the billboards (resized when the lens is taken or given back) and the hiding rules take the field the camera sees through now (`lens.fovDeg()`), so a held lens never draws a screen-sized mark at the wrong size or hides a station by a wrong size on screen. `stats().fovDeg` gives the camera's.
- The layer is handed `selected` each frame, for the selected picture's field-of-view lines (`editor3d-stations.ts`).
