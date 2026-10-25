# walk-sheet.ts

## Purpose

The visitor's sheet on the page: writes `walk-sheet-model.ts`'s model into the
sheet's elements inside `#ar-root` (`#walk-sheet`) and the away block on
the start page (`#walk-away`), and turns taps and drags on the grab and
the peek into the store's `sheetSet`. A thin writer, wired by
`visitor-stations.ts`.

## Public API

- `WALK_SHEET_DRAG_PX = 24` - the prototype's drag threshold; the range 16-40 px is
  a phone test.
- `sheetAfterDrag(dy, thresholdPx?)` - up past the threshold `"list"`,
  down `"peek"`, a shorter (or non-finite) drag `null` (a tap).
- `quickKind(quick)` - the quick action's look: `ask` (Can't get there?),
  `finish` ("Finish the tour": the same compact look, its own kind so it
  stays with the list open - no row carries a way to finish), `suggested`
  (the labelled skip), `undo`; null for the story's end
  controls, which are the story card's.
- `wireWalkSheet({ dom, setSheet, sheet, keepListening, rowTapped }): WalkSheetView`
  - `render(model | null, { sheet, quick, position, story })` - null hides
    the sheet (the guide does not run).
  - `renderAway(model | null)` - null hides the away block.
- `WalkSheetDom` - the elements (ids in `index.html.md`).

## Invariants & assumptions

- Every text and state comes from the model; the writer writes a node
  only when what it shows changed (the sheet is redrawn on every guide
  call, a camera frame among them), so a screen reader is not re-told.
- Taps and the keyboard go through `click` (a toggle); drags through
  pointer events. A drag that changed the sheet swallows the click that
  follows it. A tap on a button inside the peek (the quick action) is
  that button's.
- Data attributes for the CSS and the tests: `data-sheet` and
  `data-complete` on the root, `data-kind` and `data-position` on the
  peek, `data-kind` on the quick action and the segments, `data-kind`
  end|ask on the story's end control, `data-state` and `data-id` on rows,
  `data-s` (on, now, off) and `data-timed` on the story's dots.
- The completion card has no button of its own: the X at the top left
  (`#enter-ar`) is the one way out of AR (an "Exit AR" there only clicked
  the X again).
- "Keep listening" shows only beside the confirm ("End this story" asked).
- **Focus follows what takes a hidden control's place**
  (`hideKeepingFocus(el, hidden, fallback, active)`, exported): when
  "Keep listening" hides while focused, the focus moves to the story's
  end control (`#walk-story-end`); when the story card closes with the
  focus inside it, to the grab. A focused element that hides drops the
  focus to the body, and a keyboard or switch user starts over.
  - The browser blurs a focused control the moment it is hidden, and the
    guide hides the story's end control before the sheet hides the card,
    so the card's case is caught at its `focusout`:
    `focusLostToHiding(target, related)` (exported, pure) counts only a
    loss to nowhere from a control that hid (itself or a parent) or left
    the page; a tab to another control or a window blur moves nothing.
- **The grab's target is 44 px** around its 5 px pill: `.walk-grab::before`
  reaches 11 px above the sheet's edge and 11 px into the segments, so
  the layout is the prototype's unchanged. The grab carries `aria-controls="walk-list"`
  beside `aria-expanded`.
- The guide writes the labels of `#station-skip` and `#walk-story-end`;
  this module writes only their looks.

## Examples

```ts
const view = wireWalkSheet({
  dom,
  sheet: () => selectWalkSheet(store.getState()),
  setSheet: (s) => store.dispatch(sheetSet(s)),
  keepListening: () => guide.cancelAsk(),
  rowTapped: (id, tap) => guide.rowTapped(id, tap),
});
view.render(model, { sheet: "peek", quick, position: "distance", story: null });
```

## Tests

- `walk-sheet.test.ts` - `sheetAfterDrag` (a property over thresholds
  16-40 px), `quickKind`, `hideKeepingFocus` and `focusLostToHiding`,
  and that the only rule hiding `#station-skip` with the list open spares
  "Finish the tour".
- `walk-sheet.dom.test.ts` (jsdom, on the real `index.html` markup) -
  the view hides the order chip's element for a fixed and a branching
  order after an any-order render, and shows "Any order".
