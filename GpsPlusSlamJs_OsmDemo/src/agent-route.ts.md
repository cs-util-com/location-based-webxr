# `agent-route.ts` — pass A and pass B, joined

## Purpose

Plans a walkable route between two positions. This is the first place the whole
navigation chain runs end to end — obstacle index, column model, injected ground,
state search — against a real feature set rather than a synthetic field.

DEC-R11-3 fixes what it is for: the agent is ordered by click and **the planned
route is always drawn**, because seeing the route go _around_ the wall is the
proof, and a polyline is a far better test artefact than watching a marker move.

## Public API

- `planRoute(features, from, to, options) => RoutePoint[] | undefined`
- `planRouteWithIndex` exists but is **not exported yet**: the caller that wants
  it is stage 4's click handler, and an export nothing imports is dead code the
  gate rejects. The split is there because it is where the cost boundary is.
- `RoutePoint` — `{ position: LatLng, heightM: number }`.
- `RouteOptions` — `{ frame, field, maxExpansions? }`.
- `DEFAULT_ROUTE_EXPANSIONS` = 20 000, module-private (an export nothing
  imports is dead code the gate rejects; it becomes one if a caller ever needs
  to override it by name).

**`undefined` means "the agent is not going there"** and covers both no-route and
cap-reached. `findStatePath` throws on the cap, deliberately, so a caller cannot
mistake "gave up" for "nowhere to go" — this boundary absorbs that throw, because
a UI has nothing to do with the distinction and every reason not to crash on a
long click.

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

**Not yet wired into the running demo.** The click handler, the polyline
rendering and the frame-scheduling constraint (the scene renders on demand; a
moving agent must drive frames while it moves and stop when it stops) are the
remainder of stage 4.
