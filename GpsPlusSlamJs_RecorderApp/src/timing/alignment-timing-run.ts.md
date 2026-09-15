# `alignment-timing-run.ts` - what is replayed, and how a pass is wired

## Purpose

Turns a loaded recording's action stream into the dispatch plan a timing pass
executes, and builds the `createPass` function the loop drives.

## Public API

- `planTimingReplay(actions): TimingReplayPlan`
  - `preamble` - actions dispatched once per pass, OUTSIDE the timed span.
  - `groups[i]` - the actions dispatched as the timed unit of fix `i`; the fix
    is always last.
  - `fixCount`, `durationSeconds` (null when the fixes carry no timestamps).
- `createPassFactory({ plan, arms, createStore }): (armId) => (fixIndex) => void`
  - Each call starts a pass: a fresh store, then that arm's overrides, then the
    preamble. Throws `Error` for an unknown arm id and `RangeError` for a fix
    index outside the recording.
- `TimingStoreLike` - `{ dispatch(action) }`, structural so a fake suffices.

## Invariants and assumptions

- **The timed unit is one dispatch of a recorded `gpsData/recordGpsEvent`** -
  the same call the live recorder makes per GPS fix, and the one inside which
  the alignment solve runs. Recorded actions are dispatched as recorded; nothing
  is rebuilt, so there is no second code path to drift.
- **Only `gpsData/setZeroPos` and `gpsData/recordGpsEvent` are replayed.**
  Everything else a recording carries (compass opt-ins, frame captures, depth
  samples, ref points, session lifecycle) is dropped, so the RECORDING cannot
  reconfigure the solve and make the arms incomparable. The configuration comes
  from the arm and from nowhere else.
- **Everything before the first fix is untimed preamble**; a zero that appears
  after fixing has begun rides with the fix that follows it, preserving the
  recorded order rather than replaying the rest of the walk against the wrong
  origin.
- **The store is injected**, so this module is testable against a fake. It must
  already be license-active when `createPassFactory` runs: the library gates its
  action creators, and building the app store is what activates them.
- Trailing zeros after the last fix are dropped - nothing would be timed after
  them.

## Example

```ts
const plan = planTimingReplay(recording.actions.map((e) => e.action));
const createPass = createPassFactory({ plan, arms: TIMING_ARMS, createStore });
const applyFix = createPass('w180');
applyFix(0);
```

## Tests

`alignment-timing-run.test.ts` - the action filter, the preamble split, a
mid-stream zero, the duration derivation and its absence, an empty recording,
a fresh store and overrides-first per pass, the timed group's exact contents,
and both refusals. The suite activates the community license key, as the other
recorder suites that touch library actions do.
