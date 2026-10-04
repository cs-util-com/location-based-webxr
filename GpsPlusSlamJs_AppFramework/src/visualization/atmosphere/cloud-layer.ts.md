# cloud-layer.ts

## Purpose

The cheap 2D cloud layer (plan DEC-SKY-6): a seeded, tileable noise texture
projected onto a horizontal plane ~2 km up, turned into density by the cover,
lit in the sky pass by the sun's transmitted colour. This module holds the
pure parts; the GLSL (`atmClouds` in `atmosphere-glsl.ts`) mirrors
`cloudDensity` and `cloudHorizonFade`.

## Public API

- `CLOUD_TEXTURE_SIZE` (256), `CLOUD_LAYER` — every constant the shader
  uses: `altitudeKm` 2, `tileKm` 24, the second octave (INTEGER frequency
  3, offset, first-octave weight 0.7), the soft edge half-width, and the
  lighting terms (sun ambient, forward lobe, thickness darkening, sky
  ambient, aerial distance). The GLSL interpolates them; none is a bare
  literal.
- `cloudNoiseAt(x, y, size, seed)` → [0, 1], periodic in `size`.
- `cloudNoise(size, seed)` → 8-bit texture data (cached per size/seed).
- `cloudNoiseSample(data, size, u, v)` → the two-octave noise at texture
  coordinates (u, v), as the shader reads it at its finest level
  (`atmCloudNoise` without mips): each octave bilinear between texel
  centres, wrapped; `RangeError` for non-finite coordinates. The CPU twin
  the column's tests and the look-dev page's probes use to predict where the
  clouds are (round-3 stream D).
- `combinedCloudNoise(data, size)` → the two-octave field the shader
  actually samples, per texel.
- `cloudThresholdForCover(field, cover)` → the noise value above which
  `cover` of the field lies (a quantile); `+∞` at cover 0. `RangeError`
  outside [0, 1].
- `cloudThreshold(cover, size?, seed?)` — the same for the shipped texture
  (sorted field cached).
- `createCloudTexture(size?, seed?)` → repeating, mipmapped `DataTexture`.
- `cloudDensity(noise, threshold)` — soft step: exactly 0.5 at the
  threshold, 0 for a non-finite threshold (a clear sky).
- `cloudHorizonFade(dirY)` — 0 at/below the horizon, 1 from ~7° up.
- `cloudLitRadiance(sunT, cosToSun, density, skyZenith)` — TS twin of the
  shader's cloud lighting, in the sky's radiance units.

## Invariants & assumptions

- Tileable by construction: every octave's lattice wraps at a whole number of
  cells per tile.
- COVER MEANS SHARE OF SKY: the threshold is a quantile of the combined
  field, so cover 0.3 clouds 30 % of the tile. The first mapping
  (threshold = 1 − cover) cleared four of five presets, because averaging
  two octaves narrows the noise's spread (M2 review, finding 1).
- The second octave's frequency is an integer, so the combined field stays
  periodic and the drift offset wraps without a jump.
- Deterministic per seed, so screenshots of a preset compare.
- Lighting is plausibility-tested, not physical: a noon cloud at 90° from
  the sun is 2…8× the zenith sky's luminance (real cumulus ~3…6×).
- A sky dressing, not a physical cloud model (volumetric clouds were out of
  scope by owner decision).
- In `SkyAtmosphere`, cover changes re-bake the environment; drift
  (`advanceClouds`) is a uniform offset with no GPU work.

## Examples

```ts
atmosphere.setClouds({ cover: 0.3 });
atmosphere.advanceClouds(dtSeconds); // per frame, optional
```

## Tests

`cloud-layer.test.ts` — periodicity, range, determinism, contrast, density
around the threshold and monotone in it, horizon fade, cover = clouded share
(±0.05 at 0.2 / 0.5 / 0.8), the integer octave, the lit-radiance ratio
against the atmosphere model; `cloudNoiseSample` at texel centres, periodic
in whole tiles, and flat on a uniform texture. Pixels: the look-dev smoke asserts cover
changes the upper sky.
