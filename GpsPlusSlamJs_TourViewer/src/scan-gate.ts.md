# scan-gate.ts

## Purpose

The visitor's scan gate (guided-setup plan DEC-N3/N4, §2.2), pure: nothing
is placed until the hung code locks in AR. The states, the rule deciding
whether a session needs the gate, the late-levels reconsideration, and the
status copy. `viewer-placement.ts` drives it (the lock event, the escape
clock, the escape button).

## Public API

- `type ScanGate` - `idle` | `not-required` (`creator` | `no-detector` |
  `no-lockable-level` | `levels-unavailable`) | `scanning`
  (`escapeOffered`) | `passed` (`code` | `skipped` | `ignored`). `no-detector` is
  DEC-N13: a browser without `BarcodeDetector` can never pass, so the gate
  is waived with its own copy instead of holding the visitor 45 s for the
  same outcome.
- `SCAN_GATE_ESCAPE_MS = 45_000` - after this long in `scanning` the escape
  is offered (DEC-N3).
- `isLockableLevel(level)` - a printed size AND a geo pose: a size-less
  level never solves, a geo-less one never votes, and neither can lock.
- `scanGateAtSessionStart({ mode, hasDetector, levels, ignoredLevelIds? })` - creator and
  no-detector are not required; levels still loading (`null`) start
  scanning (the gate cannot be waived on unknown levels); no lockable level
  is not required.
- `reconsiderScanGate(gate, levels | "unavailable", ignoredLevelIds?)` - waives a scanning
  gate when the arrived levels cannot lock, or could not be read at all
  (`levels-unavailable`, its own copy); every other state stands.
- `gateAllowsPlacement(gate)` - passed or not required.
- `gateSegment(gate)` - the status line's segment.

## A code the moved-code check ignores (D20, M5c; §7j #4)

- `passed` via `ignored`: the viewer judged the code moved, or a scanning
  gate saw such a code lock. Placement runs (by GPS) and the segment says
  "Code ignored - placing the tour by GPS." instead of asking the visitor
  to keep pointing at a code the viewer will not use until the 45 s escape.
- At session start and when the levels arrive, a tour whose EVERY lockable
  level id is in `ignoredLevelIds` passes `ignored` at once; with another
  lockable code left, the gate scans for that one.

## Invariants & assumptions

- The driver passes the gate on the controller's `onLocked` with a
  lockable level whose code has CAST VOTES in this AR entry (`hasVoted`,
  since the authoring plan 2026-09-28-0953 M2b). The M5 rule (any lock;
  plan review #1: keying on a vote left a visibly locked code unable to
  pass) placed the content through an alignment no code had corrected
  whenever the lock came before the first GPS fix or while the pose
  converged, and said the code had worked (§2.2 B3). A lock that cannot
  vote now keeps the gate scanning: the fused pose's hint says what it
  waits for, and the 45 s escape still offers GPS-only placement.
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
