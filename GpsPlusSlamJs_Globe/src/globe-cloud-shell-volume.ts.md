# globe-cloud-shell-volume.ts

## Purpose

The spherical cloud volume's arithmetic (round-4 plan
`GpsPlusSlamJs_Docs/docs/2026-10-11-0122-globe-round-4-owner-feedback-plan.md`,
R4d / V1; DEC-R4-5 as reconciled with DEC-R3-6 in its §6 item 8). The
owner asked for volumetric clouds in layers: coarse following the cloud map
from about 700 km, finer from about 200 km, today's slab from about 30 km,
handing over as smoothly as today's volume fades in. Reconciled: ONE
ray-marched pass over a cloud shell around the Earth whose parameters move
with the altitude, so the "layers" are its parameter sets along the descent
(two fields cross-faded dip the opacity and dissolve one pattern into
another, DEC-R3-6). The pass itself is the lab's
`GpsPlusSlamJs_DesignSystem/labs/globe/globe-cloud-shell-volume.js`.

## Public API

- `CloudShellStation`: `{ altitudeKm, steps, octaves, cellScale,
thicknessScale, noiseShare }`, one parameter set at the altitude it
  applies fully. `cellScale` scales the live field's cells about the
  ground-anchored plane (the same field, larger), and is never
  interpolated (see the law); `noiseShare` the column's rise per unit of
  noise (below 1 flatter columns and soft, translucent edges, the cover
  kept); `aerial` the share of the slab's aerial fade (e^(-t / 60 km) on
  each segment), 1 at the slab's station so the far clouds match where the
  two are mixed, 0 high up.
