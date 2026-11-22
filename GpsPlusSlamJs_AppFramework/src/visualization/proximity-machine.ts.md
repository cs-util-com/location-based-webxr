# proximity-machine.ts

## Purpose

The proximity & zone state machine: given the user's world-space position and
a set of anchored objects, drives each object through two concentric zones —
`IDLE → PREFETCHING → ACTIVE` — with hysteresis so a position sitting on a
boundary does not flicker. `PREFETCHING` exists to let a consumer do
invisible prep work (e.g. parsing a GLTF) before the object becomes visible at
`ACTIVE`.

Framework-free, store-free, clock-free: `Vector3` is imported **type-only**,
so this module carries zero runtime dependency and drops into any Three.js
project. Same inputs → same output. The machine writes zone _state_ only —
acting on a zone (fetch / show / dispose) is a consumer's job, never this
module's.

## Public API

```ts
step(
  prev: ZoneMap,
  userPos: Vector3,
  objects: readonly ProximityObject[],
  config: StepConfig,     // { hysteresisFraction }
): StepResult              // { zones: ZoneMap; transitions: ZoneTransition[] }
```

- `type ZoneState = 'IDLE' | 'PREFETCHING' | 'ACTIVE'`.
- `interface ProximityObject` — `{ id, position, prefetchRadius, activeRadius }`.
  Only the anchor's X/Z are read.
- `type ZoneMap = Readonly<Record<string, ZoneState>>`.
- `interface ZoneTransition` — `{ id, from, to }`, one per adjacent edge that
  changed this update.
- `interface StepResult` — `{ zones: ZoneMap; transitions: readonly ZoneTransition[] }`.
  `transitions` is in input order and drives consumer side effects.

## Invariants & assumptions

- **Horizontal distance only**: `Math.hypot(dx, dz)`; `y` is ignored, so
  altitude noise can never move a zone.
- **Fractional hysteresis**: a boundary is entered at `radius` and left only
  past `radius · (1 + hysteresisFraction)`. A position jittering inside that
  band emits no transition.
- **One step per update, both directions**: the per-current-state transition
  table can only move an object to an _adjacent_ zone, so `IDLE ↔ ACTIVE`
  never happens directly — `PREFETCHING` always gets at least one update
  before `ACTIVE`, and the same clamp applies on the way back out.
- **Pure**: no time, no I/O, no side effects. An object absent from `prev`
  defaults to `IDLE`.

## Examples

```ts
import { step, type ZoneMap } from './proximity-machine.js';

let zones: ZoneMap = {};
const objects = [
  {
    id: 'statue',
    position: new Vector3(10, 0, 0),
    prefetchRadius: 25,
    activeRadius: 10,
  },
];
const config = { hysteresisFraction: 0.15 };

const result = step(zones, userPos, objects, config);
zones = result.zones;
for (const t of result.transitions) {
  // t: { id: "statue", from: "IDLE", to: "PREFETCHING" }
}
```

## Tests

See [proximity-machine.test.ts](proximity-machine.test.ts). Coverage: entry
at each boundary, the one-step clamp in both directions (no illegal skip),
hysteresis hold-and-release on both boundaries, a no-flicker oscillation
case, horizontal-only distance, multiple objects with different radii, and
the absent-defaults-to-`IDLE` case.

## Related docs

- [proximity-driver.ts](proximity-driver.ts.md) — the impure driver
  that runs this machine against the live app.
