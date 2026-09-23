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
- `configure({ sunDirection?, visibilityKm?, cloudCover? })` — all at once,
  ONE rebuild or re-bake (a preset change); validates everything before
  changing anything. `setSun`, `setVisibilityKm` and `setClouds` delegate
  to it.
- `setExposureCompensation(ev)` — EV on top of the auto-exposure; no GPU work.
- `setClouds({ cover })` — 0…1, the share of sky clouded (a quantile
  threshold, `cloud-layer.ts`); re-bakes the environment only (the LUTs do
  not depend on clouds); unchanged cover is free. Cover does NOT dim the
  sun light (parked for the owner, plan §13).
- `advanceClouds(seconds, windKmPerSecond = 0.012)` — drift; no GPU work;
  both arguments validated (finite, seconds ≥ 0).
- `applySunLight(light)` — colour (chroma) and intensity
  (`sunIntensity × exposure × model intensity`).
- `horizonColour()` — the sky at the drawn horizon (dir.y =
  `horizonClampDirY`, where the sky and the haze clamp), azimuth-averaged,
  in scene units (for `scene.fog`).
- Getters: `sky`, `visibilityKm`, `exposure`, `radianceToScene`,
  `sharedUniforms`, `skyReadbackFailed` (the driver refused the sky-view
  readback: horizon colour stale, exposure floored at ~civil twilight).
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
work, exposure-free bake, auto-exposure response, sun light, horizon colour,
context restore, sky mesh flags, disposal.
