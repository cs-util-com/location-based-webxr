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
  1°, sun glow 0.95, stars to magnitude 7.5 at gain 4, Milky Way 0.03;
  round 5 (plan 2026-10-01-0945 DEC-GL5-4) took the stars to 8.5 and
  navy space to 0.1. They
  live in the globe package (`GLOBE_SURFACE.sunIntensity`,
  `GLOBE_SURFACE_TUNING.nightGain`, `GLOBE_SKY`), so whatever consumes
  the globe later starts from the same look; the lab reads them as its
  fallbacks. A link that names a value keeps it. The smokes that measure
  pixels pin the look before round 4 (`withPreRound4Look` in
  `globe-smoke-helpers.mjs`).
- Hash parameters and ranges (`PARAMS`, the one source for the sliders too;
  out of range, empty or malformed reads as the default): `spinMs`,
  `turnMs` (0-10000), `diveMs` (the pin's dive, 1000-60000, default
  15000; set in the hash it fixes the dive's length by hand, otherwise
  the arrival prefetch paces it), `prefetch` (the arrival prefetch, on
  unless 0; no panel control), `landKm` (where the dive lands, km above the
  ellipsoid, 1-5000, default 2; the plate offers 2, 5, 20), `land` (1 with
  an `at=` link flies the dive to that place; the city plan 2026-10-05-0040
  §12.4 R15; the dive starts on the first frame, from the camera's first
  placed view, never at load, when the camera has no pose and a dive set
  off from the ground), `flight` (1 today's dive, the default; 2 the
  continuous flight of the continuous-flight plan 2026-10-07-0941, CF4:
  the pin's press starts `/globe/pin-flight.js` at once, holding above about
  2,000 km until the fix (DEC-CF-4b), then one path to the landing whose
  clock is gated just above 100 km until the arrival prefetch is ready
  (DEC-CF-3b, 60 s cap DEC-CF-5); the prefetch's progress and the landing's
  floor (`diveFloorM`, a rise over 50 m replans) feed it every frame; a
  denied position ends at the hold; a touch or a hidden page cancels it in
  every moving phase (the intro's `yieldToUser` calls `pinTouch`, so its
  phase reads `cancelled`), and the pin says "Finding you, descending";
  with the prefetch off (`prefetch=0`) its progress reads 1, so nothing
  waits at the gate; the distance-to-target readout shows once the place
  is known (`aimPin`); the world frame follows the camera during it;
  `land=1` flies it to its link's place; `holdDiveAt` and `diveAltitudeAt` read its path at its own clock,
  and `state().pin.flight` reports its phase, clock, rate, landing,
  progress, gate and end),
  `nightGain` (0-4, default 0.7), `waterRoughness`,
  `cloudOpacity` (0-1), `cloudDrift` (0-10 °/s of scene time, default
  0.375, 0.75 x the first 0.5 by the owner's choice, DEC-G6-5),
  `cloudShell` (1, the default: the clouds move onto their own shell above
  the ground as the relief takes the pixels, the band's share, so the
  orbit keeps the painted look and the relief keeps its colour under a
  cloud; 0 paints them into the ground everywhere, as before; round-6 plan
  G6-2), `cloudShellKm` (the shell's height, default 3, times the relief's
  exaggeration E, set every frame), `cloudShadow` (the soft shadow on the
  ground with the shell, 0-1, default 0.6, scaled by the shell's share;
  `globe-clouds.smoke.spec.mjs` checks the ground keeps its colour, the
  shadow only darkens, and the orbit is unchanged; the test hook
  `hideCloudShell(on)` hides the shell),
  `sky` (0 turns the background pass off, default 1), `sunSize` (the disc's
  apparent diameter, 0.1-10°, default 1°, about twice the real 0.533°),
  `sunGlow` (0-4, default 0.95), `stars` (0 hides the procedural stars,
  default 1), `starMag` (the faintest star drawn, 0.5-9, default 8.5,
  DEC-GL5-4: about 50,000 stars; 15,811 at 7.5, 88,914 at 9, DEC-GL4-2), `starGain` (0-10, default 4),
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
  `__globeLab.placeView({ lat, lng, altitudeKm, headingDeg, pitchDeg })`
  holds the camera at a Debug export's pose the same way, so a smoke can
  stand where the owner stood. `__globeLab.shiftCamera(eastM, northM)` moves the
  camera along the ground without taking it from the controls, so a smoke
  can fly it far during a press.
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
    frame); default 0.1 since round 5 (DEC-GL5-4), 0 is black;
  - `starGlow` (item 7): a soft glow round the stars, wider the brighter
    the star (by intensity, visible at the default limit); with a low
    `starMag` (fewer stars) and a high `starGain` it gives the
    reference's few bright stars as an alternative to the owner's dense
    field.
  - `skyFloor` (F1, DEC-GL5-11; not a reference-look switch): the sky
    fill's floor, the terrain lab's `sky` key (here `sky` is the
    background pass's switch), default `SKY_FILL.floor`
    (0.5) from the Globe package's one sky level (`sky-level.ts`). A low
    sun's ground keeps that much of a zenith sun's light from the sky, as
    the terrain lab's relief does, so relief and globe agree at dusk; 0 is
    the look before the fill (`withPreRound4Look` pins it). `state()`
    reports it as `skyFill` (`{ floor, share }`, what the shader reads),
    not under `look`.
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
- The atmosphere's cost on the device (review 2026-10-01 M2): the plate's
  "Measure the atmosphere's cost" button alternates 10 animation frames
  each with the pass on and off, draws three frames back to back on each
  and reads one pixel so the GPU has finished, and appends the medians to
  the device line ("Atmosphere: 9.0 ms a frame on, 4.0 ms off (x2.25)",
  `atmosphereCostText`). The button is disabled and reads "Measuring..."
  meanwhile; `state().atmosphereCost` and `costMeasuring` report it. On a
  phone this is the only real-GPU number; under SwiftShader it is relative.
- The intro (M2, `/globe/globe-target.js`; round 5, plan 2026-10-01-0945
  §3.1, DEC-GL5-1..3: `/globe/globe-intro.js`):
  - `spin`: while it waits for a target, the camera turns from over the
    sub-solar point (the longitude falling 3°/s; `spinDirection`) at the
    zoom-out limit, at the variant's starting field of view;
  - `turning` is the FLY-IN, over `turnMs`: from the zoom-out limit (below)
    to the fitted distance, the direction turning to the target from the
    sun side (the target turned towards the sub-solar point by at most
    `turnCap`, 90° by default, DEC-GL5-3). The start is computed when the
    target arrives and follows it (`flyInStart`); if the spin was shown
    it blends there from the spin's direction over 1.5 s. So a GPS fix
    that arrives after the spin began starts on the sun side within the
    cap, as a link does (review 2026-10-01-2124 Major 2: before, it started
    wherever the spin was). In the `intro=`
    variant: `narrow` (the default: the field of view
    narrows from 80°), `distance` (at 50°), `fov` (the field of view
    narrows far out, then a short fly), `dolly` (widens from 50°: with an
    end of 50° it is `distance`). Every variant ends at the target, the
    fitted distance and `fovY`, which is 50° by default (DEC-GL5-2);
  - `arrived`: the target held at the centre, north up.
  - The fitted distance is computed at `fovY` (the disc filling 90 % of
    the narrower side), not at the camera's field of view, which the
    fly-in varies.
  - A view: `#view=<lat>,<lng>,<altitude km>,<heading>,<pitch>` (the Debug
    export's `link`; volume-cloud plan §16) opens at that pose: the frame
    moved under it, the intro skipped, the camera handed to the controls
    (`applyView`); a new `view=` in the hash does the same.
  - The target: `#at=<lat>,<lng>` if given; else a position, but only
    where the geolocation permission is ALREADY granted
    (`geolocationPermissionState` from the framework's import-free
    `sensors/permission-state.ts`, never a prompt at load; the pin asks):
    then `locateOnce` and the spin waits up to `spinMs` for it; without a
    granted permission it falls back to Central Park at once. A position
    that arrives while the fallback is flown to or held becomes the target
    over 1.5 s (no jump; the history then names `fix`).
  - The zoom-out limit, where the fly-in also starts (review 2026-10-01-2124
    Major 1): the largest of `maxKm` (50,000 km by default, DEC-GL5-1), the
    library's own limit at `fovY` and twice the fit (`globeZoomOutLimitM`,
    installed as a getter by `limitGlobeZoomOut`, so a resize or a new
    `fovY` re-applies it). At fovY 50: 16:9 keeps 50,000 km (library
    27,400, fit 16,482); a 390x844 portrait gets 67,004 km (library 59,201,
    fit 33,502; a fixed 50,000 km had cut the library's own limit there);
    at fovY 20 on that portrait, 174,423 km. A change of `at`, `spinMs`,
    `turnMs`, `intro`, `maxKm` or `turnCap`, and the "Replay the turn"
    button, start the sequence again.
  - To check on a phone (review 2026-10-01-2124 Minor 8): far out, the
    library nudges the camera to centre the Earth and turn north up, in
    proportion to where it sits between its transition distance (half its
    own limit) and the zoom-out limit. The larger limit weakens both: on
    16:9 at fovY 50, about 2.7x weaker at 20,000 km (0.17 of full strength
    against 0.46) and 1.4x at 40,000 km; on a 390x844 portrait, about 1.3x
    at 40,000-55,000 km (nothing nearer than 29,600 km either way). Check
    that a far-out drag still settles centred and north up.
  - `user`: the user has taken the camera (below); the intro stands still
    until the replay button or a new key above restarts it. A field of view
    the fly-in left wider or narrower than `fovY` (a press during
    `narrow`, say) eases back to it over 0.5 s (`FOV_RETURN_MS`); so it
    does when the pin's dive interrupts the fly-in. The test hook
    `__globeLab.fovReturnAt(fraction)` returns the last such ease
    (`{ from, to, ms, at, lastFrameAt, fov }`, `fov` at `fraction` x `ms`),
    computed by the same function the frame loop uses, so a smoke reads
    the ease by time, and checks each drawn frame's field of view against
    it at `lastFrameAt` (review 2026-10-01-2124 Minor 5).
  - `state()` reports `intro`, `fixState` (`fix`, `none` or `waiting`),
    `fovY` (the lab's) and `cameraFov` (the camera's, which the fly-in
    varies), `zoomOutLimitM`, `cameraDirection` (unit, ECEF), and for the
    fly-in `flyInStart` (its start now, null before a target), `firstTurn`
    (the camera's direction on its first frame), `firstTurnDistanceM` (the
    camera's distance from the centre on that frame, as the frame loop
    placed it, so a smoke reads the start without racing the clock; reset
    on restart), `flyInBlendMs` (0 when no
    spin was shown) and `flyInSettled`.
- The relief and the oblique flight (round-5 plan 2026-10-01-0945 §3.5,
  F1; DEC-GL5-9):
  - `relief=1` (read once, at load; 0 by default until the atmosphere
    hand-over, F2) draws the library's terrain tiles
    (`/globe/globe-terrain.js`) as the surface below the altitude band:
    the globe's group holds them, its template and uniforms light them,
    its sun still turns with the tile group; the centre raycast hits
    whichever carrier draws most of the pixels.
  - The altitude band (one-scene plan §3.2): above `bandHigh` (km, default
    2,000) the globe's own tiles draw alone, at and below `bandLow`
    (default 1,200) the relief's, and between them a dithered cross-fade
    at `carrierShareAt` of the camera's altitude, computed once a frame
    (`uCarrierShare`; each pixel goes to one carrier). Outside the band
    the other carrier is neither drawn nor updated, so it fetches nothing.
    `bandShare` (0-1) fixes the share at one view, and `bandFreeze=1`
    stops both carriers' tile updates, for the smokes (the share stepped
    over the same loaded tiles). The
    band exists because further out the carriers differ (at noon from
    1,000 km by a mean 4.31 levels, the relief's tiles coarser over part
    of the frame).
    - The hand-over is gated by readiness and filled through the stencil
      (round-6 plan 2026-10-04-1050 G6-1, DEC-G6-2). The altitude gives the
      target share; the drawn share moves toward it at most 1 a second
      while both carriers are ready, jumps to the one that is ready when
      only one is, and holds when neither is (`/globe/globe-band-gate.js`,
      readiness by `topLevelReady`). Each carrier is updated wherever it
      draws or the altitude wants it. The relief draws first and marks its
      pixels; the globe, compiled without the discard (`fill`), draws
      every pixel without a mark, coarse (`bandFillErrorTarget`) while the
      relief has every pixel (`/globe/globe-stencil-fill.js`).
      - The relief takes its first pixels only once its view is refined
        (`bandSharp`, default 1; owner 2026-10-04: no flash from the
        globe's sharp imagery to the relief's coarse first tiles), and keeps
        them while its top tiles are loaded. Under SwiftShader the takeover
        came 77.8 s after landing at the hold; `bandSharp=0` takes over as
        soon as the top tiles are loaded.
      - `bandGate=0` and `bandFill=0` restore the old rule, for a
        before/after. `bandFill` is read at start, since it needs a
        stencil buffer.
      - `holeColor=1` clears the frame magenta, so a pixel no carrier drew
        is unambiguous. `__globeLab.hideRelief(on)` hides the relief's
        tiles to check the fill.
      - `globe-handover.smoke.spec.mjs` (on-demand tier) reads every frame
        of a dive and of a zoom out: 0 holes with the gate and the fill,
        and holes with the old rule (the positive controls). It also logs
        the fill's cost at the hold (1.61-1.68 x under SwiftShader).
      - A drain frees the relief's imagery and meshes, but its decoded
        heights stay (`keepHeightsMiB`, default 16, read at start, 0 for
        none; `createGlobeTerrain`'s `keepHeightsBytes`, owner decision
        2026-10-04 DEC-N1), so a return into the band fetches almost none:
        1 height tile against 30 without it in the hand-over smoke. The
        state's `relief.keptHeights` and `relief.heightRequests` (the
        synthetic heights' request count) and the Debug panel's "heights
        kept" line show it.
      - A drain keeps a carrier's coarsest tiles (depth 1) and the tiles its
        last update used, so the globe can fill at once when the view
        widens.
    - When the camera has stayed out of the band on one side for
      `bandReleaseMs` (default 5 s), the other carrier's tile cache is
      released (`/globe/globe-tile-cache.js`), not only left undrawn
      (review 2026-10-03-1835 major 4). The release disposes at most
      `bandDrainTiles` tiles a frame (default 8; `drainTileCache`) instead
      of the whole cache in one frame (one frame disposed 188 tiles,
      frame-hitch plan 2026-10-03-2017 H4); 0 restores the one-frame
      release for a before/after. A return to the band stops a drain and
      keeps the rest. `lastRelease` in the state gives each release's
      start, end, frames, largest per-frame count and dispose time.
      `lazyE=0` (read at start) keeps the tile library's whole-tree
      height-scale step instead of `createGlobeTerrain`'s deferred one
      (H1), also for a before/after on one preview. A return before then cancels it,
      so a zoom that wobbles over an edge never unloads, reloads and
      recompiles (frame-hitch review 2026-10-03-2017 H4). Each carrier
      keeps its last tile material alive (`/globe/globe-warm-material.js`),
      so its shader program survives the release, and the relief draws
      the imagery through its own overlay (`createGlobeImagery`), so a
      release of the globe's tiles never frees imagery the relief is
      composing.
    - Only a page with `relief=1` compiles the band into the globe's
      shader (`createGlobeSurface(loader, { band: true })`); the plain
      globe draws the program from before.
  - `detail` (0-1, default `GLOBE_ALBEDO.detail`, 0.5; 0 off):
    `globe-albedo`'s detail on the relief's tiles. At the pin's fix the
    page builds the terrain lab's 256 km region around the target
    (`globe-detail-region.js`, loaded with the relief only) and hands its
    grid of factors to the tiles; it applies at the next pin press.
  - `landKm` goes up to 5,000 km since F1, so a smoke can hold inside
    the band. `reliefHeights=synthetic` serves heights generated
    in the page (`../globe-terrain/synthetic-heights.js`; the smokes),
    otherwise the live Terrarium tiles, credited in the credits line.
  - Every frame the relief's exaggeration is `exaggerationAt` of the
    camera's altitude (`/globe/globe-flight.js`: 1 at globe scale, the
    near value `reliefNear` from 20 km down: default 1, true heights at
    every altitude since the owner's D-K1 (city plan 2026-10-05-0040
    §11); 3 was DEC-GL5-5, and `reliefNear=3` draws it, 2.2 at
    150 km), in steps of 0.1. `reliefGround` above 0 adds the
    third band (city plan 2026-10-05-0040 K1): E eases from the near value
    at 8 km to `reliefGround` (capped at the near value) at 2 km and
    below, so a city can stand on true heights (1); the dive's floor reads
    the same law, and so does the cloud shell (3 km x E), which then sinks
    with it.
  - The pin's dive is the oblique approach (`planDive`'s pitch law; the
    `pitchLow` key, 30-90, default 45; 90 flies the old straight-down
    dive), ending at `landKm` or the clearance rule's floor over the
    target (`minimumAltitudeM` of the ground under it, read from the
    plugin's height sampler, at the landing's exaggeration), whichever is
    higher.
  - The clearance every frame (review 2026-10-03-1835 major 1): wherever
    the relief draws, the camera is raised to the clearance over the drawn
    ground under it (`clearedAltitudeM` of the plugin's
    `sampleCartographicElevation`), whoever owns the camera.
  - Test hooks on `__globeLab`: `holdDiveAt(ms)` holds the camera at a
    dive time (null runs on) and `diveAltitudeAt(ms)` reads the dive's
    altitude without moving it (the moving-camera band smoke);
    `plantDetail(eastFactor)` plants a detail grid east of the target (the
    placement smoke).
  - `state()` adds `relief` (`{ heightScale, litTiles, visibleTiles,
heights, share, groundUnderCameraM, clearanceLifts, settled, stats,
cachedBytes, globeCachedBytes, releasedBytes, globeDrawn, reliefDrawn,
globeTiles, detail }` or null; `detail` is the region's state, with its
    height tiles and bytes once ready) and `cameraDepressionDeg`.
  - Not yet (the F2 plan 2026-10-03-1922): the re-oriented frame, the
    planes from the exaggerated relief, the atmosphere hand-over and the
    cloud slab's depth input; style C's neighbourhood terms later.
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
    instead of snapping), then held at the landing altitude.

