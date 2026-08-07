# `search.ts` — breadth-first search over an arbitrary state space

**Purpose.** Find a shortest route between states, where "state" is whatever the
caller says it is.

## Why it is generic

The first pass A keyed its visited set by H3 cell. Review on #257 showed what
that costs, and it was right:

- **One slot per cell**, so the wall-foot state and the wall-top state could not
  both exist in one search.
- **The predicate saw only cell strings**, so it had to resolve a single height
  per cell — a heightfield with a step filter, which is precisely the 2D model
  the column model exists to replace.
- So `columnsAdjacent(foot, top)` — the design's motivating case, and the one
  example in `column.ts.md` — was **unreachable**, because `from` and `to` were
  never the same cell.

The owner chose to generalise rather than document the limit (DEC-R11-5). The
state is now the caller's, and so is its identity: `Column` is a state whose key
includes a height, a bare cell is a state whose key is itself, and nothing here
knows which.

## `candidates` and `canEnter` are separate on purpose

Generating a neighbour is cheap — grid adjacency. Deciding whether the step is
**legal** is not: pass B does point-in-polygon and a height lookup per call.
Splitting them lets the search drop an already-visited state **before** paying
for the decision.

That is not a micro-optimisation. Every interior cell is reached once but sits
in six neighbourhoods, so a predicate consulted before the visited check is
asked about it six times over — roughly five wasted calls in six.

## Public API

- `StateSpace<S>` — `key(state)`, `candidates(state)`, optional `canEnter(from, to)`.
- `findStatePath(start, isGoal, space, options?) => S[] | undefined`
- `reachableStates(start, space, options?) => Map<string, S>` — a map, not a set,
  because a `Column` cannot be recovered from its key string.
- `DEFAULT_MAX_EXPANSIONS = 100_000`.

## Invariants

- **Shortest in steps.** Breadth-first, so every edge is assumed to cost the
  same. A space where that is false wants a different algorithm, not a different
  key function.
- **Each key is entered once.** A key function that collides distinct states
  silently merges them — which is exactly the failure the cell-keyed version had
  by construction, so this is the one contract worth restating at every call
  site.
- **`canEnter` runs at most once per newly discovered state**, and never for the
  state's own key.
- **`candidates` may repeat and may include the state itself.** The search
  filters both, so a space does not have to be careful.

## Defensive behaviour

- **The cap is validated, not merely defaulted.** `NaN` makes every
  `expansions > cap` comparison false and `Infinity` removes the ceiling
  outright — both silently disable the safeguard, and the failure it exists to
  prevent is a hung tab, the one failure mode with no error message. A cap below
  1 is rejected for the same reason. Raised by CodeRabbit as Major on #257.
- **Reaching the cap throws; it does not truncate.** Returning `undefined` on
  exhaustion would be indistinguishable from "no route exists", and the caller
  would draw a blank and never learn the search gave up.

## Tests

Covered through its two users rather than directly: `path.test.ts` for the flat
cell space (including the cap validation and the once-per-cell predicate
guarantee) and `column-space.test.ts` for the `(cell, heightM)` space — where
the load-bearing case is that the wall foot and the wall top coexist at all.

**What these do NOT cover:** weighted edges, because there are none. If a space
ever wants them this module is the wrong starting point.
