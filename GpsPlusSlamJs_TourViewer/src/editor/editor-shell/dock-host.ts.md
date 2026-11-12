# dock-host.ts

## Purpose

Docks the editor's panels around the 3D view with the `dockview` library
(8.7.1, pinned): the page's own elements become panels, the 3D view's
canvas sits in the centre, and the docking library's state is the only
source of truth for the layout. This module is the one place that shows a
panel, hides a group or folds a side.

It is loaded by a dynamic `import()` with the 3D view (`editor-shell.ts`'s
`deps.dock`, given by `edit-main.ts`), so the library and its stylesheet
are not part of the page's first load.

## Public API

- `mountDockHost({ box, onChange })` -> `DockHost`. `box` is `#view3d`;
  the layout is a `.dock-host` element in it (below the accent line) and
  `box` carries the `docked` class while it lives. `onChange()` runs
  whenever a panel is shown, hidden or chosen, by the library's own
  controls or by this host.
- `DockHost`:
  - `reveal(id)` - shows a panel: its group visible (a folded side
    unfolded), the panel its group's shown tab.
  - `hideGroupOf(id)` / `groupShown(id)` - the group holding `id`.
  - `activeIn(id)` - the shown tab of the group holding `id`.
  - `fold("list" | "details", folded)` - folded, the group hides and the
    adopted element goes back to the view box, where the undocked CSS
    draws its folded head; unfolded, it comes back into its panel.
  - `content(id)` - the element a panel's content sits in
    (`.dock-pane.dock-pane-<id>.dock-group-<group>`).
  - `keyboard(px)` - an on-screen keyboard of `px` (0: none) came, changed
    or went: the groups are laid out for the box now rather than on the next
    frame (the phone keyboard calls it before scrolling a field into sight).
    While `keyboardMaximizes(innerHeight, px)` (what the keyboard leaves is
    under `KEYBOARD_ROOM_PX`), the shown group whose panel holds the focus
    is maximized with its tab strip hidden; a focus coming into the layout
    while the keyboard is up (a `focusin`) maximizes the group it lands in.
    While one is maximized the other groups are hidden and their panels out
    of the page (they render only while shown), so the focus cannot move
    to another group's field until the layout is given back.
    The focus leaving the panels (to the top bar) gives nothing back by
    itself: on a phone the keyboard goes with the focus, and its going
    gives the layout back.
    When the keyboard goes or leaves enough room, the layout is given
    back: each group shown before at its size
    and with its shown tab (a side group at the new window's width if the
    window was resized meanwhile). A group shown or hidden meanwhile ends the
    maximized state through the docking itself; nothing is then held.
    Maximized, every group's least height is 0 (given back after), and the
    layout carries `keyboard-max`: the docking library never lays its
    centre out under 100 px tall, so where the keyboard leaves less the
    layout keeps its top (the panel's head and its buttons in sight) and
    runs on under the keyboard (`editor-shell.css`); `--dock-under` on
    the layout is how far, and the panels' scrollers stop a field brought
    into sight that far above the layout's end (`scroll-padding-bottom`).
  - `dispose()` - every adopted element still in the layout back at its
    old place (parent and next sibling), the layout removed, `docked`
    taken off. A part removed meanwhile by the code that made it (the 3D view's canvas,
    when the view closed first) is not put back: seventeen opens would
    otherwise leave seventeen dead canvases in the page.
- `FoldingPanel` - `"list" | "details"`.

## Invariants & assumptions

- The default layout is `defaultDockLayout` (`dock-layout.ts`). The 3D
  view is added with `renderer: "always"`, so it keeps its canvas and
  drawing context whatever shows. Every other panel is added with
  `renderer: "onlyWhenVisible"`: its content stands inside its group,
  after the group's tabs, so Tab follows what is seen (the top bar, the
  list, then the panels to its right). With `"always"` the docking
  library puts a panel's content after every group, and Tab walked every
  tab strip before any panel.
- A panel behind another tab of its group is out of the page. So:
  - the scroll of each element in it is recorded on its `scroll` events
    and given back when the panel shows again (`onShow`, and once more a
    frame later for a group not yet laid out);
  - a field half typed is committed by the tab's click, as a click
    anywhere else does, and is in the field when its panel shows again;
  - the work behind a panel (the shelf optimizing a file) goes on: it
    draws into its element, in the page or not;
  - an adopted element is found through the host's own record, not by
    `getElementById` (`fold`), and `dispose` puts back the ones out of the
    page too. Code elsewhere that looks a docked panel up by id finds
    nothing while it is behind another tab.
- The centre group is locked (nothing is dropped onto it as a tab). A
  group's tab strip hides while it holds only the 3D view or only the
  list (`stripHidden`), which carry their own head, and shows again as
  soon as a tab joins it. The tab menu offers no popout; the 3D view
  offers only maximise. A docked panel's tab has no close button
  (`editor-shell.css`): its element is the page's. Nor does a tab's
  Delete or Backspace close it (the library's tab-strip key): a
  capture-phase listener on the layout stops both keys on a tab, so they
  never reach the page either, where they delete the selection.
- First sizes are pinned (minimum = maximum) and released after the next
  layout to 140 px wide / 90 px high, since a plain size is overruled by
  the relayout a constraint change starts. The bottom group starts hidden
  and gets its first height when first shown.
- The canvas, the model's notes and the map controls move into the 3D
  view's panel; a mutation observer moves those the view adds later (a
  new canvas). Moving a canvas keeps its WebGL context.
- While the details hold the long text's writer (their `lw` class, `lw-wide`
  when wider) their group takes `writerWidthPx`, and gets back the width it
  had once the writer goes (the new window's column width after a window
  resize while it showed).
- A window resize scales every group (the docking library's proportional
  layout); the side groups then take `dockWidths` of the new window (the
  writer's width while it shows), the 3D view the rest. A side group hidden
  meanwhile, or hidden before its first width was laid out, takes it when
  it next shows. The bottom group likewise takes `bottomStartPx` of the new
  layout, now or when it next shows. A size dragged by hand therefore
  lasts until the next window resize.
- Moving an element loses its focus to the page (and a phone its
  keyboard): a fold, the mount and `dispose` give the focus back to the
  element that held it, or, out of sight now, to the first control in
  sight in the moved element; so does `reveal` (a row picked from the keyboard
  shows its details). A group just shown takes no focus until the docking
  places it, so the focus is tried again on the next two frames while it
  is still on the page.
- `.dock-pane` clips (`overflow: clip`), so a scroll into view never
  scrolls a panel's head out of it.
- During a splitter drag the canvas is held at its size in px and fitted
  once on release (each resize reallocates the drawing buffers).
- Defensive: an unknown panel id throws; a fold of a side already in that
  state, or whose element is missing, does nothing; `dispose` is
  idempotent.

## Examples

```ts
const { mountDockHost } = await import("./dock-host.js");
const dock = mountDockHost({ box: viewBox, onChange: sync });
dock.reveal("problems");
dock.fold("list", true);
dock.dispose();
```

## Tests

- No unit test of its own: it is DOM and library glue, covered by the
  layout e2e (`playwright-tests/editor3d-docking.spec.js`) at four window
  sizes; its data is `dock-layout.ts`'s, unit and property tested.
- The same spec covers a tab's Delete and Backspace (nothing closed, nothing
  deleted), the focus kept over a fold and over a turn between docked and
  undocked, and the canvas held during a splitter drag, and a panel
  behind another tab (Details behind Files, the list dragged beside
  Files) keeping its scroll, its folds and a half-typed field; the shelf
  spec covers a file added while Files is hidden.
