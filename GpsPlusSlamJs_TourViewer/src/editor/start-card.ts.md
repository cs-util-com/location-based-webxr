# `start-card.ts` - the editor's start card

## Purpose

The desktop editor's open dialog as a start card: two questions, then one
"Open the editor" button. Question 1 is where the creator starts from - a
tour they made (a file or a link), a new, empty tour, or the example tour
to look around; question 2, for the first two only, is an optional scan
of the place (a Recorder recording or a phone's debug data), shown while
editing and never part of the tour. This module holds the answers (the
`editorStart` slice), says what the card shows for them, and sorts the
files given to either question. Pure; `edit-main.ts` wires it.

## Public API

- `StartFrom` - `"tour" | "new" | "example"`.
- `EditorStartState` - `{ from, tour, scan }`: question 1's answer (or
  null), and the NAMES of the tour and scan files held (or null). The
  files themselves are the page's (`startFiles` in `edit-main.ts`): a
  Blob is never store state.
- `initialEditorStartState`, `editorStartReducer`, `selectEditorStart`.
- `editorStartActions`:
  - `startChosen({ from })` - question 1 answered; an unknown answer
    changes nothing;
  - `tourHeld({ name })`, `scanHeld({ name })` - a file held, or let go
    with null; a name that is not non-empty text changes nothing;
  - `startReset()` - the card shown afresh.
- `startCardView(state, link) -> { tourStep, scanStep, canOpen, summary }`
  - what the card shows; `link` is the link field's text (a link typed
    counts as a tour to open). The example has no scan step and never names
    a scan.
- `sortTourPick(kinds) -> TourPick` - files given where the tour is asked
  for, sorted as `planEditorEntry` sorts them: `{ kind: "held", tour,
scan, ignored }` or `{ kind: "refuse", reason }`. A lone scan is held
  as the scan with `tour: null`; a scan is never held as the tour.
- `sortScanPick(kind) -> ScanPick` - a file given to question 2: a scan
  is held; a tour is refused with `tourNotScanLine`; a file with no
  recording is refused in plain words; a precise reason is kept.
- Copy (the questions themselves are in `edit.html`): `NEW_TOUR_SAVE_QUESTION`
  ("Where should your new tour be saved?"), `EMPTY_GLOBE_HINT`
  ("Right-click the ground to place your first station."),
  `scanKeptInsteadLine(name)`, `tourNotScanLine(name)`.

## Invariants

- "Open the editor" opens something exactly when the answers name it: a
  new tour, the example, or a tour held or linked (property-tested).
- A scan is never held as the tour (property-tested), and a tour is
  never held as the scan.
- The scan stays session-only: the slice holds a name, the page a File,
  and neither is written anywhere.
- Every show of the dialog resets the card (`startReset`), so a second
  new tour starts from nothing.

## Example

```ts
const state = [
  editorStartActions.startChosen({ from: "new" }),
  editorStartActions.scanHeld({ name: "walk.zip" }),
].reduce(editorStartReducer, initialEditorStartState);
startCardView(state, "").summary;
// "Starts a new, empty tour. The editor asks where to save it first, then shows the scan walk.zip."
```

## Tests

- `start-card.test.ts` - the slice, `startCardView` (with a property over
  every answer), `sortTourPick` (with a property that a scan is never the
  tour) and `sortScanPick`.
- `playwright-tests/editor-entry.spec.js` "the start card" - a new tour's
  save question and first-station hint, a second new tour offered no
  draft, the example asking nowhere to save; `playwright-tests/editor.spec.js`
  - a scan given as the tour kept as the scan, a new tour with a scan.
