# dock-layout.ts

## Purpose

The editor's docked layout as data: which panels dock, which page element
each adopts, where each starts and how wide. No DOM and no docking
library: `dock-host.ts` applies it.

## Public API

- `DOCK_MIN_PX` (701) and `docksAt(widthPx)` - from this window width up
  the panels dock (a phone held sideways, 844 px, included); below it the
  phone's sheets (`phone-sheet.ts`, `PHONE_SHEET_PX` = 700) show them. A
  non-finite width never docks.
- `BOTTOM_PANEL_IDS` (`problems`, `history`, `tiles`, `perf`), the bottom
  panel's tabs in its order (`bottom-panel-model.ts`'s `PANEL_TABS`), and
  `isBottomPanelId(x)`.
- `DockPanelId` - `view`, `list`, `details`, `files` or a bottom id.
- `DOCK_PANELS` - every panel's `DockPanelSpec` `{ id, title, element,
group, icon }`, the 3D view first. `element` is the adopted page element's id
  (`shell-tree`, `shell-inspector`, `shell-shelf`, `shell-pane-<tab>`), null
  for the 3D view, whose canvas the host moves in. `group` is where it
  starts: `centre`, `left`, `right` or `bottom`. `icon` names the panel's
  icon in the editor kit's shell set, on its tab and on its rail.
- `dockPanel(id)` - a spec by id; throws on an unknown id.
  `isDockPanelId(x)` - for ids read back from the library's events.
- `stripHidden(panelIds)` - whether a group holding those panels hides
  its tab strip: true only for the 3D view or the list alone, which carry
  their own head; false for any other panel, for two or more, for none.
- `dockWidths(widthPx)` - `{ list, column }`: 248 and 300 px, the list 210
  from 1100 px down, the right column 268 from 900 px down.
- `writerWidthPx(widthPx, wide)` - the details' width while they hold the
  long text's writer: 360 px, 340 px from 1100 px down; wider, up to 540
  px and at most 52 % of the window (`long-text-editor.css`'s widths).
- `bottomStartPx(heightPx)` - the bottom group's first height: a third of
  the height below the top bar, between 90 and 220 px.
- `KEYBOARD_ROOM_PX` (390) and `keyboardMaximizes(heightPx, keyboardPx)` -
  whether an on-screen keyboard leaves the window less than 390 px, so the
  group holding the field in use takes the whole layout (`dock-host.ts`);
  false without a keyboard or for a non-finite input.
- `defaultDockLayout(widthPx, heightPx)` - `DockStep[]`: the 3D view; the
  list left of it; Details right of it with Files as its second tab
  (inactive); Problems below the view with History, Map loading and
  Performance as its further tabs (inactive).

## Invariants & assumptions

- Every panel appears exactly once in the default layout, the 3D view
  first and without an `against`; every other step is placed against a
  panel added before it.
- The side panels' first widths leave the 3D view at least 220 px at any
  docked width, and the bottom group starts at most a third of the height
  (90 px at least). The long text's writer widens the details past their
  column width (`writerWidthPx`), and the wide writer at the narrowest
  docked windows leaves the 3D view less than 220 px while it is open.
- The keyboard threshold was swept with the keyboard e2e (sizes 844 x 390,
  915 x 412 and 1024 x 600, keyboards from 100 px to all but 116 px): every
  field stays in sight from 300 px up to 800 px; at 200 px the writer is
  cut by the keyboard where 262 px are left, and without maximizing (0)
  18 cases fail. 390 px sits well inside the passing range, about 130 px
  above the worst failing case, and still keeps the layout as it is for a
  small keyboard on a tablet.
- The bottom ids and the bottom panel's tab ids are the same list in the
  same order (a unit test holds them together).

## Examples

```ts
if (docksAt(window.innerWidth)) {
  for (const step of defaultDockLayout(window.innerWidth, hostHeight)) {
    // add dockPanel(step.id) beside step.against, at step.widthPx ...
  }
}
```

## Tests

- `dock-layout.test.ts` - the threshold against the phone's sheets, the
  adopted elements, the ids, the exact default layout at 1440 x 900, the
  width steps, the bottom start heights and when a keyboard maximizes.
- `dock-layout.property.test.ts` - over windows from 701 x 300 to
  4000 x 3000: every panel once, placed against an earlier one, the view
  keeps 220 px, the bottom group at most a third of the height.
