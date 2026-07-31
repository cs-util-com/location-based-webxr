# `sky-gradient.ts` — the sky, as pixels

## Purpose

Generates the equirectangular sky texture: a zenith→horizon gradient with a sun
disc and a warm glow baked in, plus the background rotation that places that sun
at the light's actual azimuth.

## Public API

- `SKY_GRADIENT_ROWS` (64), `SKY_GRADIENT_COLUMNS` (256).
- `ZENITH_RGB`, `HORIZON_RGB`, `SUN_GLOW_RGB`, `SUN_DISC_RGB`.
- `skyGradientPixels({ sunElevationRad, rows?, columns? }): Uint8Array` — RGBA,
  row-major, **top row first**. Throws `RangeError` below 2 rows or 2 columns.
- `skyRotationForSun(azimuthRad): number` — the `scene.backgroundRotation.y`
  that puts the baked disc at that azimuth.

## Invariants & assumptions

- **NEVER `scene.environment`.** Widening the texture did not change this. Only
  one of the two reasons was about width: three routes any environment map
  through its CubeUV path, which expects a PMREM-processed texture, and a raw
  equirect `DataTexture` makes it emit integer `CUBEUV_*` defines into float
  assignments — every `MeshStandardMaterial` fragment shader then fails to
  compile, three logs it and **silently does not draw the material**. That took
  the whole scene down for ten work items while the status line still reported
  "21 volumes" and the suite stayed green.
- **Top row first**, with `flipY = true` set on the `DataTexture` in
  `building-view.ts`. The three-specific quirk lives in the three-facing file;
  reversed, the sky is bright overhead and dark at the horizon, which reads as a
  stylistic choice rather than a bug.
- **The sun's ROW comes from its elevation**, via three's own
  `v = asin(y)/π + 0.5`. A fixed row would disagree with the light the moment
  `SUN_ELEVATION_RAD` changed — the two-sources-of-truth defect, in the one place
  it would look merely atmospheric.
- **The sun's COLUMN is baked once and the sky is rotated.** The sun moves with
  the camera (W12), so regenerating the pixels would be a texture upload on every
  drag — the exact main-thread cost this round removes. `skyRotationForSun` is
  derived from three's `equirectUv` and its transposed background rotation, and
  the derivation is re-computed in the test rather than tuned until it looked
  right.
  - **What no test here can prove is that the derivation matches a GPU.** If the
    sun appears mirrored on screen, the sign of the `π/2` term is the single
    knob. That check is §11.3 of the round-4 plan.
- **The disc is angularly much larger than the real sun** (~0.035 rad vs 0.0047).
  A physically sized sun is two pixels and reads as a dead sub-pixel.
- **The horizontal distance is scaled by `cos(elevation)`**, so the disc stays
  round near the zenith instead of smearing across the top of the image.
- **Fog is no longer forbidden.** Round 2 rejected it because it would have
  hidden finding R2-9 (distant buildings on fabricated terrain); R2-9 is fixed,
  so W21 introduces distance haze deliberately.

## Examples

```ts
const sky = new THREE.DataTexture(
  skyGradientPixels({ sunElevationRad: SUN_ELEVATION_RAD }),
  SKY_GRADIENT_COLUMNS,
  SKY_GRADIENT_ROWS,
  THREE.RGBAFormat,
);
sky.mapping = THREE.EquirectangularReflectionMapping;
sky.flipY = true;
scene.background = sky;
scene.backgroundRotation.y = skyRotationForSun(sunAzimuth);
```

## Tests

`sky-gradient.test.ts` — full opacity, zenith at the top and horizon at the
bottom, monotonic down a column away from the sun, a disc at the baked azimuth,
the disc's row tracking the elevation, symmetry about the true (half-pixel)
centre so the disc is round, a warm sky near the sun and a cool one far from it,
and `RangeError` on a degenerate size. Plus `skyRotationForSun`: that it turns
by exactly as much as the sun does, and that re-deriving three's sampling puts
the sun on the baked column.
