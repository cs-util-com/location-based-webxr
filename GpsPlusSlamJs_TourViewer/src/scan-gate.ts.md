# scan-gate.ts

## Purpose

The visitor's scan gate (guided-setup plan DEC-N3/N4, §2.2), pure: nothing
is placed until the hung code locks in AR. The states, the rule deciding
whether a session needs the gate, the late-levels reconsideration, and the
status copy. `viewer-placement.ts` drives it (the lock event, the escape
clock, the escape button).

## Public API

- `type ScanGate` - `idle` | `not-required` (`creator` | `no-detector` |
  `no-lockable-level`) | `scanning` (`escapeOffered`) | `passed` (`code` |
  `skipped`).
- `SCAN_GATE_ESCAPE_MS = 45_000` - after this long in `scanning` the escape
  is offered (DEC-N3).
- `isLockableLevel(level)` - a printed size AND a geo pose: a size-less
  level never solves, a geo-less one never votes, and neither can lock.
- `scanGateAtSessionStart({ mode, hasDetector, levels })` - creator and
  no-detector are not required; levels still loading (`null`) start
  scanning (the gate cannot be waived on unknown levels); no lockable level
  is not required.
- `reconsiderScanGate(gate, levels)` - waives a scanning gate when the
  arrived levels cannot lock; every other state stands.
- `gateAllowsPlacement(gate)` - passed or not required.
- `gateSegment(gate)` - the status line's segment.

## Invariants & assumptions

- A lock is the controller's `onLocked` with a lockable level, not a vote
  (a vote additionally needs the GPS zero and the budget; keying on it left
  a visibly locked code unable to pass, plan review #1).
- The escape has its own clock in the driver, independent of camera frames
  (plan review #11).

## Examples

```ts
ctx.scanGate = scanGateAtSessionStart({
  mode,
  hasDetector,
  levels: ctx.currentLevels,
});
if (gateAllowsPlacement(ctx.scanGate)) tryPlaceTour();
```

## Tests

`scan-gate.test.ts` - the lockable rule as a property, the session-start
cases, the reconsideration as a property over gates and level sets, the
placement rule and every copy branch.
