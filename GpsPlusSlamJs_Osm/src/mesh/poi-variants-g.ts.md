# `mesh/poi-variants-g.ts`

> **Pruned to the winners (DEC-R7b-2a, round 8).** This file was one of
> seven candidate sets the owner compared in the gallery. They chose, the winners
> were adopted into `POI_MODELS`, and every kind in this file that LOST was
> deleted. What remains is the geometry the demo actually renders, so this is now
> a model source rather than a variant source. The registry that used to consume
> it (`poi-variants.ts`) is gone; `poi-models.ts` imports the map directly.

## Purpose

The five POI models the owner liked in `gemini-code-1785634682505`, rebuilt on
our primitive vocabulary — `amenity=parking`, `amenity=waste_basket`,
`amenity=fast_food`, `amenity=pharmacy`, `leisure=swimming_pool`.

See [`poi-models.ts.md`](./poi-models.ts.md) for how these builders reach the
scene: `poi-models.ts` imports the map directly and `adopted()` grounds and
scales each mesh. The old `poi-variants.ts` registry that used to do that was
deleted with the losing models (DEC-R7b-2a).

## Public API

- `G_VARIANTS: ReadonlyMap<string, () => MeshData>` — one builder per kind, at
  G's own compressed scale. The registry grounds and rescales; this file does
  not.
- `G_PALETTE` — the palette values a G port may paint with, abbreviated as the
  source names them. Pinned in `poi-variants.test.ts`.

## Invariants & assumptions

- **NOTHING HAS TO BE STRIPPED**, which makes this the cleanest of the ports: G
  is free-standing, with no plinth at all.
- **`y` is a part's CENTRE and defaults to `h / 2`**, so a part with no `y` sits
  on the ground. Every helper undoes that to our base-`y`.
- **Cylinders take ONE radius for both ends**, unlike `D`'s and `B`'s, so there
  is no top/bottom order to get wrong here.
- **The scale is compressed, not real** — a hotel is a 2.5 × 3.5 × 2.5 m box and
  the `parking` sign stands 3 m tall — so DEC-V5's rescale to the shipped model's
  height applies as it does to the diorama sources. §4.1 of the round-6 plan
  noted the owner picked from this file anyway, which was a small piece of
  evidence for DEC-R6-8's real-world-scale decision.

### The one addition that is not a port

**`leisure=swimming_pool` gains a ladder (Q-V2).** It is the owner's only
requested CHANGE to a model rather than a choice between models — _"swimming_pool
(maybe a ladder missing that you could add?)"_ — so it is built into this variant
rather than offered as a further one. Two uprights and two rungs at the deep end,
**sized off the pool itself** so the proportion survives DEC-V5's rescale rather
than drifting when the target height changes.

## Examples

```ts
const build = G_VARIANTS.get("amenity=waste_basket");
const mesh = scaledToHeight(groundedMesh(build!()), 2.2); // what `adopted()` does
```

## Tests

- `poi-variants.test.ts` — the shared registry contract (base at `y = 0`, finite
  positions, outward winding, height matching the shipped model) plus the
  palette assertion that keeps `G_PALETTE` from drifting.
- `poi-primitives.test.ts` — the primitives each port composes.
