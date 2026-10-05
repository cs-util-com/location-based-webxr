# cloud-shadow.ts

## Purpose

Cloud shadows on three.js's own lit materials (round-3 plan
`GpsPlusSlamJs_Docs/docs/2026-09-27-0532-owner-feedback-round-3-plan.md`,
stream D; DEC-FB3-7): the direct
light of every directional light is dimmed by the cloud column its ray
crosses on the way to the fragment ([`cloud-column.ts.md`](cloud-column.ts.md)),
one noise read (two texture reads) per light and pixel, no shadow map. The
shadows drift with the clouds and fall where the sky draws them.

## Public API

- `new CloudShadow()`: owns its uniforms (`uniforms`): `atmShadowCloudOn`
  (1), `atmShadowCloudTexture` (null until a sync), `atmShadowCloudThreshold`
  (2, no cloud, until a sync), `atmShadowCloudOffset`.
- `sync(source)`: takes an atmosphere's clouds (`SkyAtmosphere.cloudUniforms`
  satisfies `CloudShadowSource`): the noise texture, the drift offset and
  the far fade as the OBJECTS themselves (the shadows drift with the sky,
  no per-frame call), the threshold and the anchor as copies (call again
  after a cover or mode change).
- `setEnabled(on)` and `enabled`: a uniform, no recompile.
- `apply(material)`: patches one lit material (Lambert, Phong, Standard,
  Physical, Toon), chaining its `onBeforeCompile` and adding `|cloud-shadow`
  to its program key. Idempotent (ownership in a WeakMap). `TypeError` for
  a material without three's light loop; `Error` for one another
  `CloudShadow` owns; `CloudShadowAnchorError` at compile time when three's
  `#include <lights_pars_begin>` or `void main() {` is gone.
- `applyToObject(root)`: patches every lit material under `root` not yet
  patched; returns how many.

- **A coverage map, a disc and a lift** (globe volume-cloud plan
  2026-10-05-0016, C3), so the volume's shadow falls from the clouds the
  volume draws: `configureMap({ coverage?, disc? })` (the shared chunk,
  [`cloud-coverage.ts.md`](cloud-coverage.ts.md); fixed before the first
  patched material, since it changes the shader text: `Error` after it,
  `RangeError` for a chunk without `atmCloudCoverageAt`), and three
  uniforms set live: `setLiftM(m)` (the layer lifted above its own height),
  `setDiscRadiusM(m)` and `setCover(c)` (the global cover the map's is
  multiplied by). The program key gains `-map` and `-disc`.

## Invariants & assumptions

- **No chunk text is copied.** Just before the fragment's `void main() {`
  (after every declaration: three's Lambert, Phong and Toon declare
  `vViewPosition` only after `lights_pars_begin`, where a first cut failed
  to compile) the patch defines
  `atmShadowCloudLightInfo` (three's `getDirectionalLightInfo`, then the
  colour times the column's transmittance toward the light) and
  `#define`s the old name to it, so three's light loop, in any rewrite of
  `lights_fragment_begin` (the look-dev page's ring shadow rewrites it
  globally), calls the wrapper unchanged.
- **Every directional light, along its own direction**: no assumption about
  which light is the sun or how three orders its lights. A light of colour
  0 (the page's ring-shadow carrier) reads no noise; a light at or below
  the horizon is untouched.
- **The world point is `cameraPosition + (-vViewPosition) · R`** (the view
  matrix's rotation transposed): no varying is added.
- **Every branch is uniform per light** (uniforms and the light's own
  values), so the implicit-level texture reads are defined; the mip level
  follows the pixel's footprint at the cloud's crossing (soft far shadows,
  no shimmer).
- **One read per light and pixel**: the column's crossing of the layer's
  middle. A slanted ray crosses neighbouring columns too, so at a low sun
  the shadow is an approximation; clear sky (threshold 2) and the off
  switch skip the reads.
- **Only where the sky draws the clouds** (round-3 review, finding 1): the
  column's optical depth is weighted by the disc's own helper,
  `atmColumnDrawn` ([`cloud-column.ts.md`](cloud-column.ts.md)): the
  sheet's and the slab's far fade on the crossing's horizontal distance
  from the camera, or the dome's horizon fade on the light's slope, times
  the aerial melt. Without it a 5° sun read the column ~22 km out, past the
  21 km far fade, and ×10 deeper for the floored slope: the ground went
  near-black under an empty sky while the disc shone clear. The anchor
  (`atmShadowCloudAnchored`, copied) and the far fade
  (`atmShadowCloudFarFadeM`, shared) come with `sync`; sync again after a
  mode change. The dome is camera-centred at the origin, so its shadows
  sit offset from its drawn clouds by the camera's distance from the
  origin (a few hundred metres on the look-dev page, against 24 km tiles).
- **Apply it before the haze** (which is applied last by its own contract).
  Either order compiles: each patch detects its own text, and the haze
  heals itself back on top.

## Example

```ts
const cloudShadow = new CloudShadow();
cloudShadow.applyToObject(scene); // before haze.applyToObject(scene)
haze.applyToObject(scene);
// after each atmosphere change:
cloudShadow.sync(atmosphere);
```

- **The threshold where the light crosses the layer** (C3): the lifted
  point moved along the light to the layer's middle
  (`atmColumnDistance`), then `atmCloudThresholdAt` there. Without a map
  or a disc it is the sky's threshold, so the default shadow is unchanged
  and the same from every viewpoint; with the disc (the volume's) it
  depends on the camera by design.

## Tests

- `cloud-shadow.test.ts`: three's real standard, physical, Lambert, Phong
  and Toon shaders (the wrapper after the light declarations, the rename
  before the light loop, three's function called by its real name, each
  light's own direction, the world point); the chained hook and the program
  key; the haze chained in either order with each text once; the refusals;
  the missing anchor; `applyToObject`; the shared texture and offset, the
  copied threshold, one switch for every material.
- `GpsPlusSlamJs_DesignSystem/3d/sun-clouds.smoke.spec.mjs`: on the GPU,
  ground under a cloud darker than with the patch off where the CPU twin
  (`cloudColumnTransmittanceToward`) says it is, clear ground unchanged, the
  pattern following the drift, with the ring shadow and the haze; the cost
  as an on/off ratio.
