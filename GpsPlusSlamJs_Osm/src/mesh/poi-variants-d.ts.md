# `mesh/poi-variants-d.ts`

## Purpose

The eighteen POI models the owner liked in `poi-markers-diorama (1)`, rebuilt on
our primitive vocabulary — more than any other source contributes.

See [`poi-variants.ts.md`](./poi-variants.ts.md) for why variants exist at all
and how the registry assembles and rescales them.

## Public API

- `D_VARIANTS: ReadonlyMap<string, () => MeshData>` — one builder per kind, at
  **D's own diorama scale**. The registry grounds and rescales; this file does
  not.
- `D_PALETTE` — the palette values a D port may paint with, under the source's
  own names. Pinned in `poi-variants.test.ts`.

## Invariants & assumptions

- **`T = 0.10` is D's plinth thickness**, subtracted from every part's `y`.
- **`y` is a part's CENTRE** except in `gableD`, where the source builds upward
  from a base. Getting that one wrong sinks the part by half its height, which
  on a weather hood reads as a design choice rather than a bug.
- **Cylinders are top-radius-first** — three's `CylinderGeometry(radiusTop,
radiusBottom, …)` — where our `prism` takes bottom first. `cylD` swaps them
  once. A bin that tapers the wrong way is still a bin, so **no assertion
  catches this**.
- **Two entries are not in the owner's liked list for D**: `amenity=post_box`
  (liked from B) and `amenity=waste_basket` (liked from G). Both are kept
  deliberately — for both kinds the shipped model is one the owner has not
  endorsed, so a second opinion is worth having in the row.

### Known approximations

- **Icosahedra become UV spheres.** D's canopies and caps are icosahedra; we
  have none, and at a marker's screen size a low-ring sphere is the same read.
  `sphere` now takes a `radiusY`, so a _future_ revision of this file could
  carry D's squashes as `poi-variants-p.ts` does — it currently does not.
- **`gableD` is a square pyramid**, not a ridged prism. Our vocabulary has no
  ridged prism and at a weather hood's size the difference is one edge. If a
  later model needs a true gable it is `hut`'s roof half.

## Examples

```ts
const build = D_VARIANTS.get("amenity=cafe");
const mesh = scaledToHeight(groundedMesh(build!()), 3.0); // what the registry does
```

`groundedMesh` is not optional here: several D models have parts extending DOWN
into the plinth — `leisure=picnic_table`'s A-frames reach 3 cm below its top —
which is invisible in the source and hangs below ground once the plinth is
stripped.

## Tests

- `poi-variants.test.ts` — the shared registry contract (base at `y = 0`, finite
  positions, outward winding, height matching the shipped model) plus the
  palette assertion that keeps `D_PALETTE` from drifting from the house one.
- `poi-primitives.test.ts` — the primitives each port composes.
