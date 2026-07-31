# `mesh/poi-primitives.ts` — low-polygon shapes for POI models

## Purpose

The primitives the fifty POI models are composed from: boxes, prisms, slabs on
legs, posts with heads, canopies and pitched huts.

## Public API

All take a `MeshBuilder` and append to it; `composed(build)` wraps one
composition into a `MeshData`.

- `box(builder, width, height, depth, base?, offsetX?, offsetZ?)`
- `prism(builder, bottomRadius, topRadius, height, sides?, base?, offsetX?, offsetZ?)`
  — a cone when `topRadius` is 0.
- `slabOnLegs(builder, width, depth, seatHeight, slabThickness?, legThickness?)`
- `postWithHead(builder, postHeight, postRadius, headWidth, headHeight)`
- `canopy(builder, width, depth, height, roofThickness?, postThickness?)`
- `hut(builder, width, depth, wallHeight, ridgeHeight, base?)`
- `composed(build): MeshData`

## Invariants & assumptions

- **Real-world size, base at `y = 0`, centred on `x`/`z`.** The consumer places
  an instance with a translation alone, because the size varies per KIND rather
  than per instance. A model whose base is not at zero renders half-buried, which
  reads as a shorter object rather than as a bug — the same failure the tree
  cones' half-height offset was.
- **Coordinates are ENU here** (`+y` up, `+z` north). `MeshBuilder.vertex`
  applies the reflection into the render frame itself; emitting render-frame
  coordinates would double-apply it.
- **Every face carries its own vertices**, so normals stay flat rather than being
  averaged across an edge — the low-polygon look depends on it.
- **A cone emits one triangle per side, not two.** At `topRadius = 0` the upper
  quad is degenerate, and a zero-area face per side becomes a NaN normal
  downstream.
- **Prism caps are closed at both ends.** A marker on a slope shows its
  underside, and an open shell reads as a hole rather than as a saving.
- **`hut` takes a `base`, and that is not decoration**: the hunting stand's cabin
  belongs on top of its legs, and built at base 0 it sat around their feet — a
  hide at ground level, which is the one thing a hunting stand is not. The
  contract test found it.
- **These are not "shape families".** That option was offered and rejected; each
  of the fifty models composes its own arrangement, and these are the parts.

## Examples

```ts
const mesh = composed((b) => {
  slabOnLegs(b, 1.8, 0.5, 0.45); // seat
  box(b, 1.8, 0.4, 0.06, 0.45, 0, -0.22); // back
});
```

## Tests

`poi-models.test.ts` enforces the contract by iterating the registry: non-empty
geometry, no NaN, base at `y = 0`, a derived height that matches the mesh,
plausible real-world size, and a triangle ceiling.
