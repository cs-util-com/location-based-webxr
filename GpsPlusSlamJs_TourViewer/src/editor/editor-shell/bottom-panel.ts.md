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
  - `choose(selection)` - a problem's row clicked (the shell selects and
    flies to it);
  - `step(which)` - one undo or redo (a History row takes several);
  - `storage` - where the height and the last tab are kept, or null.
- `BottomPanel`:
  - `problems(groups, selected)` - the tour's problems (`tour-problems.ts`)
    and the selection, marked on its row;
  - `history({ past, future, position, savedAt })` - the edit history;
  - `tick(readout)` - the view's readout (`Editor3dReadout`): the Map
    loading (`mapLoad`) and Performance tabs and their badges;
  - `key(event)` - true when it took the key: Ctrl+J (open or close, the
    last tab), Ctrl+Shift+M (the problems), Escape with the focus inside
    it (closes it, the focus back on its toggle);
  - `state()` - `{ open, tab, max, heightPx }`, for checks;
  - `hide()` - the view hides: closes it and forgets the frames.
- `PANEL_STORAGE_KEY` - `"editor-bottom-panel"`, its kept JSON `{ h, tab }`.

## Invariants & assumptions

- **The page's variable:** `--s-panel-h` on `document.body` is the open
  panel's height (0px closed), so the map controls (inside the view) and
  the toasts (outside it) stand above it.
- **The head:** the tab strip (`role="tablist"`, arrow keys move between
  tabs), the tab's tools (Problems: the Errors, Warnings and Notes
  filters, each with its count; History: Undo and Redo, disabled without
  a step), then span, maximise and close.
- **The panes:** Problems groups by station (a group folds), an empty
  state, and "N hidden by the filters above." when the filters hide all;
  History is a timeline, newest on top, "now" and "saved" tags; Map loading
  a sum row (loading, failed, given up), the map server's wait as a banner
  with a bar and a countdown, and a loaded state; Performance a sparkline
  of the frame intervals (guides at 60 fps, 30 fps and 50 ms; slow frames
  dotted), drawn only when the canvas has a size, and the numbers: frames
  (average, worst, slow in 5 s), scene (draw calls, triangles), view (top
  or 3D, tilt and heading).
- **Height:** the first open of a visit starts at the kept height, at most
  about half the view (`startHeight`); later opens keep what the grip
  left. The grip drags (pointer capture), closes under 70 px, maximises
  near the top; a double click on it or the head maximises; ArrowUp and
  ArrowDown on the focused grip step 20 px. Maximised, it takes the view.
- **Defensive:** the kept values are read through `readSaved`; storage
  that throws (a private window) is caught both ways and the panel opens
  at its defaults. A drag ends only for the pointer that began it.
- **No awaited work:** every action (a tab, a filter, a row, Undo) is
  synchronous; the shell's undo and selection are, so no in-progress state
  is drawn.
- Text, never markup, from the tour (titles and step names set as text);
  the icons are fixed SVG paths of this file.

## Examples

```ts
const panel = createBottomPanel({
  panel,
  toggles,
  box,
  choose,
  step,
  storage: localStorage,
});
panel.problems(tourProblems(stations), selected);
panel.tick(view.readout());
```

## Tests

`bottom-panel.test.ts` (jsdom): the named toggles with no badge at rest;
open, switch and close, the page's height variable; Ctrl+J, Ctrl+Shift+M
and Escape only from inside (the focus returned); the problems' badge, rows
(the selected marked, a click choosing), filters, folds and empty state;
History's rows taking exactly their steps, Undo and Redo enabled only with
a step; Map loading's badge order and banner; Performance's badge and
numbers; the kept tab and height, a dragged height kept, a low drag
closing, storage that throws, maximise and restore, and `hide()`. The
wiring is `editor-shell.test.ts`'s; the layout at three sizes is
`editor3d-shell.spec.js`'s.
