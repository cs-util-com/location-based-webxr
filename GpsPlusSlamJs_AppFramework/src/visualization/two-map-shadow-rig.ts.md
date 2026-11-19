# two-map-shadow-rig.ts

## Purpose

The pure rules of the cached two-map city shadow: the quality tiers, which
tier `auto` means on a device, which caster mode the held inputs give,
which shadow flags each layer gets in a mode, when the caster set changed,
and which maps render in a frame. No three.js.

## Public API

- Types: `ShadowCastingMode` (`off | ar | city`), `ShadowTier`
  (`off | low | phone | high`), `ShadowChoice` (`auto` or a tier),
  `ShadowDeviceClass` (`desktop | phone`), `ShadowTierSpec { maps: 1 | 2,
nearSize, farSize? }`.
- `SHADOW_TIERS`, frozen:
  - `low`: one map of 1024. The sun itself carries the whole city's
    bounds, no far light exists, and the shader rewrite stays inert.
  - `phone`: two maps of 1024, a placeholder until a phone measurement
    sets it.
  - `high`: two maps of 2048.
- `AUTO_SHADOW_TIER`: `{ desktop: 'high', phone: 'phone' }`.
- `effectiveShadowTier(choice, deviceClass, autoTiers?)`: the choice, or
  for `auto` the device class's tier. `RangeError` for an unknown choice,
  device class or table entry.
- `CastingInputs { arCasting, suspended, cityTier }` and
  `castingMode(inputs)`: `city` exactly when not suspended and the tier is
  on; otherwise `ar` when an AR session or a shadow check casts, else
  `off`.
- `ShadowFlags { cast, receive }`, `ShadowLayerRows { rows, fallback }` and
  `layerShadowFlags(table, mode, layer)`: the layer's row (own keys only,
  so `toString` is not a layer), or the fallback.
- `casterGeneration(build, layers, mode, table)`: a string such as
  `'build:3|buildings:2'` that changes when the build changes or a layer
  that CASTS in this mode changes, and never for a layer that does not
  cast; layer order does not matter. `RangeError` for a non-finite
  generation.
- `MapRenderPlan { near, far, again }` and `planMapRenders(input)`, with
  `input` `{ near, far, split, farDeferred? }`: with `split`, a frame that
  wants both renders the near map and asks for one more frame (`again`)
  for the far one; with `farDeferred` (the last frame deferred the far
  map) it renders the far map first, so the maps alternate.

## Invariants & assumptions

- **The mode is derived from held inputs on every change, never stored.**
  An app has several writers (the AR session, a shadow check, the city
  setting, a rebuild); a stored mode lets the last writer win, so an AR
  dispose after a resume would wipe the city's casters.
- **A layer that does not cast cannot cost a render**: a timelapse that
  thins trees which only receive leaves `casterGeneration` unchanged.

## Example

```ts
const tier = effectiveShadowTier(choice, isPhone ? 'phone' : 'desktop');
const mode = castingMode({ arCasting, suspended, cityTier: tier });
const generation = casterGeneration(build, layerGenerations, mode, table);
```

## Tests

- `two-map-shadow-rig.test.ts`: the full `castingMode` truth table, the
  tier table, `auto`, the refusals, `layerShadowFlags`,
  `casterGeneration` examples and `planMapRenders`.
- `two-map-shadow-rig.property.test.ts`: `casterGeneration` changes
  exactly when a casting layer changes and ignores order; `auto` picks the
  device tier; `castingMode`'s rule over all inputs.
