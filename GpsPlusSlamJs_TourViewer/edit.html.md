# `edit.html` - the desktop editor

## Purpose

The Tour Viewer's editor page, for a computer (and a phone without AR):
open a tour zip, a link or the example, edit its stations, pins, photos
and other blocks in the 3D view on the globe, and save the tour back into
its file or as a copy. Design and decisions:
`GpsPlusSlamJs_Docs/docs/2026-10-13-0832-tour-desktop-editor-and-scan-data-design.md`
(§5, §9). The page has no 2D map: the 3D view is the editor, and where it
cannot open a page says so (`#view3d-failed`).

A Vite build entry (`vite.config.ts`, `edit`), so it is built and reachable
on a deployed branch preview at `/tour/edit.html`; linked from the setup
page's "You already have a tour?" box and from step 5 on a device without
AR (tour editor plan 2026-10-17-1816, W1).

## Structure

- `#topbar` comes first in the body (described below), so Tab starts in
  the top bar and walks it left to right.
- `#view3d-failed` - the page where the 3D view cannot open
  (`src/editor/view3d-failed-page.ts`): `#view3d-failed-title` (focused when
  it shows), `#view3d-failed-reason`, and Try again, Open another tour…,
  Save, Save a copy…, Tour details…. Under the top bar, under the dialogs
  and toasts.
