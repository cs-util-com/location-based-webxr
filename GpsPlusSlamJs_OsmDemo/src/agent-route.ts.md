# `agent-route.ts` — pass A and pass B, joined

## Purpose

Plans a walkable route between two positions. This is the first place the whole
navigation chain runs end to end — obstacle index, column model, injected ground,
state search — against a real feature set rather than a synthetic field.

DEC-R11-3 fixes what it is for: the agent is ordered by click and **the planned
route is always drawn**, because seeing the route go _around_ the wall is the
proof, and a polyline is a far better test artefact than watching a marker move.

## Public API

- `planRoute(features, from, to, options) => RoutePoint[] | undefined` — the
  one-shot form; builds an index per call, so it is what the unit tests drive.
- `planRouteWithIndex(index, from, to, options) => RoutePoint[] | undefined` —
  the production form, exported since stage 4 landed its caller. That caller is
  the worker's `planRoute` handler, which holds one index per feature set
  (`worker/obstacle-index-cache.ts`) and answers many clicks from it.
- `RoutePoint` — `{ position: LatLng, heightM: number }`.
- `RouteOptions` — `{ frame, field, maxExpansions?, scoreFor? }`.
- `DEFAULT_ROUTE_EXPANSIONS` = 20 000, module-private (an export nothing
  imports is dead code the gate rejects; it becomes one if a caller ever needs
  to override it by name).

**`undefined` means "the agent is not going there"** and covers both no-route and
cap-reached. `findCheapestPath` throws on the cap, deliberately, so a caller
cannot mistake "gave up" for "nowhere to go" — this boundary absorbs that throw,
because a UI has nothing to do with the distinction and every reason not to crash
on a long click. It absorbs **`RangeError` only**: the search documents that as
its sole throw, so anything else is a fault here or in the inputs and stays loud.
A bare `catch` cost real time during stage 1, reporting an un-rebuilt library as
"no route".

## The cost model (DEC-R13-1, DEC-R13-11 … DEC-R13-13)

The search is **A\* over metres with a score penalty**, not breadth-first. The
ninth session reported two things — "he does not take the shortest way" and "he
does not prefer the paths" — and one line explained both: BFS costs every
`gridDisk` neighbour 1 whatever direction it lies in, so a straight run and a
staircase tie and sort order picks the winner.

```
cost(from, to) = metres(from, to) × penaltyFor(scoreFor?.(to.cell))
heuristic(s)   = metres(s, goal)
```

- **The metres alone fix the zigzag**, with no score involved.
- **`penaltyFor` is `route-penalty.ts`'s**, and the category, the neutral value
  and the reference scale are all argued there.
- **The heuristic is unpenalised**, which is what keeps it a lower bound —
  `penaltyFor` never returns less than 1, so no route can be cheaper than its own
  metres. `search.ts` explains why consistency rather than mere admissibility is
  the contract.
- **`scoreFor` is injected, not looked up.** The scores live in the pipeline
  inside the worker, and this module must stay constructible from a feature list
  alone. The worker's `planRoute` handler already holds that pipeline — the same
  one `explain` reads — so **no new payload crosses the worker boundary**.
- **Omitting `scoreFor` is plain distance**, because a uniform multiplier cannot
  change which route is cheapest. That is the honest default for a caller with no
  scores, and what the unit fixtures rely on.
- **Climb is not charged.** Cost is horizontal metres; including the climb would
  make the agent avoid stairs and slopes, which nobody asked for. The drawn
  polyline still measures its own length with the climb included
  (`route-path.ts`) — a different question: how far the agent walks, not what the
  planner minimised.
- **Cell centres are memoised per route.** A\* prices up to six neighbours and one
  heuristic per expansion, so an uncached `cellToLatLng` would run tens of
  thousands of times for a few hundred distinct cells. The cache lives for one
  route, so it cannot go stale against a re-anchor.

## Invariants & assumptions

