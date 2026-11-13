# dock-host.ts

## Purpose

Docks the editor's panels around the 3D view with the `dockview` library
(8.7.1, pinned): the page's own elements become panels, the 3D view's
canvas sits in the centre, and the docking library's state is the only
source of truth for the layout. This module is the one place that shows a
panel, hides a group or folds one to its rail.

It is loaded by a dynamic `import()` with the 3D view (`editor-shell.ts`'s
`deps.dock`, given by `edit-main.ts`), so the library and its stylesheet
are not part of the page's first load.

## Public API

- `mountDockHost({ box, onChange, storage? })` -> `DockHost`. `box` is
  `#view3d`; the layout is a `.dock-host` element in it (below the accent
  line) and `box` carries the `docked` class while it lives. `onChange()`
  runs whenever a panel is shown, hidden or chosen, by the library's own
  controls or by this host. `storage` (the browser's; `null` or absent:
  nothing kept) is where the layout is kept per form factor
  (`dock-save.ts`).
- `DockHost`:
  - `restored()` - whether the layout came from a kept one rather than the
    default (the shell then takes its folds into the store).
  - `reveal(id)` - shows a panel: its group visible and unfolded, the
    panel its group's shown tab. The page's one way to unfold a group:
    the store learns of it through `onChange` (`editor-shell.ts`).
  - `hidePane(id)` - `id` out of sight: its group hidden when it holds
    only the bottom panel's panes (their toggles show it again), else
    `id` concealed as by `conceal` (a pane dragged into another group
    takes only itself away; alone there, its group folds to its rail).
  - `groupShown(id)` - the group holding `id` shows, unfolded.
  - `conceal(id, instead?)` - takes a shown panel out of sight: `instead`
    shown in its place when its group holds it, else the group's next
    panel; alone in its group, the group out of sight as by
    the group hidden (only bottom panes) or folded to its rail. The shelf's toggle pressed again uses it with Files
    and Details, wherever Files was dragged.
  - `activeIn(id)` - the shown tab of the group holding `id`.
  - `fold(id, folded)` / `folded(id)` - the group holding `id` folded to
    a rail, or unfolded (`dock-rail.ts` is the rule): a column (55 % of
    the layout's height or more) folds its width, its tabs turned upright
    along it (the header on its left), a group above or below the view
    folds its height; the rail is `railPx` thick (34 px for a mouse, 44
    for a coarse pointer), pinned (least = most). The 3D view's group and
    a floating one never fold. The other docked groups keep their sizes
    along their own axes, so the 3D view takes or gives the room. An
    unfold pins the group back at the size it had (at least
    `UNFOLD_MIN_PX`) and releases it after the next layout. A folded
    group's panel stays in its group: the rail hides its content
    (`.dock-folded`), so nothing in it takes the focus.
  - `badge(id, badge | null)` - the count on `id`'s tabs (`DockBadge`:
    count, `bad`, the words a screen reader says for it), kept for tabs
    drawn later (a tab dragged elsewhere is drawn again).
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
    into sight that far, plus their usual 8 px, above the layout's end
    (`scroll-padding-bottom`), and run that much longer (an empty
    `::after`), so their last control can rise above the keyboard too.
    What stands outside a scroller at the panel's foot (the list's
    selection bar and its foot) stays under the keyboard while it is up:
    the trade for the head in reach.
  - `dispose()` - every adopted element still in the layout back at its
    old place (parent and next sibling), the layout removed, `docked`
    taken off. A part removed meanwhile by the code that made it (the 3D view's canvas,
    when the view closed first) is not put back: seventeen opens would
    otherwise leave seventeen dead canvases in the page.
- `DockBadge` - `{ count, bad, label }`.

## Invariants & assumptions

- The layout is kept per form factor (`dockFormFactor`: the desk, a phone
  upright, a phone sideways) under `dockSaveKey(formFactor)`, with the
  folds of its groups (and the size each had before folding). It is
  taken at each change (a drag, a fold, a tab chosen) and written
  `KEEP_DELAY_MS` after the last (`createDockKeeper`); a pending one is
  written at once when the window turns to another form factor and on
  `dispose`. Nothing is taken while a group is maximized or once the
  window has taken another form factor, so the layout written is the one
  of before the turn. On mount the window's
  form factor's kept layout is loaded when `readSavedDock` accepts it and
  the library loads it with every panel; otherwise the layout is cleared
  and the default laid out, never an empty one. A resize into another
  form factor clears the layout and lays out that form factor's kept one
  (or the default), refolding its kept folds. A kept layout laid out at
  another size than it was kept at (`keptAtSize`) is fitted as after a
  window resize (below), not scaled in proportion.
- A tab's Shift+F10 or ContextMenu key opens "Move to..." (`dock-move.ts`)
  for its panel: into another group, or left of, right of or below the 3D
  view. The library's tab menu offers the same entry for a mouse. The move
  is the library's `moveTo`; the panel is then revealed and the focus put
  on its tab. The library's own context menu, which the key would also
  open, is suppressed for a moment.
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
    `getElementById`, and `dispose` puts back the ones out of the
    page too. Code elsewhere that looks a docked panel up by id finds
    nothing while it is behind another tab.
