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
    station; the next tap confirms;
  - `sheet: "peek" | "list"` (`WalkSheet`, M2) - the sheet's peek, or the
    list pulled up;
  - `completionSeen: boolean` (M2) - the walk is complete and its
    completion opened the list already;
  - `welcomePending: boolean` (M2 review) - the visitor left AR with
    progress, and the next entry's first sheet says "Welcome back", once
    (`welcomeSet(boolean)` arms or clears it; `selectWelcomePending`).
    A new walk, a cleared one and another tour reset it.
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
  - `sheetSet("peek" | "list")` (M2) - the visitor opened or closed the
    list;
  - `walkBatched(actions)` - one guide call's changes, applied in order as
    ONE dispatch;
  - and the guide slice's `guideTourChanged()` resets it too.
- `interface VisitorWalkStore` - what the guide needs of a store
  (`getState`, `dispatch`).
- `SKIP_UNDO_MS` - the last skip's and the note's window (6 s, the
  framework toast's linger; argued, not measured). Here rather than in the
  guide, which imports this slice; `station-guide.ts` re-exports it.
- `selectUndoableSkip(state, nowMs)` - `{ id, atMs }` of the last skip
  while it can be undone at `nowMs` (not settled, inside its window),
  else null.
- `selectWalkProgress(state)`, `selectWalkSheet(state)` (M2) - the walk
  and the sheet, for `visitor-stations.ts`.
- `selectNote(state, nowMs)` - the note while its window lasts at
  `nowMs`, else null. Both take the page's state (`{ visitorWalk }`), so
  the guide's button and line and any other view (the sheet of M2) read
  the same windows.

## Invariants & assumptions

- **Events only.** Every case returns the same state object when it
  changes nothing (a found station found again, a clock started twice, a
  second settle, an id the tour lacks, a step without a walk, an empty
  batch), and the guide dispatches only what changed something, never per
  frame.
- **One batch per guide call** (`walkBatched`): the guide queues its
  changes, reads this state with them applied over it, and dispatches them
  together at the end of the call, so a store subscriber that re-enters the guide
  (`ar-entry.ts` ticks it on every dispatch) never sees half a tick. A
  batch equals its actions applied in sequence.
- **No timer.** The windows of the last skip and the note (6 s,
  `SKIP_UNDO_MS`) are read over the page's time by their readers
  (`selectUndoableSkip`, `selectNote`); only the settle is an event (`skipSettled`, dispatched once
  when the 6 s have passed, or when the tour moves on).
- **Not persisted:** `visitorWalk/*` is not among the page's persisted
  prefixes, so the guide's dispatch from inside the store's subscriber
  cannot reorder a recording (lessons-learned: never dispatch a persisted
  action from `store.subscribe`). A recording therefore replays no walk,
  as it replays no `visitorGuide`.
- **The sheet's two rules live in the reducer** (M2, plan §1.5, §1.6):
  the step that completes the walk opens the list, once per completion
  (`completionSeen`; a skip undone makes the walk incomplete again, and
  completing it again opens the list again); a station found closes the
  list, so its story card takes the peek's place.
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
  persisted control action); the windows of `selectUndoableSkip` and
  `selectNote` (inside, at their end, settled, undone; a property over any
  time for the note) and `SKIP_UNDO_MS` as the toast linger, the one value
  the guide names too; the sheet (M2): `sheetSet`, the completion opening
  the list once, a find closing it, and a property over random steps that
  `completionSeen` follows completeness and a completion just reached
  opens the list.
- `station-run.differential.property.test.ts` - the run's calls through a
  store of this slice against the frozen run.
- `station-guide.walk-store.test.ts` - the guide on this slice: events
  only, one batch per call (M1's guide-level differential against the
  frozen guide was deleted in M2, which changes the guide's writes by
  design).
