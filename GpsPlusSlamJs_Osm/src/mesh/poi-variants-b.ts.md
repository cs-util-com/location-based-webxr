# `mesh/poi-variants-b.ts`

> **Pruned to the winners (DEC-R7b-2a, round 8).** This file was one of
> seven candidate sets the owner compared in the gallery. They chose, the winners
> were adopted into `POI_MODELS`, and every kind in this file that LOST was
> deleted. What remains is the geometry the demo actually renders, so this is now
> a model source rather than a variant source. The registry that used to consume
> it (`poi-variants.ts`) is gone; `poi-models.ts` imports the map directly.

## Purpose

The seven POI models the owner liked in `poi-markers-plinth-and-payload`, rebuilt
on our primitive vocabulary — `amenity=parking`, `amenity=fast_food`,
`amenity=post_box`, `leisure=picnic_table`, `amenity=hunting_stand`,
`historic=yes`, `amenity=fountain`.

See [`poi-variants.ts.md`](./poi-variants.ts.md) for why variants exist at all
and how the registry assembles and rescales them.

## Public API

- `B_VARIANTS: ReadonlyMap<string, () => MeshData>` — one builder per kind, at
  B's own scale. The registry grounds and rescales; this file does not.
- `B_PALETTE` — the palette values a B port may paint with, under the source's
  own names. Pinned in `poi-variants.test.ts`.

## Invariants & assumptions

- **NOTHING IS SUBTRACTED.** B is the one source that translates its payload as
  a whole, at the end, rather than baking a plinth offset into every part — so
  unlike `D` and `P` there is no `T` to strip. Subtracting one anyway would sink
  every model by the plinth height.
- **`y` is a part's BASE** in `bx`/`cy`/`cn`/`pr`, and its CENTRE in `qd`. The
  split is the source's, not ours; the helpers mirror it so a port reads straight
  off the prototype.
- **Cylinders are bottom-radius-first — the OPPOSITE of `D` and `P`.** `cy` takes
  the bottom radius, matching our `prism`, so there is no swap here. This is
  precisely the kind of per-file convention that makes a shared helper layer the
  wrong design: three sources, three cylinder conventions.
- **`turned` rotates about a part's own position**, matching the source's
  `T · R · S` composition.

## Examples

```ts
const build = B_VARIANTS.get("amenity=fountain");
const mesh = scaledToHeight(groundedMesh(build!()), 1.6); // what the registry does
```

## Tests

- `poi-variants.test.ts` — the shared registry contract (base at `y = 0`, finite
  positions, outward winding, height matching the shipped model) plus the
  palette assertion that keeps `B_PALETTE` from drifting.
- `poi-primitives.test.ts` — the primitives each port composes.
