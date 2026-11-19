# shadow-casting.ts

## Purpose

Writes the shadow flags of a scene subtree for a caster mode: every mesh
gets BOTH `castShadow` and `receiveShadow` from its layer's row in a table,
so a mode switch never leaves a stale flag behind. The rules are
[`two-map-shadow-rig.ts`](two-map-shadow-rig.ts.md).

## Public API

- `ShadowLayerTable extends ShadowLayerRows { layerOf(mesh) }`: the app's
  rows per layer and mode, a fallback row, and how to read a mesh's layer
  (for example from `userData`).
- `applyShadowCasting(root, mode, table)`: traverses `root` (the root
  included), writes both flags on every object with `isMesh` (instanced
  meshes too) and returns how many meshes it wrote. Non-mesh objects are
  left alone. `RangeError` for an unknown mode.

## Invariants & assumptions

- **Call it after every input change and after every rebuild**, with
  `castingMode(inputs)` derived fresh each time. The function holds no
  state, so the order of events cannot matter.
- **Both flags, always**: writing only `castShadow` would leave a receiver
  from the previous mode.

## Example

```ts
const mode = castingMode({ arCasting, suspended, cityTier });
applyShadowCasting(cityRoot, mode, table);
```

## Tests

`shadow-casting.test.ts`: every order of AR start, suspend, resume, AR
stop and rebuild, with a shadow check on and off and the city tier off and
high, asserts the flags after every step equal the table's row for the
derived mode; the order "resume, then AR dispose" keeps city shadows;
instanced meshes and the root are written; an unknown mode is refused.
