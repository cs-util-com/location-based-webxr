# proximity-driver.ts

## Purpose

The only impure half of the proximity component. Once per frame it reads the
live world-space user pose, runs the pure [`step()`](../core/proximity-machine.ts.md)
against the currently-anchored objects and a zone snapshot, and reports each
transition through an injected callback. It never touches an asset provider
or the render layer directly — acting on a zone (fetch / show / dispose)
belongs to whatever the caller wires the callback to.

Everything the driver needs is injected (pose source, object list, zone
snapshot, transition sink), so the same driver runs unchanged in tests, a
replay harness, and the composed app; only the injected sources differ.

## Public API

```ts
createProximityDriver(deps: ProximityDriverDeps): ProximityDriver
```

- `interface ProximityDriverDeps`:
  - `getUserWorldPos: () => Vector3 | null` — live pose, or `null` before one
    is available.
  - `getObjects: () => readonly ProximityObject[]` — the currently-anchored
    objects only; objects not yet anchored should be filtered out upstream
    and are left at their seeded `IDLE`.
  - `getZones: () => ZoneMap` — current zone snapshot.
  - `onTransition: (transition: ZoneTransition) => void` — called once per
    emitted edge, in input order. The callback must make the change visible
    to the next `getZones()` read (a synchronous store dispatch satisfies
    this for free).
  - `config: StepConfig`.
  - `movementEpsilonM?: number` — horizontal movement below this (metres)
    skips the tick. Default `0.25`.
- `interface ProximityDriver`:
  - `tick(): void` — evaluate one update; call from the render/frame loop.
  - `reset(): void` — forget the last evaluated pose so the next `tick()`
    always runs (e.g. after a teleport or scene reload).

## Invariants & assumptions

- **Movement-epsilon gate is a pure perf optimisation**: because the machine
  is memoryless in time, skipping a tick below `movementEpsilonM` can only
  defer an update until the user actually moves — it can never change the
  eventual zone.
- Movement is measured from the last **evaluated** pose, not the last tick,
  so many sub-epsilon hops still accumulate correctly.
- A `null` pose from `getUserWorldPos()` is a no-op tick, not an error.

## Examples

```ts
import { createProximityDriver } from "./proximity-driver.js";

const driver = createProximityDriver({
  getUserWorldPos: () => currentPose,
  getObjects: () => anchoredWaypoints,
  getZones: () => store.getState().zones,
  onTransition: (t) =>
    store.dispatch(setWaypointZone({ id: t.id, zone: t.to })),
  config: { hysteresisFraction: 0.15 },
});

// each frame:
driver.tick();

// on teleport / tour reload:
driver.reset();
```

## Tests

See [proximity-driver.test.ts](proximity-driver.test.ts) for unit coverage
(transition reporting, the no-change/no-report case, the movement-epsilon
gate, the null-pose guard, `reset()`), and
[proximity-replay.e2e.test.ts](proximity-replay.e2e.test.ts) for the replay
end-to-end: it replays a real recorded walk, synthesizes waypoint anchors
from the same path, and feeds every sample through the real driver with its
default movement-epsilon gate live. Assertions are geometry-derived, not
hand-tuned:

- the deepest zone reached equals what the real minimum distance implies
  (proves `ACTIVE` / `PREFETCHING`-only / `IDLE` respectively);
- every emitted edge is between adjacent zones (no illegal skip);
- each object's zone sequence is unimodal on its single fly-by — the
  no-flicker proof on real GPS noise;
- soft timing: at the sample of closest approach, a pass-through object is
  `ACTIVE`.

## Related docs

- [proximity-machine.ts](../core/proximity-machine.ts.md) — the pure state
  machine this driver runs.
