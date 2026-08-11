# `mesh/water.ts`

## Purpose

Which features are water, and where their **banks** run — the geometry half of
the water veto. [`nav/obstacles.ts`](../nav/obstacles.ts.md)'s `addWater` turns
these lines into indexed bands.

## Public API

- `waterBankLines(feature, clipTo?): PlanarPoint[][]` — the bank polylines as
  `x = lng, y = lat`. `[]` for anything not water, not convertible, or not areal.
  **`[]` always means "nothing to block with", never "unknown"** — a caller
  cannot mistake a refusal for an empty river.

The tag test `isWaterArea` is **module-private**: it says nothing about whether
the geometry is areal, so on its own it cannot answer "can I block with this" —
`waterBankLines`' `[]` answers both halves at once, which is why no caller ever
wanted the predicate alone.

## Why water is an obstacle at all

`route-penalty.ts` charges a route `metres × penaltyFor(score)` and clamps the
penalty at **3**, stating why: _"without it a score approaching zero costs
unboundedly much, which stops being a preference and becomes an obstacle, and
obstacles are `crossesObstacle`'s job alone in this demo."_

So water was always expensive and never impossible — and **a destination in the
river cannot be priced out at any multiplier**, because there is no alternative
route to it. That is the reported case: an NPC sent into the middle of the
Thames walks there.

## The banks, not the area — and that is measured

|                       | filled, clipped | **band, clipped** |
| --------------------- | --------------- | ----------------- |
| `london-westminster`  | 18 246 cells    | **1 517**         |
| `london-tower-bridge` | 13 966 cells    | **1 153**         |

Against a budget of **1 000–10 000 covered cells for a whole site's obstacle
index** (`site-obstacle-index-cost.test.ts`). **Only the band fits** — filled is
1.4–1.8× the ceiling on its own, before any wall or building is indexed. The
table and its guard live in `site-water-index-cost.test.ts`.

**It is also the right semantics, not merely the affordable one.**
`crossesObstacle` is a **crossing** test, so a band along the banks refuses every
step that enters the water and leaves mid-river steps unindexed. A destination in
the river then becomes simply unreachable — which is what "you cannot walk there"
means to a search.

## What counts as water

- **`natural=water`** and its `water=*` subtypes, **including the multipolygon
  relation form** — the only form that matters in practice, since the Thames is
  `natural=water water=river type=multipolygon`.
- **NOT `waterway=river`** — a **centreline**, not an area (three open ways at
  `london-tower-bridge`). Banding it would lay a one-cell ribbon down the middle
  of the river, which is neither its surface nor a bank anyone crosses.
- **NOT `waterway=riverbank`** — reads like the obvious tag, and is
  **deprecated**: zero occurrences across all eight fixtures and no rule-table
  row. Named because it is the first thing a reader will reach for.
- **NOT `natural=coastline` or `natural=wetland`** — linear-with-land-on-one-side
  and walkable-ish respectively. Deliberate exclusions, not oversights.

## Invariants & assumptions

- **Inner rings are banks too.** A hole in a water multipolygon is an island or a
  pier, so its ring is a shore that must block exactly as the outer one does.
  Every ring is returned.
- **Areal kinds only.** An open way tagged `natural=water` has no interior, so it
  has no bank; treating its points as a ring would invent one — the silent
  wrongness [`ring-overlap.ts`](../spatial/ring-overlap.ts.md) refuses for the
  same reason.
- **`clipTo` is strongly recommended and not required.** Overpass `out geom`
  returns whole member geometry regardless of the query box, so Westminster's
  Thames relation spans **16.3 km inside a 350 m extract**. Unclipped its banks
  cost 13 052 cells — over a whole site's budget on their own; clipped to the
  fetch tile, 1 517.

## ⚠️ No bridge exemption yet

A bridge deck crosses its river's banks, so **with water indexed, a route over a
bridge is refused.** Nothing passes water-bearing features to
`buildObstacleIndex` today, which is why that is tolerable — but **wiring water
into the demo before bridges land would break every river crossing.**

The bridge rule, when it comes, cannot be a bare `bridge=*`: ways 367652753 and
367653917 at Tower Bridge are `bridge=yes building:part=yes min_height=40` —
closed areas 40 m in the air — and ways 153173986/153173987 are
`bridge=yes highway=footway layer=2 height=43.5`, which pass a naive
`isRoad && !isBelowSurface` filter.

## Tests

- `obstacles.test.ts` — "water blocks the bank, not the whole river": a step from
  land into the water blocks; a step along the bank on dry land does not; the
  obstacle adds **no standable level**; and a `waterway=river` centreline is
  ignored entirely.
- `site-water-index-cost.test.ts` — the budget table above, plus a standing
  both-sided bound so water can neither explode nor silently vanish.
