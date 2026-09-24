# atmosphere-fallback.ts

## Purpose

The CPU fallback sky (plan M3): what a device WITHOUT float render targets
gets instead of `SkyAtmosphere`. Flat colours (zenith, horizon, lit ground),
the sun light and the exposure, from the same physical model and on the same
scale, so a caller can paint `scene.background`, `scene.fog.color` and a
`HemisphereLight` that agree with what the full sky would have shown.

## Public API

- `psiLookupFor(params)` — the coarse multiple-scattering (Ψ) lookup for an
  air (visibility, observer altitude), built once and memoised (eight airs
  at most): it is ~19 of the ~23 ms a `skyIlluminanceCpu` call cost, and
  `SkyAtmosphere` calls the estimate on every sun change while a driver
  refuses its sky readback. `skyIlluminanceCpu` and `fallbackSky` use it.

- `fallbackSky(sunDirection, options)` → `FallbackSky`
  - `sunDirection`: toward the sun, +y up, any non-zero finite length.
  - `options`: `visibilityKm`, `observerAltitudeKm?`, `sunIntensity?`
    (default 1, the light's intensity at the reference elevation, as in
    `SkyAtmosphere`), `exposureCompensationEv?` (default 0).
  - Returns `zenith`, `horizon`, `ground` (scene-linear RGB), `sun`
    (`colour` chroma and `intensity` in scene units), `exposure`.
  - Throws `RangeError` for a zero or non-finite direction, a non-positive
    visibility, a non-positive `sunIntensity`, a non-finite compensation.
- `skyIlluminanceCpu(sunCosZenith, params, quadrature?, psi?)` → the
  horizontal sky illuminance in sun-relative units (the auto-exposure's
  input), by quadrature over the upper hemisphere. Exported for its test
  and for the look-dev parity check.

## Invariants & assumptions

- ONE SCALE with `SkyAtmosphere`: colours are relative radiance
  (radiance ÷ luminance of the reference-elevation transmittance) ×
  `sunIntensity` × exposure; exposure = `autoExposure(sky + direct)` ×
  2^EV, the same function and input `SkyAtmosphere.measure` uses.
- The horizon is sampled at `EARTH_ATMOSPHERE.horizonClampDirY`, the height
  the visible sky, the haze and `SkyAtmosphere.horizonColour()` all use.
- Cost: 18...26 ms per call on a desktop (Node, 2026-09-23). Ψ is computed
  lazily on an 8 (altitude, quadratic) × 128 (sun cosine) grid with 4 × 4
  directions and 10 steps, nearest neighbour. 16 cosine bins were too coarse
  across the terminator (dawn horizon blue 1.6× the GPU's). Call it when the
  sun moves, never per frame.
- Below the horizon everything stays finite; the auto-exposure's floor
  bounds the exposure.

## Examples

```ts
const sky = fallbackSky(sunDirection, { visibilityKm: 60, sunIntensity: 1.1 });
scene.background = new THREE.Color(...sky.zenith);
scene.fog = new THREE.Fog(new THREE.Color(...sky.horizon), near, far);
hemisphere.color.setRGB(...sky.zenith);
hemisphere.groundColor.setRGB(...sky.ground);
sunLight.color.setRGB(...sky.sun.colour);
sunLight.intensity = sky.sun.intensity;
```

## Tests

- `atmosphere-fallback.test.ts`:
  - a blue zenith and a paler horizon at noon, and a warmer horizon at golden
    hour;
  - exposure from the horizontal illuminance, like `SkyAtmosphere`;
  - linear scaling with `sunIntensity` and EV;
  - finite values at night;
  - validation;
  - the cheap quadrature within 10 % of a 24 × 24 one at 58°, 20°, 5° and
    −4°.
- GPU oracle: the look-dev smoke compares `fallbackSky` with `SkyAtmosphere`
  per preset (all five): exposure within 10 %, horizon within 20 % per
  channel. Measured worst: 6.3 % and 13.2 %.