- **Positions out, not cells.** A consumer re-deriving lat/lng from H3 indices
  would be re-deciding `cellToLatLng` — the "two computations that agree today
  with nothing asserting they always will" shape this demo keeps finding.
- **A route is bounded work or it is a freeze.** The library default cap is
  100 000, sized for a scored working set rather than for a click. The case that
  matters is an UNREACHABLE destination: "no route" is only knowable once the
  frontier is empty, so a mis-click across a wall makes the search exhaust
  everything reachable first. Found by a test timing out at 5 s under suite
  load — the test was reporting a real freeze on the demo click path, not being
  slow. 20 000 covers ~500 m of open ground at two levels per cell.
- **The index is the expensive part**, which is why `planRouteWithIndex` exists.
  `buildObstacleIndex` runs `coverCells` at res-13 over every barrier and
  building in the working set; rebuilding it per click would put a publish-sized
  cost on an interaction. Keep one index per published feature set.
- **The agent starts at the LOWEST standable level** in its cell — the ground it
  is on. Starting from the highest would put it on a wall top it cannot have
  climbed to; there is no ingress this round (DEC-R11-10).
- **`canCross` is what makes the route go around.** Without it the search steps
  through walls. Mutation-checked: replacing it with `() => true` fails three
  tests.
  - **The cost model is a new reason to PREFER a cell, never a new reason to
    ENTER one.** A tempting score on the far side of a wall changes nothing;
    `crossesObstacle` remains the sole authority on what blocks, and a test pins
    it at the maximum score.
- An unknown ground height (`NaN`) makes the start cell unstandable, so no route
  is planned. Better than planning from a position that does not exist.

## Examples

```ts
const index = buildObstacleIndex(publishedFeatures);
const route = planRouteWithIndex(index, agentPosition, clickedPosition, {
  frame,
  field: fieldFor(terrain),
});
if (route !== undefined) drawPolyline(route);
```

## Tests

`agent-route.test.ts`:

- **The control** — with no obstacles the route is near-straight. Without it the
  wall test cannot tell "routed around the wall" from "routes the long way round
  everywhere", which is the exact fixture trap the plan's §4 names.
- **Goes around a wall**, and **north of the wall's end where the gap is** —
  the second is stronger than the first, because a longer route wandering south
  would pass a length assertion while proving nothing about the gap.
- Sealed destination → `undefined`; cap reached → `undefined`, not a throw.
- Heights come from the injected sampler, so the polyline sits on the ground.
- Unknown ground → no route.

`agent-route.test.ts` › "planRoute, weighted by the walkable score" covers the
cost model, and pins the two halves separately because either can be fixed alone
and look half-right on screen:

- **near-straight on open ground** — measured between the route's OWN endpoints
  so cell-centre quantisation is not folded into the ratio, and bounded by the
  lattice's own floor: a hex grid has no due-east neighbour, so even a perfect
  line costs `1 / cos(30°) = 1.155`. 1.17 leaves room for one cell of rounding
  and nothing else.
- **detours onto a lane of high-scoring cells**, and actually reaches it rather
  than merely leaning towards it.
- **ignores a lane whose detour costs more than it saves** — the pair is what
  pins the trade-off; an NPC chasing any path at any distance is as wrong as one
  ignoring them.
- **does not route around the scored area** to reach cheaper unknown ground,
  which is DEC-R13-12 expressed as a route rather than as a number.
- **still goes around a wall at the maximum score**.
- **plans a long route inside the default expansion cap** — the guard on the
  interaction between `PATH_PREFERENCE` and `DEFAULT_ROUTE_EXPANSIONS`.

**Where it runs.** In the WORKER, behind the `planRoute` call — `ObstacleIndex`
holds a method and `Map`s, so it cannot be structured-cloned and the route has to
be computed on the side that holds the index (DEC-R11-16). The search is
synchronous, so it also delays the next publish; that is what makes the expansion
cap a publish-latency bound as well as a freeze bound, and why an `abort` cannot
preempt a route in flight.