- The city in the globe's scene (globe city plan 2026-10-05-0040 §12.5 C4,
  §14; `globe-city.js`, `globe-city-worker.js`): `city` (default 1, read at
  start; 0 turns it off) and `cityKm` (30). Once a place is known, the
  pin's located target or the link's `at=`, and its data is warmed (the
  prefetch's outcome is no longer null: the two share one store, so
  building during the warm-up would download the same tiles twice), the lab
  asks for the city there, once per place. It is built in a worker from the
  Osm library alone, drawn through `gps-plus-slam-osm/three` (loaded with
  the first city, so the boot graph stays free of the library), placed on
  `globe.group` through `ecefFromCityAt`, and faded in by
  `cityShareAt(altitude, cityKm)`: nothing at and above `cityKm`, all of it
  below two thirds of it, dithered between. It is off (fade 0, never asked
  for) while the relief near the ground is exaggerated (`reliefNear` above
  1, R14), and drawn only where the relief is drawn at true heights at the
  current altitude (with `reliefGround` the relief is exaggerated above
  2-8 km). A failed build is asked for again after 10 s, three times at
  most. The pin's landing message says "km above sea level" (the altitude
  is above the ellipsoid, not the ground). The scene-depth pass draws it with the relief, so the space pass
  and the cloud volume end at buildings too. `state().city` carries its
  phase, place, counts, ground height and fade. Test hooks:
  `__globeLab.cityProbe(max)` (the state, whether the root is drawn, and
  building vertices in ECEF metres), `__globeLab.cityExpected(lat, lng,
heightM)` (the ECEF point of a place, for an independent placement check)
  and `__globeLab.reliefHeightAt(lat, lng)` (the relief's own height there,
  from its sampler, for the vertical check).
