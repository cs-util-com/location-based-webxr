# visitor-walk-slice.ts

## Purpose

The visitor's walk through the open tour, in the page's store (the root `CLAUDE.md`'s Redux rule):
the run's progress, the last skip while it can be undone, the note of what
just happened, and the quick action's arm. Its reducer applies the run's
pure transitions (`station-run.ts` `applyWalkStep`), so the rule lives
once and every view reads one answer. It also holds the sheet and the
walk's rules: the row arm, the chooser, the no-guess rule's `noGuess` and the chosen
target, with the focus rule `walkFocus` every view reads.

## Public API

- `visitorWalkReducer(state, action)` - mounted as `visitorWalk` by
  `createTourViewerStore` (`tour-viewer-session.ts`). A plain reducer (no
  Immer draft): the transitions build new progress themselves.
- `type VisitorWalkState`:
  - `progress: WalkProgress | null` - `station-run.ts`'s plain data (the
    order, every station's state, skip flag and skip clock); null
    without a tour;
  - `lastSkip: { id, atMs, settled } | null` - the last skip; `settled` once its undo's moment passed or the tour moved on;
  - `note: { kind: "skipped" | "brought-back", id, atMs } | null` - the
    station line's lead ("Skipped X.", "Brought back X.");
  - `quickArmedId: string | null` - "Can't get there?" asked for this
    station; the next tap confirms;
  - `sheet: "peek" | "list"` (`WalkSheet`) - the sheet's peek, or the
    list pulled up;
  - `completionSeen: boolean` - the walk is finished and its
    completion opened the list already;
  - `welcomePending: boolean` - the visitor left AR with
    progress, and the next entry's first sheet says "Welcome back", once
    (`welcomeSet(boolean)` arms or clears it; `selectWelcomePending`).
    A new walk, a cleared one and another tour reset it;
  - `rowArmedId: string | null` - a row of the list asked for its
    skip (its confirm shows); separate from `quickArmedId`, which is the
    story card's end ask: a focus change never clears it;
  - `chooser: boolean` - "Can't get there?" opened the list with no
    station guessed: a row's Skip acts on one tap;
  - `noGuess: boolean` - no station is guessed (the guide's
    clock, `walk-no-guess.ts`, decides; `noGuessSet`);
  - `chosenId: string | null` - the visitor's chosen target.
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
  - `sheetSet("peek" | "list")` - the visitor opened or closed the
    list; closing it clears the row arm and the chooser;
  - `listOpened({ armedId, chooser })` - "Can't get there?": the
    list open with the focus's row armed, or in chooser mode;
  - `rowArmed(id | null)` - only a waiting offered station;
  - `noGuessSet(boolean)` - false also ends chooser mode;
  - `targetChosen(id | null)` - only a waiting offered station of
    an any-order tour with two or more to find; tapped again (the same
    id) the guide sends null;
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
- `selectWalkProgress(state)`, `selectWalkSheet(state)` - the walk
  and the sheet, for `visitor-stations.ts`.
- `walkFocus(walk, distances)` - the station the walk points
  at, among the unfound offered ones (null with none): the first under
  fixed order, or when only one is left; under any order the
  chosen target, else null while `noGuess` holds, else the nearest by
  `distances` (ties and missing distances by list order).
- `walkNoGuess(walk)` - `noGuess`, any order, two or more
  unfound offered, no chosen target.
- `walkChoiceOffered(walk)` - a target may be chosen now.
- `selectNote(state, nowMs)` - the note while its window lasts at
  `nowMs`, else null. Both take the page's state (`{ visitorWalk }`), so
  the guide's button and line and any other view (the sheet) read
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
- **The sheet's two rules live in the reducer**:
  the step that FINISHES the walk opens the list, once per finish
  (`completionSeen`; complete is not finished: a tour completed by its
  last station's end waits until the visitor leaves it or taps "Finish
  the tour", `station-run.ts`; a skip undone makes the walk unfinished
  again, and finishing it again opens the list again); a station found closes the
  list, so its story card takes the peek's place (and clears the row arm
  and the chooser with it).
- **The offer rules:** after every step a row arm and a chosen
  target that no longer name a waiting offered station go - also on the
  step that completes the walk (a property over random walks found the
  completion's own rule returning before them: a skipped chosen target
  stayed chosen, and a bring back made it the target again).
- **A bring back:** `skipUndone` clears `lastSkip` only when
  it names the same station: an older skipped station brought back
  leaves the last skip's undo in place.
- Plain, serializable data only; no three.js handles, no DOM, no timers.
- **Defensive:** a step for an id the tour does not have, or before a walk
  started, changes nothing; `startWalk` reads only ids and whether a
  station has steps.

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
  the guide names too; the sheet: `sheetSet`, the completion opening
  the list once, a find closing it, and a property over random steps that
  `completionSeen` follows the finish (with `left` and `finish-tour`
  among the steps) and a finish just reached opens the list; the walk's rules: `walkFocus` per order, precision and
  choice, `walkNoGuess`, `targetChosen`'s guards and clearing (on a
  find, a skip, the completing skip, another tour), `listOpened` and the
  list's closing, a bring back of a skip that was not the last.
- `station-guide.rules.property.test.ts` - the slice's invariants over
  random walks through the guide (at most one chosen target, only a
  waiting offered one; no focus while the no-guess rule holds).
- `station-guide.walk-store.test.ts` - the guide on this slice: events
  only, one batch per call (a differential against a frozen copy of the
  old guide was deleted once the sheet changed the guide's writes by
  design).

## Shown story blocks (B2b)

- `shownBlocks`: per station, the story blocks with a world view a step
  reached, in the order reached (`shown-blocks.ts`). `blockShown({
stationId, blockId })` adds one once; it is ignored with no walk.
  Like `done`, a story's end, a stop and leaving AR keep it;
  `walkStarted`, `walkCleared` and `guideTourChanged` start it empty.
- `selectShownBlocks(state, stationId)` - that list, or a shared empty
  one.
- Not persisted (`visitorWalk/*`), as the rest of the walk.
- Tests: `visitor-walk-slice.test.ts` "the reached story world blocks
  (B2b)".
