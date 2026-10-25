# `edit.html` - the desktop editor (M6 E1)

## Purpose

The Tour Viewer's second page, for a computer: open the tour zip the
phone's Finish saved and see every printed code, pin and photo on a full
map, in the owner's chosen layout (variant 1, the left rail:
`public/prototypes/editor-1-left-rail/`), and fix a pin's text, move a note or
delete one, then Save a new copy (M6 E2a). Design and decisions:
`GpsPlusSlamJs_Docs/docs/2026-10-13-0832-tour-desktop-editor-and-scan-data-design.md`
(§5, §9).

A Vite build entry (`vite.config.ts`, `edit`), so it is built and reachable
on a deployed branch preview at `/tour/edit.html`; linked from the setup
page's "You already have a tour?" box and from step 5 on a device without
AR (tour editor plan 2026-10-17-1816, W1).

## Structure

- `#topbar` comes first in the body (described below), so Tab starts in
  the top bar and walks it left to right.
- `#map` - the full-window map (`src/editor/editor-map.ts`); `inert`
  while the 3D view shows over it, so Tab never walks the hidden map.
- `#view3d` - the 3D view's box over the map, hidden until the view
  shows (`src/editor3d/editor3d-scene.ts` puts its canvas in it), with its
  credits line `#view3d-credits` (Mapterhorn, its elevation data,
  OpenStreetMap) as its last child, so its links come after the docks in
  the Tab order (the docks' z-index keeps them painted over it). Inside it the studio shell's parts
  (`src/editor/editor-shell/editor-shell.ts`): the tree dock
  `#shell-tree` (`#tree-stations`, `#tree-fold`, `#tree-body`), the
  inspector dock `#shell-inspector` (`#inspector-head`,
  `#inspector-body`, hidden without a selection), the map controls
  `#map-controls` (`#compass` with `#compass-needle`, `#zoom-in`,
  `#zoom-out`) and the help `#shell-help`.
- `#shell-bar` - the bottom bar, shown with the top bar in both views:
  first the save status `#save-status` (a live region; its words also in
  its `title`) and the 3D view's load line `#view-loading` ("Loading 3D
  view…", hidden otherwise, `src/editor/view-switch.ts`); then the 3D
  view's `#shell-view`, `#shell-hint`, the debug readout
  (`#shell-history`, `#shell-calls`, `#shell-frame`) and its toggle
  `#shell-debug`, hidden on the map. The map's overlays at its foot (the
  rail, the debug panel, the map's credits, the toasts) sit above it.
- `body[data-view]` - `3d` while the 3D view shows, else `2d`: the
  shell's stylesheet (`src/editor/editor-shell/editor-shell.css`, the
  page's second link) dresses the top bar dark, places the view between
  a 40 px top bar and the 24 px bottom bar, and hides the rail, the card,
  the debug panel and the off-screen chip; the studio's controls
  (`.studio`) show only then.
- `#debug-panel` - shown for every open tour: the debug layer's line
  (`#debug-status`, a live region) and "Add debug data…" (`#debug-add`,
  with its hidden `#debug-add-input`; a file dropped on the panel too;
  M2 step 5 of the debug-captures plan) (`src/editor/debug-capture-layer.ts`,
  `src/editor/added-debug-data.ts`). The layer's switch is View's "Show
  debug data". It stacks under the note card (`editor.css`), which may
  open over the same corner.
- `#topbar` - the tour's title (`#tour-name`, a button that opens the
  tour's details, W2) and file name, then the menus
  (`src/editor/menu-button.ts`), each command in words:
  - **File** (`#file-menu-btn`, `#file-menu`; described by
    `#save-status`): Open… (`#file-open`), Save (`#file-save`, Ctrl+S),
    Save a copy… (`#file-save-copy`), Tour details… (`#file-details`),
    Add debug data… (`#file-debug-add`, the same `#debug-add-input` as
    the map's panel), "Keep the debug data in the tour file"
    (`#file-keep-walk`, a `menuitemcheckbox` only for a tour carrying a
    walk, unticked; hidden for a file opened for writing, which keeps its
    walk) and "Share and publish…" (`#file-publish`, the done dialog).
  - **A menu item is disabled by `aria-disabled`, never by `disabled`**
    (the menu button pattern: it keeps the focus, so a screen reader says
    it is there); a shown shortcut is `aria-keyshortcuts` (Control+S,
    Control+Z, Control+Shift+Z, T, F) with its `<kbd>` `aria-hidden`, so
    it is not read into the item's name. Pinned by
    `src/editor/edit-menus-markup.test.ts`.
  - The unsaved mark `#unsaved-mark` beside File: an amber dot and "Not
    saved" while changes are not saved (the status's words its `title`);
    the one warning in the bar against losing work.
  - **Edit** (`#edit-menu-wrap`, `#edit-menu-btn`, `#edit-menu`, 3D
    only, shown at a phone's width): Undo (`#edit-undo`) and Redo
    (`#edit-redo`), where the bar's buttons fold.
  - **View** (`#view-menu-btn`, `#view-menu`): Top view (`#studio-top`,
    T, a `menuitemcheckbox`) and Frame (`#studio-frame`, F), the 3D
    view's; Show debug data (`#view-debug`, a `menuitemcheckbox`, only
    while the debug layer has a source - the tour's walk or added debug
    data - and only on the map, which alone draws that layer yet); and the view switch `#view-switch` ("3D view" / "2D map",
    `src/editor/view-switch.ts`).
  - The 3D view's studio buttons, hidden on the map: Details
    (`#studio-details`), Undo and Redo (`#studio-undo`, `#studio-redo`),
    and after the spacer Help (`#studio-help`); each an icon and its word
    (`.lbl`), the icons `<i data-icon>` slots the shell fills. The bar
    folds in steps as the window narrows (`editor-shell.css`).
- `#rail` - the codes, pins and photos (`src/editor/editor-rail.ts`).
- `#card`, `#offscreen-chip` - the card beside the selected marker
  (`src/editor/editor-card.ts`).
- `#open-modal` - "Open a tour": the file input inside `#drop` (a click
  opens the chooser; a drop works too), `#open-status` (the async state),
  `#open-error`, "Use the sample tour", and `#link-form` (`#link-input`,
  `#link-btn` "Open the link": a hosted tour from its link, tour editor
  plan 2026-10-17-1816 W1; a text input, so the dialog, not the browser,
  says what is wrong with a link).
- `#open-fineprint` - what Save does, written per browser by
  `edit-main.ts` (`saveFinePrint`); the markup's text is the one for a
  browser without the file picker. A span inside the fine print, beside
  its Privacy link (`legal.html#privacy`, W6).
- `#details-modal` - "Tour details" (W2 of the tour editor plan
  2026-10-17-1816): `#details-form` with `#details-name` (the format keeps
  80 characters), `#details-description` (2000), `#details-covers` (the
  cover radios `edit-main.ts` draws; `#details-covers-none` when the tour
  has no photo to choose), `#details-contact` (320), `#details-error`
  (`role="alert"`), Cancel and Apply (`src/editor/details-dialog.ts`). Above the toasts (z-index). Each
  field's `maxlength` is TWICE the format's limit (160, 4000, 640): the
  attribute counts UTF-16 units, the format code points, and a character
  outside the Basic Multilingual Plane (an emoji) is two units - a cap at
  the format's number stopped 80 emoji at 40 (the r875 milestone review
  #8). The save's check decides and says why; `src/page-contracts.test.ts`
  holds the caps. The phone's `#tour-name-input` (`index.html`) keeps 80:
  the phone writes that field's value without the format's check, so its
  cap is the only bound there until the phone adopts the details rule.
- `#done-modal` - "Share and publish" (File's last item; W2, D18, D19;
  `src/editor/done-dialog.ts`):
  `#done-where`, the host picker `#done-host` (options drawn by
  `edit-main.ts`) with `#done-update`, `#done-public`, `#done-drive-tip`
  (hidden: `DRIVE_MOUNT_TIP_SHOWN` is off until the owner's check),
  `#done-walk` (only while the file carries the walk: `#done-walk-text`,
  `#done-move` "Move the debug data out", `#done-save-debug` "Save the
  debug data" after a save that left it out, `#done-move-status`), a
  Privacy link
  (`legal.html#privacy`) and Close. Above the toasts (z-index).
- `#toasts` - "Opened <file>: N codes, M notes".

## Invariants

- Every text the zip supplies is set with `textContent` by the modules;
  the page holds no tour data in its markup.
- Its look is `src/editor/editor.css` (paper tokens of its own), not
  `design.css` - a `<link>` in the head, not an import of `edit-main.ts`:
  a module's CSS arrives with the module, so the page painted unstyled
  until the module had loaded (tour editor plan 2026-10-17-1816, W1). The
  map's Leaflet CSS stays an import of `editor-map.ts`: nothing of the
  map shows before the module runs anyway.
- The visitor page never imports `src/editor/` (dependency-cruiser rule
  `viewer-not-to-editor`), so a visitor never downloads the editor's
  Leaflet.
- The 3D view's modules load only by the switch's `import()`:
  `src/editor3d-lazy.test.ts` reads a production build and fails when any
  page loads the globe, the tile renderer, the elevation package or
  `src/editor3d/` before an `import()` runs.

## Tests

`playwright-tests/editor-entry.spec.js` (the link form: busy until the
linked tour opened, a refused link, text that is not a link),
`playwright-tests/way-in.spec.js` (the first paint with the module held
back: the editor's paper, not the browser's plain page),
`playwright-tests/editor.spec.js` (the real file chooser, the rail and the
markers, the card beside its marker, a capped photo, a refused non-tour,
the layout at three viewports, the menus inside the window, the details
dialog, the fine print, Share and publish and the walk's move),
`playwright-tests/editor3d.spec.js` (a tour opening in the 3D view, the
map as the fallback, the view and back),
`playwright-tests/editor3d-shell.spec.js` (the studio shell's layout at
four viewports and every fold step, the menus by keyboard and touch, the
unsaved mark, its tree clicks). The specs reach the menus through
`playwright-tests/editor-menus.js`.
