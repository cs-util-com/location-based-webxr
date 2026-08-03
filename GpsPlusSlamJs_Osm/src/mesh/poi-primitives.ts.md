# `mesh/poi-primitives.ts` — low-polygon shapes for POI models

## Purpose

The primitives the fifty POI models are composed from: boxes, prisms, slabs on
legs, posts with heads, canopies and pitched huts.

## Public API

All take a `MeshBuilder` and append to it; `composed(build)` wraps one
composition into a `MeshData`.

- `box(builder, width, height, depth, base?, offsetX?, offsetZ?, faces?)` —
  `faces` paints individual sides, keyed by `BoxFace`
  (`top | bottom | north | south | east | west`).
- `prism(builder, bottomRadius, topRadius, height, sides?, base?, offsetX?, offsetZ?)`
  — a cone when `topRadius` is 0.
- `disc(builder, radius, y, sides?, up?, offsetX?, offsetZ?)` — a flat
  horizontal n-gon.
- `quad(builder, corners, normal?)` — an arbitrary planar quad; the normal is
  derived from the corner order unless given.
- `pyramid(builder, width, depth, height, base?, offsetX?, offsetZ?)` — a
  rectangular-based spire, which `prism`'s cone is not.
- `sphere(builder, radius, centreY, segments?, rings?, offsetX?, offsetZ?,
radiusY?)` — `radiusY` squashes it along Y into an ellipsoid of revolution,
  defaulting to `radius`.
- `slabOnLegs(builder, width, depth, seatHeight, slabThickness?, legThickness?)`
- `postWithHead(builder, postHeight, postRadius, headWidth, headHeight)`
- `canopy(builder, width, depth, height, roofThickness?, postThickness?)`
- `hut(builder, width, depth, wallHeight, ridgeHeight, base?)`
- `composed(build): MeshData`
- `type BoxFace`

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
- **Every triangle is wound so its vertex order agrees with its own normal, and
  this was WRONG from W16 until §4.** `box` and `prism` emitted every face
  reversed, and through them so did `slabOnLegs`, `canopy`, `postWithHead` and
  `hut`'s roof slopes — which is all fifty models. The POI material is
  `FrontSide` (three's default; nothing overrides it for markers) and
  `flatShading: true`, so three derives the shading normal from the winding and
  the attribute is ignored: what was drawn was each marker's far INTERIOR wall.
  - **Why it survived.** The silhouette is unchanged and the object still reads
    as a bench. `mesh-orientation.test.ts` pins exactly this property but only
    for `extrude.ts` and `roof.ts`, the two emitters already caught once;
    `poi-primitives.ts` was never covered. `poi-models.test.ts` asserted counts,
    bounds and finiteness, and a reversed winding disturbs none of them.
  - **`hut`'s GABLES were always right** and only its slopes were wrong, which
    is why `amenity=place_of_worship` was the single model still failing after
    the primitives were fixed.
  - **Two corner conventions coexist, on purpose.** `box`'s six corner lists run
    clockwise seen from outside and are emitted reversed; `quad` and `pyramid`
    take the natural convention — counter-clockwise as seen from the direction
    the normal points — and are emitted in order. Rewriting six corner lists is
    six chances to get one wrong, so the older ones were left alone. **The only
    reason either can be trusted is the winding suite**, which covers every
    primitive, and the registry-wide guard in `poi-models.test.ts`, which covers
    every composition.
- **`sphere`'s poles are fans, not quads.** A latitude loop emits a collapsed
  quad at the top and bottom rings; each is a zero-area triangle, which becomes
  a NaN normal and removes the whole object from the scene. `prism` already had
  to learn this for its cone case.
- **`quad` falls back to `+y` for a degenerate quad** rather than emitting a NaN
  normal, for the same reason.
- **A squashed `sphere` carries the ELLIPSOID's normal, not the unit sphere's.**
  Under a `(1, k, 1)` scale positions scale by `k` but normals scale by the
  inverse transpose, `1/k`, renormalised. Reusing the sphere direction would
  leave every normal tilted toward the poles — shading a flattened canopy as
  though it were still round, with no change to the silhouette, so it would
  survive a screenshot review. `radiusY` exists because four of the six POI
  prototypes build rounded parts from an icosahedron under a non-uniform scale,
  and the owner is judging exactly those shape differences.

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
plausible real-world size, a triangle ceiling, **winding that agrees with the
normals for every triangle of every model**, and colour buffers aligned to their
positions.

`poi-primitives.test.ts` covers each primitive directly — vertex count, bounding
box, closed-solid signed volume, no degenerate triangles at a sphere's poles,
per-face painting, and the winding suite that found the W16 inversion.
