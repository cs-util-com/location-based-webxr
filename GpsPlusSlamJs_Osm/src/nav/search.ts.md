# `search.ts` — searches over an arbitrary state space

**Purpose.** Find a route between states, where "state" is whatever the caller
says it is. Two searches live here: `findStatePath` is breadth-first and
shortest in **steps**; `findCheapestPath` is A\* and cheapest under a
caller-supplied **cost** (DEC-R13-1).

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
- `CheapestOptions<S>` — `SearchOptions` plus `cost(from, to)` and
  `heuristic(state)`.
- `findStatePath(start, isGoal, space, options?) => S[] | undefined`
- `findCheapestPath(start, isGoal, space, options) => S[] | undefined`
- `reachableStates(start, space, options?) => Map<string, S>` — a map, not a set,
  because a `Column` cannot be recovered from its key string.
- `DEFAULT_MAX_EXPANSIONS = 100_000`.

## Invariants

- **Each key is entered once.** A key function that collides distinct states
  silently merges them — which is exactly the failure the cell-keyed version had
  by construction, so this is the one contract worth restating at every call
  site.
- **`candidates` may repeat and may include the state itself.** Both searches
  filter both, so a space does not have to be careful.

### `findStatePath` (breadth-first)

- **Shortest in steps.** Every edge is assumed to cost the same. A space where
  that is false wants `findCheapestPath`, not a different key function.
- **`canEnter` runs at most once per newly discovered state**, and never for the
  state's own key.

### `findCheapestPath` (A\*)

- **Cheapest, not merely cheap.** The contract is the minimum total `cost`, and
  it is what stage 1 of round 13 exists to deliver.
- **The goal is tested on POP, not on discovery**, and that is the whole
  difference from the BFS. Breadth-first may answer the moment it touches the
  goal, because a first touch is along a shortest path by construction; with
  weights the first touch is merely the first, and a cheaper way to the same
  place can still be in the frontier.
- **The heuristic must be CONSISTENT, not merely admissible** — states are
  settled on pop and never re-opened, so `h(a) <= cost(a, b) + h(b)` has to hold
  for every legal step. The production heuristic satisfies it by construction:
  straight-line distance obeys the triangle inequality, and every edge costs at
  least the distance it spans because the penalty never drops below 1. `h = 0`
  is always consistent and turns this into Dijkstra.
- **`canEnter` is consulted per EDGE, not once per discovered state.** The BFS
  may skip an already-seen state before paying for the decision because every
  route to it is equally good; with weights, a later and cheaper approach to the
  same state is a real thing whose legality is a separate question.
- **`cost` must be TOTAL over `candidates`, and cheap** — and this is the one
  contract difference a caller can get wrong quietly.
  - The three tests in `expand` run cheapest-first: already settled, then "could
    this even improve", then `canEnter`. So `cost` is asked about steps that are
    then refused, and "the price of walking through this wall" has to be a
    number rather than an error or an `Infinity`.
  - That mirrors the split the interface already makes — `candidates` enumerates
    before legality is considered, and `cost` prices what it enumerates.
    **Legality belongs in `canEnter`, never in an infinite weight.**
  - The ordering is measured, not stylistic. `canEnter` is point-in-polygon and
    a height lookup; `cost` is arithmetic. Asking `canEnter` first cost 2.56 s on
    `agent-route.test.ts`'s sealed-courtyard case — the one that exhausts
    everything reachable — against a 2 s budget that exists because this runs on
    the demo's click path.
- **Costs and heuristics may be zero, never negative.** The production penalty
  clamps at 1, so it never produces a zero.
- **The frontier is a private binary heap**, ordered by `f` and then by larger
  `g`. That tie-break is not cosmetic: large areas share one penalty in the
  demo's own case, so states tie constantly, and preferring the one nearer the
  goal materially reduces expansions.
- **Expansion cost is not automatically better than the BFS's.** The heuristic
  is unpenalised distance while edges cost distance × penalty, so the stronger
  the penalty the looser the guidance and the closer this runs to Dijkstra. With
  a uniform penalty it expands the same disk breadth-first does — no worse, and
  materially better only where the penalty actually varies along the route.

## Defensive behaviour

- **The cap is validated, not merely defaulted.** `NaN` makes every
  `expansions > cap` comparison false and `Infinity` removes the ceiling
  outright — both silently disable the safeguard, and the failure it exists to
  prevent is a hung tab, the one failure mode with no error message. A cap below
  1 is rejected for the same reason. Raised by CodeRabbit as Major on #257.
- **Reaching the cap throws; it does not truncate.** Returning `undefined` on
  exhaustion would be indistinguishable from "no route exists", and the caller
  would draw a blank and never learn the search gave up.
- **A negative or non-finite `cost` or `heuristic` throws a named
  `RangeError`.** A negative edge does not merely slow A\* down, it breaks it:
  settling a state on pop is sound only while no cheaper way to it can still
  turn up. The cost function is supplied by a caller and derived from external
  data (an affordance score), so this is a real input rather than a hypothetical.

## Tests

`findStatePath` is covered through its two users rather than directly:
`path.test.ts` for the flat cell space (including the cap validation and the
once-per-cell predicate guarantee) and `column-space.test.ts` for the
`(cell, heightM)` space — where the load-bearing case is that the wall foot and
the wall top coexist at all.

`findCheapestPath` has its own files, because "returns the cheapest one" is not
observable through a caller that only draws the result:

- `search.test.ts` — the behavioural difference in one case (a lane of expensive
  squares that BFS crosses and A\* walks round, longer in steps and cheaper in
  total); optimality against an exhaustive-DFS oracle; `canEnter` respected even
  where refusing is the expensive choice; start-is-goal; no route; the cap
  throwing and the cap validation; negative and non-finite costs and heuristics
  refused; a zero-cost edge accepted; agreement with BFS on an unweighted space;
  and the same cost with `h = 0` as with the informed heuristic, which is the
  cheapest check that the heuristic guides rather than contributes to the answer.
- `search.property.test.ts` — over generated weights: the path is connected,
  legal and non-repeating, and its cost equals a **Bellman–Ford** oracle's,
  including the unreachable case. Bellman–Ford on purpose: no heap, no settled
  set, no heuristic, so it can genuinely disagree. Committed at 400 runs; run
  clean at 8 000 once, per the `GATE_GAP_M` lesson.
