# two-map-sun-shadow.ts

## Purpose

The three.js controller of the cached two-map sun shadow over a city. The
sun light carries a NEAR map that follows the orbit target and is fitted to
the camera distance; a second light of zero intensity, added after the sun
under the same parent, carries a FAR map over the whole loaded city. Both
maps render only on the update rule's events, never per frame. The shader
side is [`two-map-shadow.ts`](two-map-shadow.ts.md), the geometry
[`shadow-fit.ts`](shadow-fit.ts.md), the rules
[`two-map-shadow-rig.ts`](two-map-shadow-rig.ts.md); each map is a
[`createSunShadow`](sun-shadow.ts.md).

## Public API

- `createTwoMapSunShadow({ sun, parent, tier, options? })` returns a
  `TwoMapSunShadow`. `RangeError` when `sun` is not a child of `parent`.
- `TwoMapShadowOptions` (all optional): `k`, `halfWidthSteps`, `floorDeg`,
  `fullDeg`, `marginM`, `fadeFraction` (defaults from `SHADOW_FIT`);
  `sunUpdateDeg`, `innerFraction` (defaults from `SUN_SHADOW`); `split`
  (render near and far in alternate frames); `tiers` (default
  `SHADOW_TIERS`).
- `TwoMapShadowInput { sunDir, target, cameraDistanceM, city,
casterGeneration }`: what the app knows this frame. `RangeError` for a
  non-finite direction or target or a non-positive camera distance.
- `TwoMapSunShadow`:
  - `update(input)`: sets the shadow strength from the sun's elevation,
    places the sun light along the current sun, requests the renders the
    rule asks for and returns the `MapRenderPlan` (`again` asks the caller
    for one more frame when `split` deferred the far map).
  - `release()`: frees both maps' GPU memory; `update` renders nothing
    until `restore()`, after which the next `update` renders both once.
  - `setTier(tier)`: rebuilds the maps for the tier; `off` stops casting
    and removes the far light. A release stays in force.
  - `renders`: map renders requested so far, both maps together.
  - `farLight`: the far light, or `undefined` with one map.
  - `dispose()`: drops the maps and the far light and restores the sun's
    shadow intensity; idempotent, and nothing works after it.

## Invariants & assumptions

- **When maps render**: a sun step or a caster change renders both; a pan
  past the re-centre threshold (a quarter of R) or a zoom across a half
  width step renders only the near map; an orbit around the same target at
  the same distance renders nothing.
- **The near map** has R = `nearShadowHalfWidth(cameraDistanceM)`, its
  centre snapped to the texel grid, D from `shadowCasterDistance` and its
  far plane from `nearFadeFar`, so the shader's depth fade starts
  `fadeFraction x R` past the centre. **The far map** covers the city's
  square around its centre with the whole square's depth.
- **The `low` tier** is one map: the sun carries the city's bounds and no
  far light exists.
- **The sun is light 0 and shadow 0 in every tier**: the far light is
  added after the sun under the same parent.
- **Below the floor** (2 degrees by default) and below the horizon: the
  shadow intensity is 0, no map renders, the shadow count (three's program
  key) is unchanged, and the sun light still points along the current sun
  from the last centre, so the lighting stays right.
- **Depth bias is 0 on both lights**; the one-texel normal bias in metres
  carries the offset.
- **The far light has no intensity**: it exists only to carry a map.

## Example

```ts
THREE.ShaderChunk.lights_fragment_begin = withTwoMapShadow(
  THREE.ShaderChunk.lights_fragment_begin
);
const shadow = createTwoMapSunShadow({ sun, parent: scene, tier: 'high' });
// Per frame:
const plan = shadow.update({
  sunDir,
  target,
  cameraDistanceM,
  city,
  casterGeneration,
});
if (plan.again) requestRender();
```

## Tests

- `two-map-sun-shadow.test.ts` (real three, no renderer): one render per
  map for a sun step and none for the same state; split frames; orbit,
  pan, zoom and caster cases; the floor and the horizon; the light order
  in every tier; bias 0; each shadow camera's projection matrix against
  its bounds; release and restore; `setTier('off')`; dispose; refusals.
- `two-map-sun-shadow.property.test.ts`: over random event sequences, each
  frame requests exactly the renders the rule names and the total matches.
