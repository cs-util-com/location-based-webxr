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
  - `dispose()` - every adopted element still in the layout back at its
    old place (parent and next sibling), the layout removed, `docked`
    taken off. A part its owner removed meanwhile (the 3D view's canvas,
    when the view closed first) is not put back: seventeen opens would
    otherwise leave seventeen dead canvases in the page.
- `FoldingPanel` - `"list" | "details"`.

## Invariants & assumptions

- The default layout is `defaultDockLayout` (`dock-layout.ts`). Panels
  are added with `renderer: "always"`, so an inactive tab keeps its
  element (the 3D view its canvas and drawing context).
- The centre group is locked (nothing is dropped onto it as a tab) and
  its tab strip is hidden. The tab menu offers no popout; the 3D view
  offers only maximise. A docked panel's tab has no close button
  (`editor-shell.css`): its element is the page's.
- First sizes are pinned (minimum = maximum) and released after the next
  layout to 140 px wide / 90 px high, since a plain size is overruled by
  the relayout a constraint change starts. The bottom group starts hidden
  and gets its first height when first shown.
- The canvas, the model's notes and the map controls move into the 3D
  view's panel; a mutation observer moves those the view adds later (a
  new canvas). Moving a canvas keeps its WebGL context.
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
