# `atmosphere-rig.ts`

## Purpose

The desktop view's physical sky and everything that must agree with it: the
visible sky, the environment light, the sun light, the fog colour and the
distance haze, from the framework's `SkyAtmosphere` and `AtmosphereHaze`
(plan `GpsPlusSlamJs_Docs/docs/2026-09-23-0048-3d-sky-atmosphere-lookdev-plan.md`,
M3). It replaced `sky-rig.ts` (three's Preetham `Sky` into a PMREM), which
blacked out every standard material above ~20° of sun and had a constant fog
colour that matched the sky at one time of day.

## Public API

- `class AtmosphereRig` — `new AtmosphereRig({ renderer, scene, sun, createSky? })`.
  - `setSun(angles)` → the unit direction toward the sun. Points the sky,
    applies the sky's sun light to `sun`, sets `scene.fog.color` to the
    sky's horizon, syncs the haze. The caller places its light along the
    returned vector.
  - `setExposure({ ev, adaptation })` — the light dialog's exposure (plan
    2026-09-24-2140): sets the sky's EV compensation and auto-exposure
    adaptation and re-derives every copy of its exposure (the sun light, the
    fog colour, the haze), which a change on the sky alone left stale until
    the sun moved; on the fallback it re-derives the fallback's lights.
    Validated before any change (`RangeError`).
  - `setHaze({ visibilityKm, startRatio })` and the `hazeStartRatio` and
    `hazeVisibilityKm` getters (the latter the visibility the sky was last
    configured with, which the perf log compares to tell a step that rebuilt
    every table): the light dialog's haze. The visibility is the air's, so it goes
    to the SKY (`configure({ visibilityKm })` rebuilds its tables) and the
    haze on the city re-reads it in the sync; the city therefore fades
    toward a sky drawn for the same air. An unchanged visibility touches
    nothing (every dialog change re-applies every setting). On the fallback
    it re-derives the fallback's colours. The start is only held here;
    `building-view.ts` writes `fog.near = startRatio x fog.far` from it.
    Validated before any change: a visibility that is not a positive finite
    number, or a start outside [0, 1), is a `RangeError`.
  - `setSkyBalance(gain | null)`: the light dialog's sky balance
    (`sky-balance.ts`), handed to the visible sky (`SkyAtmosphere.setSkyBalance`,
    which re-bakes so the surfaces' sky light takes the cast) and to the
    haze (`AtmosphereHaze.setSkyBalance`), so the distance fades toward the
    balanced sky. The fallback dome has no radiance to balance; there only
    the unused haze uniform changes. A gain the framework refuses changes
    nothing (the haze validates first). The stock `scene.fog` colour stays
    unbalanced, as with `setHazeVeil`.
  - `setHazeVeil(veil | null)`: the light dialog's haze veil
    (`haze-veil.ts`), the colour a fully hazed distance SHOWS, in place of
    the sky's colour in that direction. The haze gets
    `veilSceneColour(veil, TONE_MAPPING_EXPOSURE)`, the scene colour the
    renderer's tone mapping turns into the veil; `null` gives the sky's
    colour back, bit for bit (the shader's mix weight is 0). Uniforms only:
    the sky is not rebuilt or re-read, and on the physical path the scene
    fog (whose colour only the stock fog uses, and which AR swaps for its
    own) is left alone. The veil survives `setSun`, `setExposure` and
    `setHaze`. On the fallback, whose haze is three's stock fog blending
    after tone mapping, the veil's display colour IS the fog colour, and
    `null` gives the fog back to the fallback's horizon. Validated before
    any change (`RangeError` from `veilSceneColour`).
    - **The veil reaches up the sky by `riseDeg`.** Geometry alone fading
      toward a bright veil left a hard step against the darker sky at the
      horizon (measured about 14 L* at veil 72). So the rig also passes the
      veil to the visible sky (`SkyAtmosphere.setHorizonVeil(colour,
riseDeg)`): full at and below the horizon, falling off over a few
      degrees above it (`horizon-veil.ts` in the framework). The sky model
      itself is unchanged; higher up the sky keeps its own colour. A veil
      without `riseDeg` (or 0) leaves the sky as it was.
    - **The ground's rim fades into the veil too.** The ground plane is
      finite, and with the draw distance past its edge its rim showed as a
      floating tile against the void. `setGroundRim(centre, extentM)`
      (called by `building-view.ts` wherever the plane moves) gives the
      haze a radial fade around the plane's centre, from
      `HAZE_RIM_INNER_RATIO` (0.6) of its extent to the edge
      (`AtmosphereHaze.setRim`). It is on only while a veil is set: without
      one the rim would fade into the sky's own colour, which is not what
      the look without a veil showed before. Validated before any change.
  - `HAZE_VISIBILITY_KM` (45) and `HAZE_START_RATIO` (0.66): the shipped
    haze, and the light dialog's defaults.
  - **What the two values are, in the haze's own terms.** The haze on a
    material is `keep = exp(-sigma d) x (1 - smoothstep(near, far, d))`
    (`atmosphere-haze.ts`). The visibility sets `sigma`, the physical term,
    which acts from the camera on at every distance; the start sets `near`,
    the boundary fade that makes the haze complete at the far plane. So
    "haze inside the city" is mostly the visibility; the start adds an
    artificial ramp on top.
  - `prepareFrame(camera)` — call before every render: hazes materials built
    since the last frame (and would heal one whose `onBeforeCompile` a later
    installer re-assigned); in the fallback, keeps the sky dome on the
    camera.
  - `haze` — the `AtmosphereHaze`, for `applyArEnvironment` to put on stock
    fog during an AR session.
  - `usingFallback` — true on a device without float render targets.
  - `dispose()` — the sky, the haze's texture, the fallback's dome and light.
- `TONE_MAPPING` (Khronos Neutral) and `TONE_MAPPING_EXPOSURE` (0.5 / 0.6)
  — the demo's grade, desktop and AR (see Grading).
- `NATURAL_LIGHT_COMPENSATION_EV` (−3.15) — the sky's EV on top of its
  auto-exposure, for natural light only (see Grading).
- `NATURAL_LIGHT_ADAPTATION` (0.83) — OsmDemo's auto-exposure adaptation,
  handed to the sky at construction (the framework's default is 0.75) and
  used by the fallback. It acts almost only below the reference light, so
  it sets how dark dawn, dusk and twilight get.
- `BUILDING_SKY_LIGHT` (3) — the sky light on the buildings, the default
  of the light dialog's slider (`applyBuildingSkyLight`). The owner's pick
  was 1.4 (DEC-LIGHT-9); r1158 raised it to 3 when the building chunks
  moved to linear colours (`linearChunkColours`, r1135), which had darkened
  the lit city below the June-noon floor (48.8 against 61.47). The owner
  chose to keep the conversion and raise the light (2026-11-09). The sky
  light, not the EV, because it reaches only the buildings: at 3 every
  heat-grid margin is unchanged (lowest 6.07, June noon) and June noon reads
  65.3; the EV cleared the floor first at −2.65 (64.3) with the June-noon
  margin down to 5.43 and the twilight about a third brighter. The full
  sweep (1.4 / 2 / 2.5 / 3 and EV −2.9 / −2.65 / −2.4 at ten sun points)
  is in the constant's doc comment.
- **The CPU fallback sky gets the same EV**, but its dome and fog are not
  tone-mapped (by earlier design), while geometry goes through Neutral: on
  a device without float targets the dome now outshines the lit city more
  than it did under ACES (M3 review finding 5; the e2e runs on the physical
  sky only, so this is unmeasured).
- `SkyLike` — the part of `SkyAtmosphere` the rig uses (the test seam).
- `NIGHT_FLOOR` ({ intensity 0.15, colour 0x9fb4d8, fromDeg -6, fullDeg -12 };
  0.15 is a recommendation pending the owner's pick, the r1155 sweep 0 to
  0.3 is in the source comment),
  `NIGHT_FLOOR_NAME` ("night-floor") and `nightFloorWeight(elevationRad)` -
  the night floor (r1155, owner 2026-11-08 "Nachts Grundhelligkeit"): one cool
  `AmbientLight` the rig adds to the scene in BOTH paths, at intensity
  `NIGHT_FLOOR.intensity x nightFloorWeight`. The weight is exactly 0 at and
  above -6 deg (so no day or twilight look the DEC-R4-5 sweep approved
  changes), linear to 1 at -12 deg, 1 below; `RangeError` for a non-finite
  elevation. A fixed display-level light: the light dialog's exposure does not
  scale it (the sky puts its exposure into `environmentIntensity` and the sun
  light, not into the renderer). OsmDemo only: the framework's `SkyAtmosphere`
  and `fallbackSky` are untouched, and AR imports only the tone mapping from
  this file. `dispose()` removes it.

## Invariants & assumptions

- **Grading (since plan 2026-09-23-2149 M3).** `TONE_MAPPING` is Khronos
  Neutral and `TONE_MAPPING_EXPOSURE` 0.5 / 0.6, shared with AR
  (`ar-scene-environment.ts` imports both; DEC-SUN-9/11), the exposure
  cancelling ACES's missing ÷0.6 so the heat grid keeps its brightness
  (DEC-SUN-12; the value entering the curve, not the look: Neutral renders
  mids and highlights brighter than ACES did). **Since 2026-09-25 the
  owner's pick from the light dialog** (plan 2026-09-24-2140 §13-§15,
  DEC-LIGHT-9/10): −3.15 EV with adaptation 0.83, sky light 1.4 (3 since
  r1158, see `BUILDING_SKY_LIGHT`) and the
  noon gain ×1.8, measured together at every DEC-R4-5 sun point (lowest
  margin 6.08; the 3.6° morning 17.6 against its lit-city floor of 16.8).
  Before that the sky's natural light got **−2.75 EV**, bounded from both
  sides: the heat grid's margin (June noon
  5.70, 114 % of the bound; −2 fails at 4.93) and the LIT CITY, which a
  darker EV blacks out (−4.5 reached a 158 % margin with near-black
  buildings, plan §10.1). The e2e sweep asserts both at seven sun points;
  the tables are on the constant. DEC-SUN-10's 150 % margin is open for the
  owner. (The look-dev page reproduces the grade with tone "neutral" and
  about −3 EV of exposure: 2^−2.75 × 0.5 / 0.6 = 2^−3.01.)
- **Grading under ACES (until M3), kept as history.** The heat grid and
  beacons were graded under ACES at 0.5, so the tone mapping was untouched.
  The sky's natural light (sky, sun, environment) got −2 EV, putting the
  backdrop 3 EV below the look-dev page's photographic grading, because
  this is a DATA view: DEC-R4-5 keeps the heat ramp the loudest thing on
  screen. MEASURED with the e2e margin
  (chroma the heat grid adds; bound 5) at time of day 0.0217, 0.98 (the boot
  time), 0.1467, 0.2717 and 0.5217 (3.7° to 55° of sun): −2 EV 7.78 … 8.84
  (mean luma 64…72 of 255); −1.5 EV 5.70 … 7.21 (luma 72…82); −1 EV fails
  at noon (2.5); 0 EV −0.1 at 0.0217; +1 EV (the page's look) −4.0 … −9.2.
  (The page shows OsmDemo's grading with tone "aces" and −3 EV of
  exposure: 0.5 × 2⁻² = 2⁻³.) The auto-exposure lifts
  every surface to mid-grey, and absolute chroma grows with brightness, so a
  photographic backdrop out-shouts the data. Brighter emissive cells made it
  worse (they wash out in ACES's shoulder), and matte cells changed nothing.
  The exact EV is the owner's taste call within what the bound allows.
- **The noon brightening** (plan 2026-09-24-0901): `NOON_SURFACE_GAIN` and
  `surfaceGainAt(elevationRad, ramp?)` give the building and road colour factor
  (the ramp defaults to `NOON_SURFACE_GAIN`; the light dialog passes its own,
  `light-settings.ts`; a ramp that does not rise throws), 1
  up to an 18° sun, linear to ×1.8 at 40°, constant above (DEC-LIGHT-9;
  ×1.45 from 20° to 45° under −2.75 EV before); applied by
  `BuildingView` through `mesh-layers.ts`'s `applySurfaceGain`. Those surfaces
  are nearly grey, so the lift adds brightness without competing colour:
  measured at the June noon, lit surfaces 48.1 → 64.8 (the approved look's
  64.7) with the DEC-R4-5 margin unchanged at 5.50; the September noon
  56.9 → 71.6. An exposure lift to the same brightness broke the bound.
- **Clouds at `CLOUD_COVER` 0.25** (the look-dev golden preset), turned on
  after the owner's first look at the r718 preview read the cloudless sky as
  "the old sky" (plan 2026-09-24-0706). Measured with them on, the lit city
  at a low sun sits close to its e2e floor: 17.6 against 16.8 at the 3.6°
  morning, 24.0 against 21.3 at the golden hour (without clouds 23.3 and
  32.0); the heat-grid margin at the June noon is 5.49 (bound 5).
- **Visibility 45 km** (the middle of the look-dev presets): ~80 % of the
  light survives to the 2400 m far plane. A taste value.
- **Sun intensity 1.1** at the model's reference elevation: the demo's old
  white-light value, so the key light keeps its scale at mid-day.
- **The fog colour follows the sky** at every sun change. The fog itself is
  created by `BuildingView` (it owns near/far); it also enables the haze in
  three's shaders, and its near/far are where the haze completes.
- **The haze is re-applied before every render** (`prepareFrame`), because
  materials are rebuilt constantly (buildings, cells, routes). The ground
  installers run in `BuildingView`'s constructor, before the first frame, and
  the cell emissive patches a brand-new material, so every installer today
  runs BEFORE the haze; the framework's self-healing (for a later
  assignment) and its idempotent hook (for a later CHAINING installer) are
  guards for the next one. An unchanged material costs a WeakMap lookup.
- **Only `SkyAtmosphereUnsupportedError` selects the fallback.** Any other
  construction error is a defect and propagates.
- **The fallback** (`fallbackSky`, CPU): a vertex-coloured dome (horizon at
  and below the horizon, easing to the zenith; tone-mapped like the scene,
  drawn first, depth test off, never culled), a `HemisphereLight` (zenith
  over lit ground, intensity π because the colours are radiances), the same
  sun light and fog colour. The haze stays on three's stock fog there (no
  LUT). ~20 ms per sun change on a desktop.
- The sky's own cost per sun change: one sky-view LUT pass, a readback and an
  environment bake. Affordable because the time of day is a deliberate
  control, never a drag.

## Examples

```ts
const atmosphere = new AtmosphereRig({ renderer, scene, sun });
const direction = atmosphere.setSun({ elevationRad, azimuthRad }); // from sun-clock.ts
sun.position.set(direction.x, direction.y, direction.z).multiplyScalar(1000);
// every frame:
atmosphere.prepareFrame(camera);
renderer.render(scene, camera);
```

## Tests

- `atmosphere-rig.test.ts` (stub sky; the fallback runs the real CPU model):
  one sun vector for sky and caller, the fog colour following the horizon at
  every sun change, the sun light from the model, the EV contract, the haze
  synced, late materials hazed and replaced hooks healed, disposal; the
  fallback's dome, hemisphere light, fog and sun, the dome on the camera, its
  clean-up, and that other errors are not swallowed. `setHaze`: the sky is
  built at today's visibility and the start is today's until set; the sky's
  visibility and the haze's extinction move together; an unchanged
  visibility does not reconfigure the sky; bad values change nothing; the
  fallback's horizon follows the visibility. The veil up the sky and the
  rim: the sky gets the veil and its rise, the rim follows the ground and
  is on only while a veil is set, bad rims are refused. `setHazeVeil`: none by
  default; the haze gets the veil's scene colour while the sky and the
  fog are untouched; it survives a sun move and an exposure change; the
  fallback's fog takes the veil's display colour and returns to the
  horizon on `null`; a veil it cannot show changes nothing.
  `setSkyBalance`: the same gain reaches the sky and the haze, `null` takes
  it off both, the fallback accepts it, a bad gain changes nothing.
- The night floor (same file): off by day and at -2.9 deg, full at -30 deg,
  cool, one light, untouched by an exposure change, the same in the fallback,
  removed on dispose. `atmosphere-rig.property.test.ts`: the weight is in
  [0, 1], exactly 0 above the ramp and 1 below it, and never rises with the
  sun.
- Pixels: OsmDemo's e2e suite (every lit-geometry and heat-ramp check runs
  under this sky); the sky's shaders themselves are checked by the look-dev
  smoke (`GpsPlusSlamJs_DesignSystem/3d/lookdev.smoke.spec.mjs` (removed; in git history)).

