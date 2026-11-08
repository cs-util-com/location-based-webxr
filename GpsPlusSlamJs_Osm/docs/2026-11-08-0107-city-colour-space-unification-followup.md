# City colour space: unify plates, ground and POI (follow-up)

Filed by milestone M1 of the city objects plan 2026-11-07-2315 (section 7,
the colour-space rule). Related sidecars:
[chunk-meshes.ts.md](../src/mesh/chunk-meshes.ts.md),
[city.ts.md](../src/mesh/city.ts.md),
[srgb.ts.md](../src/mesh/srgb.ts.md),
[city-objects.ts.md](../src/three/city-objects.ts.md).

## What M1 settled

- Building chunks (buildings and the barriers drawn among them) are converted
  from sRGB to linear light in `buildCity` (`linearChunkColours`).
- Trees are converted through `THREE.Color` into `instanceColor`.
- Road chunks stay raw, as the O3 picture the owner chose drew them.

## What is still raw, and should be decided

- **OsmDemo's area plates** (`demo-worker.ts`, `plates: chunkMeshes(...)`):
  raw byte / 255 into a three.js vertex colour, so drawn lighter and greyer
  than their palette. M3's land-use tint replaces part of this layer; decide
  there whether the remaining plates convert.
- **Roads**: raw by the owner's chosen picture. Converting them means
  re-tuning `roadColour` so the picture stays, and re-writing the contrast
  checks in `feature-colours.test.ts` against linear values.
- **The ground and the POI layers**: check each app's ground material and the
  POI colours for the same raw path before M3 and M5 add to them.
- **The AR shell** (`GpsPlusSlamJs_OsmDemo/src/ar-building-material.ts`)
  mixes the vertex colour into its cyan, `tint = mix(uTint, colour, 0.35)`,
  and writes `tint * energy` raw with additive blending. With linear building
  colours the mix pulls darker. Measured by the shader's own formula
  (2026-11-08, M1 review fix; `uTint` = HSL 0.52 / 0.76 / 0.56 in sRGB, linear
  0.042 / 0.628 / 0.776):
  - over the 35 building class colours plus the default `0xc8ccd8`, the
    tint's luma after / before is 0.81 to 0.90, median 0.85: **the additive
    glow is about 15 percent dimmer** (10 to 19 percent);
  - over the five barrier kind colours, 0.80 to 0.83 (barriers were the
    building default before M1, so they also move toward green or stone);
  - `energy` (rim, pulse, back-face boost) does not depend on the colour, so
    this ratio is exactly the rendered one wherever the additive sum stays
    below 1 per channel; above that the clamp hides part of the difference.
  - **A rendered AR probe is deferred**: no test or page renders the shell
    without a device, and the arithmetic above is exact for the shader. What
    it cannot say is how 15 percent less glow reads over a camera image; that
    is the owner's phone look (AR item in M1's owner-look list). If the shell
    reads too weak, the knob is the shell, not the city colours: the
    `opacity` parameter restores the median glow, by a factor between 1.08
    and 1.18 (three's additive blend multiplies by the alpha, which is the
    clamped energy too, so `opacity` enters twice while the energy is below
    1). Lowering `colourMix` does not
    (0.10 to 0.30 give a median of 0.87 to 0.86 against today's raw mix),
    because the cyan itself (linear luma 0.51) is darker than the raw class
    colours it was mixed with. M7's palette
    changes every building colour again, so the re-tune, if any, waits for M7.
- **Three of Heidelberg's ten tagged fence ways are not drawn** (nor indexed;
  unchanged by M1, pinned in `site-barriers.test.ts`). The M1 review found
  them: 3-node stubs with a gate in the middle, consumed by `splitAtGates`,
  the same on `main`. Decide whether a stub on each side of a gate should
  still draw before M2 adds more barrier-like objects.

## OsmDemo's DEC-R4-5 gate: chroma green, the lit-city floor red (OPEN)

`scene-3d.spec.js` in the full tier on r1135 (2026-11-08, `E2E_TIER=full`,
that spec only): 12 passed, 1 flaky, 1 failed.

- **The heat ramp stays the loudest thing at every sun point** (the chroma
  margins, floor 5): plain 6.24 to 8.40, `cpu-slope` 6.07 to 8.33.
