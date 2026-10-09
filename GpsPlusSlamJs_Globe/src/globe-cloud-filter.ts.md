# globe-cloud-filter.ts

The cloud map's sampling: a cubic B-spline over the map's texels, read in
four bilinear taps (Sigg and Hadwiger, GPU Gems 2 ch. 20), shared by every
reader of the map so they agree where they meet.

Source: round-3 plan
`GpsPlusSlamJs_Docs/docs/2026-10-08-2345-globe-round-3-owner-feedback-plan.md`
(M1, DEC-R3-5). The owner (2026-10-08) saw the clouds as pixels at
3,000 km. Two causes: the 2,048 map (now 4,096), and the bilinear read,
whose value is a facet per texel and whose screen gradient (the cloud
shading's) is constant per texel, which draws the texel grid. The
B-spline is smooth to its second derivative. It is also slightly softer
than bilinear (an approximating filter), which at these magnifications is
the point.

## Public API

- `bsplineWeights(t)`: the four weights for a fraction `t` in [0, 1); never
  negative, summing to 1.
- `bsplineTaps(x)`: one axis of the four-tap form, for a position in
  texels (texel i covers [i, i + 1), its centre at i + 0.5): the two tap
  positions and the first tap's share.
- `GLOBE_CLOUD_FILTER_GLSL`: the GLSL twin, for a program's global scope.
  It declares `uniform float uCloudCubic` and defines
  `globeCloudCubic(map, uv, dx, dy)` (with the caller's gradients: the
  surface, its shadow, the shell) and `globeCloudCubicLod(map, uv)` (level
  0: the volume's march has no gradients). `uCloudCubic` below 0.5 reads
  bilinearly instead (the lab's `cloudCubic=0`, to compare). The map's
  size comes from `textureSize`, so any map works.

## Invariants (tested, `globe-cloud-filter.test.ts`)

- The four taps through a simulated bilinear tap equal the sixteen-texel
  sum on any map, anywhere away from the clamped rows (property test;
  mutating a tap position by half a texel or swapping the share fails it).
- The slope is continuous across a texel centre where bilinear's jumps.
- The GLSL carries the twin's weights, tap positions and shares.

## Where it is read

- `globe-surface-material.ts`: the clouds and their shadow on the ground.
- `globe-cloud-shell.ts`: the shell.
- `globe-cloud-volume.ts`: the volume's coverage (`CLOUD_VOLUME_COVERAGE_GLSL`),
  also the volume's shadow.
- Each program gets `uCloudCubic` from the surface's uniforms object.

## Cost

Four taps for one: the surface and the shell read the map twice per pixel
(eight taps), the volume once per march step. Measured in the browser
smokes (`globe-cloud-map.smoke.spec.mjs`, the cloud volume's cost line).