- `CLOUD_SHELL_VOLUME`: `stations` (700 km: 4 steps, 3 octaves, cells x4,
  deck x4, noise share 0.35, aerial 0; 200 km: 6, 4, x2, x2, 0.59, 0; 30 km:
  the slab's own 8, 5, x1, x1, 1, 1; the 700 km cells and noise share chosen by eye among
  cells x1 / x4 / x6 and noise shares 0.3 / 0.35 / 0.5 / 1, the owner's A/B
  shots in the record),
  `topKm` 700 (full from here down), `bandKm` 300 (fades in over 1,000 to
  700 km), `maxSteps` 12 (the shader's loop bound), `maxOctaves` 7.
- `cloudShellVolumeLaw(altitudeKm, stations?)`: `{ steps, marchSteps,
octaves, thicknessScale, noiseShare, aerial, cells, cellMix }`: the top set above the top station,
  the bottom set below the bottom one, between two stations a smoothstep in
  the altitude's logarithm (each set reached exactly, zero slope there).
  `marchSteps` is `steps` rounded. The cells are never interpolated:
  `cells` names the two stations' scales and `cellMix` the same smoothstep,
  by which the pass mixes the two FIELDS (a scale moving with the altitude
  scales the ground-anchored plane about its origin, thousands of km away:
  the browser read a correlation of -0.05 with the slab at a scale of 1.01,
  0.999 at 1). RangeError for a non-finite altitude,
  no stations, stations not ordered from the highest down, or out of range
  (steps 1-12, octaves 1-7, positive scales).
- `cloudShellFieldWeights(t)`: the two fields' weights, their squares
  summing to 1 (the field's spread kept through the mix, so the cover and
  the opacity hold); RangeError outside 0-1.
- `cloudShellVolumeShares(altitudeKm, { topKm, bandKm?, ceilingKm, fadeKm })`:
  `{ shellIn, flat, shell, slab }`, who draws the clouds: the slab its
  share (`cloudVolumeShare`), the shell `shellIn x (1 - slab)` (`shellIn`
  the slab's fade form over the band above `topKm`), the flat layer
  `(1 - shellIn)(1 - slab)`. `topKm` 0 turns the shell off. RangeError for
  a non-finite altitude, a band that is not positive or a top (other than 0) at or below the slab's ceiling.
- `CloudShellFrame`, `cloudShellFrame(ellipsoid, target, groundKm, out?)`:
  the world frame at the target (`worldFromEcefAt`), the ellipsoid's radii,
  the model sphere's radius (the atmosphere pass's frame) and the Gaussian
  radius at the target. RangeError for a radius that is not positive or a
  target off the globe.
- `cloudShellColumn(pointKm, frame, lonOffsetRad)`: the CPU twin of the
  GLSL: for a point of the model frame, `{ heightKm, latRad, lonRad, uv,
chartKm }`: the geodetic latitude and longitude from the normal
  `normalize(p / radii)`, the map's uv with the drift taken off u, and the
  chart of its radial foot (azimuthal equidistant around the frame's
  origin: the frame's local x east and z south near it, the ground distance
  along the geodesic's first heading further out, the chord taken back to
  the arc with the Gaussian radius). RangeError for a point that is not
  finite or is the centre.
- `GLOBE_CLOUD_SHELL_GLSL`: `globeShellMapUv(p)`, `globeShellChartKm(p)`;
  uniforms `uShellWorldFromEcef`, `uShellRadii` (m), `uShellGroundKm`,
  `uShellGaussianM`, `uShellLonOffset`.

## Invariants and assumptions

- The law is continuous; its bottom station is the slab's own set, so
  where the two are mixed (below the slab's ceiling) they draw one field.
- The drawers share 1 at every altitude (the C2 invariant of
  `globe-cloud-volume.ts`, over three drawers); `flatCloudShare` takes the
  shell's top and band and multiplies its weakening by the flat drawer.
- The chart near the origin is the slab's local frame (within 30 m for
  ground points within about 50 km, heights to 8 km), so the shell and the
  slab read the same noise; with the live anchor carried across a recentre
  (`cloudVolumeAnchorRecentre`), a ground point within 140 km keeps its
  noise-plane position within 20 m, and far out it jumps by at most about
  2 x hop x (d / R)^2: measured for 20 km hops, a mean 26 / 104 / 234 /
  883 m (worst 43 / 179 / 417 / 1,748 m) at 500 / 1,000 / 1,500 / 2,900 km,
  under the footprint of a pixel that far out (the frame recentres only
  below 150 km, where the horizon is about 1,400 km away).
- float32 in the shader: the frame's product of 6,400 km numbers leaves
  about a metre, under the finest octave the march reads.
- The chart is singular at the frame origin's antipode (seen only from far
  out with the frame left far away: the frame recentres only below 150 km).

## Examples

```ts
const law = cloudShellVolumeLaw(450); // between 700 and 200 km
const shares = cloudShellVolumeShares(30, {
  topKm: 700,
  bandKm: 300,
  ceilingKm: 40,
  fadeKm: 25,
}); // { shellIn: 1, shell: 1 - slab, slab, flat: 0 }
const frame = cloudShellFrame(WGS84_ELLIPSOID, { lat: 47, lng: 8.3 }, 6360);
const { uv, chartKm } = cloudShellColumn([4000, 600, 4700], frame, 0);
```

## Tests

- `globe-cloud-shell-volume.test.ts`: the law (stations reached, held
  outside, continuous on a 1 % descent, monotone between stations, whole
  step and octave counts, the bottom station the slab's, its own stations
  and bad ones refused); the shares (sum 1 over a sweep of tops 467 / 700
  / 933 km and bands 100 / 300 / 600 km, the shell's span, the hand-over
  to the slab, off with no top, never rising, bad input).
- `globe-cloud-shell-volume.property.test.ts`: the map at the ellipsoid's
  own latitude and longitude with the drift; the chart near the origin
  against `worldFromEcefAt`; the ground distance far out; the recentre
  (near within 20 m, far bounded).
- `globe-cloud-flat-fade.test.ts`: the flat layer with the shell.
- The GPU side: `GpsPlusSlamJs_DesignSystem/labs/globe/globe-cloud-shell-volume.smoke.spec.mjs`.
