# `columnsAdjacent` re-derives a neighbourhood the search already knows — follow-up

**Status:** filed, measured, and ready to take — the remaining blocker is the
contract question below, not the evidence. Found while benchmarking the slope fix
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
the cap:

- shipped `columnSpace` — **226.3 ms per route**
- a space whose `canEnter` asks only the height question — **148.1 ms per route**
- **35 % faster, with identical results** (14 of 24 routed either way)

That is the click path, and the saving concentrates on exactly the reply the demo
most wants to be quick: `agent-cycle.ts` records that "no route" is the slowest
answer, because it is the one that must exhaust the frontier.

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

## Suggested shape, if taken

Give `columnSpace` a path that asks only the height question — the clauses are
already factored out of `columnsAdjacent` into a private `climbable` helper by
the slope fix — and keep the public predicate's meaning unchanged. The
before/after on the Cologne reproduction is the measurement above; re-run it
after the change and expect ~148 ms per route.

## Also worth pricing in the same pass

`columnSpace.canEnter` builds `{ ...state, groundM }` for both endpoints on
every edge — two allocations per edge, up to ~280 k on a capped route (raised in
the same PR review). Small next to the `gridDisk` cost above, but it is on the
same line of code any fix here would touch, so measure it with the rest rather
than separately.
