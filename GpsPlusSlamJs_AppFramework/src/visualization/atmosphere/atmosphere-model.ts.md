# atmosphere-model.ts

## Purpose

The physical atmosphere's constants and the CPU half of its maths: Earth's
Rayleigh / Mie / ozone layers (Hillaire 2020, Table 1), ray geometry on a
curved planet, optical depth, transmittance, and the sunlight a
`DirectionalLight` should carry. It is the single source of every number the
GLSL uses (`atmosphere-glsl.ts` interpolates them), and the oracle the
look-dev page compares the GPU against.

Implemented from the papers (plan DEC-SKY-1; the reviewed PlayCanvas case
study has no licence and nothing was copied from it).

## Public API

- `EARTH_ATMOSPHERE` — constants, km and /km: radii, scattering and
  absorption coefficients, scale heights, Mie albedo and asymmetry, ozone
  tent, ground albedo, sun angular radius, reference sun elevation (45°),
  default observer altitude (0.2 km), and the numerical step counts shared
  with the GLSL (optical depth 40, sky view 32, multi-scattering 16×16 × 20),
  and `horizonClampDirY` (0.02), the one horizon clamp the sky and the haze
  share.
- `mieExtinctionForVisibility(km)` — Koschmieder TOTAL extinction
  (3.912 / V) minus the Rayleigh share at 550 nm, clamped at 0. Throws
  `RangeError` for a non-positive or non-finite visibility.
- `mediumAt(altitudeKm, mieExtinction)` → `{ rayleighScattering,
mieScattering, extinction }` (`Medium`); the GLSL twin is `atmMedium`.
- `distanceToAtmosphereTop(r, mu)`, `horizonCosZenith(r)`,
  `rayHitsGround(r, mu)` — geometry (radius from the planet centre, cosine of
  the zenith angle).
- `opticalDepthToTop(r, mu, params, steps?)` — quadratic step placement (see
  invariants). Does not check for ground intersection.
- `transmittanceToTop(r, mu, params)` — `exp(−depth)`, `[0,0,0]` for a ray
  that hits the planet. Throws `RangeError` on non-finite input.
- `sunLight(sunCosZenith, params)` → `{ colour, intensity }`: colour is a
  chroma (brightest channel 1), and COLOUR × INTENSITY (what three.js
  multiplies) is `T · visibleFraction / lum(T_ref)`, the scale the sky uses;
  luminance 1 at the reference elevation. Faded over the solar disc as it
  sets.
- `sunDiscLimbDarkening(rho)` — linear limb darkening normalised to average 1
  over the disc, so the disc emits exactly the sun's illuminance.
- `luminance(rgb)` — Rec. 709, the package's one copy.

## Invariants & assumptions

- Units: kilometres and per-kilometre everywhere; `mu` is a cosine.
- Quadratic step placement (`t = ((i + 0.5)/n)²`) because uniform steps
  under-sample the 1.2 km Mie layer on a 100 km path (~10 % error); 40 steps
  stay within 0.5 % of 20 000 from the zenith to the horizon (test sweep).
- Visibility above ~290 km gives zero Mie, never negative.
- **Two constants were wrong in the first version and are verified now**
  (M1 milestone review): the Mie albedo is 3.996 / 4.44 = 0.9 (the paper
  author's reference code, not the 0.476 of reading 4.4 as absorption), and
  the sun light's colour × intensity is on the sky's scale (it was short by
  the chroma's luminance, 0.55× at golden hour).
- The sun is a disc: `sunLight` scales by the visible fraction above the
  dipped horizon and samples transmittance just above it, so the light fades
  over ~0.5° instead of popping off.
- Pure: no three.js, no DOM, no state.

## Examples

```ts
const params = { visibilityKm: 60 };
const r = EARTH_ATMOSPHERE.groundRadiusKm + 0.2;
transmittanceToTop(r, 1, params); // ≈ [0.93, 0.86, 0.75] at the zenith
sunLight(Math.sin((5 * Math.PI) / 180), params); // warm chroma, intensity < 1
```

## Tests

- `atmosphere-model.test.ts` — hand-derived zenith optical depths, Koschmieder
  split and clamp, horizon dip, ground hits, the quadrature sweep against
  20 000 steps (zenith → horizon), sun colour and disc fade.
- `atmosphere-model.property.test.ts` — monotonicity (visibility, zenith
  angle, sun elevation), transmittance within [0, 1], chroma validity.
- GPU parity: `GpsPlusSlamJs_DesignSystem/3d/lookdev.smoke.spec.mjs`.