- **The lit-city brightness fell at every lit point**, measured against the
  approved values the floors are written against (with the cells off):
  - golden hour 3.6 deg: 23.7 (approved 42.6, floor half: 21.3), 0.56 of it;
  - 3.6 deg morning: 17.7 (33.6, floor 16.8), 0.53;
  - 24 deg morning: 67.1 (96.8, floor 48.4), 0.69;
  - September noon 38.9 deg: 62.3 (75.1, floor 37.6), 0.83;
  - twilight -2.9 / -5.9 deg: 16.2 / 16.8 (20.8 / 16.5), 0.78 / 1.02;
  - **June noon 62.5 deg: 53.3 (approved 64.7, floor 95 percent = 61.5):
    RED** (`the light dialog` test, line 2067, all three attempts).
- **Attributed to M1's building colour conversion, by the diff, not by a run
  on `main`**: the measure (`litSurfaceLuma`) averages the near-neutral warm
  pixels, which are the buildings; M1 changes nothing else in this scene
  (light, ground and roads untouched), and converting a building colour of
  about 0.8 to linear about 0.6 lowers its lit sRGB luma by roughly the
  factors above. The two morning points at 3.6 deg are within 1 of their
  floors.
- Not changed: the floors are the owner's approved brightness (the noon
  brightening, DEC-LIGHT-9). Options for the owner: accept darker buildings
  and re-approve the lit values; raise the noon brightening gain or the
  exposure to restore them (checked against the chroma margins); or keep
  building chunks raw until M7's palette, which is authored for the converted
  pipeline. The flaky test (`shows the buildings from beneath`, 148 non-sky
  pixels against a bound of 58.6 on its first attempt, green on retry) is
  not attributed.

## The shade floor in OsmDemo is missed by the light, not the colours

The plan's floor (M1): at the street camera with the default sun, the shaded
side of a hedge and a crown underside read at least 40 of 255 in sRGB luma;
if missed, the fix is a lighter foot gradient and top band in the vertex
colours. Measured 2026-11-08 (M1 review fix) in OsmDemo on r1135, Heidelberg
fixture, flat DEM, camera 40 m from a target at the hedge (way 1308446697)
and at the densest tree group, the app's default tilt and three orbit steps,
default sun (the boot sun, about 20 degrees in the afternoon) on 8 Nov,
23 Sep and 21 Jun. Object pixels are those that change when the layer is
switched off at the same pose (hedges: the buildings layer, green hue only).
That set also holds the layer's cast shadow on the ground, so the low tail
is read together with the screenshots, which show the shaded crown and
hedge sides themselves near-black.

- Hedge, p5 / p50 sRGB luma: 3.8 to 18 / 8.9 to 41.5; 43 to 98 percent of
  hedge pixels below 40, 29 to 81 percent below 30.
- Trees, p5 / p50: 3.6 to 11 / 5.4 to 56; min 1.1 to 3.6 (5 of the 9
  frames; one page load timed out under load and ended the sweep there).
- **Buildings' shaded walls are as dark**: p5 5.7 to 14, min 0 to 3.9, in the
  same frames. The near-black shade is the OsmDemo light rig (the approved
  darker exposure, DEC-LIGHT-9, and its hemisphere fill), not the tree or
  barrier colours.
- **Why the prescribed fix cannot reach it**: shaded-side luma 5 is linear
  0.0015, the floor 40 is linear 0.021, a factor of about 14. The crowns'
  linear albedo is about 0.22 (hedge 0.17), so even a white vertex colour
  multiplies it by at most 4.5; the floor is out of reach at any of 30, 35
  or 40 (linear factors 8.6, 11 and 14) without washing out the lit side.
- Compared with `main`, by the diff: `main`'s trees were `0x3f7d4a` (linear
  luma 0.16, so M1's crowns are about 1.3 times brighter) and its hedges and
  walls the raw `0xc8ccd8` (about 0.8 used as linear, so M1's hedge is about
  4.7 times darker; its shaded side on `main` would read about 20).
- Not done: the globe lab (it draws trees and barriers through the same
  `cityObjects`) needs live tiles and Overpass at street level; its grade
  differs, so it is measured at the owner's look rather than here.
- Decision needed (owner): accept the shade as the rig's look, or lift the
  rig's shadow fill for every surface (a light-dialog change, measured
  against DEC-R4-5's margin), not a tree-only fix.

## Why one rule

Two pipelines side by side is what made the V2 Heidelberg two-toned: kept
buildings came raw from the library next to converted invented houses. Each
layer still drawing raw is a place that can recreate it.