- The arrival prefetch (round-5 plan 2026-10-01-0945 §3.6 step 1), wired
  into the pin:
  - at the fix, the lab loads `/osm/arrival-prefetch.js` (OsmDemo) with a
    literal dynamic `import()` and starts it for the target, so the
    city's Overpass tiles are warm when the globe's city builds (they were
    warmed for OsmDemo's page until the hand-over was removed, §12.5 C6;
    the city's z12 heights are not part of the plan, a filed finding). Its graph (the Osm library,
    about 1.1 MB of source, and H3, 0.55 MB) loads only then: the import
    map's `h3-js`, `gps-plus-slam-osm` and
    `gps-plus-slam-app-framework/osm-bridge` entries are unused at boot,
    and `build-lookdev.test.mjs` fails if the lab's static graph reaches
    them. Only `/globe/flight-pace.js` and `/globe/globe-arrival.js`
    (small, no dependencies) load at boot;
  - the dive's clock (`createDiveClock`): paced by the prefetch's
    progress (`stepPace`: the cold pace until the data is in, the whole
    path over at most the 30 s cap of DEC-GL5-6; about 8.6 s when the data
    is already stored), mapped onto `diveMs` so the dive keeps its easing.
    `diveMs` in the hash keeps the fixed dive as a manual override;
    `prefetch=0` turns the prefetch off (and the fixed dive with it). A
    module that does not load counts as done: nothing can be warmed, so
    the dive does not wait;
  - every way a flight stops (a press of the pin, a touch on the globe, a
    hidden page) aborts the prefetch;
  - the landing does not wait past the dive: the paced dive lands when
    the data is in or at the cap;
  - the status line `#globe-arrival-status` (left of the pin's own,
    hidden when idle, `aria-live="polite"`): the tiles warmed of the
    total, cold or warm, while it runs, then how it ended
    (`arrivalStatusText` in `/globe/globe-arrival.js`);
  - `__globeLab.state().pin.arrival`: `outcome`, `progress`, `counts`,
    `paced`, `rate` (the dive clock's, per ms) and `line`, for the
    smokes;
  - the smokes answer its network locally (`routeCityData` in
    `globe-smoke-helpers.mjs`: Overpass with an empty tile, DEM tiles
    with a few bytes), so no smoke sends a request to the Overpass
    servers or the DEM hosts; `globe-arrival.smoke.spec.mjs` checks the
    lazy load, the moving status line, the cold and warm pace, a quick
    warm second flight and the abort on a stop.
- The pin (round-2 plan M3g, DEC-FB2-2/3), bottom right as in OsmDemo (the
  design system's locate atom, `btn btn--locate`, with OsmDemo's pin
  glyph), with a status line to its left. Its phases and labels are
  `/globe/globe-pin.js`'s; the button carries them in `aria-label`,
  `title`, `aria-busy`, `disabled` and `data-state` (`locating`
  pulses; flying uses the engaged look):
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
    first 40 % and descends log-evenly over `diveMs` to `landKm` above
    the fix, the height taken along the camera's own direction, and a
    tilted start's offset fading out over the first fifth; a press of the
    pin, a touch on the globe, or the page being hidden (another tab, a
    locked phone: the flight would otherwise run on out of sight) stops it and leaves the camera to the
    controls; the replay button or a new target ends it too;
  - landed: the dive holds `landKm` up over the place, in the globe's own
    city, and the pin is idle again ("Arrived, 2 km up."). The page used
    to hand over to OsmDemo's city here (`handOverUrl`, the `handingOver`
    phase, a `pageshow` return); all of that was removed with the city in
    the scene (§12.5 C6, the owner's D-K3). `pin.diveTo(place)` flies the
    same dive to a given place (a `land=1` link).
  - After a failure the button keeps the failure's `data-state`
    (`denied`, `timeout`, `unavailable`: the locate atom's warning dot)
    until the next press.
  - Phase 1 has no GPS (DEC-PRG-10): the fix is always null. The target is
    chosen only while spinning, so a fix arriving after the fallback would
    be ignored; phase 6 (the real locate timeout) has to decide that.

- Test API, `window.__globeLab`: `ready`, `error`, `state()`
  (`{ models, tileErrors, cachedBytes, pendingTiles, loadedTiles, phase,
target, source, history, runs, spinMs, turnMs, centreLatLon, timeMs, clock,
cloudDrift, cloudLonOffsetRad, sky, device, deviceLine,
sunEcef, tuning, sunIntensity, fovY, pixelRatio, errorTarget,
bytesDownloaded, tileRequestsByLevel, rendererMemory, appliedHash, radiusM, activeSources,
loadingShown, loadingVisible, cacheBudgetBytes, cacheFloorBytes,
creditShorts, mapsLoaded, mapErrors, mapsTotal, refusedTiles, distance,
cameraOwner, cameraDistanceM, altitudeM, near, far, pin }`;
  `pin` is `{ phase, label, status, located, arrival }`;
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
  pyramid level, index = level, 0-5), `project(lat, lng)` (a
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
- The relief is the default since F2a (DEC-GL5-15); `relief=0` keeps the
  plain globe. The smokes that measure the plain globe pin it: the
  pre-round-4 look pin (`withPreRound4Look`) carries `relief=0`, and
  `bootGlobe` and every direct page load go through `plainGlobe(hash)`,
  which adds `relief=0` to a hash that names no relief.
- The cloud volume (volume-cloud plan 2026-10-05-0016, C2;
  `globe-cloud-volume.js`): `cloudVolume` 0 the shell only, 1 the volume
  within the disc and the shell outside it, 2 (default, the owner's choice
  of 2026-10-05) the volume over the shell; `cloudVolumeKm` (80; 20 until 2026-10-06) the disc, which the slab's reach follows,
  `cloudVolumeCeilingKm` (40) the ceiling it fades in under over
  `cloudVolumeFadeKm` (25); `cloudVolumeCover` (1, the owner 2026-10-06;
  0.5 before, chosen where the volume drew almost nothing) the gain on the
  map's cover. Each frame after the sky hand-over its share and disc are
  set and, in variant 1, the shell's hole matches the disc; after the Earth
  it draws the slab from the ground sky, ending at the relief's depth. The state's `cloudVolume` carries its share, disc, lift
  and drawn frames. `cloudShadowFrom` (C3) picks the ground's cloud shadow:
  0 the shell's soft one (the default, as before), 1 the volume's (the
  shell's then off). Measured at the 12 km hold: the shell's darkens by a
  mean 0.93 levels, the volume's by 0.07 in sparse patches up to 9.5, and
  the two patterns do not correlate (-0.03); whether the volume's shadow
  is placed right is not yet verified, and these numbers were taken where
  the volume drew almost nothing (at 46.5 N 9 E, gain 0.5, the same clear
  noise patch under every target), so they are to be measured again.
- The sky hand-over (F2 plan 2026-10-03-1922 F2b; `globe-ground-sky.js`):
  each frame, before the sky pass, the observer's height over the
  ellipsoid's image (`observerAltitudeKm`) feeds the ground sky
  (`groundSky=1`, the default; 0 keeps the space pass all the way down),
  which returns its weight (0 above `skyEdgeKm`, 80, to 1 at
  `skyEdgeKm - skyWidthKm`, 40 below) and the eased exposure, the sun's
  scale in the scene from `sunIntensity` (space) to the ground sky's
  automatic exposure; it IS the globe's sun intensity. The ground sky draws over
  the space sky's pixels before the Earth, the space pass's sky light is
  scaled by `1 - weight`, its veil over the ground is kept (`atmoGround=1`,
  the default; `atmoGround=0` fades it with the sky's, a comparison that
  breaks the hand-over's continuity), and below the edge its rays end at
  the drawn relief: the scene depth (`globe-scene-depth.js`, volume-cloud
  plan §17) is drawn once a frame while the weight is above 0 and the pass
  is on, and shared with the cloud volume, which draws it itself when only
  it needs it; the pass weighs it by the hand-over's weight, so it grows
  from nothing at the 80 km edge. Before, the rays ended at the ellipsoid and relief above
  its limb stood unveiled, a hard edge at the horizon. The halo's
  thickness eases from `atmoThickness` above 2,000 km to 1x below 300 km
  (`atmoRamp=1`, DEC-GL5-13; `shellThicknessAt`). The ground sky
  rebuilds in stages, one a frame, its observer quantised in
  `skyStepPct` (5 %) steps; it works only in the target's local frame.
  The state's `groundSky` carries its weight, exposure, quantised
  observer, rebuild counts and the observer's height it is fed from.
- The clip planes over the relief (F2a, M4): `reliefPlanes()` gives
  `clipPlanes` the distance to the nearest drawn ground (`reliefClearanceM`
  over the relief's sampler at the camera's ground point and on a ring of
  eight points as far out as the camera stands above it), and the highest
  real peak (8,850 m) times E, whoever owns the camera: after the
  intro places it and after the controls' own update. The controls' rays
  hit only the carrier drawing most of the frame (`pickFrom`, the
  library's `setScene`), not the cloud shell or the other carrier.
  `reliefPlanes=0` keeps the planes over the ellipsoid (the planes smoke's
  positive control), and `__globeLab.planeProbe({ jitterM, levels })`
  measures the held view: the pixels that change under a 1 mm camera move
  (z-fighting) and the clear colour in the frame's lower two thirds (a
  clipped ground).
- The world frame (F2 plan 2026-10-03-1922 F2a, M3; `/globe/globe-frame.js`):
  `globe.group` carries one matrix from ECEF to a local frame at the target
  (x east, y up, the origin on the ground), set at the pin's press and at
  load or replay with an `at=` target, the identity (ECEF) otherwise. The
  switch keeps the view (`setFrameTarget` re-applies the camera's ECEF
  pose) and releases the controls' drag state. Every camera write goes
  through `placeCameraEcef` (the intro's orbit pose, the dive, the
  clearance's radial lift, the recorder's placement) and every read
  through `ecefCamera` or the tiles' `worldToLocal` (the dive's start, the
  state's `cameraDistanceM`, `cameraDirection` and `cameraDepressionDeg`).
  Two test hooks were missed at first and caught by the full globe run
  (2026-10-05): `project(lat, lng)` now takes the ECEF point through the
  frame, and `celestialToEcef(v)` gives the smokes that turn a celestial
  direction into a latitude and longitude its ECEF form
  (`celestialToWorld` stays in the world, compared with the sky's own sun). The Earth's centre for the space sky
  and the far-side test is the group's world position. `worldFrame=0`
  keeps ECEF, for a before/after; the state's `worldFrame` is the frame's
  target, and `__globeLab.reframe(target)` switches it for
  `globe-frame.smoke.spec.mjs` (0.00 levels and 0 m across a switch at the
  hold). **The frame follows the user** (volume-cloud plan §14): while the
  controls own the camera, `recentreFrame` moves it under the camera
  once the camera's ground point is more than 20 km from its origin,
  below 150 km (`frameRecentreTarget`). A frame left on the link's target
  while the owner flew 244 km by hand stood 4.7 km off the curved ground
  there, and the cloud deck, flat in the frame, floated above the 11 km
  camera (2026-10-06); the volume's noise is anchored to the ground, so
  its clouds stay put across a move. It never moves under a gesture: a move releases
  the controls (ending a drag), so it waits while `controls.busy()` (a
  pointer down, a gesture state, or momentum left); the owner's drags died
  a second in on r785 before this guard.
- The Debug panel (round-6 plan 2026-10-04-1050 G6-0, DEC-G6-6;
  `globe-debug.js`): always there, a small button at the left edge. The
  page's event log (`globe-debug-log.js`, from the first line, so boot
  errors are in it) collects errors, three's console errors, band edges,
  the band share in 0.1 steps, releases and their end, and E steps. The
  frame's recorder hooks are fanned out (`hooks`) to the frame-hitch
  recorder and the panel. `liveState()` gives the panel the altitude, the
  distance to the target, the place under the camera, heading, pitch, E,
  the band share, both carriers' tiles and caches, and the GPU's program
  and texture counts. `__globeLab.debug` is the panel's smoke API. For the
  coming OSM work, the test places are `at=47.3769,8.5417` (Zürich) and
  `at=46.9480,7.4474` (Bern).
- The frame-hitch recorder (frame-hitch plan 2026-10-03-2017 §4, PERF-1;
  `globe-perf.js`): `perf=1` loads it with a dynamic import after the
  page is ready and shows its overlay; without it nothing of it is fetched
  and the frame calls no recorder hook. Its hash keys:
  - `perfStep` (1: the frame-stepped path), `perfSteps` (steps a decade,
    1-200, default 40), `perfSettleS` (a checkpoint's longest hold, 1-600,
    default 120), `perfSpeed` (decades a second for every run, 0.05-20;
    default each cell's), and the text keys `perfSweep`
    (`quick`, `full`, `overhead`; absent: one run) and `perfPlace`
    (`ocean`, `alps`, `pole`, `city`; default `alps`), and `perfDrive`
    (`controls` drives every run through the controls' wheel input;
    absent, each cell says).
  - The factors it varies, also hash keys that apply live:
    `adjustHeight` (the controls' height adjustment, its two raycasts a
    frame, default 1), `reliefCacheMiB` (the relief's cache cap, 8-4096,
    default 64; its floor keeps the same ratio), `parseJobs` (1-32,
    default 5) and `downloadsPerOrigin` (1-64, default 25), the relief's
    own queues.
  - While a path runs the recorder owns the camera (ahead of the fly-in,
    the dive and the controls); the first placement takes the camera as a
    press would. The frame marks band edges, frames inside the
    cross-fade, cache releases and E steps (the `heightScale` assignment
    timed, made only when E changes; an E held by the recorder replaces
    the altitude's).
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
    Cologne, Tokyo, (0, 179.9), (80, -40) and (-30, -165) (once the spin
    start's antipode; the spin now starts over the sub-solar point),
    reported across {0.01, 0.1, 0.25, 0.5}°;
  - with no `#at` and no granted permission: `waiting`, then `fallback`
    at once (before `spinMs`), arriving at Central Park; the replay button
    runs it again;
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
  intro with the near plane falling, and it lands about 2 km up and holds,
  the page never leaving; the dive at `landKm=50` lands within 500 m of
  50 km and 0.01° of the fix and the pin reads "Arrived, 50 km up"; a
  press on the globe during a 20 s dive stops it (controls own the
  camera); a press of the pin, a hidden page and a new `at` each stop a
  30 s flight, and no navigation to OsmDemo ever happens (one would be
  caught with a 204). The night hand-over test went with the hand-over.
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
