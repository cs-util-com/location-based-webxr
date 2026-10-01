# labs/globe/globe-lab.js - the globe lab

- Purpose: globe plan 2026-09-26-0539 §7, M0-M4. The globe package's
  surface (`/globe/globe-surface.js`), served no-build: the Earth textured
  from the committed Blue Marble pyramid, lit by the real sun, with night
  lights, a water glint and clouds, and a credits line (the short names, the full texts and GIBS's acknowledgement in a
  `<details>`, built with `textContent` only). A loading label ("Loading
  Earth imagery: n of m") shows while tiles are pending, and the error box
  names tiles that could not load ("a coarser level shows there") and global
  maps that could not load. The label counts the two global maps too, so
  it ends only when the clouds (the largest file) have arrived.
- Round 2 (plan 2026-09-26-2055 M3 c-f; round-3 plan 2026-09-27-0532 §4 F):
  the lab owns a pinnable clock that drives the sun and the clouds' drift;
  a background pass (`/globe/globe-sky.js`) draws the sun's disc and glow
  behind the Earth; a device line says whether float textures filter
  linearly. The stars are PROCEDURAL (`/globe/globe-stars.js`; no catalogue
  with a clear licence was found, owner decision on round-2 Q2), turned
  with Greenwich sidereal time, with a faint Milky Way band; the credits
  line says "Stars: procedural, not a star catalogue."
- The control plate (M4): the design system's look-dev plate
  (`../../3d/lookdev.css`, `../../3d/panel.js`: collapses, remembered,
  folded on a phone), moved to the right. Every control writes its hash
  key and follows the hash back, so the hash is the one state and a link
  reproduces a view. Sections: Sun and time (the UTC hour of `#time=`,
  "Now" removes it, the clock speed `timeScale`, sun intensity), Surface (night lights, water roughness,
  cloud opacity, cloud drift), Sky (the pass on or off, the sun disc's
  apparent diameter, its glow), Camera and turn (field of view, the wait for a fix, the
  turn, "Replay the turn"), Tiles and memory (error target, tile cache,
  pixel-ratio cap). A control REPLACES the history entry and applies at
  once (a slider drag neither floods the back button nor waits for
  `hashchange`); an edited or pasted hash applies on `hashchange` and the
  controls follow it (a value a select does not list is added to it). The
  hash stays readable (`at=30,15`, not `%2C`). Sliders take their ranges
  from `PARAMS`. On a phone-width screen (600 px, panel.js's narrow query)
  the error and loading lines move below the folded plate's header.
- The look's defaults are the owner's tuned values (round-4 plan
  2026-09-28-2105 DEC-GL4-1): sun intensity 5, night lights 0.7, sun disc
  1°, sun glow 0.95, stars to magnitude 7.5 at gain 4, Milky Way 0.03. They
  live in the globe package (`GLOBE_SURFACE.sunIntensity`,
  `GLOBE_SURFACE_TUNING.nightGain`, `GLOBE_SKY`), so whatever consumes
  the globe later starts from the same look; the lab reads them as its
  fallbacks. A link that names a value keeps it. The smokes that measure
  pixels pin the look before round 4 (`withPreRound4Look` in
  `globe-smoke-helpers.mjs`).
- Hash parameters and ranges (`PARAMS`, the one source for the sliders too;
  out of range, empty or malformed reads as the default): `spinMs`,
  `turnMs` (0-10000), `diveMs` (the pin's dive, 1000-60000, default
  15000), `handOverKm` (the hand-over altitude, 1-1000, default 150; the
  plate offers 20, 50, 150), `handOver` (1 opens the city, 0 holds),
  `nightGain` (0-4, default 0.7), `waterRoughness`,
  `cloudOpacity` (0-1), `cloudDrift` (0-10 °/s of scene time, default 0.5),
  `sky` (0 turns the background pass off, default 1), `sunSize` (the disc's
  apparent diameter, 0.1-10°, default 1°, about twice the real 0.533°),
  `sunGlow` (0-4, default 0.95), `stars` (0 hides the procedural stars,
  default 1), `starMag` (the faintest star drawn, 0.5-9, default 7.5:
  15,811 stars; 88,914 at 9, DEC-GL4-2), `starGain` (0-10, default 4),
  `milkyWay` (the band's
  linear radiance, 0-0.1, default 0.03; the sky pass is not tone mapped,
  so it shows), `sunIntensity` (0-8, default 5), `fovY` (20-80, default 50),
  `pixelRatio` (the cap, 0.5-4, default 2, what §7.2 sized the pyramid
  for), `errorTarget` (0.25-256), `cacheMiB` (8-4096), plus `at` and
  the clock's `time` and `timeScale`.
  - The clock (`/globe/globe-clock.js`, round-3 plan 2026-09-27-0532 §4 F):
    `time=<ISO>` pins the scene's instant and the clock stands still (a
    hand-typed `+02:00` offset works: form decoding's space is turned back
    into "+"); `timeScale=<n>` (0-100000) runs it at n scene seconds per
    real second, from the pin or from now; with neither it is the wall
    clock. The sun reads it every frame. A clock is restarted only when
    `time` or `timeScale` changes, from the pin (or now) again, so a link
    reproduces the scene from its load. The plate's "Clock speed" select
    shows the EFFECTIVE speed (0 when pinned, 1 when not). Changing it
    also writes `time=` to the instant it is made at, so the scene carries
    on instead of rewinding to the old pin (the clouds jump once there).
    While the clock runs, the hour label and slider follow it once a
    second and the label names a speed other than real time
    ("12.5 UTC, x3600").
  - The clouds drift on the clock's DRIFT time (`driftTimeAt`: the
    scene's speed up to real time, real time above it), so a fast clock
    does not strobe them: at 600x they move 0.5 °/s, as at 1x.
  - The error target, the sun's intensity and the cache cap default to what
    the surface sets itself (read from the live surface at start:
    GeneratedSurfacePlugin's 1 px, the light's 5, `GLOBE_SURFACE`'s 64 MiB),
    so the lab never overrides the surface by accident; the cache floor
    keeps the surface's floor-to-cap ratio.
  - The field of view and the pixel ratio refit the camera and resize the
    drawing buffer only when they change.
  - Only a change of `at`, `spinMs` or `turnMs` restarts the intro;
    everything else applies live, so dragging a slider never replays the
    turn. `appliedHash` says when the page has applied a hash.
- The light (M3): `solarPosition(time, 0, 0)` from `/fw/geo/solar-position.js`
  through `sunDirectionEcef` into `globe.setSun`, every frame, for the
  clock's instant; the same instant sets the clouds' drift
  (`cloudLonOffsetRad(time, cloudDrift)` into `uCloudLonOffset`);
- The frame (round 2): `autoClear` off; clear, then the sky pass (the sun
  in the direction the Earth is lit from, the light's position turned into
  the world by the surface's group; the stars and the Milky Way turned by
  the surface's `celestialToWorld` of the Greenwich sidereal angle of the
  clock's instant, exactly as the light is turned; skipped with `#sky=0`),
  then the Earth
  over it. The sky has its own camera sharing only the view's rotation and
  field of view, and no depth, so the Earth covers it by draw order.
  Last, unless `#atmo=0`, the atmosphere pass over both.
- The atmosphere seen from space (round-4 plan 2026-09-28-2105 DEC-GL4-4,
  DEC-GL4-11; `globe-atmosphere.js`, its numbers in
  `globe-atmosphere-frame.js`): the lit limb's bright band, the blue halo
  outside it and the blue veil over the day side, from one march through
  the framework's physical atmosphere tables, lit by the Earth's own sun.
  ON by default (the owner asked for it). Hash keys: `atmo` (1 on, 0 off),
  `atmoSteps` (samples per ray, 2-64, default 12, or 8 on a coarse
  pointer: `defaultAtmosphereSteps`), `atmoStrength` (a
  scale on its light, 0-4, 1 = as computed), `atmoThickness` (the shell
  drawn 1-10 times thicker than the real air, each ray keeping the real
  optical depth so only the width changes, default 6: as wide as the owner's reference, 1 = physical).
  `state().atmosphere` is `{ on, supported, steps, strength, thickness }`
  (`supported` false where float render targets are missing: no pass).
  Every smoke that measures pixels on the look before round 4 pins
  `atmo=0` (`withPreRound4Look`, and the coast and stars specs).
- The held view (review 2026-10-01 M1): `__globeLab.pitchView(deg)` takes
  the camera from the flight and the controls as a press would, pitches it
  up by `deg` about its own right axis and HOLDS it there (the controls
  stop running until a reload), so a smoke can look at the sky from inside
  the air; the dive itself always looks straight down.
- The cost probe (round-4 plan DEC-GL4-2/4): `__globeLab.timeFrames(n)`
  draws n frames back to back, reads one pixel so the GPU has finished,
  and returns the wall time in ms. Under SwiftShader it is relative only:
  the smokes compare two settings within one page load.
- The reference look (round-4 plan 2026-09-28-2105 DEC-GL4-8, the
  owner's reference image, §1.1 items 1-7): five switches on the plate's
  "Reference look" section, each 0 (off, the look before) to 1, each
  compared against its own OFF (`globe-look.smoke.spec.mjs`):
  - `grade` (item 1): the ground desaturated towards a cool blue
    (`uGrade`);
  - `cloudRelief` (item 2, the shading only; a sharper cloud texture is a
    data decision, see the round-4 results): thin cloud edges blue-grey and
    the side of a cloud mass facing the sun lighter, from the coverage's
    screen-space gradient against the sun's direction on screen
    (`uCloudRelief`);
  - `twilight` (item 3): the night side faintly blue-grey (from the
    ground's own colour), a soft band just past the terminator, and warm
    orange city lights (`uTwilight`);
  - `space` (item 6): navy space, lighter towards the Earth's limb (the sky
    pass's `setSpace`, fed the Earth's direction and angular radius every
    frame);
  - `starGlow` (item 7): a soft glow round bright stars; with a low
    `starMag` (fewer stars) and a high `starGain` it gives the
    reference's few bright stars as an alternative to the owner's dense
    field.
  - Item 5 (a dark sea without a bright glint) needs no new switch:
    `waterRoughness=0.9` makes the water as rough as the land. Item 4
    (relief from elevation) needs a height map (data), not done.
- The distance readout (round-4 plan 2026-09-28-2105 DEC-GL4-5):
  "Altitude 20,180 km" bottom left, above the device line, and while the
  pin's dive is on its way or holding over the target, " · 1,300 km to the
  target" after it (the straight-line distance to the target's point on
  the ellipsoid). The altitude is the camera's height above the WGS84
  ellipsoid (`getPositionElevation`), so the owner can name the altitudes
  where the flight's cloud fade should start. Formatting and throttling are
  the globe package's `globe-readout.ts`: whole km from 100 km, one
  decimal from 1 km, metres below; written at most 4 times a second and
  only when the text changes; not a live region (`aria-live="off"`: an
  `<output>` is a polite live region by default). `state().readout` is
  this frame's text, `readoutShown` what the line shows.
- The bottom lines are ONE stack in flow (`#globe-bottom`): a row with
  the readout on the left and the pin with its status line on the right,
  then the device line, then the credits. They were placed at fixed
  offsets from the bottom until the r760 CI run, where a wider font
  wrapped the credits into the device line and the readout; in flow, a
  line that wraps pushes the ones above it up. Only the pin and the
  credits take pointer events. No two of the five overlap at 360, 390 or
  412 px wide (`globe-readout.smoke.spec.mjs`).
- The device line (round-3 plan §4 F; terrain plan 2026-09-27-0605 §7):
  "This device filters float textures (OES_texture_float_linear): yes" or
  "NO", from the renderer's own context, bottom left above the credits, so
  the owner can read it on his phone before the terrain dive is built; intensity 5 (DEC-GL4-1), Neutral tone mapping, no ambient
  light, a black sky (plan §7.3).
- The intro (M2, `/globe/globe-target.js`, `/globe/globe-camera.js`):
  - `spin`: from 30°N 15°E, the view's longitude falling 3°/s, so the
    surface moves west to east across the screen as the Earth turns;
  - `turning`: once `chooseGlobeTarget` has a target, the turn from the
    spin's pose to the target's, eased by `smoothstep` over `turnMs`;
  - `arrived`: the target held at the centre, north up.
  - fovY 50°, the disc filling 90 % of the narrower side
    (`orbitDistanceToFit`, re-fitted whenever the width or the height
    changes), the setting the z0-z3 imagery was sized for.
  - `#at=<lat>,<lng>` is the target (absent or malformed means none),
    `spinMs` the wait for a fix before the Central Park fallback (default
    3000), `turnMs` the turn (default 5000). A change of any of them and
    the "Replay the turn" button start the sequence again, from the spin's
    start (a hash edit mid-turn therefore jumps back; fine for a lab).
  - `user`: the user has taken the camera (below); the intro stands still
    until the replay button or a new `at`, `spinMs` or `turnMs` restarts it.
- Touch and mouse (round-2 plan 2026-09-26-2055 M3a, M3b; round-3 plan
  2026-09-27-0532 §4 E): the tile library's own `GlobeControls` on the
  canvas, damping on:
  - one finger (or the left button) on the Earth drags it round; a pinch or
    the wheel zooms; a double tap zooms in;
  - two fingers moved together (or the right button) tilt, but only once
    zoomed in: farther out than where the Earth spans the narrower side of
    the view (at fovY 50° about 7,300 km up on a landscape screen, about
    24,000 km on a portrait phone) the library turns tilting off;
  - a one-finger swipe beside the globe, on space, does nothing: a press
    takes the camera only where its ray hits the Earth.
  - To measure on a phone: while the controls own the camera, each frame
    raycasts the tiles twice (the library's height adjustment, in `update`
    and `adjustCamera`); `adjustHeight = false` removes both if they cost.

  The camera has ONE owner at a time:
  - the intro while it spins, turns or holds (`cameraOwner: "intro"`): it
    sets the pose and the clip planes (`clipPlanes` in
    `/globe/globe-camera.js`: near 0.3 of the height above the ground, far
    just past the horizon, so the far side of the Earth is culled from the
    tile traversal); the controls are not updated, but they stay enabled
    (a disabled control ignores the press that should take the camera) and
    their up direction follows the camera, so that press finds the Earth;
  - the controls from their `start` event (a press on the Earth, a wheel
    step, a double tap; a press on space starts nothing): the intro yields
    (phase `user`), and only the controls move the camera and set its
    planes;
  - the replay button and a new target or timing in the hash give the
    camera back: the controls are toggled off and on (the library's reset:
    no drag, no pointers, no drag or rotation momentum), the globe's spin
    momentum and any pending wheel step are cleared, and the intro starts
    again from the spin.
  - `diving` and `landed`: the pin's dive (below), from the camera's
    current pose, distance and rotation (the rotation fades out over the
    first fifth, so a camera the controls had tilted turns smoothly
    instead of snapping), then held at the hand-over altitude.

- The pin (round-2 plan M3g, DEC-FB2-2/3), bottom right as in OsmDemo (the
  design system's locate atom, `btn btn--locate`, with OsmDemo's pin
  glyph), with a status line to its left. Its phases and labels are
  `/globe/globe-pin.js`'s; the button carries them in `aria-label`,
  `title`, `aria-busy`, `disabled` and `data-state` (`locating`
  pulses; flying and handing over use the engaged look):
  - idle ("Fly to my location") -> a press asks for the position ONCE,
    only then (the framework's `locateOnce` from
    `/fw/utils/locate-state.js`, 15 s as OsmDemo; no prompt on load,
    DEC-PRG-10);
  - locating ("Finding you... - tap to cancel", busy, still pressable: a
    tap cancels the wait, since the request can stay pending while a
    permission prompt is open; the status line then says "Stopped looking
    for your location.", and an answer to the cancelled request is
    dropped): a failure names its fix in the
    status line (`labelFor`: `locateAdvice`, e.g. "location permission
    denied: Allow location for this site in your browser's settings, then
    try again.") and the pin is idle again;
  - flying ("Flying to you - tap to stop"): the intro's `dive`
    (`planDive` / `diveStep` in `/globe/globe-dive.js`) turns over the
    first 40 % and descends log-evenly over `diveMs` to `handOverKm` above
    the fix, the height taken along the camera's own direction, and a
    tilted start's offset fading out over the first fifth; a press of the
    pin, a touch on the globe, or the page being hidden (another tab, a
    locked phone: the flight would otherwise run on and hand over the
    moment it is seen again) stops it and leaves the camera to the
    controls; the replay button or a new target ends it too;
  - handing over ("Opening the city..."): once landed, the page goes to
    `handOverUrl` (`/globe/globe-handover.js`): OsmDemo beside the lab
    (`<root>osm/` for a lab at `<root>lookdev/labs/globe/` on the site;
    on the design system's dev server `/osm/` is only its route to
    OsmDemo's source files, not the app), `lat`/`lng` and `clat`/`clng`
    at the fix, `cdist=1800` (the hand-over distance, well inside
    OsmDemo's fog: the sweep is in `globe-handover.ts.md`), and the globe clock's instant as OsmDemo's `date` (solar
    date at the fix) and `time` (apparent solar time) when the sun there
    is at or above -6°; otherwise no time, and OsmDemo boots at its own
    afternoon sun (the jump is part of the cut). With `handOver=0` the dive
    holds at the hand-over altitude instead and the pin is idle again
    ("Arrived 150 km above you (the hand-over is off)."). Back from the
    city, the browser may restore the lab from its back-forward cache as
    it was left, handing over: `pageshow` with `persisted` makes the pin
    idle again ("Back from the city."), and a press flies again from where
    the view is.
  - After a failure the button keeps the failure's `data-state`
    (`denied`, `timeout`, `unavailable`: the locate atom's warning dot)
    until the next press.
  - Phase 1 has no GPS (DEC-PRG-10): the fix is always null. The target is
    chosen only while spinning, so a fix arriving after the fallback would
    be ignored; phase 6 (the real locate timeout) has to decide that.

- Test API, `window.__globeLab`: `ready`, `error`, `spinStart`, `state()`
  (`{ models, tileErrors, cachedBytes, pendingTiles, loadedTiles, phase,
target, source, history, runs, spinMs, turnMs, centreLatLon, timeMs, clock,
cloudDrift, cloudLonOffsetRad, sky, device, deviceLine,
sunEcef, tuning, sunIntensity, fovY, pixelRatio, errorTarget,
bytesDownloaded, tileRequestsByLevel, rendererMemory, appliedHash, radiusM, activeSources,
loadingShown, loadingVisible, cacheBudgetBytes, cacheFloorBytes,
creditShorts, mapsLoaded, mapErrors, mapsTotal, refusedTiles, distance,
cameraOwner, cameraDistanceM, altitudeM, near, far, pin }`;
  `pin` is `{ phase, label, status, located, handOverUrl }`;
  `cameraOwner` is `intro` or `controls`, `altitudeM` the camera's height
  above the ellipsoid, `near`/`far` the camera's clip planes;
  `tuning` is what the shader reads (the uniforms), not the hash;
  `hourLabel` is the hour label's text;
  `timeMs` is the clock's instant and `clock` its `{ startMs, scale }`
  (the pin or null, and the effective scale); `cloudLonOffsetRad` is the
  drift the shader reads; `sky` is `{ on, sunDiameterDeg, glow,
sunDirection, sunScreen }` (`sunScreen` the sun's normalised canvas point,
  null behind the camera); `device` is `{ floatLinear }`;
  `sky.stars` is `{ on, magLimit, count, procedural }`, `sky.milkyWay` the
  band's radiance, `sky.siderealAngleRad` the Greenwich sidereal angle;
  `regionStats({ cx, cy, rPx }, threshold)` reads the whole buffer after a
  render and returns the luminance sum and the count above the threshold
  inside and outside a circle;
  `projectDirection([x, y, z])` is where a world direction shows on the
  canvas, as the sky pass draws it (the view's rotation only), or null;
  `bytesDownloaded` sums the resource timing log's `/globe-assets/`
  entries, whose buffer the page raises to 4000, counting cache hits too;
  `tileRequestsByLevel` counts the distinct imagery tiles requested per
  pyramid level, index = level, 0-4), `project(lat, lng)` (a
  place's normalised canvas point, for probes at known places),
  `readPixels(points)` (normalised canvas points, read in the same task as
  a render).
  - `history` lists `{ phase, source, atMs }` per change since the start,
    and `runs` counts the starts, so a test reads a sequence instead of
    racing it.
  - `centreLatLon` is found through the library's frame: a ray against the
    drawn tiles, the hit converted by the tiles' ellipsoid. The ray is aimed
    1e-5 of the half-frame off both axes (about 50 m, 0.0008° on the
    ground): observed 2026-09-26, a ray crossing a tile edge of constant
    latitude exactly found no tile, or at a tile corner the far side of the
    Earth (the cause, shared vertices or three's triangle test, is not
    established). A hit beyond the Earth's centre reads as null.
- Invariants & assumptions: the page's import map maps `three` to the
  framework's copy and `3d-tiles-renderer` (and `/plugins`) to the vendored
  library; nothing leaves the machine. The sun is real, so a view can be on
  the night side: the tests pin `#time=`.
- Tests: `globe.smoke.spec.mjs`:
  - on a fixed view (`#at=30,15&spinMs=0&turnMs=0`, 11:00 UTC on an
    equinox so it is day): boots, lit centre,
    black corners, textured (the luminance spread around the centre), every
    credit named, the loading label shown then gone, the cache within its
    budget, no tile error, no request off 127.0.0.1, no console or page
    error; and with every level 2-3 tile answering 404, no hole (no probe
    showing the black sky exactly; the parent drawn), the error box, and no
    error but the library's own per-tile lines;
  - the centre within 0.01° of the target after arriving (the visual
    requirement is 0.25°; 0.01° also catches a geodetic-normal camera), for
    Cologne, Tokyo, (0, 179.9), (80, -40) and the spin start's antipode (the
    longest turn; not the exact-antipode branch, which the unit tests
    cover), reported across {0.01, 0.1, 0.25, 0.5}°;
  - with no `#at`: `waiting`, then `fallback` no earlier than `spinMs`,
    arriving at Central Park; the replay button runs it again;
  - (M3, equinox noon) the day side lit at the subsolar point (dark at
    midnight), night lights over Tokyo (none with `nightGain=0`), and the
    glint at the specular point with the clouds off (gone with
    `waterRoughness=1`): each check also run with its term off, where it
    must fail; floors reported across ±50 %;
  - (M3) no night lights on the day side (Tokyo at noon local, the same
    with `nightGain=0`), and the sun over 91.86°E at 06:00 UTC (the whole
    solarPosition chain, not mirrored);
  - no seam at 180° (the view 1 px west of 180°, at 179.894°, so a pixel
    quad straddles the line, asserted per row; per row, the jump across 180°
    against the largest ordinary jump: 0.67x with the fix, 4.02x without);
  - a global map answering 404: the error box says so, the loading label
    ends, the globe still draws, no page error.
  - (M4) every control on the plate once: it writes its key, the page
    applies it (the uniforms, the light, the tiles' error target and cache,
    a closer camera for a wider field of view), only the two timing
    controls restart the intro, ten changes add no history entries, the
    panel follows an edited hash, the hour sets `#time=` and "Now" removes
    it, no error; at DPR 2 the pixel-ratio cap defaults to 2 and the plate
    lowers it; at phone width the status lines sit below the folded plate;
    the measure tool's fields are live on the boot view.
  - Every settle wait allows 120 s (a view settles in 30-50 s locally;
    r745's CI runner timed out at 60 s), requires the tile count to hold
    for 1 s, and logs its time per view; the tests that settle several
    views carry an explicit budget.
- `globe-sky.smoke.spec.mjs` (round-3 plan §4 F): level 4 of the imagery
  requested and loaded without a tile error at a 0.25 px error target
  (whether a level-4 tile is drawn is not asserted: at 0.25 px the cache
  refuses hundreds of tiles, and the lab has no closer camera until
  stream E; at the default 1 px on the fitted view level 4 is not needed:
  logged); the sun's celestial direction at the equinox and the solstice
  turned by the rendered star rotation (`celestialToWorld`) landing on the
  drawn sun; the clock
  pinned across
  frames, a typed offset, `timeScale` running a pin, no `time` reading the
  wall clock, and the plate's speed select; the cloud offset at two pinned
  times and the drifted clouds in the pixels (not with the clouds off); the
  sun's disc white and centred on the projected sun beside the Earth (black
  with `sky=0`), its glow falling off; the sun behind the Earth not showing
  through (the same pixels with the pass on and off); the procedural stars
  bright in space and absent over the Earth (`regionStats` inside and
  outside the Earth's projected disc, stars on and off, thresholds 10, 20,
  40); the sun's right ascension from the sun and the sidereal angle (0h
  at the March equinox, 6h at the June solstice) and the credits naming
  the stars procedural; at 600x the clouds drifting at the 1x rate per
  real second, the hour label following a running clock with its speed,
  and a speed change from the plate carrying on from the current instant
  (stream F review, findings 1, 6, 12); the device line. The M0-M4 checks in
  `globe.smoke.spec.mjs` pin `cloudDrift=0`, `stars=0` and `milkyWay=0`,
  so their clouds and their black sky stay as measured. Both specs share
  `globe-smoke-helpers.mjs` (the settle wait, the hash wait, luminance and
  grids).
- `globe-navigation.smoke.spec.mjs` (round-3 plan §4 E): the intro's clip
  planes from the altitude on the fitted view (the far plane short of the
  Earth's centre); a 200 px mouse drag takes the camera (`user`), turns
  the centre west by more than 10°, the view stays put a second later, and
  the replay button returns the camera to the intro, which arrives at the
  target again; wheel steps take the camera below 50 km, where the near
  plane stays within the library's band (at most 1 km) and under half the
  altitude, the centre ray hits the Earth and a 5x5 pixel grid round the
  centre is lit (a clipped ground reads the black of space), and level-4
  tiles (none on the fitted view) load there without a tile error; on a
  touch screen (Chromium touch events through the DevTools protocol) a
  one-finger 200 px drag takes the camera and turns the centre west by
  more than 10°, and a two-finger pinch from 80 to 400 px lowers the
  camera by more than 10 %; with a mocked geolocation failing
  (denied, timeout, unavailable: an init script, as the browser offers no
  switch for the last two) the pin goes to "Finding you... - tap to
  cancel" (busy, pulsing), then back to idle with the fix named; a second
  tap while it waits cancels, and the late answer changes nothing; with a granted,
  mocked position (Playwright's geolocation) the dive runs under the
  intro with the near plane falling, and the page goes to the site-relative
  `/osm/` (answered by the test, since the dev server serves no OsmDemo
  app there) with the fix, `cdist=1800` and the pinned time as `date=2026-03-20` and an
  11:2x solar time; with `handOver=0` the dive lands within 500 m of 50 km
  and 0.01° of the fix and the pin reads "Arrived"; a press on the globe
  during a 20 s dive stops it (controls own the camera, no hand-over); a
  press of the pin, a hidden page and a new `at` each stop a 30 s flight
  without a hand-over (the request is caught with a 204, which keeps the
  page); at 23:00 UTC in Cologne the link carries no `date` or `time`,
  and a `pageshow` with `persisted` makes the handing-over pin idle, after
  which a press flies again.
- `globe-atmosphere.smoke.spec.mjs` (round-4 DEC-GL4-4/11): against the
  pass off, the lit limb brighter inside and just outside, the night limb
  unchanged, the day side bluer, far space untouched (floors at x0.5-x2);
  the rim's profile from 600 km inside to 1000 km outside the lit edge at
  thickness 1, the default and 10 (the halo falls off, its brightest
  point stays blue); the banding per sample count against 64 (no ring at
  the default); the cost per sample count on the desktop and phone tiers
  (pixel ratio 1, 1.5, 2), as on/off ratios, only with `GLOBE_COST=1` (a
  measurement that cannot fail); the colour at fractions of the rim's
  width across thickness 1, 6 and 10; the limb around the terminator's
  crossing, on and off.
- The memory and download table: `pnpm run measure:globe`
  (`measure-globe.mjs`), not a test.
