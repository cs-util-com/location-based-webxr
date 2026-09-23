# atmosphere-haze.ts

## Purpose

Sky-matched aerial perspective for three.js's own materials (plan DEC-SKY-5):
distant geometry fades toward the sky's colour in its own view direction,
with the air's per-channel extinction, replacing the one-colour fog. An
`onBeforeCompile` patch of three's fog chunks.

## Public API

- `AtmosphereHaze` — `new AtmosphereHaze({ visibilityKm, observerAltitudeKm?, densityScale? })`
  - `apply(material)` — patch one material; idempotent while the patch is
    intact, re-patches if the hook was replaced (see below);
    THROWS if another `AtmosphereHaze` already patched it (two hazes would
    stack two fades and fight over one cache key). Chains an existing
    `onBeforeCompile` (bound, runs first) and extends the program cache key
    with the previous patch's identity (`|atmosphere-haze` suffix).
  - `applyToObject(root)` → how many materials were newly patched or healed (skips
    `fog: false`, `toneMapped: false` materials, which draw in display
    space where a scene-linear haze would be wrong, and `ShaderMaterial`s).
  - `sync({ sharedUniforms, visibilityKm })` — copy the current atmosphere's
    state (sun, scale, sky-view LUT, visibility) in, and derive the
    observer altitude from its `atmObserverRadius` (validated). Call after
    the atmosphere changes or is replaced.
  - `setMode('atmosphere' | 'fog')` — `'fog'` = three's stock fog with a
    neutral 1×1 texture bound (AR, or no atmosphere yet).
  - `mode` — the requested mode (so an AR session can restore it).
  - `setDensityScale(k)` — multiplier on the physical extinction (≥ 0).
  - `uniforms` (the haze's own shared objects), `dispose()`.
- `HazeAnchorError` — thrown at compile time when three's shader lacks an
  anchor the patch hooks.
- Pure twins of the GLSL: `hazeExtinctionPerMetre(visibilityKm,
observerAltitudeKm)`, `hazeTransmittance(distanceM, extinctionPerM)`,
  `hazeBoundaryFade(depth, near, far)`.

## Invariants & assumptions

- The haze runs BEFORE `<tonemapping_fragment>`, in scene-linear light. three
  applies its own fog after tone mapping and the output conversion (display
  space); in `'atmosphere'` mode that stock fog is skipped.
- `keep = exp(−σ·d) · (1 − boundary)`: physical extinction times three's
  linear-fog ramp from `fog.near` to `fog.far`. `scene.fog` must be a
  `THREE.Fog` (or `FogExp2`): it enables the chunks and still carries
  near/far, so the fade completes at the far plane.
- The in-scatter colour is the sky-view LUT in the view direction, clamped
  just above the horizon (below it the LUT holds the ground) by
  `atmHorizonClampedDir` — the SAME clamp the visible sky uses, so a hazed
  ridge meets the sky above it without a seam. The clamp height
  (`EARTH_ATMOSPHERE.horizonClampDirY`, 0.02) was swept: noon and hazy stay
  within ±15 % of the unclamped horizon; golden-hour anti-sun moves
  −18 %…+42 %; a taste knob, parked for the owner (plan §13).
- THE HAZE OWNS ITS UNIFORMS. Patched materials capture them for good; an
  atmosphere that is disposed and rebuilt needs only `sync`. (The first
  version borrowed the atmosphere's objects, which a rebuild would have left
  stale in every material.)
- Mode `'atmosphere'` takes effect only after a `sync` supplied a LUT.
- SELF-HEALING, because a later plain assignment of `onBeforeCompile`
  drops the patch (three has one hook slot, so no API can prevent it; plan
  §5's "an installer run after the haze does not remove it" is met this way
  instead). The haze records the hook and key it installed; `apply` and
  `applyToObject` re-patch a material whose hook was replaced, chaining the
  new hook first and keying the program by the NEW hook's source (the
  haze's old key would otherwise make three reuse the stale program). An
  app whose installers assign late re-applies before each render; an
  unchanged material costs one comparison.

## Examples

```ts
const haze = new AtmosphereHaze({ visibilityKm: 45 });
haze.applyToObject(scene);
haze.sync(atmosphere); // after every atmosphere change
haze.setMode(inAr ? 'fog' : 'atmosphere');
```

## Tests

- `atmosphere-haze.test.ts` — the pure terms (fade 0 at near, exactly 1 at
  far), three's REAL ShaderLib shaders (standard, physical, basic, lambert,
  phong, and points, sprite, dashed, toon, matcap) patched with the haze
  before tone mapping, shared uniform objects, chaining and its ORDER,
  distinct cache keys, idempotence, self-healing after a replaced hook (the
  new hook first, a key naming it, a custom key kept), the second-owner
  refusal, the named
  anchor error, subtree application (skips included), modes, sync after an
  atmosphere replacement (altitude derived), density.
- Pixels: the look-dev smoke asserts the haze changes the distant ridges
  several times more than the near city; that every changed ridge pixel
  moved TOWARD the sky just above it (direction, not only magnitude); and
  that at golden hour the hazed distance is brighter toward the sun than
  away from it, across three pixel-selection floors. The stand-in world
  draws Lambert, sprite and line materials so each patched family compiles
  under the console check.
