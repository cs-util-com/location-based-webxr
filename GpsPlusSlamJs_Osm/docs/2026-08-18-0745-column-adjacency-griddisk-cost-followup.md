# `columnsAdjacent` re-derives a neighbourhood the search already knows — follow-up

**Status:** ✅ **TAKEN 2026-08-18.** `columnsClimbable` is the height-only
predicate; `columnSpace.canEnter` calls it. Measured 23 % off a real route. This
document is kept as the measurement and the rationale. Found while benchmarking the slope fix
([`2026-08-18-0659-nav-terrain-slope-vs-step-plan.md`](2026-08-18-0659-nav-terrain-slope-vs-step-plan.md));
it is **pre-existing** and entirely separate from that change.

## What was measured

Node 24.14.1, h3-js 4.4.0, res-13 cells, 200 k iterations over ~1 200 **distinct**
cell pairs after a 100 k warm-up:

- `getResolution(a) + getResolution(b)` — **398 ns**
- `gridDisk(a, 1).includes(b)` — **2 257 ns**
- the arithmetic the height clauses do — **4 ns**
- `columnsAdjacent` end to end, from the built `dist` — **2 662 ns**

So the neighbourhood lookup is **~85 % of the call**. Against the 0.83 µs
`crossesObstacle` figure that `obstacles.bench.ts` records, that is **~3×**, not
the ~14× an earlier draft of this document claimed.

⚠️ **This section originally reported 11 874 ns for `gridDisk` and ~12 µs for
`columnsAdjacent`, and neither reproduces.** Those came from a harness that hit
ONE cell pair a million times; over many distinct pairs the figures are the ones
above, and the PR review that re-ran them got 2 366 ns / 2 910 ns independently.
Corrected rather than deleted, because the retracted 14× was the number that
would have decided whether this work is worth scheduling.

### The number that actually decides it

Measured end to end on the Cologne reproduction — real Overpass extract, real
obstacle index, 24 destinations at 30/120/250 m, including the 10 that exhaust
the cap. **Interleaved in one process, 7 rounds each, with the route results
asserted identical every round:**

- before — **268 ms per route** (min and median agree)
- after — **206 ms per route**
- **23 % faster**

⚠️ **A first attempt at this reported 35 %, and that number was noise.** It
compared two separate processes, and the UNCHANGED baseline moved 17 % between
runs — larger than the effect being claimed. Interleaving the two arms in one
process and reporting min alongside median is what made the figure stable; both
now agree to the percentage point. This is the same trap
`GpsPlusSlamJs_Docs/docs/lessons-learned.md` records as "delete a timing spec
whose variance exceeds its effect", hit while measuring the fix for it.

## Why it is avoidable rather than merely expensive

`columnSpace.candidates` generates every candidate **from
`gridDisk(state.cell, 1)`**, and `search.ts` only ever calls `canEnter(from, to)`
with a `to` that came out of `candidates(from)`. So by construction the two cells
are already neighbours, and the predicate then buys a fresh `gridDisk` — seven
allocated H3 index strings — to re-discover it.

## Why it was not fixed on the way past

- **It changes a contract, not an implementation.** The neighbourhood clause is
  part of what `columnsAdjacent` MEANS, and `column.property.test.ts` pins it
  (including "the height clause can only remove adjacency, never create it", and
  the opposite-spokes case). Any fix has to keep the standalone predicate honest
  while letting the space skip the redundant half — an extra entry point, or a
  documented "cells are known-adjacent" mode.
- **~~The end-to-end saving is unmeasured.~~** It is now: **35 %** off a real
  click, above. That was the performance loop's own precondition, so this is
  ready to be taken rather than merely arguable.

## The shape it took

Give `columnSpace` a path that asks only the height question — the clauses are
already factored out of `columnsAdjacent` into a private `climbable` helper by
the slope fix — and keep the public predicate's meaning unchanged. That is what
shipped: `columnsAdjacent` still means what it always meant, and
`columnsClimbable` is documented as **unsound for any caller that did not
generate the second state as a neighbour of the first**, with a test pinning that
it will happily call two cells on opposite sides of a city climbable.

## What is left, and it is now the largest remaining per-edge cost

`columnSpace.canEnter` builds `{ ...state, groundM }` for both endpoints on
every edge — two allocations per edge, up to ~280 k on a capped route (raised in
the PR review) — and `columnsClimbable` re-runs `resolveLimits` and
`sharedResolution` per call, both of which are constant for the life of a space.

An inlined predicate with none of that measured **~15 % faster again** than the
shipped one on the same routes. Not taken: it would mean either a third entry
point or a space that hand-rolls the rule, and duplicating the rule is exactly
what this package's history says goes wrong. Recorded so the next person knows
the remaining headroom is real but bought at a price.
