# two-map-shadow.ts

## Purpose

The shader side of the cached two-map sun shadow: a text rewrite of three's
`lights_fragment_begin` chunk that makes the sun (directional shadow 0)
read its sharp NEAR map inside that map's frustum and the coarse FAR map
(directional shadow 1, carried by a light of zero intensity) outside it,
with a short fade between them. The lights are driven by
[`two-map-sun-shadow.ts`](two-map-sun-shadow.ts.md).

## Public API

- `withTwoMapShadow(chunk)`: three's `ShaderChunk.lights_fragment_begin`
  with the rewrite. Install it once per page, before the first lit program
  compiles.
  - Idempotent, detected by the marker comment `TWO-MAP SHADOW`.
  - `TypeError` for a chunk that is not a string.
  - `Error` when three's shadow line is not found, so a three upgrade that
    rewords it fails loudly instead of leaving the far city unshadowed.
- `FADE_END_DEPTH` (0.995): where the near map's depth fade ends; it starts
  at `FADE_START_DEPTH` (0.98) from [`shadow-fit.ts`](shadow-fit.ts.md).

## Invariants & assumptions

- **Inert with fewer than two directional shadows**: the rewritten branch
  needs `NUM_DIR_LIGHT_SHADOWS >= 2`, so a page with one shadow, or none,
  compiles three's own program.
- **Shadow 0 is the sun, shadow 1 the far map.** three sorts casting lights
  first and then by traversal order, so the far light is added after the
  sun, under the same parent. Swapped, the sun would lose its shadow; the
  controller's tests pin the order.
- **The near map is chosen by its whole frustum, depth included.** x and y
  are lateral to the sun's ray, so at a low sun far ground along the sun's
  azimuth projects inside the square; the depth fade (0.98-0.995) is the
  only seam there. Laterally the weight fades over the outer tenth of the
  square.
- **The far light's own lookup is skipped** (it carries no light), and the
  sun's shadow intensity applies to both maps, so the strength ramp at a
  low sun dims both.
- **Why a chunk rewrite and not three's CSM**: CSM assigns every material's
  `onBeforeCompile` instead of chaining it, and re-renders every cascade
  every frame. This replaces no material hook.
- **`ShadowMaterial` receivers are not handled**: its mask multiplies every
  directional shadow, so it would apply the far map on top of the near one.
- **A shadow count change recompiles every lit program** (it is part of
  three's program key), so tiers switch rarely and the controller keeps the
  count unchanged across the sun's floor.

## Example

```ts
THREE.ShaderChunk.lights_fragment_begin = withTwoMapShadow(
  THREE.ShaderChunk.lights_fragment_begin
);
```

## Tests

- `two-map-shadow.test.ts` runs against the real `THREE.ShaderChunk`: both
  maps read for the sun, the depth test and fade constants, three's
  fallback line kept, idempotence, and both refusals.
- `GpsPlusSlamJs_DesignSystem/3d/pages.fast.spec.mjs` loads the look-dev
  page, which installs the rewrite through the `/fw/` route.
