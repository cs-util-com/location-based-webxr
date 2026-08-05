# `path.ts` — pass A, reachability and pathfinding

**Purpose.** Answer "how does an agent get from this cell to that one", over a
caller-supplied set of in-scope H3 cells.

## Why this exists

`connectedComponents` already answers _"are these two cells in the same blob"_.
An agent needs the other question, and the navigation design names **traversal
within a component** as the piece that does not exist yet.

## The injectable step predicate is the architecture

The design describes two rungs that read as contradictory:

- **§5.3** — agents wander cell to cell over free `gridDisk` adjacency, and
  _"they will walk up the Tower walls, and that is the point"_.
- **§5.4** — agents refuse steps that cross an obstacle or exceed the climb
  threshold, so the route goes **around** the wall.

They are the same search with a different edge test. `canStep` defaults to
admitting every neighbour (§5.3); pass B supplies one that resolves heights and
refuses unclimbable steps (§5.4), and the identical search now detours.

**Why the predicate belongs in the expansion and not in a downstream mover:** a
pass B that merely _rejected_ steps as an agent took them yields an agent that
walks into a wall and stops. Routing around requires the **search** to know. The
design's own phrasing — that the rejection "forces the path around the wall" —
is only true if the planner sees it.

A property test pins the consequence: **blocking a cell via the predicate is
exactly equivalent to carving it out of the scope set.** If those two ever
diverged, a height-derived obstruction would behave differently from a
score-derived one, with no principled way to say which is right.

## Public API

- `findPath(start, goal, inScope, options?) => string[] | undefined`
  - A **shortest** route, inclusive of both endpoints. `[start]` when the
    endpoints are equal.
  - `undefined` means **no route exists**, and nothing else — including when an
    endpoint is out of scope.
  - Throws `RangeError` on mixed resolutions, or on exceeding the expansion cap.
- `reachableFrom(start, inScope, options?) => Set<string>`
  - Every reachable cell including `start`; empty when `start` is out of scope,
    which is a meaningful answer rather than an error — an agent standing on
    unscored ground can go nowhere.
- `PathOptions` — `canStep?`, `maxExpansions?`.
- `DEFAULT_MAX_EXPANSIONS = 100_000`.

## Invariants

- **Shortest, not merely valid.** Breadth-first. A queue-discipline slip leaves
  a search that still _arrives_, just by a longer route, so the property tests
  check the length against an independent layered flood rather than checking
  that a path came back.
- **Deterministic, and specifically independent of the caller.** Neighbours are
  expanded in **sorted** order and the search walks the grid, never the scope
  `Set` — a `Set` iterates in insertion order, and the caller assembles it from
  region cells whose ordering is its own business. `connectedComponents` sorts
  for the same reason.
- **`findPath` and `reachableFrom` never disagree.** A caller told a cell is
  reachable and then handed `undefined` for the route can act on neither answer.
- **`canStep` is never called for an out-of-scope cell.** Pass B's predicate
  does real geometry per call; asking it about cells already excluded is wasted
  work and invites a predicate that must defend itself against input it should
  never see.

## Defensive behaviour

- **The expansion cap throws; it does not truncate.** Returning `undefined` on
  exhaustion would be indistinguishable from "no route exists", and the caller
  would draw a blank and never learn the search gave up. 100 000 is ~2 orders of
  magnitude above the demo's ~10³-cell working set: high enough never to fire on
  real input, low enough that an unbounded scope set surfaces immediately rather
  than as a frozen tab.
- **Mixed resolutions throw**, for the same reason as in
  [`column.ts.md`](./column.ts.md): a quiet `undefined` reads as "no way across".

## Why breadth-first and not A\*

The working set is on the order of 10³ cells and every edge costs the same, so a
heuristic buys nothing measurable at that size — while adding a tie-breaking
rule that determinism would then depend on. If a coarser mode ever makes the
scope set much larger, this is the decision to revisit, and the expansion cap is
what will make that need visible.

## Example

```ts
// §5.3 — free adjacency: the agent will happily walk up a wall.
findPath(from, to, region.cells);

// §5.4 — the same search, made height-aware.
findPath(from, to, region.cells, {
  canStep: (a, b) =>
    columnsAdjacent(
      { cell: a, heightM: heightAt(a) },
      { cell: b, heightM: heightAt(b) },
    ),
});
```

## Tests

- `path.test.ts` — a ring-3 wall with a single gate around the origin. Every
  barrier case asserts the route is **strictly longer** than the unobstructed
  grid distance, which is the assertion a fixture without a real barrier cannot
  produce. Also the predicate seam, the `columnsAdjacent` integration, scope and
  neighbour legality, determinism, and the defensive paths.
- `path.property.test.ts` — generated obstacle fields checked against an
  independent layered flood: reachability agreement, exact shortest length,
  step-by-step legality, no repeated cells, `findPath`/`reachableFrom`
  agreement, and predicate/scope equivalence.

**Mutation-checked.** Eight mutations; six are caught — ignoring the scope set,
ignoring the step predicate, depth-first instead of breadth-first, dropping the
visited check, returning `undefined` at the cap instead of throwing, and
`reachableFrom` ignoring the predicate.

**What these do NOT cover — the two mutations that SURVIVE:**

- **The `.sort()` in neighbour expansion.** Removing it still returns a valid
  shortest path — just a different one among ties — so no assertion about
  correctness can catch it. Its actual value is stability if H3's `gridDisk`
  ordering ever changes between versions, which no in-process test can observe.
  A reference-implementation oracle would catch the mutation while asserting
  little more than "the code is the code", so it is deliberately not written.
  The caller-insertion-order test covers the determinism risk that _is_
  observable.
- ~~The out-of-scope endpoint guard~~ — this one survived too, until mutation
  testing showed why it is not merely a fast path: with `start === goal` it is
  the only thing stopping a `[start]` "route" being returned for a cell that was
  never scored. Now covered.
- **Where the scope set comes from**, and where heights come from. Both are the
  caller's, and heights are pass B's.
