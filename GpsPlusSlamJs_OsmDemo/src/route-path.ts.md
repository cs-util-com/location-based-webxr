# `route-path.ts`

## Purpose

The two pieces of arithmetic between "the worker returned a route" and "an agent
is moving along a drawn line": the ENU→scene conversion, and the walk along it.

## Public API

- `AGENT_SPEED_MPS` = 10 — a demo pace, not a human one.
- `scenePathOf(route, frame, liftM) => ScenePoint[]` — lat/lng + `heightM` to
  scene coordinates, lifted clear of the ground.
- `pathLengthM(path) => number` — climb included; 0 for fewer than two points.
- `pointAlong(path, walkedM) => { point, done } | undefined` — `undefined` for an
  empty path.

## Invariants & assumptions

- **`+y` north becomes `-z` north.** Get it wrong and the route is mirrored about
  the east axis: it still starts at the agent, still ends near the click, and
  still looks like a path — while running south past the wall it was supposed to
  go round. `mesh-orientation.test.ts` in the package exists because exactly that
  shipped unnoticed once. This module is one of four places that apply the
  reflection (`cell-mesh.ts`, the package's `packInstances`, `BuildingView.recentre`
  are the others); what must never happen is a fifth that disagrees.
- **The route is coplanar with the terrain by construction.** `heightM` IS the
  ground height at that cell, sampled through the same field the ground plane
  draws — so an unlifted line z-fights the ground along its whole length.
  `liftM` is a parameter rather than an import so this module stays free of the
  layer ladder; production passes `ROUTE_LIFT_M`.
- **`done` is the contract that matters, not `point`.** It is what stops the
  animation, so a path that never reports it is a permanent rAF loop — the
  measured ~6x e2e slowdown DEC-R11-15 accepted the risk of. A single-point path
  (a destination in the agent's own cell) is `done` immediately, which is the
  shortest route to that failure.
- **Climb counts towards distance**, so an agent walking up a hillside does not
  arrive early. Heidelberg is in the corpus precisely for that relief.
- **A negative `walkedM` clamps to the start** rather than extrapolating
  backwards — a clock that goes backwards is not hypothetical.
- **Zero-length segments are skipped, not divided by.** Two consecutive route
  points can share a cell centre once their heights match, and `0 / 0` would put
  the agent at `NaN` for the rest of the walk.
- `ScenePoint` is imported from `pick.ts`, which is where the scene frame's point
  type was first needed. A second declaration is how two modules come to disagree
  about which axis is north.

## Examples

```ts
const path = scenePathOf(route, enuFrameAt(anchors.origin), ROUTE_LIFT_M);
const walkedM = ((performance.now() - startedAt) / 1000) * AGENT_SPEED_MPS;
const at = pointAlong(path, walkedM);
if (at !== undefined && !at.done) requestFrame();
```

## Tests

`route-path.test.ts`. The reflection is the first assertion in the file, with a
counterweight (`east is +x`) so a path that negated **both** axes cannot pass by
accident. `done` is asserted as hard as the position: at the end, past the end,
and for a single-point path.

**Mutation-checked**: flipping the `-enu.y` sign fails the north test, and
returning `done: false` at the end of the path fails the arrival test. Neither is
vacuous.
