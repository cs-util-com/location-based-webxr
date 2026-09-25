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
- `BUILDING_SKY_LIGHT` (1.4) — the sky light on the buildings, the default
  of the light dialog's slider (`applyBuildingSkyLight`).
- **The CPU fallback sky gets the same EV**, but its dome and fog are not
  tone-mapped (by earlier design), while geometry goes through Neutral: on
  a device without float targets the dome now outshines the lit city more
  than it did under ACES (M3 review finding 5; the e2e runs on the physical
  sky only, so this is unmeasured).
- `SkyLike` — the part of `SkyAtmosphere` the rig uses (the test seam).

## Invariants & assumptions

- **Grading (since plan 2026-09-23-2149 M3).** `TONE_MAPPING` is Khronos
  Neutral and `TONE_MAPPING_EXPOSURE` 0.5 / 0.6, shared with AR
  (`ar-scene-environment.ts` imports both; DEC-SUN-9/11), the exposure
  cancelling ACES's missing ÷0.6 so the heat grid keeps its brightness
  (DEC-SUN-12; the value entering the curve, not the look: Neutral renders
  mids and highlights brighter than ACES did). **Since 2026-09-25 the
  owner's pick from the light dialog** (plan 2026-09-24-2140 §13-§15,
  DEC-LIGHT-9/10): −3.15 EV with adaptation 0.83, sky light 1.4 and the
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
  clean-up, and that other errors are not swallowed.
- Pixels: OsmDemo's e2e suite (every lit-geometry and heat-ramp check runs
  under this sky); the sky's shaders themselves are checked by the look-dev
  smoke (`GpsPlusSlamJs_DesignSystem/3d/lookdev.smoke.spec.mjs`).
