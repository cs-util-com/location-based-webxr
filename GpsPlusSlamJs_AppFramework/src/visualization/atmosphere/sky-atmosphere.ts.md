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
- `configure({ sunDirection?, visibilityKm?, cloudCover?, cloudMode?, cloudSlabSteps? })` — all at once,
  ONE rebuild or re-bake (a preset change); validates everything before
  changing anything. `setSun`, `setVisibilityKm` and `setClouds` delegate
  to it.
- `setExposureCompensation(ev)` — EV on top of the auto-exposure; no GPU work.
- `setClouds({ cover })` — 0…1, the share of sky clouded (a quantile
  threshold, `cloud-layer.ts`); re-bakes the environment only (the LUTs do
  not depend on clouds); unchanged cover is free. Cover does NOT dim the
  sun light (parked for the owner, plan §13).
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
context restore, sky mesh flags, disposal.
