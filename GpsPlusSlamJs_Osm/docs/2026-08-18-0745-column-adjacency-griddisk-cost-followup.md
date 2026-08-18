# `columnsAdjacent` re-derives a neighbourhood the search already knows — follow-up

**Status:** filed, not acted on. Found while benchmarking the slope fix
([`2026-08-18-0659-nav-terrain-slope-vs-step-plan.md`](2026-08-18-0659-nav-terrain-slope-vs-step-plan.md));
it is **pre-existing** and entirely separate from that change.

## What was measured

Node 24, h3-js 4.4.0, res-13 cells, 500 k iterations after a 200 k warm-up:

- `getResolution(a) + getResolution(b)` — **396 ns**
- `gridDisk(a, 1).includes(b)` — **11 874 ns**
- the arithmetic the height clauses do — **4 ns**

So a `columnsAdjacent` call is **~12 µs, essentially all of it the neighbourhood
lookup**. For scale, `obstacles.bench.ts` celebrates getting `crossesObstacle`
down to **0.83 µs** — and `columnSpace.canEnter` calls this predicate _before_
that one, as the cheap test that rejects most pairs first. It is ~14× the more
expensive.

⚠️ **Run-to-run variance on these numbers is large** — the same `columnsAdjacent`
measurement read 4.8 µs and 8.3 µs in two consecutive processes. The ratio
between the three lines above is the finding; the absolute values are not.

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
- **The end-to-end saving is unmeasured.** A route is capped at 20 000
  expansions, but real routes finish in far fewer; the measured slope-fix
  reproduction plans a 30 m route in well under a second including the obstacle
  index build. **Measure a real route first** — the performance loop's own rule —
  because a µs-per-call number does not by itself say what a click costs.

## Suggested shape, if taken

Give `columnSpace` a path that asks only the height question — the clauses are
already factored out of `columnsAdjacent` into a private `climbable` helper by
the slope fix — and keep the public predicate's meaning unchanged. Then measure a
real click on the Cologne reproduction before and after.
