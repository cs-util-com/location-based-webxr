# sun-shadow.ts

## Purpose

The three.js half of the sun shadow (AR sun shadow prototype plan
`GpsPlusSlamJs_Docs/docs/2026-09-23-2343-ar-sun-shadow-prototype-plan.md`,
§3.2, M2). It drives a caller's `DirectionalLight` as the shadow-casting sun.
The shadow map is re-rendered only when the pure rig
([`sun-shadow-rig.ts.md`](sun-shadow-rig.ts.md)) says so. The look-dev page
uses it (M2, the S1 cost and look check); OsmDemo AR comes next (M3).

## Public API

- `enableSunShadows(renderer)`: `shadowMap.enabled`, PCF. Call it BEFORE
  the first frame that uses shadows. Switching mid-session recompiles every
  lit material, which is a visible hitch in AR (exploration §5.3).
- `createSunShadow({ light, mapSize?, distanceM?, thresholds? })` returns a
  `SunShadow`. It makes `light` a caster with a manual map (`autoUpdate`
  off) of `mapSize`² texels (default 1024). `RangeError` for a map size that
  is not a positive integer.
- `SunShadow`:
  - `update(now: ShadowUpdateState)`: `true` when it moved the light to the
    rig's pose, set the camera bounds and the normal bias, and set
    `shadow.needsUpdate`; `false` otherwise. It keeps the last-rendered state
    itself, as the rig requires.
  - `renders`: how many maps it requested.
  - `dispose()`: restores the light as it was found (see below) and frees
    the map. Idempotent. `update` does nothing after it.

## Invariants & assumptions

- **Cost.** A map render happens only on the rig's triggers: the sun moved
  more than 0.05°, the user left the inner quarter, or the casters changed.
  Every other frame only samples the existing map.
- **Normal bias of about one ground texel** (2R / mapSize, plan §3.2).
- **Bounds are metres.** The light's parent must carry no scale, and its
  target must be in the scene graph, or three will not update its matrix.
- **The caller owns** which objects cast and receive, and the elevation
  floor. It checks `sunShadowActive` before calling `update`, because the
  pose throws for a sun at or below the horizon.
- **Every `update` call puts the light back at the last-rendered pose**
  (M2 review, finding 1). three builds the shadow camera from the light's
  position WHEN the map renders, which may be frames after `update`; the
  look-dev page re-aims the light at 1 km in every look change, and a
  pending render once came out empty from there. So a caller may move the
  light between calls, but must call `update` after doing so.
- **`dispose` restores the light as it was found at `createSunShadow`**:
  cast flag, manual-map flags, normal bias, map size, position, target and
  camera bounds (M3 hands over the scene's fixed light). A caller that aims
  the light itself must re-aim it after `dispose` (the look-dev page does).
- **The stored state is a copy**, so a caller may reuse scratch arrays.
- **A stale map is dropped at create**: three reallocates a map only when
  there is none, so an old one would keep its size.

## Example

```ts
enableSunShadows(renderer); // once, before the first frame
const shadow = createSunShadow({ light: sun, mapSize: 2048 });
if (sunShadowActive(elevationDeg)) {
  shadow.update({
    sunDir,
    centre,
    halfWidthM: 25,
    casterGeneration: 'city',
    casterOffsetM: 0,
  });
}
```

## Tests

`sun-shadow.test.ts` (no GPU) covers:

- the caster setup and the map size refusals;
- one render for the first state, none for the same state, one after a sun
  step;
- the light and camera at the rig's pose, and the bias;
- the restore on dispose, and no updates after it;
- `enableSunShadows`.

The look-dev smoke (`GpsPlusSlamJs_DesignSystem/3d/lookdev.smoke.spec.mjs`)
is the GPU check at noon, hazy and golden: the ground behind the tallest
building gets darker; a diffuse sunlit roof and sunlit ground do not, and
an acne bias (0.1) visibly darkens the roof; the manual flags are back
after a render; a change that leaves the sun alone renders no map and adds
no draws (77), a sun move adds one map (126 draws); off and on again works;
a pending render survives another change in the same task.
