# cloud-sun.ts

## Purpose

The sun through clouds (round-3 plan
`GpsPlusSlamJs_Docs/docs/2026-09-27-0532-owner-feedback-round-3-plan.md`,
stream D; DEC-FB3-6): how the sun
DISC and the light scattered FORWARD out of a cloud look when a cloud is in
front of the sun. CPU twins and their GLSL; `SkyAtmosphere` switches them
(`configure({ sunThroughClouds })`, off by default).

- **The disc dims much faster than the sky behind the cloud.** The disc is
  ~15 000 times brighter than the sky beside it, so a disc dimmed only by
  the cloud's opacity (as the diffuse sky is) stayed a white disc behind
  every cloud; a pixel of it stays white until it is dimmed to ~1e-5. The
  disc passes e^(-k·τ) = T^k of the column along the view, k the extinction
  exponent (0 = off; the look-dev page uses 4).
- **Thin cloud glows around the sun.** Sunlight scattered once through a
  cloud leaves it mostly forward: the share is τ·e^(-τ) (none in the clear,
  none through a thick cloud, most at τ = 1), spread by a phase of two
  lobes: a narrow aureole around the sun and a broad one that brightens
  thin, backlit edges (the silver lining). The glow belongs to the cloud
  (not a clear-sky halo dimmed by the cloud), which is what "strongest
  through thin cloud" asks for.

## Public API

- `CLOUD_SUN`: `aureoleG` 0.9, `silverG` 0.6, `aureoleShare` 0.5. (The
  page's disc exponent, 4, is page policy: `PAGE_DISC_EXPONENT` in the
  design system's `3d/sun-clouds.js`.)
- `cloudForwardPhase(cosθ)`: the two-lobe phase per steradian, integrating
  to 1; `RangeError` outside [-1, 1].
- `cloudForwardShare(τ)`: τ·e^(-τ); `RangeError` for τ < 0 or not finite.
- `cloudForwardPhaseOf(cosθ, aureole, silverLining)`: the phase with each
  lobe at its own strength (one switch per effect, the owner's requirement);
  at (1, 1) it is `cloudForwardPhase`; `RangeError` for a negative or
  non-finite strength.
- `cloudForwardRadiance(E, cosθ, τ, aureole, silverLining)`: E ·
  phase(of the two strengths) · share.
- `cloudDiscTransmittance(τ, k)`: e^(-k·τ); `RangeError` for negative or
  non-finite values.
- `CLOUD_SUN_GLSL`: `atmForwardLobe`, `atmForwardPhase(cosθ, strengths)`
  (x the aureole's, y the silver lining's), `atmForwardShare`;
  no uniform, include-guarded. The sky's `atmCloudForwardRadiance` and
  `atmCloudDiscTransmittance` (in `atmosphere-glsl.ts`) use it.

## Invariants & assumptions

- **The sheet draws no aureole or silver lining** (round-3 review, finding
  3): the dome adds the glow in scene-linear light next to its cloud, and
  the slab after its march, but the sheet blends its cloud over the sky
  with straight alpha, where an added glow would be scaled by the cloud's
  own density (least at the thin edges it is for). Not built; the look-dev
  panel's hint says so. The disc dims in every mode (it is the sky's).

- **A clear sky is unchanged:** the share is 0 at τ = 0 and the disc's
  factor is 1; the look-dev smoke measures both at the same pixels (within
  1 level).
- **The phase is a density:** it integrates to 1 over the sphere, so the
  glow's brightness is E × a probability, not a free gain (the two lobe
  strengths are the free knobs, 1 = the model).
- **The disc exponent is an art knob, not physics.** Physically the direct
  beam is e^(-τ) (k = 1), and a real sun behind τ = 3 still outshines the
  sky by ~750x; k = 4 makes the disc merge into a cloud of τ ≈ 3 (measured
  in the dome: 765 → 724 levels, the cloud's own). Through thin cloud
  (τ ≈ 1) the disc stays white at k ≤ 4, as a real one does.
- **Near the sun the frame is nearly white anyway** (Neutral, noon: the
  cloud 2-4° from the sun reads ~720 of 765), so both effects are measured
  in tens of levels, not hundreds; the owner judges the look.
- The two lobes' shares and asymmetries are unswept taste values (the
  record lists them as an open question).

## Example

```ts
atmosphere.configure({
  sunThroughClouds: {
    discExponent: 4,
    aureole: 1,
    silverLining: 1,
  },
});
```

## Tests

- `cloud-sun.test.ts`: the phase integrates to 1, falls with the angle,
  has a narrow and a broad lobe; the share's ends and peak; the radiance's
  product and its off state; the disc dims faster than the diffuse sky
  (below T² for τ 0.5-3 at k = 4, 1/81 at T = 1/3, < 1e-5 at τ = 3), and
  is 1 when off or clear; the GLSL's constants, guard and absence of
  uniforms.
- `atmosphere-glsl.test.ts`, `cloud-slab.test.ts`, `sky-atmosphere.test.ts`:
  where the sky, the dome and the slab use it, and the uniforms that switch
  it.
- `GpsPlusSlamJs_DesignSystem/3d/sun-clouds.smoke.spec.mjs`: on the GPU,
  against the no-effect baseline at the same pixels.
