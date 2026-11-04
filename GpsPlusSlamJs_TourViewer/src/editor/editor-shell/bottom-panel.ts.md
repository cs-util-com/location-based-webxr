# bottom-panel.ts

## Purpose

The 3D view's bottom panel: one collapsible, resizable panel at the view's
foot with four tabs - Problems, History, Map loading and Performance -
opened by the bottom bar's named toggles, each toggle with a badge only
while there is something to see. Its rules are `bottom-panel-model.ts`;
this draws them and takes the clicks, the grip's drag and the keys.

## Public API

- `createBottomPanel(deps)` -> `BottomPanel`. `deps`:
  - `panel` (`#shell-panel`) and `toggles` (`#shell-toggles`): the page's
    empty boxes, filled here;
  - `box` (`#view3d`): its height bounds the panel's; it carries the
    `panel-span` class while a spanned panel is open;
  - `choose(selection)` - a problem's row clicked, or Enter or Space on
    it (the shell selects and flies to it);
  - `fix(selection, fix)` - a problem's fix link clicked (`ProblemFix`,
    `tour-problems.ts`; the shell selects, writes `fix.edit()` as one undo
    step and says `fix.done`);
  - `map` (`PanelMap`) - the shown view's street map: `tiles(limit)`,
    `retry()` (how many failed tiles it asked for again), `lastRetry()`
    (what became of them);
  - `stepTime(step)` - when a history step was made (ms), or undefined;
  - `now()` - the clock (default `Date.now`);
  - `step(which)` - one undo or redo (a History row takes several);
  - `storage` - where the height and the last tab are kept, or null.
- `BottomPanel`:
  - `problems(groups, selected)` - the tour's problems (`tour-problems.ts`)
    and the selection, marked on its row;
  - `history({ past, future, position, savedAt })` - the edit history;
  - `tick(readout)` - the view's readout (`Editor3dReadout`): the Map
    loading (`mapLoad`) and Performance tabs and their badges, the History
    rows' ages and a retry under way;
  - `key(event)` - true when it took the key: Ctrl+J (open or close, the
    last tab), Ctrl+Shift+M (the problems), Escape with the focus inside
    it (closes it, the focus back on its toggle);
  - `state()` - `{ open, tab, max, heightPx }`, for checks;
  - `hide()` - the view hides: closes it and forgets the frames.
- `PanelMap` - the `map` dependency's shape.
- `PANEL_STORAGE_KEY` - `"editor-bottom-panel"`, its kept JSON `{ h, tab }`.

## Invariants & assumptions

- **The page's variable:** `--s-panel-h` on `document.body` (not on the
  view's box) is the open panel's height (0px closed). The panel **pushes
  the 3D view up**: the view's canvas ends at its top
  (`editor-shell.css`), and both views read their size from the canvas;
  the docks keep their height. The map controls (inside the view) and the
  toasts (outside it) stand above it.
- **The head:** the tab strip (`role="tablist"`, arrow keys move between
  tabs), the tab's tools (Problems: the Errors, Warnings and Notes
  filters, each with its count; History: Undo and Redo, disabled without
  a step; Map loading: "Retry failed" and its status line), then span,
  maximise and close.
- **The panes:** Problems groups by station (a group folds), an empty
  state, and "N hidden by the filters above." when the filters hide all.
  A problem's row is a focusable `div.prow` (Enter or Space selects; a
  button could not hold the fix link) with its fix link, `button.lnk.fix`,
  where the problem has one. History is a timeline, newest on top, "now"
  and "saved" tags, and each step's age ("just now", "N min ago",
  `minutesAgo`) kept current on the tick; the base row ("Opened the tour")
  has no time. Map loading: a sum row (loaded, loading, waiting from the
  tile rows; failed and given up from `mapLoad`; the source and its finest
  zoom), the map server's wait as one live banner (`role="status"`, kept
  and updated in place: its words are never re-announced, only its bar
  and countdown change), a loaded state, and the tile table (Status, Tile
  `z/x/y`, Layer, Note, Time; the first 40 of the overlay's rows, failed
  first). Performance a sparkline of the frame intervals (guides at
  60 fps, 30 fps and 50 ms; slow frames dotted), drawn only when the
  canvas has a size, and the numbers: frames (average, worst, slow in
  5 s), scene (draw calls, triangles), view (top or 3D, tilt and heading).
