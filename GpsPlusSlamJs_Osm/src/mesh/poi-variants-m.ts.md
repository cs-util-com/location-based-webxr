# `mesh/poi-variants-m.ts`

> **Pruned to the winners (DEC-R7b-2a, round 8).** This file was one of
> seven candidate sets the owner compared in the gallery. They chose, the winners
> were adopted into `POI_MODELS`, and every kind in this file that LOST was
> deleted. What remains is the geometry the demo actually renders, so this is now
> a model source rather than a variant source. The registry that used to consume
> it (`poi-variants.ts`) is gone; `poi-models.ts` imports the map directly.

## Purpose

The four POI models the owner liked in `poi-markers.html`, rebuilt on our
primitive vocabulary — `leisure=pitch`, `amenity=bicycle_parking`,
`amenity=fast_food`, `historic=archaeological_site`.

See [`poi-models.ts.md`](./poi-models.ts.md) for how these builders reach the
scene: `poi-models.ts` imports the map directly and `adopted()` grounds and
scales each mesh. The old `poi-variants.ts` registry that used to do that was
deleted with the losing models (DEC-R7b-2a).

## Public API

- `M_VARIANTS: ReadonlyMap<string, () => MeshData>` — one builder per kind, at
  M's own scale. The registry grounds and rescales; this file does not.
- `M_PALETTE` — the palette values an M port may paint with, under the source's
  own names. Pinned in `poi-variants.test.ts`.

## Invariants & assumptions

- **NOTHING IS SUBTRACTED**, as in `B` and unlike `D` and `P`. M builds each
  payload from `y = 0` and translates the merged result by `PLINTH_H = 0.23` at
  assembly, so payload coordinates are already ground-relative. Subtracting a
  plinth height anyway would sink every model by 23 cm.
- **`y` is the BOTTOM for solids and the CENTRE for planes and blobs.** M states
  this in its own header — _"For bx/cy/co the `y` argument is the BOTTOM of the
  part (before rotation); for ic/qz/qy/dy it is the centre."_ — and the helpers
  mirror the split rather than unifying it, so a port reads off the source.
- **"Before rotation" is load-bearing.** M composes `T · R · S` with the
  translation at `y + h/2`, so a rotated part turns about its own centre and
  then has that centre placed. The helpers emit at `-h/2` under a transform for
  exactly this reason; emitting at `y` and rotating would swing the part about
  its foot.
- **Cylinders are top-radius-first** (as `D` and `P`, unlike `B`). `cyM` swaps
  them once.
- **The accent is resolved at port time.** M's builders take an `accent`
  argument that the renderer supplies from a `FAMILY` table; a variant is one
  fixed mesh with no family to look up, so each port bakes in the colour its
  kind resolves to — `green`/`foliageTeal` for pitch, `move`/`roofSlate` for
  bicycle parking, `food`/`mustard` for fast food, `culture`/`terracotta` for
  the dig. Each is named in a comment beside its use.
- **`leisure=pitch` needs per-face painting.** Its slab is paved on the sides and
  grass on top — M's `topFace` helper repaints the `+Y` face of one box, which
  is our `box(..., { top })`. Building it as two boxes would z-fight.

### Known approximations

- **Icosahedra become UV spheres**, with the Y squash carried faithfully through
  `sphere`'s `radiusY`. `amenity=fast_food`'s bun is squashed to 62 %; round, it
  reads as a gumball.
- **The dig's jitter is dropped.** M perturbs one 6 cm stone by 1.2 cm through a
  seeded `mulberry32`. That is noise rather than structure, and porting the RNG
  to reproduce it would buy nothing a reader could see. Recorded rather than
  hidden.

## Examples

```ts
const build = M_VARIANTS.get("amenity=fast_food");
const mesh = scaledToHeight(groundedMesh(build!()), 2.4); // what `adopted()` does
```

## Tests

- `poi-variants.test.ts` — the shared registry contract (base at `y = 0`, finite
  positions, outward winding, height matching the shipped model) plus the
  palette assertion that keeps `M_PALETTE` from drifting.
- `poi-primitives.test.ts` — the primitives each port composes, including
  `sphere`'s `radiusY` and `box`'s per-face painting.