- `#view3d` - the 3D view's box, hidden until the view shows
  (`src/editor/view3d-opener.ts` opens it; `src/editor3d/editor3d-globe.ts`
  puts its canvas in it), its first child the permanent accent line
  `#load-line` (`aria-hidden`, under the top bar; the globe view's
  approach covers it with its own loading line while the tour loads).
  Inside it the selection's scene line `#shell-scene-hint` and the studio
  shell's parts (`src/editor/editor-shell/editor-shell.ts`):
  - the tree dock `#shell-tree`: `#tree-stations`, `#tree-select` (the
    Select mode's button, `aria-pressed`, a phone's way to tick several
    rows), `#tree-collapse`, `#tree-add` (the "+" that adds a station at
    the centre of the view), `#tree-fold`, the search `#tree-search` (the
    stations, their items and the codes), `#tree-body`, `#tree-selbar`
    (the picked rows' count, Group, Ungroup and, in the Select mode, Done)
    and the key hints `#tree-foot`;
  - the inspector dock `#shell-inspector` (`#inspector-head`,
    `#inspector-body`, hidden without a selection);
  - the asset shelf `#shell-shelf` and its phone pill `#shelf-pill`
    (`src/editor/asset-shelf/shelf-panel.ts`);
  - the view's controls `#map-controls` (`#compass` with
    `#compass-needle`, `#zoom-in`, `#zoom-out`);
  - the bottom panel `#shell-panel` (`bottom-panel.ts`), the help
    `#shell-help` (with `#shell-help-hint`), the reorder line `#shell-said`
    and the ground menu `#scene-menu` (`#scene-new-station`, "New station
    here"; `scene-menu.ts`);
  - `#debug-panel`, shown for every open tour: the debug layer's line
    (`#debug-status`, a live region) and "Add debug data…" (`#debug-add`,
    with its hidden `#debug-add-input`; a file dropped on the panel too)
    (`src/editor/debug-capture-layer.ts`, `src/editor/added-debug-data.ts`).
    The layer's switch is View's "Show debug data". The docking takes the
    panel into the view's pane (`editor-shell/dock-host.ts`). Being inside
    `#view3d`, it is hidden whenever the view is (while the view loads, or
    on the cannot-open page); an add that lands then is said in a toast
    instead (`edit-main.ts`).

  The box has `tabindex="-1"`: the ground menu gives the focus back to it,
  and the view's window keys work from there.

- `#shell-bar` - the bottom bar, shown with the top bar once a tour is
  open: first the 3D view's credits `#view3d-credits` (Mapterhorn, its
  elevation data, OpenStreetMap; one small "Credits" button whose panel
  opens upward, `src/editor3d/editor3d-credits.ts`; empty while the view
  does not show), after the docks in the Tab order and never covered by
  them; then the save status `#save-status` (a live region, said to a
  screen reader; the top bar's unsaved mark shows it) and the 3D view's
  load line `#view-loading` ("Loading 3D view…", hidden otherwise, owned
  by `src/editor/view3d-opener.ts`); then the selection's power actions
  `#shell-acts` (Duplicate, Align to station, Copy position;
  `bar-actions.ts`, drawn by the shell), the bottom panel's toggles
  `#shell-toggles` and the asset shelf's toggle `#shelf-toggle`.
- `body[data-view]` - `3d` while the 3D view shows, absent otherwise
  (`edit-main.ts`, the opener's `onShown`): the shell's stylesheet
  (`src/editor/editor-shell/editor-shell.css`, the page's second link)
  dresses the top bar dark and places the view between a 40 px top bar
  and the 24 px bottom bar; the studio's controls (`.studio`) show only
  then. An e2e waits for `data-view="3d"`.
- `#topbar` - the tour's title (`#tour-name`, a button that opens the
  tour's details, W2) and file name (`#tour-file`), then the menus
  (`gps-plus-slam-editor-kit/chrome`, `GpsPlusSlamJs_EditorKit/src/chrome/menu-button.ts`), each command in words:
  - **File** (`#file-menu-btn`, `#file-menu`; described by
    `#save-status`): Open… (`#file-open`), Save (`#file-save`, Ctrl+S),
    Save a copy… (`#file-save-copy`), Tour details… (`#file-details`),
    Characters… (`#file-characters`), Add debug data… (`#file-debug-add`,
    the same `#debug-add-input` as the panel's button), "Keep the debug
    data in the tour file" (`#file-keep-walk`, a `menuitemcheckbox` only
    for a tour carrying a walk, unticked; hidden for a file opened for
    writing, which keeps its walk) and "Share and publish…"
    (`#file-publish`, the done dialog).
  - **A menu item is disabled by `aria-disabled`, never by `disabled`**
    (the menu button pattern: it keeps the focus, so a screen reader says
    it is there); a shown shortcut is `aria-keyshortcuts` (Control+S,
    Control+Z, Control+Shift+Z, Control+K, T, F) with its `<kbd>`
    `aria-hidden`, so it is not read into the item's name. Pinned by
    `src/editor/edit-menus-markup.test.ts`.
  - The unsaved mark `#unsaved-mark` beside File: an amber dot and "Not
    saved" while changes are not saved (the status's words its `title`);
    the one warning in the bar against losing work.
  - **Edit** (`#edit-menu-wrap`, `#edit-menu-btn`, `#edit-menu`, shown at
    every width): Undo (`#edit-undo`), Redo (`#edit-redo`), Copy
    (`#edit-copy`, Ctrl+C), Paste (`#edit-paste`, Ctrl+V), Duplicate
    (`#edit-duplicate`, Ctrl+D), Delete (`#edit-delete`, Del) and Add…
    (`#edit-add`, Ctrl+K); each item carries its `aria-keyshortcuts`, and
    Copy to Delete start disabled (`aria-disabled`) until the shell draws
    them for the selection. Undo, Redo and Add are also the bar's own
    buttons until they fold.
  - **View** (`#view-menu-btn`, `#view-menu`): Top view (`#studio-top`,
    T, a `menuitemcheckbox`), Frame (`#studio-frame`, F), Real time
    (`#view-realtime`, the globe's clock), Clouds (`#view-clouds`, its
    heavy clouds), Quality (`#view-quality`, the tier of the next open,
    remembered per browser) and Show debug data (`#view-debug`, a
    `menuitemcheckbox`, only while the debug layer has a source - the
    tour's walk or added debug data).
  - The brand: the tour's name (`#tour-name`, its words in
    `#tour-name-text`) with a pen right of it (`.tour-name-pen`), one
    button that opens the tour's details (File's Tour details… too); there
    is no Details button and no brand mark.
  - The 3D view's studio buttons, hidden while the view does not show:
    Undo and Redo (`#studio-undo`, `#studio-redo`), and after the spacer
    (`#studio-help-group`) List (`#studio-list`, a phone's way to the list
    when no sheet shows), Add… (`#studio-add`, Ctrl+K) and Help
    (`#studio-help`); each an icon and its word (`.lbl`), the icons
    `<i data-icon>` slots the shell fills. The bar folds in steps as the
    window narrows (`editor-shell.css`).
- `#open-modal` - the start card, "Start in the editor"
  (`src/editor/start-card.ts`): `#start-from`, question 1 "What do you
  start from?" as three `.start-choice` radios (`#start-tour` "A tour I
  made (.zip or link)", `#start-new` "A new, empty tour", `#start-example`
  "The example tour - just look around"); `#start-tour-step` (shown for
  the first) with the file input inside `#drop` (a click opens the
  chooser; a drop works too; `#start-tour-held` names the held file) and
  `#link-form` (`#link-input`, a text input, so the dialog, not the
  browser, says what is wrong with a link; Enter opens it);
  `#start-scan-step` (shown for the first two), question 2 "Add a scan of
  the place? (optional)", its line saying the scan is shown while editing
  and never saved into the tour, `#start-scan-held`, `#start-scan-remove`
  and `#start-scan-btn` (the browser's file picker where it exists, so the
  scan can be remembered by the tour's id, else `#start-scan-input`); then
  `#open-status` (the
  async state), `#open-error`, `#start-summary` (what the button will do)
  and `#start-open` "Open the editor", disabled until the answers name
  something to open.
- `#open-fineprint` - what Save does, written per browser by
  `edit-main.ts` (`saveFinePrint`); the markup's text is the one for a
  browser without the file picker. A span inside the fine print, beside
  its Privacy link (`/legal/#privacy`, the site-wide page) and the
  "Back to the tour page" link (`back-to-tour-page`, `./`, so it reaches
  the viewer's own index wherever the site serves it; the editor's
  `beforeunload` guard still asks before unsaved changes go).
- `#details-modal` - "Tour details" (W2 of the tour editor plan
  2026-10-17-1816): `#details-form` with `#details-name` (the format keeps
  80 characters), `#details-description` (2000), `#details-covers` (the
  cover radios `edit-main.ts` draws; `#details-covers-none` when the tour
  has no photo to choose), `#details-contact` (320), `#details-no-gps` (the tour's "needs no GPS")
  with `#details-no-gps-warnings` (a
  polite live region, never hidden), `#details-error`
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
  (`/legal/#privacy`) and Close. Above the toasts (z-index).
- `#toasts` - the page's toasts ("Opened <file>: N codes, M notes", a
  save's result, a refusal, an Undo offer).

## Invariants

- Every text the zip supplies is set with `textContent` by the modules;
  the page holds no tour data in its markup.
- Its look is `src/editor/editor.css` (paper tokens of its own), not
  `design.css` - a `<link>` in the head, not an import of `edit-main.ts`:
  a module's CSS arrives with the module, so the page painted unstyled
  until the module had loaded (tour editor plan 2026-10-17-1816, W1).
- The editor holds no 2D map: Leaflet is the visitor's summary map's
  alone (`src/summary-map-view.ts`), and nothing under `src/editor/`
  imports it. The visitor page never imports `src/editor/`
  (dependency-cruiser rule `viewer-not-to-editor`).
- The 3D view's modules load only by the opener's `import()`
  (`view3d-opener.ts`): `src/app-bundle.test.ts` reads a production build
  and fails when any page loads the globe, the tile renderer, the
  elevation package or `src/editor3d/` before an `import()` runs.

## Tests

`playwright-tests/editor-entry.spec.js` (the link form: busy until the
linked tour opened, a refused link, text that is not a link),
`playwright-tests/way-in.spec.js` (the first paint with the module held
back: the editor's paper, not the browser's plain page),
`playwright-tests/editor.spec.js` (the file chooser and its counts, a
refused non-tour, the example, the debug data and its panel, saving in
place, as a copy and as a download, autosave, undo across a save, the
details dialog, the fine print, Share and publish and the walk's move),
`playwright-tests/editor3d.spec.js` (a tour opening in the 3D view, the
cannot-open page, seventeen opens without a WebGL context leak),
`playwright-tests/editor3d-globe-default.spec.js` (the globe by default,
an empty tour, `#view3d-failed` and its File actions, `#details-no-gps`),
`playwright-tests/editor3d-shell.spec.js` (the studio shell's layout at
four viewports and every fold step, the menus by keyboard and touch, the
unsaved mark, its tree clicks). The specs reach the menus through
`playwright-tests/editor-menus.js`.

## Characters

- File menu: "Characters…" (`#file-characters`), after "Tour details…".
- `#characters-panel` (`dialog.charpanel`) is the Characters list. It holds:
  - "In this tour" and the pick-up banner;
  - "On this device", "Make a character" and "Import character..."
    (`#characters-import-file`), with the refusal and name cards; the two
    buttons share a `.row.one-line` (`characters-panel.css`), one line
    whatever the font;
  - "Rename or delete characters on this device", the link that opens the
    maker on its own;
  - the list's own toasts and Undo.
- `#characters-maker` (`dialog.charmaker`) is the maker over the editor: a
  dark bar ("‹ Back to the tour" and the tour's name) above a same-origin
  frame of `characters.html`.
- Styles are in `src/editor/characters-panel.css`; behaviour is in
  `src/editor/characters-panel.ts`.
