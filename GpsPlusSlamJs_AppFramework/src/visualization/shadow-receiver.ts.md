# shadow-receiver.ts - the shadow-only receiver recipe

- Purpose: one recipe for every surface that should show a virtual shadow
  over the camera image in AR, and nothing else (W4 AR shadows plan
  2026-09-26-0549, §6; OsmDemo's `createShadowPlane` promoted to the
  framework per DEC-H3). It serves the flat fallback plane and the
  occlusion mesh's receiver skin (`occlusion-mesh.ts`).
- Public API:
  - `SHADOW_RECEIVER_DEPTH_OFFSET` (-2): the polygon offset (factor and
    units) that keeps a receiver in front of the coplanar surface it lies on
    (the occlusion mesh's own depth, or OsmDemo's ground layers).
  - `ShadowReceiverOptions { opacity, depthOffset? }` and
    `assertShadowReceiverOptions(o)`: `RangeError` for an opacity outside
    [0, 1] or a positive offset.
  - `createShadowReceiverMaterial(options, name)`: a `ShadowMaterial`,
    transparent, `depthWrite: false`, `fog: false`, polygon offset on.
  - `applyShadowReceiverOptions(material, options)`: in place. Opacity is a
    uniform and the offset GL state, so nothing recompiles.
  - `createShadowPlane(halfWidthM, opacity)`: the flat receiver, a
    horizontal square that receives and never casts; `RangeError` for a
    size or opacity out of range.
- Invariants & assumptions:
  - A receiver never casts, and it sets `receiveShadow = true` explicitly
    (three's default is false, and a `ShadowMaterial` alone shows nothing).
  - It draws only where the real surface is the nearest thing, as
    darkening: over an alpha canvas the composite is
    `camera × (1 − opacity × shadow)`.
  - **OsmDemo still has its own copy** of `createShadowPlane`
    (`GpsPlusSlamJs_OsmDemo/src/ar-sun-shadow.ts`). Switching it to this
    module is a follow-up that needs OsmDemo's gate (about 20 min); until
    then the two must not drift (W4 plan, progress).
- Example: `scene.add(createShadowPlane(25, 0.42));`
- Tests: `occlusion-mesh.shadow-receiver.test.ts` and
  `.property.test.ts` (the recipe on the occlusion mesh's skin), and
  `ar-shadows.test.ts` (the fallback plane).