## The time-of-day blend: `setLight` and `setVeilBlend`

- `setVeilBlend(veil: VeilBlend | null)` - draws a premultiplied veil
  (`veil-blend.ts`) with its strength: the haze, the sky's horizon veil and the
  rim all take the strength, and the fallback fog is
  `horizon * (1 - strength) + display`. `setHazeVeil(veil)` is this at
  strength 1.
- `setLight({exposure, haze, veil, skyBalance}, sun?)` - one combined light
  update: every value is validated first (exposure, haze, the veil's strength
  in [0, 1] and its colour finite and >= 0; a `RangeError` changes nothing),
  then the haze, the exposure and the veil are applied with ONE
  `sky.configure` (visibility only when it changed, plus the sky balance)
  and ONE re-sync, so a blend step costs one sky rebuild and one bake, not
  one per field.
- WITH `sun` (`SunAngles`) it is the whole sun step: the sun direction rides
  the same `configure` and the night floor follows the elevation, so moving
  the sun and the light together costs one rebuild and one bake, never a
  light update plus a `setSun` (measured on the phone at about 17 + 31 ms
  each). It returns the unit direction toward the sun, as `setSun` does,
  undefined without a sun. Angles rather than a bare direction because the
  night floor needs the elevation.
- Tests: `atmosphere-rig.test.ts`, "AtmosphereRig.setVeilBlend",
  "AtmosphereRig.setLight" (one configure, one sync, an unchanged visibility
  not sent, refusals before any change) and "AtmosphereRig.setLight with a
  sun" (one configure and one sync per sun step, the night floor, the
  fallback re-derived from the new sun).
