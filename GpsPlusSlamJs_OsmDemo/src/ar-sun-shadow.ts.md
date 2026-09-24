# ar-sun-shadow.ts

## Purpose

OsmDemo's pieces of the AR sun shadow prototype (plan
`GpsPlusSlamJs_Docs/docs/2026-09-23-2343-ar-sun-shadow-prototype-plan.md`,
§10, M3):

- the `?sunShadow` switch;
- which objects cast;
- the test pole;
- the shadow-receiving plane;
- a frame-time buffer.

The light, the rig and the map policy are the framework's
(`visualization/sun-shadow`, `visualization/sun-shadow-rig`). The AR wiring
lives in `ar-mode.ts`.

## Public API

- `sunShadowEnabled(search)`: ON only for `1`, `on` or `true` (any case,
  trimmed). Absent, empty or any other value is OFF. That is the opposite
  default to `?autoElevation`, on purpose (plan §7 item 17).
- `AR_SHADOW_CASTER`, `markArShadowCaster(object)`: the userData tag of an
  object that casts. It is set where the object is BUILT: ground POI pins
  (`mesh-layers.ts`), quest beacon meshes (`quest-beacon.ts`) and the pole.
- `applyArShadowCasting(root, on)`: sets `castShadow` on every mesh under
  `root`, true only for tagged meshes while `on`. Returns the number of
  casters, which feeds the map's caster generation.
- `SHADOW_POLE`, `createShadowPole()`: the 1.5 m × 5 cm test caster, standing
  on its base, tagged (plan §7 finding 1).
- `createShadowPlane(halfWidthM, opacity)`: a `ShadowMaterial` square that
  draws only the shadow. It never casts, has no fog, does not write depth,
  and has a negative polygon offset against the coplanar ground layers.
  `RangeError` for a bad size or opacity.
- `createFrameTimes(capacity = 300)`: a ring of frame times in ms. `summary()`
  gives nearest-rank p50 / p95 and the max, or `null` when empty.
  Non-finite or negative values are ignored.

## Invariants & assumptions

- **Casting is decided at build time, never re-derived.** A roof-hosted pin,
  a tree, an X-ray shell or a cell is simply never tagged, so no later rule
  can make it cast. Their real counterparts already cast the real shadows
  (plan §2 Q1, §7 item 9).
- **The plane is the only receiver.** In AR everything else is either the
  camera image or an overlay.
- **The frame times exist because the HUD's fps is a window mean.** That
  mean is blind to the one frame that renders a shadow map (plan §7
  item 7).

## Example

```ts
if (sunShadowEnabled(location.search)) {
  const pole = createShadowPole();
  const plane = createShadowPlane(SUN_SHADOW.halfWidthM, shadowOpacity(0.3));
  applyArShadowCasting(contentRoot, true);
}
```

## Tests

`ar-sun-shadow.test.ts` covers:

- the switch's values;
- tagged-only casting and turning it off;
- the pole's shape and tag;
- the plane's material flags, size and refusals;
- the frame-time percentiles, the ring's overwrite, and the refusals.
