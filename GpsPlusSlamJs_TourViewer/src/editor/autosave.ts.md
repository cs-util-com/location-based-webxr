# editor/autosave.ts

## Purpose

Decides WHEN the desktop editor saves by itself (M6 E2b-2, owner question
Q-E2-4: yes, a few seconds after a change). Page-free and timer-only: the
page reports committed changes and the moments a hold may have ended, and
runs the save it is asked for. Design and the sweep's verdict:
`GpsPlusSlamJs_Docs/docs/2026-10-13-0832-tour-desktop-editor-and-scan-data-design.md`
("E2b - the build plan, re-cut", its cold review #3, #7, #11, and "E2b-2
built").

## Public API

- `AUTOSAVE_DELAY_MS` (3 s) - the quiet after the last committed change.
- `AUTOSAVE_MAX_WAIT_MS` (30 s) - the longest the first unsaved change
  waits while changes keep coming (a debounce alone starves a creator who
  never pauses: the lessons-learned entry on streams that trail off).
- `createAutosave(deps): Autosave`
  - `deps.save(): Promise<AutosaveOutcome>` - run one save; `saved` (it
    landed, or there was nothing to save), `failed` (refused or not
    written), `held` (the page found a hold before its snapshot). A
    rejection or a throw counts as `failed`.
  - `deps.held(): boolean` - the page forbids a save now.
  - `deps.pending(): boolean` - committed changes the file lacks.
  - `deps.delayMs?`, `deps.maxWaitMs?` - default to the constants;
    `RangeError` for a non-positive or non-finite value, or a max wait
    shorter than the delay.
  - `deps.onState?(state)` - each change of `AutosaveState`.
- `Autosave`
  - `enable(on)` - on while the tour is written in place; a change made
    before is saved once the delay has passed.
  - `changed()` - a committed change; re-arms the timer at
    `min(last change + delay, first unsaved change + max wait)`.
  - `poke()` - a hold may have ended: a save that fell due starts now; with
    none due it does nothing.
  - `saved()` - an explicit save or a download landed: a pause ends.
  - `failed()` - an explicit save did not land: autosave pauses too.
  - `stop()` - the tour closed: timers cleared; a save still running ends
    without effect (a generation counter), so it never pauses the next
    tour's autosave.
  - `state()` - `off` | `idle` | `waiting` | `held` | `saving` | `paused`.

## Invariants & assumptions

- At most one of its saves runs at a time; a change made during one is
  saved after it (timed from that change).
- Nothing starts while `held()`; the page must `poke()` when a hold ends
  (the undo window closes, a field commits, a move ends, a save ends), or
  the due save waits for the next change.
- A save that did not land pauses autosave until `saved()`: no write loop
  against a file that refuses it ("fail, change, fail" makes one attempt).
- A save that says `saved` while the changes stay pending (the page's
  count and its save disagree) is retried once per delay, timed from that
  moment - never at once in a loop (a unit test saw 27 002 writes in 30 s
  before this).
- The max wait after an explicit save is timed from the last change made
  during it (the earlier ones are not tracked), so it may run that much
  longer.
- Uses the global `setTimeout` and `Date.now()` (fake timers in tests).

## Examples

```ts
const autosave = createAutosave({
  save: () => saveTour("auto"),
  held: () => saving || undoLive || card.dirty(),
  pending: () => session.changeCount() > 0,
});
autosave.enable(true); // a writable file is open
autosave.changed(); // after each committed edit
autosave.poke(); // when the undo window closes
```

## Tests

- `autosave.test.ts` (fake timers): the delay restarted by a change, the
  max wait against a creator who never stops, a hold and its poke, one save
  at a time, fail-change-fail with no loop, a rejected save, an explicit
  failure and success, off/on, nothing pending, the states, a `held`
  outcome, a stop during a save, the retry that is never a loop, the
  argument checks.
- `autosave.property.test.ts`: the sweep - delays 0.5-10 s, max waits
  15-120 s, saves of 0.2 s and 2 s, on a scripted ten-minute creator
  session and a steady one (an edit every 2 s): at most one save in
  flight, the last change saved, no save started in a hold, the steady
  creator saved at least once per max wait; `AUTOSAVE_SWEEP_REPORT=1`
  prints the writes per session. Plus a fast-check property over random
  sessions and timings.
- The page's wiring: `playwright-tests/editor.spec.js` (the autosave walks).
