# maker-slice.ts

**Purpose:** the one Redux slice of the character maker page (`characters.html`) and the store that keeps its draft in storage. The reducers own the page's rules (which step a tap may open, what a new picture resets, what "Make another" keeps, what Undo brings back); `maker-main.ts` dispatches and reads. The cut picture (canvases and pixel data), the library handle, timers, the render caches and the library view's generation guard stay in the page.

## State

- `draft`: the `MakerDraft` of `maker-draft.ts` (step, furthest step, description, copy time, failure, talk choice, backdrop, cut settings, name, saved id and name, time the page was hidden).
- `cut`: `none | cutting | ready`. `ready` exactly while the page holds a cut picture; the page dispatches whenever it sets or drops one.
- `version`: moves on every finished cut, re-cut and talk choice, so the previews and the talk-style block redraw.
- `generation`: moves whenever another draft takes the current one's place (`startedAnother`, `restored`, a `cutStarted` that is taken), so a save started from an earlier draft cannot land on a later one. Not stored; it counts within one page session.

## Public API

- `makerStateFrom(stored: unknown)`: the state the page starts in. The stored draft goes through `draftOf`; a saved one starts a new character with its backdrop kept; one at the check or save step falls back to step 4 (index 3), because the picture is never stored. Never throws.
- `asksForPictureAgain(stored)`: whether that fallback happened, so the page can say so.
- `makerActions`:
  - `went(i)`: a tap on a step; only an integer 0-5 that `reachable` allows. Raises the furthest step to at least `min(i, 3)`.
  - `reached(i)`: Next on steps 1-3 and the return from the image AI: raises the furthest step to `min(i, 3)` first, then goes as `went` does (so step 5 or 6 still needs a cut).
  - `descChanged(text)`: cut to `DESC_MAX` (2000) characters, as `draftOf` reads a stored one back; a different text clears the copy time; the same text is a no-op.
  - `copied(at)` (a finite time >= 0, else ignored), `copyRefused()`.
  - `cutStarted()`: ignored while a cut runs; otherwise clears the failure, the talk choice and the saved id, goes to step 4, sets `cutting` and moves the generation.
  - `cutFinished()` (`ready`, version + 1), `cutFailed(message)` (`none`, the failure kept; an empty message becomes "Something went wrong"), `cutAborted()` (`cutting` becomes `none`, else nothing), `cutReplaced()` (version + 1, only with a cut).
  - `talkChosen("drawn" | "steady")` (version + 1; anything else ignored), `groundChosen(id)` (an unknown backdrop ignored), `cutChanged(choice)` (through `cutChoiceOf`: a value outside its slider's range takes its default), `cutReset()`.
  - `named(name)`: kept to `TEXT_MAX` (200) characters, as `draftOf` reads a stored name back.
  - `saved({ id, name, generation })`: the library saved the draft of `generation`; ignored when the generation has moved since (that draft was replaced while it was written) or for a non-string id or name; id and name kept to `TEXT_MAX`.
  - `left(at)`.
  - `startedAnother()`: a fresh draft with the backdrop kept, the generation moved; a ready cut is dropped, a running one keeps running.
- `restored({ draft, hadCut })`: Undo; the draft through `draftOf`, the generation moved, and unless a cut runs, `ready` or `none` from `hadCut`.
- `makerReducer`, selectors `hasCut(state)` and `isCutting(state)`.
- `createMakerStore({ stored, save })`: the page's store, preloaded from `makerStateFrom(stored)`. A listener calls `save(draft)` once for every action that changes the draft object (none for a status-only change); a `save` that throws is logged and never breaks a dispatch.

## Invariants

- The step stays in 0-5, the furthest step in 0-3, and `went`/`reached` never enter step 5 or 6 (index 4 or 5) without `ready`.
- A save lands only on the draft it was started from (`generation`).
- Every draft the reducers make survives `draftOf(JSON.parse(JSON.stringify(draft)))` unchanged, so what the listener stores is what the next page load reads.
- Renders stay explicit calls in the page (no subscription render): a render rebuilds the step list and binds its listeners again, which a subscription would do on every keystroke. The page therefore renders after each dispatch that changes what is shown (`maker-main.ts.md`, State).

## Example

```ts
const store = createMakerStore({
  stored: null,
  save: (d) => localStorage.setItem(KEY, JSON.stringify(d)),
});
store.dispatch(makerActions.descChanged("a fox ranger"));
store.dispatch(makerActions.reached(1));
store.getState().characterMaker.draft.step; // 1
```

## Tests

`maker-slice.test.ts` (boot rules, step rules, description and copy, the cut lifecycle, version moves, slider ranges and backdrops, start another and Undo, name, save and leaving, a save landing only on its own draft, the name caps, the storage listener); `maker-slice.property.test.ts` (step ranges and the cut rule over any action sequence, the storage round trip with names and saves generated past their cap, Undo of any earlier draft); the page end to end in `playwright-tests/character-maker.spec.js`.
