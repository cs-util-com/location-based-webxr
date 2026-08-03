# `mesh/poi-variants-l.ts`

## Purpose

Ten of the thirteen POI models the owner liked in `poi-markers-gallery (2)` —
`place_of_worship`, `park`, `fuel`, `cafe`, `shelter`, `attraction`,
`hunting_stand`, `viewpoint`, `waste_disposal`, `parking_entrance`.

**The other three are the shipped models.** `amenity=bench`,
`tourism=information` and `historic=wayside_cross` were ported from this same
file by the §4 rebuild, so the registry re-exposes them with
`fromShipped(kind, "L")` rather than building them twice — two copies of one
model are two places for it to drift.

See [`poi-variants.ts.md`](./poi-variants.ts.md) for why variants exist at all
and how the registry assembles and rescales them.

## Public API

- `L_VARIANTS: ReadonlyMap<string, () => MeshData>` — one builder per kind, at
  L's own scale. The registry grounds and rescales; this file does not.
- `L_PALETTE` — **the full source palette**, not a per-port subset. L is the
  house style, so this table is the authority the other five palettes are
  checked against in `poi-variants.test.ts`.

## Invariants & assumptions

- **L is the only source with two carriers**, and this is the thing to get
  right:
  - **Tier A** — street furniture at true life size, standing on a 0.09 m
    plinth (`PL_H`). Strip the plinth and the model is already real.
  - **Tier B** — a _place_ (a building or an area), modelled as a tabletop
    miniature: a 0.70 m ground tile on a pedestal, tile top at `TB = 0.78`. A
    Tier B church is 0.7 m tall as built.
- **The tile is kept; the plinth and pedestal are not.** The tile is the
  miniature's own ground plane — a filling station's forecourt, a park's grass,
  a churchyard's paving — and several models are unreadable without it. The
  plinth and pedestal are display furniture for a gallery we are not building.
- **Coordinates are transcribed verbatim, including `PL_H` and `TB`.** The
  carrier is simply not emitted, so the payload floats at 0.09 m (Tier A) or
  0.71 m (Tier B) and the registry's `groundedMesh` re-datums it to zero
  exactly. Rewriting every offset to a new origin would be ten models' worth of
  chances to mistype one, for no gain.
- **`y` is a part's CENTRE**, except for `gable` and `pyr` whose source
  geometries build from `y = 0` upward — the same split `D` has, and the same
  way to sink a roof by half its height.
- **Cylinders are top-radius-first** (as `D`, `P` and `M`; unlike `B`). `cyL`
  swaps them once.
- **Face names are remapped, and the pair is easy to invert.** L indexes a box's
  faces `+X, -X, +Y, -Y, +Z, -Z` and names them `right, left, top, bottom,
front, back`; ours are compass names in ENU, so **front (`+z`) is north** and
  **right (`+x`) is east**. Getting it backwards paints the wrong side of a
  filling-station canopy, which nothing would flag.
- **`gbL` turns our gable a quarter turn.** L's ridge runs along X; the `gable`
  primitive extracted from `hut` puts its ridge along Z. A ridge on the wrong
  axis is a roof at ninety degrees to its own building.

### Known approximations

- **L's cylinders and cones are open-ended by default** (`CylinderGeometry`'s
  sixth argument defaults to `true` in its `Parts.cyl`); ours always cap. A cap
  the source omitted is invisible from outside and a hole where the source
  showed one would not be, so capping is the safe direction.
- **`pyr` gains an underside.** L's `pyrGeo` is four triangles with no base;
  `pyramid` closes it. Every use here sits on a tower, so the base is never
  seen.
- **One two-axis rotation differs in composition order.** `amenity=hunting_stand`
  splays its legs with `{rz, rx}` and L composes Euler in `YXZ` where we apply
  x-then-y-then-z. At 0.10 rad the two differ in the fourth decimal, far below
  the splay itself.

## Examples

```ts
const build = L_VARIANTS.get("amenity=place_of_worship");
const mesh = scaledToHeight(groundedMesh(build!()), 12.0); // what the registry does
```

## Tests

- `poi-variants.test.ts` — the shared registry contract (base at `y = 0`, finite
  positions, outward winding, height matching the shipped model), the palette
  assertion, and **the gate that all 51 liked pairs exist**, which closed when
  this file completed the sixth and last source.
- `poi-primitives.test.ts` — the primitives each port composes, including the
  `gable` extracted from `hut` for this file's church.
