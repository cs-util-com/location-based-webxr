# cloud-column.ts

## Purpose

The cloud COLUMN (round-3 plan
`GpsPlusSlamJs_Docs/docs/2026-09-27-0532-owner-feedback-round-3-plan.md`,
stream D; DEC-FB3-6 and -7): how thick the cloud layer is above a point of
the noise, and how much of a straight line of light it lets through. The
slab (`cloud-slab.ts`) marches this column along the view; every other
straight line toward the sun reads it ONCE: the sun disc behind the clouds
(the sky shader, `atmosphere-glsl.ts`) and the sun light reaching a lit
surface (the cloud shadow patch, `cloud-shadow.ts`). One model, so the
disc, the shadows on the ground and the slab agree on where the cloud is
thick.

It is a LEAF module (no shader imports), so the sky's GLSL can use it; the
slab's module imports the sky's GLSL and could not be imported back without
a cycle. The column model (constants, Q, T0, the thickness) moved here from
`cloud-slab.ts`, which re-exports it under the old names.

## Public API

- `CLOUD_COLUMN`: base 1800 m, top 2200 m, σ 0.02/m, base ramp b 50 m,
  height scale H 1000 m per noise unit, the sun's elevation floor 0.1.
  `CLOUD_SLAB` spreads it.
- `cloudSlabCumulativeM(h, b?)`: Q(h), the integral of the base ramp
  clamp(x/b, 0, 1) from 0 to h.
- `cloudSlabThresholdThicknessM(σ?, b?)`: T0 = Q⁻¹(ln 2/σ), the column
  thickness whose zenith opacity is one half; defined for any ramp.
- `cloudSlabThicknessM(noise, threshold)`: T0 + H·(noise - threshold),
  clamped to [0, 400 m]; 0 for an infinite threshold (cover 0).
- `cloudColumnOpticalDepth(noise, threshold, heightM, dirY)`: σ·(Q(T) -
  Q(h))/max(dirY, 0.1), h the point's height above the base clamped to the
  column. `RangeError` for a non-finite noise, height or slope.
- `cloudColumnDistanceM(heightM, dirY)`: metres along a line to the
  layer's middle (2 km), 0 from above it; the slope floored at 1e-3.
- `cloudColumnUv(point, dir, offset)`: where a line reads the column, the
  crossing of the middle, in noise tiles plus the drift offset.
- `cloudColumnDrawn(aerialM, horizontalM, dirY, anchored, farFadeM)`: how
  much of the cloud at a crossing the sky draws: the sheet's and the slab's
  far fade on the horizontal distance (`anchored`) or the dome's horizon
  fade on the slope, times the aerial melt. GLSL twin `atmColumnDrawn`,
  which the disc and the cloud shadows both use (round-3 review, finding
  1: a low sun's column lies past the far fade).
- `cloudColumnTransmittanceToward(point, dir, threshold, noiseAt, offset,
view?)`: e^(-optical depth × drawn) of the column the line crosses, with
  `view` `{ camera, anchored, farFadeM }` (`CloudColumnView`; omitted:
  the whole column); 1 for a light at or below the horizon and for an
  infinite threshold. The CPU twin of the
  cloud shadow patch; `noiseAt` is `cloudNoiseSample` on the CPU.
- `CLOUD_COLUMN_GLSL`: `atmColumnCumulative`, `atmColumnOpticalDepth`,
  `atmColumnDistance`, `atmColumnUv` and the constants; no uniform, and an
  include guard (`ATM_CLOUD_COLUMN_GLSL`); also `atmColumnDrawn`.

## Invariants & assumptions

- **The cover's meaning holds on every line:** straight up from the ground
  through a column at the threshold the optical depth is ln 2 (half the
  light passes), the slab's own definition of the cover.
- **One read per line:** the whole column is read where the line crosses
  the layer's middle. A slanted line crosses neighbouring columns too (at
  a 10° sun, a 400 m deck spans 2.3 km of ground), so this is an
  approximation that sharpens as the sun rises; the slab's march is the
  exact reference along the view.
- **Only the column above the point counts:** a point inside the layer sees
  part of it, a point above its top none (the "aloft" views).
- **The dome is the same layer:** from the origin the column's reading is
  the dome's texture coordinate (a 2 km plane, camera-centred), and the
  middle is `CLOUD_LAYER.altitudeKm` (a test holds them equal).
- The slope is floored at `sunMuFloor` (0.1) in the depth (as the slab's
  sun), and at 1e-3 for the crossing only.
- The GLSL twin of `cloudSlabCumulativeM` exists twice (`atmSlabCumulative`
  in the slab's march, `atmColumnCumulative` here); both are pinned to the
  one CPU function by their tests.

## Example

```ts
const t = cloudColumnTransmittanceToward(
  [x, 0, z],
  sunDir,
  cloudThreshold(0.5),
  (u, v) => cloudNoiseSample(cloudNoise(256, 1), 256, u, v),
  [offset.x, offset.y]
);
```

## Tests

- `cloud-column.test.ts`: the slab spreads the column's constants and the
  middle is the dome's altitude; ln 2 straight up at the threshold and the
  slab's zenith opacity for any noise; 1/dirY down to the floor; only the
  column above the point; monotone in the noise, 0 in the clear; the
  crossing against plain geometry, the dome's coordinate from the origin, a
  point above the middle reading its own column; the transmittance's
  exponent, horizon and clear cases, and the single read at the crossing;
  the GLSL's constants, guard and absence of uniforms.
- `cloud-slab.test.ts`: the moved column model, through the re-exports.
- The look-dev smokes (`sun-clouds.smoke.spec.mjs`) check the GPU against
  these twins.
