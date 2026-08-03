# `mesh/poi-variants.ts`

## Purpose

Alternative POI models — every version of a kind the owner liked — held so the
gallery can render them side by side and the choice can be made by looking
(DEC-R6-30…33).

## Why it exists

The owner deployed the gallery, looked at the fifty shipped models and reported
_"I dont like most of them"_. Six downloaded prototypes contain versions they
did like: **51 (kind, source) pairs across 34 kinds**, thirteen of which are
liked in more than one file. So the choice of model moves from a rule to a
comparison.

## Public API

- `type VariantSource` — `D | G | P | L | B | M`, the six prototype files.
- `VARIANT_SOURCES` — what each letter refers to, shown in the gallery.
- `interface PoiVariant` — `kind`, `source`, `colour`, `heightM` (derived),
  `mesh`.
- `LIKED_VARIANTS` — the owner's notes as a checked-in table of
  `{ kind, source }`.
- `POI_VARIANTS: ReadonlyMap<string, readonly PoiVariant[]>` — the built
  variants, keyed by kind. A kind with none is absent.
- `poiVariantsFor(kind): readonly PoiVariant[]` — empty list when there are none.

## Invariants & assumptions

- **`POI_MODELS` still holds exactly one model per kind, and `poiModelFor` keeps
  its signature.** The runtime path and its draw-call bucketing are untouched, so
  DEC-R6-18's objection to F41 does not apply — the demo still builds one
  `InstancedMesh` per kind.
- **Variants keep each source's SHAPE and take the house PALETTE (DEC-R6-30).**
  The owner's words are the specification: _"I dont care about lighting or
  colors but the 3d models/shapes I liked look very different to the current one
  and also to each other."_ Normalising colour stops it confounding the
  comparison; normalising proportions too is what produced the models they
  disliked. **This partly supersedes DEC-R6-15** — the primitive library and
  palette are still the house style's; re-proportioning is not.
- **A variant is held to the same contract as a shipped model**, because it is a
  candidate to become one: base at `y = 0`, height derived from the geometry,
  winding agreeing with the normals, no NaN, plausible real-world size. **This is
  the entire reason these live in the package rather than in the demo** — this
  session found fifty models rendering inside out for eighteen work items,
  invisible to every count-based assertion and to the eye, so "it looks fine in
  the gallery" is not a standard a candidate can be judged against.
- **Variants are compared at TRUE SCALE** (DEC-R6-8), which is part of what is
  being judged: a model that only reads well at plinth scale is not one this demo
  can use.
- **The seven §4 rebuilds are re-exposed rather than rebuilt.** `bench`,
  `wayside_cross`, `information`, `waste_basket`, `post_box`, `memorial` and
  `drinking_water` were ported from the house-style file before the owner's
  verdict arrived, so they ARE the `L` variant. Building them twice would be two
  places for them to drift.
  - **Four of those seven are attributed to `L` while their LIKED source is
    something else** (`waste_basket` → G, `post_box` → B, `memorial` and
    `drinking_water` → D). They were ported from the house file under DEC-R6-28,
    which the variant work supersedes — so `L` is the honest attribution and
    their liked source is still owed a variant. The progress readout in the tests
    counts them as not-yet-built for exactly that reason.
- **`LIKED_VARIANTS` is the one thing a later reader cannot reconstruct.** Once a
  model is ported nothing records which prototype it came from or how many agreed
  on it. Two typos in the original notes are normalised: `drinking_walter` →
  `amenity=drinking_water`, `historing=yes` → `historic=yes`.

## Known limits

- **The published package carries geometry only the gallery reads**, until a
  winner is chosen and the losers deleted. Accepted under DEC-R6-31 in exchange
  for the contract tests.
- **`leisure=swimming_pool` is a stated ADDITION, not a selection** (Q-V2): the
  owner asks for a ladder its source lacks. It belongs in the G variant rather
  than as a fourth entry.

## Examples

```ts
import { poiVariantsFor, VARIANT_SOURCES } from "gps-plus-slam-osm";

for (const variant of poiVariantsFor("amenity=cafe")) {
  console.log(variant.source, VARIANT_SOURCES[variant.source], variant.heightM);
}
```

## Tests

- `poi-variants.test.ts` — the full shipped-model contract applied to every
  variant (geometry, no NaN, base at zero, derived height, plausible size,
  winding against normals), no duplicate source per kind, and the
  `LIKED_VARIANTS` table checked against the owner's own totals (51 pairs, 34
  kinds, D 18 / G 5 / P 4 / L 13 / B 7 / M 4).
- The "reports which liked pairs are not yet built" case is a **progress readout
  rather than a gate** — the port runs in batches, so a red test for "all 51
  exist" would be red for the whole job and tell nobody anything on the way.