- The DOM half is driven end to end by
  `playwright-tests/visitor-walk.spec.js` (open and close by tap and
  drag, the story card, the completion, the away block) and
  `playwright-tests/visitor-walk-layout.spec.js` (positions and gaps).

## The direction arrows

- `WalkSheetDom.distanceText` and `distanceArrow` - the peek's distance
  is an arrow (`#walk-distance-arrow`) and a text (`#walk-distance-text`)
  inside `#walk-distance`, which keeps its test id and its "N m" text.
- A row's sub line is an arrow and a text span inside its `small`.
- `setArrow(el, deg)` - writes `data-deg` (the angle asked) and the
  transform only when the whole degree changed; null removes both (the
  CSS hides an arrow without `data-deg`). The transform turns the short
  way from the angle shown (`data-turn`, which may leave -180..180): the
  arrow's CSS eases its turns, and 170 to -170 must turn 20 degrees to
  190, not 340 back. Shown again after a hide, it starts at its angle.
- The rows' redraw key leaves the arrows out: an angle changes every
  frame, so the arrows turn in place while the rows rebuild only when
  something else changed (the sub lines and the names too, below).
- Tests: `setArrow` in `walk-sheet.test.ts`; the page in
  `playwright-tests/visitor-walk.spec.js`.

## The rows' controls and the hint

- `wireWalkSheet` takes `rowTapped(stationId, tap)` (the guide's
  `rowTapped`), and `render` takes `end` (the story card's end control's
  action, the end-a-story rule; its `data-kind` end|ask follows it, no longer the quick).
- A row is `li.walk-row[data-state][data-id][data-chosen]` with its glyph,
  a title button `.walk-row-main` (`data-tap="choose"`, "Guide me here":
  `aria-pressed` where a target can be chosen, `disabled` otherwise), its
  action `.walk-row-act` (`data-tap` and `data-k` skip|bring|undo), the
  confirm `.walk-confirm` ("Skip <title> - I can't get there" beside
  Cancel) and the undo's bar `.walk-undobar`. Taps reach the rows'
  container by delegation (the rows are rebuilt on a change); `rowTapOf`
  maps a control's `data-tap` to the guide's tap (`undo` is a bring back).
- **The redraw key** (`rowsDrawKey`, exported, pure) leaves out the
  arrow's angle and the undo's time left (both change every frame), and
  the sub line and the title button's accessible name (the metres and
  the direction word change as the visitor walks). `drawRows` writes
  those four in place on every render (each only on a change), so a
  row is rebuilt - its buttons replaced, a tap in flight and the focus
  lost - only when its title, state or controls changed. The undo's bar
  runs down by its own CSS animation from the share left when the row
  was drawn (`--walk-undo-from`, `--walk-undo-ms`); under
  `prefers-reduced-motion` it stands still at that share.
- **The focus after a row tap:** the tapped control is rebuilt or gone,
  so the focus goes to what took its place (`focusAfterTap`, exported,
  pure): Skip to its confirm, the confirm to the undo, Cancel and a bring
  back to Skip, "Guide me here" to itself; else the list's close button.
- **The quick action hides while the list is open** (the prototype; CSS on
  `data-sheet="list"`): the rows carry Skip, its confirm and the undo. A
  focus it held when it opened the list goes to the armed row's confirm,
  else (the chooser, no row armed) to the first row's Skip, else to the
  close button.
- `WalkSheetDom.hint` (`#walk-hint`) - the list's hint while no station is
  guessed, between the progress line and the rows; hidden otherwise.
  While it shows, every row's Skip carries `aria-describedby="walk-hint"`,
  so a screen reader hears the chooser's question with the control that
  answers it.
- **Reduced motion:** every animated rule of the walk's CSS is named by
  its own selector in the walk's `prefers-reduced-motion` block (a
  shorter selector loses to the animated rule's specificity, which left
  the coach's spinner running); `walk-sheet.test.ts` holds the two lists
  together.
- Tests: `rowsDrawKey`, `rowTapOf` and `focusAfterTap` in
  `walk-sheet.test.ts`, with the reduced-motion guard over the walk's CSS;
  the page in `playwright-tests/visitor-walk.spec.js` (a row kept, with
  its focus, through a walk that changes its metres; the chooser's
  focus and description)
  and `playwright-tests/visitor-walk-layout.spec.js`.
