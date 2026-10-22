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
  is waived with its own copy instead of holding the visitor until the
  escape clock for the same outcome.
- `SCAN_GATE_ESCAPE_MS = 10_000` - after this long in `scanning` the escape
  is offered (DEC-N3; 45 s until the owner's S1 scan card offered the skip
  after 10 s, polish round M4b, Q-Scan).
- `scanCardShown(mode, arStatus, gate, unfinished = false): boolean` - the
  visitor's scan card (S1) shows for a visitor's `running` session whose
  gate is `scanning`, and closes by itself on any pass (`ar-entry.ts`
  renders it). Never for a tour not finished yet (`unfinished`): a tour
  without stations may carry its code, and the card would hide the line
  that says the tour is not finished.
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
- `gateSegment(gate, codesOnly = false)` - the status line's segment
  (`?debug=1`). With `codesOnly` (QR-first M1b-1 review #6) no line names
  GPS: a waived gate (any reason but creator) reads "No code can be read
  here - nothing can place the tour without location.", and the scanning
  line never mentions continuing with GPS.

## A code the moved-code check ignores (D20, M5c; §7j #4)

- `passed` via `ignored`: the viewer judged the code moved, or a scanning
  gate saw such a code lock. Placement runs (by GPS) and the segment says
  "Code ignored - placing the tour by GPS." instead of asking the visitor
  to keep pointing at a code the viewer will not use until the escape.
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
  converged, and said the code had worked (§2.2 B3). (The first cause is
  history: since QR-first M1 a stable code sets the session zero itself,
  so its lock votes with no fix; a converging pose is the cause left.) A lock that cannot
  vote now keeps the gate scanning: the fused pose's hint says what it
  waits for, and the escape still offers GPS-only placement.
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
placement rule and every copy branch, and the scan card (never for a
creator, outside a session, after a pass, or for a tour not finished yet).
