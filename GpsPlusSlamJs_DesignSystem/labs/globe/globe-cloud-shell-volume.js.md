# globe-cloud-shell-volume.js

## Purpose

The spherical cloud volume in the globe lab (round-4 plan
`2026-10-11-0122-globe-round-4-owner-feedback-plan.md`, R4d / V1;
DEC-R4-5 as reconciled with DEC-R3-6 in its §6 item 8): ONE full-screen
ray march through a cloud shell around the Earth, from about 700 km down
to the slab's ceiling, so the clouds the flat layer drew between 700 and
30 km (the owner: "almost gone" there) are volumes; mixed with the slab
below its ceiling. Behind `cloudShellVolume=1`, off by default until the
owner has looked.

## Public API

`createGlobeCloudShellVolume(renderer, { ellipsoid, surfaceUniforms,
groundSky, atmosphere, sceneDepth })`:

- `ellipsoid` the globe's; `surfaceUniforms` the surface's (the map
  `uClouds`, `uCloudCubic`, `uCloudOpacity`, the drift `uCloudLonOffset`,
  all shared as objects); `groundSky` the ground sky's `SkyAtmosphere` (the
  live field's lattice, amplitudes and anchor, which the cloud volume
  carries); `atmosphere` the space pass (`transmittance()`, the sun's
  table); `sceneDepth` the relief's depth (`globe-scene-depth.js`).
- `setEnabled(on)`, `enabled`; `setResolution(share)` (0.25-1 of the
  drawing buffer, RangeError outside).
- `update({ altitudeKm, shares, stations, target, deckKm, cover })`: the
  law at the altitude (`cloudShellVolumeLaw`), the weights from `shares`
  (`cloudShellVolumeShares`), the deck centred on `deckKm` (the cloud
  shell's height) and `thicknessScale` times the slab's 400 m thick, the
  chart's frame at `target` (null: nothing drawn, the chart needs a frame)
  and the two fields' bases (the law's `cells`): the slab's own at scale
  1, else the same carried anchor over the scale through `cloudLiveBasis`. Returns `{ weight, slabWeight }`.
- `render(camera, { worldFromEcef, sunEcef, sunIntensity, slabTexture,
sceneDepthWeight })`: the march into its own half-float target (cleared
  to 0, premultiplied), then ONE composite over the frame of the shell
  times its weight plus `slabTexture` (the slab drawn this frame at its full
  share, `globe-cloud-volume.js` with `composite: false`) times the slab's
  weight. Returns whether it drew.
- `readBack(bands)`: the last shell target's mean alpha and share over 0.05
  per horizontal band (debug, slow); `state()`; `dispose()`.

## The march (twin of the slab's, on a sphere)

- The ray in the model frame (the ellipsoid as the atmosphere's ground
  sphere, km), as `globe-atmosphere.js`; entry and exit of the deck's top
  and base spheres analytic; the end at the relief's depth when it was
  drawn this frame, weighted like the space pass's (`skyHandOver.weight`;
  above the 80 km edge no depth: rays end at the deck's base, and relief
  standing above the deck is covered by it; a 10 m near plane cannot
  resolve kilometres at 700 km).
- Nodes uniform with the slab's per-pixel jitter; at each node the cover
  (the map at the point's geodetic latitude and longitude, B-spline at level
  0 handing over to the mips by the footprint, times the opacity, the
  volume's gain and the shell's fade-in) through the live field's threshold
  table, and N1's live field on the chart (`globeShellChartKm`): the two
  stations' fields, each at its own fixed cell scale, mixed by
  `cloudShellFieldWeights(cellMix)` (one field at a station), its octaves capped at the law's fractional count (the
  last one in part, so the cap never jumps), each faded by the footprint
  (the larger of the pixel's and the step's horizontal reach, as the slab).
- The column of the slab (`cloud-slab.ts`): thickness `T0 + H (n - th)`,
  times `thicknessScale`, the extinction divided by it (a vertical column's
  optical depth, and so the cover, unchanged); the secant step; the exact
  optical depth through the height's slope along the ray; the sun's depth
  through the column above both ends; the light integrated in closed form.
- The light at the interval's middle, by that point's own sun: the sun's
  transmittance from the space pass's table at the deck, the top and the
  underside as the slab's (`cloudTopRadiance`, `cloudLitRadiance`), the
  zenith ambient from `ZENITH_TABLE` (`globe-cloud-shell-light.js`) by the
  sun's cosine. The slab's aerial fade (e^(-t / 60 km) a segment) by the
  law's `aerial` share: 1 at the slab's station (measured without it, the
  shell's mean alpha at 30 km read 0.48 against the slab's 0.29 at the same
  pixels, correlation 0.999), 0 high up where the space pass's veil is the
  aerial perspective.
- Scene units: the table's radiance times the sun intensity over
  `ATMOSPHERE_RADIANCE_SCALE` (the ground sky's own `atmRadianceToScene`).

## Invariants

- Nothing drawn while disabled, without a frame target, or with both
  weights 0; the slab's composite is skipped while this one mixes it.
- The mix is a premultiplied weighted sum, never one over the other, so
  the hand-over keeps the opacity (stacking 0.8 over 0.8 at weight 0.5
  reads 0.64).
- At cell scale 1 the shell's basis is the slab's vectors, copied.

## Tests

- `globe-cloud-shell-light.test.mjs` (the ambient table).
- `globe-cloud-shell-field.test.mjs` (the two-field mix keeps the field's
  spread and the cover the thresholds draw, on the framework's CPU twin;
  the plain average it replaces fails it).
- `globe-cloud-shell-volume.smoke.spec.mjs`: compiles and draws at 700 /
  200 / 50 km and nothing with the switch off; the owner's shots before and
  after; the seam, the descent and the cost (see the spec's header).
- The arithmetic: `GpsPlusSlamJs_Globe/src/globe-cloud-shell-volume.test.ts`
  and `.property.test.ts`.
