# `mesh/barrier-colours.ts`

## Purpose

The colour of a drawn barrier (wall, city wall, retaining wall, fence,
hedge): the O1 quiet-greens look the owner chose (city objects plan
2026-11-07-2315 M1).

**Supersedes DEC-R11-11 in part.** DEC-R11-11 drew barriers with no
distinct colour (through `buildingColour`, so `0xc8ccd8` for every wall and
fence). The owner O1 choice (2026-11-07) gives each kind its own colour.
The rest of DEC-R11-11 stands: barriers have no toggle and ride in the
building chunks, so the AR shell and the colour-space conversion apply to
them as to buildings.

## Public API

- `barrierColour(tags): Rgb` - packed sRGB `0xrrggbb`.
- `BARRIER_KIND_RGB` - `Map<BarrierKind, Rgb>`: hedge `0x6a785d`, wall
  `0xa59e93`, city wall `0x9b9081`, retaining wall `0x9d9d98`, fence
  `0x7d7366`.
- `BARRIER_MATERIAL_RGB` - `Map<string, Rgb>`: brick, stone and dry stone,
  sandstone, concrete, wood, metal, chain link and steel.
- `TAGGED_BARRIER_COLOUR_SHARE` (0.5).

## Invariants & assumptions

- **Order:** the kind colour (a wall's for tags of no solid kind, as the lab
  did); replaced by the material colour (`material`, then `fence_type`, then
  `wall` on a wall only); then a parseable `colour`, else `building:colour`,
  mixed in at half.
- **A hedge keeps its green whatever material is tagged**, because a hedge
  is leaves; a tagged `colour` still mixes into it.
- **The mix is in linear light**, the way the lab's `THREE.Color.lerp` did
  it, and the result is returned as sRGB. Building chunks are converted to
  linear afterwards (`linearChunkColours`), so the drawn colour equals the
  lab's.
- **Named colours are mixed like hex**: the library's one colour parser,
  `parseOsmColour`, reads hex and its named-colour table (see
  `feature-colours.ts.md`), so a `colour=red` fence is reddish, as the lab's
  `THREE.Color.setStyle` drew it.
- The tables are `Map`s, so prototype names (`material=constructor`) find
  nothing and fall back to the kind colour.
- Cosmetic only: nothing in navigation or scoring reads it. Sizes are not
  here; they have one source, `resolveBarrier` (`barriers.ts`).

## Examples

```ts
barrierColour({ barrier: "fence", fence_type: "wood" }); // 0x8a7660
barrierColour({ barrier: "hedge", material: "brick" }); // 0x6a785d
```

## Tests

`barrier-colours.test.ts` - each kind, the material order, the hedge rule,
unknown materials and prototype names, the half mix in linear light against
an independent computation, `building:colour`, and unparseable colours.

`barrier-colours.property.test.ts` - untagged colours stay muted (chroma at
most 56) and mid-light (luma 100 to 170); a tagged colour lands between base
and tag per channel; any tag soup gives a deterministic 24-bit colour.