- Tabs are dragged by the library's own drag (a mouse's, or a finger's
  pointer drag): beside, below or into another group; a group dragged
  empty is removed by the library, its fold forgotten (`prunedTo` on each
  layout change). The centre group is locked: nothing is dropped onto it
  as a tab, though a tab still splits beside it. A group's tab strip
  hides while it holds only the 3D view or only the list (`stripHidden`),
  which carry their own head, and shows again as soon as a tab joins it
  or the group folds (the rail is its strip). The tab menu offers no
  popout; the 3D view offers only maximise.
- Each tab is the host's own (`createTabComponent`, asked for only
  because `defaultTabComponent` names one; without a name the library
  draws its own tab): its panel's icon
  (`dock-layout.ts`'s `icon`, from the editor kit's set), its title (on
  an upright rail only its accessible name) and its count, a
  `role="img"` mark named by the badge's words. A tap on a tab of a
  folded group unfolds it. It has no close button: its element is the
  page's.
- Each group's fold button sits at the end of its tab strip
  (`createRightHeaderActionComponent`), hidden on a group that cannot
  fold; it points to the side the group folds to (`railSide`) and away
  once folded, named "Fold <tab>" / "Unfold <tab>" with `aria-expanded`.
  The library builds a group's header actions again when its header
  turns on its side; the same element is handed back each time, so a
  press keeps the focus on it. Nor does a tab's
  Delete or Backspace close it (the library's tab-strip key): a
  capture-phase listener on the layout stops both keys on a tab, so they
  never reach the page either, where they delete the selection.
- First sizes are pinned (minimum = maximum) and released after the next
  layout to 140 px wide / 90 px high (not a group folded meanwhile), since a plain size is overruled by
  the relayout a constraint change starts. The bottom group starts hidden
  and gets its first height when first shown.
- The canvas, the model's notes and the map controls move into the 3D
  view's panel; a mutation observer moves those the view adds later (a
  new canvas). Moving a canvas keeps its WebGL context.
- While the details hold the long text's writer (their `lw` class, `lw-wide`
  when wider) their group takes `writerWidthPx`, and gets back the width it
  had once the writer goes (the new window's column width after a window
  resize while it showed). Folded, the rail keeps its width and the width
  the group unfolds at is the one it would have taken.
- A window resize scales every group (the docking library's proportional
  layout); the side groups then take `dockWidths` of the new window (the
  writer's width while it shows), the 3D view the rest. A side group hidden
  meanwhile, or hidden before its first width was laid out, takes it when
  it next shows. The bottom group likewise takes `bottomStartPx` of the new
  layout, now or when it next shows, while its group holds only the bottom
  panel's panes (Problems dragged into the right column leaves that
  column's height alone). A folded group keeps its rail. A size dragged
  by hand therefore lasts until the next window resize, or a reload at
  another window size.
- A fold takes the focus out of the group's panel: it goes to the group's
  fold button, which keeps it while it unfolds; where the unfolded group
  shows no strip (the list alone), to the panel's own head's fold button
  (`dock-layout.ts`'s `fold`).
- Moving an element loses its focus to the page (and a phone its
  keyboard): the mount and `dispose` give the focus back to the
  element that held it, or, out of sight now, to the first control in
  sight in the moved element; so does `reveal` (a row picked from the keyboard
  shows its details). A group just shown takes no focus until the docking
  places it, so the focus is tried again on the next two frames while it
  is still on the page.
- `.dock-pane` clips (`overflow: clip`), so a scroll into view never
  scrolls a panel's head out of it.
- During a splitter drag the canvas is held at its size in px and fitted
  once on release (each resize reallocates the drawing buffers).
- A group's fold button is drawn once the 3D view is in the layout (the
  first groups are made before it), hidden until then.
- Defensive: an unknown panel id throws; a fold of a group already in
  that state, of the 3D view's or a floating group, or of one whose size
  is unknown, does nothing; `dispose` is idempotent.

## Examples

```ts
const { mountDockHost } = await import("./dock-host.js");
const dock = mountDockHost({ box: viewBox, onChange: sync });
dock.reveal("problems");
dock.fold("list", true);
dock.dispose();
```

## Tests

- The kept layout's checks are `dock-save.ts`'s and the move menu is
  `dock-move.ts`'s, unit tested there; the spec covers a rearranged layout
  coming back on the next open, a broken one giving the default, the desk
  and a phone sideways keeping their own, a change just before the window
  turns kept, a kept layout opened in a wider window at that window's side
  widths, the 3D view's canvas staying in its panel and drawing while the
  window turns, the keyboard move, and the problem count on a folded rail.
- No unit test of its own: it is DOM and library glue, covered by the
  layout e2e (`playwright-tests/editor3d-docking.spec.js`) at four window
  sizes; its data is `dock-layout.ts`'s, unit and property tested.
- The same spec covers a tab's Delete and Backspace (nothing closed, nothing
  deleted), the focus kept over a fold and over a turn between docked and
  undocked, the panels rearranged by their tabs (Files below Details,
  Problems into the Details group, a tab on the 3D view refused) at three
  sizes, each side folded to its rail and back with the 3D view taking
  the room at two, a drag and a fold by touch, and the canvas held during a splitter drag, and a panel
  behind another tab (Details behind Files, the list dragged beside
  Files) keeping its scroll, its folds and a half-typed field; the shelf
  spec covers a file added while Files is hidden.
