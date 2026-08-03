# `mesh/poi-variants-p.ts`

## Purpose

The four POI models the owner liked in `procedural-poi-marker-gallery(1)`,
rebuilt on our primitive vocabulary — `leisure=park`, `amenity=cafe`,
`leisure=picnic_table`, `tourism=artwork`.

See [`poi-variants.ts.md`](./poi-variants.ts.md) for why variants exist at all
and how the registry assembles and rescales them.

## Public API

- `P_VARIANTS: ReadonlyMap<string, () => MeshData>` — one builder per kind, at
  **P's own diorama scale**. The registry grounds and rescales; this file does
  not.
- `P_PALETTE` — the palette values a P port may paint with, under the source's
  own names. Pinned against the other ports' palettes in `poi-variants.test.ts`.

## Invariants & assumptions

- **`T = 0.18` is P's plinth top**, and every part's `y` is measured from the
  world origin including it. Ports subtract `T`. P's own sub-assemblies round
  this to `.20`, a 2 cm embed that `groundedMesh` absorbs.
- **`y` is a part's CENTRE**, three's convention, where our `box`/`prism` take a
  base. `bxP`/`cylP`/`icoP` convert once.
- **Cylinders are top-radius-first** (as `D`, unlike `B`). `cylP` swaps them.
  `amenity=cafe`'s cup is the case that matters — it flares upward, so a
  forgotten swap yields a cup that tapers the wrong way and still looks like a
  cup. **No assertion catches this**; only reading the source against the port
  does.
- **Rotations transfer unchanged.** P composes `T · R · S` about each part's own
  centre, which is what `pushTransform`'s offset-plus-rotation does, and its `rz`
  turns +x toward +y as ours does. These four kinds use `rz` only.
- **Blobs are squashed faithfully.** P's `ico` runs under a non-uniform scale
  (`1, .85, 1` for canopies, `1, .7, 1` for the sculpture). `sphere`'s `radiusY`
  carries that; the icosahedron itself is approximated by a low-ring UV sphere,
  which is the same read at a marker's screen size.

### The one known infidelity, which is the source's

**`treeP`'s trunk floats.** P places the trunk centre at `.50 s + .20` with
height `.62 s`, so its base lands at `.39` — 21 cm above the plinth top, where
every other P sub-assembly (`headstone`, and this same model's bench legs) is
built to sit at `.20`. It reads as an off-by-one against P's own convention.

It is **ported rather than corrected**: the owner asked to keep the originals'
3D structure as close as possible, and a silent fix would make the gallery
compare a correction rather than P's model. Recorded here so the gap is
attributable to the source when it shows up on screen.

## Examples

```ts
const build = P_VARIANTS.get("amenity=cafe");
const mesh = scaledToHeight(groundedMesh(build!()), 2.4); // what the registry does
```

## Tests

- `poi-variants.test.ts` — the registry contract every port shares: base at
  `y = 0`, finite positions, outward winding, height matching the shipped model,
  and the palette assertion that keeps `P_PALETTE` from drifting.
- `poi-primitives.test.ts` — `sphere`'s `radiusY`, including that a squashed
  blob carries the **ellipsoid's** normal rather than the unit sphere's.

## Exported for the hybrid

`benchP(builder, baseY, x, z, s)` — P's park bench, a seat on two legs, grounded
and centred on its own footprint so any model can place it.

P's own park calls it at `baseY = 0.03, x = 0.30, z = 0.28, s = 1`, which
reproduces the source's three boxes exactly.
[`poi-variants-hybrid.ts`](./poi-variants-hybrid.ts.md) calls it at about a third
of that size, because D's park is a much tighter vignette — see that sidecar for
why the scale is arithmetic rather than taste.