- **Retry:** a click asks `map.retry()`. None failed: "Nothing to retry".
  A throw: "Could not retry: ..." and the chip stays usable. Else the chip
  is disabled with `aria-busy` and "Retrying N tiles..." until
  `map.lastRetry()` shows every retried tile loaded ("N tiles loaded") or
  failed again ("N tiles failed again", or both counts), or 30 s pass
  ("Still loading - the map keeps asking for them"). The status line has
  `role="status"`.
- **Focus kept:** every redraw while the focus is inside the panel
  (`keepingFocus`) finds the focused control again by its data attribute
  (`fix`, `select`, `fold`, `row`, `filter`, `step`, `retry`) and focuses
  the new one; when it is gone or disabled the focus goes to the shown
  tab, never to the page's body. This holds when the shell redraws the
  problems from inside `choose` (the selection marked).
- **The grip** is a `role="separator"` with `aria-valuenow`,
  `aria-valuemin` (90) and `aria-valuemax` (the view's height), set by
  every layout.
- **Height:** the first open of a visit starts at the kept height, at most
  about half the view, at least 120 px (`startHeight`; so a phone in
  landscape starts at half the view); later opens keep what the grip
  left. The grip drags (pointer capture), closes under 70 px, maximises
  near the top; a double click on it or the head maximises; ArrowUp and
  ArrowDown on the focused grip step 20 px. Maximised, it takes the view's
  whole height and the view above keeps none.
- **Intended, kept as they are:** Escape closes the panel only with the
  focus inside it (elsewhere Escape is the view's: it deselects); on the
  2D map the bottom bar keeps its empty strip (the toggles are the 3D
  view's).
- **Defensive:** the kept values are read through `readSaved`; storage
  that throws (a private window) is caught both ways and the panel opens
  at its defaults. A drag ends only for the pointer that began it. A
  retry that throws is said, never left busy.
- **No awaited work but the retry:** every other action (a tab, a filter,
  a row, Undo, a fix) is synchronous, so no in-progress state is drawn
  for it.
- Text, never markup, from the tour (titles and step names set as text);
  the icons are fixed SVG paths of this file.

## Examples

```ts
const panel = createBottomPanel({
  panel,
  toggles,
  box,
  choose,
  fix,
  map: { tiles, retry, lastRetry },
  stepTime: (step) => times.get(step),
  step,
  storage: localStorage,
});
panel.problems(tourProblems(stations), selected);
panel.tick(view.readout());
```

## Tests

`bottom-panel.test.ts` (jsdom): the named toggles with no badge at rest;
open, switch and close, the page's height variable, the grip's separator
values; Ctrl+J, Ctrl+Shift+M and Escape only from inside (the focus
returned); the problems' badge, rows (the selected marked, a click or
Enter choosing), the fix link, the focus kept when the problems redraw
inside the choice and kept inside when its control is gone, filters,
folds and empty state; History's rows taking exactly their steps, their
ages kept current, the focus kept on the step taken, Undo and Redo
enabled only with a step; Map loading's badge order, the one live
banner, the tile table and counts, Retry busy until loaded, failed
again, nothing to retry, a throw and the 30 s watch; Performance's badge
and numbers; the kept tab and height, a dragged height kept, a low drag
closing, storage that throws, maximise and restore, and `hide()`. The
wiring is `editor-shell.test.ts`'s; the layout at three sizes, the
push-up, the landscape start and the keyboard walk are
`editor3d-shell.spec.js`'s.
