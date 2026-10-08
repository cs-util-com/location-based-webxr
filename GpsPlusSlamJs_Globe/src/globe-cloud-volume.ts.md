# globe-cloud-volume.ts

## Purpose

The cloud volume's arithmetic (volume-cloud plan
`2026-10-05-0016-globe-volume-cloud-variants-plan.md`, C2): the framework's
ray-marched cloud slab near the camera, its clouds taken from the globe's
own cloud map so the swap from the cloud shell never plops.

## Public API

- `CLOUD_VOLUME`: `radiusKm` 80 (the disc, the plan's R; 20 until the reach, §13), `ceilingKm` 40
  (no volume at and above), `fadeKm` 10 (it fades in below the ceiling).
- `cloudVolumeShare(altitudeKm, { ceilingKm?, fadeKm? })`: 1 at and below
  `ceilingKm - fadeKm`, 0 at and above `ceilingKm`, smoothstep between.
  RangeError for a non-finite altitude or a fade that is not positive.
- `cloudVolumeMapUv(xM, zM, { latRad, lonRad, lonOffsetRad })`: the cloud
  map's uv for a point of the target's local frame (x east, z south,
  metres): the target moved by the point on a flat frame, then the globe's
  mapping (u the longitude, v the latitude) with the drift taken off u.
  RangeError for a non-finite input.
- `cloudVolumeDiscCentre({ camera, direction, deckY, maxAheadM })`
  (volume-cloud plan §15): where the volume's disc is centred, in the
  world frame: where the view's centre meets the deck at `deckY`, along the
  view's heading, at most `maxAheadM` ahead; that far when the view never
  meets the deck; under the camera looking straight down. Returns
  `{ x, z, aheadM }`. RangeError for a non-finite input or a negative
  reach ahead. `CLOUD_VOLUME.maxAheadKm` is 60 (the slab is flat while
  the Earth curves: 1.5 km at 140 km, in the far fade).
- `cloudVolumeNoiseOffset({ latRad, lonRad, lonOffsetRad }, tileM, periodTiles)`:
  the slab's noise offset in tiles, each wrapped to [0, periodTiles): the target's
  distance east (at the map's drift) and south of latitude 0, longitude 0,
  over the noise tile. Set as the ground sky's `atmCloudOffset`, it anchors
  the noise to the ground and drifts it east with the map. `periodTiles` is
  where the noise repeats: 1 for the plain texture, 13 for the hex-tiled
  octave (the framework's `CLOUD_NOISE_PERIOD_TILES`); wrapped at one tile,
  the hex field jumped (hex-tiling plan H1, cold review finding 6).
  RangeError for a non-finite origin, a tile that is not positive or a
  period that is not a positive whole number.
- `cloudVolumeRecentreShift(ellipsoid, from, to, lonOffsetRad, tileM, periodTiles)`:
  the noise shift (tiles) to add once the world frame moves from `from` to
  `to` (degrees), so a ground point keeps its noise. The offset alone is
  right only along a parallel or a meridian; a recentre that changes the
  latitude moved the noise (the owner, 2026-10-08: "the clouds jump when
  I zoom out and back in"; measured in the lab: 0.078 tile, about 1.9 km,
  for a 25 km diagonal move near Bern, 0.0012 with the shift). The old
  offset plus the new origin's place in the old frame, minus the new
  offset; callers add it up across recentres. Property-tested over random
  places, drifts and moves up to 30 km (within 0.003 tile).
- `CLOUD_VOLUME_COVERAGE_GLSL`: the chunk for the framework's
  `setCloudSlabCoverage`, defining `float atmCloudCoverageAt(vec2 xz)` as
  the map at `cloudVolumeMapUv`'s position times `uVolumeOpacity` and
  `uVolumeShare`. Uniforms: `uVolumeClouds`, `uVolumeOrigin` (latitude,
  longitude, radians), `uVolumeLonOffset`, `uVolumeOpacity`,
  `uVolumeShare`.

## Invariants & assumptions

- The mapping is the globe surface's own (`GLOBE_CLOUD_GLSL`: u from the
  longitude, v from the latitude, the drift east subtracted), so the
  volume's clouds sit where the shell's do.
- The volume's disc and the shell's hole both scale with the share, so no
  altitude draws the clouds twice or not at all.
- **The noise belongs to the ground.** The slab reads its noise at
  `xz / tile + offset` in the target's local frame, and the frame is
  centred on the target, so with a fixed offset every place put the same
  patch of noise under its target (a clear one: every link the owner zoomed
  into looked down into the same hole, 2026-10-06). With
  `cloudVolumeNoiseOffset` a ground point reads the same noise whichever
  target the frame is centred on (exact along a parallel and a meridian).
- A flat frame: within 40 km the curvature's drop is 125 m, a tenth of the
  slab's thickness; the plan offers no larger disc.

## Examples

```js
setCloudSlabCoverage(slab, {
  glsl: CLOUD_VOLUME_COVERAGE_GLSL,
  uniforms: {
    uVolumeClouds: { value: cloudMap },
    uVolumeShare: { value: 1 } /* ... */,
  },
});
const share = cloudVolumeShare(altitudeKm);
```

## Tests

`globe-cloud-volume.test.ts`: the share's ends, middle and monotony, the
mapping's origin, its east and south steps and the drift (the GLSL chunk's
CPU twin), the noise offset's value, drift direction and refusals, the
chunk's function and uniforms, and the refusals.
`globe-cloud-volume.property.test.ts`: the offset stays in [0, 13), and a
ground point reads the same noise for two targets on its parallel or its
meridian, measured modulo the period (a wrap at one tile fails them: they
were red on it).
