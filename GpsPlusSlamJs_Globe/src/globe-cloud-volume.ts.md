# globe-cloud-volume.ts

## Purpose

The cloud volume's arithmetic (volume-cloud plan
`2026-10-05-0016-globe-volume-cloud-variants-plan.md`, C2): the framework's
ray-marched cloud slab near the camera, its clouds taken from the globe's
own cloud map so the swap from the cloud shell never plops.

## Public API

- `CLOUD_VOLUME`: `radiusKm` 20 (the disc, the plan's R), `ceilingKm` 40
  (no volume at and above), `fadeKm` 10 (it fades in below the ceiling).
- `cloudVolumeShare(altitudeKm, { ceilingKm?, fadeKm? })`: 1 at and below
  `ceilingKm - fadeKm`, 0 at and above `ceilingKm`, smoothstep between.
  RangeError for a non-finite altitude or a fade that is not positive.
- `cloudVolumeMapUv(xM, zM, { latRad, lonRad, lonOffsetRad })`: the cloud
  map's uv for a point of the target's local frame (x east, z south,
  metres): the target moved by the point on a flat frame, then the globe's
  mapping (u the longitude, v the latitude) with the drift taken off u.
  RangeError for a non-finite input.
- `CLOUD_VOLUME_COVERAGE_GLSL`: the chunk for the framework's
  `setCloudSlabCoverage`, defining `float atmSlabCoverageAt(vec2 xz)` as
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
CPU twin), the chunk's function and uniforms, and the refusals.
