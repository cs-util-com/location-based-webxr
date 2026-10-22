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
sceneDepthWeight, disc })`: the march into its own half-float target
  (cleared to 0, premultiplied; `disc`: the slab's `{ centre, deckY,
radiusM }` from its state, the centre null on the camera, where its flat
  deck and its haze apply), then ONE composite over the frame of the shell
  times its fade-in less the slab's share of the cloud the slab draws at
  that pixel (`cloudShellPixelWeight`: r = the slab's alpha over the
  shell's) plus `slabTexture` (the slab drawn this frame at its full share,
  `globe-cloud-volume.js` with `composite: false`) times the slab's share.
  Returns whether it drew.
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
- The limb: a ray whose slope through the deck (the sine of its angle
  below the deck's horizontal at entry) is under 0.03 fades out (the
  dome's horizon fade in the deck's own vertical): grazing rays cross
  thousands of km of deck in a few steps and drew a dashed white line
  along the horizon from 700 km.
- Nodes uniform with the slab's per-pixel jitter; at each node the cover
  (the map at the point's geodetic latitude and longitude, B-spline at level
  0 handing over to the mips by the footprint, times the opacity, the
  volume's gain and the shell's fade-in) through the live field's threshold
  table, and N1's live field on the chart (`globeShellChartKm`; it and the
  slab's disc mask take the chunk's `globeShellAsin`, never the GPU's
  built-in asin, which drew every cloud twice, 0.8 km apart, on a real GPU):
  the two
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
- The noise (round-5 plan 2026-10-12-0612 C2): `update`'s `cascade`
  (`cloudShellNoiseCascade`) gives the two fields (fixed scales, their own
  lattice offsets added to the carried anchor) and their cos / sin
  weights, so the clouds morph at one speed from 1,050 km down to the
  slab's ceiling, where the field is the slab's own (its basis copied).
- A, the high layer (§11, DEC-R5-6; off by default): `update`'s
  `highLayer` `{ on, altitudeKm, cellScale, cover, noiseShare }`; `render`
  marches it a second time into its own target with the deck, the field
  (its own basis from the carried anchor), the look and the steps swapped
  (`marchHighLayer`, every swapped uniform put back), drawn also from
  below (`uBothSides`: a rising ray counts, and a ray that meets the ground
  first ends there; it was drawn through the Earth below the horizon,
  0.19 alpha there, measured). The composite lays it over the clouds at
  full strength wherever the shell draws, in front from above its middle
  and behind from below (premultiplied over, `cloudLayerOver`).
  `alphaGrid(nx, ny, "high")` reads its target; `state().high` reports
  it. (B, two layers in the blend, and the lift of §10 were built and
  removed on the owner's verdict, §12.)
- The shadow on the ground (the cloud-shadows plan 2026-10-13-1951,
  M2/M3; `update`'s `shadow`, the strength from
  `cloudShellShadowStrengths`, and the high layer's `highLayer.shadow`):
  `shellShadow` reads, where this pixel's ray meets the ground, the cloud
  column the sun's ray from there crosses at the deck's middle, once, with
  the pass's own field, chart, drift and cover, so the shadow lies under
  the clouds it draws; its slant depth over the sun's height (floored at
  0.2), faded as the sun sets. The ground is the drawn relief where the
  scene's depth is given (the ground-sky hand-over's `uSceneDepth`), the
  model sphere otherwise: 1.3 km of relief seen at 20 degrees moved a
  sphere-placed shadow 3.6 km off its cloud (M1).
  - The shell's shadow is drawn by a second, shadow-only pass of the same
    shader (`uShadowPass`: the march skipped, `shellShadow` written as
    black at its alpha) into its own `shadowTarget`, at the march's
    resolution, only while its strength is above 0. The composite lays it
    over the ground before both cloud layers (M1). In the shell's alpha,
    as before, the slab's per-pixel share took it away below the slab's
    ceiling: 0.12 of the target's points shaded at 5 km, none of them on
    the screen (measured 2026-10-14), the owner's "do the shadows vanish
    when I zoom in?".
  - The high layer's stays in its own target (its march), kept by the
    march's early exits (a ray from below a deck never crosses it, its
    case seen from the ground).
  - Measured in the targets (the screen's mean moved with the eased
    exposure and the arriving imagery): the shell's ground rows 0.122 to
    0.180 at 100 km, 0 without clouds; the high layer's 0 to 0.042 from
    2 km (thin, wispy). `alphaGrid(nx, ny, "shadow")` reads the shell's
    shadow target (zeros while the shadow is off).
- No aerial fade above the slab's ceiling (round-5 C3: it made the clouds
  see-through from high up, 0.68 straight down at 100 km); below it the
  fade's strength is the slab's share, as the slab's own
  (`setCloudAerial`), so the two still draw alike.
- Inside the slab's disc the deck's height is measured against the slab's
  flat plane (d^2 / 2R from the frame's origin, eased in over the slab's
  first tenth of share; round-5 C4): the flat slab and the curved shell
  drew the same clouds shifted (doubled, about 1.3 km at the disc's edge
  from 30 km up). The top sphere is raised by that deck's largest rise.
- C2 per pixel (the R4d review, finding 1; round 5): the shell gives up
  the slab's share only of the cloud the slab draws at that pixel; one
  global weight drew every cloud beyond the disc at 1 - the share (gone at
  15 km) at the owner's oblique pose, and a disc mask in its place lost the
  slab's fade ring. Beyond the disc the shell draws at every altitude, so
  the far horizon keeps its clouds below the slab's ceiling too.
- The map's mip level by the longitude's texel at the point's latitude
  (finding 12; the equator's read too sharp toward the poles).
- The lab draws the shell only with `cloudNoise=live` (the field it
  reads); with the tile or hex noise the old layers draw.
- Known and filed (the R4d review): with the cloud drift on, the noise
  (carried by a translation at the frame origin) slides against the map
  (a rotation about the pole) away from the origin (finding 6); above
  150 km the chart stays on the frame target (finding 7); the under-cloud
  light's edge at the terminator (finding 8); no depth-aware upsample.

## Tests

- `globe-cloud-shell-light.test.mjs` (the ambient table).
- `globe-cloud-shell-field.test.mjs` (the two-field mix keeps the field's
  spread and the cover the thresholds draw, on the framework's CPU twin;
  the plain average it replaces fails it).
- `globe-cloud-shell-volume.smoke.spec.mjs`: compiles and draws at 700 /
  200 / 50 km and nothing with the switch off or with the tile noise; the
  owner's shots before and after (opt-in, `R4D_SHOTS_DIR`); the seam (its
  mean difference and mean alphas asserted, not only the correlation); far
  clouds at the owner's oblique pose with the slab on against off; the
  descent and the cost (see the spec's header).
- The arithmetic: `GpsPlusSlamJs_Globe/src/globe-cloud-shell-volume.test.ts`
  and `.property.test.ts`.
