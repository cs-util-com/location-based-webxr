# visitor-walk-slice.ts

## Purpose

The visitor's walk through the open tour, in the page's store (visitor walk
W4 build plan
`GpsPlusSlamJs_Docs/docs/2026-10-21-1105-visitor-walk-w4-build-plan.md`, M1,
§2.2; root `CLAUDE.md`, the Redux rule; the shared-state audit
`GpsPlusSlamJs_Docs/docs/2026-10-18-1126-tour-viewer-shared-state-foundation-audit.md`):
the run's progress, the last skip while it can be undone, the note of what
just happened, and the quick action's arm. Its reducer applies the run's
pure transitions (`station-run.ts` `applyWalkStep`), so the rule lives
once and every view reads one answer. M2-M4 of the plan add the sheet,
the chooser, the chosen target and the row arm here.

## Public API

- `visitorWalkReducer(state, action)` - mounted as `visitorWalk` by
  `createTourViewerStore` (`tour-viewer-session.ts`). A plain reducer (no
  Immer draft): the transitions build new progress themselves.
- `type VisitorWalkState`:
  - `progress: WalkProgress | null` - `station-run.ts`'s plain data (the
    order, every station's state, skip flag and skip clock, the branch
    path); null without a tour;
  - `lastSkip: { id, atMs, settled } | null` - the last skip (K4 review
    R14); `settled` once its undo's moment passed or the tour moved on;
  - `note: { kind: "skipped" | "brought-back", id, atMs } | null` - the
    station line's lead ("Skipped X.", "Brought back X.");
  - `quickArmedId: string | null` - "Can't get there?" asked for this
    station; the next tap confirms.
- Actions (all `visitorWalk/*`):
  - `walkStarted({ order, route })` - a new walk (`route` from
    `walkRoute(stations)`): everything else starts anew;
  - `walkCleared()` - no tour: the initial state;
  - `walkStepped(step)` - one `WalkStep` through `applyWalkStep`;
  - `skipTaken({ id, atMs })` - the last skip and its note;
  - `skipSettled()` - the last skip can no longer be undone (once);
  - `skipUndone({ id, atMs })` - the last skip is gone, the bring back noted;
  - `noteCleared()`;
  - `quickArmed(id | null)`;
  - `walkBatched(actions)` - one guide call's changes, applied in order as
    ONE dispatch;
  - and the guide slice's `guideTourChanged()` resets it too.
- `interface VisitorWalkStore` - what the guide needs of a store
  (`getState`, `dispatch`).

## Invariants & assumptions

- **Events only.** Every case returns the same state object when it
  changes nothing (a found station found again, a clock started twice, a
  second settle, an id the tour lacks, a step without a walk, an empty
  batch), and the guide dispatches only what changed something, never per
  frame.
- **One batch per guide call** (`walkBatched`): the guide applies its
  changes to a draft of this state and dispatches them together at the end
  of the call, so a store subscriber that re-enters the guide
  (`ar-entry.ts` ticks it on every dispatch) never sees half a tick. A
  batch equals its actions applied in sequence.
- **No timer.** The windows of the last skip and the note (6 s,
  `SKIP_UNDO_MS` of `station-guide.ts`) are read over the page's time by
  the guide; only the settle is an event (`skipSettled`, dispatched once
  when the 6 s have passed, or when the tour moves on).
- **Not persisted:** `visitorWalk/*` is not among the page's persisted
  prefixes, so the guide's dispatch from inside the store's subscriber
  cannot reorder a recording (lessons-learned: never dispatch a persisted
  action from `store.subscribe`). A recording therefore replays no walk,
  as it replays no `visitorGuide`.
- Plain, serializable data only; no three.js handles, no DOM, no timers.
- **Defensive:** a step for an id the tour does not have, or before a walk
  started, changes nothing; `startWalk` reads only ids, `next` links that
  name a station of the tour, and whether a station has steps.

## Examples

```ts
store.dispatch(walkStarted({ order: "any", route: walkRoute(stations) }));
store.dispatch(
  walkBatched([
    skipTaken({ id: "well", atMs: now }),
    walkStepped({ kind: "skip", id: "well" }),
  ]),
);
walkOffered(store.getState().visitorWalk.progress!); // the rest
```

## Tests

- `visitor-walk-slice.test.ts` - each case's guard (found only for an
  offered waiting station, a station without steps done on its find,
  finish only a found one, skip only offered and not done, unskip only a
  skipped one, the clock once, the first distance once, the settle once,
  the arm), the same state when nothing changes, the resets (a new walk,
  no tour, another tour), a batch equal to its sequence; the page's store
  mounts it and never writes `visitorWalk/*` into a recording (against a
  persisted control action).
- `station-run.differential.property.test.ts` - the run's calls through a
  store of this slice against the frozen run.
- `station-guide.differential.property.test.ts`,
  `station-guide.walk-store.test.ts` - the guide on this slice: the same
  as before the move, events only, one batch per call.
