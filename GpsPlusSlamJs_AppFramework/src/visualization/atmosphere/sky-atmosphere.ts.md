# sky-atmosphere.ts

## Purpose

`SkyAtmosphere`: a physically based sky a three.js scene owns. One
atmosphere yields the visible sky, the image-based light
(`scene.environment`), the sun light's colour and intensity, the horizon
colour for `scene.fog`, and the auto-exposure, all on one scale.

## Public API

- `new SkyAtmosphere({ scene, renderer | device, visibilityKm = 60,
observerAltitudeKm = 0.2, sunIntensity = 1 })` — adds `sky` to the scene.
  Throws `SkyAtmosphereUnsupportedError` without float render targets (keep
  the fallback sky), `TypeError` without renderer or device, `RangeError` for
  a bad visibility.
- `setSun(direction)` — any non-zero finite vector toward the sun (+y up).
  First call renders all three LUTs; later calls only the sky view; an
  unchanged sun does nothing.
- `setVisibilityKm(km)` — rebuilds every LUT.
- `observerAltitudeKm` (getter) and `setObserverAltitudeKm(km)` (globe F2
  plan 2026-10-03-1922, F2b) — the observer's height in [0, 100) km;
  re-renders the sky view and re-bakes (the transmittance and
  multi-scattering tables cover every height), rescales (the sun-relative
  unit is the reference sun's transmittance from the observer); an
  unchanged height is free; synchronous like `setSun` unless staged;
  `RangeError` before any change. The haze follows through its `sync()`.
- `setCloudCoverage({ glsl, uniforms } | null)` and
  `setCloudDiscRadius(radiusM | null)` (globe volume-cloud plan
  2026-10-05-0016, C1): the slab's coverage map and disc around the camera
  (`cloud-slab.ts.md`), kept across modes and handed to a slab made later
  like the scene depth; the radius validated before it is kept.
- `setCloudDiscCentre({ x, z } | null)` (volume-cloud plan §15): the slab
  disc's centre in the world, or the camera (null, the default), kept
  across modes like the disc; validated before it is kept.
- `setCloudReach(reach | null)` (volume-cloud plan §13, R1): how far out
  the slab draws (`setCloudSlabReach`), kept across modes and handed to a
  slab made later like the disc; validated before it is kept; null the
  default.
- `setCloudSceneDepth(depth | null)` (F2c): the scene's depth for the slab,
  kept across modes and handed to a slab made later; the sheet and the
  dome ignore it; no GPU work (`cloud-slab.ts.md`).
- `rebuild: 'staged'` (constructor option; default `'immediate'`),
  `stepRebuild()` → `RebuildStage` and `rebuildPending` (getter) — for a
  page that renders every frame: setters only record the change, and
  `stepRebuild()` once a frame does at most ONE stage of a pass: `'luts'`
  (the tables), `'waiting'` (the asynchronous read not done yet), `'read'`
  (the horizon and the exposure), `'bake'` (into one reused target), or
  `'idle'`. Immediate mode is unchanged and its `stepRebuild()` is always
  `'idle'` (OsmDemo never calls it).
- `configure({ sunDirection?, visibilityKm?, cloudCover?, cloudMode?, cloudSlabSteps?, sunThroughClouds? })` — all at once,
  ONE rebuild or re-bake (a preset change); validates everything before
  changing anything. `setSun`, `setVisibilityKm` and `setClouds` delegate
  to it.
- `setExposureCompensation(ev)` — EV on top of the auto-exposure; no GPU work.
- `autoExposureAdaptation` (getter) and `setAutoExposureAdaptation(a)` — the
  auto-exposure's adaptation (default 0.75), recomputed at the last
  illuminance; no GPU work; `RangeError` outside [0, 1] before any change.
  The caller re-reads anything that copied the exposure (OsmDemo's rig does).
- `setClouds({ cover })` — 0…1, the share of sky clouded (a quantile
  threshold, `cloud-layer.ts`); re-bakes the environment only (the LUTs do
  not depend on clouds); unchanged cover is free. Cover does NOT dim the
  sun light itself (parked for the owner, plan §13); the cloud shadow patch
  ([`cloud-shadow.ts.md`](cloud-shadow.ts.md)) dims it per pixel in the lit
  materials instead (round-3 DEC-FB3-7).
- `cloudMode` (getter) and `configure({ cloudMode: 'dome' | 'sheet' | 'slab' })`: where the
  clouds are drawn. `'dome'` (the default) is the sky's own layer and adds
  nothing to the scene. `'sheet'` adds the fly-through sheet
  ([`cloud-sheet.ts.md`](cloud-sheet.ts.md)) to the owned scene and clears the
  VISIBLE sky's cloud threshold (its own uniform object), so there is one
  layer, not two. The environment bake keeps the real threshold in both
  modes, so reflections and the diffuse light do not change with the mode,
  and a mode change needs no re-bake. `dispose()` removes and frees the
  sheet. An unknown mode is a `RangeError` before anything changes.
  - `'slab'` adds the ray-marched volume instead
    ([`cloud-slab.ts.md`](cloud-slab.ts.md)), with the same uniforms and the
    same cleared visible threshold. A mode change removes the current cloud
    mesh before adding the next, so there is never more than one.
  - `configure({ cloudSlabSteps })` (8/16/24/32, default 16) is the slab's
    cost knob. It is validated first, kept across modes, applied to a live
    slab as a new program and to a later slab at creation. No re-bake.
- `configure({ sunThroughClouds: { discExponent?, aureole?, silverLining? } })`
  and the getter `sunThroughClouds` (round-3 plan 2026-09-27-0532,
  DEC-FB3-6, [`cloud-sun.ts.md`](cloud-sun.ts.md)), one knob per effect
  (the owner's requirement): the disc behind a cloud keeps T^k of itself
  (`discExponent` k); thin cloud glows a few degrees around the sun
  (`aureole`, the narrow lobe's strength) and thin backlit edges brighten
  further out (`silverLining`, the broad lobe's), on the dome and the
  slab. All 0 (OFF) by default, so no app's sky changes unasked; the
  look-dev page uses 4, 1 and 1. A field not given keeps its value; each
  must be finite and ≥ 0, and an unknown key (a misspelling, the first
  cut's `forward`) is refused (`RangeError` before any change). No knob
  re-bakes: the bake has no disc, and its own lobes are zero, so the glow
  never reaches the scene's image-based light (in the bake it had lit the
  ground +17 levels at noon; round-3 review, finding 4). The other
  uniforms are shared with the bake, the sheet and the slab.
  The disc reads the REAL threshold in every mode (`atmCloudSunThreshold`,
  the same object as the bake's) and the visible sky's own
  `atmCloudAnchored` (0 in dome mode, 1 in sheet and slab mode; the bake
  keeps 0).
- `cloudTransmittanceToward([x, y, z], viewer = point)`: the share of the
  sun reaching a world point through the clouds the sky draws for a camera
  at `viewer`: the column model on the CPU
  (`cloudColumnTransmittanceToward` on the live noise texture's data, the
  real threshold and the drift, weighted by the mode's far fade or horizon
  fade and the aerial melt, as the cloud shadows are); 1 before the first
  sun and in a clear sky; `RangeError` for a non-finite point or viewer. The look-dev page's "sun light dims" switch uses it.
- `cloudUniforms` (getter): the noise texture, the real threshold, the
  drift offset, the visible sky's anchor (0 dome, 1 sheet and slab) and
  the far fade, as the uniform objects themselves, for the cloud shadow
  patch ([`cloud-shadow.ts.md`](cloud-shadow.ts.md)).
- `advanceClouds(seconds, windKmPerSecond = 0.012)` — drift; no GPU work;
  both arguments validated (finite, seconds ≥ 0).
- `applySunLight(light)` — colour (chroma) and intensity
  (`sunIntensity × exposure × model intensity`).
- `horizonColour()` — the sky at the drawn horizon (dir.y =
  `horizonClampDirY`, where the sky and the haze clamp), azimuth-averaged,
  in scene units (for `scene.fog`).
- Getters: `sky`, `visibilityKm`, `exposure`, `radianceToScene`,
  `sharedUniforms`, `skyReadbackFailed` (the driver refused the sky-view
  readback: horizon colour stale, sky illuminance from the CPU estimate).
- `readLutTexel(lut, x, y)` — for the look-dev parity check.
- `dispose()` — frees everything, clears `scene.environment` if it is still
  ours, restores the `environmentIntensity` it found, removes the sky.
- Options are validated BEFORE a device is built or kept: visibility,
  `observerAltitudeKm` in [0, 100), `sunIntensity` positive; a throw
  disposes a caller-supplied device.

## Invariants & assumptions

- **The staged rebuild** (F2b): a pass is the tables, then the read, then
  the bake, one per `stepRebuild()`. A change during a pass is recorded and
  applied by ONE further pass after it (the medium flag ORs), so a change
  every frame delays the sky by at most two passes and never starves the
  bake. A context restore abandons the pass in flight (its read cancelled)
  and records a full one; `dispose()` cancels a read in flight. Staged and
  immediate measure the same sky identically (a test compares them).
- One scale: `radianceToScene = sunIntensity × exposure / (T_ref × 1000)`.
- Exposure = auto-exposure (partial adaptation, `atmosphere-exposure.ts`)
  × 2^compensation. It scales natural light only; `renderer.toneMapping` and
  `toneMappingExposure` are the caller's and untouched, so emissive materials
  (OsmDemo's heat grid) keep their grading.
- The environment is baked WITHOUT exposure (its own scale uniform) and
  WITHOUT the sun disc; `scene.environmentIntensity` applies exposure once.
  The first draft baked exposure in as well, which squared it on every lit
  surface; a test pins the fix.
- **The bake carries `ENVIRONMENT_BAKE_GAIN` (1024) and neither the
  exposure nor `sunIntensity`**; `environmentIntensity` is
  `sunIntensity × exposure ÷ gain`, so the gain's half-float window holds for
  any intensity (M3 review finding 7) and a lit surface receives bake ×
  intensity = `radianceToScene`. **The environment texture is therefore in
  gain units**: three applies `environmentIntensity` only to Standard,
  Lambert and Phong materials with no `envMap` of their own, so a consumer
  that uses the texture directly (a `material.envMap`, a `scene.background`)
  would render it 1024× too bright. No such consumer exists today (real-sun plan 2026-09-23-2149, review finding 6):
  exposure-free twilight values (6.8e-6 at −6°) sit below the smallest
  normal half float (6.1e-5), which a GPU may flush to zero in the
  half-float cube. Measured headroom: 113× above that at −6°, 52× below
  `ATMOSPHERE_MAX_SCENE_RADIANCE` for the glow next to a 10° sun; any gain
  from ~36 to ~53 000 passes both.
- **A failed sky-view readback** takes the sky illuminance from
  `skyIlluminanceCpu` (the fallback sky's estimate) for a sun no lower than
  −6°, so the exposure is right at every sun down to civil dusk and held at
  the civil-dusk value below it. It replaced one illuminance floor that gave
  every set sun the same exposure (review finding 7). Bounded: the
  exposure at −6° and below is about π·(1/5.3e-5)^0.75 ≈ 5000 (the old
  floor's 560 left civil dusk ~3 EV dark). The estimate's Ψ grid is built
  once per air (`psiLookupFor`), so a call costs ~5 ms, not ~23.
- Generate-then-dispose for the environment, so a throw leaves the previous
  map in place.
- Every material shares the same uniform objects (spread, never cloned).
  `AtmosphereHaze` does NOT share them: it copies them in `sync`, so a
  disposed and rebuilt atmosphere never leaves patched materials stale.
- The visible sky clamps its LUT lookup just above the horizon
  (`atmHorizonClampedDir`, the same clamp the haze uses); the environment
  bake does not, so the ground's bounce stays in the IBL.
- Context restore rebuilds everything.
- `scene.background` is not touched; the sky mesh (render order −1e6,
  depthWrite false, never culled) replaces it.

## Examples

```ts
const atmosphere = new SkyAtmosphere({ renderer, scene, sunIntensity: 1.1 });
atmosphere.setSun(sunDirection({ elevationRad, azimuthRad }));
atmosphere.applySunLight(sunLight);
scene.fog = new THREE.Fog(atmosphere.horizonColour(), near, far);
```

## Tests

`sky-atmosphere.test.ts` (fake device): refusal without float targets, GPU
work only on change, dispose-then-replace, exposure compensation without GPU
work, exposure-free bake, the bake gain against both half-float ends (CPU
sky at −6° to −3°, single-scattering glow next to a 2° to 90° sun), a failed
readback exposed from the CPU estimate (−1°, −3°, −6°, held below),
auto-exposure response, sun light, horizon colour,
context restore, sky mesh flags, disposal; the observer's setter (sky view
only, the rescale, free when unchanged, refusals); the staged rebuild (one
stage per step, the same exposure as immediate, the reused target, a change
in flight, the medium, a device without the optional calls, a failed read,
context restore, dispose, the immediate default untouched).
